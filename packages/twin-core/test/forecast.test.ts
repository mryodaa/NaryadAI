// Прогноз плана месяца, причина брака и инциденты с решениями.
import { describe, expect, it } from 'vitest';
import { monthShifts, plantParts, type CanonicalEvent } from '@allur/contracts';
import { DEFAULT_CONFIG } from '../src/config';
import { monthForecast } from '../src/forecast';
import { filterForecast, paintFilterCause } from '../src/quality';
import { at, flow, nc, newTwin, pass, plan, report, telemetry, vin } from './helpers';

const cfg = DEFAULT_CONFIG;

/** История: все смены с 1 сентября по 6 октября выпускают по `fact` машин */
function history(fact: number): CanonicalEvent[] {
  const out: CanonicalEvent[] = [plan()];
  for (const m of ['2026-09', '2026-10']) {
    for (const s of monthShifts(m)) {
      if (s.date >= '2026-10-07') continue;
      out.push(report(s.date, s.index, 'assembly', fact));
    }
  }
  return out;
}

describe('прогноз плана месяца', () => {
  it('ровный темп: прогноз = выпущено + оставшиеся смены × темп, коридор сжимается', () => {
    const t = newTwin();
    history(110).forEach((e) => t.ingest(e));
    const now = at('08:00');
    const f = monthForecast(t.state, now, cfg);
    const done = monthShifts('2026-10').filter((s) => s.endMs <= now).length;
    const left = monthShifts('2026-10').filter((s) => s.startMs >= now).length;
    expect(f.produced).toBe(done * 110);
    expect(f.p50).toBe(done * 110 + left * 110);
    expect(f.p10).toBe(f.p50);
    expect(f.p90).toBe(f.p50);
    expect(f.target).toBe(5500);
    expect(f.onTrack).toBe(false);
  });

  it('разброс по сменам даёт коридор P10 < P50 < P90', () => {
    const t = newTwin();
    const ev = history(110);
    let i = 0;
    for (const e of ev) {
      if (e.type === 'shift_report') e.payload.fact = 100 + ((i++ * 7) % 21);
      t.ingest(e);
    }
    const f = monthForecast(t.state, at('08:00'), cfg);
    expect(f.p10).toBeLessThan(f.p50);
    expect(f.p50).toBeLessThan(f.p90);
  });

  it('рычаги «что если» увеличивают прогноз, ожидаемые потери инцидентов — уменьшают', () => {
    const t = newTwin();
    history(112).forEach((e) => t.ingest(e));
    const base = monthForecast(t.state, at('08:00'), cfg);
    const sat = monthForecast(t.state, at('08:00'), cfg, { levers: { moveMaintenance: false, filterBySchedule: false, saturdayShifts: 2 } });
    const loss = monthForecast(t.state, at('08:00'), cfg, { incidentLoss: 10 });
    expect(sat.p50 - base.p50).toBe(224);
    expect(base.p50 - loss.p50).toBe(10);
  });
});

describe('причина брака: связь с перепадом на фильтре Камеры-02', () => {
  it('находит порог и силу связи по VIN', () => {
    const t = newTwin();
    // перепад растёт от 200 до 380 Па с 08:00 до 12:00
    for (let m = 0; m <= 240; m++) t.ingest(telemetry('BOOTH-02', 'paint', 'filter_dp_pa', 200 + (180 * m) / 240, at('08:00') + m * 60_000));
    const n = flow(t, ['PAINT-B2', 'PAINT-OVEN'], at('08:00'), at('12:00'));
    // брак только у кузовов, прошедших камеру после 11:00 (перепад > 335)
    let k = 0;
    for (let i = 0; i < n; i++) {
      const ts = at('08:00') + i * 4 * 60_000;
      if (ts > at('11:00') && i % 4 === 0) t.ingest(nc(vin(i), 'paint', 'paint_dirt', ts + 8 * 60_000)), k++;
    }
    const cause = paintFilterCause(t.state, at('12:10'), cfg)!;
    expect(cause).not.toBeNull();
    expect(cause.defectsAbove).toBe(k);
    expect(cause.defectsTotal).toBe(k);
    expect(cause.lift).toBeGreaterThan(3);
    expect(cause.sentence).toMatch(/кузов.* с сорностью прошли Камеру-02/);
  });

  it('экспоненциальный тренд перепада даёт время выхода на предел 450 Па', () => {
    const t = newTwin();
    // dp − 40 растёт в e раз за 3 часа: 300 → 450 примерно за 1,6 ч
    for (let m = 0; m <= 90; m++) {
      const ts = at('12:00') + m * 60_000;
      t.ingest(telemetry('BOOTH-02', 'paint', 'filter_dp_pa', 40 + 200 * Math.exp(m / 180), ts));
    }
    const f = filterForecast(t.state, at('13:30'), cfg, 'BOOTH-02')!;
    const expectedHours = 3 * Math.log(410 / 200) - 1.5;
    expect((f.limitAt! - at('13:30')) / 3600_000).toBeCloseTo(expectedHours, 1);
  });
});

describe('инцидент «брак окраски»: варианты решений и принятие', () => {
  it('решение выдаёт наряд и меняет ожидаемые потери в прогнозе', () => {
    const t = newTwin();
    history(112).forEach((e) => t.ingest(e));
    // перепад около 320 Па к 13:30 и растёт ускоряясь
    for (let m = 0; m <= 330; m++) t.ingest(telemetry('BOOTH-02', 'paint', 'filter_dp_pa', 40 + 54 * Math.exp(m / 200), at('08:00') + m * 60_000));
    const n = flow(t, ['WELD-4', 'PAINT-PRE', 'PAINT-B2', 'PAINT-OVEN', 'ASM-1', 'ASM-6'], at('08:00'), at('13:28'));
    for (let i = n - 30; i < n; i += 9) t.ingest(nc(vin(i), 'paint', 'paint_dirt', at('08:00') + i * 4 * 60_000 + 9 * 60_000));
    const now = at('13:30');
    t.tick(now);
    const inc = t.incidents().find((i) => i.type === 'quality');
    expect(inc).toBeDefined();
    expect(inc!.options.length).toBeGreaterThanOrEqual(2);
    expect(inc!.options.filter((o) => o.recommended)).toHaveLength(1);
    const noAction = inc!.options.find((o) => o.id === 'do_nothing')!;
    const best = inc!.options.find((o) => o.recommended)!;
    expect(best.totalCost).toBeLessThanOrEqual(noAction.totalCost);
    const r = t.decide(inc!.id, best.id, 'тест', now);
    expect(r.ok).toBe(true);
    expect(r.workOrder?.action).toBe('replace_filter');
    expect(r.forecastAfter!).toBeGreaterThanOrEqual(r.forecastBefore!);
    expect(t.incident(inc!.id)!.status).toBe('decided');
    expect(plantParts(Date.parse(r.workOrder!.scheduledAt)).date).toBe('2026-10-07');
  });

  it('проход поста и брак без ступени 1 не находят связи с фильтром, но инцидент остаётся', () => {
    const t = newTwin();
    const n = flow(t, ['PAINT-B2', 'PAINT-OVEN'], at('08:00'), at('10:00'));
    for (let i = n - 12; i < n; i += 3) t.ingest(nc(vin(i), 'paint', 'paint_dirt', at('09:30') + i * 1000));
    t.tick(at('10:00'));
    const inc = t.incidents().find((i) => i.type === 'quality')!;
    expect(inc).toBeDefined();
    expect(inc.why.chart).toBeNull();
    void pass;
  });
});
