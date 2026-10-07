// Чтение двойника и принятие решений.
import type { FastifyInstance } from 'fastify';
import { networkInterfaces } from 'node:os';
import { DecisionRequest, VIN_RE, topics, zodIssues } from '@allur/contracts';
import type { Ctx } from '../context';
import { config } from '../config';

export function twinRoutes(app: FastifyInstance, ctx: Ctx) {
  const { twin, clock, db, hub, sources } = ctx;

  app.get('/api/v1/state', async (_req, reply) => {
    const snap = twin.snapshot(clock.now());
    if (!snap) return reply.code(503).send({ error: 'booting', message: 'Запускаем двойник…' });
    return snap;
  });

  app.get('/api/v1/incidents', async () => twin.incidents());

  app.get<{ Params: { id: string } }>('/api/v1/incidents/:id', async (req, reply) => {
    const inc = twin.incident(req.params.id);
    if (!inc) return reply.code(404).send({ error: 'not_found', message: 'Инцидент не найден' });
    return inc;
  });

  app.get<{ Querystring: { moveMaintenance?: string; filterBySchedule?: string; saturdayShifts?: string } }>('/api/v1/forecast', async (req, reply) => {
    const q = req.query;
    const levers = {
      moveMaintenance: q.moveMaintenance === '1' || q.moveMaintenance === 'true',
      filterBySchedule: q.filterBySchedule === '1' || q.filterBySchedule === 'true',
      saturdayShifts: Math.max(0, Math.min(10, Number(q.saturdayShifts ?? 0) || 0)),
    };
    const f = twin.forecast(clock.now(), levers);
    if (!f) return reply.code(503).send({ error: 'booting', message: 'Прогноз появится, когда двойник получит историю' });
    return f;
  });

  app.get<{ Params: { vin: string } }>('/api/v1/vin/:vin', async (req, reply) => {
    const vin = req.params.vin.toUpperCase();
    if (!VIN_RE.test(vin)) {
      return reply.code(400).send({ error: 'validation_failed', message: 'VIN — 17 символов: латинские буквы (кроме I, O, Q) и цифры' });
    }
    const events = db.eventsByVin(vin);
    const passport = twin.passport(vin, events, clock.now());
    if (!passport) return reply.code(404).send({ error: 'not_found', message: `Кузов ${vin} не найден — проверьте номер` });
    return passport;
  });

  /** Кузова в цехе: где, сколько против нормы, вид и флаги */
  app.get('/api/v1/bodies', async () => twin.bodies(clock.now()));

  /** Кузов по номеру или VIN: маршрут операций и история отметок */
  app.get<{ Params: { id: string } }>('/api/v1/bodies/:id', async (req, reply) => {
    const b = twin.body(req.params.id.toUpperCase(), clock.now());
    if (!b) return reply.code(404).send({ error: 'not_found', message: `Кузов ${req.params.id} не найден` });
    return b;
  });

  app.get('/api/v1/checks', async () => twin.checks());

  app.get('/api/v1/quality', async () => twin.quality(clock.now()));

  app.get('/api/v1/sources', async () => ({
    stage: clock.stage,
    contradictions: twin.checks(),
    unaccounted: twin.equipment(clock.now()).unaccounted,
    sources: sources.status(clock.stage),
    validationErrors: db.recentValidationErrors(20),
    feed: hub.recentFeed(100),
    endpoints: {
      rest: '/api/v1',
      swagger: '/docs',
      asyncapi: '/asyncapi',
      mqttTcp: ctx.mqtt()?.tcpListening ? `mqtt://<хост>:${config.mqttPort}` : null,
      mqttWs: '/mqtt',
    },
    /** Адреса в локальной сети — для QR-кода на экран мастера при локальном запуске */
    lan: Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => a!.address),
  }));

  app.post('/api/v1/decisions', async (req, reply) => {
    const channel = 'POST /api/v1/decisions';
    const r = DecisionRequest.safeParse(req.body);
    if (!r.success) {
      const issues = zodIssues(r.error);
      return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message, issues });
    }
    const now = clock.now();
    const outcome = twin.decide(r.data.incidentId, r.data.optionId, r.data.decidedBy, now);
    if (!outcome.ok) return reply.code(404).send({ error: 'not_found', message: outcome.error });
    if (outcome.workOrder) {
      ctx.mqtt()?.publish(topics.workOrders, outcome.workOrder, { qos: 1 });
      db.addDecision({
        id: outcome.workOrder.workOrderId,
        runId: clock.runId,
        incidentId: r.data.incidentId,
        optionId: r.data.optionId,
        decidedAt: now,
        decidedBy: r.data.decidedBy,
        workOrder: outcome.workOrder,
      });
    }
    void channel;
    return outcome;
  });
}
