import type { LossCategory, StationId } from './types';

/**
 * Эмулятор LLM-разбора свободного текста из журналов операторов.
 * В продукте: промпт «извлеки участок, оборудование, причину, длительность»
 * со структурированным JSON-ответом. В демо — правила, но формат результата тот же.
 */

export type SpanKind = 'time' | 'station' | 'equipment' | 'cause' | 'duration';

export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
}

export interface ParsedEntry {
  raw: string;
  time: string | null;
  stationId: StationId | null;
  equipment: string | null;
  cause: string;
  cat: LossCategory | null;
  minutes: number | null;
  confidence: number;
  spans: Span[];
}

export const SAMPLE_JOURNAL = `08:40 пресс №2 стучит, остановили на 15 мин, подтянули крепление и смазали
09:15 сварка — робот 14 ошибка датчика позиционирования, ждали электрика минут 20
с 10:05 до 10:40 на сборке не было комплектов дверей, стояли
11:20 окраска, смена цвета затянулась на полчаса
12:10 гайковерт на ГК выдаёт ошибку момента, перезапуск, 7 мин
13:00 ОТК стенд геометрии — калибровка 10 минут`;

const STATION_RULES: [RegExp, StationId][] = [
  [/пресс|штамп|резк/i, 'press'],
  [/свар|робот\s*(?:r-?)?\d|кондуктор/i, 'weld'],
  [/окрас|покрас|камер|сушк|цвет/i, 'paint'],
  [/сборк|конвейер|гайков|заливк|(?<![а-яё])гк(?![а-яё])/i, 'assembly'],
  [/отк|геометр|ролик/i, 'qc'],
];

// \w и \b в JS не работают с кириллицей, поэтому везде явные классы [а-яё]
const EQUIP_RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/пресс[а-яё]*\s*(?:№|n|п-?)?\s*(\d)/i, (m) => `Пресс П-${m[1]}`],
  [/робот[а-яё]*\s*(?:r-?)?\s*(\d{1,2})/i, (m) => `Сварочный робот R-${m[1].padStart(2, '0')}`],
  [/гайков[её]рт/i, () => 'Гайковёрт многошпиндельный'],
  [/стенд[а-яё]*\s+геометр[а-яё]*/i, () => 'Стенд геометрии'],
  [/камер[а-яё]*\s+окрас[а-яё]*/i, () => 'Камера окраски K-1'],
  [/конвейер|(?<![а-яё])гк(?![а-яё])/i, () => 'Конвейер ГК-1'],
];

const CAUSE_RULES: [RegExp, LossCategory, string][] = [
  [/не было комплект|нет (?:деталей|комплект)|не привезли|некомплект|дефицит/i, 'Нет комплектующих', 'Нет комплектующих'],
  [/датчик|электр|привод|кабел|предохранит|контроллер|ошибк[а-яё]* момента/i, 'Электрика', 'Сбой электрики / автоматики'],
  [/стучит|подшипник|ремень|цеп[ьи]|заклин|смаз|гидрав|утечк|износ|крепл/i, 'Механика', 'Механическая неисправность'],
  [/смена (?:штампа|цвета|оснастки)|переналад|наладк|калибровк|электрод/i, 'Наладка', 'Наладка / переналадка'],
  [/ждали|ожидан|не было (?:мастера|наладчика|электрика)/i, 'Ожидание персонала', 'Ожидание персонала'],
  [/рулон|материал|краск/i, 'Материалы', 'Материалы'],
];

function addSpan(spans: Span[], m: RegExpMatchArray | null, kind: SpanKind) {
  if (!m || m.index === undefined || !m.input) return;
  // подсвечиваем слово целиком, а не только совпавший корень
  let end = m.index + m[0].length;
  while (end < m.input.length && /[а-яёa-z]/i.test(m.input[end])) end++;
  spans.push({ start: m.index, end, kind });
}

const toMin = (hh: string, mm: string) => Number(hh) * 60 + Number(mm);

export function parseLine(raw: string): ParsedEntry {
  const spans: Span[] = [];
  let time: string | null = null;
  let minutes: number | null = null;

  const range = raw.match(/с\s*(\d{1,2})[:.](\d{2})\s*до\s*(\d{1,2})[:.](\d{2})/i);
  if (range) {
    time = `${range[1].padStart(2, '0')}:${range[2]}`;
    minutes = toMin(range[3], range[4]) - toMin(range[1], range[2]);
    addSpan(spans, range, 'duration');
  } else {
    const tm = raw.match(/(\d{1,2})[:.](\d{2})/);
    if (tm) {
      time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
      addSpan(spans, tm, 'time');
    }
  }

  if (minutes === null) {
    const d1 = raw.match(/(\d+(?:[.,]\d+)?)\s*(час|ч|мин)/i);
    const d2 = raw.match(/мин\p{L}*\s+(\d+)/iu);
    const d3 = raw.match(/полчаса|полтора часа/i);
    if (d1) {
      const v = Number(d1[1].replace(',', '.'));
      minutes = /^ч|^час/i.test(d1[2]) ? Math.round(v * 60) : v;
      addSpan(spans, d1, 'duration');
    } else if (d2) {
      minutes = Number(d2[1]);
      addSpan(spans, d2, 'duration');
    } else if (d3) {
      minutes = /полчаса/i.test(d3[0]) ? 30 : 90;
      addSpan(spans, d3, 'duration');
    }
  }

  let stationId: StationId | null = null;
  for (const [re, id] of STATION_RULES) {
    const m = raw.match(re);
    if (m) {
      stationId = id;
      addSpan(spans, m, 'station');
      break;
    }
  }

  let equipment: string | null = null;
  for (const [re, f] of EQUIP_RULES) {
    const m = raw.match(re);
    if (m) {
      equipment = f(m);
      addSpan(spans, m, 'equipment');
      break;
    }
  }

  let cat: LossCategory | null = null;
  let cause = 'Причина не распознана';
  for (const [re, c, label] of CAUSE_RULES) {
    const m = raw.match(re);
    if (m) {
      cat = c;
      cause = label;
      addSpan(spans, m, 'cause');
      break;
    }
  }

  const found = [time, stationId, cat, minutes].filter((x) => x !== null).length + (equipment ? 0.5 : 0);
  const confidence = Math.min(0.98, 0.4 + found * 0.13);

  // при пересечении оставляем более длинный фрагмент («пресс №2» важнее, чем «пресс»)
  const clean: Span[] = [];
  for (const sp of [...spans].sort((a, b) => b.end - b.start - (a.end - a.start))) {
    if (clean.every((c) => sp.end <= c.start || sp.start >= c.end)) clean.push(sp);
  }
  clean.sort((a, b) => a.start - b.start);

  return { raw, time, stationId, equipment, cause, cat, minutes, confidence, spans: clean };
}

export function parseJournal(text: string): ParsedEntry[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseLine);
}
