// Прогноз плана месяца: темп последних смен × оставшиеся смены, коридор P10/P50/P90
// простой симуляцией Монте-Карло (200 прогонов), учёт активных инцидентов и рычагов «что если».
import {
  KITS,
  MODELS,
  addDays,
  freeSaturdays,
  monthOf,
  monthShifts,
  plantParts,
  shiftsBetweenDates,
  type AreaId,
  type ModelId,
  type ShiftRef,
} from '@allur/contracts';
import type { Explain } from '@allur/contracts';
import type { TwinConfig } from './config';
import { Rng } from './rng';
import type { TwinState } from './state';
import { num, num1 } from './text';

export interface Levers {
  /** Перенести плановое ТО на нерабочее время */
  moveMaintenance: boolean;
  /** Менять фильтр по графику, а не по аварии */
  filterBySchedule: boolean;
  /** Сколько смен добавить в субботы */
  saturdayShifts: number;
}

export const NO_LEVERS: Levers = { moveMaintenance: false, filterBySchedule: false, saturdayShifts: 0 };

export interface LossItem {
  key: string;
  label: string;
  cars: number;
  area?: AreaId;
}

export interface LeverInfo {
  id: keyof Levers;
  label: string;
  gain: number;
  perShift: number;
  max?: number;
  explain: string;
}

export interface DayPoint {
  date: string;
  /** Накопленный факт (для прошедших дней) */
  fact: number | null;
  /** Накопленный план */
  plan: number;
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface ModelForecast {
  model: ModelId;
  name: string;
  plan: number;
  produced: number;
  forecast: number;
  stockShifts: number | null;
  stockRisk: 'низкий' | 'средний' | 'высокий';
  stockText: string | null;
}

export interface MonthForecast {
  month: string;
  target: number;
  produced: number;
  p10: number;
  p50: number;
  p90: number;
  gap: number;
  onTrack: boolean;
  pace: number;
  paceShifts: number;
  remainingShifts: number;
  currentShiftRemaining: number;
  incidentLoss: number;
  leverGain: number;
  days: DayPoint[];
  losses: LossItem[];
  bottleneck: { area: AreaId; label: string; reason: string } | null;
  mainCause: string | null;
  levers: LeverInfo[];
  models: ModelForecast[];
  capacityNote: string;
  explain: Explain;
}

const AREA_LABEL: Record<string, string> = { weld: 'Сварка', paint: 'Окраска', assembly: 'Сборка', qc: 'ОТК' };

/** Выпуск завода за смену: факт «Сборка-1» из сменного отчёта, а для идущего дня — по проходу VIN */
export function shiftOutput(state: TwinState, s: ShiftRef, now: number): number | null {
  const rep = state.reports.get(`${s.date}#${s.index}|assembly`);
  if (rep) return rep.fact;
  if (s.startMs >= state.runStartMs - 60_000 && s.startMs <= now) return state.count(s.key, 'ASM-6');
  return null;
}

export function monthForecast(state: TwinState, now: number, cfg: TwinConfig, opts: { levers?: Levers; incidentLoss?: number } = {}): MonthForecast {
  const levers = opts.levers ?? NO_LEVERS;
  const incidentLoss = Math.max(0, opts.incidentLoss ?? 0);
  const today = plantParts(now).date;
  const month = monthOf(today);
  const plan = state.plans.get(month);
  const target = plan?.target ?? (plan ? plan.models.reduce((s, m) => s + m.qty, 0) : cfg.monthTargetDefault);
  const shifts = monthShifts(month);
  const planPerShift = target / Math.max(1, shifts.length);

  // Факт по сменам месяца
  const done: { s: ShiftRef; out: number }[] = [];
  let current: ShiftRef | null = null;
  const remaining: ShiftRef[] = [];
  for (const s of shifts) {
    if (s.endMs <= now) {
      const out = shiftOutput(state, s, now);
      if (out !== null) done.push({ s, out });
    } else if (s.startMs <= now) current = s;
    else remaining.push(s);
  }
  const currentDone = current ? state.count(current.key, 'ASM-6') : 0;
  const produced = done.reduce((a, d) => a + d.out, 0) + currentDone;

  // Темп: последние 10 завершённых смен (включая сентябрь)
  const recent = recentShiftOutputs(state, now, 20);
  const last10 = recent.slice(-10);
  const pace = last10.length ? last10.reduce((a, b) => a + b, 0) / last10.length : cfg.shiftPlan * 0.94;
  const currentRemainingFrac = current ? Math.max(0, (current.endMs - now) / (current.endMs - current.startMs)) : 0;
  const currentShiftRemaining = pace * currentRemainingFrac;

  const leverInfo = leverGains(state, now, cfg, remaining.length + currentRemainingFrac, pace, month);
  const leverGain =
    (levers.moveMaintenance ? leverInfo.find((l) => l.id === 'moveMaintenance')!.gain : 0) +
    (levers.filterBySchedule ? leverInfo.find((l) => l.id === 'filterBySchedule')!.gain : 0) +
    Math.min(levers.saturdayShifts, leverInfo.find((l) => l.id === 'saturdayShifts')!.max ?? 0) * pace;

  // Монте-Карло: каждая оставшаяся смена — случайная из последних 20 фактических
  const rng = new Rng(hashString(`${month}|${done.length}|${Math.round(pace * 10)}`));
  const runs = cfg.monteCarloRuns;
  const sample = recent.length ? recent : [pace];
  const futureDates = [...new Set(remaining.map((s) => s.date))];
  const cumByDay: number[][] = futureDates.map(() => []);
  const totals: number[] = [];
  for (let r = 0; r < runs; r++) {
    let total = produced + currentShiftRemaining - incidentLoss;
    const perShiftGain = remaining.length ? leverGain / (remaining.length + currentRemainingFrac || 1) : 0;
    total += perShiftGain * currentRemainingFrac;
    let di = 0;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]!;
      total += sample[Math.floor(rng.next() * sample.length)]! + perShiftGain;
      const isLastOfDay = i === remaining.length - 1 || remaining[i + 1]!.date !== s.date;
      if (isLastOfDay) {
        cumByDay[di]!.push(total);
        di++;
      }
    }
    if (!remaining.length) total += leverGain;
    totals.push(total);
  }
  const q = (arr: number[], p: number) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] ?? 0;
  };
  const p10 = Math.round(q(totals, 0.1));
  const p50 = Math.round(q(totals, 0.5));
  const p90 = Math.round(q(totals, 0.9));

  // Точки графика: накопленный факт, план и коридор прогноза
  const days: DayPoint[] = [];
  let cumFact = 0;
  let cumPlan = 0;
  const byDate = new Map<string, number>();
  for (const d of done) byDate.set(d.s.date, (byDate.get(d.s.date) ?? 0) + d.out);
  if (current) byDate.set(current.date, (byDate.get(current.date) ?? 0) + currentDone);
  const planByDate = new Map<string, number>();
  for (const s of shifts) planByDate.set(s.date, (planByDate.get(s.date) ?? 0) + planPerShift);
  for (let d = `${month}-01`; monthOf(d) === month; d = addDays(d, 1)) {
    cumPlan += planByDate.get(d) ?? 0;
    const isPast = d < today || (d === today && !!current);
    if (isPast) cumFact += byDate.get(d) ?? 0;
    const fi = futureDates.indexOf(d);
    days.push({
      date: d,
      fact: isPast ? cumFact : null,
      plan: Math.round(cumPlan),
      p10: fi >= 0 ? Math.round(q(cumByDay[fi]!, 0.1)) : d === today ? cumFact : null,
      p50: fi >= 0 ? Math.round(q(cumByDay[fi]!, 0.5)) : d === today ? cumFact : null,
      p90: fi >= 0 ? Math.round(q(cumByDay[fi]!, 0.9)) : d === today ? cumFact : null,
    });
  }
  // дни без смен в будущем тянут предыдущее значение коридора
  let lastP: [number | null, number | null, number | null] = [null, null, null];
  for (const pt of days) {
    if (pt.p50 !== null) lastP = [pt.p10, pt.p50, pt.p90];
    else if (pt.fact === null && lastP[1] !== null) [pt.p10, pt.p50, pt.p90] = lastP;
  }

  const losses = lossDecomposition(state, now, cfg, done.map((d) => d.s), current);
  const top = losses.filter((l) => l.area).sort((a, b) => b.cars - a.cars)[0];
  const bottleneck = top?.area
    ? { area: top.area, label: AREA_LABEL[top.area] ?? top.area, reason: `больше всего потерянных машин с начала месяца: ${num(top.cars)}` }
    : null;

  const capacity = shifts.length * cfg.shiftPlan;
  const weekdayCapacity = shifts.filter((s) => plantParts(s.startMs).weekday <= 5).length * cfg.shiftPlan;
  const capacityNote = `В октябре ${shifts.length} смен (${num(capacity)} машин при такте ${cfg.taktMin} мин), из них в будни — ${num(weekdayCapacity)}.`;

  const explain: Explain = {
    rule: 'Прогноз = выпущено + остаток текущей смены + оставшиеся смены × темп последних 10 смен − ожидаемые потери открытых инцидентов + эффект выбранных мер. Коридор — 200 прогонов: каждая оставшаяся смена случайно берётся из 20 последних фактических.',
    inputs: [
      { label: 'Целевой план месяца', value: `${num(target)} машин`, source: 'erp' },
      { label: 'Выпущено с начала месяца', value: `${num(produced)}`, source: 'mes' },
      { label: 'Темп последних 10 смен', value: `${num1(pace)} машины за смену`, source: 'mes' },
      { label: 'Осталось смен', value: `${remaining.length} + ${num1(currentRemainingFrac)} текущей`, source: 'erp' },
      { label: 'Ожидаемые потери открытых инцидентов', value: `${num(incidentLoss)} машин` },
    ],
    sources: ['erp', 'mes'],
    conclusion: p50 >= target ? `Ожидаем ${num(p50)} — план выполняется с запасом ${num(p50 - target)}` : `Ожидаем ${num(p50)} — не хватает ${num(target - p50)} машин`,
    assumptions: ['Выпуск считается по линии «Сборка-1».', 'В плане учтены 2 рабочие субботы (17.10 и 24.10).'],
  };

  return {
    month,
    target,
    produced,
    p10,
    p50,
    p90,
    gap: p50 - target,
    onTrack: p50 >= target,
    pace,
    paceShifts: last10.length,
    remainingShifts: remaining.length,
    currentShiftRemaining,
    incidentLoss,
    leverGain,
    days,
    losses,
    bottleneck,
    mainCause: bottleneck ? bottleneck.label.toLowerCase() : null,
    levers: leverInfo,
    models: modelForecasts(state, target, produced, p50, month, now),
    capacityNote,
    explain,
  };
}

/** Выпуск последних N завершённых смен (из отчётов и живого дня) */
export function recentShiftOutputs(state: TwinState, now: number, n: number): number[] {
  const today = plantParts(now).date;
  const out: number[] = [];
  for (const s of shiftsBetweenDates(addDays(today, -40), today)) {
    if (s.endMs > now) continue;
    const v = shiftOutput(state, s, now);
    if (v !== null) out.push(v);
  }
  return out.slice(-n);
}

function lossDecomposition(state: TwinState, now: number, cfg: TwinConfig, doneShifts: ShiftRef[], current: ShiftRef | null): LossItem[] {
  const shifts = current ? [...doneShifts, current] : doneShifts;
  if (!shifts.length) return [];
  let gap = 0;
  for (const s of doneShifts) gap += Math.max(0, cfg.shiftPlan - (shiftOutput(state, s, now) ?? cfg.shiftPlan));
  if (current) {
    const elapsed = Math.max(0, Math.min(now, current.endMs) - current.startMs) / 60_000;
    gap += Math.max(0, Math.floor(elapsed / cfg.taktMin) - state.count(current.key, 'ASM-6'));
  }
  const inShift = (t: number) => shifts.some((s) => t >= s.startMs && t < s.endMs);
  const mins: Record<string, number> = {};
  for (const d of state.downtimes.values()) {
    if (!inShift(d.from)) continue;
    const end = d.to ?? Math.min(now, d.from + 60 * 60_000);
    const m = Math.max(0, (end - d.from) / 60_000);
    const key = d.category === 'planned' ? 'planned' : d.category === 'no_parts' ? 'no_parts' : d.area;
    mins[key] = (mins[key] ?? 0) + m;
  }
  // Повторная окраска забирает мощность окраски: один перекрашенный кузов ≈ одна машина
  let repaints = 0;
  for (const s of doneShifts) repaints += state.quality.get(`${s.date}#${s.index}|paint`)?.defects ?? 0;
  if (current) for (const n of state.nc) if (n.responsible === 'paint' && n.decision === 'repaint' && n.ts >= current.startMs && n.ts <= now) repaints += n.count;

  const raw: LossItem[] = [
    { key: 'paint', label: 'Окраска: простои и перекраска', cars: (mins.paint ?? 0) / cfg.taktMin + repaints, area: 'paint' },
    { key: 'assembly', label: 'Сборка: простои', cars: (mins.assembly ?? 0) / cfg.taktMin, area: 'assembly' },
    { key: 'weld', label: 'Сварка: простои', cars: (mins.weld ?? 0) / cfg.taktMin, area: 'weld' },
    { key: 'qc', label: 'ОТК: простои', cars: (mins.qc ?? 0) / cfg.taktMin, area: 'qc' },
    { key: 'planned', label: 'Плановое ТО в рабочее время', cars: (mins.planned ?? 0) / cfg.taktMin },
    { key: 'no_parts', label: 'Нехватка комплектующих', cars: (mins.no_parts ?? 0) / cfg.taktMin },
  ];
  // Буферы гасят часть остановок: приводим сумму к фактической недостаче
  const sum = raw.reduce((a, r) => a + r.cars, 0);
  const scale = sum > gap && sum > 0 ? gap / sum : 1;
  const items = raw.map((r) => ({ ...r, cars: Math.round(r.cars * scale) }));
  const rest = Math.max(0, Math.round(gap - items.reduce((a, r) => a + r.cars, 0)));
  items.push({ key: 'other', label: 'Микропростои и прочее', cars: rest });
  return items.filter((i) => i.cars > 0).sort((a, b) => b.cars - a.cars);
}

function leverGains(state: TwinState, now: number, cfg: TwinConfig, remainingShifts: number, pace: number, month: string): LeverInfo[] {
  // Статистика за последние 30 дней
  const from = now - 30 * 86_400_000;
  let plannedMin = 0;
  let forced = 0;
  for (const d of state.downtimes.values()) {
    if (d.from < from || d.from > now) continue;
    const end = d.to ?? d.from;
    const h = plantParts(d.from).hour;
    const inShift = h >= 8;
    if (d.category === 'planned' && inShift) plannedMin += (end - d.from) / 60_000;
    if (d.equipmentId === 'BOOTH-02' && /фильтр/i.test(d.reason) && d.category !== 'planned') forced++;
  }
  const histShifts = Math.max(1, recentShiftOutputs(state, now, 60).length);
  let paintDefects = 0;
  let paintProduced = 0;
  for (const q of state.quality.values()) {
    if (q.area !== 'paint') continue;
    paintDefects += q.defects;
    paintProduced += q.produced;
  }
  const paintRate = paintProduced > 0 ? paintDefects / paintProduced : 0;
  const forcedPerShift = forced / histShifts;

  const maintPerShift = plannedMin / histShifts / cfg.taktMin;
  const filterPerShift =
    forcedPerShift * (cfg.filter.forcedMin / cfg.taktMin) * (1 - cfg.bufferAbsorption) + Math.max(0, paintRate - 0.015) * pace * 0.6;
  const saturdays = freeSaturdays(month).filter((d) => d >= plantParts(now).date);

  return [
    {
      id: 'moveMaintenance',
      label: 'Перенести ТО на нерабочее время',
      perShift: maintPerShift,
      gain: maintPerShift * remainingShifts,
      explain: `За 30 дней плановое ТО в рабочее время заняло ${num(plannedMin)} мин (${num1(plannedMin / histShifts)} мин на смену). Ночью линия не работает — это время вернётся в выпуск.`,
    },
    {
      id: 'filterBySchedule',
      label: 'Менять фильтр окраски по графику, а не по аварии',
      perShift: filterPerShift,
      gain: filterPerShift * remainingShifts,
      explain: `За 30 дней ${forced} вынужденных замен фильтра Камеры-02 по ${cfg.filter.forcedMin} мин; буфер гасит около ${Math.round(cfg.bufferAbsorption * 100)}% остановки. Брак окраски ${num1(paintRate * 100)}% против ~1,5% при чистом фильтре — меньше перекраски.`,
    },
    {
      id: 'saturdayShifts',
      label: 'Добавить смену в субботу',
      perShift: pace,
      gain: pace,
      max: saturdays.length * 2,
      explain: `Свободные субботы: ${saturdays.map((d) => d.slice(8, 10) + '.' + d.slice(5, 7)).join(', ') || 'нет'}. Одна смена даёт около ${num(pace)} машин (темп последних смен).`,
    },
  ];
}

function modelForecasts(state: TwinState, target: number, produced: number, p50: number, month: string, now: number): ModelForecast[] {
  const plan = state.plans.get(month);
  const givenTotal = plan ? plan.models.reduce((a, m) => a + m.qty, 0) : 4800;
  const live: Record<ModelId, number> = { onix: 0, cobalt: 0, j7: 0 };
  let liveTotal = 0;
  for (const p of state.passes) {
    if (p.post !== 'ASM-6' || monthOf(plantParts(p.ts).date) !== month) continue;
    live[p.model]++;
    liveTotal++;
  }
  const histTotal = Math.max(0, produced - liveTotal);
  return MODELS.map((m) => {
    const given = plan?.models.find((x) => x.model === m.id)?.qty ?? m.givenPlan;
    const share = given / givenTotal;
    const kits = KITS.filter((k) => k.model === m.id).map((k) => state.stock.get(k.id)).filter(Boolean);
    const worst = kits.length ? kits.reduce((a, b) => (a!.shiftsLeft < b!.shiftsLeft ? a : b))! : null;
    const kitName = worst ? KITS.find((k) => k.id === worst.kitId)!.name.replace(` ${m.short}`, '').toLowerCase() : null;
    const risk = !worst ? 'низкий' : worst.shiftsLeft < 2 ? 'высокий' : worst.shiftsLeft < 3 ? 'средний' : 'низкий';
    return {
      model: m.id,
      name: m.name,
      plan: Math.round(target * share),
      produced: Math.round(histTotal * share + live[m.id]),
      forecast: Math.round(p50 * share),
      stockShifts: worst ? worst.shiftsLeft : null,
      stockRisk: risk,
      stockText: worst ? `${kitName} на ${num1(worst.shiftsLeft)} смены` : null,
    };
  });
  void now;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
