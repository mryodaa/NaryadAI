// Исходный цех по открытым данным: сварочные линии под модели, лаборатория геометрии в стороне от потока.
import { describe, expect, it } from 'vitest';
import { SEED_PLANT, derivePlant } from '@allur/contracts';
import { Twin } from '../src/twin';
import { bufferCounts, evaluateArea } from '../src/status';
import { plantCapacity } from '../src/capacity';
import { at, downtime, pass, plan, vin } from './helpers';

function seedTwin(): Twin {
  const t = new Twin({}, SEED_PLANT);
  t.reset(at('07:59'));
  t.ingest(plan());
  return t;
}

/** Кузова каждые 4 минуты проходят линию своей модели и доводку */
function weldFlow(t: Twin, from: number, to: number) {
  const lines = { onix: ['WELD-1', 'WELD-4'], cobalt: ['WELD-5', 'WELD-8'], j7: ['WELD-9', 'WELD-12'] } as const;
  const models = ['onix', 'cobalt', 'onix', 'j7', 'cobalt'] as const;
  let n = 0;
  for (let ts = from; ts <= to; ts += 4 * 60_000) {
    const model = models[n % models.length]!;
    const v = vin(n++, model);
    [...lines[model], 'WELD-FIN', 'PAINT-PRE'].forEach((p, i) => t.ingest(pass(v, p, ts + i * 1000, model)));
  }
}

describe('сварочные линии под модели', () => {
  it('нет машинокомплектов J7 — сварка работает со сниженной мощностью, стоит только линия J7', () => {
    const t = seedTwin();
    weldFlow(t, at('08:00'), at('10:00'));
    t.ingest(downtime('ABB-08', 'weld', 'Нет машинокомплектов: жгуты проводов j7', 'no_parts', at('09:30'), null));
    const ev = evaluateArea(t.state, 'weld', at('10:00'), t.cfg);
    expect(ev.status).toBe('reduced');
    expect(ev.reason).toBe('Линия J7: нет машинокомплектов: жгуты проводов j7 · работает 2 из 3 линий сварки');
  });

  it('мощность сварки — по линиям моделей и общей доводке', () => {
    const t = seedTwin();
    const cap = plantCapacity(t.state, at('10:00'), t.cfg, derivePlant(SEED_PLANT));
    const weld = cap.stages.find((s) => s.stageId === 'weld')!;
    expect(Math.round(weld.nominalPerShift)).toBe(144);
    expect(weld.limitedBy).toBe('FINISH-01');
  });

  it('кузов в лаборатории геометрии не стоит в буфере перед окраской; вернулся — стоит', () => {
    const t = seedTwin();
    const v = vin(900, 'cobalt');
    t.ingest(pass(v, 'WELD-FIN', at('09:00'), 'cobalt'));
    expect(bufferCounts(t.state)['weld-paint']).toBe(1);
    t.ingest(pass(v, 'GEO-IN', at('09:01'), 'cobalt'));
    expect(bufferCounts(t.state)['weld-paint']).toBe(0);
    t.ingest(pass(v, 'GEO-OUT', at('12:30'), 'cobalt'));
    expect(bufferCounts(t.state)['weld-paint']).toBe(1);
  });
});
