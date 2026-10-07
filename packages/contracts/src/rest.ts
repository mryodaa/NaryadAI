// Тела запросов REST и их приведение к каноническим событиям.
import { z } from 'zod';
import {
  AreaIdSchema,
  CanonicalEvent,
  DowntimeCategory,
  EquipmentId,
  EventId,
  Month,
  PlanModelLine,
  Timestamp,
  type CanonicalEvent as CanonicalEventT,
  type ValidationIssue,
} from './events';
import { areaFromLineName, areaFromName, SOURCE_IDS } from './plant';
import { SEED_MODEL, stageFromLineName, stageFromName, type PlantModel } from './plant-model';
import { normalizeDate, toPlantIso } from './time';

export const EventBatch = z.array(CanonicalEvent).min(1).max(1000).meta({
  id: 'EventBatch',
  description: 'Пакет канонических событий. Каждое событие проверяется отдельно: корректные принимаются, ошибочные возвращаются с причиной.',
});

export const IngestRejected = z
  .object({
    index: z.number().int(),
    eventId: z.string().optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })),
  })
  .meta({ id: 'IngestRejected' });

export const IngestResult = z
  .object({
    accepted: z.number().int().meta({ description: 'Принято новых событий' }),
    duplicates: z.number().int().meta({ description: 'Повторы по eventId — пропущены' }),
    rejected: z.array(IngestRejected),
  })
  .meta({ id: 'IngestResult', description: 'Итог приёма' });

export const ErrorResponse = z
  .object({
    error: z.string(),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'ErrorResponse' });

export const DowntimeRequest = z
  .object({
    eventId: EventId.optional(),
    source: z.enum(['mes', 'master']).default('mes'),
    ts: Timestamp.optional().meta({ description: 'Время записи; нет — время двойника' }),
    area: AreaIdSchema,
    equipmentId: EquipmentId,
    reason: z.string().min(1).max(200),
    category: DowntimeCategory,
    from: Timestamp.optional().meta({ description: 'Начало простоя; нет — сейчас' }),
    to: Timestamp.optional(),
    registeredBy: z.string().min(1).max(100),
  })
  .meta({ id: 'DowntimeRequest', description: 'Регистрация простоя из 1С:MES или с телефона мастера' });

export const PlanRequest = z
  .object({
    eventId: EventId.optional(),
    month: Month,
    target: z.number().int().positive().optional(),
    models: z.array(PlanModelLine).min(1),
  })
  .meta({ id: 'PlanRequest', description: 'План на месяц по моделям (1С:ERP)' });

export const DateLike = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})$/, { error: 'Дата в формате ГГГГ-ММ-ДД или ДД.ММ.ГГГГ' })
  .meta({ id: 'DateLike' });

export const ShiftReportRow = z
  .object({
    date: DateLike,
    shift: z.union([z.literal(1), z.literal(2)]).optional(),
    line: z.string().min(1).max(64).meta({ description: 'Линия, как в отчёте: «Сварка-1», «Окраска-1», «Сборка-1»' }),
    plan: z.number().int().min(0),
    fact: z.number().int().min(0),
    hours: z.number().min(0).max(24).meta({ description: 'Время работы, ч' }),
    load: z.number().min(0).max(200).meta({ description: 'Загрузка, %' }),
  })
  .meta({ id: 'ShiftReportRow', description: 'Строка сменного отчёта в формате выданной таблицы' });

export const ShiftReportRequest = z.array(ShiftReportRow).min(1).max(5000).meta({ id: 'ShiftReportRequest' });

export const QualityRow = z
  .object({
    date: DateLike,
    shift: z.union([z.literal(1), z.literal(2)]).optional(),
    area: z.string().min(1).max(64).meta({ description: 'Участок: «Сварка», «Окраска», «Сборка» или код (weld…)' }),
    produced: z.number().int().min(0),
    defects: z.number().int().min(0),
    pct: z.number().min(0).max(100).optional(),
  })
  .meta({ id: 'QualityRow', description: 'Строка итога качества в формате выданной таблицы' });

export const QualityRequest = z.array(QualityRow).min(1).max(5000).meta({ id: 'QualityRequest' });

export const DecisionRequest = z
  .object({
    incidentId: z.string().min(1).max(128),
    optionId: z.string().min(1).max(64),
    decidedBy: z.string().max(100).optional(),
  })
  .meta({ id: 'DecisionRequest', description: 'Принятие варианта решения по инциденту' });

export type DowntimeRequest = z.infer<typeof DowntimeRequest>;
export type PlanRequest = z.infer<typeof PlanRequest>;
export type ShiftReportRow = z.infer<typeof ShiftReportRow>;
export type QualityRow = z.infer<typeof QualityRow>;
export type DecisionRequest = z.infer<typeof DecisionRequest>;
export type IngestResult = z.infer<typeof IngestResult>;

type Source = (typeof SOURCE_IDS)[number];

function newId(prefix: string): string {
  const c = (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto;
  return `${prefix}-${c.randomUUID()}`;
}

export function downtimeRequestToEvent(req: DowntimeRequest, nowMs: number): CanonicalEventT {
  const ts = req.ts ?? toPlantIso(nowMs);
  return {
    eventId: req.eventId ?? newId(`${req.source}-downtime`),
    source: req.source,
    ts,
    area: req.area,
    equipmentId: req.equipmentId,
    type: 'downtime_registered',
    payload: {
      reason: req.reason,
      category: req.category,
      from: req.from ?? ts,
      to: req.to,
      registeredBy: req.registeredBy,
    },
  };
}

export function planRequestToEvent(req: PlanRequest, nowMs: number): CanonicalEventT {
  return {
    eventId: req.eventId ?? `erp:plan:${req.month}:${toPlantIso(nowMs)}`,
    source: 'erp',
    ts: toPlantIso(nowMs),
    area: 'finished',
    type: 'plan_set',
    payload: { month: req.month, target: req.target, models: req.models },
  };
}

export interface RowsResult {
  events: CanonicalEventT[];
  issues: (ValidationIssue & { row: number })[];
}

/** Участок по названию из таблицы: сначала по конфигурации завода, затем по синонимам исходного цеха */
export function areaOfLine(model: PlantModel, line: string): string | undefined {
  const legacy = areaFromLineName(line);
  return stageFromLineName(model, line)?.id ?? (legacy && model.stageById.has(legacy) ? legacy : undefined);
}

export function areaOfName(model: PlantModel, name: string): string | undefined {
  const legacy = areaFromName(name);
  return stageFromName(model, name)?.id ?? (legacy && model.stageById.has(legacy) ? legacy : undefined);
}

export function shiftReportRowsToEvents(rows: ShiftReportRow[], source: Source, nowMs: number, model: PlantModel = SEED_MODEL): RowsResult {
  const out: RowsResult = { events: [], issues: [] };
  rows.forEach((r, row) => {
    const date = normalizeDate(r.date);
    const area = areaOfLine(model, r.line);
    if (!date) return out.issues.push({ row, path: 'date', message: `Не понял дату «${r.date}»` });
    if (!area) return out.issues.push({ row, path: 'line', message: `Не понял линию «${r.line}»` });
    out.events.push({
      eventId: `${source}:shift_report:${date}:${r.shift ?? 0}:${r.line}`,
      source,
      ts: toPlantIso(nowMs),
      area,
      type: 'shift_report',
      payload: { date, shift: r.shift, line: r.line, plan: r.plan, fact: r.fact, hours: r.hours, load: r.load },
    });
  });
  return out;
}

export function qualityRowsToEvents(rows: QualityRow[], source: Source, nowMs: number, model: PlantModel = SEED_MODEL): RowsResult {
  const out: RowsResult = { events: [], issues: [] };
  rows.forEach((r, row) => {
    const date = normalizeDate(r.date);
    const area = areaOfName(model, r.area);
    if (!date) return out.issues.push({ row, path: 'date', message: `Не понял дату «${r.date}»` });
    if (!area) return out.issues.push({ row, path: 'area', message: `Не понял участок «${r.area}»` });
    const pct = r.pct ?? (r.produced > 0 ? Math.round((r.defects / r.produced) * 1000) / 10 : 0);
    out.events.push({
      eventId: `${source}:quality:${date}:${r.shift ?? 0}:${area}`,
      source,
      ts: toPlantIso(nowMs),
      area,
      type: 'quality_summary',
      payload: { date, shift: r.shift, produced: r.produced, defects: r.defects, pct },
    });
  });
  return out;
}
