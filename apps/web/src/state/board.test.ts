import { describe, expect, it } from 'vitest';
import { SEED_MODEL, type BodyView } from '@allur/contracts/ref';
import { columns } from './board';

const plant = SEED_MODEL;
const NOW = Date.parse('2026-10-07T12:00:00+05:00');
const car = (bodyId: string, loc: BodyView['loc'], minAgo: number, flags: BodyView['flags'] = []): BodyView => ({
  bodyId,
  vin: null,
  model: 'onix',
  color: null,
  loc,
  since: new Date(NOW - minAgo * 60_000).toISOString(),
  stageSince: new Date(NOW - minAgo * 60_000).toISOString(),
  normSec: 240,
  visual: [],
  flags,
  order: 1,
});
const paint = { kind: 'stage' as const, stageId: 'paint', precision: 'stage' as const, estimated: false };

describe('машины по стадиям', () => {
  it('шесть колонок; очередь — в колонке стадии, куда едет; сначала проблемные, затем дольше всех', () => {
    const cols = columns(
      [
        car('A', paint, 10),
        car('B', paint, 40),
        car('C', paint, 5, ['delayed']),
        car('Q', { kind: 'buffer', stageId: 'weld', bufferId: 'weld-paint', precision: 'stage', estimated: false }, 3),
      ],
      plant,
      NOW,
    );
    expect(cols.map((c) => c.id)).toEqual(['warehouse', 'weld', 'paint', 'assembly', 'qc', 'finished']);
    const p = cols.find((c) => c.id === 'paint')!;
    expect(p.rows.map((r) => r.b.bodyId)).toEqual(['C', 'B', 'A', 'Q']);
    expect(p.rows.find((r) => r.b.bodyId === 'Q')!.queued).toBe(true);
    expect(p.avgMin).toBe(18);
    expect(p.avgNorm).toBeGreaterThan(0);
  });
});
