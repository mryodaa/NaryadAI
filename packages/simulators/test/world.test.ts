// Модель цеха по конфигурации: последовательные посты, параллельные станции, перестройка на ходу.
import { describe, expect, it } from 'vitest';
import { SEED_PLANT, plantMs, type EquipmentConfig, type PlantConfig } from '@allur/contracts';
import { setupScenario } from '../src/scenarios';
import { World, type WorldEvent } from '../src/world';

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return plantMs('2026-10-07', h! * 60 + m!);
};
const booth = (n: number): EquipmentConfig => ({
  id: `BOOTH-0${n}`,
  type: 'paint_booth',
  name: `Камера-0${n}`,
  critical: true,
  cycleTimeSec: 468,
  posts: [{ id: `PAINT-B${n}`, name: `Камера-0${n}` }],
  connection: { method: 'simulator', status: 'not_connected' },
});
function paintWith(booths: number): PlantConfig {
  const c = JSON.parse(JSON.stringify(SEED_PLANT)) as PlantConfig;
  const p = c.stages.find((s) => s.id === 'paint')!;
  p.stations = Array.from({ length: booths }, (_, i) => ({ id: `paint-${i + 1}`, name: `Камера окраски ${i + 1}`, equipment: [booth(i + 1)] }));
  for (const e of [...p.inlet!, ...p.outlet!]) if (e.type !== 'polishing') e.cycleTimeSec = 156;
  return c;
}

function run(world: World, until: string, events: WorldEvent[] = []) {
  while (world.t + 10_000 <= at(until)) {
    world.step(10_000);
    events.push(...world.drain());
  }
  return events;
}

/** Какие камеры прошёл каждый кузов, вошедший в окраску после старта и вышедший из неё */
function boothsByBody(events: WorldEvent[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const entered = new Set<string>();
  const done = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'pass') continue;
    if (e.post === 'PAINT-PRE') entered.add(e.vin);
    if (e.post === 'PAINT-OVEN') done.add(e.vin);
    if (/^PAINT-B\d$/.test(e.post)) out.set(e.vin, [...(out.get(e.vin) ?? []), e.post]);
  }
  return new Map([...out].filter(([vin]) => entered.has(vin) && done.has(vin)));
}

describe('модель цеха по конфигурации', () => {
  const preset = () => setupScenario('normal', 7).preset;

  it('исходный цех: кузов проходит Камеру-01, затем Камеру-02', () => {
    const w = new World(preset(), SEED_PLANT);
    const byBody = boothsByBody(run(w, '12:00'));
    expect(byBody.size).toBeGreaterThan(40);
    for (const posts of byBody.values()) expect(posts.slice(0, 2)).toEqual(['PAINT-B1', 'PAINT-B2']);
  });

  it('две параллельные камеры: кузов проходит одну, работают обе, выпуск не падает', () => {
    const w = new World(preset(), paintWith(2));
    const events = run(w, '12:00');
    const byBody = boothsByBody(events);
    const first = [...byBody.values()].map((posts) => posts[0]);
    expect(first.filter((p) => p === 'PAINT-B1').length).toBeGreaterThan(10);
    expect(first.filter((p) => p === 'PAINT-B2').length).toBeGreaterThan(10);
    // перекраска возвращает кузов в камеру ещё раз, обычный кузов проходит ровно одну
    expect([...byBody.values()].filter((p) => p.length === 1).length).toBeGreaterThan(byBody.size * 0.8);
    const fg = events.filter((e) => e.kind === 'enter' && e.area === 'finished').length;
    expect(fg).toBeGreaterThan(50);
  });

  it('третья камера, добавленная на ходу, начинает принимать кузова', () => {
    const w = new World(preset(), paintWith(2));
    run(w, '10:00');
    w.reconfigure(paintWith(3));
    const events = run(w, '13:00');
    expect(events.some((e) => e.kind === 'pass' && e.post === 'PAINT-B3')).toBe(true);
    // убрали камеру — кузова с её поста вернулись в очередь, цех продолжает работать
    w.reconfigure(paintWith(1));
    const after = run(w, '15:00');
    expect(after.some((e) => e.kind === 'pass' && e.post === 'PAINT-B3')).toBe(false);
    expect(after.filter((e) => e.kind === 'enter' && e.area === 'finished').length).toBeGreaterThan(10);
  });
});

describe('потоки по моделям и выборочные операции (исходный цех по открытым данным)', () => {
  const preset = () => setupScenario('normal', 7).preset;
  const LINE_OF: Record<string, string> = { onix: 'WELD-1,WELD-2,WELD-3,WELD-4', cobalt: 'WELD-5,WELD-6,WELD-7,WELD-8', j7: 'WELD-9,WELD-10,WELD-11,WELD-12' };

  it('кузов каждой модели проходит свою сварочную линию, затем общую доводку', () => {
    const events = run(new World(preset(), SEED_PLANT), '12:00');
    const weldPosts = new Map<string, { model: string; posts: string[] }>();
    for (const e of events) {
      if (e.kind !== 'pass' || !/^WELD-\d+$/.test(e.post)) continue;
      const r = weldPosts.get(e.vin) ?? { model: e.model, posts: [] };
      r.posts.push(e.post);
      weldPosts.set(e.vin, r);
    }
    const full = [...weldPosts.values()].filter((r) => r.posts.length === 4);
    expect(full.length).toBeGreaterThan(40);
    for (const r of full) expect(r.posts.join()).toBe(LINE_OF[r.model]);
    expect(new Set(full.map((r) => r.model))).toEqual(new Set(['onix', 'cobalt', 'j7']));
    expect(events.filter((e) => e.kind === 'pass' && e.post === 'WELD-FIN').length).toBeGreaterThan(40);
  });

  it('нет машинокомплектов J7 — стоит только линия J7, остальные работают', () => {
    const p = preset();
    const w = new World({ ...p, kitShifts: { ...p.kitShifts, 'KIT-J7-HARNESS': 0 } }, SEED_PLANT);
    const events = run(w, '11:00');
    const started = (posts: string) => events.filter((e) => e.kind === 'pass' && e.post === posts.split(',')[0] && e.t > at('08:30')).length;
    expect(started(LINE_OF.j7!)).toBe(0);
    expect(started(LINE_OF.onix!)).toBeGreaterThan(10);
    expect(started(LINE_OF.cobalt!)).toBeGreaterThan(8);
    const stop = events.find((e) => e.kind === 'downtime_start' && e.info.category === 'no_parts');
    expect(stop && stop.kind === 'downtime_start' ? [stop.info.equipmentId, stop.info.reason] : null).toEqual(['ABB-08', 'Нет машинокомплектов: жгуты проводов j7']);
  });

  it('лаборатория геометрии берёт каждый 25-й кузов на 3–4 часа и возвращает в поток; полигон — выборочно', () => {
    const events = run(new World(preset(), SEED_PLANT), '16:00');
    const passes = (post: string) => events.filter((e): e is Extract<WorldEvent, { kind: 'pass' }> => e.kind === 'pass' && e.post === post);
    const side = (kind: 'arrive' | 'leave', eq: string) => events.filter((e): e is Extract<WorldEvent, { kind: 'arrive' | 'leave' }> => e.kind === kind && e.equipmentId === eq);
    const fin = passes('WELD-FIN').length;
    const into = side('arrive', 'GEO-LAB');
    const back = side('leave', 'GEO-LAB');
    expect(into.length).toBe(Math.floor(fin / 25));
    expect(back.length).toBeGreaterThan(0);
    for (const b of back) {
      const a = into.find((x) => x.body.bodyId === b.body.bodyId)!;
      expect((b.t - a.t) / 60_000).toBeGreaterThanOrEqual(180);
    }
    // вернувшийся из лаборатории кузов идёт дальше — в окраску
    expect(passes('PAINT-PRE').some((e) => e.vin === back[0]!.body.vin)).toBe(true);
    const qc = passes('QC-1').length;
    const track = side('arrive', 'QC-TRACK').length;
    expect(track).toBeGreaterThan(0);
    expect(track).toBeLessThan(qc * 0.3);
  });
});
