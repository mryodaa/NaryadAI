// Excel: лист «Итог» с шапкой и цифрами, таблицы — отдельными листами: закреплённая строка заголовков,
// автофильтр, ширина по содержимому, числа — числами с форматом, итоги — формулами.
import ExcelJS from 'exceljs';
import { fmtCell } from './format';
import { PROTOTYPE_NOTE, type CellValue, type ColType, type ReportDoc, type ReportTable } from './model';

const PLANT_OFFSET_MS = 5 * 3600_000;
const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F4' } };
const MARK_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E5' } };
const MUTED = { argb: 'FF5B636E' };
const BAD = { argb: 'FFB42318' };

export const NUM_FMT: Record<ColType, string | undefined> = {
  text: undefined,
  int: '#,##0',
  minutes: '#,##0',
  dec1: '#,##0.0',
  pct: '0.0%',
  money: '#,##0 "₸"',
  datetime: 'dd.mm.yyyy hh:mm',
  date: 'dd.mm.yyyy',
  time: 'hh:mm',
};

/** Значение для ячейки Excel: время завода — датой Excel (без сдвига часового пояса) */
function xlValue(v: CellValue, type: ColType): ExcelJS.CellValue {
  if (v === null) return null;
  if (typeof v === 'number' && (type === 'datetime' || type === 'date' || type === 'time')) return new Date(v + PLANT_OFFSET_MS);
  return v;
}

export function colLetter(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function sheetName(s: string): string {
  return s.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
}

function footer(ws: ExcelJS.Worksheet) {
  ws.headerFooter.oddFooter = `&L&8${PROTOTYPE_NOTE}&R&8стр. &P из &N`;
}

/** Строка-пометка в конце листа: видна и без печати */
function noteRow(ws: ExcelJS.Worksheet, row: number, text: string) {
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { italic: true, size: 9, color: MUTED };
}

function tableSheet(wb: ExcelJS.Workbook, doc: ReportDoc, t: ReportTable) {
  const ws = wb.addWorksheet(sheetName(t.sheet ?? t.title));
  footer(ws);
  ws.getCell(1, 1).value = `${t.title} — ${doc.subtitle}`;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.getCell(2, 1).value = doc.meta.map(([k, v]) => `${k}: ${v}`).join(' · ');
  ws.getCell(2, 1).font = { size: 9, color: MUTED };
  const head = 4;
  t.columns.forEach((c, i) => {
    const cell = ws.getCell(head, i + 1);
    cell.value = c.title;
    cell.font = { bold: true };
    cell.fill = HEAD_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  const widths = t.columns.map((c) => Math.max(8, Math.min(60, c.title.length + 2)));
  t.rows.forEach((r, ri) => {
    const row = head + 1 + ri;
    const mark = t.highlight?.(r) ?? false;
    t.columns.forEach((c, ci) => {
      const v = r[c.key] ?? null;
      const cell = ws.getCell(row, ci + 1);
      cell.value = xlValue(v, c.type);
      const fmt = NUM_FMT[c.type];
      if (fmt && typeof v === 'number') cell.numFmt = fmt;
      if (mark) cell.fill = MARK_FILL;
      if (c.type === 'text') cell.alignment = { wrapText: true, vertical: 'top' };
      widths[ci] = Math.max(widths[ci]!, Math.min(60, fmtCell(v, c.type).length + 2));
    });
  });
  const first = head + 1;
  const last = head + t.rows.length;
  let end = last;
  if (t.sumColumns?.length && t.rows.length > 0) {
    end = last + 1;
    ws.getCell(end, 1).value = 'Итого';
    ws.getCell(end, 1).font = { bold: true };
    t.columns.forEach((c, ci) => {
      if (!t.sumColumns!.includes(c.key)) return;
      const L = colLetter(ci + 1);
      const result = t.rows.reduce((a, r) => a + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0);
      const cell = ws.getCell(end, ci + 1);
      cell.value = { formula: `SUM(${L}${first}:${L}${last})`, result };
      cell.numFmt = NUM_FMT[c.type] ?? '#,##0';
      cell.font = { bold: true };
    });
  }
  if (t.rows.length === 0) noteRow(ws, first, t.empty);
  t.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? widths[i]));
  ws.views = [{ state: 'frozen', ySplit: head, xSplit: 0 }];
  if (t.rows.length > 0) ws.autoFilter = { from: { row: head, column: 1 }, to: { row: last, column: t.columns.length } };
  let n = end + 2;
  if (t.note) noteRow(ws, n++, t.note);
  noteRow(ws, n, PROTOTYPE_NOTE);
  return { ws, firstRow: first, lastRow: last, colOf: (key: string) => colLetter(t.columns.findIndex((c) => c.key === key) + 1) };
}

function summarySheet(wb: ExcelJS.Workbook, doc: ReportDoc, name: string) {
  const ws = wb.addWorksheet(sheetName(name));
  footer(ws);
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 60;
  let r = 1;
  ws.getCell(r, 1).value = doc.title;
  ws.getCell(r++, 1).font = { bold: true, size: 15 };
  ws.getCell(r, 1).value = doc.subtitle;
  ws.getCell(r++, 1).font = { size: 11, color: MUTED };
  r++;
  for (const [k, v] of doc.meta) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = { color: MUTED };
    ws.getCell(r++, 2).value = v;
  }
  for (const s of doc.sections) {
    if (s.kind === 'table') continue;
    r++;
    ws.getCell(r, 1).value = s.title;
    ws.getCell(r++, 1).font = { bold: true, size: 12 };
    if (s.kind === 'kpis') {
      for (const k of s.items) {
        ws.getCell(r, 1).value = k.label;
        const c = ws.getCell(r, 2);
        c.value = xlValue(k.value, k.type);
        const fmt = NUM_FMT[k.type];
        if (fmt && typeof k.value === 'number') c.numFmt = fmt;
        c.font = { bold: true, color: k.bad ? BAD : undefined };
        c.alignment = { horizontal: 'right' };
        if (k.note) {
          ws.getCell(r, 3).value = k.note;
          ws.getCell(r, 3).font = { size: 9, color: MUTED };
        }
        r++;
      }
    } else {
      for (const l of s.lines) {
        ws.getCell(r, 1).value = l;
        ws.getCell(r++, 1).alignment = { wrapText: false };
      }
    }
  }
  r++;
  noteRow(ws, r, PROTOTYPE_NOTE);
}

export async function renderXlsx(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Цифровой двойник цеха (прототип)';
  wb.title = doc.title;
  wb.description = PROTOTYPE_NOTE;
  wb.created = new Date();
  if (doc.summarySheet) summarySheet(wb, doc, doc.summarySheet);
  const sheets = new Map<string, ReturnType<typeof tableSheet>>();
  for (const s of doc.sections) {
    if (s.kind !== 'table' || s.table.skipXlsx) continue;
    const key = s.table.sheet ?? s.table.title;
    sheets.set(key, tableSheet(wb, doc, s.table));
  }
  doc.xlsxExtra?.(wb, sheets);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
