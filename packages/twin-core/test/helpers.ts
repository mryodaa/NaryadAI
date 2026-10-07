// Конструкторы событий для тестов: время — «HH:MM» 7 октября 2026 (завод, UTC+5).
import { makeVin, plantMs, toPlantIso, type AreaId, type CanonicalEvent, type ModelId } from '@allur/contracts';
import { Twin } from '../src/twin';
import { LEGACY_PLANT } from './legacy-plant';

export const DAY = '2026-10-07';
export const at = (hhmm: string, date = DAY) => {
  const [h, m] = hhmm.split(':').map(Number);
  return plantMs(date, h! * 60 + m!);
};
export const iso = (ms: number) => toPlantIso(ms);

let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

const AREA_OF: Record<string, AreaId> = {
  WELD: 'weld',
  GEO: 'weld',
  POLISH: 'paint',
  PAINT: 'paint',
  ASM: 'assembly',
  QC: 'qc',
  FG: 'finished',
};

export function areaOfPost(post: string): AreaId {
  return AREA_OF[post.split('-')[0]!]!;
}

export const vin = (n: number, model: ModelId = 'onix') => makeVin(model, 5000 + n);

export function pass(v: string, post: string, ts: number, model: ModelId = 'onix'): CanonicalEvent {
  return { eventId: id('mes'), source: 'mes', ts: iso(ts), area: areaOfPost(post), vin: v, type: 'post_passed', payload: { model, post } };
}

export function nc(v: string | undefined, area: AreaId, defect: string, ts: number, responsible?: AreaId): CanonicalEvent {
  return {
    eventId: id('qls'),
    source: 'qls',
    ts: iso(ts),
    area,
    vin: v,
    type: 'nonconformity',
    payload: { checkpoint: area === 'paint' ? 'CP-PAINT' : area === 'weld' ? 'CP-WELD' : 'CP-FINAL', defect, decision: area === 'paint' ? 'repaint' : 'rework', responsibleArea: responsible },
  };
}

export function plcState(equipmentId: string, area: AreaId, status: 'run' | 'idle' | 'fault' | 'maintenance', ts: number, code?: string, text?: string): CanonicalEvent {
  return { eventId: id('plc'), source: 'plc', ts: iso(ts), area, equipmentId, type: 'equipment_state', payload: { status, code, text } };
}

export function telemetry(equipmentId: string, area: AreaId, metric: 'filter_dp_pa' | 'motor_current_a' | 'vibration_mm_s', value: number, ts: number): CanonicalEvent {
  return { eventId: id('plc'), source: 'plc', ts: iso(ts), area, equipmentId, type: 'telemetry', payload: { metric, value } };
}

export function downtime(equipmentId: string, area: AreaId, reason: string, category: 'breakdown' | 'planned' | 'no_parts', from: number, to: number | null, source: 'mes' | 'master' = 'mes'): CanonicalEvent {
  return {
    eventId: id('dt'),
    source,
    ts: iso(from + 5 * 60_000),
    area,
    equipmentId,
    type: 'downtime_registered',
    payload: { reason, category, from: iso(from), to: to === null ? undefined : iso(to), registeredBy: 'Мастер' },
  };
}

export function report(date: string, shift: 1 | 2, area: 'weld' | 'paint' | 'assembly', fact: number): CanonicalEvent {
  const line = area === 'weld' ? 'Сварка-1' : area === 'paint' ? 'Окраска-1' : 'Сборка-1';
  return { eventId: `hist:r:${date}:${shift}:${area}`, source: 'mes', ts: iso(at(shift === 1 ? '16:03' : '23:59', date)), area, type: 'shift_report', payload: { date, shift, line, plan: 120, fact, hours: 8, load: 100 } };
}

export function plan(month = '2026-10', target = 5500): CanonicalEvent {
  return {
    eventId: `hist:plan:${month}`,
    source: 'erp',
    ts: '2026-10-01T07:30:00+05:00',
    area: 'finished',
    type: 'plan_set',
    payload: { month, target, models: [{ model: 'onix', qty: 2500 }, { model: 'cobalt', qty: 1800 }, { model: 'j7', qty: 500 }] },
  };
}

/** Двойник со стартом прогона в 08:00 7 октября */
export function newTwin(): Twin {
  const t = new Twin({}, LEGACY_PLANT);
  t.reset(at('07:59'));
  return t;
}

/** Ровный поток: кузов проходит все посты участка каждые 4 минуты с from до to */
export function flow(twin: Twin, posts: string[], from: number, to: number, startN = 0): number {
  let n = startN;
  for (let ts = from; ts <= to; ts += 4 * 60_000) {
    const v = vin(n++);
    posts.forEach((p, i) => twin.ingest(pass(v, p, ts + i * 1000)));
  }
  return n;
}
