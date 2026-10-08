// Планировка 3D из конфигурации: полосы параллельных станций, оборудование в стороне, поток кузовов.
import { describe, expect, it } from 'vitest';
import { SEED_PLANT, derivePlant, type PlantConfig } from '@allur/contracts/ref';
import { BODY, buildLayout, LANE_GAP } from './layout';
import type { BodyView } from '@allur/contracts/ref';
import { placeBodies } from './flow';

const SEED = derivePlant(SEED_PLANT);

describe('планировка исходного цеха', () => {
  const layout = buildLayout(SEED);

  it('три сварочные линии — полосами поперёк потока, у каждой 4 поста; доводка — общая на выходе', () => {
    const weld = layout.pipes.weld!;
    expect(weld.lanes.map((l) => l.z)).toEqual([-LANE_GAP, 0, LANE_GAP]);
    expect(weld.lanes.map((l) => l.spots.length)).toEqual([4, 4, 4]);
    expect(weld.inlet).toHaveLength(0);
    expect(weld.outlet).toHaveLength(1);
    expect(weld.outlet[0]!.z).toBe(0);
    // доводка — после всех полос
    expect(weld.outlet[0]!.x).toBeGreaterThan(Math.max(...weld.lanes.flatMap((l) => l.spots.map((s) => s.x))));
    // доля полос — по плану моделей: Onix больше половины
    expect(weld.lanes[0]!.weight).toBeCloseTo(2500 / 4800, 3);
    // роботы — по обе стороны своей полосы
    const abb05 = layout.equipment.find((e) => e.id === 'ABB-05')!;
    expect(Math.abs(abb05.z - weld.lanes[1]!.z)).toBeCloseTo(3.1, 5);
  });

  it('окраска и сборка — одна полоса по центру; все посты потока на своих местах', () => {
    expect(layout.pipes.paint!.lanes).toHaveLength(1);
    expect(layout.pipes.assembly!.lanes[0]!.spots).toHaveLength(11);
    for (const p of SEED.production.flatMap((s) => s.posts)) expect(layout.postSpots[p], p).toBeDefined();
  });

  it('лаборатория, полировка и полигон — у края зоны, в стороне от линии', () => {
    const side = (id: string) => layout.sides.find((s) => s.equipmentId === id)!;
    expect(layout.sides.map((s) => s.equipmentId)).toEqual(['GEO-LAB', 'POLISH', 'QC-TRACK']);
    const weld = layout.zones.weld!;
    expect(Math.abs(side('GEO-LAB').z)).toBeGreaterThan(6);
    expect(side('GEO-LAB').z).toBeGreaterThan(weld.z0);
    expect(side('GEO-LAB').spots).toHaveLength(4);
    expect(side('QC-TRACK').spots.every((s) => s.z < layout.zones.qc!.z0)).toBe(true);
    // зоны идут по потоку без наложений
    const xs = layout.stages.map((s) => layout.zones[s.id]!);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!.x0).toBeGreaterThan(xs[i - 1]!.x1);
  });

  it('параллельные камеры окраски — отдельные полосы', () => {
    const c = JSON.parse(JSON.stringify(SEED_PLANT)) as PlantConfig;
    const paint = c.stages.find((s) => s.id === 'paint')!;
    const [b1, b2] = paint.stations[0]!.equipment;
    paint.stations = [
      { id: 'paint-1', name: 'Камера окраски 1', equipment: [b1!] },
      { id: 'paint-2', name: 'Камера окраски 2', equipment: [b2!] },
    ];
    const l = buildLayout(derivePlant(c));
    expect(l.pipes.paint!.lanes.map((x) => x.z)).toEqual([-LANE_GAP / 2, LANE_GAP / 2]);
    expect(l.pipes.paint!.lanes.map((x) => x.weight)).toEqual([0.5, 0.5]);
  });
});

describe('места кузовов по трекеру', () => {
  const layout = buildLayout(SEED);
  let n = 0;
  const body = (loc: Partial<BodyView['loc']> & { kind: BodyView['loc']['kind']; stageId: string }, model: BodyView['model'] = 'onix'): BodyView => ({
    bodyId: `B-${String(++n).padStart(5, '0')}`,
    vin: null,
    model,
    color: null,
    loc: { precision: 'station', estimated: false, ...loc },
    since: '2026-10-07T10:00:00+05:00',
    normSec: 228,
    visual: [],
    flags: [],
    order: n,
  });

  it('у оборудования — на его посту, на своей сварочной линии', () => {
    const a = body({ kind: 'station', stageId: 'weld', equipmentId: 'ABB-05', postId: 'WELD-6' }, 'cobalt');
    const spots = placeBodies([a], layout);
    expect(spots.get(a.bodyId)).toEqual(layout.postSpots['WELD-6']);
    expect(spots.get(a.bodyId)!.z).toBe(layout.pipes.weld!.lanes[1]!.z);
  });

  it('в буфере — по порядку прихода, на складе — паллеты, в лаборатории — на её местах', () => {
    const q = [body({ kind: 'buffer', stageId: 'weld', bufferId: 'weld-paint' }), body({ kind: 'buffer', stageId: 'weld', bufferId: 'weld-paint' })];
    const kit = body({ kind: 'warehouse', stageId: 'warehouse' });
    const lab = body({ kind: 'station', stageId: 'weld', equipmentId: 'GEO-LAB', postId: 'GEO-IN' });
    const spots = placeBodies([q[1]!, kit, lab, q[0]!], layout);
    expect(spots.get(q[0]!.bodyId)).toEqual(layout.segSpots['weld-paint']![0]);
    expect(spots.get(q[1]!.bodyId)).toEqual(layout.segSpots['weld-paint']![1]);
    expect(spots.get(kit.bodyId)).toEqual(layout.kitQueue[0]);
    expect(spots.get(lab.bodyId)).toEqual(layout.sides.find((x) => x.equipmentId === 'GEO-LAB')!.spots[0]);
  });

  it('несколько кузовов на одном посту (оценка, перекраска) — не друг в друге и не в соседнем посту', () => {
    const a = body({ kind: 'stage', stageId: 'paint', equipmentId: 'BOOTH-02', postId: 'PAINT-B2', precision: 'stage', estimated: true });
    const b = body({ kind: 'stage', stageId: 'paint', equipmentId: 'BOOTH-02', postId: 'PAINT-B2', precision: 'stage', estimated: true });
    const c = body({ kind: 'station', stageId: 'paint', equipmentId: 'BOOTH-01', postId: 'PAINT-B1', precision: 'station', estimated: false });
    const spots = placeBodies([a, b, c], layout);
    const all = [a, b, c].map((v) => spots.get(v.bodyId)!);
    // первый пришедший — на посту, остальные — на свободном месте рядом
    expect(all[0]).toEqual(layout.postSpots['PAINT-B2']);
    expect(all[2]).toEqual(layout.postSpots['PAINT-B1']);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const p = all[i]!;
        const q = all[j]!;
        expect(Math.abs(p.x - q.x) >= BODY.length || Math.abs(p.z - q.z) >= BODY.width).toBe(true);
      }
  });
});
