import { describe, expect, it, vi } from 'vitest';

// стор вида читает адрес страницы при загрузке модуля
vi.hoisted(() => {
  (globalThis as { location?: unknown }).location = { search: '', origin: 'http://localhost' };
});
import type { BodyView } from '@allur/contracts/ref';
import { WATCH_LIMIT, onBodies, toggleWatch, useWatch } from './watch';
import { startFollow, useView } from './view';

const at = '2026-10-07T12:00:00+05:00';
const car = (bodyId: string, loc: BodyView['loc']): BodyView => ({
  bodyId,
  vin: `KZACN1S11TK00${bodyId.slice(-4)}`,
  model: 'onix',
  color: null,
  loc,
  since: at,
  normSec: null,
  visual: [],
  flags: [],
  order: 1,
});
const weld = { kind: 'station' as const, stageId: 'weld', equipmentId: 'ABB-01', postId: 'WELD-1', precision: 'station' as const, estimated: false };
const queue = { kind: 'buffer' as const, stageId: 'weld', bufferId: 'weld-paint', precision: 'stage' as const, estimated: false };
const paint = { kind: 'stage' as const, stageId: 'paint', precision: 'stage' as const, estimated: false };
const done = { kind: 'finished' as const, stageId: 'finished', precision: 'stage' as const, estimated: false };

describe('наблюдение и слежение', () => {
  it('переход стадии у машины в наблюдении — событие и тост; очередь — ещё не переход', () => {
    toggleWatch('B-4800');
    onBodies([car('B-4800', weld)], at);
    onBodies([car('B-4800', queue)], at);
    expect(useWatch.getState().events).toHaveLength(0);
    onBodies([car('B-4800', paint)], at);
    expect(useWatch.getState().toast?.text).toBe('Onix …004800 перешла в Окраску');
    onBodies([car('B-4800', done)], at);
    expect(useWatch.getState().events[0]!.text).toBe('Onix …004800 готова и принята на склад');
  });

  it('не больше пяти машин в наблюдении', () => {
    for (let i = 0; i < 10; i++) toggleWatch(`B-9${i}`);
    expect(useWatch.getState().ids.length).toBe(WATCH_LIMIT);
  });

  it('машина приехала на склад готовой продукции — слежение заканчивается сообщением', () => {
    startFollow('B-7000');
    onBodies([car('B-7000', paint)], at);
    expect(useView.getState().follow?.bodyId).toBe('B-7000');
    onBodies([car('B-7000', done)], at);
    expect(useView.getState().follow).toBeNull();
    expect(useView.getState().followEnded).toEqual({ bodyId: 'B-7000', vin: 'KZACN1S11TK007000' });
  });
});
