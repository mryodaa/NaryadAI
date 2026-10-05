import type { LossCategory, Mechanic, StationId } from './types';

/** Длительность смены в минутах. Время симуляции t — минуты от 08:00 первого дня. */
export const SHIFT_LEN = 480;
export const DAY_START = 8 * 60;
export const SHIFT_PLAN = 440;
/** Идеальный такт линии, мин/авто — база для расчёта OEE */
export const IDEAL_CYCLE = 0.88;

export const MARGIN_PER_CAR = 180_000;
export const MAINT_COST = 45_000;
export const REPAIR_COST = 650_000;
export const REWORK_COST = 35_000;
export const MAJOR_REPAIR_MIN = 210;
/** Норма брака на ОТК (скользящее окно 60 авто) */
export const REJECT_NORM = 0.04;
export const MAINT_MIN = 40;

/** Пороги виброскорости, мм/с (по мотивам ISO 10816) */
export const VIB_NORM = 4.5;
export const VIB_WARN = 7.1;
export const VIB_CRIT = 11;

export const LOSS_CATS: LossCategory[] = [
  'Механика',
  'Электрика',
  'Наладка',
  'Нет комплектующих',
  'Ожидание персонала',
  'Плановое ТО',
  'Материалы',
];

export interface StationDef {
  id: StationId;
  name: string;
  short: string;
  cycle: number;
  defectRate: number;
  microP: number;
  micro: { cause: string; cat: LossCategory }[];
}

export const STATIONS: StationDef[] = [
  {
    id: 'press',
    name: 'Штамповочное производство',
    short: 'Штамповка',
    cycle: 0.8,
    defectRate: 0.002,
    microP: 0.006,
    micro: [
      { cause: 'Смена штампа', cat: 'Наладка' },
      { cause: 'Застревание заготовки', cat: 'Механика' },
      { cause: 'Нет рулона металла у линии', cat: 'Материалы' },
    ],
  },
  {
    id: 'weld',
    name: 'Сварка кузова',
    short: 'Сварка',
    cycle: 0.95,
    defectRate: 0.003,
    microP: 0.005,
    micro: [
      { cause: 'Замена электродов', cat: 'Наладка' },
      { cause: 'Сбой датчика позиционирования', cat: 'Электрика' },
      { cause: 'Ожидание наладчика', cat: 'Ожидание персонала' },
    ],
  },
  {
    id: 'paint',
    name: 'Окрасочный цех',
    short: 'Окраска',
    cycle: 0.97,
    defectRate: 0.006,
    microP: 0.004,
    micro: [
      { cause: 'Смена цвета', cat: 'Наладка' },
      { cause: 'Засор форсунки', cat: 'Механика' },
    ],
  },
  {
    id: 'assembly',
    name: 'Главный конвейер сборки',
    short: 'Сборка',
    cycle: 1.0,
    defectRate: 0.004,
    microP: 0.005,
    micro: [
      { cause: 'Остановка оператором (андон)', cat: 'Ожидание персонала' },
      { cause: 'Сбой гайковёрта', cat: 'Электрика' },
      { cause: 'Некомплект на линии', cat: 'Материалы' },
    ],
  },
  {
    id: 'qc',
    name: 'Контроль качества (ОТК)',
    short: 'ОТК',
    cycle: 0.9,
    defectRate: 0,
    microP: 0.003,
    micro: [{ cause: 'Калибровка стенда', cat: 'Наладка' }],
  },
];

export const stationIndex = (id: StationId) => STATIONS.findIndex((d) => d.id === id);
export const stationDef = (id: StationId) => STATIONS[stationIndex(id)];

/** Буферы между соседними участками: [штамп→сварка, сварка→окраска, окраска→сборка, сборка→ОТК] */
export const BUFFER_CAPS = [40, 25, 45, 12];
export const BUFFER_INIT = [30, 14, 30, 5];

/** Склад комплектующих, питающий сборку */
export const KITS = { cap: 260, init: 150, interval: 90, qty: 95, firstAt: 40 };

export interface EquipmentDef {
  id: string;
  name: string;
  stationId: StationId;
  vibBase: number;
  tempBase: number;
  hours: number;
  maintIntervalH: number;
  failCat: LossCategory;
  parts: string[];
  action: string;
  drift?: number;
  vib0?: number;
}

export const EQUIPMENT: EquipmentDef[] = [
  { id: 'P-1', name: 'Пресс П-1', stationId: 'press', vibBase: 3.2, tempBase: 54, hours: 410, maintIntervalH: 1200, failCat: 'Механика', parts: ['Комплект уплотнений гидроцилиндра'], action: 'Диагностика гидросистемы, замена уплотнений, проверка ползуна' },
  { id: 'P-2', name: 'Пресс П-2', stationId: 'press', vibBase: 3.8, tempBase: 56, hours: 1080, maintIntervalH: 1200, failCat: 'Механика', parts: ['Подшипник главного вала 23152', 'Смазка Литол-24, 2 кг'], action: 'Замена подшипника главного вала, центровка, контроль вибрации после пуска' },
  { id: 'CUT-1', name: 'Линия резки', stationId: 'press', vibBase: 2.6, tempBase: 45, hours: 300, maintIntervalH: 900, failCat: 'Механика', parts: ['Ножи гильотины ×2'], action: 'Замена ножей, регулировка зазора' },
  { id: 'R-07', name: 'Сварочный робот R-07', stationId: 'weld', vibBase: 3.5, tempBase: 48, hours: 640, maintIntervalH: 700, failCat: 'Электрика', parts: ['Сервопривод оси 4', 'Кабель-пакет робота'], action: 'Проверка сервопривода оси 4 и кабель-пакета', drift: 0.006, vib0: 4.4 },
  { id: 'R-14', name: 'Сварочный робот R-14', stationId: 'weld', vibBase: 3.3, tempBase: 47, hours: 220, maintIntervalH: 700, failCat: 'Электрика', parts: ['Сварочные клещи, электроды'], action: 'Замена электродов, проверка клещей' },
  { id: 'JIG-1', name: 'Кондуктор кузова', stationId: 'weld', vibBase: 2.4, tempBase: 40, hours: 500, maintIntervalH: 1500, failCat: 'Механика', parts: ['Пневмоприжимы ×4'], action: 'Проверка прижимов и базирования кузова' },
  { id: 'K-1', name: 'Камера окраски K-1', stationId: 'paint', vibBase: 2.8, tempBase: 24, hours: 300, maintIntervalH: 1000, failCat: 'Механика', parts: ['Фильтр приточный ФП-4 ×2', 'Датчик влажности'], action: 'Калибровка системы подготовки воздуха, замена фильтров' },
  { id: 'OV-1', name: 'Печь сушки', stationId: 'paint', vibBase: 2.2, tempBase: 140, hours: 600, maintIntervalH: 2000, failCat: 'Электрика', parts: ['ТЭН 6 кВт'], action: 'Проверка нагревателей и вентиляторов рециркуляции' },
  { id: 'PR-3', name: 'Робот-окрасчик PR-3', stationId: 'paint', vibBase: 3.0, tempBase: 44, hours: 350, maintIntervalH: 800, failCat: 'Механика', parts: ['Распылитель-колокол'], action: 'Чистка и замена распылителя' },
  { id: 'CV-1', name: 'Конвейер ГК-1', stationId: 'assembly', vibBase: 3.6, tempBase: 50, hours: 900, maintIntervalH: 2000, failCat: 'Механика', parts: ['Секция тяговой цепи'], action: 'Натяжка и замена секции цепи, смазка' },
  { id: 'NR-2', name: 'Гайковёрт многошпиндельный', stationId: 'assembly', vibBase: 2.9, tempBase: 42, hours: 450, maintIntervalH: 1000, failCat: 'Электрика', parts: ['Шпиндель с датчиком момента'], action: 'Калибровка датчиков момента, проверка шпинделей' },
  { id: 'FL-1', name: 'Стенд заливки жидкостей', stationId: 'assembly', vibBase: 2.1, tempBase: 38, hours: 200, maintIntervalH: 1500, failCat: 'Механика', parts: ['Клапан дозатора'], action: 'Проверка дозаторов, замена клапана' },
  { id: 'GEO-1', name: 'Стенд геометрии', stationId: 'qc', vibBase: 1.8, tempBase: 35, hours: 300, maintIntervalH: 2000, failCat: 'Электрика', parts: ['Лазерный датчик'], action: 'Калибровка лазерных датчиков' },
  { id: 'RT-1', name: 'Роликовый стенд', stationId: 'qc', vibBase: 3.1, tempBase: 46, hours: 700, maintIntervalH: 1500, failCat: 'Механика', parts: ['Подшипник ролика'], action: 'Замена подшипников роликов' },
];

export const MECHANICS: Omit<Mechanic, 'orderId'>[] = [
  { id: 'm1', name: 'Иванов А.', role: 'Механик' },
  { id: 'm2', name: 'Петров С.', role: 'Электрик' },
  { id: 'm3', name: 'Сидорова Е.', role: 'Механик' },
  { id: 'm4', name: 'Кузнецов Д.', role: 'Электрик' },
];
