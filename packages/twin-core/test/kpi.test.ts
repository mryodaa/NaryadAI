// Показатели смены (раздел 9.2 задания).
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { criticalDowntimeToday, shiftKpis, unaccountedLosses } from '../src/kpi';
import { at, downtime, flow, nc, newTwin, plcState, vin } from './helpers';

const cfg = DEFAULT_CONFIG;
const LINE = ['WELD-4', 'PAINT-OVEN', 'ASM-6', 'QC-1', 'QC-3', 'FG-IN'];

describe('выпуск смены', () => {
  it('план к этому моменту = прошедшее время / такт 4 минуты', () => {
    const t = newTwin();
    flow(t, LINE, at('08:00'), at('09:56'));
    const k = shiftKpis(t.state, at('10:00'), cfg);
    expect(k.planToNow).toBe(30);
    expect(k.done).toBe(30);
    expect(k.areaDone.assembly).toBe(30);
  });
});

describe('OEE = доступность × производительность × качество', () => {
  it('без остановок и брака — производительность по такту, качество 100%', () => {
    const t = newTwin();
    flow(t, LINE, at('08:00'), at('09:56'));
    const k = shiftKpis(t.state, at('10:00'), cfg);
    expect(k.oee.availability).toBeCloseTo(1, 5);
    expect(k.oee.quality).toBeCloseTo(1, 5);
    expect(k.oee.value).toBeCloseTo(1, 1);
  });

  it('30 минут простоя сборки из 120 — доступность 75%', () => {
    const t = newTwin();
    flow(t, LINE, at('08:00'), at('09:26'));
    t.ingest(plcState('CONV-03', 'assembly', 'fault', at('09:30'), 'E-2117', 'Обрыв цепи'));
    t.ingest(plcState('CONV-03', 'assembly', 'run', at('10:00')));
    const k = shiftKpis(t.state, at('10:00'), cfg);
    expect(k.oee.stopMin).toBeCloseTo(30, 0);
    expect(k.oee.availability).toBeCloseTo(0.75, 2);
  });

  it('кузов с несоответствием снижает качество', () => {
    const t = newTwin();
    const n = flow(t, LINE, at('08:00'), at('09:56'));
    t.ingest(nc(vin(n - 1), 'qc', 'asm_gap', at('09:57'), 'assembly'));
    t.ingest(nc(vin(n - 2), 'qc', 'asm_gap', at('09:57'), 'assembly'));
    const k = shiftKpis(t.state, at('10:00'), cfg);
    expect(k.oee.quality).toBeCloseTo(28 / 30, 3);
  });
});

describe('брак смены', () => {
  it('доля несоответствий по проверкам сварки, окраски и сборки', () => {
    const t = newTwin();
    const n = flow(t, LINE, at('08:00'), at('09:56'));
    t.ingest(nc(vin(n - 3), 'paint', 'paint_dirt', at('09:30')));
    t.ingest(nc(vin(n - 4), 'paint', 'paint_dirt', at('09:31')));
    t.ingest(nc(vin(n - 5), 'weld', 'weld_geometry', at('09:32')));
    const k = shiftKpis(t.state, at('10:00'), cfg);
    expect(k.defects.inspected).toBe(90);
    expect(k.defects.defects).toBe(3);
    expect(k.defects.pct).toBeCloseTo(3 / 90, 5);
    expect(k.defects.worst!.area).toBe('paint');
  });
});

describe('простои', () => {
  it('простой критического оборудования за сутки против лимита 60 минут (плановое ТО не считается)', () => {
    const t = newTwin();
    t.ingest(downtime('ABB-01', 'weld', 'Ошибка датчика', 'breakdown', at('09:40'), at('10:05')));
    t.ingest(downtime('BOOTH-02', 'paint', 'Замена фильтра', 'breakdown', at('13:10'), at('13:50')));
    t.ingest(downtime('ABB-04', 'weld', 'Плановое ТО', 'planned', at('14:00'), at('14:30')));
    const r = criticalDowntimeToday(t.state, at('15:00'), cfg, at('00:00'));
    expect(Math.round(r.minutes)).toBe(65);
  });

  it('неучтённые потери = остановки по контроллерам − записанные в 1С:MES', () => {
    const t = newTwin();
    t.ingest(plcState('CONV-03', 'assembly', 'fault', at('09:00'), 'E-1043'));
    t.ingest(plcState('CONV-03', 'assembly', 'run', at('09:03')));
    t.ingest(plcState('CONV-03', 'assembly', 'fault', at('10:00'), 'E-2117'));
    t.ingest(plcState('CONV-03', 'assembly', 'run', at('10:30')));
    t.ingest(downtime('CONV-03', 'assembly', 'Обрыв цепи', 'breakdown', at('10:00'), at('10:30')));
    const u = unaccountedLosses(t.state, at('10:40'), at('00:00'))!;
    expect(Math.round(u.autoMin)).toBe(33);
    expect(Math.round(u.mesMin)).toBe(30);
    expect(Math.round(u.unaccountedMin)).toBe(3);
    expect(u.microCount).toBe(1);
  });
});
