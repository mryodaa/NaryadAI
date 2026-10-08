// Сигнал — не факт: проверка на месте мастером (рабочее место мастера).
import { describe, expect, it } from 'vitest';
import { at, flow, newTwin, plcState } from './helpers';

const meta = { runId: 1, stage: 1 as const, speed: 1, paused: false, scenario: 'live_day' as const };

function conveyorFault() {
  const t = newTwin();
  flow(t, ['ASM-1', 'ASM-6'], at('08:00'), at('10:04'));
  t.ingest(plcState('CONV-03', 'assembly', 'fault', at('10:05'), 'E-2117', 'Обрыв приводной цепи'));
  t.tick(at('10:09'));
  return t;
}

describe('сигнал и проверка на месте', () => {
  it('остановку видит только контроллер — это сигнал, не проверено', () => {
    const t = conveyorFault();
    const inc = t.incidents().find((i) => i.type === 'stop' && i.area === 'assembly')!;
    expect(inc.check).toBe('signal');
    expect(inc.checkSources).toEqual(['plc']);
    const snap = t.snapshot(at('10:09'), meta);
    expect(snap.areas.find((a) => a.id === 'assembly')!.check).toBe('signal');
    expect(snap.attention.find((a) => a.incidentId === inc.id)!.check).toBe('signal');
  });

  it('совпали контроллер и 1С:MES — вероятно, но на месте не проверено', () => {
    const t = conveyorFault();
    t.tick(at('10:20'));
    const inc = t.incidents().find((i) => i.type === 'stop' && i.area === 'assembly')!;
    expect(inc.checkSources).toEqual(expect.arrayContaining(['plc', 'mes']));
    expect(inc.check).toBe('probable');
  });

  it('«Да» мастера — обычный инцидент', () => {
    const t = conveyorFault();
    const inc = t.incidents().find((i) => i.type === 'stop')!;
    t.setVerdict(inc.key, { verdict: 'yes', at: at('10:10') });
    t.tick(at('10:10'));
    expect(t.incident(inc.id)!.check).toBe('confirmed');
    expect(t.snapshot(at('10:10'), meta).areas.find((a) => a.id === 'assembly')!.check).toBeUndefined();
  });

  it('«Нет» мастера — сигнал исчезает с причиной, участок не красим, пока длится то же отклонение', () => {
    const t = conveyorFault();
    const inc = t.incidents().find((i) => i.type === 'stop')!;
    t.setVerdict(inc.key, { verdict: 'no', reason: 'sensor_wrong', at: at('10:10') });
    t.tick(at('10:10'));
    expect(t.incidents().some((i) => i.type === 'stop' && i.area === 'assembly')).toBe(false);
    const snap = t.snapshot(at('10:10'), meta);
    expect(snap.areas.find((a) => a.id === 'assembly')!.status).toBe('running');
    expect(snap.dismissed).toEqual([expect.objectContaining({ incidentId: inc.id, reason: 'sensor_wrong' })]);
    // через 20 секунд и позже — инцидент не открывается снова
    t.tick(at('10:11'));
    expect(t.incidents().some((i) => i.type === 'stop' && i.area === 'assembly')).toBe(false);
    // контроллер снова «работает» — отклонение кончилось, ответ мастера больше ни к чему не относится
    t.ingest(plcState('CONV-03', 'assembly', 'run', at('10:12')));
    t.tick(at('10:13'));
    expect(t.book.rejectedKeys().size).toBe(0);
  });
});
