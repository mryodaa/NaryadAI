// Справочники завода (НСИ), которые не зависят от состава цеха: модели, дефекты, контрольные
// точки, комплекты, источники данных. Состав цеха (участки, станции, оборудование, посты, буферы)
// задаёт конфигурация завода — см. plant-config.ts и plant-seed.ts.

/** Код участка из конфигурации завода (weld, paint…) */
export type AreaId = string;
/** Код буфера: «участок до-участок после» (weld-paint) */
export type BufferId = string;

/** Коды участков исходной конфигурации — для разбора таблиц организаторов */
export const AREA_IDS = ['warehouse', 'weld', 'paint', 'assembly', 'qc', 'finished'] as const;

/** Названия участков в таблицах организаторов → код исходной конфигурации */
export const AREA_ALIASES: Record<string, AreaId> = {
  'склад комплектующих': 'warehouse',
  'склад машинокомплектов': 'warehouse',
  склад: 'warehouse',
  сварка: 'weld',
  окраска: 'paint',
  сборка: 'assembly',
  отк: 'qc',
  'контроль качества': 'qc',
  'склад готовой продукции': 'finished',
};

/** Линии из сменного отчёта организаторов: «Сварка-1» → weld */
export function areaFromLineName(line: string): AreaId | undefined {
  const base = line.trim().toLowerCase().replace(/[-\s]*\d+$/, '');
  return AREA_ALIASES[base] ?? ((AREA_IDS as readonly string[]).find((a) => a === base) as AreaId | undefined);
}

export function areaFromName(name: string): AreaId | undefined {
  const key = name.trim().toLowerCase();
  if ((AREA_IDS as readonly string[]).includes(key)) return key as AreaId;
  return AREA_ALIASES[key] ?? areaFromLineName(name);
}

// ---------------------------------------------------------------------------
// Модели

export const MODEL_IDS = ['onix', 'cobalt', 'j7'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export interface ModelDef {
  id: ModelId;
  name: string;
  short: string;
  /** Код модели в VIN (позиции 4–6) */
  vinCode: string;
  /** План месяца из выданных данных (1С:ERP) */
  givenPlan: number;
}

export const MODELS: readonly ModelDef[] = [
  { id: 'onix', name: 'Chevrolet Onix', short: 'Onix', vinCode: 'CN1', givenPlan: 2500 },
  { id: 'cobalt', name: 'Chevrolet Cobalt', short: 'Cobalt', vinCode: 'CB2', givenPlan: 1800 },
  { id: 'j7', name: 'JAC J7', short: 'J7', vinCode: 'JJ7', givenPlan: 500 },
];

export const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m])) as Record<ModelId, ModelDef>;

export function modelFromName(name: string): ModelId | undefined {
  const key = name.trim().toLowerCase();
  return MODELS.find((m) => m.id === key || m.short.toLowerCase() === key || m.name.toLowerCase() === key)?.id;
}

// ---------------------------------------------------------------------------
// Контроль качества (1С:QLS)

export interface CheckpointDef {
  id: string;
  area: AreaId;
  name: string;
}

export const CHECKPOINTS: readonly CheckpointDef[] = [
  { id: 'CP-WELD', area: 'weld', name: 'Контроль кузова после доводки' },
  { id: 'CP-GEO', area: 'weld', name: 'Лаборатория геометрии (выборочно)' },
  { id: 'CP-PAINT', area: 'paint', name: 'Контроль покрытия' },
  { id: 'CP-TEST', area: 'qc', name: 'Испытательная линия' },
  { id: 'CP-RAIN', area: 'qc', name: 'Водяная камера' },
  { id: 'CP-TRACK', area: 'qc', name: 'Полигон (выборочно)' },
  { id: 'CP-FINAL', area: 'qc', name: 'Финальный осмотр' },
];

export interface DefectDef {
  id: string;
  name: string;
  /** Участок, который допустил дефект (не обязательно тот, где нашли) */
  area: AreaId;
}

export const DEFECTS: readonly DefectDef[] = [
  { id: 'weld_geometry', name: 'Отклонение геометрии кузова', area: 'weld' },
  { id: 'weld_spot', name: 'Непровар сварной точки', area: 'weld' },
  { id: 'paint_dirt', name: 'Сорность (включения в покрытии)', area: 'paint' },
  { id: 'paint_run', name: 'Потёки краски', area: 'paint' },
  { id: 'paint_thin', name: 'Непрокрас', area: 'paint' },
  { id: 'asm_gap', name: 'Неравномерные зазоры', area: 'assembly' },
  { id: 'asm_torque', name: 'Не дотянуто резьбовое соединение', area: 'assembly' },
  { id: 'asm_leak', name: 'Протечка в камере герметичности', area: 'assembly' },
  { id: 'asm_electric', name: 'Ошибка электрики', area: 'assembly' },
];

export const DEFECT_BY_ID = Object.fromEntries(DEFECTS.map((d) => [d.id, d])) as Record<string, DefectDef>;

// ---------------------------------------------------------------------------
// Видеокамеры (видеоаналитика публикует детекции в MQTT)

export interface CameraDef {
  id: string;
  area: AreaId;
  name: string;
}

export const CAMERAS: readonly CameraDef[] = [
  { id: 'CAM-WELD', area: 'weld', name: 'Видеокамера сварки' },
  { id: 'CAM-PAINT', area: 'paint', name: 'Видеокамера окраски' },
  { id: 'CAM-ASM', area: 'assembly', name: 'Видеокамера сборки' },
  { id: 'CAM-QC', area: 'qc', name: 'Видеокамера ОТК' },
];

// ---------------------------------------------------------------------------
// Комплекты на складе (1С:WMS)

export interface KitDef {
  id: string;
  model: ModelId;
  name: string;
}

export const KITS: readonly KitDef[] = [
  { id: 'KIT-ONIX-HARNESS', model: 'onix', name: 'Жгуты проводов Onix' },
  { id: 'KIT-ONIX-INTERIOR', model: 'onix', name: 'Комплект салона Onix' },
  { id: 'KIT-COBALT-HARNESS', model: 'cobalt', name: 'Жгуты проводов Cobalt' },
  { id: 'KIT-COBALT-INTERIOR', model: 'cobalt', name: 'Комплект салона Cobalt' },
  { id: 'KIT-J7-HARNESS', model: 'j7', name: 'Жгуты проводов J7' },
  { id: 'KIT-J7-INTERIOR', model: 'j7', name: 'Комплект салона J7' },
];

export const KIT_BY_ID = Object.fromEntries(KITS.map((k) => [k.id, k])) as Record<string, KitDef>;

// ---------------------------------------------------------------------------
// Телеметрия

export const METRIC_IDS = ['filter_dp_pa', 'motor_current_a', 'vibration_mm_s', 'temperature_c', 'pressure_bar', 'torque_nm'] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export const METRICS: Record<MetricId, { name: string; unit: string }> = {
  filter_dp_pa: { name: 'Перепад давления на фильтре', unit: 'Па' },
  motor_current_a: { name: 'Ток привода', unit: 'А' },
  vibration_mm_s: { name: 'Вибрация привода', unit: 'мм/с' },
  temperature_c: { name: 'Температура', unit: '°C' },
  pressure_bar: { name: 'Давление', unit: 'бар' },
  torque_nm: { name: 'Момент затяжки', unit: 'Н·м' },
};

// ---------------------------------------------------------------------------
// Источники данных

export const SOURCE_IDS = ['mes', 'qls', 'wms', 'erp', 'plc', 'camera', 'master', 'import'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export interface SourceDef {
  id: SourceId;
  name: string;
  protocol: string;
  /** С какой ступени внедрения источник подключён */
  stage: 0 | 1 | 2;
  /** Короткое объяснение для руководителя */
  about: string;
}

export const SOURCES: readonly SourceDef[] = [
  { id: 'mes', name: '1С:MES', protocol: 'HTTP REST', stage: 0, about: 'Проход кузовов по постам, простои, сменные отчёты' },
  { id: 'qls', name: '1С:QLS', protocol: 'HTTP REST', stage: 0, about: 'Несоответствия по VIN на контрольных точках' },
  { id: 'wms', name: '1С:WMS', protocol: 'HTTP REST', stage: 0, about: 'Запасы комплектующих на складе' },
  { id: 'erp', name: '1С:ERP', protocol: 'HTTP REST', stage: 0, about: 'План производства на месяц' },
  { id: 'plc', name: 'Контроллеры оборудования', protocol: 'OPC UA → MQTT', stage: 1, about: 'Состояния, коды аварий, счётчики, датчики' },
  { id: 'camera', name: 'Камеры', protocol: 'RTSP → видеоаналитика → MQTT', stage: 1, about: 'Остановка линии, очереди, пустые посты' },
  { id: 'master', name: 'Мобильный ввод мастера', protocol: 'HTTP REST', stage: 0, about: 'Простои и брак с телефона мастера' },
  { id: 'import', name: 'Импорт таблиц', protocol: 'CSV', stage: 0, about: 'Разовая загрузка выгрузок' },
];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<SourceId, SourceDef>;

// ---------------------------------------------------------------------------
// Перечни для событий (без зависимостей, чтобы интерфейс мог брать подписи)

export const DOWNTIME_CATEGORIES = ['breakdown', 'no_parts', 'setup', 'waiting', 'planned', 'quality', 'other'] as const;
export type DowntimeCategoryId = (typeof DOWNTIME_CATEGORIES)[number];

export const DOWNTIME_CATEGORY_LABELS: Record<DowntimeCategoryId, string> = {
  breakdown: 'Поломка',
  no_parts: 'Нет деталей',
  setup: 'Наладка',
  waiting: 'Ждём решения',
  planned: 'Плановое ТО',
  quality: 'По качеству',
  other: 'Другое',
};

export const EQUIPMENT_STATUSES = ['run', 'idle', 'fault', 'maintenance'] as const;
export const NONCONFORMITY_DECISIONS = ['rework', 'repaint', 'scrap'] as const;
export const CAMERA_DETECTION_KINDS = ['line_stopped', 'queue', 'post_empty'] as const;
