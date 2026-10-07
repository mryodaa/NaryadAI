// Паспорт автомобиля: маршрут кузова по постам со временем прохода и условиями в момент прохода,
// отметки контроля качества. Ключевая фишка двойника — у каждой машины видна история изготовления.
import { DEFECT_BY_ID, MODEL_BY_ID, CHECKPOINTS, toPlantIso, type AreaId, type BodyDetail, type CanonicalEvent, type ModelId, type SourceId, type Tone } from '@allur/contracts';
import type { TwinConfig } from './config';
import type { TwinState } from './state';
import { num } from './text';

export interface PassportStep {
  post: string;
  postName: string;
  area: AreaId;
  at: string;
  conditions: { label: string; value: string; tone: Tone; source: SourceId }[];
}

export interface PassportCheck {
  at: string;
  checkpoint: string;
  defect: string;
  decision: string;
  source: SourceId;
}

export interface Passport {
  vin: string;
  model: ModelId | null;
  modelName: string;
  where: string;
  steps: PassportStep[];
  checks: PassportCheck[];
  plcConnected: boolean;
  /** Кузов по трекеру: маршрут операций, история отметок, флаги */
  body: BodyDetail | null;
}

const DECISION_RU: Record<string, string> = { rework: 'доработка', repaint: 'повторная окраска', scrap: 'списание' };

export function buildPassport(state: TwinState, vin: string, events: CanonicalEvent[], cfg: TwinConfig, now: number): Passport | null {
  const tracked = state.tracker.find(vin);
  if (!tracked) return null;
  const body = state.tracker.detail(tracked, now);
  const plant = state.plant;
  // шаги паспорта — отметки кузова: вход и выход участков, оборудование (RFID, ПЛК, 1С:MES)
  const marks = tracked.history.filter((h) => h.kind === 'checkpoint' || h.kind === 'restored' || h.kind === 'rework');
  const steps: PassportStep[] = marks.map((h) => {
    const ts = h.ts;
    const conditions: PassportStep['conditions'] = [];
    const eqId = h.equipmentId;
    const eq = eqId ? plant.equipmentById.get(eqId) : undefined;
    if (eqId && eq?.type.fields.includes('filterDpPa')) {
      const dp = state.valueAt(eqId, 'filter_dp_pa', ts);
      if (dp !== null) {
        conditions.push({
          label: 'Перепад на фильтре',
          value: `${num(dp)} Па (норма до ${cfg.filter.normPa})`,
          tone: dp > cfg.filter.dirtyPa ? 'attention' : 'neutral',
          source: 'plc',
        });
      }
    }
    if (eqId) {
      const stop = state.autoStops.find((a) => a.equipmentId === eqId && a.from <= ts && (a.to ?? now) >= ts - 5 * 60_000 && a.from >= ts - 30 * 60_000);
      if (stop) {
        conditions.push({ label: eq?.name ?? eqId, value: `${stop.status === 'fault' ? 'авария' : 'обслуживание'} незадолго до прохода${stop.code ? `, код ${stop.code}` : ''}`, tone: 'attention', source: 'plc' });
      }
      const interval = eq?.type.serviceIntervalCycles;
      const s = state.eq[eqId];
      if (interval && s?.cycles !== null && s?.cycles !== undefined && s.cyclesTs !== null && Math.abs(s.cyclesTs - ts) < 2 * 3600_000) {
        conditions.push({ label: 'Наработка робота', value: `${num(s.cycles)} из ${num(interval)} циклов`, tone: s.cycles / interval > 0.9 ? 'maintenance' : 'neutral', source: 'plc' });
      }
    }
    return { post: h.checkpointId ?? h.stageId ?? '', postName: h.text, area: h.stageId ?? '', at: toPlantIso(ts), conditions };
  });
  const checks: PassportCheck[] = events
    .filter((e): e is Extract<CanonicalEvent, { type: 'nonconformity' }> => e.type === 'nonconformity')
    .map((n) => ({
      at: n.ts,
      checkpoint: CHECKPOINTS.find((c) => c.id === n.payload.checkpoint)?.name ?? n.payload.checkpoint,
      defect: DEFECT_BY_ID[n.payload.defect]?.name ?? n.payload.defect,
      decision: DECISION_RU[n.payload.decision] ?? n.payload.decision,
      source: n.source,
    }));
  const loc = body.loc;
  const stage = plant.stageById.get(loc.stageId);
  const eqName = loc.equipmentId ? plant.equipmentById.get(loc.equipmentId)?.name : undefined;
  const where =
    loc.kind === 'finished'
      ? 'Выпущен: на складе готовой продукции'
      : loc.kind === 'buffer'
        ? `Сейчас: в очереди после «${stage?.short ?? loc.stageId}»`
        : loc.kind === 'warehouse'
          ? 'Сейчас: заказ принят, машинокомплект на складе'
          : `Сейчас: ${stage?.short ?? loc.stageId}${eqName ? `, ${eqName}${loc.estimated ? ' (оценка по норме времени)' : ''}` : ' (точное место не отмечено)'}`;
  return {
    vin: tracked.vin ?? tracked.bodyId,
    model: tracked.model,
    modelName: tracked.model ? MODEL_BY_ID[tracked.model].name : 'Модель не известна',
    where,
    steps,
    checks,
    plcConnected: state.plcConnected(now),
    body,
  };
}
