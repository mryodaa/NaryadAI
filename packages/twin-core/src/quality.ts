// Качество: доля брака по участкам и поиск причины — связь несоответствий по VIN
// с состоянием оборудования в момент прохода кузова (раздел 9.3).
import { DEFECT_BY_ID, type AreaId, type SourceId } from '@allur/contracts';
import type { TwinConfig } from './config';
import type { TwinState } from './state';
import { hm, num, num1, pct1, plural } from './text';

/** Где проверяют кузова участка: проход этого поста = одна проверка */
export const INSPECTION_POST: Partial<Record<AreaId, string>> = { weld: 'WELD-4', paint: 'PAINT-OVEN', assembly: 'QC-1' };

export interface QualityWindow {
  area: AreaId;
  inspected: number;
  defects: number;
  share: number;
  top: { defect: string; name: string; count: number }[];
  firstDefectTs: number | null;
}

export function qualityWindow(state: TwinState, area: AreaId, from: number, to: number): QualityWindow {
  const post = INSPECTION_POST[area];
  let inspected = 0;
  if (post) {
    for (let i = state.passes.length - 1; i >= 0; i--) {
      const p = state.passes[i]!;
      if (p.ts < from) break;
      if (p.ts <= to && p.post === post) inspected++;
    }
  }
  const byDefect = new Map<string, number>();
  let defects = 0;
  let first: number | null = null;
  for (const n of state.nc) {
    if (n.responsible !== area || n.ts < from || n.ts > to) continue;
    defects += n.count;
    byDefect.set(n.defect, (byDefect.get(n.defect) ?? 0) + n.count);
    if (first === null || n.ts < first) first = n.ts;
  }
  const top = [...byDefect.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([defect, count]) => ({ defect, name: DEFECT_BY_ID[defect]?.name ?? defect, count }));
  return { area, inspected, defects, share: inspected > 0 ? defects / inspected : 0, top, firstDefectTs: first };
}

/**
 * Тревога по качеству. Доля брака выше нормы за 2 часа и минимум 3 случая. Если контроллер
 * подтверждает причину (перепад на фильтре окраски выше 300 Па), хватает 2 случаев —
 * два независимых источника подтверждают друг друга.
 */
export function qualityAlarm(state: TwinState, area: AreaId, now: number, cfg: TwinConfig, isOpen: boolean): { window: QualityWindow; alarm: boolean; supported: boolean } {
  const w = qualityWindow(state, area, now - cfg.qualityWindowMin * 60_000, now);
  const dp = area === 'paint' ? state.valueAt('BOOTH-02', 'filter_dp_pa', now) : null;
  const supported = dp !== null && dp > cfg.filter.dirtyPa;
  const minDefects = supported ? 2 : 3;
  const limit = isOpen ? cfg.defectNorm * 0.75 : cfg.defectNorm;
  let alarm = w.inspected >= 10 && w.defects >= (isOpen ? Math.min(2, minDefects) : minDefects) && w.share > limit;
  // Фильтр уже заменили и перепад в норме: старый брак в окне не держит тревогу
  if (alarm && area === 'paint' && dp !== null && dp < cfg.filter.normPa) {
    const rep = lastFilterReplacement(state, now);
    const lastDefect = Math.max(...state.nc.filter((n) => n.responsible === 'paint').map((n) => n.ts), 0);
    if (rep && rep.at > lastDefect) alarm = false;
  }
  return { window: w, alarm, supported };
}

export interface FilterCause {
  equipmentId: 'BOOTH-02';
  threshold: number;
  defectsAbove: number;
  defectsTotal: number;
  bodiesAbove: number;
  bodiesBelow: number;
  rateAbove: number;
  rateBelow: number;
  /** Во сколько раз чаще брак выше порога */
  lift: number;
  dpNow: number | null;
  sentence: string;
  /** Точки для графика «перепад и брак»: время, перепад, был ли брак */
  points: { ts: number; dp: number; defect: boolean }[];
}

/**
 * Сорность по VIN против перепада давления на фильтре Камеры-02 в момент прохода кузова.
 * Сравниваем долю брака выше и ниже порога; порог выбираем из нормативных 250/275/300/325 Па.
 */
export function paintFilterCause(state: TwinState, now: number, cfg: TwinConfig, windowMin = 8 * 60): FilterCause | null {
  const from = now - windowMin * 60_000;
  const b2: { vin: string; ts: number; dp: number }[] = [];
  for (const p of state.passes) {
    if (p.ts < from || p.ts > now || p.post !== 'PAINT-B2') continue;
    const dp = state.valueAt('BOOTH-02', 'filter_dp_pa', p.ts);
    if (dp !== null) b2.push({ vin: p.vin, ts: p.ts, dp });
  }
  if (b2.length < 10) return null;
  const dirty = new Set<string>();
  const dirtyAt = new Map<string, number>();
  for (const n of state.nc) {
    if (n.defect !== 'paint_dirt' || !n.vin || n.ts < from || n.ts > now) continue;
    dirty.add(n.vin);
    dirtyAt.set(n.vin, n.ts);
  }
  // Перепад в момент прохода Камеры-02 — последний проход перед обнаружением брака
  const dpOfDefect = new Map<string, number>();
  const passOfDefect = new Map<string, number>();
  for (const pass of b2) {
    const at = dirtyAt.get(pass.vin);
    if (at !== undefined && pass.ts <= at) {
      dpOfDefect.set(pass.vin, pass.dp);
      passOfDefect.set(pass.vin, pass.ts);
    }
  }
  const defectsTotal = dpOfDefect.size;
  if (defectsTotal < 3) return null;

  let best: Omit<FilterCause, 'equipmentId' | 'dpNow' | 'sentence' | 'points'> | null = null;
  for (const threshold of [250, 275, 300, 325]) {
    const above = b2.filter((x) => x.dp > threshold);
    const below = b2.filter((x) => x.dp <= threshold);
    if (above.length < 5 || below.length < 5) continue;
    const dAbove = [...dpOfDefect.values()].filter((dp) => dp > threshold).length;
    const dBelow = defectsTotal - dAbove;
    const rateAbove = dAbove / above.length;
    const rateBelow = dBelow / below.length;
    const lift = rateAbove / Math.max(rateBelow, 0.004);
    const cand = { threshold, defectsAbove: dAbove, defectsTotal, bodiesAbove: above.length, bodiesBelow: below.length, rateAbove, rateBelow, lift };
    // при близкой силе связи берём нормативный порог 300 Па — его проще объяснить
    if (!best || lift > best.lift * 1.25 || (threshold === cfg.filter.dirtyPa && lift >= best.lift * 0.8)) best = cand;
  }
  if (!best || best.defectsAbove < 2 || best.lift < 2) return null;
  const dpNow = state.valueAt('BOOTH-02', 'filter_dp_pa', now);
  const where = best.threshold === cfg.filter.normPa ? `выше нормы ${cfg.filter.normPa} Па` : `выше ${best.threshold} Па (норма до ${cfg.filter.normPa})`;
  const sentence = `${best.defectsAbove} из ${best.defectsTotal} ${plural(best.defectsTotal, ['кузова', 'кузовов', 'кузовов'])} с сорностью прошли Камеру-02, когда перепад давления на фильтре был ${where}`;
  return {
    equipmentId: 'BOOTH-02',
    ...best,
    dpNow,
    sentence,
    points: b2.map((x) => ({ ts: x.ts, dp: x.dp, defect: passOfDefect.get(x.vin) === x.ts })),
  };
}

export interface FilterForecast {
  dpNow: number;
  /** Скорость роста сейчас, Па/ч */
  ratePerHour: number;
  limitAt: number | null;
  method: string;
  samples: number;
}

/**
 * Когда фильтр выйдет на предел. Рост перепада ускоряется по мере засорения, поэтому берём
 * экспоненциальную модель по точкам последних 90 минут работы: ln(dp − 40) растёт линейно во времени.
 */
export function filterForecast(state: TwinState, now: number, cfg: TwinConfig): FilterForecast | null {
  const s = state.series('BOOTH-02', 'filter_dp_pa');
  if (!s) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = s.ts.length - 1; i >= 0; i--) {
    const t = s.ts[i]!;
    if (t > now) continue;
    if (now - t > 90 * 60_000) break;
    xs.push((t - now) / 3600_000);
    ys.push(Math.log(Math.max(1, s.v[i]! - 40)));
  }
  if (xs.length < 10) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const k = sxx > 0 ? sxy / sxx : 0;
  const lnNow = my - k * mx;
  const dpNow = Math.exp(lnNow) + 40;
  const ratePerHour = k * (dpNow - 40);
  let limitAt: number | null = null;
  if (k > 0.0005 && dpNow < cfg.filter.limitPa) {
    const hours = (Math.log(cfg.filter.limitPa - 40) - lnNow) / k;
    if (hours > 0 && hours < 48) limitAt = now + hours * 3600_000;
  }
  return { dpNow, ratePerHour, limitAt, method: 'экспоненциальный тренд перепада за последние 90 минут', samples: n };
}

/** Ступень 0: перепада не видно — опираемся на журнал замен фильтра в 1С:MES */
export function lastFilterReplacement(state: TwinState, now: number): { at: number; source: SourceId } | null {
  let best: { at: number; source: SourceId } | null = null;
  for (const d of state.downtimes.values()) {
    if (d.equipmentId !== 'BOOTH-02' || !/фильтр/i.test(d.reason)) continue;
    const at = d.to ?? d.from;
    if (at > now) continue;
    if (!best || at > best.at) best = { at, source: d.source };
  }
  return best;
}

/** Среднее число кузовов между заменами фильтра по истории (для оценки на ступени 0) */
export function typicalFilterLifeHours(state: TwinState): number {
  const reps = [...state.downtimes.values()]
    .filter((d) => d.equipmentId === 'BOOTH-02' && /фильтр/i.test(d.reason))
    .map((d) => d.from)
    .sort((a, b) => a - b);
  if (reps.length < 3) return 17;
  // считаем только рабочее время: ~16 ч в рабочие сутки
  const spanDays = (reps[reps.length - 1]! - reps[0]!) / 86_400_000;
  const workHours = spanDays * (16 * (5 / 7));
  return Math.max(8, Math.min(30, workHours / (reps.length - 1)));
}

export function describeShare(w: QualityWindow): string {
  return `${pct1(w.share)} (${num(w.defects)} из ${num(w.inspected)})`;
}

export { hm, num1 };
