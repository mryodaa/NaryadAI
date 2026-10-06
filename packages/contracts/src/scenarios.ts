// Ступени внедрения и сценарии демонстрации (без зависимостей — используется и в интерфейсе).

export type Stage = 0 | 1 | 2;

export const STAGES: readonly { id: Stage; name: string; description: string }[] = [
  { id: 0, name: 'Только 1С', description: 'MES, QLS, WMS, ERP. Состояние участков — по проходу VIN, с задержкой и без кодов аварий.' },
  { id: 1, name: '+ контроллеры и камеры', description: 'То, что уже стоит на заводе: коды аварий, микропростои, перепад на фильтрах, видео.' },
  { id: 2, name: '+ датчики на критичных узлах', description: 'Вибрация и ток привода конвейера: ранний прогноз обрыва цепи.' },
];

export const SCENARIO_IDS = ['live_day', 'normal', 'paint_filter', 'chain_break', 'j7_kits', 'abb04_service'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface ScenarioDef {
  id: ScenarioId;
  name: string;
  description: string;
  /** С какого времени 7 октября показывать (смена всегда идёт с 08:00, до старта — быстрая прокрутка) */
  startTime: string;
}

export const SCENARIOS: readonly ScenarioDef[] = [
  { id: 'live_day', name: 'Рабочий день', description: 'Смена идёт сама: фильтр окраски засоряется, запасы расходуются, роботы нарабатывают ресурс.', startTime: '08:00' },
  { id: 'normal', name: 'Обычная смена', description: 'Мелкие отклонения в пределах нормы.', startTime: '09:30' },
  { id: 'paint_filter', name: 'Фильтр окраски', description: 'Перепад на фильтре Камеры-02 растёт, брак окраски ползёт вверх. Главный сценарий.', startTime: '13:30' },
  { id: 'chain_break', name: 'Обрыв цепи конвейера', description: 'Сборка встаёт. Сравните, что видит двойник на ступенях 0, 1 и 2.', startTime: '09:40' },
  { id: 'j7_kits', name: 'Комплекты J7 заканчиваются', description: 'Жгутов J7 на складе на 1,5 смены.', startTime: '10:30' },
  { id: 'abb04_service', name: 'Ресурс ABB-04', description: 'Робот подходит к концу межсервисного интервала.', startTime: '14:00' },
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s])) as Record<ScenarioId, ScenarioDef>;

/** День демонстрации и начало прогона (начало первой смены) */
export const DEMO_DATE = '2026-10-07';

export function scenarioStartMs(id: ScenarioId): number {
  const [h, m] = SCENARIO_BY_ID[id].startTime.split(':').map(Number);
  return Date.parse(`${DEMO_DATE}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:00`);
}

export const SPEEDS = [1, 30, 60, 300] as const;
