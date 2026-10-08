// Word: та же модель отчёта — заголовок, шапка, итоговые цифры, таблицы; внизу каждой страницы — пометка о прототипе.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { fmtCell } from './format';
import { PROTOTYPE_NOTE, type ReportDoc, type ReportTable } from './model';

const MUTED = '5B636E';
const BAD = 'B42318';
const HEAD_BG = 'EEF1F4';
const MARK_BG = 'FFF4E5';
const LINE = { style: BorderStyle.SINGLE, size: 4, color: 'D5DAE0' };
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NUMERIC = new Set(['int', 'dec1', 'pct', 'minutes', 'money']);
const FONT_SIZE = 18; // полупункты: 9 pt

function cell(text: string, opts: { bold?: boolean; color?: string; fill?: string; right?: boolean; width?: number; size?: number } = {}) {
  return new TableCell({
    children: [
      new Paragraph({
        alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [new TextRun({ text, bold: opts.bold, color: opts.color, size: opts.size ?? FONT_SIZE })],
      }),
    ],
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    borders: { top: LINE, bottom: LINE, left: NONE, right: NONE },
  });
}

function colWidths(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((w / sum) * total));
}

function h2(text: string) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text, bold: true, size: 24, color: '1B1F24' })] });
}

function table(t: ReportTable, avail: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [h2(t.title)];
  if (t.rows.length === 0) {
    out.push(new Paragraph({ children: [new TextRun({ text: t.empty, italics: true, color: MUTED, size: FONT_SIZE })] }));
    return out;
  }
  const widths = colWidths(
    t.columns.map((c) => c.weight ?? (c.type === 'text' ? 3 : c.type === 'datetime' ? 2 : 1.2)),
    avail,
  );
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: t.columns.map((c, i) => cell(c.title, { bold: true, fill: HEAD_BG, right: NUMERIC.has(c.type), width: widths[i] })),
    }),
  ];
  for (const r of t.rows) {
    const mark = t.highlight?.(r) ?? false;
    rows.push(
      new TableRow({
        cantSplit: true,
        children: t.columns.map((c, i) => cell(fmtCell(r[c.key] ?? null, c.type), { right: NUMERIC.has(c.type), fill: mark ? MARK_BG : undefined, width: widths[i] })),
      }),
    );
  }
  if (t.sumColumns?.length) {
    rows.push(
      new TableRow({
        children: t.columns.map((c, i) => {
          if (i === 0) return cell('Итого', { bold: true, width: widths[i] });
          if (!t.sumColumns!.includes(c.key)) return cell('', { width: widths[i] });
          const s = t.rows.reduce((a, r) => a + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0);
          return cell(fmtCell(s, c.type), { bold: true, right: true, width: widths[i] });
        }),
      }),
    );
  }
  out.push(new Table({ rows, width: { size: avail, type: WidthType.DXA }, columnWidths: widths }));
  if (t.note) out.push(new Paragraph({ spacing: { before: 40 }, children: [new TextRun({ text: t.note, color: MUTED, size: 16 })] }));
  return out;
}

export async function renderDocx(doc: ReportDoc): Promise<Buffer> {
  // A4, поля 1,27 см; ширина текста в twips
  const avail = doc.landscape ? 16838 - 1440 : 11906 - 1440;
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 40 }, children: [new TextRun({ text: doc.title, bold: true, size: 34, color: '1B1F24' })] }),
    new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: doc.subtitle, color: MUTED, size: 22 })] }),
    new Table({
      width: { size: avail, type: WidthType.DXA },
      columnWidths: [2400, avail - 2400],
      rows: doc.meta.map(
        ([k, v]) =>
          new TableRow({
            children: [cell(k, { color: MUTED, width: 2400 }), cell(v, { width: avail - 2400 })],
          }),
      ),
    }),
  ];
  for (const s of doc.sections) {
    if (s.kind === 'table') children.push(...table(s.table, avail));
    else if (s.kind === 'text') {
      children.push(h2(s.title));
      for (const l of s.lines) children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: l, size: 20 })] }));
    } else {
      children.push(h2(s.title));
      const w = colWidths([42, 20, 38], avail);
      children.push(
        new Table({
          width: { size: avail, type: WidthType.DXA },
          columnWidths: w,
          rows: s.items.map(
            (k) =>
              new TableRow({
                children: [
                  cell(k.label, { color: MUTED, width: w[0], size: 20 }),
                  cell(fmtCell(k.value, k.type), { bold: true, right: true, color: k.bad ? BAD : undefined, width: w[1], size: 20 }),
                  cell(k.note ?? '', { color: MUTED, width: w[2] }),
                ],
              }),
          ),
        }),
      );
    }
  }
  const document = new Document({
    creator: 'Цифровой двойник цеха (прототип)',
    title: doc.title,
    description: PROTOTYPE_NOTE,
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: doc.landscape ? { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 } : { width: 11906, height: 16838 },
            margin: { top: 720, bottom: 900, left: 720, right: 720, footer: 360 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${PROTOTYPE_NOTE} · ${doc.title} · стр. `, color: MUTED, size: 15 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 15 }),
                  new TextRun({ text: ' из ', color: MUTED, size: 15 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: MUTED, size: 15 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
