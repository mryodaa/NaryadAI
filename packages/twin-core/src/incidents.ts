// Инциденты: первый сигнал открывает, следующие подтверждают и уточняют причину.
// Каждый инцидент — история из четырёх блоков: что случилось, почему, чем грозит, что делать.
// Варианты решений прогоняются через простую модель линии до конца смены — в машинах и тенге.
// Участки, буферы, камеры и конвейеры — из конфигурации завода.
import {
  KITS,
  MODELS,
  MODEL_BY_ID,
  addDays,
  currentOrNextShift,
  dedicatedStation,
  inflect,
  plantMs,
  plantParts,
  shiftAt,
  toPlantIso,
  type AreaId,
  type BufferId,
  type Explain,
  type ExplainInput,
  type PlantEquipment,
  type SourceId,
  type Tone,
  type WorkOrder,
} from '@allur/contracts';
import type { TwinConfig } from './config';
import type { TwinState } from './state';
import { bufferCapacity, bufferCounts, type AreaEval, type Signal } from './status';
import { filterForecast, lastFilterReplacement, paintFilterCause, qualityAlarm, qualityWindow, typicalFilterLifeHours, type FilterCause } from './quality';
import { driveEquipment, filterBooths, outputStage, qualityStages, serviceInterval, stageShort } from './plant';
import { bodies, capitalize, cars, ddmm, hm, minutes, money, num, num1, pct1, plural } from './text';

export type IncidentType = 'quality' | 'stop' | 'equipment' | 'stock' | 'early_warning';

export interface IncidentOption {
  id: string;
  title: string;
  detail: string;
  carsLost: number;
  repaints: number;
  directCost: number;
  totalCost: number;
  risk: 'низкий' | 'средний' | 'высокий';
  riskText: string;
  recommended: boolean;
  workOrder: Pick<WorkOrder, 'action' | 'area' | 'equipmentId' | 'title' | 'scheduledAt' | 'durationMin' | 'params'> | null;
}

export interface IncidentChart {
  kind: 'filter';
  threshold: number;
  norm: number;
  limit: number;
  dp: { t: number; v: number }[];
  defects: { t: number; dp: number }[];
}

export interface Incident {
  id: string;
  key: string;
  type: IncidentType;
  area: AreaId;
  equipmentId?: string;
  tone: Tone;
  openedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  status: 'open' | 'decided' | 'resolved';
  title: string;
  impactText: string;
  impactCars: number;
  happened: { text: string; at: number };
  why: { text: string; chain: ExplainInput[]; chart: IncidentChart | null };
  threat: { text: string; carsLost: number; repaints: number; money: number };
  options: IncidentOption[];
  explain: Explain;
  signals: Signal[];
  decision: { optionId: string; decidedAt: number; decidedBy?: string; workOrderId: string; title: string } | null;
}

type Draft = Omit<Incident, 'id' | 'openedAt' | 'updatedAt' | 'resolvedAt' | 'status' | 'decision'> & { since: number };

export interface DetectContext {
  state: TwinState;
  now: number;
  cfg: TwinConfig;
  evals: Record<string, AreaEval>;
  /** Тренд буферов, кузовов в час (из наблюдений двойника) */
  bufferTrend: Record<BufferId, number>;
}

// ---------------------------------------------------------------------------
// Простая модель линии для вариантов решений

function predictedBuffer(ctx: DetectContext, id: BufferId, at: number): number {
  const counts = bufferCounts(ctx.state);
  const hours = Math.max(0, (at - ctx.now) / 3600_000);
  return Math.max(0, Math.min(bufferCapacity(ctx.state, id), (counts[id] ?? 0) + (ctx.bufferTrend[id] ?? 0) * hours));
}

/**
 * Сколько машин не выпустим, если участок остановится в момент at на minutes минут. Выпуск считается
 * по сборке: остановку выше по потоку гасят буферы до сборки, ниже — свободное место в буферах после неё.
 * share — какую долю мощности теряет участок (встала одна из N параллельных станций).
 */
export function projectedStopLoss(ctx: DetectContext, area: AreaId, at: number, mins: number, share = 1): number {
  const plant = ctx.state.plant;
  const takt = ctx.cfg.taktMin;
  const stage = plant.stageById.get(area);
  const out = outputStage(plant);
  if (!stage || !stage.producing || !out) return 0;
  const idx = (id: string) => plant.stageById.get(id)?.index ?? -1;
  let absorb = 0;
  if (stage.index < out.index) {
    let queued = 0;
    for (const b of plant.buffers) if (idx(b.from) >= stage.index && idx(b.to) <= out.index) queued += predictedBuffer(ctx, b.id, at);
    absorb = queued * takt;
  } else if (stage.index > out.index) {
    let free = 0;
    for (const b of plant.buffers) if (idx(b.from) >= out.index && idx(b.to) <= stage.index) free += bufferCapacity(ctx.state, b.id) - predictedBuffer(ctx, b.id, at);
    absorb = free * takt + 20;
  }
  return Math.max(0, Math.round((mins * share - absorb) / takt));
}

function totalCost(ctx: DetectContext, o: Pick<IncidentOption, 'carsLost' | 'repaints' | 'directCost'>): number {
  const m = ctx.cfg.money;
  return o.carsLost * m.carMargin + o.repaints * m.repaintCost + o.directCost;
}

function finalizeOptions(ctx: DetectContext, opts: Omit<IncidentOption, 'totalCost' | 'recommended'>[], prefer?: string): IncidentOption[] {
  const withCost = opts.map((o) => ({ ...o, totalCost: totalCost(ctx, o), recommended: false }));
  const rank = (o: IncidentOption) => o.totalCost + (o.risk === 'высокий' ? 2 : o.risk === 'средний' ? 0.5 : 0) * ctx.cfg.money.carMargin;
  const best = prefer ? withCost.find((o) => o.id === prefer) : [...withCost].sort((a, b) => rank(a) - rank(b))[0];
  if (best) best.recommended = true;
  return withCost;
}

function shiftEndOf(now: number): number {
  return (shiftAt(now) ?? currentOrNextShift(now)).endMs;
}

/** Камера, к которой относится брак окраски: где нашлась причина, иначе — где меняли фильтр, иначе первая */
function paintBooth(ctx: DetectContext, area: AreaId, cause: FilterCause | null): PlantEquipment | undefined {
  const booths = filterBooths(ctx.state.plant, area);
  const id = cause?.equipmentId ?? lastFilterReplacement(ctx.state, ctx.now, area)?.equipmentId;
  return booths.find((b) => b.id === id) ?? booths[0];
}

// ---------------------------------------------------------------------------
// Детекторы

function detectQuality(ctx: DetectContext, area: AreaId, isOpen: boolean): Draft | null {
  const { state, now, cfg } = ctx;
  const areaShort = (a: AreaId) => stageShort(state.plant, a);
  const stage = state.plant.stageById.get(area);
  const qa = qualityAlarm(state, area, now, cfg, isOpen);
  if (!qa.alarm) return null;
  const win = qa.window;
  const prev = qualityWindow(state, area, now - 2 * cfg.qualityWindowMin * 60_000, now - cfg.qualityWindowMin * 60_000);
  const rising = win.share > prev.share * 1.15;
  const since = win.firstDefectTs ?? now;
  const top = win.top[0];

  const chain: ExplainInput[] = [
    { label: '1С:QLS — несоответствия за 2 часа', value: `${num(win.defects)} из ${num(win.inspected)} проверенных кузовов (${pct1(win.share)})`, source: 'qls' },
    { label: 'Норма брака', value: `не выше ${pct1(cfg.defectNorm)}` },
  ];
  if (top) chain.push({ label: 'Главный дефект', value: `${top.name} — ${top.count}`, source: 'qls' });

  let whyText = `Доля брака на участке за последние 2 часа — ${pct1(win.share)} при норме ${pct1(cfg.defectNorm)}.`;
  let chart: IncidentChart | null = null;
  let options: IncidentOption[];
  let threatText: string;
  let carsLost = 0;
  let repaints = 0;
  let equipmentId: string | undefined;
  let reasonShort = `брак ${pct1(win.share)}`;
  const signals: Signal[] = [{ source: 'qls', ts: now, text: `1С:QLS: ${num(win.defects)} ${plural(win.defects, ['несоответствие', 'несоответствия', 'несоответствий'])} за 2 часа (${pct1(win.share)})` }];

  const cause: FilterCause | null = stage?.kind === 'painting' ? paintFilterCause(state, now, cfg, undefined, area) : null;
  const booth = stage?.kind === 'painting' ? paintBooth(ctx, area, cause) : undefined;
  const after = stage?.bufferAfter?.id;
  if (booth) {
    equipmentId = booth.id;
    const gen = inflect(booth.name, 'gen');
    const acc = inflect(booth.name, 'acc');
    const fc = filterForecast(state, now, cfg, booth.id);
    const rate = cause ? Math.max(cause.rateAbove, win.share) : win.share;
    const shiftEnd = shiftEndOf(now);
    if (cause) {
      const below = cause.defectsTotal - cause.defectsAbove;
      whyText =
        below === 0
          ? `${cause.sentence}. Ниже порога — ни одного случая на ${bodies(cause.bodiesBelow)}, выше — ${pct1(cause.rateAbove)} брака.`
          : `${cause.sentence}. Выше порога сорность встречается в ${num1(cause.lift)} раза чаще (${pct1(cause.rateAbove)} против ${pct1(cause.rateBelow)}).`;
      chain.push(
        { label: `Контроллер ${gen} — перепад давления на фильтре сейчас`, value: `${num(cause.dpNow ?? fc?.dpNow ?? 0)} Па (норма до ${cfg.filter.normPa}, предел ${cfg.filter.limitPa})`, source: 'plc' },
        { label: '1С:MES — маршрут кузовов', value: `${num(cause.bodiesAbove + cause.bodiesBelow)} кузовов прошли ${acc} за 8 часов`, source: 'mes' },
        { label: 'Сравнение по VIN', value: `выше ${cause.threshold} Па: ${cause.defectsAbove} брака на ${cause.bodiesAbove} кузовов; ниже: ${cause.defectsTotal - cause.defectsAbove} на ${cause.bodiesBelow}`, source: 'qls' },
      );
      signals.push({ source: 'plc', ts: now, equipmentId: booth.id, text: `Контроллер ${gen}: перепад на фильтре ${num(cause.dpNow ?? 0)} Па` });
      reasonShort = `${booth.name}: фильтр забит`;
      const s = state.series(booth.id, 'filter_dp_pa');
      const dp: { t: number; v: number }[] = [];
      if (s) for (let i = 0; i < s.ts.length; i++) if (s.ts[i]! >= now - 8 * 3600_000 && s.ts[i]! <= now) dp.push({ t: s.ts[i]!, v: s.v[i]! });
      chart = {
        kind: 'filter',
        threshold: cause.threshold,
        norm: cfg.filter.normPa,
        limit: cfg.filter.limitPa,
        dp: thin(dp, 120),
        defects: cause.points.filter((p) => p.defect).map((p) => ({ t: p.ts, dp: p.dp })),
      };
    } else if (!state.plcConnected(now)) {
      const last = lastFilterReplacement(state, now, area);
      if (last) {
        const life = typicalFilterLifeHours(state, last.equipmentId);
        const lastGen = inflect(state.plant.equipmentById.get(last.equipmentId)?.name ?? booth.name, 'gen');
        const hoursSince = workHoursBetween(last.at, now);
        whyText = `Перепад на фильтре не виден (контроллеры не подключены). По журналу 1С:MES фильтр ${lastGen} меняли ${num1(hoursSince)} ч работы назад, обычно его хватает на ~${num(life)} ч. Сорность — типичный признак засорённого фильтра.`;
        chain.push({ label: `1С:MES — последняя замена фильтра ${lastGen}`, value: `${ddmm(last.at)} в ${hm(last.at)}, ${num1(hoursSince)} ч работы назад`, source: 'mes' });
        reasonShort = `вероятно, фильтр ${lastGen}`;
      }
    }

    const limitAt = fc?.limitAt ?? null;
    if (limitAt !== null) {
      const bodiesToLimit = Math.max(0, (limitAt - now) / (cfg.taktMin * 60_000));
      carsLost = projectedStopLoss(ctx, area, limitAt, cfg.filter.forcedMin);
      repaints = Math.round(bodiesToLimit * rate);
      const hoursTo = (limitAt - now) / 3600_000;
      threatText = `Через ~${num1(hoursTo)} ч (около ${hm(limitAt)}) фильтр выйдет на предел ${cfg.filter.limitPa} Па — вынужденная остановка ~${cfg.filter.forcedMin} мин: около ${cars(carsLost)} не выпустим и около ${bodies(repaints)} уйдут на повторную окраску.`;
      chain.push({ label: 'Прогноз перепада', value: `рост ${num(fc!.ratePerHour)} Па/ч, предел около ${hm(limitAt)} (${fc!.method})`, source: 'plc' });
      const opts: Omit<IncidentOption, 'totalCost' | 'recommended'>[] = [];
      if (limitAt > shiftEnd + 5 * 60_000 && shiftEnd - now > 10 * 60_000) {
        const bodiesTo = (shiftEnd - now) / (cfg.taktMin * 60_000);
        opts.push({
          id: 'replace_at_shift_change',
          title: `Заменить фильтр в пересменку, в ${hm(shiftEnd)}`,
          detail: `Замена по графику ~${cfg.filter.plannedMin} мин, бригада и фильтр готовятся заранее. Буфер перед сборкой к ${hm(shiftEnd)} — около ${bodies(Math.round(after ? predictedBuffer(ctx, after, shiftEnd) : 0))} (~${Math.round((after ? predictedBuffer(ctx, after, shiftEnd) : 0) * cfg.taktMin)} мин работы сборки).`,
          carsLost: projectedStopLoss(ctx, area, shiftEnd, cfg.filter.plannedMin),
          repaints: Math.round(bodiesTo * rate),
          directCost: cfg.money.filterReplacement,
          risk: 'низкий',
          riskText: `Запас до предела — ${minutes((limitAt - shiftEnd) / 60_000)}`,
          workOrder: {
            action: 'replace_filter',
            area,
            equipmentId: booth.id,
            title: `Заменить фильтр ${gen} в пересменку (${hm(shiftEnd)})`,
            scheduledAt: toPlantIso(shiftEnd),
            durationMin: cfg.filter.plannedMin,
          },
        });
      }
      const nowAt = now + 10 * 60_000;
      opts.push({
        id: 'replace_now',
        title: 'Заменить фильтр сейчас',
        detail: `Остановить ${acc} через 10 минут на ~${cfg.filter.plannedMin} мин. Брак прекратится сразу; буфер перед сборкой сейчас — ${bodies(Math.round(after ? predictedBuffer(ctx, after, nowAt) : 0))} (~${Math.round((after ? predictedBuffer(ctx, after, nowAt) : 0) * cfg.taktMin)} мин).`,
        carsLost: projectedStopLoss(ctx, area, nowAt, cfg.filter.plannedMin),
        repaints: Math.round(((nowAt - now) / (cfg.taktMin * 60_000)) * rate),
        directCost: cfg.money.filterReplacement,
        risk: 'низкий',
        riskText: 'Остановка посреди смены',
        workOrder: { action: 'replace_filter', area, equipmentId: booth.id, title: `Заменить фильтр ${gen} сейчас`, scheduledAt: toPlantIso(nowAt), durationMin: cfg.filter.plannedMin },
      });
      opts.push({
        id: 'do_nothing',
        title: 'Ничего не делать',
        detail: `Фильтр выйдет на предел около ${hm(limitAt)}, камера встанет на вынужденную замену ~${cfg.filter.forcedMin} мин.`,
        carsLost,
        repaints,
        directCost: cfg.money.filterReplacement,
        risk: 'высокий',
        riskText: 'Остановка в непредсказуемый момент, растёт перекраска',
        workOrder: null,
      });
      options = finalizeOptions(ctx, opts);
    } else {
      threatText = `Если брак останется на уровне ${pct1(win.share)}, до конца смены около ${bodies(Math.round(((shiftEnd - now) / (cfg.taktMin * 60_000)) * win.share))} уйдут на повторную окраску.`;
      repaints = Math.round(((shiftEnd - now) / (cfg.taktMin * 60_000)) * win.share);
      options = genericQualityOptions(ctx, area, repaints);
    }
  } else {
    const shiftEnd = shiftEndOf(now);
    repaints = Math.round(((shiftEnd - now) / (cfg.taktMin * 60_000)) * win.share);
    threatText = `Если доля брака сохранится, до конца смены около ${bodies(repaints)} потребуют доработки.`;
    options = genericQualityOptions(ctx, area, repaints);
  }

  const noAction = options.find((o) => o.id === 'do_nothing');
  const impactCars = Math.max(carsLost, noAction?.carsLost ?? 0) + repaints * 0.3;
  const moneyLost = carsLost * cfg.money.carMargin + repaints * cfg.money.repaintCost;
  return {
    key: `quality:${area}`,
    type: 'quality',
    area,
    equipmentId,
    tone: 'attention',
    title: `${areaShort(area)}: брак ${pct1(win.share)}${rising ? ' и растёт' : ''}`,
    impactText: carsLost > 0 ? `−${cars(carsLost)} и ${bodies(repaints)} на перекраску` : `${bodies(repaints)} на доработку до конца смены`,
    impactCars,
    happened: { text: `${areaShort(area)}: брак вырос до ${pct1(win.share)} за последние 2 часа (норма ${pct1(cfg.defectNorm)})`, at: now },
    why: { text: whyText, chain, chart },
    threat: { text: `${threatText} Потери ≈ ${money(moneyLost)}.`, carsLost, repaints, money: moneyLost },
    options,
    explain: {
      rule: booth
        ? `Для каждого кузова с сорностью берём перепад давления на фильтре ${inflect(booth.name, 'gen')} в момент его прохода (по VIN из 1С:MES и времени из контроллера). Сравниваем долю брака выше и ниже порога. Срок до предела — экспоненциальный тренд перепада за последние 90 минут.`
        : `Доля несоответствий 1С:QLS по кузовам, прошедшим участок за 2 часа, выше нормы ${pct1(cfg.defectNorm)}.`,
      inputs: chain,
      sources: booth ? ['qls', 'mes', 'plc'] : ['qls', 'mes'],
      conclusion: whyText,
      assumptions: [
        `Норма перепада — до ${cfg.filter.normPa} Па, предел — ${cfg.filter.limitPa} Па, вынужденная замена ~${cfg.filter.forcedMin} мин, плановая ~${cfg.filter.plannedMin} мин.`,
        'Остановка окраски бьёт по выпуску, когда кончается буфер перед сборкой (оценка по текущему уровню и тренду буфера).',
        'Суммы условные, уточняются с заводом.',
        'На старте закономерности ищутся правилами и статистикой; модели машинного обучения дообучаются на истории завода в ходе пилота.',
      ],
    },
    signals,
    since,
  };
  void reasonShort;
}

function genericQualityOptions(ctx: DetectContext, area: AreaId, repaints: number): IncidentOption[] {
  const { cfg, now } = ctx;
  const areaShort = (a: AreaId) => stageShort(ctx.state.plant, a);
  const shiftEnd = shiftEndOf(now);
  return finalizeOptions(ctx, [
    {
      id: 'inspect_at_shift_change',
      title: `Проверить оборудование участка в пересменку, в ${hm(shiftEnd)}`,
      detail: 'Наладчик проверяет посты и оснастку 20 минут, пока буфер кормит следующий участок.',
      carsLost: projectedStopLoss(ctx, area, shiftEnd, 20),
      repaints: Math.round(repaints * 0.8),
      directCost: 60_000,
      risk: 'низкий',
      riskText: 'Брак продолжится до пересменки',
      workOrder: { action: 'inspect', area, title: `Проверка оборудования участка «${areaShort(area)}»`, scheduledAt: toPlantIso(shiftEnd), durationMin: 20 },
    },
    {
      id: 'full_control',
      title: 'Усилить контроль: проверять каждый кузов на посту',
      detail: 'Без остановки линии, но нужен дополнительный контролёр.',
      carsLost: 0,
      repaints: Math.round(repaints * 0.6),
      directCost: 90_000,
      risk: 'средний',
      riskText: 'Причина не устранена',
      workOrder: null,
    },
    {
      id: 'do_nothing',
      title: 'Ничего не делать',
      detail: 'Брак остаётся на текущем уровне.',
      carsLost: 0,
      repaints,
      directCost: 0,
      risk: 'средний',
      riskText: 'Перекраска и доработка растут',
      workOrder: null,
    },
  ]);
  void cfg;
}

const TYPICAL_STOP_MIN: [RegExp, number][] = [
  [/цеп/i, 55],
  [/датчик/i, 25],
  [/фильтр/i, 40],
  [/комплект|детал/i, 60],
  [/насос/i, 15],
  [/дозиров/i, 20],
];

function detectStop(ctx: DetectContext, area: AreaId): Draft | null {
  const ev = ctx.evals[area];
  if (!ev || !(ev.status === 'fault' || ev.status === 'maintenance' || ev.status === 'reduced' || (ev.status === 'starved' && ev.reason?.startsWith('Нет комплектов')))) return null;
  if ((ev.status === 'maintenance' || ev.status === 'reduced') && /план|наряд/i.test(ev.reason ?? '')) return null;
  const { cfg, now } = ctx;
  const areaShort = (a: AreaId) => stageShort(ctx.state.plant, a);
  const reduced = ev.status === 'reduced' && ev.stations ? ev.stations : null;
  const share = reduced ? 1 - reduced.working / reduced.total : 1;
  const since = ev.since ?? now;
  const elapsed = (now - since) / 60_000;
  const reason = ev.reason ?? 'остановка';
  const typical = TYPICAL_STOP_MIN.find(([re]) => re.test(reason))?.[1] ?? 30;
  const remaining = Math.max(5, typical - elapsed);
  const loss = projectedStopLoss(ctx, area, now, remaining, share);
  const shiftEnd = shiftEndOf(now);
  const overtimeRecover = Math.min(loss, Math.round(60 / cfg.taktMin));
  const eqId = ev.causeEquipment;
  const signals = ev.signals;
  const hasPlc = signals.some((s) => s.source === 'plc');
  const chain: ExplainInput[] = signals.map((s) => ({ label: s.text, value: hm(s.ts), source: s.source === 'twin' ? undefined : s.source, at: toPlantIso(s.ts) }));
  const options = finalizeOptions(ctx, [
    {
      id: 'repair_now',
      title: 'Срочный ремонт дежурной бригадой',
      detail: `Обычно такой ремонт занимает ~${typical} мин; ещё примерно ${minutes(remaining)}.`,
      carsLost: loss,
      repaints: 0,
      directCost: 40_000,
      risk: 'средний',
      riskText: 'Срок зависит от запчастей',
      workOrder: eqId ? { action: 'repair', area, equipmentId: eqId, title: `Ремонт: ${reason}`, scheduledAt: toPlantIso(now), durationMin: 0 } : null,
    },
    {
      id: 'repair_and_overtime',
      title: `Ремонт и час сверхурочно после ${hm(shiftEnd)}`,
      detail: `Отрабатываем потерю в конце смены: вернём около ${cars(overtimeRecover)}.`,
      carsLost: Math.max(0, loss - overtimeRecover),
      repaints: 0,
      directCost: 40_000 + cfg.money.overtimeHour,
      risk: 'низкий',
      riskText: 'Нужно согласие смены на переработку',
      workOrder: null,
    },
  ]);
  return {
    key: `stop:${area}:${Math.round(since / 60_000)}`,
    type: 'stop',
    area,
    equipmentId: eqId,
    tone: reduced ? 'attention' : ev.status === 'maintenance' ? 'maintenance' : ev.status === 'starved' ? 'waiting' : 'fault',
    title: reduced ? `${areaShort(area)}: снижена мощность — ${reason.toLowerCase()}` : `${areaShort(area)} стоит: ${reason.toLowerCase()}`,
    impactText: loss > 0 ? `−${cars(loss)} к концу смены` : reduced ? 'остальные станции и буфер пока перекрывают потерю' : 'буфер пока перекрывает остановку',
    impactCars: loss,
    happened: { text: reduced ? `${areaShort(area)}: с ${hm(since)} ${reason.toLowerCase()}` : `${areaShort(area)}: остановка с ${hm(since)} — ${reason.toLowerCase()}`, at: since },
    why: {
      text: hasPlc
        ? 'Контроллер сообщил о состоянии оборудования сразу — причина и код известны.'
        : 'Контроллеры не подключены: остановку видно по отсутствию прохода VIN в 1С:MES дольше 3 тактов. Причину уточнит запись мастера.',
      chain,
      chart: null,
    },
    threat: {
      text: `Если ремонт займёт обычные ~${typical} мин, до конца смены не выпустим около ${cars(loss)}. Потери ≈ ${money(loss * cfg.money.carMargin)}.`,
      carsLost: loss,
      repaints: 0,
      money: loss * cfg.money.carMargin,
    },
    options,
    explain: {
      rule: ev.rule,
      inputs: chain,
      sources: [...new Set(signals.map((s) => s.source).filter((s): s is SourceId => s !== 'twin'))],
      conclusion: `${areaShort(area)}: ${AREA_STATUS_WORD[ev.status]}`,
      assumptions: ['Длительность ремонта — типичная по истории похожих остановок.', 'Остановка участка бьёт по выпуску, когда кончается буфер после него.'],
    },
    signals,
    since,
  };
}

const AREA_STATUS_WORD: Record<string, string> = {
  reduced: 'снижена мощность',
  fault: 'авария',
  maintenance: 'обслуживание',
  starved: 'ждёт кузов',
  blocked: 'заблокирован',
};

/** Наработка робота: по контроллеру, а без него — по числу кузовов из 1С:MES с последнего ТО */
export function robotCycles(state: TwinState, id: string, now: number): { cycles: number; source: SourceId; since?: number } | null {
  const s = state.eq[id];
  const eq = state.plant.equipmentById.get(id);
  const stage = eq ? state.plant.stageById.get(eq.stageId) : undefined;
  const station = stage?.stations.find((st) => st.id === eq?.stationId);
  const stations = Math.max(1, stage?.stations.length ?? 1);
  if (s?.cycles !== null && s?.cycles !== undefined && s.cyclesTs !== null && now - s.cyclesTs < 6 * 3600_000) return { cycles: s.cycles, source: 'plc' };
  let lastService: number | null = null;
  for (const d of state.downtimes.values()) {
    if (d.equipmentId !== id || d.category !== 'planned') continue;
    const end = d.to ?? d.from;
    if (end <= now && (lastService === null || end > lastService)) lastService = end;
  }
  if (lastService === null) return null;
  let cycles = 0;
  const serviceDate = plantParts(lastService).date;
  for (const r of state.reports.values()) {
    if (r.area !== eq?.stageId) continue;
    const shiftStart = plantMs(r.date, r.shift === 2 ? 16 * 60 : 8 * 60);
    if (shiftStart >= lastService && r.date >= serviceDate && shiftStart < state.runStartMs) cycles += stations > 1 ? Math.round(r.fact / stations) : r.fact;
  }
  // без контроллера — кузова, отмеченные на станции робота (или на выходе участка, если станцию не отмечают)
  const seen = new Set<string>();
  const onStation = (p: (typeof state.passes)[number]) => (p.kind === 'mark' && p.equipmentId !== undefined && station?.equipment.some((e) => e.id === p.equipmentId)) || (p.kind === 'exit' && p.area === eq?.stageId);
  const byStation = state.passes.some((p) => p.kind === 'mark' && p.equipmentId === id);
  for (const p of state.passes) {
    if (p.ts < Math.max(lastService, state.runStartMs) || p.ts > now || seen.has(p.vin)) continue;
    if (byStation ? p.kind === 'mark' && p.equipmentId === id : onStation(p) && p.kind === 'exit' && (!station?.models || station.models.includes(p.model))) {
      seen.add(p.vin);
      cycles++;
    }
  }
  return { cycles, source: 'mes', since: lastService };
}

function detectEquipment(ctx: DetectContext, id: string): Draft | null {
  const { state, now, cfg } = ctx;
  const interval = serviceInterval(state.plant, id);
  if (!interval) return null;
  const eq = state.plant.equipmentById.get(id)!;
  const area = eq.stageId;
  const stage = state.plant.stageById.get(area);
  const station = stage?.stations.find((st) => st.id === eq.stationId);
  // линия под модели: робот видит только кузова своих моделей, её простой стоит долю этих моделей
  const modelShare = station?.models ? station.models.reduce((a, m) => a + shareOf(state, m), 0) : 1;
  const share = station?.models ? modelShare : eq.place === 'station' && stage && stage.stations.length > 1 ? 1 / stage.stations.length : 1;
  const c = robotCycles(state, id, now);
  if (!c) return null;
  const ratio = c.cycles / interval;
  if (ratio < 0.9) return null;
  const errors24h = state.autoStops.filter((a) => a.equipmentId === id && a.from > now - 24 * 3600_000 && a.status === 'fault').length;
  const level: IncidentOption['risk'] = ratio >= 0.97 || errors24h >= 2 ? 'высокий' : ratio >= 0.93 ? 'средний' : 'низкий';
  const left = Math.max(0, interval - c.cycles);
  const name = eq.name;
  const nightDate = addDays(plantParts(now).date, 1);
  const nightAt = plantMs(nightDate, 30);
  const pFail = level === 'высокий' ? 0.35 : level === 'средний' ? 0.15 : 0.05;
  const failLoss = projectedStopLoss(ctx, area, now + 2 * 3600_000, 25, share);
  const expected = Math.round(pFail * failLoss * 10) / 10;
  const chain: ExplainInput[] = [
    {
      label: c.source === 'plc' ? `Контроллер ${name} — циклов с последнего ТО` : `1С:MES — кузовов через пост с последнего ТО (${c.since ? ddmm(c.since) : '?'})`,
      value: `${num(c.cycles)} из ${num(interval)}`,
      source: c.source,
    },
    { label: 'Межсервисный интервал', value: `${num(interval)} циклов` },
    { label: 'Ошибки контроллера за сутки', value: state.plcConnected(now) ? String(errors24h) : 'нет данных (контроллеры не подключены)', source: 'plc' },
  ];
  const options = finalizeOptions(
    ctx,
    [
      {
        id: 'service_tonight',
        title: `ТО в ночь на ${ddmm(nightAt)}, 00:30–01:00`,
        detail: 'Ночью линия не работает — выпуск не теряем.',
        carsLost: 0,
        repaints: 0,
        directCost: cfg.money.robotService,
        risk: level === 'высокий' ? 'средний' : 'низкий',
        riskText: `До ночи робот сделает ещё ~${num(Math.round(((plantMs(nightDate, 0) - now) / 3600_000) * 15 * modelShare * (16 / 24)))} циклов`,
        workOrder: { action: 'maintenance', area, equipmentId: id, title: `Плановое ТО ${name} ночью`, scheduledAt: toPlantIso(nightAt), durationMin: 30 },
      },
      {
        id: 'service_now',
        title: 'ТО сейчас, 30 минут',
        detail: `Риск снимается сразу, но ${share < 1 ? 'станция' : (stage?.short ?? 'участок').toLowerCase()} встанет посреди смены.`,
        carsLost: projectedStopLoss(ctx, area, now + 10 * 60_000, 30, share),
        repaints: 0,
        directCost: cfg.money.robotService,
        risk: 'низкий',
        riskText: 'Потеря выпуска, если буферы малы',
        workOrder: { action: 'maintenance', area, equipmentId: id, title: `Плановое ТО ${name} сейчас`, scheduledAt: toPlantIso(now + 10 * 60_000), durationMin: 30 },
      },
      {
        id: 'postpone',
        title: 'Отложить до следующего планового окна',
        detail: `Вероятность отказа в смену — около ${Math.round(pFail * 100)}%${failLoss > 0 ? `, отказ обойдётся примерно в ${cars(failLoss)}` : ''}.`,
        carsLost: expected,
        repaints: 0,
        directCost: 0,
        risk: level,
        riskText: 'Отказ в непредсказуемый момент',
        workOrder: null,
      },
    ],
    'service_tonight',
  );
  return {
    key: `equipment:${id}`,
    type: 'equipment',
    area,
    equipmentId: id,
    tone: 'maintenance',
    title: `${name}: ресурс до ТО ${Math.max(0, Math.round((1 - ratio) * 100))}%`,
    impactText: `Риск остановки за 24 ч — ${level}`,
    impactCars: expected + (level === 'высокий' ? 1 : 0),
    happened: { text: `${name} выработал ${Math.round(ratio * 100)}% межсервисного интервала — осталось ${num(left)} циклов`, at: now },
    why: {
      text:
        c.source === 'plc'
          ? `Контроллер сообщает ${num(c.cycles)} циклов с последнего ТО из ${num(interval)}. К концу интервала растёт риск отказа.`
          : `Наработка посчитана по числу кузовов, прошедших пост (данные 1С:MES), с последнего ТО ${c.since ? ddmm(c.since) : ''}: ${num(c.cycles)} из ${num(interval)}.`,
      chain,
      chart: null,
    },
    threat: {
      text: `Если отложить, вероятность отказа в смену — около ${Math.round(pFail * 100)}%; отказ — это ~25 мин внепланового ремонта${failLoss > 0 ? ` и около ${cars(failLoss)}` : ', буферы, скорее всего, перекроют остановку'}.`,
      carsLost: expected,
      repaints: 0,
      money: expected * cfg.money.carMargin,
    },
    options,
    explain: {
      rule: 'Наработка в циклах с последнего ТО относительно межсервисного интервала, плюс коды ошибок контроллера за сутки (если подключён). Итог: низкий / средний / высокий.',
      inputs: chain,
      sources: [c.source],
      conclusion: `Риск остановки за 24 ч — ${level}. ТО лучше провести ночью ${ddmm(nightAt)}.`,
      assumptions: ['Межсервисный интервал роботов — 6000 циклов.', 'На старте риск считается правилами; модель отказов дообучается на истории ремонтов в ходе пилота.'],
    },
    signals: [{ source: c.source, ts: now, equipmentId: id, text: `${c.source === 'plc' ? 'Контроллер' : '1С:MES'}: ${num(c.cycles)} циклов с последнего ТО` }],
    since: now,
  };
}

function detectStock(ctx: DetectContext, kitId: string): Draft | null {
  const { state, now, cfg } = ctx;
  const s = state.stock.get(kitId);
  if (!s || s.shiftsLeft >= 2) return null;
  const kit = KITS.find((k) => k.id === kitId)!;
  const model = MODEL_BY_ID[kit.model];
  const outAt = addWorkTime(now, s.shiftsLeft * 8 * 60);
  const shiftEnd = shiftEndOf(outAt);
  const lossMin = Math.min(8 * 60, Math.max(0, (shiftEnd - outAt) / 60_000));
  const firstLine = state.plant.production[0] ? dedicatedStation(state.plant.production[0], kit.model) : undefined;
  // встаёт только линия модели — теряем её долю тактов; иначе — весь выпуск
  const loss = Math.round((lossMin / cfg.taktMin) * (firstLine ? shareOf(state, kit.model) : 1));
  const today = plantParts(now).date === plantParts(outAt).date;
  // поставка может прийти раньше: если запас кончится не сегодня, ожидаемая потеря — треть
  const expectedLoss = today ? loss : Math.round(loss * 0.3);
  const when = today ? `около ${hm(outAt)}` : `${ddmm(outAt)} около ${hm(outAt)}`;
  const tomorrowNoon = plantMs(addDays(plantParts(now).date, 1), 12 * 60);
  const firstStage = state.plant.production[0];
  const warehouse = state.plant.warehouseIn?.id ?? 'warehouse';
  // машинокомплект выдают на сварку: без него встаёт линия модели (если она под эту модель)
  const line = firstStage ? dedicatedStation(firstStage, kit.model) : undefined;
  const stops = line ? `${line.name.toLowerCase().replace(/^линия/, 'сварочная линия')}` : `выпуск ${model.short}`;
  const others = MODELS.filter((m) => m.id !== kit.model).map((m) => m.short).join(' и ');
  const options = finalizeOptions(
    ctx,
    [
      {
        id: 'resequence',
        title: `Переставить очередь: ${model.short} — после поставки`,
        detail: `${firstStage?.short ?? 'Сварка'} запускает ${others} вместо ${model.short}; ${model.short} догоняем после прихода комплектов.`,
        carsLost: 0,
        repaints: 0,
        directCost: 0,
        risk: 'средний',
        riskText: `План по ${model.short} сдвигается на 1–2 дня`,
        workOrder: { action: 'resequence', area: firstStage?.id ?? 'weld', title: `Перестановка очереди: ${model.short} после поставки комплектов`, scheduledAt: toPlantIso(now), params: { model: kit.model, untilMs: tomorrowNoon } },
      },
      {
        id: 'express_delivery',
        title: 'Срочная доставка комплектов',
        detail: 'Заказать срочную поставку у поставщика.',
        carsLost: 0,
        repaints: 0,
        directCost: cfg.money.expressDelivery,
        risk: 'средний',
        riskText: 'Зависит от поставщика',
        workOrder: { action: 'expedite_parts', area: warehouse, title: `Срочная доставка: ${kit.name}`, scheduledAt: toPlantIso(now + 4 * 3600_000), params: { kitId } },
      },
      {
        id: 'do_nothing',
        title: 'Ничего не делать',
        detail: `Когда ${kit.name.toLowerCase()} закончатся (${when}), ${stops} встанет: машинокомплект ${model.short} не выдать.`,
        carsLost: expectedLoss,
        repaints: 0,
        directCost: 0,
        risk: 'высокий',
        riskText: line ? `Остановка линии ${model.short}` : `Остановка выпуска ${model.short}`,
        workOrder: null,
      },
    ],
    'resequence',
  );
  return {
    key: `stock:${kitId}`,
    type: 'stock',
    area: warehouse,
    tone: 'attention',
    title: `${model.short}: ${kit.name.replace(` ${model.short}`, '').toLowerCase()} на ${num1(s.shiftsLeft)} смены`,
    impactText: today ? `−${cars(loss)} сегодня, если не переставить очередь` : `закончатся ${when}`,
    impactCars: today ? loss * 0.6 : Math.min(3, loss * 0.05),
    happened: { text: `1С:WMS: ${kit.name.toLowerCase()} — ${num(s.qty)} шт., хватит на ${num1(s.shiftsLeft)} смены`, at: s.ts },
    why: {
      text: `Расход ${model.short} — около ${num(cfg.shiftPlan * shareOf(state, kit.model))} комплектов за смену по плану. Остатка хватит примерно до ${when.replace('около ', '')}.`,
      chain: [
        { label: '1С:WMS — остаток', value: `${num(s.qty)} шт. (${num1(s.shiftsLeft)} смены)`, source: 'wms', at: toPlantIso(s.ts) },
        { label: '1С:ERP — доля модели в плане', value: pct1(shareOf(state, kit.model)), source: 'erp' },
      ],
      chart: null,
    },
    threat: { text: `Если поставка не придёт раньше, ${stops} встанет ${when}: не выпустим около ${cars(loss)}.`, carsLost: expectedLoss, repaints: 0, money: expectedLoss * cfg.money.carMargin },
    options,
    explain: {
      rule: 'Остаток комплектов из 1С:WMS делим на плановый расход за смену (доля модели в плане × 120). Меньше двух смен — инцидент. Машинокомплект выдают на сварку целиком: без любой позиции линия модели не начнёт новый кузов.',
      inputs: [
        { label: 'Остаток', value: `${num(s.qty)} шт.`, source: 'wms' },
        { label: 'Расход за смену', value: `${num(cfg.shiftPlan * shareOf(state, kit.model))} шт.`, source: 'erp' },
      ],
      sources: ['wms', 'erp'],
      conclusion: `Хватит на ${num1(s.shiftsLeft)} смены`,
      assumptions: ['Время следующей поставки двойнику не известно — в реальном внедрении берётся из 1С:ERP/WMS.'],
    },
    signals: [{ source: 'wms', ts: s.ts, text: `1С:WMS: ${kit.name} — ${num(s.qty)} шт.` }],
    since: s.ts,
  };
}

function detectEarlyWarning(ctx: DetectContext, drive: PlantEquipment): Draft | null {
  const { state, now, cfg } = ctx;
  const id = drive.id;
  const area = drive.stageId;
  const gen = inflect(drive.name, 'gen');
  const cur = state.series(id, 'motor_current_a');
  const vib = state.series(id, 'vibration_mm_s');
  if (!cur || cur.ts.length < 20) return null;
  const recent = window(cur, now - 10 * 60_000, now).filter((v) => v > 5);
  const base = window(cur, now - 3 * 3600_000, now - 60 * 60_000).filter((v) => v > 5);
  if (recent.length < 5) return null;
  const baseline = base.length >= 10 ? median(base) : 18;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const vRecent = vib ? window(vib, now - 10 * 60_000, now).filter((v) => v > 0.5) : [];
  const vAvg = vRecent.length ? vRecent.reduce((a, b) => a + b, 0) / vRecent.length : 0;
  if (avg < baseline + 1.8 && vAvg < 3.3) return null;
  if (ctx.evals[area]?.status === 'fault') return null;
  const loss = projectedStopLoss(ctx, area, now + 40 * 60_000, 55);
  const inspectLoss = projectedStopLoss(ctx, area, now + 10 * 60_000, 20);
  const chain: ExplainInput[] = [
    { label: `Датчик тока привода ${gen}`, value: `${num1(avg)} А при обычных ${num1(baseline)} А`, source: 'plc' },
    { label: 'Датчик вибрации привода', value: vAvg ? `${num1(vAvg)} мм/с (обычно ~2,1)` : 'нет данных', source: 'plc' },
  ];
  return {
    key: `early:${id}`,
    type: 'early_warning',
    area,
    equipmentId: id,
    tone: 'attention',
    title: `${drive.name}: растёт ток привода`,
    impactText: `риск обрыва цепи — около ${cars(loss)}`,
    impactCars: loss * 0.6,
    happened: { text: `Ток привода ${gen} вырос до ${num1(avg)} А (обычно ${num1(baseline)} А), растёт вибрация`, at: now },
    why: {
      text: 'Так ведёт себя изношенная или перетянутая приводная цепь: нагрузка на двигатель растёт за 30–60 минут до обрыва. Эти датчики ставятся на ступени 2.',
      chain,
      chart: null,
    },
    threat: { text: `Если цепь оборвётся, сборка встанет примерно на 55 мин: около ${cars(loss)}. Потери ≈ ${money(loss * cfg.money.carMargin)}.`, carsLost: loss, repaints: 0, money: loss * cfg.money.carMargin },
    options: finalizeOptions(
      ctx,
      [
        {
          id: 'inspect_now',
          title: 'Остановить на осмотр цепи, 20 минут',
          detail: 'Подтянуть или заменить звенья до обрыва — короче и дешевле аварийного ремонта.',
          carsLost: inspectLoss,
          repaints: 0,
          directCost: 60_000,
          risk: 'низкий',
          riskText: 'Короткая плановая остановка',
          workOrder: { action: 'inspect', area, equipmentId: id, title: `Осмотр и замена звеньев цепи ${gen}`, scheduledAt: toPlantIso(now + 10 * 60_000), durationMin: 20 },
        },
        {
          id: 'do_nothing',
          title: 'Ничего не делать',
          detail: 'Ждать: возможно, ток стабилизируется.',
          carsLost: Math.round(loss * 0.7),
          repaints: 0,
          directCost: 0,
          risk: 'высокий',
          riskText: 'Обрыв в любой момент',
          workOrder: null,
        },
      ],
      'inspect_now',
    ),
    explain: {
      rule: 'Средний ток привода за 10 минут выше обычного более чем на 1,8 А или вибрация выше 3,3 мм/с — признак скорого обрыва цепи.',
      inputs: chain,
      sources: ['plc'],
      conclusion: 'Риск обрыва цепи в ближайший час — высокий',
      assumptions: ['Пороги заданы правилом; в пилоте уточняются по истории обрывов.'],
    },
    signals: [{ source: 'plc', ts: now, equipmentId: id, text: `Датчик тока привода: ${num1(avg)} А` }],
    since: now,
  };
}

// ---------------------------------------------------------------------------

export class IncidentBook {
  private byKey = new Map<string, Incident>();
  private seq = 0;

  reset() {
    this.byKey.clear();
    this.seq = 0;
  }

  all(): Incident[] {
    return [...this.byKey.values()];
  }

  get(id: string): Incident | undefined {
    return this.all().find((i) => i.id === id);
  }

  update(ctx: DetectContext) {
    const drafts: Draft[] = [];
    const isOpen = (key: string) => {
      const i = this.byKey.get(key);
      return !!i && i.status !== 'resolved';
    };
    const plant = ctx.state.plant;
    for (const stage of qualityStages(plant)) {
      const d = detectQuality(ctx, stage.id, isOpen(`quality:${stage.id}`));
      if (d) drafts.push(d);
    }
    for (const stage of plant.production) {
      const d = detectStop(ctx, stage.id);
      if (d) drafts.push(d);
    }
    for (const e of plant.equipment) {
      if (e.passive) continue;
      const d = detectEquipment(ctx, e.id);
      if (d) drafts.push(d);
    }
    for (const k of KITS) {
      const d = detectStock(ctx, k.id);
      if (d) drafts.push(d);
    }
    for (const drive of driveEquipment(plant)) {
      const ew = detectEarlyWarning(ctx, drive);
      if (ew) drafts.push(ew);
    }

    const seen = new Set<string>();
    for (const d of drafts) {
      seen.add(d.key);
      const prev = this.byKey.get(d.key);
      if (prev && prev.status !== 'resolved') {
        const decision = prev.decision;
        Object.assign(prev, d, { id: prev.id, openedAt: prev.openedAt, updatedAt: ctx.now, decision, status: decision ? 'decided' : 'open' });
        if (decision) {
          // после решения угроза — по выбранному варианту
          const chosen = prev.options.find((o) => o.id === decision.optionId);
          if (chosen) {
            prev.impactCars = chosen.carsLost * 0.5;
            prev.impactText = `Решение принято: ${lowerFirst(decision.title)}`;
            prev.tone = 'neutral';
          }
        }
      } else {
        const id = `inc-${d.type}-${++this.seq}`;
        this.byKey.set(d.key, { ...d, id, openedAt: Math.min(d.since, ctx.now), updatedAt: ctx.now, resolvedAt: null, status: 'open', decision: null });
      }
    }
    for (const [key, inc] of this.byKey) {
      if (seen.has(key) || inc.status === 'resolved') continue;
      inc.status = 'resolved';
      inc.resolvedAt = ctx.now;
    }
    // старые закрытые — не копим
    for (const [key, inc] of this.byKey) {
      if (inc.status === 'resolved' && inc.resolvedAt !== null && ctx.now - inc.resolvedAt > 12 * 3600_000) this.byKey.delete(key);
    }
  }

  decide(id: string, optionId: string, decidedBy: string | undefined, now: number): { incident: Incident; option: IncidentOption; workOrder: WorkOrder | null } | { error: string } {
    const inc = this.get(id);
    if (!inc) return { error: 'Инцидент не найден' };
    if (inc.status === 'resolved') return { error: 'Инцидент уже закрыт' };
    const option = inc.options.find((o) => o.id === optionId);
    if (!option) return { error: 'Вариант не найден' };
    const workOrderId = `wo-${id}-${optionId}`;
    inc.decision = { optionId, decidedAt: now, decidedBy, workOrderId, title: option.title };
    inc.status = 'decided';
    inc.tone = 'neutral';
    inc.impactCars = option.carsLost * 0.5;
    inc.impactText = `Решение принято: ${lowerFirst(option.title)}`;
    const workOrder: WorkOrder | null = option.workOrder
      ? { workOrderId, incidentId: id, issuedAt: toPlantIso(now), issuedBy: decidedBy, ...option.workOrder }
      : null;
    return { incident: inc, option, workOrder };
  }

  /** Ожидаемые потери машин открытых инцидентов — для прогноза плана */
  expectedLoss(): number {
    let sum = 0;
    for (const i of this.byKey.values()) {
      if (i.status === 'resolved') continue;
      if (i.decision) {
        const o = i.options.find((x) => x.id === i.decision!.optionId);
        sum += o?.carsLost ?? 0;
      } else {
        const noAction = i.options.find((o) => o.id === 'do_nothing' || o.id === 'postpone');
        sum += noAction?.carsLost ?? i.threat.carsLost;
      }
    }
    return sum;
  }
}

// ---------------------------------------------------------------------------

function lowerFirst(s: string) {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function shareOf(state: TwinState, model: string): number {
  const plan = [...state.plans.values()].pop();
  if (!plan) return model === 'onix' ? 0.52 : model === 'cobalt' ? 0.38 : 0.1;
  const total = plan.models.reduce((a, m) => a + m.qty, 0);
  return (plan.models.find((m) => m.model === model)?.qty ?? 0) / Math.max(1, total);
}

/** Момент, когда пройдёт mins минут рабочего времени (с учётом смен и ночей) */
function addWorkTime(from: number, mins: number): number {
  let t = from;
  let left = mins;
  for (let i = 0; i < 40 && left > 0; i++) {
    const s = shiftAt(t) ?? currentOrNextShift(t);
    const start = Math.max(t, s.startMs);
    const avail = (s.endMs - start) / 60_000;
    if (avail >= left) return start + left * 60_000;
    left -= avail;
    t = s.endMs + 1000;
  }
  return t;
}

function workHoursBetween(from: number, to: number): number {
  let t = from;
  let total = 0;
  for (let i = 0; i < 60 && t < to; i++) {
    const s = shiftAt(t) ?? currentOrNextShift(t);
    if (s.startMs >= to) break;
    const start = Math.max(t, s.startMs);
    const end = Math.min(to, s.endMs);
    if (end > start) total += (end - start) / 3600_000;
    t = s.endMs + 1000;
  }
  return total;
}

function window(s: { ts: number[]; v: number[] }, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = s.ts.length - 1; i >= 0; i--) {
    const t = s.ts[i]!;
    if (t < from) break;
    if (t <= to) out.push(s.v[i]!);
  }
  return out;
}

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]!);
  out.push(arr[arr.length - 1]!);
  return out;
}

export { capitalize, plural };
