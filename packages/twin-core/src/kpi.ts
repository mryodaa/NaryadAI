// Показатели смены (раздел 9.2): выпуск к этому моменту, OEE из трёх частей, брак, простои.
import { shiftAt, type AreaId, type ShiftRef } from '@allur/contracts';
import type { TwinConfig } from './config';
import type { TwinState } from './state';
import { equipmentName, inspectionPass, outputStage, qualityStages } from './plant';

export interface Interval {
  from: number;
  to: number;
  kind: 'fault' | 'maintenance' | 'waiting';
  label: string;
  source: 'plc' | 'mes' | 'master' | 'inferred';
  equipmentId?: string;
  micro?: boolean;
  /** Встала одна из параллельных станций — участок при этом работает */
  partial?: boolean;
}

/**
 * Когда участок стоял: по контроллерам (точно, включая микропростои), иначе по записям 1С:MES
 * и по разрывам в проходе VIN дольше 3 тактов.
 */
export function stopIntervals(state: TwinState, area: AreaId, from: number, to: number, cfg: TwinConfig, plc: boolean): Interval[] {
  const out: Interval[] = [];
  const stage = state.plant.stageById.get(area);
  // у участка с несколькими параллельными станциями остановка одной станции — не остановка участка
  const partialOf = (equipmentId: string) => !!stage && stage.stations.length > 1 && state.plant.equipmentById.get(equipmentId)?.place === 'station';
  if (plc) {
    for (const a of state.autoStops) {
      if (a.area !== area) continue;
      const end = a.to ?? to;
      if (end <= from || a.from >= to) continue;
      const name = equipmentName(state.plant, a.equipmentId);
      const partial = partialOf(a.equipmentId);
      out.push({
        from: Math.max(from, a.from),
        to: Math.min(to, end),
        kind: a.status,
        label: `${name}: ${lowerFirst(a.text ?? (a.status === 'fault' ? 'авария' : 'обслуживание'))}`,
        source: 'plc',
        equipmentId: a.equipmentId,
        micro: end - a.from < 5 * 60_000,
        ...(partial ? { partial: true } : {}),
      });
    }
  }
  for (const d of state.downtimes.values()) {
    if (d.area !== area) continue;
    const end = d.to ?? to;
    if (end <= from || d.from >= to) continue;
    // если контроллеры подключены, их интервалы точнее записей мастера
    if (plc && out.some((o) => o.equipmentId === d.equipmentId && overlap(o, { from: d.from, to: end }))) continue;
    const name = equipmentName(state.plant, d.equipmentId);
    out.push({
      from: Math.max(from, d.from),
      to: Math.min(to, end),
      kind: d.category === 'planned' ? 'maintenance' : d.category === 'no_parts' ? 'waiting' : 'fault',
      label: d.category === 'no_parts' ? d.reason : `${name}: ${d.reason.toLowerCase()}`,
      source: d.source === 'master' ? 'master' : 'mes',
      equipmentId: d.equipmentId,
      ...(d.category !== 'no_parts' && partialOf(d.equipmentId) ? { partial: true } : {}),
    });
  }
  if (!plc) {
    // разрывы в проходе VIN, которые не объяснены записями
    if (stage?.producing) {
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
  /** Выпуск участков за смену; у склада готовой продукции — принято */
  areaDone: Record<AreaId, number>;
  oee: { value: number; availability: number; performance: number; quality: number; stopMin: number; plannedMin: number };
  defects: { pct: number; defects: number; inspected: number; worst: { area: AreaId; share: number } | null; byArea: Partial<Record<AreaId, { defects: number; inspected: number }>> };
}

export function shiftKpis(state: TwinState, now: number, cfg: TwinConfig, shift: ShiftRef | null = shiftAt(now)): ShiftKpis {
  const plant = state.plant;
  const finishedId = plant.warehouseOut?.id;
  const areaDone: Record<AreaId, number> = {};
  for (const st of plant.production) areaDone[st.id] = 0;
  if (finishedId) areaDone[finishedId] = 0;
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
  for (const st of plant.production) areaDone[st.id] = state.stageDone(shift.key, st.id);
  if (finishedId) areaDone[finishedId] = state.stageDone(shift.key, finishedId);
  const done = finishedId ? areaDone[finishedId]! : 0;
  const planToNow = Math.min(cfg.shiftPlan, Math.floor(elapsedMin / cfg.taktMin));

  // Брак смены: несоответствия на проверках сварки, окраски и сборки
  const byArea: ShiftKpis['defects']['byArea'] = {};
  let inspected = 0;
  let defects = 0;
  for (const stage of qualityStages(plant)) {
    const area = stage.id;
    const insp = inspectionPass(plant, stage);
    const ins = !insp ? 0 : insp.kind === 'entry' ? state.entered(shift.key, insp.area) : state.stageDone(shift.key, insp.area);
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
  const out = outputStage(plant);
  const stops = out ? stopIntervals(state, out.id, shift.startMs, end, cfg, plc).filter((i) => !i.partial) : [];
  const stopMin = Math.min(elapsedMin, totalMinutes(stops));
  const runMin = Math.max(1, elapsedMin - stopMin);
  const availability = elapsedMin > 0 ? runMin / elapsedMin : 1;
  const performance = Math.min(1, ((out ? areaDone[out.id]! : 0) * cfg.taktMin) / runMin);
  const vinsWithNc = new Set(state.nc.filter((n) => n.vin && n.ts >= shift.startMs - 8 * 3600_000).map((n) => n.vin!));
  let firstPass = 0;
  let finished = 0;
  for (let i = state.passes.length - 1; i >= 0; i--) {
    const p = state.passes[i]!;
    if (p.ts < shift.startMs) break;
    if (p.ts > end || !state.isFinishPass(p)) continue;
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
  for (const stage of state.plant.production) {
    for (const i of stopIntervals(state, stage.id, dayStart, now, cfg, plc)) {
      if (i.kind === 'maintenance' && /план|наряд/i.test(i.label)) continue;
      // считаем только остановки, привязанные к критическому оборудованию
      if (!i.equipmentId || !state.plant.equipmentById.get(i.equipmentId)?.critical) continue;
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
