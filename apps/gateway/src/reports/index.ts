// Реестр отчётов: тип → доступные форматы и построитель. Один вход для маршрута и тестов.
import type { ReportDoc, ReportFormat } from './model';
import { renderCsv } from './render-csv';
import { renderDocx } from './render-docx';
import { renderPdf } from './render-pdf';
import { renderXlsx } from './render-xlsx';
import { ReportError, type ReportParams, type ReportSource } from './source';
import { buildShiftReport } from './shift';
import { buildDowntimesReport } from './downtimes';
import { buildPassportReport } from './passport';
import { buildIncidentReport } from './incident';
import { buildQualityReport } from './quality';
import { buildPlanReport } from './plan';

export { ReportError, type ReportParams, type ReportSource } from './source';
export type { ReportFormat } from './model';

interface ReportDef {
  title: string;
  formats: ReportFormat[];
  build: (src: ReportSource, p: ReportParams, format: ReportFormat) => ReportDoc;
}

export const REPORTS: Record<string, ReportDef> = {
  shift: { title: 'Сводка смены', formats: ['pdf', 'docx', 'xlsx'], build: buildShiftReport },
  downtimes: { title: 'Журнал простоев', formats: ['xlsx', 'csv', 'pdf'], build: buildDowntimesReport },
  vin: { title: 'Паспорт автомобиля', formats: ['pdf', 'docx'], build: buildPassportReport },
  incident: { title: 'Отчёт по инциденту', formats: ['pdf', 'docx'], build: buildIncidentReport },
  quality: { title: 'Качество за период', formats: ['xlsx', 'pdf'], build: buildQualityReport },
  plan: { title: 'План и прогноз месяца', formats: ['xlsx'], build: buildPlanReport },
};

const FORMAT_RU: Record<ReportFormat, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV' };

export const CONTENT_TYPE: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

export interface ReportFile {
  body: Buffer;
  filename: string;
  contentType: string;
}

export async function generateReport(type: string, format: string | undefined, src: ReportSource, p: ReportParams): Promise<ReportFile> {
  const def = REPORTS[type];
  if (!def) throw new ReportError(404, `Нет такого отчёта: ${type}. Есть: ${Object.keys(REPORTS).join(', ')}`);
  const fmt = (format ?? def.formats[0]) as ReportFormat;
  if (!def.formats.includes(fmt)) {
    throw new ReportError(400, `«${def.title}» не выгружается в формате ${format}. Доступно: ${def.formats.map((f) => `${f} (${FORMAT_RU[f]})`).join(', ')}`);
  }
  const doc = def.build(src, p, fmt);
  const body = fmt === 'pdf' ? await renderPdf(doc) : fmt === 'docx' ? await renderDocx(doc) : fmt === 'xlsx' ? await renderXlsx(doc) : renderCsv(doc);
  return { body, filename: `${doc.fileBase}.${fmt}`, contentType: CONTENT_TYPE[fmt] };
}

const TRANSLIT: Record<string, string> = Object.fromEntries(
  [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі'].map((c, i) =>
    [c, ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'kh', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya', 'a', 'g', 'k', 'n', 'o', 'u', 'u', 'h', 'i'][i]!],
  ),
);

function translit(s: string): string {
  return [...s]
    .map((c) => {
      const low = c.toLowerCase();
      const t = TRANSLIT[low];
      if (t === undefined) return c;
      return c === low ? t : t.charAt(0).toUpperCase() + t.slice(1);
    })
    .join('');
}

/** Кириллица — в filename*=UTF-8''…, рядом ASCII-запасной filename (транслитом) */
export function contentDisposition(filename: string): string {
  const ascii = translit(filename)
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\;]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_(?=\.)/g, '');
  const fallback = ascii.replace(/\.[a-z]+$/, '').length > 2 ? ascii : `report${filename.slice(filename.lastIndexOf('.'))}`;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
