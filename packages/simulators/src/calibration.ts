// Калибровка имитатора по данным кейса (раздел 8.1 задания). Все цифры — модель, а не данные Allur.
import type { AreaId, BufferId, DowntimeCategoryId, ModelId } from '@allur/contracts';

export const MIN = 60_000;

export const CAL = {
  /** Такт линии и выпуск: 120 машин за 8-часовую смену */
  taktMin: 4,
  /** Сварка может «догонять» буфер, если он опустел */
  releaseCatchUpMin: 3.8,
  weldBufferTarget: 6,
  /** Время обработки на посту, мин. Сборка (конвейер) — задаёт ритм линии */
  cycleMin: { weld: 3.8, paint: 3.9, assembly: 4.0, qc: 3.4 } satisfies Partial<Record<AreaId, number>>,
  /** Микс моделей по плану организаторов: 2500 / 1800 / 500 */
  mix: { onix: 26, cobalt: 19, j7: 5 } satisfies Record<ModelId, number>,
  /** Сквозной номер кузова на начало демо */
  firstSerial: 4801,

  initialBuffers: { 'weld-paint': 7, 'paint-assembly': 6, 'assembly-qc': 3 } satisfies Record<BufferId, number>,

  /** Фильтр Камеры-02: 120 → 450 Па примерно за 2 смены, рост ускоряется к концу */
  filter: {
    cleanPa: 120,
    limitPa: 450,
    lifeBodies: 240,
    curveK: 1.6,
    forcedMin: 40,
    plannedMin: 25,
    normPa: 250,
    dirtyPa: 300,
  },
  /** Фильтр Камеры-01 засоряется медленно и меняется ночью по графику */
  filterB1LifeBodies: 900,

  /** Межсервисный интервал роботов, циклов */
  robotIntervalCycles: 6000,

  /** Вероятность брака на кузов */
  defects: {
    weld: 0.022,
    /** Сорность в зависимости от перепада на фильтре Камеры-02 в момент прохода */
    paintDirt: (dp: number) => (dp < 250 ? 0.011 : dp < 300 ? 0.032 : 0.1 + (dp - 300) * 0.0004),
    paintOther: 0.004,
    assemblyFinal: 0.006,
    assemblyTrack: 0.003,
    assemblyRain: 0.003,
  },

  /** Отказы: интенсивность в рабочий день, длительность ~ из таблицы простоев организаторов */
  failures: [
    { equipment: ['ABB-01', 'ABB-02', 'ABB-03', 'ABB-04'], perDay: 0.12, meanMin: 25, sdMin: 6, reason: 'Ошибка датчика', code: '50296', text: 'Ошибка датчика положения', category: 'breakdown' as DowntimeCategoryId },
    { equipment: ['CONV-03'], perDay: 0.045, meanMin: 55, sdMin: 8, reason: 'Обрыв цепи', code: 'E-2117', text: 'Обрыв приводной цепи', category: 'breakdown' as DowntimeCategoryId },
    { equipment: ['PRETREAT'], perDay: 0.04, meanMin: 20, sdMin: 5, reason: 'Сбой дозирования химии', code: 'P-311', text: 'Отклонение концентрации в ванне 7', category: 'breakdown' as DowntimeCategoryId },
    { equipment: ['QC-RAIN'], perDay: 0.03, meanMin: 15, sdMin: 4, reason: 'Сбой насоса камеры герметичности', code: 'R-104', text: 'Низкое давление воды', category: 'breakdown' as DowntimeCategoryId },
  ],

  /** Микропростои: мастер их не записывает — это «неучтённые потери» */
  microStops: [
    { equipment: 'CONV-03', perShift: 6, minMin: 0.7, maxMin: 2.8, code: 'E-1043', text: 'Срабатывание датчика безопасности' },
    { equipment: 'ABB-02', perShift: 1.5, minMin: 0.7, maxMin: 2.8, code: '20205', text: 'Нет сигнала готовности' },
    { equipment: 'ABB-03', perShift: 1.5, minMin: 0.7, maxMin: 2.8, code: '20205', text: 'Нет сигнала готовности' },
  ],

  /** Мастер вносит простой в 1С:MES через 5–20 минут после начала; короче 5 минут не вносит */
  mesDelayMin: [5, 20] as const,
  mesMinDurationMin: 5,

  /** Привод конвейера (ступень 2): норма и рост перед обрывом цепи */
  conveyor: { currentA: 18, vibration: 2.1, warnLeadMin: 45, currentRiseA: 6.5, vibrationRise: 3.6 },

  /** Склад: потребность на смену = 120 × доля модели; поставка утром до смены */
  kitDeliveryHour: 7,
  kitTargetShifts: 4,
};

export const SHIFT_PLAN = 120;
