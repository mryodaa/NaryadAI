import { describe, expect, it } from 'vitest';
import { SEED_MODEL, type BodyView, type ModelId } from '@allur/contracts/ref';
import { matchesFilters, searchCars, searchIndex } from './search';

const plant = SEED_MODEL;
const MODELS: ModelId[] = ['onix', 'cobalt', 'j7'];
const CODES: Record<ModelId, string> = { onix: 'CN1', cobalt: 'CB2', j7: 'JJ7' };
const COLORS = [
  { code: 'W01', name: 'Белый', hex: '#eeeeea', finish: 'solid' as const },
  { code: 'S02', name: 'Серебристый металлик', hex: '#c0c4c8', finish: 'metallic' as const },
  { code: 'R04', name: 'Красный', hex: '#b3261e', finish: 'solid' as const },
];
const LOCS: BodyView['loc'][] = [
  { kind: 'station', stageId: 'paint', equipmentId: 'BOOTH-02', postId: 'PAINT-B2', precision: 'station', estimated: false },
  { kind: 'station', stageId: 'weld', equipmentId: 'ABB-09', postId: 'WELD-10', precision: 'station', estimated: false },
  { kind: 'stage', stageId: 'assembly', precision: 'stage', estimated: true },
  { kind: 'buffer', stageId: 'weld', bufferId: 'weld-paint', precision: 'stage', estimated: false },
];

function car(i: number, over: Partial<BodyView> = {}): BodyView {
  const model = MODELS[i % 3]!;
  const n = String(4800 + i).padStart(6, '0');
  return {
    bodyId: `B-${String(4800 + i).padStart(5, '0')}`,
    vin: `KZA${CODES[model]}S1XTK${n}`,
    model,
    color: COLORS[Math.floor(i / 3) % COLORS.length]!,
    loc: LOCS[i % LOCS.length]!,
    since: new Date(Date.parse('2026-10-07T10:00:00+05:00') + i * 60_000).toISOString(),
    normSec: 240,
    visual: [],
    flags: [],
    order: i,
    ...over,
  };
}

describe('поиск машин', () => {
  const bodies = Array.from({ length: 500 }, (_, i) => car(i, i === 7 ? { flags: ['delayed'] } : i === 11 ? { flags: ['rework', 'nonconformity'] } : {}));
  const idx = searchIndex(bodies, plant);

  it('последние 6 знаков VIN — точное совпадение первым, с отметкой для подсветки', () => {
    const r = searchCars(idx, '004812');
    expect(r.hits[0]!.body.bodyId).toBe('B-04812');
    expect(r.hits[0]!.mark).toEqual({ field: 'vin', start: 11, length: 6 });
  });

  it('последние 4 знака, номер кузова, модель и цвет', () => {
    expect(searchCars(idx, '4812').hits[0]!.body.bodyId).toBe('B-04812');
    expect(searchCars(idx, 'b-04812').hits[0]!.body.bodyId).toBe('B-04812');
    const red = searchCars(idx, 'cobalt красный', 500);
    expect(red.total).toBeGreaterThan(0);
    expect(red.hits.every((h) => h.body.model === 'cobalt' && h.body.color?.name === 'Красный')).toBe(true);
  });

  it('простые слова: «задерживаются», «перекраска», участок в падеже, «линия J7»', () => {
    expect(searchCars(idx, 'задерживаются').hits.map((h) => h.body.bodyId)).toEqual(['B-04807']);
    expect(searchCars(idx, 'перекраска').hits.map((h) => h.body.bodyId)).toEqual(['B-04811']);
    const paint = searchCars(idx, 'на окраске', 500);
    // на окраске и в очереди перед окраской
    expect(paint.hits.every((h) => h.body.loc.stageId === 'paint' || h.body.loc.bufferId === 'weld-paint')).toBe(true);
    // линия J7: машины модели J7 и те, что стоят на роботах линии J7
    expect(searchCars(idx, 'линия J7', 500).hits.every((h) => h.body.model === 'j7' || h.body.loc.equipmentId === 'ABB-09')).toBe(true);
    expect(searchCars(idx, 'камера-02', 500).total).toBeGreaterThan(0);
  });

  it('проблемные — выше остальных при равном совпадении', () => {
    expect(searchCars(idx, 'cobalt').hits[0]!.body.bodyId).toBe('B-04807');
  });

  it('ничего не найдено', () => {
    expect(searchCars(idx, '999999').total).toBe(0);
  });

  it('500 машин: индекс и поиск быстрее 50 мс', () => {
    const fresh = Array.from({ length: 500 }, (_, i) => car(i));
    const t0 = performance.now();
    const ix = searchIndex(fresh, plant);
    for (const q of ['4812', 'cobalt красный', 'задерживаются', 'на окраске', 'линия J7']) searchCars(ix, q);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('фильтры: отметки «или», модели «или», между группами «и»', () => {
    const late = car(1, { flags: ['delayed'] });
    expect(matchesFilters(late, { delayed: true, rework: true, models: [] })).toBe(true);
    expect(matchesFilters(late, { delayed: false, rework: true, models: [] })).toBe(false);
    expect(matchesFilters(late, { delayed: true, rework: false, models: ['onix'] })).toBe(late.model === 'onix');
    expect(matchesFilters(late, { delayed: false, rework: false, models: [late.model] })).toBe(true);
  });
});
