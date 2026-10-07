// Модель потока из конфигурации завода: параллельные станции, мощность, смена состава на лету.
import { describe, expect, it } from 'vitest';
import { derivePlant, type EquipmentConfig, type PlantConfig } from '@allur/contracts';
import { LEGACY_PLANT as SEED_PLANT } from './legacy-plant';
import { DEFAULT_CONFIG } from '../src/config';
import { plantCapacity } from '../src/capacity';
import { evaluateArea } from '../src/status';
import { Twin } from '../src/twin';
import { at, flow, pass, plcState, vin } from './helpers';

const cfg = DEFAULT_CONFIG;
const clone = (c: PlantConfig): PlantConfig => JSON.parse(JSON.stringify(c)) as PlantConfig;
const booth = (n: number): EquipmentConfig => ({
  id: `BOOTH-0${n}`,
  type: 'paint_booth',
  name: `Камера-0${n}`,
  critical: true,
  cycleTimeSec: 468,
  posts: [{ id: `PAINT-B${n}`, name: `Камера-0${n}` }],
  connection: { method: 'simulator', status: 'not_connected' },
});

/** Окраска: подготовка → N параллельных камер → сушка */
function paintWith(booths: number, version = 2): PlantConfig {
  const c = clone(SEED_PLANT);
  c.version = version;
  const p = c.stages.find((s) => s.id === 'paint')!;
  p.stations = Array.from({ length: booths }, (_, i) => ({ id: `paint-${i + 1}`, name: `Камера окраски ${i + 1}`, equipment: [booth(i + 1)] }));
  p.inlet![0]!.cycleTimeSec = 156;
  p.outlet![0]!.cycleTimeSec = 156;
  return c;
}

function twinWith(plant: PlantConfig): Twin {
  const t = new Twin({}, plant);
  t.reset(at('07:59'));
  return t;
}

describe('мощность участка по составу цеха', () => {
  it('одна камера против двух на окраске: мощность удваивается, узкое место переезжает', () => {
    const t = twinWith(paintWith(1));
    const one = plantCapacity(t.state, at('10:00'), cfg, derivePlant(paintWith(1)));
    const two = plantCapacity(t.state, at('10:00'), cfg, derivePlant(paintWith(2)));
    const paint = (v: typeof one) => v.stages.find((s) => s.stageId === 'paint')!;
    expect(Math.round(paint(one).nominalPerShift)).toBe(62);
    expect(Math.round(paint(two).nominalPerShift)).toBe(123);
    expect(one.bottleneck?.stageId).toBe('paint');
    // с двумя камерами окраска (123) сильнее сборки (120) — узкое место на сборке
    expect(two.bottleneck?.stageId).toBe('assembly');
  });

  it('удаление станции: мощность падает, двойник перестраивается без перезапуска', () => {
    const t = twinWith(paintWith(3));
    expect(t.areaDetail('paint', at('09:00')).equipment.map((e) => e.id)).toEqual(['PRETREAT', 'BOOTH-01', 'BOOTH-02', 'BOOTH-03', 'OVEN']);
    t.setPlant(paintWith(2, 3));
    expect(t.areaDetail('paint', at('09:00')).equipment.map((e) => e.id)).toEqual(['PRETREAT', 'BOOTH-01', 'BOOTH-02', 'OVEN']);
    const cap = plantCapacity(t.state, at('09:00'), cfg);
    expect(Math.round(cap.stages.find((s) => s.stageId === 'paint')!.nominalPerShift)).toBe(123);
    expect(t.snapshot(at('09:00'), { runId: 1, stage: 1, speed: 1, paused: false, scenario: 'live_day' }).plantVersion).toBe(3);
  });
});

describe('отказ одной из параллельных станций', () => {
  it('встала одна из двух камер — окраска работает со сниженной мощностью, а не стоит', () => {
    const t = twinWith(paintWith(2));
    flow(t, ['PAINT-PRE', 'PAINT-B1', 'PAINT-OVEN'], at('08:00'), at('09:56'));
    t.ingest(plcState('BOOTH-02', 'paint', 'fault', at('10:00'), 'V-12', 'Сбой вентиляции'));
    const ev = evaluateArea(t.state, 'paint', at('10:05'), cfg);
    expect(ev.status).toBe('reduced');
    expect(ev.reason).toBe('Камера-02: сбой вентиляции · работает 1 из 2 камер окраски');
    expect(ev.stations).toEqual({ working: 1, total: 2 });
    t.tick(at('10:05'));
    const inc = t.incidents().find((i) => i.type === 'stop' && i.area === 'paint')!;
    expect(inc.tone).toBe('attention');
    expect(inc.title).toMatch(/^Окраска: снижена мощность/);
  });

  it('встали обе камеры — окраска стоит', () => {
    const t = twinWith(paintWith(2));
    flow(t, ['PAINT-PRE', 'PAINT-B1', 'PAINT-OVEN'], at('08:00'), at('09:56'));
    t.ingest(plcState('BOOTH-01', 'paint', 'fault', at('10:00'), 'V-12', 'Сбой вентиляции'));
    t.ingest(plcState('BOOTH-02', 'paint', 'fault', at('10:01'), 'V-12', 'Сбой вентиляции'));
    expect(evaluateArea(t.state, 'paint', at('10:06'), cfg).status).toBe('fault');
  });

  it('встало общее оборудование (сушка) — окраска стоит, сколько бы ни было камер', () => {
    const t = twinWith(paintWith(3));
    flow(t, ['PAINT-PRE', 'PAINT-B1', 'PAINT-OVEN'], at('08:00'), at('09:56'));
    t.ingest(plcState('OVEN', 'paint', 'fault', at('10:00'), 'O-55', 'Температура ниже нормы'));
    expect(evaluateArea(t.state, 'paint', at('10:05'), cfg).status).toBe('fault');
  });
});

describe('ёмкость буфера из конфигурации', () => {
  it('буфер перед сборкой на 5 кузовов: 5 в очереди — окраска «Заблокирована»', () => {
    const small = clone(SEED_PLANT);
    small.version = 2;
    small.stages.find((s) => s.id === 'paint')!.bufferAfter = { capacity: 5 };
    for (const [plant, expected] of [
      [SEED_PLANT, 'fault'],
      [small, 'blocked'],
    ] as const) {
      const t = twinWith(plant);
      flow(t, ['WELD-4', 'PAINT-PRE', 'PAINT-OVEN', 'ASM-1', 'ASM-6', 'QC-1', 'FG-IN'], at('08:00'), at('09:00'));
      // перед окраской есть кузова (сварка работала), после окраски — 5 кузовов ждут сборку
      for (let i = 0; i < 5; i++) t.ingest(pass(vin(300 + i), 'WELD-4', at('09:00') + i * 1000));
      for (let i = 0; i < 5; i++) t.ingest(pass(vin(200 + i), 'PAINT-OVEN', at('09:00') + i * 1000));
      // сборка не берёт кузова, окраска 20 минут без прохода
      expect(evaluateArea(t.state, 'paint', at('09:21'), cfg).status).toBe(expected);
      const snap = t.snapshot(at('09:21'), { runId: 1, stage: 0, speed: 1, paused: false, scenario: 'live_day' });
      expect(snap.buffers.find((b) => b.id === 'paint-assembly')).toMatchObject({ count: 5, capacity: plant === small ? 5 : 15 });
    }
  });
});
