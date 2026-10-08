// «Журнал простоев» за период: записи журнала мастера текущего прогона (контроллер, 1С:MES, сигнал, мастер —
// одна остановка одной строкой) и записи 1С:MES из истории. Плановое ТО в журнал не входит — как у мастера.
import { DOWNTIME_CATEGORY_LABELS, addDays, plantDate, plantMs, shiftAt, type DowntimeCategoryId } from '@allur/contracts';
import { fileWord, fmtIsoDate } from './format';
import { PROTOTYPE_NOTE, type ReportDoc, type ReportFormat, type Row } from './model';
import { ReportError, SOURCE_RU, areaName, baseMeta, eqName, stopReasonRu, type ReportParams, type ReportSource } from './source';
import { colLetter, NUM_FMT } from './render-xlsx';

/** Одна и та же остановка в журнале мастера и в 1С:MES — одна строка */
const SAME_STOP_MS = 10 * 60_000;
const DEFAULT_DAYS = 7;

export function resolvePeriod(src: ReportSource, p: ReportParams): { from: string; to: string; fromMs: number; toMs: number } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if ((p.from && !re.test(p.from)) || (p.to && !re.test(p.to))) throw new ReportError(400, 'Период: from и to — даты в виде ГГГГ-ММ-ДД');
  const to = p.to ?? plantDate(src.now);
  const from = p.from ?? addDays(to, -(DEFAULT_DAYS - 1));
  if (from > to) throw new ReportError(400, 'Начало периода позже конца');
  if (plantMs(to) - plantMs(from) > 92 * 86_400_000) throw new ReportError(400, 'Период — не больше 3 месяцев');
  return { from, to, fromMs: plantMs(from), toMs: Math.min(plantMs(addDays(to, 1)), src.now) };
}

export function areaFilter(src: ReportSource, p: ReportParams): string | null {
  if (!p.area || p.area === 'all') return null;
  if (!src.twin.plant.stageById.has(p.area)) throw new ReportError(404, `Участок «${p.area}» не найден`);
  return p.area;
}

interface Stop {
  from: number;
  to: number | null;
  area: string;
  equipmentId: string;
  category: string;
  comment: string;
  source: string;
  confirmed: string;
  service: string;
}

export function collectStops(src: ReportSource, fromMs: number, toMs: number, area: string | null): Stop[] {
  const out: Stop[] = [];
  const st = src.twin.state;
  const requests = src.crew.desk.all();
  // журнал мастера: остановки текущего прогона с причинами мастера
  for (const e of src.crew.journal()) {
    if (e.kind !== 'downtime' || !e.from || !e.equipmentId) continue;
    const from = Date.parse(e.from);
    if (from < fromMs || from >= toMs || (area && e.area !== area)) continue;
    const to = e.to ? Date.parse(e.to) : null;
    const called = e.needHelp || requests.some((r) => r.equipmentId === e.equipmentId && Date.parse(r.at) >= from - 5 * 60_000 && Date.parse(r.at) <= (to ?? src.now));
    out.push({
      from,
      to,
      area: e.area,
      equipmentId: e.equipmentId,
      category: stopReasonRu(e.reason) ?? 'не записана',
      comment: e.comment ?? '',
      source: e.origin === 'signal' ? 'Сигнал → мастер' : SOURCE_RU(e.origin),
      confirmed: e.origin === 'plc' && !e.reason ? 'нет' : 'да',
      service: called ? 'да' : 'нет',
    });
  }
  // 1С:MES: история и всё, чего нет в журнале
  for (const d of st.downtimes.values()) {
    if (d.category === 'planned' || d.source === 'master') continue;
    if (d.from < fromMs || d.from >= toMs || (area && d.area !== area)) continue;
    if (out.some((o) => o.equipmentId === d.equipmentId && Math.abs(o.from - d.from) <= SAME_STOP_MS)) continue;
    out.push({
      from: d.from,
      to: d.to,
      area: d.area,
      equipmentId: d.equipmentId,
      category: DOWNTIME_CATEGORY_LABELS[d.category as DowntimeCategoryId] ?? d.category,
      comment: d.reason,
      source: `1С:MES${d.registeredBy ? ` (${d.registeredBy})` : ''}`,
      confirmed: 'да (запись 1С:MES)',
      service: 'нет данных',
    });
  }
  return out.sort((a, b) => a.from - b.from);
}

function stopRow(src: ReportSource, s: Stop): Row {
  const shift = shiftAt(s.from);
  return {
    date: plantMs(plantDate(s.from)),
    shift: shift ? `${shift.index}` : '—',
    area: areaName(src, s.area, true),
    eq: eqName(src, s.equipmentId),
    from: s.from,
    to: s.to ?? 'идёт',
    minutes: Math.round(((s.to ?? src.now) - s.from) / 60_000),
    category: s.category,
    comment: s.comment,
    source: s.source,
    confirmed: s.confirmed,
    service: s.service,
  };
}

function groupSum(rows: Row[], key: string): { name: string; minutes: number; count: number }[] {
  const m = new Map<string, { name: string; minutes: number; count: number }>();
  for (const r of rows) {
    const k = String(r[key]);
    const g = m.get(k) ?? { name: k, minutes: 0, count: 0 };
    g.minutes += r.minutes as number;
    g.count++;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.minutes - a.minutes);
}

export function buildDowntimesReport(src: ReportSource, p: ReportParams, format: ReportFormat): ReportDoc {
  const per = resolvePeriod(src, p);
  const area = areaFilter(src, p);
  const rows = collectStops(src, per.fromMs, per.toMs, area).map((s) => stopRow(src, s));
  const areaText = area ? areaName(src, area) : 'все участки';
  const periodText = `${fmtIsoDate(per.from)} — ${fmtIsoDate(per.to)}`;
  const total = rows.reduce((a, r) => a + (r.minutes as number), 0);
  const byArea = groupSum(rows, 'area');
  const byCategory = groupSum(rows, 'category');
  const byEq = groupSum(rows, 'eq');
  const noReason = rows.filter((r) => r.category === 'не записана').length;
  const fileBase = `Журнал_простоев_${area ? fileWord(areaName(src, area, true)) : 'все_участки'}_${per.from}_${per.to}`;
  const meta = baseMeta(src, p, [
    ['Участок', areaText],
    ['Период', periodText],
    ['Источники', 'Журнал мастера текущего прогона (контроллер, 1С:MES, сигналы, мастер) и записи 1С:MES из истории'],
  ]);
  const kpis = {
    kind: 'kpis' as const,
    title: 'Итог за период',
    items: [
      { label: 'Простоев', value: rows.length, type: 'int' as const },
      { label: 'Минут простоя', value: total, type: 'minutes' as const, note: 'без планового ТО и микропростоев до 3 мин' },
      { label: 'Без причины', value: noReason, type: 'int' as const, bad: noReason > 0 },
    ],
  };
  const journal = {
    kind: 'table' as const,
    table: {
      sheet: 'Журнал',
      title: 'Журнал простоев',
      columns: [
        { key: 'date', title: 'Дата', type: 'date' as const, weight: 1 },
        { key: 'shift', title: 'Смена', type: 'text' as const, weight: 0.5 },
        { key: 'area', title: 'Участок', type: 'text' as const, weight: 1 },
        { key: 'eq', title: 'Оборудование', type: 'text' as const, weight: 1.5 },
        { key: 'from', title: 'Начало', type: 'datetime' as const, weight: 1.3 },
        { key: 'to', title: 'Конец', type: 'datetime' as const, weight: 1.3 },
        { key: 'minutes', title: 'Минут', type: 'minutes' as const, weight: 0.6 },
        { key: 'category', title: 'Категория причины', type: 'text' as const, weight: 1.2 },
        { key: 'comment', title: 'Комментарий мастера', type: 'text' as const, weight: 2.2 },
        { key: 'source', title: 'Источник', type: 'text' as const, weight: 1.6 },
        { key: 'confirmed', title: 'Подтверждено мастером', type: 'text' as const, weight: 1.2 },
        { key: 'service', title: 'Вызвана служба', type: 'text' as const, weight: 0.9 },
      ],
      rows,
      sumColumns: ['minutes'],
      highlight: (r: Row) => r.category === 'не записана',
      empty: 'За период простоев нет',
      note: '«Вызвана служба» — мастер попросил помощи или по оборудованию был запрос руководителя; для истории 1С:MES этих данных нет.',
    },
  };
  if (format === 'pdf') {
    // PDF — только сводка и топ-10 простоев
    return {
      title: 'Журнал простоев',
      subtitle: `${areaText} · ${periodText}`,
      fileBase,
      meta,
      sections: [
        kpis,
        { kind: 'table', table: { title: 'Минуты простоя по участкам', columns: [{ key: 'name', title: 'Участок', type: 'text' }, { key: 'count', title: 'Простоев', type: 'int' }, { key: 'minutes', title: 'Минут', type: 'minutes' }], rows: byArea, sumColumns: ['count', 'minutes'], empty: 'Нет данных' } },
        { kind: 'table', table: { title: 'Минуты простоя по причинам', columns: [{ key: 'name', title: 'Категория причины', type: 'text' }, { key: 'count', title: 'Простоев', type: 'int' }, { key: 'minutes', title: 'Минут', type: 'minutes' }], rows: byCategory, sumColumns: ['count', 'minutes'], empty: 'Нет данных' } },
        {
          kind: 'table',
          table: {
            title: 'Топ-10 простоев по длительности',
            columns: journal.table.columns.filter((c) => ['from', 'area', 'eq', 'minutes', 'category', 'comment', 'source'].includes(c.key)),
            rows: [...rows].sort((a, b) => (b.minutes as number) - (a.minutes as number)).slice(0, 10),
            empty: 'За период простоев нет',
            note: 'Полный журнал — в Excel или CSV.',
          },
        },
      ],
    };
  }
  return {
    title: 'Журнал простоев',
    subtitle: `${areaText} · ${periodText}`,
    fileBase,
    meta,
    landscape: true,
    sections: [journal],
    xlsxExtra: (wb, sheets) => {
      const j = sheets.get('Журнал');
      if (!j) return;
      const ws = wb.addWorksheet('Сводка');
      ws.headerFooter.oddFooter = `&L&8${PROTOTYPE_NOTE}&R&8стр. &P из &N`;
      ws.getColumn(1).width = 34;
      ws.getColumn(2).width = 14;
      ws.getColumn(3).width = 14;
      ws.getCell(1, 1).value = `Сводка простоев — ${areaText} · ${periodText}`;
      ws.getCell(1, 1).font = { bold: true, size: 13 };
      const last = Math.max(j.lastRow, j.firstRow);
      const rng = (key: string) => `'Журнал'!$${j.colOf(key)}$${j.firstRow}:$${j.colOf(key)}$${last}`;
      let r = 3;
      const block = (title: string, head: string, items: { name: string; minutes: number; count: number }[], key: string) => {
        ws.getCell(r, 1).value = title;
        ws.getCell(r++, 1).font = { bold: true, size: 12 };
        for (const [i, h] of [head, 'Простоев', 'Минут'].entries()) {
          const c = ws.getCell(r, i + 1);
          c.value = h;
          c.font = { bold: true };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F4' } };
        }
        r++;
        const first = r;
        for (const it of items) {
          ws.getCell(r, 1).value = it.name;
          ws.getCell(r, 2).value = { formula: `COUNTIFS(${rng(key)},A${r})`, result: it.count };
          ws.getCell(r, 3).value = { formula: `SUMIFS(${rng('minutes')},${rng(key)},A${r})`, result: it.minutes };
          ws.getCell(r, 3).numFmt = NUM_FMT.minutes!;
          r++;
        }
        if (items.length) {
          ws.getCell(r, 1).value = 'Итого';
          ws.getCell(r, 1).font = { bold: true };
          for (const col of [2, 3]) {
            const L = colLetter(col);
            ws.getCell(r, col).value = { formula: `SUM(${L}${first}:${L}${r - 1})`, result: items.reduce((a, x) => a + (col === 2 ? x.count : x.minutes), 0) };
            ws.getCell(r, col).font = { bold: true };
            ws.getCell(r, col).numFmt = '#,##0';
          }
          r++;
        } else ws.getCell(r++, 1).value = 'Нет данных';
        r++;
      };
      block('Минуты простоя по участкам', 'Участок', byArea, 'area');
      block('Минуты простоя по причинам', 'Категория причины', byCategory, 'category');
      block('Топ-5 оборудования по минутам простоя', 'Оборудование', byEq.slice(0, 5), 'eq');
      ws.getCell(r, 1).value = 'Минуты и число простоев считаются формулами SUMIFS и COUNTIFS по листу «Журнал» — меняются вместе с ним.';
      ws.getCell(r++, 1).font = { italic: true, size: 9, color: { argb: 'FF5B636E' } };
      ws.getCell(r, 1).value = PROTOTYPE_NOTE;
      ws.getCell(r, 1).font = { italic: true, size: 9, color: { argb: 'FF5B636E' } };
    },
  };
}
