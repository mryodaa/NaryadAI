// Трекер кузовов на исходном цехе: нормальный проход, грязные данные, перекраска, задержка,
// точность до участка (ступень 0) и до станции (ступень 1).
import { describe, expect, it } from 'vitest';
import { SEED_PLANT, type CanonicalEvent } from '@allur/contracts';
import { Twin } from '../src/twin';
import { bufferCounts } from '../src/status';
import { at, iso } from './helpers';

const VIN = 'KZACN1S18TK004812';
let seq = 0;

function twin(): Twin {
  const t = new Twin({}, SEED_PLANT);
  t.reset(at('07:59'));
  return t;
}
const order = (bodyId: string, ts: number, colorCode = 'W01'): CanonicalEvent => ({
  eventId: `erp-${++seq}`,
  source: 'erp',
  ts: iso(ts),
  area: 'warehouse',
  type: 'production_order',
  payload: { bodyId, model: 'onix', colorCode, plannedSeq: seq },
});
const cp = (bodyId: string, checkpointId: string, direction: 'in' | 'out', ts: number, area: string, extra: { vin?: string; postId?: string; source?: 'mes' | 'plc' } = {}): CanonicalEvent => ({
  eventId: `cp-${++seq}`,
  source: extra.source ?? 'mes',
  ts: iso(ts),
  area,
  vin: extra.vin,
  type: 'body_checkpoint',
  payload: { bodyId, checkpointId, direction, postId: extra.postId },
});
const vinAssigned = (bodyId: string, ts: number): CanonicalEvent => ({ eventId: `vin-${++seq}`, source: 'mes', ts: iso(ts), area: 'weld', vin: VIN, type: 'vin_assigned', payload: { bodyId } });
const opr = (bodyId: string, equipmentId: string, operation: string, result: 'ok' | 'nok', ts: number, area: string): CanonicalEvent => ({
  eventId: `op-${++seq}`,
  source: 'plc',
  ts: iso(ts),
  area,
  equipmentId,
  type: 'operation_result',
  payload: { bodyId, operation, result },
});
const m = (hhmm: string, plusMin = 0) => at(hhmm) + plusMin * 60_000;

/** Ступень 0: только 1С:MES на входе и выходе участков */
function stage0(t: Twin, id: string, upTo = 'finished') {
  const marks: [string, 'in' | 'out', string, number][] = [
    ['WH-OUT', 'out', 'warehouse', m('08:00')],
    ['WELD-IN', 'in', 'weld', m('08:01')],
    ['WELD-OUT', 'out', 'weld', m('08:20')],
    ['PAINT-IN', 'in', 'paint', m('08:30')],
    ['PAINT-OUT', 'out', 'paint', m('09:10')],
    ['ASM-IN', 'in', 'assembly', m('09:20')],
    ['ASM-OUT', 'out', 'assembly', m('10:05')],
    ['QC-IN', 'in', 'qc', m('10:10')],
    ['QC-OUT', 'out', 'qc', m('10:30')],
    ['FG-ACCEPT', 'in', 'finished', m('10:31')],
  ];
  t.ingest(order(id, m('07:59')));
  for (const [p, d, area, ts] of marks) {
    t.ingest(cp(id, p, d, ts, area, ts > m('08:15') ? { vin: VIN } : {}));
    if (p === 'WELD-IN') t.ingest(vinAssigned(id, m('08:15')));
    if (area === upTo && d === 'in') break;
  }
}

describe('трекер кузовов', () => {
  it('нормальный проход: от комплекта до парковки, все операции выполнены по выходу участков', () => {
    const t = twin();
    stage0(t, 'B-00001');
    const b = t.body(VIN, m('10:40'))!;
    expect(b.bodyId).toBe('B-00001');
    expect(b.loc.kind).toBe('finished');
    expect(b.color?.name).toBe('Белый');
    expect(b.route.filter((s) => !s.optional).every((s) => s.status === 'done')).toBe(true);
    expect(b.route.filter((s) => s.optional).every((s) => s.status === 'skipped')).toBe(true);
    expect(b.visual).toEqual(['kit', 'biw_underbody', 'biw_sides', 'biw_roof', 'biw_closures', 'ecoat', 'primer', 'color', 'gloss', 'trim', 'chassis', 'wheels', 'glass', 'complete', 'on_rollers', 'on_alignment_stand', 'in_water_booth', 'parked']);
    expect(b.flags).toEqual([]);
    expect(b.route.find((s) => s.operation === 'basecoat')?.by).toBe('stage_exit');
  });

  it('ступень 0: на участке известно только «окраска» — место и вид оцениваются по норме времени', () => {
    const t = twin();
    stage0(t, 'B-00002', 'paint');
    const v = t.body('B-00002', m('08:30', 12))!;
    expect(v.loc).toMatchObject({ kind: 'stage', stageId: 'paint', precision: 'stage', estimated: true });
    // 12 минут после входа: подготовка и катафорез (2 × ~2 мин) и печь (~4 мин) пройдены — кузов в серой «катафорезной» краске
    expect(v.visual).toContain('ecoat');
    expect(v.visual).not.toContain('color');
  });

  it('ступень 1: RFID даёт точное место и выполненные операции', () => {
    const t = twin();
    stage0(t, 'B-00003', 'paint');
    t.ingest(cp('B-00003', 'RFID-BOOTH-01', 'in', m('08:46'), 'paint', { vin: VIN, source: 'plc' }));
    t.ingest(opr('B-00003', 'BOOTH-01', 'basecoat', 'ok', m('08:50'), 'paint'));
    const v = t.body(VIN, m('08:51'))!;
    expect(v.loc).toMatchObject({ kind: 'station', equipmentId: 'BOOTH-01', precision: 'station', estimated: false });
    expect(v.visual).toContain('color');
    expect(v.visual).not.toContain('gloss');
    expect(v.route.find((s) => s.operation === 'primer')?.by).toBe('station_out');
    expect(v.route.find((s) => s.operation === 'basecoat')?.by).toBe('operation');
  });

  it('пропущенная отметка: выход сварки достраивается по маршруту и помечается', () => {
    const t = twin();
    t.ingest(order('B-00004', m('07:59')));
    t.ingest(cp('B-00004', 'WH-OUT', 'out', m('08:00'), 'warehouse'));
    t.ingest(cp('B-00004', 'WELD-IN', 'in', m('08:01'), 'weld'));
    t.ingest(cp('B-00004', 'PAINT-IN', 'in', m('08:30'), 'paint'));
    const v = t.body('B-00004', m('08:40'))!;
    expect(v.loc.stageId).toBe('paint');
    expect(v.flags).toContain('restored_checkpoint');
    expect(v.history.some((h) => h.restored && h.stageId === 'weld' && /Выход/.test(h.text))).toBe(true);
    expect(t.state.stageDone(t.state.passes[0] ? '2026-10-07#1' : '', 'weld')).toBe(1);
  });

  it('опоздавшая отметка подтверждает восстановленную — флага нет', () => {
    const t = twin();
    t.ingest(order('B-00005', m('07:59')));
    t.ingest(cp('B-00005', 'WH-OUT', 'out', m('08:00'), 'warehouse'));
    t.ingest(cp('B-00005', 'WELD-IN', 'in', m('08:01'), 'weld'));
    t.ingest(cp('B-00005', 'RFID-PRETREAT', 'in', m('08:30'), 'paint', { source: 'plc' }));
    t.ingest(cp('B-00005', 'WELD-OUT', 'out', m('08:31'), 'weld'));
    t.ingest(cp('B-00005', 'PAINT-IN', 'in', m('08:32'), 'paint'));
    const v = t.body('B-00005', m('08:50'))!;
    expect(v.flags).not.toContain('restored_checkpoint');
    expect(v.loc).toMatchObject({ kind: 'station', equipmentId: 'PRETREAT' });
  });

  it('отметки не по порядку: ОТК раньше сборки — не применяется, уходит в противоречия', () => {
    const t = twin();
    stage0(t, 'B-00006', 'assembly');
    t.ingest(cp('B-00006', 'QC-IN', 'in', m('09:00'), 'qc', { vin: VIN }));
    const v = t.body(VIN, m('09:30'))!;
    expect(v.loc.stageId).toBe('assembly');
    expect(t.state.tracker.contradictions).toHaveLength(1);
    expect(t.checks().some((c) => /не по порядку/.test(c.title))).toBe(true);
  });

  it('дубль: повтор той же отметки в течение минуты не учитывается', () => {
    const t = twin();
    stage0(t, 'B-00007', 'paint');
    t.ingest({ ...cp('B-00007', 'WELD-OUT', 'out', m('08:20', 0.5), 'weld', { vin: VIN }), eventId: 'dup-1' });
    expect(t.state.tracker.duplicates).toBe(1);
    expect(t.state.stageDone('2026-10-07#1', 'weld')).toBe(1);
  });

  it('перекраска после несоответствия: маршрут окраски открывается заново, видна петля', () => {
    const t = twin();
    stage0(t, 'B-00008', 'paint');
    t.ingest({ eventId: 'qls-1', source: 'qls', ts: iso(m('09:05')), area: 'paint', vin: VIN, type: 'nonconformity', payload: { checkpoint: 'CP-PAINT', defect: 'paint_dirt', decision: 'repaint' } });
    let v = t.body(VIN, m('09:06'))!;
    expect(v.flags).toEqual(expect.arrayContaining(['rework', 'nonconformity']));
    expect(v.route.filter((s) => s.operation === 'basecoat').map((s) => s.loop)).toEqual([0, 1]);
    t.ingest(cp('B-00008', 'PAINT-OUT', 'out', m('09:40'), 'paint', { vin: VIN }));
    v = t.body(VIN, m('09:41'))!;
    expect(v.loc.kind).toBe('buffer');
    expect(v.route.filter((s) => s.operation === 'clearcoat').every((s) => s.status === 'done')).toBe(true);
    expect(bufferCounts(t.state)['paint-assembly']).toBe(1);
  });

  it('задержка: на станции дольше нормы × 1,5', () => {
    const t = twin();
    stage0(t, 'B-00009', 'paint');
    t.ingest(cp('B-00009', 'RFID-BOOTH-02', 'in', m('09:00'), 'paint', { vin: VIN, source: 'plc' }));
    expect(t.body(VIN, m('09:05'))!.flags).not.toContain('delayed');
    // норма камеры 234 с; через 6,5 минут — задержка
    expect(t.body(VIN, m('09:06', 0.5))!.flags).toContain('delayed');
  });

  it('цвет не передан из 1С — флаг и нет цвета', () => {
    const t = twin();
    t.ingest(order('B-00010', m('07:59'), 'X99'));
    const v = t.body('B-00010', m('08:00'))!;
    expect(v.color).toBeNull();
    expect(v.flags).toContain('unknown_color');
    expect(v.loc.kind).toBe('warehouse');
    expect(v.visual).toEqual(['kit']);
  });
});
