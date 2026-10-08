// «Паспорт автомобиля»: модель, VIN, цвет, заказ; лента стадий (вход, выход, длительность против нормы,
// источник отметки); несоответствия и решения; петли перекраски и выборочный контроль; восстановленные
// отметки; итог — готова или где сейчас. Лента считается так же, как в окне паспорта (web state/stages.ts).
import { ID_METHOD_DEF, plantDate, plantOperations, shiftsBetweenDates, type BodyDetail, type BodyRouteStepView, type PlantModel } from '@allur/contracts';
import { fileWord, fmtDateTime, fmtDec, fmtInt } from './format';
import type { ReportDoc, Row } from './model';
import { ReportError, SOURCE_RU, baseMeta, type ReportParams, type ReportSource } from './source';

/** Рабочее время между a и b, мс: только смены (как в интерфейсе) */
function workMs(a: number, b: number): number {
  if (b <= a) return 0;
  let sum = 0;
  for (const s of shiftsBetweenDates(plantDate(a), plantDate(b))) sum += Math.max(0, Math.min(b, s.endMs) - Math.max(a, s.startMs));
  return sum;
}

type Mark = 'done' | 'now' | 'queue' | 'ahead';
const MARK_RU: Record<Mark, string> = { done: 'Пройдена', now: 'Сейчас здесь', queue: 'В очереди', ahead: 'Впереди' };

function marks(b: BodyDetail, plant: PlantModel): Mark[] {
  const idx = plant.stages.findIndex((s) => s.id === b.loc.stageId);
  return plant.stages.map((_s, i) => {
    if (b.loc.kind === 'finished') return 'done';
    if (b.loc.kind === 'buffer') return i <= idx ? 'done' : i === idx + 1 ? 'queue' : 'ahead';
    return i < idx ? 'done' : i === idx ? 'now' : 'ahead';
  });
}

const HOW: Record<NonNullable<BodyRouteStepView['by']>, string> = {
  operation: 'результат операции',
  station_out: 'выход со станции',
  stage_exit: 'выход участка',
  assumed: 'до начала отслеживания',
};

export function buildPassportReport(src: ReportSource, p: ReportParams): ReportDoc {
  const id = (p.vin ?? '').trim().toUpperCase();
  if (id.length < 3) throw new ReportError(400, 'Укажите VIN (17 знаков) или номер кузова: vin=…');
  const tracked = src.twin.state.tracker.find(id);
  if (!tracked) throw new ReportError(404, `Кузов ${id} не найден — проверьте номер`);
  const vin = tracked.vin ?? tracked.bodyId;
  const now = src.now;
  const passport = src.twin.passport(vin, tracked.vin ? src.eventsByVin(tracked.vin) : [], now);
  if (!passport?.body) throw new ReportError(404, `Кузов ${id} не найден — проверьте номер`);
  const b = passport.body;
  const plant = src.twin.plant;
  const posts = plantOperations(plant);
  const stepNorm = (s: BodyRouteStepView) => {
    const op = s.postId ? posts.get(s.postId) : undefined;
    return op ? op.normSec / Math.max(1, op.ops.length) : 0;
  };
  const ms = marks(b, plant);

  // ---- Лента стадий
  const stageRows: Row[] = [];
  const branchRows: Row[] = [];
  plant.stages.forEach((st, i) => {
    const mark = ms[i]!;
    const passes = b.stages.filter((x) => x.stageId === st.id);
    const steps = b.route.filter((x) => x.stageId === st.id);
    const first = passes[0];
    const lastPass = passes[passes.length - 1];
    const terminal = st.kind === 'warehouse_out';
    const inAt = first?.in ?? null;
    const outAt = terminal ? inAt : mark === 'done' ? (lastPass?.out ?? null) : null;
    const minutes = inAt && !terminal ? Math.round(workMs(Date.parse(inAt), outAt ? Date.parse(outAt) : now) / 60_000) : null;
    const normSec = steps.filter((x) => !x.optional && x.loop === 0).reduce((a, x) => a + stepNorm(x), 0);
    const normMin = normSec > 0 ? Math.max(1, Math.round(normSec / 60)) : null;
    const eq = steps.map((x) => (x.equipmentId ? plant.equipmentById.get(x.equipmentId) : undefined)).find((e) => e?.stationId);
    const line = st.stations.length > 1 && eq ? (st.stations.find((x) => x.id === eq.stationId)?.name ?? null) : null;
    const checkpoint = b.history.find((h) => h.stageId === st.id && (h.kind === 'checkpoint' || h.kind === 'restored'));
    // способ отметки («Сканер 1С:MES», «RFID тележки») уже говорит об источнике; нет способа — источник
    const how = checkpoint ? (checkpoint.method ? ID_METHOD_DEF[checkpoint.method]?.label : null) ?? SOURCE_RU(checkpoint.source) : null;
    const restored = b.history.filter((h) => h.stageId === st.id && (h.kind === 'restored' || h.restored));
    const late = minutes !== null && normMin !== null && minutes > normMin * 1.5;
    const result = [
      !first && mark === 'done' ? 'пройдена до начала отслеживания' : MARK_RU[mark],
      late ? 'дольше нормы в 1,5 раза' : null,
      passes.some((x) => x.loop > 0) ? 'был повторный проход' : null,
      restored.length ? 'есть восстановленная отметка' : null,
    ]
      .filter(Boolean)
      .join('; ');
    stageRows.push({
      stage: st.short,
      line: line ?? (eq?.name && st.stations.length > 1 ? eq.name : '—'),
      in: inAt ? Date.parse(inAt) : null,
      out: terminal ? (inAt ? 'конечная' : null) : outAt ? Date.parse(outAt) : null,
      minutes,
      norm: normMin,
      how: how ?? '—',
      result,
    });
    const loops = [...new Set([...passes.map((x) => x.loop), ...steps.map((x) => x.loop)])].filter((l) => l > 0).sort((a, c) => a - c);
    for (const loop of loops) {
      const ps = passes.find((x) => x.loop === loop);
      const ls = steps.filter((x) => x.loop === loop && !x.optional);
      const times = ls.map((x) => x.at).filter((x): x is string => !!x).sort();
      const finished = ls.length > 0 && ls.every((x) => x.status === 'done' || x.status === 'failed');
      const from = ps?.in ?? times[0] ?? null;
      const to = ps?.out ?? (finished ? (times[times.length - 1] ?? null) : null);
      branchRows.push({ stage: st.short, what: `${st.kind === 'painting' ? 'Перекраска' : 'Повторный проход'}, ${loop + 1}-й проход`, from: from ? Date.parse(from) : null, to: to ? Date.parse(to) : from ? 'идёт' : null });
    }
    for (const x of steps.filter((y) => y.optional && (y.status === 'done' || y.status === 'in_progress' || y.status === 'failed'))) {
      const e = x.equipmentId ? plant.equipmentById.get(x.equipmentId) : undefined;
      branchRows.push({ stage: st.short, what: `Выборочный контроль: ${e?.name ?? x.name}${x.by ? ` (${HOW[x.by]})` : ''}`, from: x.at ? Date.parse(x.at) : null, to: null });
    }
  });

  // ---- Итог: готова или где сейчас, сколько в производстве
  const startIso = b.stages.find((x) => x.in)?.in ?? null;
  const finished = b.loc.kind === 'finished';
  const finishIso = finished ? ([...b.stages].reverse().find((x) => x.in)?.in ?? null) : null;
  const start = startIso ? Date.parse(startIso) : null;
  const endMs = finishIso ? Date.parse(finishIso) : now;
  const workMin = start !== null ? Math.round(workMs(start, endMs) / 60_000) : null;
  const calH = start !== null ? (endMs - start) / 3600_000 : null;
  const restoredAll = b.history.filter((h) => h.kind === 'restored' || h.restored);
  const color = b.color ? `${b.color.name} (код ${b.color.code})` : 'не передан из 1С';

  return {
    title: 'Паспорт автомобиля',
    subtitle: `${passport.modelName} · VIN ${tracked.vin ?? 'ещё не присвоен'}`,
    fileBase: `Паспорт_автомобиля_${fileWord(tracked.vin ?? tracked.bodyId)}`,
    meta: baseMeta(src, p, [
      ['Модель', passport.modelName],
      ['VIN', tracked.vin ?? 'ещё не присвоен'],
      ['Номер кузова', tracked.bodyId],
      ['Цвет', color],
      ['Заказ', [b.plannedSeq !== null ? `позиция в плане ${fmtInt(b.plannedSeq)}` : null, b.trim ? `комплектация ${b.trim}` : null].filter(Boolean).join(', ') || '—'],
    ]),
    sections: [
      {
        kind: 'kpis',
        title: 'Итог',
        items: [
          { label: finished ? 'Готова' : 'Где сейчас', value: passport.where, type: 'text' },
          { label: 'В производстве, рабочих минут', value: workMin, type: 'minutes', note: start !== null ? `с ${fmtDateTime(start)}${finished && finishIso ? ` по ${fmtDateTime(Date.parse(finishIso))}` : ' по сей момент'}; только время смен` : 'вход на первый участок не отмечен' },
          { label: 'В производстве, календарных часов', value: calH !== null ? fmtDec(calH, 1) : null, type: 'text' },
          { label: 'Несоответствий', value: passport.checks.length, type: 'int', bad: passport.checks.length > 0 },
          { label: 'Петель перекраски и повторных проходов', value: branchRows.filter((r) => String(r.what).startsWith('Перекраска') || String(r.what).startsWith('Повторный')).length, type: 'int' },
          { label: 'Восстановленных отметок', value: restoredAll.length, type: 'int', note: 'отметка пропущена и восстановлена двойником по соседним' },
        ],
      },
      {
        kind: 'table',
        table: {
          title: 'Лента стадий',
          columns: [
            { key: 'stage', title: 'Участок', type: 'text', weight: 1.2 },
            { key: 'line', title: 'Линия или станция', type: 'text', weight: 1.2 },
            { key: 'in', title: 'Вход', type: 'datetime', weight: 1.4 },
            { key: 'out', title: 'Выход', type: 'datetime', weight: 1.4 },
            { key: 'minutes', title: 'Мин', type: 'minutes', weight: 0.6 },
            { key: 'norm', title: 'Норма, мин', type: 'minutes', weight: 0.7 },
            { key: 'how', title: 'Источник отметки', type: 'text', weight: 1.6 },
            { key: 'result', title: 'Результат', type: 'text', weight: 2 },
          ],
          rows: stageRows,
          highlight: (r) => String(r.result).includes('дольше нормы') || String(r.result).includes('восстановленная'),
          empty: 'Стадий нет',
          note: 'Минуты — рабочее время смен на стадии (ночь и выходные не считаются). Норма — по операциям поста из конфигурации завода.',
        },
      },
      {
        kind: 'table',
        table: {
          title: 'Несоответствия и решения',
          columns: [
            { key: 'at', title: 'Когда', type: 'datetime', weight: 1.3 },
            { key: 'checkpoint', title: 'Контрольная точка', type: 'text', weight: 1.8 },
            { key: 'defect', title: 'Дефект', type: 'text', weight: 1.8 },
            { key: 'decision', title: 'Решение', type: 'text', weight: 1.3 },
            { key: 'source', title: 'Источник', type: 'text', weight: 1 },
          ],
          rows: passport.checks.map((c) => ({ at: Date.parse(c.at), checkpoint: c.checkpoint, defect: c.defect, decision: c.decision, source: SOURCE_RU(c.source) })),
          empty: 'Несоответствий нет',
        },
      },
      {
        kind: 'table',
        table: {
          title: 'Петли перекраски и выборочный контроль',
          columns: [
            { key: 'stage', title: 'Участок', type: 'text', weight: 1 },
            { key: 'what', title: 'Что', type: 'text', weight: 3 },
            { key: 'from', title: 'Начало', type: 'datetime', weight: 1.3 },
            { key: 'to', title: 'Конец', type: 'datetime', weight: 1.3 },
          ],
          rows: branchRows,
          empty: 'Повторных проходов и выборочного контроля не было',
        },
      },
      {
        kind: 'table',
        table: {
          title: 'Восстановленные отметки',
          columns: [
            { key: 'at', title: 'Время', type: 'datetime', weight: 1.3 },
            { key: 'text', title: 'Отметка', type: 'text', weight: 4 },
            { key: 'source', title: 'Источник', type: 'text', weight: 1.2 },
          ],
          rows: restoredAll.map((h) => ({ at: Date.parse(h.at), text: h.text, source: SOURCE_RU(h.source) })),
          empty: 'Все отметки получены от систем цеха',
          note: 'Отметка восстановлена двойником по соседним отметкам — на месте её не сканировали.',
        },
      },
      {
        kind: 'table',
        table: {
          title: 'Условия в момент прохода',
          columns: [
            { key: 'at', title: 'Время', type: 'datetime', weight: 1.3 },
            { key: 'post', title: 'Отметка', type: 'text', weight: 2.2 },
            { key: 'conditions', title: 'Условия (контроллер)', type: 'text', weight: 3.5 },
          ],
          rows: passport.steps
            .filter((x) => x.conditions.length > 0)
            .map((x) => ({ at: Date.parse(x.at), post: x.postName, conditions: x.conditions.map((c) => `${c.label}: ${c.value}`).join('; ') })),
          empty: passport.plcConnected ? 'Особых условий при проходе не было' : 'Контроллеры не подключены — условий в момент прохода нет',
        },
      },
    ],
  };
}
