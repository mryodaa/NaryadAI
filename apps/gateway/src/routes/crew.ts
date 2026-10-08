// Рабочее место мастера: сигналы, журнал смены (экран /master).
import type { FastifyInstance } from 'fastify';
import { LogEntryRequest, ManagerAnswerRequest, RequestAnswerRequest, SignalAnswerRequest, zodIssues } from '@allur/contracts';
import type { Ctx } from '../context';

export function crewRoutes(app: FastifyInstance, ctx: Ctx) {
  const { crew, clock } = ctx;

  /** Отправить свежее состояние всем экранам сразу после действия мастера */
  const push = () => {
    ctx.crewChanged();
  };

  app.get('/api/v1/crew', async () => crew.view(clock.now()));

  /** Ответ на сигнал: «Да» (открывает запись журнала), «Нет» с причиной, «Позже» */
  app.post<{ Params: { id: string } }>('/api/v1/crew/signals/:id', async (req, reply) => {
    const r = SignalAnswerRequest.safeParse(req.body);
    if (!r.success) {
      const issues = zodIssues(r.error);
      return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message, issues });
    }
    const out = crew.answer(req.params.id, r.data.action, r.data.noReason, r.data.by, clock.now());
    if (!out.ok) return reply.code(out.status).send({ error: out.status === 404 ? 'not_found' : 'conflict', message: out.message });
    push();
    return out;
  });

  /** Мастер отвечает на запрос руководителя: просмотрено, принять, предложить иначе, не могу, сделано */
  app.post<{ Params: { id: string } }>('/api/v1/crew/requests/:id', async (req, reply) => {
    const r = RequestAnswerRequest.safeParse(req.body);
    if (!r.success) {
      const issues = zodIssues(r.error);
      return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message, issues });
    }
    const out = crew.desk.master(req.params.id, r.data.action, { at: r.data.at, text: r.data.text, cantReason: r.data.cantReason }, clock.now());
    if (!out.ok) return reply.code(out.status).send({ error: out.status === 404 ? 'not_found' : 'conflict', message: out.message });
    push();
    return out;
  });

  /** Руководитель на «предложено иначе»: согласен или оставить как было */
  app.post<{ Params: { id: string } }>('/api/v1/crew/requests/:id/answer', async (req, reply) => {
    const r = ManagerAnswerRequest.safeParse(req.body);
    if (!r.success) {
      const issues = zodIssues(r.error);
      return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message, issues });
    }
    const out = crew.desk.manager(req.params.id, r.data.answer, clock.now());
    if (!out.ok) return reply.code(out.status).send({ error: out.status === 404 ? 'not_found' : 'conflict', message: out.message });
    push();
    return out;
  });

  /** Вкладка «Смена»: выпуск по часам, простои, записи без причины, сдача смены */
  app.get<{ Params: { area: string } }>('/api/v1/crew/shift/:area', async (req) => crew.shiftView(req.params.area, clock.now()));

  /** «Сдать смену»: заметка следующей смене — по желанию */
  app.post<{ Params: { area: string } }>('/api/v1/crew/shift/:area/close', async (req, reply) => {
    const b = (req.body ?? {}) as { note?: unknown; by?: unknown };
    const note = typeof b.note === 'string' ? b.note.slice(0, 300) : undefined;
    const by = typeof b.by === 'string' ? b.by.slice(0, 120) : undefined;
    const out = crew.closeShift(req.params.area, note, by, clock.now());
    if (!out.ok) return reply.code(out.status).send({ error: 'conflict', message: out.message });
    push();
    return out;
  });

  /** «Как было раньше»: последние 3 случая с этим оборудованием */
  app.get<{ Params: { equipmentId: string }; Querystring: { exclude?: string } }>('/api/v1/crew/history/:equipmentId', async (req) =>
    crew.pastCases(req.params.equipmentId, req.query.exclude, clock.now()),
  );

  /** Руководитель увидел просьбу мастера о помощи */
  app.post<{ Params: { id: string } }>('/api/v1/crew/log/:id/ack', async (req, reply) => {
    const out = crew.ackHelp(req.params.id, clock.now());
    if (!out.ok) return reply.code(out.status).send({ error: 'not_found', message: out.message });
    push();
    return out;
  });

  /** Запись журнала: новая или правка */
  app.post('/api/v1/crew/log', async (req, reply) => {
    const r = LogEntryRequest.safeParse(req.body);
    if (!r.success) {
      const issues = zodIssues(r.error);
      return reply.code(400).send({ error: 'validation_failed', message: issues[0]?.message, issues });
    }
    const out = crew.saveEntry(r.data, clock.now());
    if (!out.ok) return reply.code(out.status).send({ error: 'not_found', message: out.message });
    push();
    return out;
  });
}
