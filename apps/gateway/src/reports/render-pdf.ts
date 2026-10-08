// PDF без браузера: pdfmake (поверх pdfkit) со встроенным шрифтом Noto Sans (OFL) — кириллица и знак ₸.
import { fileURLToPath } from 'node:url';
import PdfPrinter from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { fmtCell } from './format';
import { PROTOTYPE_NOTE, type Column, type ReportDoc, type ReportTable } from './model';

const font = (name: string) => fileURLToPath(new URL(`../../assets/fonts/NotoSans-${name}.ttf`, import.meta.url));

let printer: PdfPrinter | null = null;
function getPrinter(): PdfPrinter {
  printer ??= new PdfPrinter({ Noto: { normal: font('Regular'), bold: font('Bold'), italics: font('Italic'), bolditalics: font('BoldItalic') } });
  return printer;
}

const INK = '#1b1f24';
const MUTED = '#5b636e';
const LINE = '#d5dae0';
const HEAD_BG = '#eef1f4';
const BAD = '#b42318';
const MARK_BG = '#fff4e5';

const NUMERIC = new Set(['int', 'dec1', 'pct', 'minutes', 'money']);

/** Знаков, которых нет в Noto Sans, — заменяем, чтобы не было квадратиков (тексты ядра пишут стрелки и «≈») */
const NO_GLYPH: Record<string, string> = { '→': '->', '←': '<-', '↑': '^', '↓': 'v', '≈': '~', '≥': '>=', '≤': '<=', '≠': '!=', '▶': '>', '▲': '^', '▼': 'v', '✓': '+', '✗': 'x', '⚠': '!', '●': '•', '○': 'o', '\uFEFF': '' };
const NO_GLYPH_RE = new RegExp(`[${Object.keys(NO_GLYPH).join('')}]`, 'g');

/** Пройти по документу pdfmake и заменить отсутствующие в шрифте знаки во всех строках */
function clean<T>(node: T): T {
  if (typeof node === 'string') return node.replace(NO_GLYPH_RE, (c) => NO_GLYPH[c] ?? '') as T;
  if (Array.isArray(node)) return node.map(clean) as T;
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (typeof v !== 'function') (node as Record<string, unknown>)[k] = clean(v);
  }
  return node;
}

/** Ширины колонок по весам; pdfmake прибавляет к ширине отступы ячеек (по 4 пт слева и справа) — вычитаем их */
function widths(cols: Column[], total: number): number[] {
  const w = cols.map((c) => c.weight ?? (c.type === 'text' ? 3 : c.type === 'datetime' ? 2 : 1.2));
  const sum = w.reduce((a, b) => a + b, 0);
  const inner = total - cols.length * 8 - 1;
  return w.map((x) => (x / sum) * inner);
}

function table(t: ReportTable, avail: number): Content[] {
  const out: Content[] = [{ text: t.title, style: 'h2', headlineLevel: 1 }];
  if (t.rows.length === 0) {
    out.push({ text: t.empty, style: 'muted', margin: [0, 0, 0, 8] });
    return out;
  }
  const head: TableCell[] = t.columns.map((c) => ({ text: c.title, bold: true, fillColor: HEAD_BG, alignment: NUMERIC.has(c.type) ? 'right' : 'left' }));
  const body: TableCell[][] = [head];
  for (const r of t.rows) {
    const mark = t.highlight?.(r) ?? false;
    body.push(t.columns.map((c) => ({ text: fmtCell(r[c.key] ?? null, c.type), alignment: NUMERIC.has(c.type) ? 'right' : 'left', fillColor: mark ? MARK_BG : undefined })));
  }
  if (t.sumColumns?.length) {
    body.push(
      t.columns.map((c, i) => {
        if (i === 0) return { text: 'Итого', bold: true };
        if (!t.sumColumns!.includes(c.key)) return { text: '' };
        const s = t.rows.reduce((a, r) => a + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0);
        return { text: fmtCell(s, c.type), bold: true, alignment: 'right' };
      }),
    );
  }
  out.push({
    table: { headerRows: 1, widths: widths(t.columns, avail), body, dontBreakRows: true },
    layout: {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5,
    },
    fontSize: 8.5,
    margin: [0, 0, 0, t.note ? 3 : 10],
  });
  if (t.note) out.push({ text: t.note, style: 'note', margin: [0, 0, 0, 10] });
  return out;
}

export function renderPdf(doc: ReportDoc): Promise<Buffer> {
  const pageW = doc.landscape ? 841.89 : 595.28;
  const margin = 36;
  const avail = pageW - margin * 2;
  const content: Content[] = [
    { text: doc.title, style: 'h1' },
    { text: doc.subtitle, style: 'sub' },
    {
      table: { widths: [102, avail - 102 - 17], body: doc.meta.map(([k, v]) => [{ text: k, color: MUTED }, { text: v }]) },
      layout: 'noBorders',
      fontSize: 9,
      margin: [0, 0, 0, 10],
    },
  ];
  for (const s of doc.sections) {
    if (s.kind === 'table') content.push(...table(s.table, avail));
    else if (s.kind === 'text') {
      content.push({ text: s.title, style: 'h2', headlineLevel: 1 });
      content.push({ stack: s.lines.map((l) => ({ text: l, margin: [0, 0, 0, 2] })), margin: [0, 0, 0, 10] });
    } else {
      content.push({ text: s.title, style: 'h2', headlineLevel: 1 });
      const inner = avail - 3 * 8 - 1;
      content.push({
        table: {
          widths: [inner * 0.42, inner * 0.2, inner * 0.38],
          body: s.items.map((k) => [
            { text: k.label, color: MUTED },
            { text: fmtCell(k.value, k.type), bold: true, color: k.bad ? BAD : INK, alignment: 'right' },
            { text: k.note ?? '', color: MUTED, fontSize: 8.5 },
          ]),
        },
        layout: { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 3, paddingBottom: () => 3 },
        fontSize: 10,
        margin: [0, 0, 0, 10],
      });
    }
  }
  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: doc.landscape ? 'landscape' : 'portrait',
    pageMargins: [margin, 36, margin, 44],
    info: { title: doc.title, subject: doc.subtitle, creator: 'Цифровой двойник цеха (прототип)' },
    defaultStyle: { font: 'Noto', fontSize: 9.5, color: INK, lineHeight: 1.15 },
    styles: {
      h1: { fontSize: 17, bold: true, margin: [0, 0, 0, 2] },
      sub: { fontSize: 11, color: MUTED, margin: [0, 0, 0, 8] },
      h2: { fontSize: 12, bold: true, margin: [0, 6, 0, 4] },
      muted: { color: MUTED, italics: true },
      note: { color: MUTED, fontSize: 8 },
    },
    // заголовок раздела не остаётся один внизу страницы
    pageBreakBefore: (node: { headlineLevel?: number; startPosition: { top: number } }, followers: unknown[]) => node.headlineLevel === 1 && (followers.length === 0 || node.startPosition.top > (doc.landscape ? 480 : 720)),
    footer: (page: number, pages: number) => ({
      columns: [
        { text: PROTOTYPE_NOTE, width: '*' },
        { text: clean(`${doc.title} · стр. ${page} из ${pages}`), width: 'auto', alignment: 'right' },
      ],
      margin: [margin, 14, margin, 0],
      fontSize: 7.5,
      color: MUTED,
    }),
    content: clean(content),
  };
  return new Promise((resolve, reject) => {
    const pdf = getPrinter().createPdfKitDocument(def);
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}
