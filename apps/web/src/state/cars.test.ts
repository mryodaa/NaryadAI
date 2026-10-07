import { describe, expect, it } from 'vitest';
import { OPERATIONS, SEED_MODEL, modelOperations, type BodyDetail, type BodyHistoryItem, type BodyRouteStepView, type BodyView, type BufferView } from '@allur/contracts/ref';
import { addWork, carEta, carWhere, carsOfArea, lastEvents, stageProgress, workMs } from './cars';

const plant = SEED_MODEL;
const NOW = Date.parse('2026-10-07T12:00:00+05:00');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

function body(over: Partial<BodyView> & { loc: BodyView['loc'] }): BodyView {
  return {
    bodyId: 'B-1',
    vin: 'KZACN1S11TK004800',
    model: 'onix',
    color: { code: 'W01', name: 'Белый', hex: '#eeeeea', finish: 'solid' },
    since: iso(NOW - 10 * MIN),
    normSec: null,
    visual: [],
    flags: [],
    order: 1,
    ...over,
  };
}

/** Маршрут Onix: всё до участка `upTo` выполнено */
function route(doneStages: string[]): BodyRouteStepView[] {
  return modelOperations(plant, 'onix').map((s) => ({
    operation: s.operation,
    name: OPERATIONS[s.operation]?.name ?? s.operation,
    stageId: s.stageId,
    equipmentId: s.equipmentId,
    postId: s.postId,
    status: doneStages.includes(s.stageId) ? (s.optional ? 'skipped' : 'done') : 'waiting',
    at: doneStages.includes(s.stageId) ? iso(NOW - 60 * MIN) : null,
    by: null,
    source: null,
    effect: s.effect,
    optional: s.optional,
    loop: 0,
  }));
}

function detail(v: BodyView, doneStages: string[], startedMinAgo = 120): BodyDetail {
  const history: BodyHistoryItem[] = [{ at: iso(NOW - startedMinAgo * MIN), kind: 'checkpoint', text: 'Вход сварки', stageId: 'weld', method: 'mes_scan', source: 'mes' }];
  return { ...v, plannedSeq: 1, trim: null, stages: [], route: route(doneStages), history };
}

describe('карточка машины', () => {
  it('прогресс по стадиям: на окраске — склад и сварка выполнены, окраска сейчас', () => {
    const v = body({ loc: { kind: 'station', stageId: 'paint', equipmentId: 'BOOTH-02', postId: 'PAINT-B2', precision: 'station', estimated: false } });
    const marks = stageProgress(v, plant).map((s) => `${s.id}:${s.mark}`);
    expect(marks).toEqual(['warehouse:done', 'weld:done', 'paint:now', 'assembly:ahead', 'qc:ahead', 'finished:ahead']);
  });

  it('в буфере после окраски: окраска выполнена, сборка — в очереди', () => {
    const v = body({ loc: { kind: 'buffer', stageId: 'paint', bufferId: 'paint-assembly', precision: 'stage', estimated: false } });
    expect(stageProgress(v, plant).find((s) => s.id === 'assembly')?.mark).toBe('queue');
    expect(carWhere(v, plant, NOW).title).toBe('Очередь перед сборкой');
  });

  it('точность до участка: «точное место не отмечено» и время против нормы', () => {
    const v = body({ normSec: 20 * 60, since: iso(NOW - 18 * MIN), loc: { kind: 'stage', stageId: 'paint', precision: 'stage', estimated: true } });
    const w = carWhere(v, plant, NOW);
    expect(w.title).toBe('Окраска (точное место не отмечено)');
    expect(w.detail).toBe('18 мин, норма 20');
  });

  it('время готовности: позже при длинной очереди, на складе ГП — готова', () => {
    const v = body({ order: 10, loc: { kind: 'buffer', stageId: 'paint', bufferId: 'paint-assembly', precision: 'stage', estimated: false } });
    const d = detail(v, ['warehouse', 'weld', 'paint']);
    const empty: BufferView[] = plant.buffers.map((b) => ({ id: b.id, count: 0, capacity: b.capacity }));
    const alone = carEta(v, d, plant, [v], empty, NOW)!;
    const ahead = Array.from({ length: 6 }, (_, i) => body({ bodyId: `B-${i + 2}`, order: i, loc: v.loc }));
    const queued = carEta(v, d, plant, [v, ...ahead], empty, NOW)!;
    expect(alone.at).toBeGreaterThan(NOW);
    expect(queued.at).toBeGreaterThan(alone.at);
    expect(queued.lateMin).not.toBeNull();
    const done = carEta(body({ loc: { kind: 'finished', stageId: 'finished', precision: 'stage', estimated: false } }), null, plant, [], empty, NOW)!;
    expect(done.done).toBe(true);
  });

  it('время считается по сменам: ночь между сменами не делает машину опоздавшей', () => {
    const evening = Date.parse('2026-10-06T23:50:00+05:00');
    const morning = Date.parse('2026-10-07T08:30:00+05:00');
    // ночью цех стоит: рабочего времени между вечером и утром почти нет
    expect(workMs(evening, morning)).toBeLessThan(60 * MIN);
    // работа, начатая ночью, заканчивается уже в утреннюю смену
    expect(addWork(evening + 30 * MIN, 10 * MIN)).toBeGreaterThan(morning - 60 * MIN);
    const v = body({ order: 1, loc: { kind: 'station', stageId: 'paint', equipmentId: 'BOOTH-02', postId: 'PAINT-B2', precision: 'station', estimated: false } });
    const d = detail(v, ['warehouse', 'weld']);
    d.history[0] = { ...d.history[0]!, at: '2026-10-06T23:30:00+05:00' };
    const empty: BufferView[] = plant.buffers.map((b) => ({ id: b.id, count: 0, capacity: b.capacity }));
    expect(Math.abs(carEta(v, d, plant, [v], empty, NOW)!.lateMin!)).toBeLessThan(6 * 60);
  });

  it('последние события: новые сверху, без повторов отметок', () => {
    const h: BodyHistoryItem[] = [
      { at: iso(NOW - 3 * MIN), kind: 'checkpoint', text: 'A', method: 'rfid', source: 'plc' },
      { at: iso(NOW - 2 * MIN), kind: 'operation', text: 'B', method: 'tool_result', source: 'plc' },
      { at: iso(NOW - 1 * MIN), kind: 'duplicate', text: 'повтор', source: 'mes' },
      { at: iso(NOW), kind: 'checkpoint', text: 'C', method: 'mes_scan', source: 'mes' },
    ];
    expect(lastEvents(h).map((e) => `${e.text}:${e.kind}`)).toEqual(['C:scanner', 'B:tool', 'A:rfid']);
  });

  it('машины участка: проблемные первыми, очередь перед участком отдельно', () => {
    const loc = { kind: 'station' as const, stageId: 'assembly', equipmentId: 'CONV-01', postId: 'ASM-1', precision: 'station' as const, estimated: false };
    const ok = body({ bodyId: 'OK', since: iso(NOW - 50 * MIN), loc });
    const late = body({ bodyId: 'LATE', since: iso(NOW - 5 * MIN), flags: ['delayed'], loc });
    const q = body({ bodyId: 'Q', loc: { kind: 'buffer', stageId: 'paint', bufferId: 'paint-assembly', precision: 'stage', estimated: false } });
    const { here, queued } = carsOfArea([ok, late, q], plant, 'assembly');
    expect(here.map((b) => b.bodyId)).toEqual(['LATE', 'OK']);
    expect(queued.map((b) => b.bodyId)).toEqual(['Q']);
  });
});
