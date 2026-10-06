// Показатели смены (раздел 9.2): выпуск к этому моменту, OEE из трёх частей, брак, простои.
import { EQUIPMENT_BY_ID, shiftAt, type AreaId, type ShiftRef } from '@allur/contracts';
import type { TwinConfig } from './config';
import type { TwinState } from './state';
import { LAST_POST, PRODUCING } from './status';
import { INSPECTION_POST } from './quality';

export interface Interval {
  from: number;
  to: number;
  kind: 'fault' | 'maintenance' | 'waiting';
  label: string;
  source: 'plc' | 'mes' | 'master' | 'inferred';
  equipmentId?: string;
  micro?: boolean;
}

/**
 * Когда участок стоял: по контроллерам (точно, включая микропростои), иначе по записям 1С:MES
 * и по разрывам в проходе VIN дольше 3 тактов.
 */
export function stopIntervals(state: TwinState, area: AreaId, from: number, to: number, cfg: TwinConfig, plc: boolean): Interval[] {
  const out: Interval[] = [];
  if (plc) {
    for (const a of state.autoStops) {
      if (a.area !== area) continue;
      const end = a.to ?? to;
      if (end <= from || a.from >= to) continue;
      const name = EQUIPMENT_BY_ID[a.equipmentId]?.name ?? a.equipmentId;
      out.push({
        from: Math.max(from, a.from),
        to: Math.min(to, end),
        kind: a.status,
        label: `${name}: ${lowerFirst(a.text ?? (a.status === 'fault' ? 'авария' : 'обслуживание'))}`,
        source: 'plc',
        equipmentId: a.equipmentId,
        micro: end - a.from < 5 * 60_000,
      });
    }
  }
  for (const d of state.downtimes.values()) {
    if (d.area !== area) continue;
    const end = d.to ?? to;
    if (end <= from || d.from >= to) continue;
    // если контроллеры подключены, их интервалы точнее записей мастера
    if (plc && out.some((o) => o.equipmentId === d.equipmentId && overlap(o, { from: d.from, to: end }))) continue;
    const name = EQUIPMENT_BY_ID[d.equipmentId]?.name ?? d.equipmentId;
    out.push({
      from: Math.max(from, d.from),
      to: Math.min(to, end),
      kind: d.category === 'planned' ? 'maintenance' : d.category === 'no_parts' ? 'waiting' : 'fault',
      label: d.category === 'no_parts' ? d.reason : `${name}: ${d.reason.toLowerCase()}`,
      source: d.source === 'master' ? 'master' : 'mes',
      equipmentId: d.equipmentId,
    });
  }
  if (!plc) {
    // разрывы в проходе VIN, которые не объяснены записями
    const post = LAST_POST[area as 'weld'];
    if (post) {
      const limit = cfg.stopTakts * cfg.taktMin * 60_000;
      let prev = Math.max(from, state.runStartMs);
      const passes = state.passes.filter((p) => p.area === area && p.ts >= from && p.ts <= to);
      const times = passes.map((p) => p.ts);
      times.push(to);
      for (const t of times) {
        if (t - prev > limit) {
          const gap = { from: prev + cfg.taktMin * 60_000, to: t };
          if (!out.some((o) => overlap(o, gap))) {
            out.push({ ...gap, kind: 'fault', label: 'Нет прохода кузовов (по 1С:MES)', source: 'inferred' });
          }
        }
        prev = Math.max(prev, t);
      }
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

function lowerFirst(s: string) {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

function overlap(a: { from: number; to: number }, b: { from: number; to: number }) {
  return a.from < b.to && b.from < a.to;
}

export function totalMinutes(intervals: Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  let total = 0;
  let curFrom = -1;
  let curTo = -1;
  for (const i of sorted) {
    if (i.from > curTo) {
      if (curTo > curFrom) total += curTo - curFrom;
      curFrom = i.from;
      curTo = i.to;
    } else curTo = Math.max(curTo, i.to);
  }
  if (curTo > curFrom) total += curTo - curFrom;
  return total / 60_000;
}

export interface ShiftKpis {
  shift: ShiftRef | null;
  elapsedMin: number;
  done: number;
  planToNow: number;
  areaDone: Record<'weld' | 'paint' | 'assembly' | 'qc' | 'finished', number>;
  oee: { value: number; availability: number; performance: number; quality: number; stopMin: number; plannedMin: number };
  defects: { pct: number; defects: number; inspected: number; worst: { area: AreaId; share: number } | null; byArea: Partial<Record<AreaId, { defects: number; inspected: number }>> };
}

export function shiftKpis(state: TwinState, now: number, cfg: TwinConfig, shift: ShiftRef | null = shiftAt(now)): ShiftKpis {
  const areaDone = { weld: 0, paint: 0, assembly: 0, qc: 0, finished: 0 };
  if (!shift) {
    return {
      shift: null,
      elapsedMin: 0,
      done: 0,
      planToNow: 0,
      areaDone,
      oee: { value: 0, availability: 0, performance: 0, quality: 0, stopMin: 0, plannedMin: 0 },
      defects: { pct: 0, defects: 0, inspected: 0, worst: null, byArea: {} },
    };
  }
  const end = Math.min(now, shift.endMs);
  const elapsedMin = Math.max(0, (end - shift.startMs) / 60_000);
  for (const a of PRODUCING) areaDone[a] = state.count(shift.key, LAST_POST[a]);
  areaDone.finished = state.count(shift.key, 'FG-IN');
  const done = areaDone.finished;
  const planToNow = Math.min(cfg.shiftPlan, Math.floor(elapsedMin / cfg.taktMin));

  // Брак смены: несоответствия на проверках сварки, окраски и сборки
  const byArea: ShiftKpis['defects']['byArea'] = {};
  let inspected = 0;
  let defects = 0;
  for (const area of ['weld', 'paint', 'assembly'] as const) {
    const post = INSPECTION_POST[area]!;
    const ins = state.count(shift.key, post);
    let d = 0;
    for (const n of state.nc) if (n.responsible === area && n.ts >= shift.startMs && n.ts <= end) d += n.count;
    byArea[area] = { defects: d, inspected: ins };
    inspected += ins;
    defects += d;
  }
  let worst: ShiftKpis['defects']['worst'] = null;
  for (const [area, v] of Object.entries(byArea) as [AreaId, { defects: number; inspected: number }][]) {
    const share = v.inspected > 0 ? v.defects / v.inspected : 0;
    if (!worst || share > worst.share) worst = { area, share };
  }

  // OEE линии по сборке, которая задаёт ритм: доступность × производительность × качество
  const plc = state.plcConnected(now);
  const stopMin = Math.min(elapsedMin, totalMinutes(stopIntervals(state, 'assembly', shift.startMs, end, cfg, plc)));
  const runMin = Math.max(1, elapsedMin - stopMin);
  const availability = elapsedMin > 0 ? runMin / elapsedMin : 1;
  const performance = Math.min(1, (areaDone.assembly * cfg.taktMin) / runMin);
  const vinsWithNc = new Set(state.nc.filter((n) => n.vin && n.ts >= shift.startMs - 8 * 3600_000).map((n) => n.vin!));
  let firstPass = 0;
  let finished = 0;
  for (let i = state.passes.length - 1; i >= 0; i--) {
    const p = state.passes[i]!;
    if (p.ts < shift.startMs) break;
    if (p.post !== 'FG-IN' || p.ts > end) continue;
    finished++;
    if (!vinsWithNc.has(p.vin)) firstPass++;
  }
  const quality = finished > 0 ? firstPass / finished : 1;
  return {
    shift,
    elapsedMin,
    done,
    planToNow,
    areaDone,
    oee: { value: availability * performance * quality, availability, performance, quality, stopMin, plannedMin: elapsedMin },
    defects: { pct: inspected > 0 ? defects / inspected : 0, defects, inspected, worst, byArea },
  };
}

/** Простой критического оборудования за сутки (внеплановый), мин — против лимита 60 */
export function criticalDowntimeToday(state: TwinState, now: number, cfg: TwinConfig, dayStart: number): { minutes: number; items: Interval[] } {
  const plc = state.plcConnected(now);
  const items: Interval[] = [];
  for (const area of PRODUCING) {
    for (const i of stopIntervals(state, area, dayStart, now, cfg, plc)) {
      if (i.kind === 'maintenance' && /план|наряд/i.test(i.label)) continue;
      // считаем только остановки, привязанные к критическому оборудованию
      if (!i.equipmentId || !EQUIPMENT_BY_ID[i.equipmentId]?.critical) continue;
      items.push(i);
    }
  }
  return { minutes: items.reduce((s, i) => s + (i.to - i.from) / 60_000, 0), items };
}

/** Неучтённые потери: остановки, которые зафиксировали контроллеры, но нет в записях 1С:MES */
export function unaccountedLosses(state: TwinState, now: number, dayStart: number): { autoMin: number; mesMin: number; unaccountedMin: number; microCount: number } | null {
  if (!state.plcConnected(now)) return null;
  let autoMin = 0;
  let microCount = 0;
  for (const a of state.autoStops) {
    const end = a.to ?? now;
    if (end <= dayStart || a.from >= now) continue;
    const m = (Math.min(end, now) - Math.max(a.from, dayStart)) / 60_000;
    autoMin += m;
    if (end - a.from < 5 * 60_000) microCount++;
  }
  let mesMin = 0;
  for (const d of state.downtimes.values()) {
    const end = d.to ?? now;
    if (end <= dayStart || d.from >= now || d.category === 'planned') continue;
    mesMin += (Math.min(end, now) - Math.max(d.from, dayStart)) / 60_000;
  }
  return { autoMin, mesMin, unaccountedMin: Math.max(0, autoMin - mesMin), microCount };
}
