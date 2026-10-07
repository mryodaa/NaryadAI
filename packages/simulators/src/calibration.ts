// Калибровка имитатора по данным кейса (раздел 8.1 задания). Все цифры — модель, а не данные Allur.
// Нормы цикла, отказы по типам оборудования и состав цеха — в каталоге и конфигурации завода;
// здесь — особенности конкретного цеха: как засоряются фильтры, микропростои отдельных машин, брак.
import type { BufferId, ModelId } from '@allur/contracts';

export const MIN = 60_000;

export const CAL = {
  /** Такт линии и выпуск: 120 машин за 8-часовую смену */
  taktMin: 4,
  /** Сварка может «догонять» буфер, если он опустел */
  releaseCatchUpMin: 3.8,
  weldBufferTarget: 6,
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

  /** Межсервисный интервал роботов, циклов (тот же, что в каталоге) */
  robotIntervalCycles: 6000,

  /** Вероятность брака на кузов */
  defects: {
    weld: 0.022,
    /** Сорность в зависимости от перепада на фильтре Камеры-02 в момент прохода */
    paintDirt: (dp: number) => (dp < 250 ? 0.011 : dp < 300 ? 0.032 : 0.1 + (dp - 300) * 0.0004),
    paintOther: 0.004,
    assemblyFinal: 0.006,
    /** Испытательная линия (каждый кузов) */
    assemblyTest: 0.0025,
    /** Полигон — среди машин, взятых на полигон (выборочно, ~10%) */
    assemblyTrackSampled: 0.005,
    assemblyRain: 0.003,
  },

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

/**
 * Как засоряется фильтр камеры окраски:
 * · clog — быстро и с ускорением, по нему калибрована сорность, на пределе — вынужденная замена (Камера-02);
 * · linear — медленно, фильтр меняют ночью по графику, на сорность не влияет.
 */
export type FilterModel =
  | { kind: 'clog'; affectsDirt: true; forced: true; snapshot: true }
  | { kind: 'linear'; lifeBodies: number; risePa: number; affectsDirt: false; forced: false; snapshot: false };

export function filterModelOf(equipmentId: string): FilterModel {
  if (equipmentId === 'BOOTH-02') return { kind: 'clog', affectsDirt: true, forced: true, snapshot: true };
  return { kind: 'linear', lifeBodies: CAL.filterB1LifeBodies, risePa: 150, affectsDirt: false, forced: false, snapshot: false };
}
