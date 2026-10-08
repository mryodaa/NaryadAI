// CSV для Excel на Windows: UTF-8 с BOM, разделитель «;», числа с запятой. Шапка отчёта — строками сверху,
// пометка о прототипе — строкой снизу. В CSV — первая таблица отчёта (у журнала простоев — сам журнал).
import { csvCell } from './format';
import { PROTOTYPE_NOTE, type ReportDoc } from './model';

const BOM = '﻿';

function q(s: string): string {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderCsv(doc: ReportDoc): Buffer {
  const lines: string[] = [];
  lines.push(q(`${doc.title} — ${doc.subtitle}`));
  for (const [k, v] of doc.meta) lines.push(`${q(k)};${q(v)}`);
  lines.push('');
  const t = doc.sections.find((s) => s.kind === 'table');
  if (t && t.kind === 'table') {
    lines.push(t.table.columns.map((c) => q(c.title)).join(';'));
    for (const r of t.table.rows) lines.push(t.table.columns.map((c) => q(csvCell(r[c.key] ?? null, c.type))).join(';'));
    if (t.table.rows.length === 0) lines.push(q(t.table.empty));
  }
  lines.push('');
  lines.push(q(PROTOTYPE_NOTE));
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf8');
}
