// Справочники завода (НСИ). В реальном внедрении приходят из 1С:ERP/MES;
// здесь — модель цеха для прототипа. Идентификаторы латиницей, чтобы их можно
// было использовать в MQTT-топиках; русские названия — для интерфейса.

export const AREA_IDS = ['warehouse', 'weld', 'paint', 'assembly', 'qc', 'finished'] as const;
export type AreaId = (typeof AREA_IDS)[number];

export interface AreaDef {
  id: AreaId;
  name: string;
  short: string;
  /** Участок, через который проходит кузов (у складов нет постов с тактом) */
  producing: boolean;
}

export const AREAS: readonly AreaDef[] = [
  { id: 'warehouse', name: 'Склад комплектующих', short: 'Склад', producing: false },
  { id: 'weld', name: 'Сварка', short: 'Сварка', producing: true },
  { id: 'paint', name: 'Окраска', short: 'Окраска', producing: true },
  { id: 'assembly', name: 'Сборка', short: 'Сборка', producing: true },
  { id: 'qc', name: 'Контроль качества (ОТК)', short: 'ОТК', producing: true },
  { id: 'finished', name: 'Склад готовой продукции', short: 'Склад ГП', producing: false },
];

export const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a])) as Record<AreaId, AreaDef>;

/** Названия участков в таблицах организаторов → идентификатор */
export const AREA_ALIASES: Record<string, AreaId> = {
  'склад комплектующих': 'warehouse',
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
  return AREA_ALIASES[base] ?? (AREA_IDS as readonly string[]).find((a) => a === base) as AreaId | undefined;
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
// Оборудование

export type EquipmentKind =
  | 'robot'
  | 'pretreatment'
  | 'booth'
  | 'oven'
  | 'conveyor'
  | 'inspection'
  | 'track'
  | 'rain_test';

export interface EquipmentDef {
  id: string;
  name: string;
  area: AreaId;
  kind: EquipmentKind;
  /** Критическое: его простой останавливает поток */
  critical: boolean;
  /** Как оборудование называют в таблицах и журналах */
  aliases: string[];
  /** Межсервисный интервал в циклах (кузовах), если ведётся */
  serviceIntervalCycles?: number;
}

export const EQUIPMENT: readonly EquipmentDef[] = [
  { id: 'ABB-01', name: 'Робот ABB-01', area: 'weld', kind: 'robot', critical: true, aliases: ['ABB-01', 'ABB01'], serviceIntervalCycles: 6000 },
  { id: 'ABB-02', name: 'Робот ABB-02', area: 'weld', kind: 'robot', critical: true, aliases: ['ABB-02', 'ABB02'], serviceIntervalCycles: 6000 },
  { id: 'ABB-03', name: 'Робот ABB-03', area: 'weld', kind: 'robot', critical: true, aliases: ['ABB-03', 'ABB03'], serviceIntervalCycles: 6000 },
  { id: 'ABB-04', name: 'Робот ABB-04', area: 'weld', kind: 'robot', critical: true, aliases: ['ABB-04', 'ABB04'], serviceIntervalCycles: 6000 },
  { id: 'PRETREAT', name: 'Подготовка поверхности (13 ванн)', area: 'paint', kind: 'pretreatment', critical: true, aliases: ['Подготовка'] },
  { id: 'BOOTH-01', name: 'Камера-01', area: 'paint', kind: 'booth', critical: true, aliases: ['Камера-01', 'Камера 01', 'Камера-1'] },
  { id: 'BOOTH-02', name: 'Камера-02', area: 'paint', kind: 'booth', critical: true, aliases: ['Камера-02', 'Камера 02', 'Камера-2'] },
  { id: 'OVEN', name: 'Сушка', area: 'paint', kind: 'oven', critical: true, aliases: ['Сушка', 'Печь сушки'] },
  { id: 'CONV-03', name: 'Конвейер-03', area: 'assembly', kind: 'conveyor', critical: true, aliases: ['Конвейер-03', 'Конвейер 03', 'Конвейер-3'] },
  { id: 'QC-LINE', name: 'Линия контроля', area: 'qc', kind: 'inspection', critical: false, aliases: ['Контроль', 'Линия контроля'] },
  { id: 'QC-TRACK', name: 'Полигон', area: 'qc', kind: 'track', critical: false, aliases: ['Полигон'] },
  { id: 'QC-RAIN', name: 'Камера герметичности', area: 'qc', kind: 'rain_test', critical: false, aliases: ['Камера герметичности'] },
];

export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e])) as Record<string, EquipmentDef>;

export function equipmentFromName(name: string): EquipmentDef | undefined {
  const key = name.trim().toLowerCase();
  return EQUIPMENT.find((e) => e.id.toLowerCase() === key || e.aliases.some((a) => a.toLowerCase() === key));
}

// ---------------------------------------------------------------------------
// Посты маршрута кузова (точки фиксации прохода VIN в 1С:MES)

export interface PostDef {
  id: string;
  area: AreaId;
  name: string;
  equipmentId?: string;
}

export const POSTS: readonly PostDef[] = [
  { id: 'WELD-1', area: 'weld', name: 'Сварка, пост 1', equipmentId: 'ABB-01' },
  { id: 'WELD-2', area: 'weld', name: 'Сварка, пост 2', equipmentId: 'ABB-02' },
  { id: 'WELD-3', area: 'weld', name: 'Сварка, пост 3', equipmentId: 'ABB-03' },
  { id: 'WELD-4', area: 'weld', name: 'Сварка, пост 4', equipmentId: 'ABB-04' },
  { id: 'PAINT-PRE', area: 'paint', name: 'Подготовка поверхности', equipmentId: 'PRETREAT' },
  { id: 'PAINT-B1', area: 'paint', name: 'Камера-01', equipmentId: 'BOOTH-01' },
  { id: 'PAINT-B2', area: 'paint', name: 'Камера-02', equipmentId: 'BOOTH-02' },
  { id: 'PAINT-OVEN', area: 'paint', name: 'Сушка', equipmentId: 'OVEN' },
  { id: 'ASM-1', area: 'assembly', name: 'Сборка, посты 1–10', equipmentId: 'CONV-03' },
  { id: 'ASM-2', area: 'assembly', name: 'Сборка, посты 11–20', equipmentId: 'CONV-03' },
  { id: 'ASM-3', area: 'assembly', name: 'Сборка, посты 21–30', equipmentId: 'CONV-03' },
  { id: 'ASM-4', area: 'assembly', name: 'Сборка, посты 31–40', equipmentId: 'CONV-03' },
  { id: 'ASM-5', area: 'assembly', name: 'Сборка, посты 41–50', equipmentId: 'CONV-03' },
  { id: 'ASM-6', area: 'assembly', name: 'Сборка, посты 51–59', equipmentId: 'CONV-03' },
  { id: 'QC-1', area: 'qc', name: 'Контроль', equipmentId: 'QC-LINE' },
  { id: 'QC-2', area: 'qc', name: 'Полигон', equipmentId: 'QC-TRACK' },
  { id: 'QC-3', area: 'qc', name: 'Камера герметичности', equipmentId: 'QC-RAIN' },
  { id: 'FG-IN', area: 'finished', name: 'Приёмка на склад готовой продукции' },
];

export const POST_BY_ID = Object.fromEntries(POSTS.map((p) => [p.id, p])) as Record<string, PostDef>;

export function postsOf(area: AreaId): PostDef[] {
  return POSTS.filter((p) => p.area === area);
}

// ---------------------------------------------------------------------------
// Буферы между участками

export const BUFFER_IDS = ['weld-paint', 'paint-assembly', 'assembly-qc'] as const;
export type BufferId = (typeof BUFFER_IDS)[number];

export interface BufferDef {
  id: BufferId;
  from: AreaId;
  to: AreaId;
  capacity: number;
}

export const BUFFERS: readonly BufferDef[] = [
  { id: 'weld-paint', from: 'weld', to: 'paint', capacity: 12 },
  { id: 'paint-assembly', from: 'paint', to: 'assembly', capacity: 15 },
  { id: 'assembly-qc', from: 'assembly', to: 'qc', capacity: 8 },
];

// ---------------------------------------------------------------------------
// Контроль качества (1С:QLS)

export interface CheckpointDef {
  id: string;
  area: AreaId;
  name: string;
}

export const CHECKPOINTS: readonly CheckpointDef[] = [
  { id: 'CP-WELD', area: 'weld', name: 'Контроль геометрии кузова' },
  { id: 'CP-PAINT', area: 'paint', name: 'Контроль окраски' },
  { id: 'CP-FINAL', area: 'qc', name: 'Финальный контроль' },
  { id: 'CP-TRACK', area: 'qc', name: 'Полигон' },
  { id: 'CP-RAIN', area: 'qc', name: 'Камера герметичности' },
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

export const METRIC_IDS = ['filter_dp_pa', 'motor_current_a', 'vibration_mm_s'] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export const METRICS: Record<MetricId, { name: string; unit: string }> = {
  filter_dp_pa: { name: 'Перепад давления на фильтре', unit: 'Па' },
  motor_current_a: { name: 'Ток привода', unit: 'А' },
  vibration_mm_s: { name: 'Вибрация привода', unit: 'мм/с' },
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
