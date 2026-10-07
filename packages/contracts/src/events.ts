// Канонические события двойника. Любой вход (REST 1С, MQTT контроллеров и камер,
// мобильный ввод, импорт CSV) приводится к одному из этих типов.
import { z } from 'zod';
import {
  CAMERA_DETECTION_KINDS,
  DOWNTIME_CATEGORIES,
  EQUIPMENT_STATUSES,
  METRIC_IDS,
  MODEL_IDS,
  NONCONFORMITY_DECISIONS,
  SOURCE_IDS,
} from './plant';
import { VIN_RE } from './vin';

export const Vin = z
  .string()
  .regex(VIN_RE, { error: 'VIN — 17 символов: латинские буквы (кроме I, O, Q) и цифры' })
  .meta({ id: 'Vin', description: 'VIN кузова, 17 символов', examples: ['KZACN1S18TK004812'] });

export const AreaIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, { error: 'Код участка: строчные латинские буквы, цифры и дефис, например paint' })
  .meta({
    id: 'AreaId',
    description:
      'Код участка из конфигурации завода (GET /api/v1/plant/config). Исходный цех: warehouse — склад комплектующих, weld — сварка, paint — окраска, assembly — сборка, qc — контроль качества (ОТК), finished — склад готовой продукции. Шлюз отклоняет участки, которых нет в конфигурации',
    examples: ['paint'],
  });

export const ModelIdSchema = z.enum(MODEL_IDS).meta({
  id: 'ModelId',
  description: 'Модель: onix — Chevrolet Onix, cobalt — Chevrolet Cobalt, j7 — JAC J7',
});

export const SourceIdSchema = z.enum(SOURCE_IDS).meta({
  id: 'SourceId',
  description:
    'Система-источник: mes, qls, wms, erp — 1С; plc — контроллеры; camera — видеоаналитика; master — мобильный ввод мастера; import — загрузка файла',
});

export const Timestamp = z.iso
  .datetime({ offset: true, error: 'Время в формате ISO 8601, например 2026-10-07T13:40:00+05:00' })
  .meta({ id: 'Timestamp', description: 'Время в ISO 8601 с часовым поясом', examples: ['2026-10-07T13:40:00+05:00'] });

export const EventId = z.string().min(1).max(128).meta({
  id: 'EventId',
  description: 'Уникальный идентификатор события в системе-источнике. Повтор с тем же eventId не создаёт дубль.',
  examples: ['mes-20261007-000123'],
});

export const EquipmentId = z.string().min(1).max(64).meta({
  id: 'EquipmentId',
  description:
    'Код оборудования из конфигурации завода. Исходный цех: роботы сварки ABB-01…ABB-11 и LASER-01 (три линии под модели), FINISH-01, GEO-LAB, PRETREAT, OVEN-ED, SEALER, PRIMER, BOOTH-01, BOOTH-02, OVEN, PAINT-INSP, POLISH, CONV-01…CONV-03, QC-TEST, QC-RAIN, QC-TRACK, QC-LINE',
});

export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'Месяц в формате ГГГГ-ММ' });
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Дата в формате ГГГГ-ММ-ДД' });

const base = {
  eventId: EventId,
  source: SourceIdSchema,
  ts: Timestamp,
  area: AreaIdSchema,
  equipmentId: EquipmentId.optional(),
  vin: Vin.optional(),
};

export const PostPassedEvent = z
  .object({
    ...base,
    type: z.literal('post_passed'),
    vin: Vin,
    payload: z.object({
      model: ModelIdSchema,
      post: z.string().min(1).max(64).meta({ description: 'Код поста из конфигурации завода (WELD-1, WELD-FIN, GEO-IN, PAINT-B2, ASM-3, QC-1, FG-IN…)' }),
    }),
  })
  .meta({ id: 'PostPassedEvent', description: 'Кузов прошёл пост (1С:MES)' });

export const NonconformityDecision = z.enum(NONCONFORMITY_DECISIONS).meta({
  id: 'NonconformityDecision',
  description: 'rework — доработка на месте, repaint — повторная окраска, scrap — списание',
});

export const NonconformityEvent = z
  .object({
    ...base,
    type: z.literal('nonconformity'),
    payload: z.object({
      checkpoint: z.string().min(1).max(64).meta({ description: 'Контрольная точка: CP-WELD, CP-GEO, CP-PAINT, CP-TEST, CP-RAIN, CP-TRACK, CP-FINAL' }),
      defect: z.string().min(1).max(64).meta({ description: 'Код дефекта из справочника (paint_dirt, weld_geometry…)' }),
      decision: NonconformityDecision,
      responsibleArea: AreaIdSchema.optional().meta({ description: 'Участок-виновник, если отличается от места обнаружения' }),
      count: z.number().int().min(1).max(100).optional().meta({ description: 'Сколько кузовов (для ввода мастера без VIN)' }),
      comment: z.string().max(500).optional(),
    }),
  })
  .meta({ id: 'NonconformityEvent', description: 'Несоответствие на контрольной точке (1С:QLS; мастер — без VIN)' });

export const DowntimeCategory = z.enum(DOWNTIME_CATEGORIES).meta({
  id: 'DowntimeCategory',
  description:
    'breakdown — поломка, no_parts — нет деталей, setup — наладка, waiting — ждём решения, planned — плановое ТО, quality — по качеству, other — другое',
});

export const DowntimeRegisteredEvent = z
  .object({
    ...base,
    type: z.literal('downtime_registered'),
    equipmentId: EquipmentId,
    payload: z.object({
      reason: z.string().min(1).max(200),
      category: DowntimeCategory,
      from: Timestamp.meta({ description: 'Начало простоя' }),
      to: Timestamp.optional().meta({ description: 'Окончание; нет — простой продолжается' }),
      registeredBy: z.string().min(1).max(100),
    }),
  })
  .meta({ id: 'DowntimeRegisteredEvent', description: 'Простой зарегистрирован в 1С:MES или мастером. ts — время записи, from — начало простоя' });

export const EquipmentStatus = z.enum(EQUIPMENT_STATUSES).meta({
  id: 'EquipmentStatus',
  description: 'run — работает, idle — ожидает, fault — авария, maintenance — обслуживание',
});

export const EquipmentStateEvent = z
  .object({
    ...base,
    type: z.literal('equipment_state'),
    equipmentId: EquipmentId,
    payload: z.object({
      status: EquipmentStatus,
      code: z.string().max(32).optional().meta({ description: 'Код аварии контроллера' }),
      text: z.string().max(200).optional(),
    }),
  })
  .meta({ id: 'EquipmentStateEvent', description: 'Состояние оборудования с контроллера' });

export const EquipmentCounterEvent = z
  .object({
    ...base,
    type: z.literal('equipment_counter'),
    equipmentId: EquipmentId,
    payload: z.object({
      cycles: z.number().int().min(0).meta({ description: 'Циклов с последнего ТО' }),
      total: z.number().int().min(0).meta({ description: 'Циклов за весь срок службы' }),
    }),
  })
  .meta({ id: 'EquipmentCounterEvent', description: 'Счётчик циклов оборудования с контроллера' });

export const MetricIdSchema = z.enum(METRIC_IDS).meta({
  id: 'MetricId',
  description:
    'filter_dp_pa — перепад давления на фильтре, Па; motor_current_a — ток привода, А; vibration_mm_s — вибрация, мм/с; temperature_c — температура, °C; pressure_bar — давление, бар; torque_nm — момент затяжки, Н·м',
});

export const TelemetryEvent = z
  .object({
    ...base,
    type: z.literal('telemetry'),
    equipmentId: EquipmentId,
    payload: z.object({ metric: MetricIdSchema, value: z.number() }),
  })
  .meta({ id: 'TelemetryEvent', description: 'Значение датчика' });

export const CameraDetectionKind = z.enum(CAMERA_DETECTION_KINDS).meta({
  id: 'CameraDetectionKind',
  description: 'line_stopped — линия стоит, queue — очередь (value = число кузовов), post_empty — пост без оператора',
});

export const CameraDetectionEvent = z
  .object({
    ...base,
    type: z.literal('camera_detection'),
    payload: z.object({
      cameraId: z.string().min(1).max(64),
      kind: CameraDetectionKind,
      value: z.number().optional(),
      clipUrl: z.string().max(500).optional(),
    }),
  })
  .meta({ id: 'CameraDetectionEvent', description: 'Детекция видеоаналитики' });

export const StockLevelEvent = z
  .object({
    ...base,
    type: z.literal('stock_level'),
    payload: z.object({
      kitId: z.string().min(1).max(64),
      model: ModelIdSchema,
      qty: z.number().int().min(0),
      shiftsLeft: z.number().min(0),
    }),
  })
  .meta({ id: 'StockLevelEvent', description: 'Остаток комплектов на складе (1С:WMS)' });

export const PlanModelLine = z.object({ model: ModelIdSchema, qty: z.number().int().min(0) }).meta({ id: 'PlanModelLine' });

export const PlanSetEvent = z
  .object({
    ...base,
    type: z.literal('plan_set'),
    payload: z.object({
      month: Month,
      target: z.number().int().positive().optional().meta({ description: 'Целевой план месяца, если отличается от суммы по моделям' }),
      models: z.array(PlanModelLine).min(1),
    }),
  })
  .meta({ id: 'PlanSetEvent', description: 'План производства на месяц (1С:ERP)' });

export const ShiftReportEvent = z
  .object({
    ...base,
    type: z.literal('shift_report'),
    payload: z.object({
      date: IsoDate,
      shift: z.union([z.literal(1), z.literal(2)]).optional(),
      line: z.string().min(1).max(64),
      plan: z.number().int().min(0),
      fact: z.number().int().min(0),
      hours: z.number().min(0).max(24),
      load: z.number().min(0).max(200),
    }),
  })
  .meta({ id: 'ShiftReportEvent', description: 'Сменный отчёт линии (1С:MES)' });

export const QualitySummaryEvent = z
  .object({
    ...base,
    type: z.literal('quality_summary'),
    payload: z.object({
      date: IsoDate,
      shift: z.union([z.literal(1), z.literal(2)]).optional(),
      produced: z.number().int().min(0),
      defects: z.number().int().min(0),
      pct: z.number().min(0).max(100),
    }),
  })
  .meta({ id: 'QualitySummaryEvent', description: 'Итог качества участка за смену или сутки (1С:QLS)' });

// ---------------------------------------------------------------------------
// Отслеживание кузова: заказ, отметки, операции, VIN

export const BodyId = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, { error: 'Номер кузова: заглавные латинские буквы, цифры и дефис, например B-04812' })
  .meta({ id: 'BodyId', description: 'Внутренний номер кузова: присваивается в начале сварки, до нанесения VIN', examples: ['B-04812'] });

export const ProductionOrderEvent = z
  .object({
    ...base,
    type: z.literal('production_order'),
    payload: z.object({
      bodyId: BodyId,
      model: ModelIdSchema,
      trim: z.string().max(60).optional().meta({ description: 'Комплектация' }),
      colorCode: z.string().max(16).optional().meta({ description: 'Код цвета из справочника 1С' }),
      colorName: z.string().max(60).optional(),
      plannedSeq: z.number().int().min(0).meta({ description: 'Порядковый номер в плане запуска' }),
    }),
  })
  .meta({ id: 'ProductionOrderEvent', description: 'Производственный заказ на кузов (1С:ERP/MES): модель, комплектация, цвет. Точный состав выгрузки уточняется с заводом' });

export const BodyCheckpointEvent = z
  .object({
    ...base,
    type: z.literal('body_checkpoint'),
    payload: z.object({
      bodyId: BodyId.optional(),
      checkpointId: z.string().min(1).max(64).meta({ description: 'Код точки отметки из конфигурации завода (WELD-IN, RFID-BOOTH-02…)' }),
      direction: z.enum(['in', 'out']).meta({ description: 'in — кузов пришёл, out — ушёл' }),
      postId: z.string().max(64).optional().meta({ description: 'Позиция на конвейере (пост 1С:MES) — для трекинга ПЛК' }),
    }),
  })
  .meta({ id: 'BodyCheckpointEvent', description: 'Отметка кузова в точке: сканер 1С:MES, RFID, трекинг ПЛК, мастер. Нужен bodyId или VIN' });

export const OperationResultEvent = z
  .object({
    ...base,
    type: z.literal('operation_result'),
    equipmentId: EquipmentId,
    payload: z.object({
      bodyId: BodyId.optional(),
      operation: z.string().min(1).max(64).meta({ description: 'Код операции из каталога (weld_roof, basecoat, wheels…)' }),
      result: z.enum(['ok', 'nok']),
      details: z.string().max(300).optional(),
    }),
  })
  .meta({ id: 'OperationResultEvent', description: 'Результат операции над кузовом от робота, инструмента поста или контрольного поста. Нужен bodyId или VIN' });

export const VinAssignedEvent = z
  .object({
    ...base,
    type: z.literal('vin_assigned'),
    vin: Vin,
    payload: z.object({ bodyId: BodyId }),
  })
  .meta({ id: 'VinAssignedEvent', description: 'На кузов нанесён VIN: с этого момента номер кузова и VIN связаны' });

export const CanonicalEvent = z
  .discriminatedUnion('type', [
    PostPassedEvent,
    NonconformityEvent,
    DowntimeRegisteredEvent,
    EquipmentStateEvent,
    EquipmentCounterEvent,
    TelemetryEvent,
    CameraDetectionEvent,
    StockLevelEvent,
    PlanSetEvent,
    ShiftReportEvent,
    QualitySummaryEvent,
    ProductionOrderEvent,
    BodyCheckpointEvent,
    OperationResultEvent,
    VinAssignedEvent,
  ])
  .meta({ id: 'CanonicalEvent', description: 'Каноническое событие двойника; поле type определяет состав payload' });

export type CanonicalEvent = z.infer<typeof CanonicalEvent>;
export type EventType = CanonicalEvent['type'];
export type EventOf<T extends EventType> = Extract<CanonicalEvent, { type: T }>;
export type DowntimeCategory = z.infer<typeof DowntimeCategory>;
export type EquipmentStatus = z.infer<typeof EquipmentStatus>;
export type NonconformityDecision = z.infer<typeof NonconformityDecision>;
export type CameraDetectionKind = z.infer<typeof CameraDetectionKind>;

export const EVENT_TYPES = CanonicalEvent.options.map((o) => o.shape.type.value) as EventType[];

/** Смысловая проверка событий кузова: нужен номер кузова или VIN */
export function bodyEventIssues(e: CanonicalEvent): ValidationIssue[] {
  if ((e.type === 'body_checkpoint' || e.type === 'operation_result') && !e.payload.bodyId && !e.vin) {
    return [{ path: 'payload.bodyId', message: 'Нужен номер кузова (bodyId) или VIN' }];
  }
  return [];
}

/** Ошибки валидации в одном формате для REST, MQTT и импорта */
export interface ValidationIssue {
  path: string;
  message: string;
}

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(корень)', message: i.message }));
}
