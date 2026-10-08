// Отчёты файлами: GET /api/v1/reports/:type?format=pdf|xlsx|docx|csv&area=&shift=&date=&from=&to=&vin=&incidentId=
// Файл собирает шлюз — одинаково для ноутбука, телефона мастера и внешней системы.
import type { FastifyInstance } from 'fastify';
import { ReportError, contentDisposition, generateReport, type ReportParams, type ReportSource } from '../reports';

type Query = ReportParams & { format?: string };

export function reportRoutes(app: FastifyInstance, source: () => ReportSource) {
  app.get<{ Params: { type: string }; Querystring: Query }>('/api/v1/reports/:type', async (req, reply) => {
    const { format, ...params } = req.query;
    for (const [k, v] of Object.entries(params)) if (typeof v !== 'string') delete (params as Record<string, unknown>)[k];
    try {
      const src = source();
      if (!src.twin.ready) throw new ReportError(503, 'Двойник ещё запускается — повторите через несколько секунд');
      const file = await generateReport(req.params.type, format, src, params);
      return reply
        .header('content-type', file.contentType)
        .header('content-disposition', contentDisposition(file.filename))
        .header('cache-control', 'no-store')
        .header('access-control-expose-headers', 'content-disposition')
        .send(file.body);
    } catch (e) {
      if (e instanceof ReportError) {
        return reply.code(e.status).send({ error: e.status === 404 ? 'not_found' : e.status === 503 ? 'booting' : 'bad_request', message: e.message });
      }
      throw e;
    }
  });
}
