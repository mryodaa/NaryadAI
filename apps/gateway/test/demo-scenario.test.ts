// Главный демо-сценарий «Фильтр окраски» сквозь имитатор и ядро: должен проходить после каждого этапа.
import { describe, expect, it } from 'vitest';
import { startDemo } from './harness';

describe('сценарий «Фильтр окраски», ступень 1', () => {
  const demo = startDemo('paint_filter', 1);
  demo.until('13:31');
  const snap = demo.twin.snapshot(demo.now(), demo.meta);
  const paint = () => demo.twin.snapshot(demo.now(), demo.meta).areas.find((a) => a.id === 'paint')!;

  it('13:31 — окраска работает с браком, причина — фильтр Камеры-02', () => {
    expect(paint().status).toBe('degraded_quality');
    expect(paint().reason).toMatch(/^Камера-02: фильтр забит \(\d+ Па\)$/);
    expect(snap.kpi.monthPlan.onTrack).toBe(false);
    expect(snap.kpi.monthPlan.mainCause).toBe('окраска');
    expect(snap.buffers.map((b) => b.capacity)).toEqual([12, 15, 8]);
  });

  it('инцидент по браку окраски с причиной, угрозой и рекомендацией «Заменить фильтр сейчас»', () => {
    const inc = demo.twin.incidents().find((i) => i.type === 'quality' && i.area === 'paint')!;
    expect(inc.title).toMatch(/^Окраска: брак \d+,\d% и растёт$/);
    expect(inc.equipmentId).toBe('BOOTH-02');
    expect(inc.why.text).toMatch(/прошли Камеру-02, когда перепад давления на фильтре был/);
    expect(inc.why.chart?.kind).toBe('filter');
    expect(inc.options.map((o) => o.id)).toEqual(expect.arrayContaining(['replace_now', 'do_nothing']));
    expect(inc.options.find((o) => o.recommended)?.id).toBe('replace_now');
    expect(demo.twin.forecast(demo.now()).capacity.bottleneck?.stageId).toBe('paint');
  });

  it('решение уходит нарядом, камера встаёт на замену фильтра, брак уходит', () => {
    const inc = demo.twin.incidents().find((i) => i.type === 'quality' && i.area === 'paint')!;
    const r = demo.twin.decide(inc.id, 'replace_now', 'тест', demo.now());
    expect(r.ok).toBe(true);
    expect(r.workOrder).toMatchObject({ action: 'replace_filter', equipmentId: 'BOOTH-02' });
    demo.world.applyWorkOrder(r.workOrder!);
    demo.until('13:45');
    expect(paint().status).toBe('maintenance');
    expect(paint().reason).toMatch(/замена фильтра/i);
    demo.until('14:30');
    expect(paint().status).toBe('running');
    const booth = demo.twin.areaDetail('paint', demo.now()).equipment.find((e) => e.id === 'BOOTH-02')!;
    expect(booth.dp!).toBeLessThan(250);
    expect(demo.twin.incidents().some((i) => i.type === 'quality' && i.area === 'paint')).toBe(false);
  });
});

describe('сценарий «Фильтр окраски», ступень 0 — только 1С', () => {
  it('без контроллеров причина — по журналу замен фильтра в 1С:MES', () => {
    const demo = startDemo('paint_filter', 0);
    demo.until('13:31');
    const inc = demo.twin.incidents().find((i) => i.type === 'quality' && i.area === 'paint')!;
    expect(inc.why.text).toMatch(/контроллеры не подключены/);
    expect(inc.why.text).toMatch(/фильтр Камеры-02 меняли/);
  });
});

describe('трекер кузовов против «правды» имитатора — расчёты сходятся', () => {
  for (const stage of [0, 1] as const) {
    it(`ступень ${stage}: буферы и выпуск смены по трекеру — как в цехе, место кузова — до ${stage ? 'станции' : 'участка'}`, () => {
      const demo = startDemo('paint_filter', stage);
      demo.until('13:31');
      const snap = demo.twin.snapshot(demo.now(), demo.meta);
      const truth = demo.world.bufferCounts();
      for (const b of snap.buffers) expect(Math.abs(b.count - truth[b.id]!), b.id).toBeLessThanOrEqual(2);
      // выпуск смены: отметки 1С приходят с задержкой до 2 минут — расхождение не больше пары машин
      expect(Math.abs(snap.kpi.shiftOutput.done - (demo.world.shiftOutput().qc ?? 0))).toBeLessThanOrEqual(3);
      const bodies = demo.twin.bodies(demo.now());
      const weldPaint = bodies.filter((b) => (b.loc.stageId === 'weld' || b.loc.stageId === 'paint') && (b.loc.kind === 'stage' || b.loc.kind === 'station'));
      expect(weldPaint.length).toBeGreaterThan(10);
      // на ступени 0 точное место — только у кузовов, принятых сканером в лабораторию (оборудование в стороне)
      const inFlow = weldPaint.filter((b) => !['GEO-LAB', 'POLISH'].includes(b.loc.equipmentId ?? '') || b.loc.estimated);
      const exact = inFlow.filter((b) => b.loc.precision === 'station').length / inFlow.length;
      if (stage === 0) expect(exact).toBe(0);
      else expect(exact).toBeGreaterThan(0.9);
      // у каждого кузова — модель и цвет из заказа
      expect(bodies.filter((b) => b.color).length / bodies.length).toBeGreaterThan(0.95);
    });
  }
});
