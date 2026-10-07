// Данные для экранов: панель участка, оборудование, параметры денег и допущения.
import type { FastifyInstance } from 'fastify';
import type { AreaId } from '@allur/contracts';
import { ASSUMPTIONS, DEFAULT_MONEY, MONEY_LABELS, type MoneyParams } from '@allur/twin-core';
import type { Ctx } from '../context';

export function viewRoutes(app: FastifyInstance, ctx: Ctx) {
  const { twin, clock } = ctx;

  app.get<{ Params: { id: string } }>('/api/v1/areas/:id', async (req, reply) => {
    const id = req.params.id as AreaId;
    if (!ctx.plant.model.stageById.has(id)) return reply.code(404).send({ error: 'not_found', message: 'Участок не найден в конфигурации завода' });
    return twin.areaDetail(id, clock.now());
  });

  app.get('/api/v1/equipment', async () => twin.equipment(clock.now()));

  app.get('/api/v1/settings', async () => ({
    money: twin.money,
    defaults: DEFAULT_MONEY,
    labels: MONEY_LABELS,
    assumptions: ASSUMPTIONS,
    note: 'Условные значения — уточняются с заводом',
  }));

  app.put('/api/v1/settings', async (req, reply) => {
    const body = (req.body ?? {}) as { money?: Partial<Record<keyof MoneyParams, unknown>> };
    const patch: Partial<MoneyParams> = {};
    for (const key of Object.keys(DEFAULT_MONEY) as (keyof MoneyParams)[]) {
      const v = body.money?.[key];
      if (v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e10) return reply.code(400).send({ error: 'validation_failed', message: `${MONEY_LABELS[key]}: нужно неотрицательное число` });
      patch[key] = Math.round(n);
    }
    twin.setMoney(patch);
    return { money: twin.money };
  });
}
