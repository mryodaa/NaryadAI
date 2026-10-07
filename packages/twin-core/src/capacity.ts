// Пропускная способность участков по составу цеха. Номинальная — по норме цикла: параллельные
// станции складываются, общее оборудование на входе и выходе ограничивает сверху. Фактическая —
// с учётом простоев участка за 30 дней и доли перекраски. Узкое место — наименьшая фактическая.
import { DEFAULT_MIX, addDays, plantParts, shiftsBetweenDates, stageNominal, type ModelMix, type PlantModel, type PlantStage } from '@allur/contracts';
import type { TwinConfig } from './config';
import type { TwinState } from './state';

export interface StageCapacityView {
  stageId: string;
  name: string;
  stations: number;
  /** По норме цикла, кузовов в смену */
  nominalPerShift: number;
  /** Доля рабочего времени без простоев участка за 30 дней */
  availability: number;
  /** Доля кузовов, которые участок красит повторно (окраска) */
  reworkShare: number;
  /** С учётом простоев и перекраски, кузовов в смену */
  effectivePerShift: number;
  /** Общее оборудование, которое ограничивает участок сильнее суммы станций */
  limitedBy: string | null;
}

export interface PlantCapacityView {
  stages: StageCapacityView[];
  bottleneck: { stageId: string; name: string; perShift: number } | null;
}

/** Мощность цеха (по умолчанию — текущего состава; можно посчитать вариант состава на той же истории) */
export function plantCapacity(state: TwinState, now: number, cfg: TwinConfig, plant: PlantModel = state.plant): PlantCapacityView {
  const today = plantParts(now).date;
  const shifts = shiftsBetweenDates(addDays(today, -30), today).filter((s) => s.endMs <= now);
  const workedMin = Math.max(1, shifts.length * 480);
  const from = now - 30 * 86_400_000;
  const mix = planMix(state);
  const stages = plant.production.map((st) => stageCapacity(state, st, now, from, workedMin, cfg, mix));
  let bottleneck: PlantCapacityView['bottleneck'] = null;
  for (const s of stages) {
    if (s.nominalPerShift <= 0) continue;
    if (!bottleneck || s.effectivePerShift < bottleneck.perShift) bottleneck = { stageId: s.stageId, name: s.name, perShift: s.effectivePerShift };
  }
  return { stages, bottleneck };
}

/** Состав моделей в плане месяца (1С:ERP); нет плана — план из выданных данных */
export function planMix(state: TwinState): ModelMix {
  const plan = [...state.plans.values()].pop();
  if (!plan) return DEFAULT_MIX;
  return Object.fromEntries(plan.models.map((m) => [m.model, m.qty])) as ModelMix;
}

function stageCapacity(state: TwinState, st: PlantStage, now: number, from: number, workedMin: number, cfg: TwinConfig, mix: ModelMix): StageCapacityView {
  const nominal = stageNominal(st, 480, mix);
  // Простои участка: нехватка комплектов — не потеря мощности самого участка; остановка одной из N станций — 1/N
  let downMin = 0;
  for (const d of state.downtimes.values()) {
    if (d.area !== st.id || d.from < from || d.from > now || d.category === 'no_parts') continue;
    const end = d.to ?? Math.min(now, d.from + 60 * 60_000);
    const eq = st.equipment.find((e) => e.id === d.equipmentId);
    // то, что в стороне, мощность участка не снижает; остановка одной из N станций — 1/N
    const share = eq?.place === 'side' ? 0 : eq && eq.place === 'station' && st.stations.length > 1 ? 1 / st.stations.length : 1;
    downMin += (Math.max(0, end - d.from) / 60_000) * share;
  }
  const availability = Math.max(0.5, Math.min(1, 1 - downMin / workedMin));
  let rework = 0;
  if (st.kind === 'painting') {
    let defects = 0;
    let produced = 0;
    for (const q of state.quality.values()) {
      if (q.area !== st.id) continue;
      const at = Date.parse(`${q.date}T12:00:00+05:00`);
      if (at < from || at > now) continue;
      defects += q.defects;
      produced += q.produced;
    }
    rework = produced > 0 ? Math.min(0.5, defects / produced) : 0;
  }
  const nominalPerShift = nominal?.perShift ?? 0;
  void cfg;
  return {
    stageId: st.id,
    name: st.short,
    stations: st.stations.length,
    nominalPerShift,
    availability,
    reworkShare: rework,
    effectivePerShift: nominalPerShift * availability * (1 - rework),
    limitedBy: nominal?.limitedBy ?? null,
  };
}
