// Поиск машин на фронте: индекс в памяти по данным трекера (обновляется с каждым сообщением WebSocket).
// Понимает VIN (полный, часть, последние 4–6 знаков), номер кузова, модель, цвет и простые слова:
// «задерживаются», «перекраска», «несоответствие», участки и линии («окраска», «линия J7»).
// Каждое слово запроса должно найтись у машины; совпадение с концом VIN — выше всего.
import { MODEL_BY_ID, type BodyFlag, type BodyView, type ModelId, type PlantModel } from '@allur/contracts/ref';
import { isProblem } from './cars';

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const split = (s: string) => norm(s).split(/[\s,·:()«»"]+/).filter(Boolean);

/** Слова-связки, которые ничего не уточняют: «линия J7», «машины на окраске» */
const STOP = new Set([
  'линия', 'линии', 'линию', 'на', 'в', 'во', 'участок', 'участке', 'машина', 'машины', 'машин', 'кузов', 'кузова', 'и', 'с', 'по',
  'желі', 'желісі', 'учаске', 'аймақ', 'көлік', 'шанақ', 'және', 'бойынша', 'ішінде',
  'line', 'area', 'shop', 'car', 'body', 'in', 'at', 'on', 'and', 'the', 'by',
]);

/** Как говорят про отметки кузова в цеху */
const FLAG_WORDS: Record<BodyFlag, string[]> = {
  delayed: [
    'задерживается', 'задерживаются', 'задержка', 'задержанные', 'опаздывает', 'опаздывают', 'долго',
    'кешігу', 'кешігуде', 'бөгелуде', 'кешіккен', 'кешікті',
    'delayed', 'delay', 'late', 'lag',
  ],
  rework: [
    'перекраска', 'перекраски', 'перекрашивается', 'повторный', 'повтор', 'доработка',
    'қайта', 'бояу', 'қайтаөңдеу', 'қайталанған',
    'rework', 'repaint', 'repainting',
  ],
  nonconformity: [
    'несоответствие', 'несоответствия', 'брак', 'дефект',
    'сәйкессіздік', 'ақау', 'жарамсыз',
    'nonconformity', 'defect', 'scrap', 'issue',
  ],
  restored_checkpoint: [
    'восстановленная', 'восстановлена', 'восстановлено', 'отметка',
    'қалпына', 'келтірілген', 'белгі',
    'restored', 'checkpoint', 'recovered',
  ],
  unknown_color: [
    'без', 'цвета', 'неизвестный',
    'түссіз', 'белгісіз',
    'unknown', 'colorless', 'nocolor',
  ],
};

/** Русские и альтернативные названия моделей — так их скажет мастер */
const MODEL_WORDS: Record<ModelId, string[]> = {
  onix: ['оникс', 'onix'],
  cobalt: ['кобальт', 'cobalt'],
  j7: ['джей', 'джак', 'jac', 'j7'],
};

interface Entry {
  b: BodyView;
  vin: string;
  id: string;
  words: string[];
  problem: boolean;
  since: number;
}

export interface SearchHit {
  body: BodyView;
  /** Где совпало в VIN или номере кузова — для подсветки */
  mark: { field: 'vin' | 'bodyId'; start: number; length: number } | null;
}

const cache = new WeakMap<BodyView[], { plant: PlantModel; entries: Entry[] }>();

import { translateAreaName } from '../i18n/translator';

function wordsOf(b: BodyView, plant: PlantModel): string[] {
  const out: string[] = [];
  const add = (s: string | null | undefined) => s && out.push(...split(s));
  const m = MODEL_BY_ID[b.model];
  add(m.name);
  add(m.short);
  out.push(...MODEL_WORDS[b.model]);
  add(b.color?.name);
  add(b.color?.code);
  const stage = plant.stageById.get(b.loc.stageId);
  if (b.loc.kind === 'buffer') {
    // в очереди после участка — значит, ждёт следующего: «окраска» найдёт и очередь перед окраской
    const to = b.loc.bufferId ? plant.stageById.get(plant.bufferById.get(b.loc.bufferId)?.to ?? '') : undefined;
    add(to?.name);
    add(to?.short);
    if (to) {
      add(translateAreaName(to.name, 'kk'));
      add(translateAreaName(to.name, 'en'));
    }
    out.push('очередь', 'буфер', 'кезек', 'queue', 'buffer');
  } else {
    add(stage?.name);
    add(stage?.short);
    if (stage) {
      add(translateAreaName(stage.name, 'kk'));
      add(translateAreaName(stage.name, 'en'));
    }
  }
  const eq = b.loc.equipmentId ? plant.equipmentById.get(b.loc.equipmentId) : undefined;
  if (eq && !b.loc.estimated) {
    add(eq.name);
    add(eq.id);
    const st = eq.stationId ? stage?.stations.find((s) => s.id === eq.stationId) : undefined;
    add(st?.name);
  }
  for (const f of b.flags) out.push(...FLAG_WORDS[f]);
  return out;
}

/** Индекс строится один раз на каждое сообщение трекера (WeakMap по массиву кузовов) */
export function searchIndex(bodies: BodyView[], plant: PlantModel): Entry[] {
  const hit = cache.get(bodies);
  if (hit && hit.plant === plant) return hit.entries;
  const entries = bodies.map((b) => ({ b, vin: b.vin ?? '', id: b.bodyId.toUpperCase(), words: wordsOf(b, plant), problem: isProblem(b), since: Date.parse(b.since) }));
  cache.set(bodies, { plant, entries });
  return entries;
}

/** Слово запроса совпадает со словом машины: начало слова; у длинных русских слов — по основе («окраске» → «окраска») */
function wordMatch(word: string, token: string): boolean {
  if (word.startsWith(token)) return true;
  if (token.length < 5 || !/[а-я]/.test(token)) return false;
  return word.startsWith(token.slice(0, Math.max(4, token.length - 3)));
}

/** Похоже на номер: есть цифра, или латиница без пробелов от 4 знаков (часть VIN) */
const looksLikeNumber = (t: string) => /\d/.test(t) || /^[a-z]{4,}$/.test(t);

export function searchCars(entries: Entry[], query: string, limit = 8): { hits: SearchHit[]; total: number } {
  const tokens = split(query).filter((t) => !STOP.has(t));
  if (!tokens.length) return { hits: [], total: 0 };
  const scored: { e: Entry; rank: number; mark: SearchHit['mark'] }[] = [];
  for (const e of entries) {
    let rank = 3;
    let mark: SearchHit['mark'] = null;
    let ok = true;
    for (const t of tokens) {
      const up = t.toUpperCase();
      if (looksLikeNumber(t) && up.length >= 2) {
        const iv = e.vin.indexOf(up);
        if (iv >= 0) {
          const r = e.vin.endsWith(up) ? 0 : 1;
          if (r < rank) rank = r;
          mark = { field: 'vin', start: iv, length: up.length };
          continue;
        }
        const ib = e.id.indexOf(up);
        if (ib >= 0) {
          if (rank > 2) rank = 2;
          mark ??= { field: 'bodyId', start: ib, length: up.length };
          continue;
        }
      }
      if (!e.words.some((w) => wordMatch(w, t))) {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ e, rank, mark });
  }
  // сначала точнее совпадение, затем проблемные, затем дольше всех на месте
  scored.sort((a, b) => a.rank - b.rank || Number(b.e.problem) - Number(a.e.problem) || a.e.since - b.e.since);
  return { hits: scored.slice(0, limit).map((s) => ({ body: s.e.b, mark: s.mark })), total: scored.length };
}

/** Запрос — часть номера: тогда есть смысл искать по истории (машина могла уже уехать) */
export function looksLikeVinQuery(query: string): boolean {
  const q = query.replace(/[^0-9A-Za-z-]/g, '');
  return q.length >= 3 && /\d/.test(q);
}

// ---------------------------------------------------------------------------
// Последние поиски: память браузера может быть недоступна — тогда просто без истории

const RECENT_KEY = 'car-search-recent';

export function recentSearches(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  try {
    const next = [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // не запомнится — не страшно
  }
}

// ---------------------------------------------------------------------------
// Быстрые фильтры 3D: не прячут остальные машины, а приглушают их

export interface CarFilters {
  delayed: boolean;
  rework: boolean;
  models: ModelId[];
}

export const NO_FILTERS: CarFilters = { delayed: false, rework: false, models: [] };

export function filtersActive(f: CarFilters): boolean {
  return f.delayed || f.rework || f.models.length > 0;
}

/** Отметки — «или» (задерживается или перекраска), модели — «или», между группами — «и» */
export function matchesFilters(b: BodyView, f: CarFilters): boolean {
  if ((f.delayed || f.rework) && !((f.delayed && b.flags.includes('delayed')) || (f.rework && b.flags.includes('rework')))) return false;
  if (f.models.length && !f.models.includes(b.model)) return false;
  return true;
}
