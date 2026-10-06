// Пресеты сценариев: состояние цеха в 07:59 7 октября и запланированные события.
// Детерминированно: одно зерно + один сценарий = одна и та же смена.
import { DEMO_DATE, plantMs, type ScenarioId } from '@allur/contracts';
import { CAL, MIN } from './calibration';
import { hashSeed } from './rng';
import { World, filterBodiesAt, type WorldPreset } from './world';

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return plantMs(DEMO_DATE, h! * 60 + m!);
};

export const RUN_START_MS = at('07:59');

/** Сколько кузовов прошло через Камеру-02 с замены фильтра к 08:00, чтобы в hhmm перепад был ~300 Па */
function filterBodiesFor(crossAt: string): number {
  // с 08:00 до момента — по ~15 кузовов в час
  const hours = (at(crossAt) - at('08:00')) / (60 * MIN);
  return Math.max(0, Math.round(filterBodiesAt(CAL.filter.dirtyPa) - hours * 15));
}

const base = (seed: number, scenario: ScenarioId): WorldPreset => ({
  startMs: RUN_START_MS,
  seed: hashSeed(seed, scenario),
  randomFailures: true,
  microStops: true,
  filterB2Bodies: filterBodiesFor('12:30'),
  filterB1Bodies: 260,
  robotCycles: { 'ABB-01': 2310, 'ABB-02': 3980, 'ABB-03': 1120, 'ABB-04': 5560 },
  buffers: { ...CAL.initialBuffers },
  kitShifts: {
    'KIT-ONIX-HARNESS': 3.6,
    'KIT-ONIX-INTERIOR': 3.9,
    'KIT-COBALT-HARNESS': 3.4,
    'KIT-COBALT-INTERIOR': 3.8,
    'KIT-J7-HARNESS': 2.3,
    'KIT-J7-INTERIOR': 3.5,
  },
  delayedDeliveries: [],
  serial: CAL.firstSerial,
});

export interface ScenarioSetup {
  preset: WorldPreset;
  /** Записи 1С:MES до начала смены, которые относятся к этому прогону (например, ночное ТО) */
  preStart: { kind: 'robot_serviced'; equipmentId: string; from: number; to: number }[];
  init?: (w: World) => void;
}

export function setupScenario(id: ScenarioId, seed: number): ScenarioSetup {
  const p = base(seed, id);
  switch (id) {
    case 'live_day':
      return { preset: p, preStart: [] };

    case 'normal':
      // Всё в пределах нормы: свежий фильтр, ABB-04 обслужен ночью, без крупных отказов
      return {
        preset: { ...p, randomFailures: false, filterB2Bodies: 20, robotCycles: { ...p.robotCycles, 'ABB-04': 0 } },
        preStart: [{ kind: 'robot_serviced', equipmentId: 'ABB-04', from: at('05:30'), to: at('06:00') }],
      };

    case 'paint_filter':
      // Перепад переходит 300 Па около 12:10 — к старту показа (13:30) брак окраски уже растёт,
      // а предел (450 Па) наступит после 16:00, так что фильтр успевают заменить в пересменку
      return {
        preset: { ...p, randomFailures: false, filterB2Bodies: filterBodiesFor('12:10'), kitShifts: { ...p.kitShifts, 'KIT-J7-HARNESS': 3.6 } },
        preStart: [],
      };

    case 'chain_break':
      // Перед сборкой почти полный буфер: окраска быстро упрётся в него («Заблокирован», а не «Авария»)
      return {
        preset: {
          ...p,
          randomFailures: false,
          filterB2Bodies: 60,
          buffers: { 'weld-paint': 7, 'paint-assembly': 12, 'assembly-qc': 3 },
          chainBreakAt: at('10:05'),
        },
        preStart: [],
      };

    case 'j7_kits':
      // Жгутов J7 на 1,5 смены, утренняя поставка задержана до завтрашнего обеда
      return {
        preset: {
          ...p,
          randomFailures: false,
          filterB2Bodies: 60,
          kitShifts: { ...p.kitShifts, 'KIT-J7-HARNESS': 1.75 },
          delayedDeliveries: [{ kitId: 'KIT-J7-HARNESS', untilMs: at('07:00') + 30 * 60 * MIN }],
        },
        preStart: [],
      };

    case 'abb04_service':
      // ABB-04 почти выработал межсервисный интервал
      return {
        preset: { ...p, randomFailures: false, filterB2Bodies: 60, robotCycles: { ...p.robotCycles, 'ABB-04': 5795 } },
        preStart: [],
      };
  }
}
