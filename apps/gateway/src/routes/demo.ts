// Пульт демонстрации: скорость, пауза, сброс, сценарии, ступень внедрения.
import type { FastifyInstance } from 'fastify';
import { SCENARIOS, SCENARIO_IDS, SPEEDS, STAGES, topics, type ScenarioId, type Stage } from '@allur/contracts';
import type { Ctx } from '../context';

export function demoState(ctx: Ctx) {
  const c = ctx.clock;
  return {
    runId: c.runId,
    seed: c.seed,
    now: new Date(c.now()).toISOString(),
    speed: c.speed,
    paused: c.paused,
    stage: c.stage,
    scenario: c.scenario,
    simulateAll: c.simulateAll,
    plantVersion: ctx.plant.config.version,
    speeds: SPEEDS,
    scenarios: SCENARIOS,
    stages: STAGES,
  };
}

export function demoRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/v1/demo', async () => demoState(ctx));

  /** Загружена ли начальная история (имитатор 1С проверяет при старте) */
  app.get('/api/v1/demo/history', async () => {
    const r = ctx.db.raw
      .prepare(`SELECT COUNT(*) AS n, MAX(json_extract(body, '$.payload.date')) AS last FROM events WHERE event_id LIKE 'hist:%' AND type = 'shift_report'`)
      .get() as { n: number; last: string | null };
    return { shiftReports: Number(r.n), lastDate: r.last };
  });

  app.post('/api/v1/demo/clock', async (req) => {
    const b = (req.body ?? {}) as { speed?: number; paused?: boolean };
    if (typeof b.speed === 'number' && Number.isFinite(b.speed)) ctx.clock.setSpeed(b.speed);
    if (typeof b.paused === 'boolean') ctx.clock.setPaused(b.paused);
    return demoState(ctx);
  });

  app.post('/api/v1/demo/reset', async (req) => {
    const b = (req.body ?? {}) as { scenario?: string };
    const scenario = (SCENARIO_IDS as readonly string[]).includes(b.scenario ?? '') ? (b.scenario as ScenarioId) : undefined;
    ctx.resetRun(scenario);
    return demoState(ctx);
  });

  app.post('/api/v1/demo/scenario', async (req, reply) => {
    const b = (req.body ?? {}) as { scenario?: string };
    if (!(SCENARIO_IDS as readonly string[]).includes(b.scenario ?? '')) {
      return reply.code(400).send({ error: 'validation_failed', message: `Сценарий: ${SCENARIO_IDS.join(', ')}` });
    }
    ctx.resetRun(b.scenario as ScenarioId);
    return demoState(ctx);
  });

  app.post('/api/v1/demo/simulate-all', async (req) => {
    const b = (req.body ?? {}) as { on?: boolean };
    ctx.clock.setSimulateAll(b.on === true);
    return demoState(ctx);
  });

  /** Пульт: имитатор устраивает событие для показа рабочего места мастера */
  app.post('/api/v1/demo/inject', async (req, reply) => {
    const b = (req.body ?? {}) as { kind?: string };
    if (b.kind !== 'false_signal' && b.kind !== 'booth_stop') {
      return reply.code(400).send({ error: 'validation_failed', message: 'Событие: false_signal или booth_stop' });
    }
    const broker = ctx.mqtt();
    if (!broker) return reply.code(503).send({ error: 'unavailable', message: 'MQTT ещё не запущен' });
    broker.publish(topics.simCommand, { kind: b.kind }, { qos: 1 });
    return { ok: true };
  });

  app.post('/api/v1/demo/stage', async (req, reply) => {
    const b = (req.body ?? {}) as { stage?: number };
    if (b.stage !== 0 && b.stage !== 1 && b.stage !== 2) {
      return reply.code(400).send({ error: 'validation_failed', message: 'Ступень: 0, 1 или 2' });
    }
    ctx.clock.setStage(b.stage as Stage);
    return demoState(ctx);
  });
}
