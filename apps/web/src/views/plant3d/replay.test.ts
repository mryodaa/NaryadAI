import { describe, expect, it } from 'vitest';
import { OPERATIONS, SEED_MODEL, modelOperations, type BodyDetail, type BodyRouteStepView } from '@allur/contracts/ref';
import { buildLayout } from './layout';
import { buildReplay, sampleReplay } from './replay';

const plant = SEED_MODEL;
const layout = buildLayout(plant);
const at = (hm: string) => `2026-10-07T${hm}:00+05:00`;

/** Машина прошла склад, сварку и окраску; на окраске точное время есть только у операций */
function detail(): BodyDetail {
  const ops = modelOperations(plant, 'onix');
  const done = new Set(['warehouse', 'weld', 'paint']);
  let minute = 8 * 60;
  const route: BodyRouteStepView[] = ops.map((s) => {
    const ok = done.has(s.stageId) && !s.optional;
    const hm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    if (ok) minute += 3;
    return {
      operation: s.operation,
      name: OPERATIONS[s.operation]?.name ?? s.operation,
      stageId: s.stageId,
      equipmentId: s.equipmentId,
      postId: s.postId,
      status: ok ? 'done' : s.optional ? 'skipped' : 'waiting',
      at: ok ? at(hm) : null,
      by: ok ? (s.stageId === 'weld' ? 'stage_exit' : 'operation') : null,
      source: ok ? 'plc' : null,
      effect: s.effect,
      optional: s.optional,
      loop: 0,
    };
  });
  return {
    bodyId: 'B-1',
    vin: 'KZACN1S11TK004800',
    model: 'onix',
    color: { code: 'R04', name: 'Красный', hex: '#b3261e', finish: 'solid' },
    loc: { kind: 'buffer', stageId: 'paint', bufferId: 'paint-assembly', precision: 'stage', estimated: false },
    since: at('10:00'),
    normSec: null,
    visual: [],
    flags: [],
    order: 1,
    plannedSeq: 1,
    trim: null,
    stages: [
      { stageId: 'warehouse', loop: 0, in: at('07:50'), out: at('08:00') },
      { stageId: 'weld', loop: 0, in: at('08:00'), out: at('08:40') },
      { stageId: 'paint', loop: 0, in: at('08:50'), out: at('09:40') },
    ],
    route,
    history: [],
  };
}

describe('повтор истории машины', () => {
  const r = buildReplay(detail(), layout, plant)!;

  it('кадры по постам со временем по порядку; вид кузова меняется по этапам', () => {
    expect(r.frames.length).toBeGreaterThan(8);
    for (let i = 1; i < r.frames.length; i++) expect(r.frames[i]!.u).toBeGreaterThanOrEqual(r.frames[i - 1]!.u);
    const looks = [...new Set(r.frames.map((f) => f.look.kind))];
    expect(looks[0]).toBe('kit');
    expect(looks).toContain('metal');
    expect(looks[looks.length - 1]).toBe('paint');
    expect(r.frames[r.frames.length - 1]!.look.color).toBe('#b3261e');
  });

  it('начало — у склада, конец — на последнем посту окраски; часы идут вперёд', () => {
    const s0 = sampleReplay(r, 0);
    const s1 = sampleReplay(r, 1);
    expect(s0.frame.stageId).toBe('warehouse');
    expect(s1.frame.stageId).toBe('paint');
    expect(s1.at).toBeGreaterThan(s0.at);
    const mid = sampleReplay(r, 0.5);
    expect(Number.isFinite(mid.x) && Number.isFinite(mid.z)).toBe(true);
  });
});
