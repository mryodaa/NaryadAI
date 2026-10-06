// Правила статуса участка (раздел 9.1 задания).
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { bufferCounts, evaluateArea } from '../src/status';
import { at, downtime, flow, nc, newTwin, pass, plcState, vin } from './helpers';

const cfg = DEFAULT_CONFIG;

describe('статус участка по данным 1С:MES (ступень 0)', () => {
  it('кузова идут в такт — «Работает»', () => {
    const t = newTwin();
    flow(t, ['ASM-1', 'ASM-6'], at('08:00'), at('09:00'));
    expect(evaluateArea(t.state, 'assembly', at('09:02'), cfg).status).toBe('running');
  });

  it('нет прохода VIN дольше 3 тактов, буфер перед не пуст, после не полон — «Авария»', () => {
    const t = newTwin();
    flow(t, ['ASM-1', 'ASM-6', 'QC-1', 'QC-3', 'FG-IN'], at('08:00'), at('09:00'));
    // в буфере перед сборкой 5 кузовов: прошли сушку, ещё не на сборке
    for (let i = 0; i < 5; i++) t.ingest(pass(vin(100 + i), 'PAINT-OVEN', at('08:50') + i * 60_000));
    const ev = evaluateArea(t.state, 'assembly', at('09:15'), cfg);
    expect(ev.status).toBe('fault');
    expect(ev.reason).toMatch(/Нет прохода кузовов/);
    expect(ev.signals[0]!.source).toBe('mes');
  });

  it('до 12 минут без прохода — ещё «Работает» (порог 3 такта)', () => {
    const t = newTwin();
    flow(t, ['ASM-1', 'ASM-6'], at('08:00'), at('09:00'));
    expect(evaluateArea(t.state, 'assembly', at('09:11'), cfg).status).toBe('running');
  });

  it('буфер перед участком пуст — «Ждёт кузов», а не авария', () => {
    const t = newTwin();
    flow(t, ['PAINT-PRE', 'PAINT-OVEN', 'ASM-1', 'ASM-6', 'QC-1', 'FG-IN'], at('08:00'), at('09:00'));
    const ev = evaluateArea(t.state, 'assembly', at('09:20'), cfg);
    expect(bufferCounts(t.state)['paint-assembly']).toBe(0);
    expect(ev.status).toBe('starved');
  });

  it('буфер после участка полон — «Заблокирован» (проблема ниже по потоку)', () => {
    const t = newTwin();
    flow(t, ['WELD-4', 'PAINT-PRE', 'PAINT-OVEN', 'ASM-1', 'ASM-6', 'QC-1', 'FG-IN'], at('08:00'), at('09:00'));
    for (let i = 0; i < 5; i++) t.ingest(pass(vin(300 + i), 'WELD-4', at('09:00') + i * 1000));
    // сборка стоит: 15 кузовов прошли окраску и ждут сборку
    for (let i = 0; i < 15; i++) t.ingest(pass(vin(200 + i), 'PAINT-OVEN', at('09:00') + i * 1000));
    // окраска после этого не двигается 20 минут
    const ev = evaluateArea(t.state, 'paint', at('09:21'), cfg);
    expect(bufferCounts(t.state)['paint-assembly']).toBeGreaterThanOrEqual(15);
    expect(ev.status).toBe('blocked');
  });

  it('простой, записанный мастером, даёт причину; плановое ТО — «Обслуживание»', () => {
    const t = newTwin();
    flow(t, ['WELD-1', 'WELD-4'], at('08:00'), at('09:00'));
    t.ingest(downtime('ABB-04', 'weld', 'Плановое ТО', 'planned', at('09:05'), null));
    const ev = evaluateArea(t.state, 'weld', at('09:10'), cfg);
    expect(ev.status).toBe('maintenance');
    expect(ev.reason).toMatch(/ABB-04/);
  });
});

describe('статус по контроллерам (ступень 1)', () => {
  it('авария контроллера видна с кодом, не дожидаясь 12 минут', () => {
    const t = newTwin();
    flow(t, ['ASM-1', 'ASM-6'], at('08:00'), at('10:04'));
    t.ingest(plcState('CONV-03', 'assembly', 'fault', at('10:05'), 'E-2117', 'Обрыв приводной цепи'));
    const ev = evaluateArea(t.state, 'assembly', at('10:09'), cfg);
    expect(ev.status).toBe('fault');
    expect(ev.reason).toMatch(/обрыв приводной цепи/i);
    expect(ev.signals.some((s) => s.source === 'plc' && s.code === 'E-2117')).toBe(true);
  });

  it('микропростой до 3 минут не превращается в «Аварию»', () => {
    const t = newTwin();
    flow(t, ['ASM-1', 'ASM-6'], at('08:00'), at('10:00'));
    t.ingest(plcState('CONV-03', 'assembly', 'fault', at('10:01'), 'E-1043', 'Срабатывание датчика безопасности'));
    expect(evaluateArea(t.state, 'assembly', at('10:03'), cfg).status).toBe('running');
  });
});

describe('качество', () => {
  it('доля брака за 2 часа выше 2% — «Работает с браком»', () => {
    const t = newTwin();
    const n = flow(t, ['PAINT-B2', 'PAINT-OVEN'], at('08:00'), at('10:00'));
    for (let i = 0; i < 3; i++) t.ingest(nc(vin(n - 2 - i), 'paint', 'paint_dirt', at('09:40') + i * 60_000));
    t.tick(at('10:01'));
    const snap = t.snapshot(at('10:01'), { runId: 1, stage: 0, speed: 1, paused: false, scenario: 'live_day' });
    expect(snap.areas.find((a) => a.id === 'paint')!.status).toBe('degraded_quality');
  });
});
