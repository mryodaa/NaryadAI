// Паспорт автомобиля: маршрут кузова по постам со временем прохода и условиями в момент прохода,
// отметки контроля качества. Ключевая фишка двойника — у каждой машины видна история изготовления.
import { DEFECT_BY_ID, EQUIPMENT_BY_ID, MODEL_BY_ID, POST_BY_ID, CHECKPOINTS, toPlantIso, type AreaId, type CanonicalEvent, type ModelId, type SourceId, type Tone } from '@allur/contracts';
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
}

const DECISION_RU: Record<string, string> = { rework: 'доработка', repaint: 'повторная окраска', scrap: 'списание' };

export function buildPassport(state: TwinState, vin: string, events: CanonicalEvent[], cfg: TwinConfig, now: number): Passport | null {
  const passes = events.filter((e): e is Extract<CanonicalEvent, { type: 'post_passed' }> => e.type === 'post_passed').sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (!passes.length) return null;
  const model = passes[0]!.payload.model;
  const steps: PassportStep[] = passes.map((p) => {
    const ts = Date.parse(p.ts);
    const post = POST_BY_ID[p.payload.post];
    const conditions: PassportStep['conditions'] = [];
    const eqId = p.equipmentId ?? post?.equipmentId;
    if (eqId === 'BOOTH-02' || eqId === 'BOOTH-01') {
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
        conditions.push({ label: EQUIPMENT_BY_ID[eqId]?.name ?? eqId, value: `${stop.status === 'fault' ? 'авария' : 'обслуживание'} незадолго до прохода${stop.code ? `, код ${stop.code}` : ''}`, tone: 'attention', source: 'plc' });
      }
      const interval = EQUIPMENT_BY_ID[eqId]?.serviceIntervalCycles;
      const s = state.eq[eqId];
      if (interval && s?.cycles !== null && s?.cycles !== undefined && s.cyclesTs !== null && Math.abs(s.cyclesTs - ts) < 2 * 3600_000) {
        conditions.push({ label: 'Наработка робота', value: `${num(s.cycles)} из ${num(interval)} циклов`, tone: s.cycles / interval > 0.9 ? 'maintenance' : 'neutral', source: 'plc' });
      }
    }
    return { post: p.payload.post, postName: post?.name ?? p.payload.post, area: p.area, at: p.ts, conditions };
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
  const last = passes[passes.length - 1]!;
  const lastPost = POST_BY_ID[last.payload.post];
  return {
    vin,
    model,
    modelName: MODEL_BY_ID[model]?.name ?? model,
    where: last.payload.post === 'FG-IN' ? 'Выпущен: на складе готовой продукции' : `Сейчас: после поста «${lastPost?.name ?? last.payload.post}»`,
    steps,
    checks,
    plcConnected: state.plcConnected(now),
  };
  void toPlantIso;
}
