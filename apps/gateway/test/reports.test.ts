// Отчёты файлами: каждый отчёт в каждом своём формате собирается на демо-данных, не пустой, читается обратно;
// в PDF встроен шрифт и кириллица извлекается; CSV — с BOM; чужой формат — 400 с понятным текстом.
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import Fastify from 'fastify';
import { SEED_MODEL, type CanonicalEvent } from '@allur/contracts';
import { checkable } from '@allur/twin-core';
import { RUN_START_MS } from '../../../packages/simulators/src/scenarios';
import { Crew } from '../src/crew';
import { RequestDesk } from '../src/requests';
import type { TwinService } from '../src/twin';
import { REPORTS, ReportError, contentDisposition, generateReport, type ReportSource } from '../src/reports';
import { reportRoutes } from '../src/routes/reports';
import { startDemo } from './harness';

/** Текст PDF: pdf.js извлекает его по таблице ToUnicode встроенного шрифта */
async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    text += c.items.map((x) => ('str' in x ? x.str : '')).join('') + '\n';
  }
  return text;
}

function setup() {
  const demo = startDemo('paint_filter', 1);
  demo.until('13:40');
  const svc = {
    twin: demo.twin,
    checkableIncidents: () => demo.twin.book.all().filter(checkable),
    setVerdict: (k: string, v: Parameters<TwinService['setVerdict']>[1]) => demo.twin.setVerdict(k, v),
  } as unknown as TwinService;
  const desk = new RequestDesk(() => SEED_MODEL, () => {});
  const crew = new Crew(svc, () => demo.twin.plant, desk);
  crew.sync(demo.now());
  // руководитель отправил мастеру запрос, мастер предложил другое время
  const inc = demo.twin.incidents().find((i) => i.type === 'quality' && i.area === 'paint')!;
  const option = inc.options.find((o) => o.id === 'replace_now') ?? inc.options[0]!;
  const req = desk.create(inc, option, null, demo.now() + 30 * 60_000, 'Начальник производства', demo.now());
  desk.master(req.requestId, 'counter', { at: new Date(demo.now() + 60 * 60_000).toISOString(), text: 'нет наладчика' }, demo.now() + 60_000);
  // мастер сам записал простой с причиной
  crew.saveEntry({ area: 'paint', equipmentId: 'BOOTH-02', reason: 'setup', comment: 'промывка форсунок', from: new Date(demo.now() - 20 * 60_000).toISOString(), to: new Date(demo.now() - 5 * 60_000).toISOString() } as never, demo.now());
  const events: CanonicalEvent[] = [];
  const src: ReportSource = {
    twin: demo.twin,
    crew,
    now: demo.now(),
    runStartMs: RUN_START_MS,
    eventsByVin: () => events,
    forecast: () => demo.twin.forecast(demo.now()),
  };
  const vin = demo.twin.state.passes.find((p) => p.vin)!.vin;
  return { demo, src, vin, incidentId: inc.id };
}

describe('отчёты файлами', () => {
  const { src, vin, incidentId } = setup();
  const params: Record<string, Record<string, string>> = {
    shift: { area: 'paint', by: 'Мастер окраски' },
    downtimes: {},
    vin: { vin },
    incident: { incidentId },
    quality: {},
    plan: {},
  };

  for (const [type, def] of Object.entries(REPORTS)) {
    for (const format of def.formats) {
      it(`${def.title} — ${format}: собирается быстрее 3 с и читается`, async () => {
        const t0 = Date.now();
        const file = await generateReport(type, format, src, params[type]!);
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(file.body.length).toBeGreaterThan(500);
        expect(file.filename.endsWith(`.${format}`)).toBe(true);
        if (format === 'pdf') {
          expect(file.body.subarray(0, 4).toString('latin1')).toBe('%PDF');
          expect(file.body.includes('FontFile2')).toBe(true);
          const text = (await pdfText(file.body)).replace(/\s+/g, ' ');
          expect(text).toContain(def.title);
          expect(text).toContain('Данные синтетические');
        }
        if (format === 'xlsx') {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(file.body as never);
          expect(wb.worksheets.length).toBeGreaterThan(0);
        }
        if (format === 'docx') {
          expect(file.body.subarray(0, 2).toString('latin1')).toBe('PK');
          expect(file.body.includes('word/document.xml')).toBe(true);
        }
        if (format === 'csv') {
          expect([...file.body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
          expect(file.body.toString('utf8')).toContain(';');
        }
      }, 30_000);
    }
  }

  it('сводка смены в Excel: пять листов, закреплённая шапка, автофильтр, формулы итогов, числа — числами', async () => {
    const file = await generateReport('shift', 'xlsx', src, params.shift!);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Итог', 'По часам', 'Простои', 'Брак', 'Запросы']);
    const hours = wb.getWorksheet('По часам')!;
    expect(hours.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    expect(hours.autoFilter).toBeTruthy();
    expect(typeof hours.getCell(5, 2).value).toBe('number');
    const formulas: string[] = [];
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { const v = c.value as { formula?: string } | null; if (v && typeof v === 'object' && 'formula' in v && v.formula) formulas.push(v.formula); }));
    expect(formulas.some((f) => f.startsWith('SUM('))).toBe(true);
    // минуты простоя: сумма листа совпадает с «простой за смену» на вкладке мастера
    const view = src.crew.shiftView('paint', src.now);
    const downtime = wb.getWorksheet('Простои')!;
    let sum = 0;
    downtime.eachRow((row, i) => { if (i > 4 && typeof row.getCell(4).value === 'number') sum += row.getCell(4).value as number; });
    expect(Math.round(sum)).toBe(view.summary.downtimeMin);
    // запрос со встречным предложением мастера
    const reqs = wb.getWorksheet('Запросы')!;
    expect(JSON.stringify(reqs.getRow(5).values)).toContain('предложил');
  }, 30_000);

  it('журнал простоев в Excel: лист «Сводка» с SUMIFS по листу «Журнал»', async () => {
    const file = await generateReport('downtimes', 'xlsx', src, {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Журнал', 'Сводка']);
    const formulas: string[] = [];
    wb.getWorksheet('Сводка')!.eachRow((row) => row.eachCell((c) => { const v = c.value as { formula?: string } | null; if (v && typeof v === 'object' && v.formula) formulas.push(v.formula); }));
    expect(formulas.some((f) => f.startsWith('SUMIFS('))).toBe(true);
    expect(wb.getWorksheet('Журнал')!.rowCount).toBeGreaterThan(6);
  }, 30_000);

  it('сводка смены в PDF: кириллица извлекается, есть шапка и пометка о прототипе', async () => {
    const file = await generateReport('shift', 'pdf', src, params.shift!);
    const text = (await pdfText(file.body)).replace(/\s+/g, ' ');
    expect(text).toContain('Сводка смены');
    expect(text).toContain('Окраска');
    expect(text).toContain('Прототип цифрового двойника');
    expect(file.filename).toBe('Сводка_смены_Окраска_2026-10-07_смена-1.pdf');
  }, 30_000);

  it('чужой формат — 400 с понятным текстом; без участка — 400', async () => {
    await expect(generateReport('vin', 'xlsx', src, { vin })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Доступно: pdf (PDF), docx (Word)') });
    await expect(generateReport('shift', 'pdf', src, {})).rejects.toBeInstanceOf(ReportError);
    await expect(generateReport('nope', 'pdf', src, {})).rejects.toMatchObject({ status: 404 });
  }, 30_000);

  it('имя файла: кириллица в filename*, ASCII-запасной filename', () => {
    const h = contentDisposition('Сводка_смены_Окраска_2026-10-08_смена-1.pdf');
    expect(h).toContain(`filename*=UTF-8''${encodeURIComponent('Сводка_смены_Окраска_2026-10-08_смена-1.pdf')}`);
    expect(h).toMatch(/filename="[\x20-\x7e]+\.pdf"/);
  });

  it('GET /api/v1/reports/:type отдаёт файл с заголовками, на чужой формат — 400', async () => {
    const app = Fastify();
    reportRoutes(app, () => src);
    const ok = await app.inject({ method: 'GET', url: '/api/v1/reports/downtimes?format=csv&area=paint' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('text/csv');
    expect(String(ok.headers['content-disposition'])).toContain("filename*=UTF-8''");
    const bad = await app.inject({ method: 'GET', url: '/api/v1/reports/shift?format=csv&area=paint' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toContain('не выгружается в формате csv');
    await app.close();
  }, 30_000);
});
