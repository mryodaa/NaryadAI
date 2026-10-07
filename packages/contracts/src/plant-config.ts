// Конфигурация завода — единственный источник правды о составе цеха для ядра, имитаторов,
// 3D и «Панели». Поток линейный, слева направо: участок → параллельные станции → оборудование.
import { z } from 'zod';
import { CANONICAL_FIELDS, CONNECTION_METHODS, CONNECTION_STATUSES, EQUIPMENT_TYPE_IDS, STAGE_KINDS } from './equipment-catalog';
import { ModelIdSchema, Timestamp } from './events';
import { COLOR_FINISHES, ID_METHODS } from './identification';

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

/** Какие модели обрабатывает станция или участок; нет поля или пусто — любые */
const ModelsField = z
  .array(ModelIdSchema)
  .max(10)
  .optional()
  .meta({ description: 'Какие модели обрабатывает: сварочные линии привязаны к моделям, окраска и сборка универсальные. Нет поля — любые модели' });

export const EquipmentCode = z
  .string()
  .regex(CODE_RE, { error: 'Код оборудования: заглавные латинские буквы, цифры и дефис, до 32 символов, например BOOTH-03' })
  .meta({ id: 'EquipmentCode', description: 'Код оборудования, уникальный на заводе. Он же — сегмент MQTT-топика', examples: ['BOOTH-02'] });

export const PostCode = z
  .string()
  .regex(CODE_RE, { error: 'Код поста: заглавные латинские буквы, цифры и дефис, например ASM-7' })
  .meta({ id: 'PostCode', description: 'Код поста 1С:MES, где фиксируется проход кузова', examples: ['PAINT-B2'] });

export const StageCode = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/, { error: 'Код участка: строчные латинские буквы, цифры и дефис, например paint' })
  .meta({ id: 'StageCode', description: 'Код участка. Он же — поле area в событиях и сегмент MQTT-топика', examples: ['paint'] });

export const StationCode = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,47}$/, { error: 'Код станции: строчные латинские буквы, цифры и дефис' })
  .meta({ id: 'StationCode' });

export const ConnectionConfigSchema = z
  .object({
    method: z.enum(CONNECTION_METHODS).meta({
      description:
        'opcua — OPC UA, modbus_tcp — Modbus TCP, s7 — Siemens S7, scada — система управления участком, retrofit_sensor — внешний датчик, manual — ручной ввод мастером, simulator — имитатор (демо), none — не подключено',
    }),
    endpoint: z.string().max(300).optional().meta({ description: 'Адрес: opc.tcp://10.20.1.15:4840, 10.20.1.30 (Modbus, S7), идентификатор датчика' }),
    params: z
      .record(z.string().max(40), z.union([z.string().max(100), z.number(), z.boolean()]))
      .optional()
      .meta({ description: 'Параметры способа: режим безопасности OPC UA, порт и unit id Modbus, rack/slot S7' }),
    tagMap: z
      .partialRecord(z.enum(CANONICAL_FIELDS), z.string().max(200))
      .optional()
      .meta({ description: 'Какой тег источника что означает для двойника' }),
    status: z.enum(CONNECTION_STATUSES).default('not_connected').meta({ description: 'Состояние связи. Считает шлюз по реальному потоку данных; при сохранении игнорируется' }),
    lastSeenAt: Timestamp.optional(),
    error: z.string().max(300).optional(),
  })
  .meta({ id: 'PlantConnection', description: 'Как оборудование подключено к двойнику' });

export const IdPointCode = z
  .string()
  .regex(CODE_RE, { error: 'Код точки отметки: заглавные латинские буквы, цифры и дефис, например PAINT-IN' })
  .meta({ id: 'IdPointCode', description: 'Код точки отметки кузова — checkpointId в событиях body_checkpoint', examples: ['PAINT-IN'] });

export const IdPointSchema = z
  .object({
    id: IdPointCode,
    name: z.string().trim().min(1, { error: 'Название точки отметки не может быть пустым' }).max(80),
    method: z.enum(ID_METHODS).meta({
      description: 'mes_scan — сканер 1С:MES, rfid — RFID-метка тележки, plc_tracking — трекинг кузова в ПЛК конвейера, tool_result — результат инструмента поста, manual — отметка мастера',
    }),
    connection: ConnectionConfigSchema.optional().meta({ description: 'Как точка подключена к двойнику (как у оборудования)' }),
  })
  .meta({ id: 'PlantIdPoint', description: 'Точка отметки кузова: где система узнаёт, что кузов прошёл' });

export const IdPointsSchema = z
  .object({ entry: IdPointSchema.optional(), exit: IdPointSchema.optional() })
  .meta({ id: 'PlantIdPoints', description: 'Точки отметки на входе и на выходе' });

export const ColorSchema = z
  .object({
    code: z.string().trim().min(1).max(16),
    name: z.string().trim().min(1).max(60),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: 'Цвет в формате #RRGGBB' }),
    finish: z.enum(COLOR_FINISHES).meta({ description: 'solid — без металлика, metallic — металлик, pearl — перламутр' }),
    models: z.array(ModelIdSchema).max(10).optional().meta({ description: 'Для каких моделей доступен; нет — для любых' }),
  })
  .meta({ id: 'PlantColor', description: 'Цвет кузова из справочника 1С: код из производственного заказа → название и оттенок' });

export const EquipmentConfigSchema = z
  .object({
    id: EquipmentCode,
    type: z.enum(EQUIPMENT_TYPE_IDS).meta({ description: 'Тип из каталога оборудования' }),
    name: z.string().trim().min(1, { error: 'Название оборудования не может быть пустым' }).max(60),
    critical: z.boolean().meta({ description: 'Критичное: его простой останавливает поток и идёт в лимит 60 минут' }),
    cycleTimeSec: z.number().positive().max(36_000).optional().meta({ description: 'Норма цикла на кузов, с — если отличается от каталога' }),
    posts: z
      .array(z.object({ id: PostCode, name: z.string().trim().min(1).max(60) }))
      .max(20)
      .optional()
      .meta({ description: 'Посты 1С:MES на этом оборудовании по порядку; нет — пост с кодом оборудования, если тип фиксирует проход' }),
    aliases: z.array(z.string().max(60)).max(10).optional().meta({ description: 'Как оборудование называют в таблицах и журналах завода' }),
    idPoint: IdPointSchema.optional().meta({ description: 'Точка отметки кузова у оборудования: вход на него и выход с него (RFID, трекинг ПЛК)' }),
    connection: ConnectionConfigSchema,
  })
  .meta({ id: 'PlantEquipment', description: 'Единица оборудования' });

export const StationConfigSchema = z
  .object({
    id: StationCode,
    name: z.string().trim().min(1, { error: 'Название станции не может быть пустым' }).max(60),
    models: ModelsField,
    idPoints: IdPointsSchema.optional().meta({ description: 'Точки отметки кузова на входе и выходе станции' }),
    equipment: z.array(EquipmentConfigSchema).max(40),
  })
  .meta({
    id: 'PlantStation',
    description: 'Станция (линия) участка: кузов проходит её оборудование по порядку. Станции одного участка работают параллельно; кузов идёт на станцию своей модели',
  });

export const StageConfigSchema = z
  .object({
    id: StageCode,
    name: z.string().trim().min(1, { error: 'Название участка не может быть пустым' }).max(60),
    short: z.string().trim().max(20).optional().meta({ description: 'Короткое название для подписей: «ОТК», «Склад ГП»' }),
    kind: z.enum(STAGE_KINDS).meta({ description: 'Вид участка: склад комплектующих, сварка, окраска, сборка, контроль, склад готовой продукции, другой' }),
    order: z.number().int().min(0).max(100),
    models: ModelsField,
    idPoints: IdPointsSchema.optional().meta({ description: 'Точки отметки кузова на входе и выходе участка' }),
    bufferAfter: z
      .object({ capacity: z.number().int().min(1, { error: 'Ёмкость буфера — от 1 кузова' }).max(200) })
      .nullable()
      .meta({ description: 'Буфер до следующего участка, кузовов' }),
    inlet: z.array(EquipmentConfigSchema).max(10).optional().meta({ description: 'Общее оборудование на входе участка: все кузова проходят его до станций (ванна подготовки)' }),
    stations: z.array(StationConfigSchema).max(40),
    outlet: z.array(EquipmentConfigSchema).max(10).optional().meta({ description: 'Общее оборудование на выходе участка: все кузова проходят его после станций (сушильная печь)' }),
  })
  .meta({ id: 'PlantStage', description: 'Участок завода' });

export const PlantConfigSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(120),
    version: z.number().int().min(1),
    updatedAt: Timestamp,
    updatedBy: z.string().max(100),
    comment: z.string().max(300).optional().meta({ description: 'Что изменилось в этой версии' }),
    stages: z.array(StageConfigSchema).min(2).max(30),
    colors: z.array(ColorSchema).max(40).optional().meta({ description: 'Справочник цветов кузова; нет — справочник по умолчанию' }),
  })
  .meta({ id: 'PlantConfig', description: 'Конфигурация завода: участки по потоку слева направо, их станции и оборудование' });

/** То же, что приходит на «Применить» или импорт: версию, время и автора ставит шлюз */
export const PlantConfigInput = PlantConfigSchema.extend({
  version: z.number().int().min(1).optional(),
  updatedAt: Timestamp.optional(),
  updatedBy: z.string().max(100).optional(),
}).meta({ id: 'PlantConfigInput', description: 'Конфигурация завода для проверки или применения (версию и время ставит шлюз)' });

export const ConnectionInput = ConnectionConfigSchema.omit({ status: true, lastSeenAt: true, error: true }).meta({
  id: 'PlantConnectionInput',
  description: 'Подключение оборудования: способ, адрес, параметры и сопоставление тегов',
});

export const PlantIssueSchema = z
  .object({
    level: z.enum(['error', 'warning']),
    path: z.string(),
    message: z.string(),
    stageId: z.string().optional(),
    stationId: z.string().optional(),
    equipmentId: z.string().optional(),
    incidentId: z.string().optional(),
  })
  .meta({ id: 'PlantIssue', description: 'Ошибка или предупреждение проверки состава цеха — по-русски' });

export const PlantValidation = z
  .object({ ok: z.boolean(), errors: z.array(PlantIssueSchema), warnings: z.array(PlantIssueSchema) })
  .meta({ id: 'PlantValidation', description: 'Итог проверки: ok — ошибок нет, можно применять' });

export const PlantVersionInfo = z
  .object({
    version: z.number().int(),
    createdAt: Timestamp,
    createdBy: z.string(),
    comment: z.string().nullable(),
    source: z.enum(['seed', 'apply', 'rollback', 'import', 'connection', 'demo']),
    stages: z.number().int(),
    stations: z.number().int(),
    equipment: z.number().int(),
    current: z.boolean(),
  })
  .meta({ id: 'PlantVersionInfo', description: 'Версия конфигурации в истории' });

export const StageCapacitySchema = z
  .object({
    stageId: z.string(),
    name: z.string(),
    stations: z.number().int(),
    nominalPerShift: z.number().meta({ description: 'По норме цикла: сумма станций, но не больше общего оборудования' }),
    effectivePerShift: z.number().meta({ description: 'С учётом простоев за 30 дней и перекраски' }),
    limitedBy: z.string().nullable().meta({ description: 'Что ограничивает участок, если не сумма станций' }),
  })
  .meta({ id: 'StageCapacity', description: 'Пропускная способность участка, кузовов в смену' });

export const PlantImpact = z
  .object({
    changes: z.array(z.string()).meta({ description: 'Изменения человеческим языком: «+1 камера окраски»' }),
    before: z.array(StageCapacitySchema),
    after: z.array(StageCapacitySchema),
    bottleneckBefore: z.object({ stageId: z.string(), name: z.string() }).nullable(),
    bottleneckAfter: z.object({ stageId: z.string(), name: z.string() }).nullable(),
    forecast: z
      .object({ before: z.number(), after: z.number(), target: z.number(), gapBefore: z.number(), gapAfter: z.number() })
      .nullable()
      .meta({ description: 'Прогноз плана месяца до и после (P50)' }),
    validation: PlantValidation,
  })
  .meta({ id: 'PlantImpact', description: 'Влияние изменений состава цеха — без применения' });

export const ConnectionTestResult = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    hint: z.string().optional().meta({ description: 'Что сделать, если не получилось' }),
    values: z
      .array(z.object({ field: z.enum(CANONICAL_FIELDS), label: z.string(), tag: z.string().nullable(), value: z.string() }))
      .optional()
      .meta({ description: 'Живые значения тегов, если подключение удалось' }),
  })
  .meta({ id: 'ConnectionTestResult', description: 'Итог проверки подключения' });

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;
export type IdPointConfig = z.infer<typeof IdPointSchema>;
export type EquipmentConfig = z.infer<typeof EquipmentConfigSchema>;
export type StationConfig = z.infer<typeof StationConfigSchema>;
export type StageConfig = z.infer<typeof StageConfigSchema>;
export type PlantConfig = z.infer<typeof PlantConfigSchema>;
export type PlantConfigInput = z.input<typeof PlantConfigInput>;
export type ConnectionInput = z.infer<typeof ConnectionInput>;
export type PlantIssue = z.infer<typeof PlantIssueSchema>;
export type PlantValidation = z.infer<typeof PlantValidation>;
export type PlantVersionInfo = z.infer<typeof PlantVersionInfo>;
export type StageCapacity = z.infer<typeof StageCapacitySchema>;
export type PlantImpact = z.infer<typeof PlantImpact>;
export type ConnectionTestResult = z.infer<typeof ConnectionTestResult>;
