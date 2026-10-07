// Конфигурация завода: чтение, история версий, проверка, влияние, применение, откат, импорт и экспорт,
// подключение оборудования. Ошибки и предупреждения — по-русски.
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ConnectionInput,
  derivePlant,
  describePlantChanges,
  zodIssues,
  type ConnectionConfig,
  type EquipmentConfig,
  type PlantConfig,
  type PlantImpact,
  type PlantValidation,
  type StageCapacity,
} from '@allur/contracts';
import type { Ctx } from '../context';

/** Конфигурация с живым состоянием связи по каждой единице оборудования */
export function withRuntime(ctx: Ctx, config: PlantConfig): PlantConfig {
  const model = derivePlant(config);
  const st = new Map(ctx.connections.status(model, ctx.clock.stage, ctx.clock.simulateAll).map((s) => [s.equipmentId, s]));
  const eq = (e: EquipmentConfig): EquipmentConfig => {
    const s = st.get(e.id);
    const connection: ConnectionConfig = { ...e.connection, status: s?.status ?? 'not_connected' };
    if (s?.lastSeenAt) connection.lastSeenAt = toIsoPlant(s.lastSeenAt);
    if (s?.error) connection.error = s.error;
    return { ...e, connection };
  };
  return {
    ...config,
    stages: config.stages.map((s) => ({
      ...s,
      ...(s.inlet ? { inlet: s.inlet.map(eq) } : {}),
      stations: s.stations.map((x) => ({ ...x, equipment: x.equipment.map(eq) })),
      ...(s.outlet ? { outlet: s.outlet.map(eq) } : {}),
    })),
  };
}

function toIsoPlant(iso: string): string {
  // время связи — реальное; отдаём в формате ISO со смещением завода
  const d = new Date(Date.parse(iso) + 5 * 3600_000);
  return d.toISOString().replace(/\.\d+Z$/, '+05:00');
}

function failed(reply: FastifyReply, validation: PlantValidation, code = 400) {
  const issues = validation.errors.map((e) => ({ path: e.path, message: e.message }));
  return reply.code(code).send({ error: 'validation_failed', message: validation.errors[0]?.message ?? 'Конфигурация не прошла проверку', issues, validation });
}

export function plantRoutes(app: FastifyInstance, ctx: Ctx) {
  const { plant, twin, clock } = ctx;

  const capacityOf = (config: PlantConfig): StageCapacity[] =>
    twin.capacity(config).stages.map((s) => ({
      stageId: s.stageId,
      name: s.name,
      stations: s.stations,
      nominalPerShift: Math.round(s.nominalPerShift * 10) / 10,
      effectivePerShift: Math.round(s.effectivePerShift * 10) / 10,
      limitedBy: s.limitedBy ? (derivePlant(config).equipmentById.get(s.limitedBy)?.name ?? s.limitedBy) : null,
    }));

  app.get('/api/v1/plant/config', async () => withRuntime(ctx, plant.config));

  app.get('/api/v1/plant/config/versions', async () => plant.versions());

  app.post('/api/v1/plant/config/validate', async (req) => plant.validate(req.body, twin.openIncidentsByEquipment()).validation);

  app.post('/api/v1/plant/config/preview-impact', async (req): Promise<PlantImpact> => {
    const { validation, config } = plant.validate(req.body, twin.openIncidentsByEquipment());
    const before = capacityOf(plant.config);
    const capA = twin.capacity(plant.config);
    if (!config) return { changes: [], before, after: [], bottleneckBefore: capA.bottleneck && { stageId: capA.bottleneck.stageId, name: capA.bottleneck.name }, bottleneckAfter: null, forecast: null, validation };
    const capB = twin.capacity(config);
    return {
      changes: describePlantChanges(plant.config, config),
      before,
      after: capacityOf(config),
      bottleneckBefore: capA.bottleneck && { stageId: capA.bottleneck.stageId, name: capA.bottleneck.name },
      bottleneckAfter: capB.bottleneck && { stageId: capB.bottleneck.stageId, name: capB.bottleneck.name },
      forecast: null,
      validation,
    };
  });

  app.put('/api/v1/plant/config', async (req, reply) => {
    // комментарий версии — только если его написали заново, иначе он собирается из изменений
    const b = (req.body ?? {}) as { comment?: string };
    const own = typeof b.comment === 'string' && b.comment.trim() && b.comment !== plant.config.comment ? b.comment.trim() : undefined;
    const r = plant.apply(req.body, { source: 'apply', comment: own, openIncidents: twin.openIncidentsByEquipment() });
    if (!r.ok) return failed(reply, r.validation);
    return { config: withRuntime(ctx, r.config), changes: r.changes };
  });

  app.post<{ Params: { ver: string } }>('/api/v1/plant/config/rollback/:ver', async (req, reply) => {
    const v = Number(req.params.ver);
    if (!Number.isInteger(v) || v < 1) return reply.code(400).send({ error: 'validation_failed', message: 'Номер версии — целое число от 1' });
    if (v === plant.config.version) return reply.code(400).send({ error: 'validation_failed', message: `Версия ${v} уже применена` });
    const r = plant.rollback(v, 'Начальник производства', twin.openIncidentsByEquipment());
    if (!r) return reply.code(404).send({ error: 'not_found', message: `Версии ${v} нет в истории` });
    if (!r.ok) return failed(reply, r.validation);
    return { config: withRuntime(ctx, r.config), changes: r.changes };
  });

  app.get('/api/v1/plant/config/export', async (_req, reply) => {
    const c = plant.config;
    return reply
      .header('content-disposition', `attachment; filename="plant-config-v${c.version}.json"`)
      .type('application/json; charset=utf-8')
      .send(JSON.stringify(c, null, 2));
  });

  app.post('/api/v1/plant/config/import', async (req, reply) => {
    const r = plant.apply(req.body, { source: 'import', comment: 'Импорт из файла', openIncidents: twin.openIncidentsByEquipment() });
    if (!r.ok) return failed(reply, r.validation);
    return { config: withRuntime(ctx, r.config), changes: r.changes };
  });

  app.post<{ Params: { id: string } }>('/api/v1/equipment/:id/connection/test', async (req, reply) => {
    const id = req.params.id;
    const e = plant.model.equipmentById.get(id);
    if (!e) return reply.code(404).send({ error: 'not_found', message: `«${id}» нет в применённой конфигурации завода — сначала примените состав цеха` });
    const parsed = ConnectionInput.safeParse(req.body);
    if (!parsed.success) {
      const issues = zodIssues(parsed.error);
      return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message ?? 'Ошибка проверки', issues });
    }
    if (!e.type.methods.includes(parsed.data.method)) {
      return reply.code(400).send({ error: 'validation_failed', message: `«${e.type.name}» нельзя подключить этим способом` });
    }
    return ctx.connections.test(plant.model, id, parsed.data, ctx.mqtt(), clock.stage);
  });

  app.put<{ Params: { id: string } }>('/api/v1/equipment/:id/connection', async (req, reply) => {
    const id = req.params.id;
    const e = plant.model.equipmentById.get(id);
    if (!e) return reply.code(404).send({ error: 'not_found', message: `«${id}» нет в применённой конфигурации завода` });
    const parsed = ConnectionInput.safeParse(req.body);
    if (!parsed.success) {
      const issues = zodIssues(parsed.error);
      return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message ?? 'Ошибка проверки', issues });
    }
    const conn: ConnectionConfig = { ...parsed.data, status: 'not_connected' };
    const swap = (x: EquipmentConfig): EquipmentConfig => (x.id === id ? { ...x, connection: conn } : x);
    const next: PlantConfig = {
      ...plant.config,
      stages: plant.config.stages.map((s) => ({
        ...s,
        ...(s.inlet ? { inlet: s.inlet.map(swap) } : {}),
        stations: s.stations.map((st) => ({ ...st, equipment: st.equipment.map(swap) })),
        ...(s.outlet ? { outlet: s.outlet.map(swap) } : {}),
      })),
    };
    const r = plant.apply(next, { source: 'connection', openIncidents: twin.openIncidentsByEquipment() });
    if (!r.ok) return failed(reply, r.validation);
    ctx.connections.saved(id);
    return { config: withRuntime(ctx, r.config), changes: r.changes };
  });
}
