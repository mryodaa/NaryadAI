// Каталог типов оборудования — общий для шлюза, ядра, имитаторов и 3D. Без зависимостей:
// интерфейс берёт отсюда названия, иконки и «следы» на полу, не подтягивая Zod.
// Добавили в конфигурацию оборудование — всё, чего нет в конфигурации (норма цикла, отказы,
// поля данных, способы подключения, размер и 3D-модель), берётся отсюда по типу.

// ---------------------------------------------------------------------------
// Участки

export const STAGE_KINDS = ['warehouse_in', 'welding', 'painting', 'assembly', 'inspection', 'warehouse_out', 'custom'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  warehouse_in: 'Склад комплектующих',
  welding: 'Сварка',
  painting: 'Окраска',
  assembly: 'Сборка',
  inspection: 'Контроль качества',
  warehouse_out: 'Склад готовой продукции',
  custom: 'Другой участок',
};

/** Участки, через которые проходит кузов и у которых есть такт */
export const PRODUCTION_KINDS: readonly StageKind[] = ['welding', 'painting', 'assembly', 'inspection', 'custom'];

export function isProductionKind(kind: StageKind): boolean {
  return kind !== 'warehouse_in' && kind !== 'warehouse_out';
}

// ---------------------------------------------------------------------------
// Канонические поля данных: что двойник понимает об оборудовании, откуда бы оно ни пришло

export const CANONICAL_FIELDS = ['state', 'errorCode', 'cycleCounter', 'filterDpPa', 'motorCurrentA', 'vibrationMmS', 'temperatureC', 'pressureBar', 'torqueNm'] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export interface CanonicalFieldDef {
  label: string;
  unit?: string;
  /** Во что превращается значение: состояние, счётчик циклов или показание датчика */
  event: 'state' | 'counter' | 'telemetry';
  /** Показатель телеметрии (для event = telemetry) */
  metric?: 'filter_dp_pa' | 'motor_current_a' | 'vibration_mm_s' | 'temperature_c' | 'pressure_bar' | 'torque_nm';
  /** С какой ступени внедрения поле доступно: датчики на критичных узлах — ступень 2 */
  stage: 1 | 2;
}

export const CANONICAL_FIELD_DEF: Record<CanonicalField, CanonicalFieldDef> = {
  state: { label: 'Состояние', event: 'state', stage: 1 },
  errorCode: { label: 'Код аварии', event: 'state', stage: 1 },
  cycleCounter: { label: 'Счётчик циклов', unit: 'циклов', event: 'counter', stage: 1 },
  filterDpPa: { label: 'Перепад давления на фильтре', unit: 'Па', event: 'telemetry', metric: 'filter_dp_pa', stage: 1 },
  motorCurrentA: { label: 'Ток привода', unit: 'А', event: 'telemetry', metric: 'motor_current_a', stage: 2 },
  vibrationMmS: { label: 'Вибрация привода', unit: 'мм/с', event: 'telemetry', metric: 'vibration_mm_s', stage: 2 },
  temperatureC: { label: 'Температура', unit: '°C', event: 'telemetry', metric: 'temperature_c', stage: 1 },
  pressureBar: { label: 'Давление', unit: 'бар', event: 'telemetry', metric: 'pressure_bar', stage: 1 },
  torqueNm: { label: 'Момент затяжки', unit: 'Н·м', event: 'telemetry', metric: 'torque_nm', stage: 1 },
};

// ---------------------------------------------------------------------------
// Способы подключения

export const CONNECTION_METHODS = ['opcua', 'modbus_tcp', 's7', 'scada', 'retrofit_sensor', 'manual', 'simulator', 'none'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const CONNECTION_STATUSES = ['not_connected', 'connecting', 'online', 'stale', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export interface ConnectionMethodDef {
  label: string;
  /** Простыми словами — для плитки мастера подключения */
  about: string;
  icon: string;
  /** С какой ступени внедрения такие подключения активны в демо (null — данных нет вовсе) */
  stage: 0 | 1 | 2 | null;
  /** Данные идут потоком с контроллера или датчика (а не от человека) */
  automatic: boolean;
}

export const CONNECTION_METHOD_DEF: Record<ConnectionMethod, ConnectionMethodDef> = {
  opcua: { label: 'OPC UA', about: 'Современный контроллер робота или ПЛК', icon: 'cpu', stage: 1, automatic: true },
  modbus_tcp: { label: 'Modbus TCP', about: 'Старый контроллер', icon: 'cable', stage: 1, automatic: true },
  s7: { label: 'Siemens S7', about: 'Старый контроллер Siemens', icon: 'cable', stage: 1, automatic: true },
  scada: { label: 'SCADA', about: 'Система управления участком, например окраски', icon: 'monitor-cog', stage: 1, automatic: true },
  retrofit_sensor: {
    label: 'Внешний датчик',
    about: 'Без вмешательства в оборудование: сигнальная колонна, токовые клещи',
    icon: 'radio',
    stage: 2,
    automatic: true,
  },
  manual: { label: 'Ручной ввод мастером', about: 'Мастер отмечает состояние и простои с телефона', icon: 'smartphone', stage: 0, automatic: false },
  simulator: { label: 'Имитатор (демо)', about: 'Данные даёт имитатор цеха — для показа без завода', icon: 'flask-conical', stage: 1, automatic: true },
  none: { label: 'Не подключено', about: 'Двойник знает, что оборудование есть, но не видит его состояние', icon: 'unplug', stage: null, automatic: false },
};

export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  not_connected: 'Не подключено',
  connecting: 'Подключается',
  online: 'Подключено',
  stale: 'Данные устарели',
  error: 'Ошибка подключения',
};

// ---------------------------------------------------------------------------
// Типы оборудования

export const EQUIPMENT_TYPE_IDS = [
  'spot_robot',
  'laser_cell',
  'weld_jig',
  'pretreatment',
  'paint_booth',
  'paint_robot',
  'oven',
  'conveyor',
  'assembly_post',
  'nutrunner',
  'inspection_post',
  'geometry_station',
  'rain_test',
  'test_track',
  'test_line',
  'weld_finish',
  'geometry_lab',
  'sealer',
  'primer_booth',
  'paint_inspection',
  'polishing',
  'rack',
  'container_zone',
  'parking',
] as const;
export type EquipmentTypeId = (typeof EQUIPMENT_TYPE_IDS)[number];

/**
 * Где тип стоит на участке:
 * · line — по порядку внутри станции, кузов проходит его (робот, пост, конвейер);
 * · station — сам образует параллельную станцию (камера окраски, лазерная ячейка);
 * · shared — общее для всех станций участка на входе или выходе (ванна подготовки, сушильная печь);
 * · accessory — часть станции без своего поста и такта (окрасочный робот, гайковёрт);
 * · passive — ничего не обрабатывает и данных не даёт (стеллаж, площадка);
 * · side — в стороне от потока: туда уходит часть кузовов после предыдущего оборудования и
 *   возвращается обратно (лаборатория геометрии, полигон, полировка). Такт участка не задаёт.
 */
export type EquipmentPlacement = 'line' | 'station' | 'shared' | 'accessory' | 'passive' | 'side';

/** Как выбирают кузова на выборочную операцию */
export interface SamplingDef {
  /** Каждый N-й кузов */
  everyN?: number;
  /** Доля кузовов, 0…1 */
  rate?: number;
  /** Не больше кузовов в сутки */
  maxPerDay?: number;
}

/** Оборудование в стороне от потока (placement = side) */
export interface SideDef {
  /** Сколько кузовов одновременно */
  slots: number;
  /** Сколько кузов там проводит, мин: от и до */
  minutes: [number, number];
  /** Как выбирают кузова; нет — только по решению контроля (полировка мелких дефектов) */
  sampling?: SamplingDef;
  /** Возврат в поток отмечается отдельным постом (второй пост оборудования) */
  returnScan: boolean;
  /** Простыми словами — для подсказок; значения условные, уточняются с заводом */
  about: string;
}

export interface FailureDef {
  reason: string;
  code: string;
  text: string;
  category: 'breakdown' | 'planned' | 'no_parts';
  /** Частота в рабочий день (16 ч); 0 — в калибровке этого цеха не случается */
  perDay: number;
  meanMin: number;
  sdMin: number;
  /** Готовится заранее и виден по датчикам (обрыв цепи конвейера), а не случается внезапно */
  scheduled?: boolean;
}

export interface EquipmentTypeDef {
  id: EquipmentTypeId;
  name: string;
  /** «робот», «робота», «роботов» */
  plural: [string, string, string];
  /** Имя иконки lucide */
  icon: string;
  /** На каких участках допустим (на участке «Другой» — любое производственное) */
  stages: readonly StageKind[];
  placement: EquipmentPlacement;
  /** Для shared: на входе или на выходе участка */
  sharedAt?: 'inlet' | 'outlet';
  /** Норма цикла на кузов, с; null — своего такта нет */
  cycleTimeSec: number | null;
  /** Как влияет на пропускную способность — простыми словами */
  throughput: string;
  failures: readonly FailureDef[];
  fields: readonly CanonicalField[];
  /** Без этих полей двойник не поймёт состояние */
  required: readonly CanonicalField[];
  methods: readonly ConnectionMethod[];
  /** След на полу, м: x — вдоль потока, z — поперёк */
  footprint: { x: number; z: number };
  height: number;
  /** Ключ построителя 3D-модели из примитивов (сами построители — рядом со сценой) */
  model: string;
  /** Фиксирует проход кузова — у оборудования есть пост 1С:MES */
  registersPass: boolean;
  /** Для placement = side: сколько мест, сколько времени и какие кузова */
  side?: SideDef;
  /** Сколько постов по умолчанию (конвейер тянется через несколько) */
  defaultPosts?: number;
  /** Межсервисный интервал, циклов */
  serviceIntervalCycles?: number;
  /** Контрольная точка 1С:QLS, которую ведёт это оборудование */
  checkpoint?: string;
  /** Существительное для степпера станций: «Камеры окраски: 2» */
  stationNoun?: [string, string, string];
  /** Как называть новое: «{nn}» — номер с ведущим нулём */
  idPattern: string;
  namePattern: string;
  /** Шаблоны тегов по умолчанию для сопоставления данных; {id} — код оборудования */
  tags: Partial<Record<CanonicalField, string>>;
}

const PLC_TAGS: Partial<Record<CanonicalField, string>> = {
  state: 'ns=2;s={id}.State',
  errorCode: 'ns=2;s={id}.AlarmCode',
  cycleCounter: 'ns=2;s={id}.CycleCounter',
  filterDpPa: 'ns=2;s={id}.Filter.dP',
  motorCurrentA: 'ns=2;s={id}.Drive.Current',
  vibrationMmS: 'ns=2;s={id}.Drive.Vibration',
  temperatureC: 'ns=2;s={id}.Temperature',
  pressureBar: 'ns=2;s={id}.Pressure',
  torqueNm: 'ns=2;s={id}.Torque',
};

const tagsFor = (fields: readonly CanonicalField[]) => Object.fromEntries(fields.map((f) => [f, PLC_TAGS[f]!])) as Partial<Record<CanonicalField, string>>;

const AUTO: readonly ConnectionMethod[] = ['opcua', 'modbus_tcp', 's7', 'scada', 'retrofit_sensor', 'manual', 'simulator', 'none'];

function def(d: Omit<EquipmentTypeDef, 'tags'>): EquipmentTypeDef {
  return { ...d, tags: tagsFor(d.fields) };
}

export const EQUIPMENT_TYPES: Record<EquipmentTypeId, EquipmentTypeDef> = {
  spot_robot: def({
    id: 'spot_robot',
    name: 'Робот точечной сварки',
    plural: ['робот', 'робота', 'роботов'],
    icon: 'bot',
    stages: ['welding'],
    placement: 'line',
    cycleTimeSec: 228,
    throughput: 'Стоит в линии сварки: кузов проходит роботов по очереди, темп линии задаёт самый медленный',
    // частота на робота: в сварке 11 роботов на трёх линиях, в сумме — как у прежних четырёх
    failures: [{ reason: 'Ошибка датчика', code: '50296', text: 'Ошибка датчика положения', category: 'breakdown', perDay: 0.045, meanMin: 25, sdMin: 6 }],
    fields: ['state', 'errorCode', 'cycleCounter'],
    required: ['state'],
    methods: ['opcua', 'retrofit_sensor', 'manual', 'simulator', 'none'],
    footprint: { x: 4.9, z: 7 },
    height: 3.1,
    model: 'robot',
    registersPass: true,
    serviceIntervalCycles: 6000,
    idPattern: 'ROBOT-{nn}',
    namePattern: 'Робот-{nn}',
  }),
  laser_cell: def({
    id: 'laser_cell',
    name: 'Установка лазерной сварки',
    plural: ['установка лазерной сварки', 'установки лазерной сварки', 'установок лазерной сварки'],
    icon: 'zap',
    stages: ['welding'],
    placement: 'station',
    cycleTimeSec: 216,
    throughput: 'Ячейка на 8 роботов работает как отдельная станция: каждая добавляет свою мощность',
    failures: [{ reason: 'Сбой лазерного источника', code: 'L-210', text: 'Мощность лазера ниже нормы', category: 'breakdown', perDay: 0.05, meanMin: 30, sdMin: 8 }],
    fields: ['state', 'errorCode', 'cycleCounter'],
    required: ['state'],
    methods: ['opcua', 'retrofit_sensor', 'manual', 'simulator', 'none'],
    footprint: { x: 9, z: 8 },
    height: 3.6,
    model: 'laser_cell',
    registersPass: true,
    serviceIntervalCycles: 12000,
    stationNoun: ['лазерная ячейка', 'лазерные ячейки', 'лазерных ячеек'],
    idPattern: 'LASER-{nn}',
    namePattern: 'Лазерная ячейка {nn}',
  }),
  weld_jig: def({
    id: 'weld_jig',
    name: 'Сварочный кондуктор',
    plural: ['сварочный кондуктор', 'сварочных кондуктора', 'сварочных кондукторов'],
    icon: 'construction',
    stages: ['welding'],
    placement: 'line',
    cycleTimeSec: 228,
    throughput: 'Фиксирует кузов в линии сварки; темп — как у постов линии',
    failures: [{ reason: 'Сбой прижимов', code: 'J-12', text: 'Прижим не замкнулся', category: 'breakdown', perDay: 0.03, meanMin: 15, sdMin: 4 }],
    fields: ['state', 'errorCode'],
    required: ['state'],
    methods: AUTO,
    footprint: { x: 5, z: 6 },
    height: 1.6,
    model: 'jig',
    registersPass: true,
    idPattern: 'JIG-{nn}',
    namePattern: 'Кондуктор-{nn}',
  }),
  pretreatment: def({
    id: 'pretreatment',
    name: 'Ванна подготовки',
    plural: ['ванна подготовки', 'ванны подготовки', 'ванн подготовки'],
    icon: 'droplets',
    stages: ['painting'],
    placement: 'shared',
    sharedAt: 'inlet',
    cycleTimeSec: 234,
    throughput: 'Общая для всех камер на входе окраски: её мощность ограничивает участок сверху',
    failures: [{ reason: 'Сбой дозирования химии', code: 'P-311', text: 'Отклонение концентрации в ванне 7', category: 'breakdown', perDay: 0.04, meanMin: 20, sdMin: 5 }],
    fields: ['state', 'errorCode', 'temperatureC'],
    required: ['state'],
    methods: AUTO,
    footprint: { x: 7.2, z: 5 },
    height: 1.7,
    model: 'pretreatment',
    registersPass: true,
    idPattern: 'PRETREAT-{nn}',
    namePattern: 'Подготовка поверхности {nn}',
  }),
  paint_booth: def({
    id: 'paint_booth',
    name: 'Камера окраски',
    plural: ['камера окраски', 'камеры окраски', 'камер окраски'],
    icon: 'spray-can',
    stages: ['painting'],
    placement: 'station',
    cycleTimeSec: 234,
    throughput: 'Каждая камера — отдельная станция: кузова из общей очереди идут в свободную камеру, мощности складываются',
    failures: [{ reason: 'Замена фильтра (вынужденная)', code: 'F-450', text: 'Перепад на фильтре достиг предела', category: 'breakdown', perDay: 0, meanMin: 40, sdMin: 5 }],
    fields: ['state', 'errorCode', 'filterDpPa'],
    required: ['state', 'filterDpPa'],
    methods: AUTO,
    footprint: { x: 6.3, z: 5.6 },
    height: 4.2,
    model: 'booth',
    registersPass: true,
    stationNoun: ['камера окраски', 'камеры окраски', 'камер окраски'],
    idPattern: 'BOOTH-{nn}',
    namePattern: 'Камера-{nn}',
  }),
  paint_robot: def({
    id: 'paint_robot',
    name: 'Окрасочный робот',
    plural: ['окрасочный робот', 'окрасочных робота', 'окрасочных роботов'],
    icon: 'paintbrush',
    stages: ['painting'],
    placement: 'accessory',
    cycleTimeSec: null,
    throughput: 'Работает внутри камеры и своего такта не задаёт; его отказ останавливает камеру',
    failures: [{ reason: 'Засор распылителя', code: 'R-77', text: 'Нет потока краски', category: 'breakdown', perDay: 0.04, meanMin: 15, sdMin: 4 }],
    fields: ['state', 'errorCode'],
    required: ['state'],
    methods: ['opcua', 'retrofit_sensor', 'manual', 'simulator', 'none'],
    footprint: { x: 1.6, z: 1.6 },
    height: 2.8,
    model: 'paint_robot',
    registersPass: false,
    idPattern: 'PROBOT-{nn}',
    namePattern: 'Окрасочный робот {nn}',
  }),
  oven: def({
    id: 'oven',
    name: 'Сушильная печь',
    plural: ['сушильная печь', 'сушильные печи', 'сушильных печей'],
    icon: 'flame',
    stages: ['painting'],
    placement: 'shared',
    sharedAt: 'outlet',
    cycleTimeSec: 234,
    throughput: 'Общая для всех камер на выходе окраски: её мощность ограничивает участок сверху',
    failures: [{ reason: 'Отклонение температуры', code: 'O-55', text: 'Температура в зоне сушки ниже нормы', category: 'breakdown', perDay: 0, meanMin: 25, sdMin: 6 }],
    fields: ['state', 'errorCode', 'temperatureC'],
    required: ['state'],
    methods: AUTO,
    footprint: { x: 7.2, z: 5.4 },
    height: 3.8,
    model: 'oven',
    registersPass: true,
    idPattern: 'OVEN-{nn}',
    namePattern: 'Сушка {nn}',
  }),
  conveyor: def({
    id: 'conveyor',
    name: 'Секция конвейера',
    plural: ['секция конвейера', 'секции конвейера', 'секций конвейера'],
    icon: 'briefcase-conveyor-belt',
    stages: ['assembly'],
    placement: 'line',
    cycleTimeSec: 240,
    throughput: 'Тянет кузова через сборочные посты с тактом линии; посты на конвейере идут по очереди',
    // частота на одну секцию: сборка — три секции конвейера, в сумме как прежде у одного
    failures: [{ reason: 'Обрыв цепи', code: 'E-2117', text: 'Обрыв приводной цепи', category: 'breakdown', perDay: 0.015, meanMin: 55, sdMin: 8, scheduled: true }],
    fields: ['state', 'errorCode', 'motorCurrentA', 'vibrationMmS'],
    required: ['state'],
    methods: AUTO,
    footprint: { x: 4.7, z: 6.4 },
    height: 3.4,
    model: 'conveyor',
    registersPass: true,
    defaultPosts: 6,
    idPattern: 'CONV-{nn}',
    namePattern: 'Конвейер-{nn}',
  }),
  assembly_post: def({
    id: 'assembly_post',
    name: 'Сборочный пост',
    plural: ['сборочный пост', 'сборочных поста', 'сборочных постов'],
    icon: 'wrench',
    stages: ['assembly'],
    placement: 'line',
    cycleTimeSec: 240,
    throughput: 'Пост в линии сборки: кузов проходит посты по очереди',
    failures: [{ reason: 'Остановка поста по андону', code: 'A-1', text: 'Оператор остановил пост', category: 'breakdown', perDay: 0, meanMin: 5, sdMin: 2 }],
    fields: ['state'],
    required: ['state'],
    methods: ['retrofit_sensor', 'manual', 'simulator', 'none'],
    footprint: { x: 4.7, z: 6 },
    height: 3.2,
    model: 'assembly_post',
    registersPass: true,
    idPattern: 'POST-{nn}',
    namePattern: 'Сборочный пост {nn}',
  }),
  nutrunner: def({
    id: 'nutrunner',
    name: 'Гайковёрт / инструмент поста',
    plural: ['гайковёрт', 'гайковёрта', 'гайковёртов'],
    icon: 'drill',
    stages: ['assembly'],
    placement: 'accessory',
    cycleTimeSec: null,
    throughput: 'Инструмент поста, своего такта не задаёт',
    failures: [{ reason: 'Нет момента затяжки', code: 'T-9', text: 'Момент вне допуска', category: 'breakdown', perDay: 0.02, meanMin: 10, sdMin: 3 }],
    fields: ['state', 'errorCode', 'torqueNm'],
    required: ['state'],
    methods: ['opcua', 'retrofit_sensor', 'manual', 'simulator', 'none'],
    footprint: { x: 1, z: 1 },
    height: 1.6,
    model: 'nutrunner',
    registersPass: false,
    idPattern: 'TOOL-{nn}',
    namePattern: 'Гайковёрт {nn}',
  }),
  inspection_post: def({
    id: 'inspection_post',
    name: 'Пост контроля',
    plural: ['пост контроля', 'поста контроля', 'постов контроля'],
    icon: 'scan-search',
    stages: ['inspection'],
    placement: 'line',
    cycleTimeSec: 204,
    throughput: 'Стоит в линии контроля, кузов проходит его по очереди',
    failures: [],
    fields: ['state', 'errorCode'],
    required: ['state'],
    methods: ['opcua', 'manual', 'simulator', 'none'],
    footprint: { x: 6.2, z: 6 },
    height: 4,
    model: 'inspection',
    registersPass: true,
    checkpoint: 'CP-FINAL',
    idPattern: 'QC-POST-{nn}',
    namePattern: 'Пост контроля {nn}',
  }),
  geometry_station: def({
    id: 'geometry_station',
    name: 'Измерение геометрии кузова',
    plural: ['станция измерения геометрии', 'станции измерения геометрии', 'станций измерения геометрии'],
    icon: 'ruler',
    stages: ['inspection', 'welding'],
    placement: 'line',
    cycleTimeSec: 204,
    throughput: 'Стоит в линии, кузов проходит её по очереди',
    failures: [{ reason: 'Сбой измерительной головки', code: 'G-4', text: 'Нет связи с головкой', category: 'breakdown', perDay: 0.02, meanMin: 20, sdMin: 5 }],
    fields: ['state', 'errorCode'],
    required: ['state'],
    methods: ['opcua', 'manual', 'simulator', 'none'],
    footprint: { x: 6, z: 6 },
    height: 3.6,
    model: 'geometry',
    registersPass: true,
    checkpoint: 'CP-WELD',
    idPattern: 'GEOM-{nn}',
    namePattern: 'Геометрия-{nn}',
  }),
  rain_test: def({
    id: 'rain_test',
    name: 'Камера герметичности',
    plural: ['камера герметичности', 'камеры герметичности', 'камер герметичности'],
    icon: 'shower-head',
    stages: ['inspection'],
    placement: 'line',
    cycleTimeSec: 204,
    throughput: 'Стоит в линии контроля, кузов проходит её по очереди',
    failures: [{ reason: 'Сбой насоса камеры герметичности', code: 'R-104', text: 'Низкое давление воды', category: 'breakdown', perDay: 0.03, meanMin: 15, sdMin: 4 }],
    fields: ['state', 'errorCode', 'pressureBar'],
    required: ['state'],
    methods: AUTO,
    footprint: { x: 6.4, z: 5.6 },
    height: 4,
    model: 'rain_test',
    registersPass: true,
    checkpoint: 'CP-RAIN',
    idPattern: 'RAIN-{nn}',
    namePattern: 'Камера герметичности {nn}',
  }),
  test_track: def({
    id: 'test_track',
    name: 'Выезд на полигон',
    plural: ['выезд на полигон', 'выезда на полигон', 'выездов на полигон'],
    icon: 'car-front',
    stages: ['inspection'],
    placement: 'side',
    cycleTimeSec: null,
    throughput: 'Выборочно: часть машин уезжает на полигон и возвращается на линию контроля, такт линии не задаёт',
    failures: [],
    fields: ['state'],
    required: ['state'],
    methods: ['manual', 'simulator', 'none'],
    footprint: { x: 6.2, z: 6 },
    height: 0.6,
    model: 'track',
    registersPass: true,
    side: { slots: 3, minutes: [15, 25], sampling: { rate: 0.1 }, returnScan: false, about: 'условно каждая десятая машина, 15–25 минут' },
    checkpoint: 'CP-TRACK',
    idPattern: 'TRACK-{nn}',
    namePattern: 'Полигон {nn}',
  }),
  test_line: def({
    id: 'test_line',
    name: 'Испытательная линия',
    plural: ['испытательная линия', 'испытательные линии', 'испытательных линий'],
    icon: 'gauge',
    stages: ['inspection'],
    placement: 'line',
    cycleTimeSec: 204,
    throughput: 'Посты линии по очереди: роликовый стенд, развал-схождение, настройка фар',
    failures: [],
    fields: ['state', 'errorCode'],
    required: ['state'],
    methods: ['opcua', 'manual', 'simulator', 'none'],
    footprint: { x: 6.2, z: 6 },
    height: 3.4,
    model: 'test_line',
    registersPass: true,
    defaultPosts: 3,
    checkpoint: 'CP-TEST',
    idPattern: 'TEST-{nn}',
    namePattern: 'Испытательная линия {nn}',
  }),
  weld_finish: def({
    id: 'weld_finish',
    name: 'Рихтовка и доводка кузова',
    plural: ['пост доводки', 'поста доводки', 'постов доводки'],
    icon: 'hammer',
    stages: ['welding'],
    placement: 'shared',
    sharedAt: 'outlet',
    cycleTimeSec: 200,
    throughput: 'Общий пост после сварочных линий: через него проходят кузова всех моделей',
    failures: [],
    fields: ['state'],
    required: ['state'],
    methods: ['retrofit_sensor', 'manual', 'simulator', 'none'],
    footprint: { x: 5, z: 6 },
    height: 2.6,
    model: 'weld_finish',
    registersPass: true,
    idPattern: 'FINISH-{nn}',
    namePattern: 'Доводка {nn}',
  }),
  geometry_lab: def({
    id: 'geometry_lab',
    name: 'Лаборатория геометрии кузова',
    plural: ['лаборатория геометрии', 'лаборатории геометрии', 'лабораторий геометрии'],
    icon: 'ruler',
    stages: ['welding'],
    placement: 'side',
    cycleTimeSec: null,
    throughput: 'Выборочный контроль: кузов уезжает на лазерное измерение на 3–4 часа и возвращается в поток',
    failures: [],
    fields: ['state'],
    required: ['state'],
    methods: ['manual', 'simulator', 'none'],
    footprint: { x: 8, z: 7 },
    height: 3.2,
    model: 'geometry_lab',
    registersPass: true,
    side: { slots: 4, minutes: [180, 240], sampling: { everyN: 25, maxPerDay: 40 }, returnScan: true, about: 'условно каждый 25-й кузов, 3–4 часа, не больше 40 в сутки' },
    checkpoint: 'CP-GEO',
    idPattern: 'GEO-{nn}',
    namePattern: 'Лаборатория геометрии {nn}',
  }),
  sealer: def({
    id: 'sealer',
    name: 'Герметизация швов',
    plural: ['пост герметизации', 'поста герметизации', 'постов герметизации'],
    icon: 'pipette',
    stages: ['painting'],
    placement: 'shared',
    sharedAt: 'inlet',
    cycleTimeSec: 234,
    throughput: 'Общий пост на входе окраски: все кузова проходят его по очереди',
    failures: [],
    fields: ['state', 'errorCode'],
    required: ['state'],
    methods: AUTO,
    footprint: { x: 6, z: 5 },
    height: 3,
    model: 'sealer',
    registersPass: true,
    idPattern: 'SEAL-{nn}',
    namePattern: 'Герметизация {nn}',
  }),
  primer_booth: def({
    id: 'primer_booth',
    name: 'Камера грунта (роботы)',
    plural: ['камера грунта', 'камеры грунта', 'камер грунта'],
    icon: 'spray-can',
    stages: ['painting'],
    placement: 'shared',
    sharedAt: 'inlet',
    cycleTimeSec: 234,
    throughput: 'Вторичный грунт роботами — общий для всех кузовов перед камерами окраски',
    failures: [],
    fields: ['state', 'errorCode', 'temperatureC'],
    required: ['state'],
    methods: AUTO,
    footprint: { x: 6.3, z: 5.6 },
    height: 4.2,
    model: 'booth',
    registersPass: true,
    idPattern: 'PRIMER-{nn}',
    namePattern: 'Камера грунта {nn}',
  }),
  paint_inspection: def({
    id: 'paint_inspection',
    name: 'Контроль покрытия',
    plural: ['пост контроля покрытия', 'поста контроля покрытия', 'постов контроля покрытия'],
    icon: 'lamp',
    stages: ['painting'],
    placement: 'shared',
    sharedAt: 'outlet',
    cycleTimeSec: 200,
    throughput: 'Осмотр под светом после печи: мелкие дефекты — на полировку, крупные — на перекраску',
    failures: [],
    fields: ['state'],
    required: ['state'],
    methods: ['manual', 'simulator', 'none'],
    footprint: { x: 6, z: 5 },
    height: 3.4,
    model: 'paint_inspection',
    registersPass: true,
    checkpoint: 'CP-PAINT',
    idPattern: 'PAINT-QC-{nn}',
    namePattern: 'Контроль покрытия {nn}',
  }),
  polishing: def({
    id: 'polishing',
    name: 'Полировка',
    plural: ['участок полировки', 'участка полировки', 'участков полировки'],
    icon: 'sparkles',
    stages: ['painting'],
    placement: 'side',
    cycleTimeSec: null,
    throughput: 'Мелкие дефекты покрытия полируют на месте, кузов возвращается в поток',
    failures: [],
    fields: ['state'],
    required: ['state'],
    methods: ['manual', 'simulator', 'none'],
    footprint: { x: 5, z: 5 },
    height: 2.6,
    model: 'polishing',
    registersPass: true,
    side: { slots: 2, minutes: [10, 20], returnScan: true, about: 'по решению контроля покрытия, условно 10–20 минут' },
    idPattern: 'POLISH-{nn}',
    namePattern: 'Полировка {nn}',
  }),
  rack: def({
    id: 'rack',
    name: 'Стеллаж склада',
    plural: ['стеллаж', 'стеллажа', 'стеллажей'],
    icon: 'archive',
    stages: ['warehouse_in', 'warehouse_out'],
    placement: 'passive',
    cycleTimeSec: null,
    throughput: 'Не влияет на поток кузовов',
    failures: [],
    fields: [],
    required: [],
    methods: ['none'],
    footprint: { x: 8.4, z: 1.5 },
    height: 3.1,
    model: 'rack',
    registersPass: false,
    idPattern: 'RACK-{nn}',
    namePattern: 'Стеллаж {nn}',
  }),
  container_zone: def({
    id: 'container_zone',
    name: 'Зона контейнеров',
    plural: ['зона контейнеров', 'зоны контейнеров', 'зон контейнеров'],
    icon: 'boxes',
    stages: ['warehouse_in'],
    placement: 'passive',
    cycleTimeSec: null,
    throughput: 'Не влияет на поток кузовов; высота стопок — запас комплектов из 1С:WMS',
    failures: [],
    fields: [],
    required: [],
    methods: ['none'],
    footprint: { x: 8.4, z: 6 },
    height: 4.5,
    model: 'containers',
    registersPass: false,
    idPattern: 'KITS-{nn}',
    namePattern: 'Зона контейнеров {nn}',
  }),
  parking: def({
    id: 'parking',
    name: 'Площадка готовых машин',
    plural: ['площадка', 'площадки', 'площадок'],
    icon: 'square-parking',
    stages: ['warehouse_out'],
    placement: 'passive',
    cycleTimeSec: null,
    throughput: 'Не влияет на поток: здесь машина принимается на склад',
    failures: [],
    fields: [],
    required: [],
    methods: ['none'],
    footprint: { x: 8, z: 12 },
    height: 1.4,
    model: 'parking',
    registersPass: true,
    idPattern: 'PARK-{nn}',
    namePattern: 'Площадка {nn}',
  }),
};

export const EQUIPMENT_TYPE_LIST: readonly EquipmentTypeDef[] = EQUIPMENT_TYPE_IDS.map((id) => EQUIPMENT_TYPES[id]);

/** Какие типы можно поставить на участок этого вида */
export function typesForStage(kind: StageKind): EquipmentTypeDef[] {
  if (kind === 'custom') return EQUIPMENT_TYPE_LIST.filter((t) => t.stages.some(isProductionKind));
  return EQUIPMENT_TYPE_LIST.filter((t) => t.stages.includes(kind));
}

/** Существительное для станций участка по умолчанию: «Линии сварки: 1» */
export const STATION_NOUN_BY_KIND: Record<StageKind, [string, string, string]> = {
  warehouse_in: ['зона хранения', 'зоны хранения', 'зон хранения'],
  welding: ['линия сварки', 'линии сварки', 'линий сварки'],
  painting: ['линия окраски', 'линии окраски', 'линий окраски'],
  assembly: ['сборочная линия', 'сборочные линии', 'сборочных линий'],
  inspection: ['линия контроля', 'линии контроля', 'линий контроля'],
  warehouse_out: ['зона приёмки', 'зоны приёмки', 'зон приёмки'],
  custom: ['станция', 'станции', 'станций'],
};
