import {
  BUFFER_CAPS,
  IDEAL_CYCLE,
  MAJOR_REPAIR_MIN,
  MARGIN_PER_CAR,
  REPAIR_COST,
  REWORK_COST,
  SHIFT_LEN,
  SHIFT_PLAN,
  STATIONS,
  stationIndex,
} from './config';
import { assessRisk, type Risk } from './model';
import type { Equipment, MapFrame, SimState, Station, StationId } from './types';

export function availability(st: Station): number {
  if (!st.recent.length) return 1;
  let ok = 0;
  for (const x of st.recent) if (x !== 'down' && x !== 'maint') ok++;
  return ok / st.recent.length;
}

/** Для поиска узкого места: только внеплановые простои за последний час — плановое ТО не снижает мощность участка */
function unplannedAvailability(st: Station): number {
  const xs = st.recent.slice(-60);
  if (!xs.length) return 1;
  let ok = 0;
  for (const x of xs) if (x !== 'down') ok++;
  return ok / xs.length;
}

export interface LineAnalysis {
  /** Эффективная мощность участка, авто/мин */
  caps: number[];
  bottleneck: number;
  /** Текущий темп линии (может проседать из-за аварий) */
  lineRate: number;
  /** Нормальный темп линии — база для денежных оценок */
  valueRate: number;
  /** Сколько минут буферы «защищают» выпуск, если участок встанет прямо сейчас */
  protect: number[];
  /** Динамическая цена часа простоя участка */
  costPerHour: number[];
}

/**
 * Динамическая цена простоя (теория ограничений):
 * — минута простоя узкого места = минута потерянного выпуска всей линии;
 * — простой другого участка начинает стоить денег, только когда буфер
 *   между ним и узким местом опустеет (или переполнится).
 */
export function lineAnalysis(s: SimState): LineAnalysis {
  const caps = s.stations.map((st, i) => (1 / STATIONS[i].cycle) * Math.max(0.3, unplannedAvailability(st)));
  let b = 0;
  caps.forEach((c, i) => {
    if (c < caps[b]) b = i;
  });
  // гистерезис, чтобы узкое место не «прыгало» из-за шума
  const prev = s.bottleneck;
  if (prev !== b && caps[b] > caps[prev] * 0.97) b = prev;
  // без комплектующих сборка — фактическое ограничение линии, независимо от мощностей
  const ASM = stationIndex('assembly');
  if (kitsCoverage(s) < 5 && s.kits.nextAt > s.t) b = ASM;
  const lineRate = caps[b];
  // деньги считаем от нормального темпа линии: пока участок в аварии, фактический темп
  // проседает, но теряем мы именно то, что линия выпускала бы в норме
  const valueRate = NORMAL_RATE;
  const protect = caps.map((_, i) => {
    let sum = 0;
    if (i < b) for (let k = i; k < b; k++) sum += s.buffers[k];
    if (i > b) for (let k = b; k < i; k++) sum += BUFFER_CAPS[k] - s.buffers[k];
    return sum / valueRate;
  });
  const costPerHour = protect.map((p) => Math.max(0, 60 - p) * valueRate * MARGIN_PER_CAR);
  return { caps, bottleneck: b, lineRate, valueRate, protect, costPerHour };
}

/** Нормальный темп линии: самый медленный участок с учётом средних микропростоев */
const NORMAL_RATE = Math.min(...STATIONS.map((d) => (1 / d.cycle) * (1 - d.microP * 7.5)));

export function lossFor(la: LineAnalysis, idx: number, durMin: number): number {
  return Math.max(0, durMin - la.protect[idx]) * la.valueRate * MARGIN_PER_CAR;
}

export function moneyAtRisk(la: LineAnalysis, e: Equipment, r: Risk): number {
  return r.p * (lossFor(la, stationIndex(e.stationId), MAJOR_REPAIR_MIN) + REPAIR_COST);
}

export function shiftBounds(t: number) {
  const start = t - (t % SHIFT_LEN);
  return { start, end: start + SHIFT_LEN, elapsed: Math.max(1, t - start) };
}

export function kpis(s: SimState) {
  const { elapsed } = shiftBounds(s.t);
  const plan = (SHIFT_PLAN * elapsed) / SHIFT_LEN;
  const total = s.shift.shipped + s.shift.rejected;
  const Q = total ? s.shift.shipped / total : 1;
  const oee = Math.min(1, (s.shift.shipped * IDEAL_CYCLE) / elapsed);
  const A =
    s.stations.reduce((a, st) => a + (1 - (st.shift.down + st.shift.maint) / elapsed), 0) / s.stations.length;
  const P = Math.min(1, oee / Math.max(0.01, A * Q));
  const rejectRate = s.qcRecent.length ? s.qcRecent.reduce((a, b) => a + b, 0) / s.qcRecent.length : 0;
  return { elapsed, plan, oee, A, P, Q, rejectRate };
}

export function kitsCoverage(s: SimState): number {
  return s.kits.level / 0.95;
}

export interface RiskItem {
  key: string;
  kind: 'equipment' | 'supply' | 'quality';
  title: string;
  detail: string;
  rub: number;
  equipId?: string;
  stationId: StationId;
  p?: number;
  ttf?: number | null;
}

/** Сводка «что под угрозой» — для директора, брифинга и ассистента */
export function riskItems(s: SimState, la: LineAnalysis): RiskItem[] {
  const items: RiskItem[] = [];
  for (const e of s.equipment) {
    if (e.failed) continue;
    const st = s.stations[stationIndex(e.stationId)];
    if (st.status === 'maint' && st.downEquip === e.id) continue;
    const r = assessRisk(e);
    if (r.p < 0.25) continue;
    items.push({
      key: `risk:${e.id}`,
      kind: 'equipment',
      title: e.name,
      detail: `риск отказа ${Math.round(r.p * 100)}%`,
      rub: moneyAtRisk(la, e, r),
      equipId: e.id,
      stationId: e.stationId,
      p: r.p,
      ttf: r.ttf,
    });
  }
  const cover = kitsCoverage(s);
  const toDelivery = s.kits.nextAt - s.t;
  if (cover < 60 && toDelivery > cover) {
    const gap = toDelivery - cover;
    items.push({
      key: 'supply',
      kind: 'supply',
      title: 'Комплектующие для сборки',
      detail: `запаса на ${Math.round(cover)} мин, поставка через ${Math.round(toDelivery)} мин`,
      rub: lossFor(la, 3, gap),
      stationId: 'assembly',
    });
  }
  if (s.paintExtra > 0.015) {
    items.push({
      key: 'quality',
      kind: 'quality',
      title: 'Качество окраски',
      detail: `дополнительный брак ${(s.paintExtra * 100).toFixed(1).replace('.', ',')}%`,
      rub: s.paintExtra * la.lineRate * 240 * REWORK_COST,
      stationId: 'paint',
    });
  }
  return items.sort((a, b) => b.rub - a.rub);
}

export function frameOf(s: SimState, la = lineAnalysis(s)): MapFrame {
  const risks: Record<string, number> = {};
  for (const e of s.equipment) risks[e.id] = e.failed ? 1 : assessRisk(e).p;
  return {
    t: s.t,
    shiftIndex: s.shift.index,
    statuses: s.stations.map((st) => st.status),
    causes: s.stations.map((st) => st.downCause),
    produced: s.stations.map((st) => st.shift.produced),
    buffers: [...s.buffers],
    kits: s.kits.level,
    kitsNextAt: s.kits.nextAt,
    shipped: s.shift.shipped,
    rejected: s.shift.rejected,
    risks,
    costPerHour: la.costPerHour,
    protect: la.protect,
    bottleneck: la.bottleneck,
    lineRate: la.lineRate,
  };
}
