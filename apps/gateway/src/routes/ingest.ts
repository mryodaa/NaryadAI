// Приём данных: 1С (MES, QLS, WMS, ERP), мобильный ввод мастера, таблицы в формате организаторов.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';
import {
  DowntimeRequest,
  PlanRequest,
  QualityRequest,
  ShiftReportRequest,
  downtimeRequestToEvent,
  parseCsvTable,
  planRequestToEvent,
  qualityRowsToEvents,
  shiftReportRowsToEvents,
  zodIssues,
  type SourceId,
  type ValidationIssue,
} from '@allur/contracts';
import type { Ctx } from '../context';

export function ingestRoutes(app: FastifyInstance, ctx: Ctx) {
  const { hub, clock } = ctx;

  function fail(reply: FastifyReply, channel: string, source: SourceId | null, issues: ValidationIssue[], raw: unknown) {
    hub.reject(channel, source, issues, raw);
    return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message ?? 'Ошибка проверки', issues });
  }

  function parse<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply, channel: string, source: SourceId | null) {
    const r = schema.safeParse(body);
    if (!r.success) {
      fail(reply, channel, source, zodIssues(r.error), body);
      return null;
    }
    return r.data as z.infer<T>;
  }

  app.post('/api/v1/events', async (req, reply) => {
    const channel = 'POST /api/v1/events';
    const body = req.body;
    if (!Array.isArray(body)) return fail(reply, channel, null, [{ path: '(корень)', message: 'Ожидается массив событий' }], body);
    if (body.length === 0 || body.length > 1000) {
      return fail(reply, channel, null, [{ path: '(корень)', message: 'В пакете должно быть от 1 до 1000 событий' }], `массив из ${body.length}`);
    }
    return hub.ingestRaw(body, channel);
  });

  app.post('/api/v1/downtimes', async (req, reply) => {
    const channel = 'POST /api/v1/downtimes';
    const guess = ((req.body as { source?: string } | null)?.source === 'master' ? 'master' : 'mes') as SourceId;
    const data = parse(DowntimeRequest, req.body, reply, channel, guess);
    if (!data) return reply;
    const event = downtimeRequestToEvent(data, clock.now());
    const result = hub.ingest([event], channel);
    return { ...result, eventId: event.eventId };
  });

  app.post('/api/v1/plan', async (req, reply) => {
    const channel = 'POST /api/v1/plan';
    const data = parse(PlanRequest, req.body, reply, channel, 'erp');
    if (!data) return reply;
    const event = planRequestToEvent(data, clock.now());
    return { ...hub.ingest([event], channel), eventId: event.eventId };
  });

  app.post('/api/v1/shift-reports', async (req, reply) => {
    const channel = 'POST /api/v1/shift-reports';
    const source = sourceParam(req.query) ?? 'mes';
    const rows = parse(ShiftReportRequest, req.body, reply, channel, source);
    if (!rows) return reply;
    const { events, issues } = shiftReportRowsToEvents(rows, source, clock.now(), ctx.plant.model);
    for (const i of issues) hub.reject(channel, source, [i], rows[i.row]);
    return { ...hub.ingest(events, channel), rowIssues: issues };
  });

  app.post('/api/v1/quality', async (req, reply) => {
    const channel = 'POST /api/v1/quality';
    const source = sourceParam(req.query) ?? 'qls';
    const rows = parse(QualityRequest, req.body, reply, channel, source);
    if (!rows) return reply;
    const { events, issues } = qualityRowsToEvents(rows, source, clock.now(), ctx.plant.model);
    for (const i of issues) hub.reject(channel, source, [i], rows[i.row]);
    return { ...hub.ingest(events, channel), rowIssues: issues };
  });

  app.post('/api/v1/import/csv', async (req, reply) => {
    const channel = 'POST /api/v1/import/csv';
    const text = typeof req.body === 'string' ? req.body : '';
    if (!text.trim()) return fail(reply, channel, 'import', [{ path: 'файл', message: 'Пустой файл' }], '');
    const parsed = parseCsvTable(text, clock.now(), '2026-10', ctx.plant.model);
    for (const i of parsed.issues) hub.reject(channel, 'import', [i], `строка ${i.row}`);
    const result = hub.ingest(parsed.events, channel);
    return {
      kind: parsed.kind,
      kindLabel: parsed.kindLabel,
      rows: parsed.rows,
      ...result,
      issues: parsed.issues,
      contradictions: ctx.twin.checks(),
    };
  });
}

/** ?source=mes|qls|import — от чьего имени пришли табличные данные */
function sourceParam(query: unknown): SourceId | null {
  const s = (query as { source?: string } | null)?.source;
  return s === 'mes' || s === 'qls' || s === 'import' || s === 'erp' ? s : null;
}
