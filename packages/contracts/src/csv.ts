// Импорт выданных таблиц из CSV: определяем вид таблицы по заголовкам, разделитель — «;», «,» или табуляция,
// десятичная запятая допустима. Результат — канонические события с source = import.
import type { CanonicalEvent, ValidationIssue } from './events';
import { modelFromName, type ModelId } from './plant';
import { SEED_MODEL, equipmentFromNameIn, type PlantModel } from './plant-model';
import { normalizeDate, plantMs, toPlantIso } from './time';
import { areaOfName, qualityRowsToEvents, shiftReportRowsToEvents } from './rest';

export type CsvKind = 'shift_reports' | 'downtimes' | 'quality' | 'plan';

export interface CsvImport {
  kind: CsvKind | null;
  kindLabel: string;
  rows: number;
  events: CanonicalEvent[];
  issues: (ValidationIssue & { row: number })[];
}

const KIND_LABEL: Record<CsvKind, string> = {
  shift_reports: 'Работа линий (сменный отчёт)',
  downtimes: 'Простои',
  quality: 'Качество',
  plan: 'План на месяц по моделям',
};

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function toNumber(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const norm = (h: string) => h.toLowerCase().replace(/[^а-яёa-z%]/g, '');

export function parseCsvTable(text: string, nowMs: number, month = '2026-10', model: PlantModel = SEED_MODEL): CsvImport {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const result: CsvImport = { kind: null, kindLabel: 'не распознана', rows: 0, events: [], issues: [] };
  if (lines.length < 2) {
    result.issues.push({ row: 0, path: 'файл', message: 'В файле нет строк с данными' });
    return result;
  }
  const head = lines[0]!;
  const sep = [';', '\t', ','].sort((a, b) => head.split(b).length - head.split(a).length)[0]!;
  const headers = splitLine(head, sep).map(norm);
  const col = (...names: string[]) => headers.findIndex((h) => names.some((n) => h.startsWith(n)));
  const rows = lines.slice(1).map((l) => splitLine(l, sep));
  result.rows = rows.length;

  const iDate = col('дата', 'date');
  const has = (...names: string[]) => col(...names) >= 0;

  if (has('линия', 'line') && has('факт', 'fact')) {
    result.kind = 'shift_reports';
    const iLine = col('линия', 'line');
    const iPlan = col('план', 'plan');
    const iFact = col('факт', 'fact');
    const iHours = col('времяработы', 'время', 'hours');
    const iLoad = col('загрузка', 'load');
    const parsed: { date: string; line: string; plan: number; fact: number; hours: number; load: number }[] = [];
    rows.forEach((r, row) => {
      const plan = toNumber(r[iPlan]);
      const fact = toNumber(r[iFact]);
      const hours = toNumber(r[iHours]) ?? 8;
      const load = toNumber(r[iLoad]) ?? Math.round((hours / 8) * 100);
      if (plan === null || fact === null) return result.issues.push({ row: row + 2, path: 'План/Факт', message: 'Не число' });
      parsed.push({ date: r[iDate] ?? '', line: r[iLine] ?? '', plan, fact, hours, load });
    });
    const conv = shiftReportRowsToEvents(parsed, 'import', nowMs, model);
    result.events.push(...conv.events);
    result.issues.push(...conv.issues.map((i) => ({ ...i, row: i.row + 2 })));
  } else if (has('оборудование', 'equipment') && has('причина', 'reason')) {
    result.kind = 'downtimes';
    const iArea = col('участок', 'area');
    const iEq = col('оборудование', 'equipment');
    const iReason = col('причина', 'reason');
    const iMin = col('мин', 'minutes');
    // В таблице нет времени начала — ставим условно с 10:00, чтобы простои попали в первую смену
    rows.forEach((r, row) => {
      const date = normalizeDate(r[iDate] ?? '');
      const area = areaOfName(model, r[iArea] ?? '');
      const eq = equipmentFromNameIn(model, r[iEq] ?? '');
      const mins = toNumber(r[iMin]);
      const reason = r[iReason] ?? '';
      if (!date) return result.issues.push({ row: row + 2, path: 'Дата', message: `Не понял дату «${r[iDate]}»` });
      if (!eq) return result.issues.push({ row: row + 2, path: 'Оборудование', message: `Нет в конфигурации завода: «${r[iEq]}»` });
      if (mins === null) return result.issues.push({ row: row + 2, path: 'Мин', message: 'Не число' });
      const from = plantMs(date, 10 * 60 + row * 5);
      result.events.push({
        eventId: `import:dt:${date}:${eq.id}:${reason}`,
        source: 'import',
        ts: toPlantIso(nowMs),
        area: area ?? eq.stageId,
        equipmentId: eq.id,
        type: 'downtime_registered',
        payload: {
          reason,
          category: /план/i.test(reason) ? 'planned' : 'breakdown',
          from: toPlantIso(from),
          to: toPlantIso(from + mins * 60_000),
          registeredBy: 'Импорт таблицы',
        },
      });
    });
  } else if (has('выпущено', 'produced') && has('брак', 'defects')) {
    result.kind = 'quality';
    const iArea = col('участок', 'area');
    const iProd = col('выпущено', 'produced');
    const iDef = col('брак', 'defects');
    const iPct = headers.findIndex((h) => h === '%' || h.startsWith('pct'));
    const parsed: { date: string; area: string; produced: number; defects: number; pct?: number }[] = [];
    rows.forEach((r, row) => {
      const produced = toNumber(r[iProd]);
      const defects = toNumber(r[iDef]);
      if (produced === null || defects === null) return result.issues.push({ row: row + 2, path: 'Выпущено/Брак', message: 'Не число' });
      parsed.push({ date: r[iDate] ?? '', area: r[iArea] ?? '', produced, defects, pct: iPct >= 0 ? (toNumber(r[iPct]) ?? undefined) : undefined });
    });
    const conv = qualityRowsToEvents(parsed, 'import', nowMs, model);
    result.events.push(...conv.events);
    result.issues.push(...conv.issues.map((i) => ({ ...i, row: i.row + 2 })));
  } else if (has('модель', 'model') && has('план', 'plan')) {
    result.kind = 'plan';
    const iModel = col('модель', 'model');
    const iPlan = col('план', 'plan');
    const models: { model: ModelId; qty: number }[] = [];
    rows.forEach((r, row) => {
      const model = modelFromName(r[iModel] ?? '');
      const qty = toNumber(r[iPlan]);
      if (!model) return result.issues.push({ row: row + 2, path: 'Модель', message: `Не понял модель «${r[iModel]}»` });
      if (qty === null) return result.issues.push({ row: row + 2, path: 'План', message: 'Не число' });
      models.push({ model, qty });
    });
    if (models.length) {
      result.events.push({ eventId: `import:plan:${month}`, source: 'import', ts: toPlantIso(nowMs), area: 'finished', type: 'plan_set', payload: { month, models } });
    }
  } else {
    result.issues.push({ row: 1, path: 'заголовок', message: 'Не узнал таблицу: ожидаются заголовки как в выданных данных (Дата; Линия; План; Факт… / Участок; Оборудование; Причина; Мин / Участок; Выпущено; Брак; % / Модель; План)' });
  }
  if (result.kind) result.kindLabel = KIND_LABEL[result.kind];
  return result;
}
