// Нормы, допущения и параметры денег. Всё, что не пришло из данных, — здесь, на виду.

export interface MoneyParams {
  /** Упущенная маржа за 1 недовыпущенную машину, ₸ */
  carMargin: number;
  /** Повторная окраска одного кузова, ₸ */
  repaintCost: number;
  /** Замена фильтра окрасочной камеры (фильтр + работа), ₸ */
  filterReplacement: number;
  /** Плановое ТО робота, ₸ */
  robotService: number;
  /** Час сверхурочной работы линии, ₸ */
  overtimeHour: number;
  /** Дополнительная смена в субботу, ₸ */
  saturdayShift: number;
  /** Срочная доставка комплектов, ₸ */
  expressDelivery: number;
}

/** Условные значения — уточняются с заводом. В интерфейсе всегда помечены «условно». */
export const DEFAULT_MONEY: MoneyParams = {
  carMargin: 750_000,
  repaintCost: 120_000,
  filterReplacement: 180_000,
  robotService: 250_000,
  overtimeHour: 1_400_000,
  saturdayShift: 9_000_000,
  expressDelivery: 450_000,
};

export const MONEY_LABELS: Record<keyof MoneyParams, string> = {
  carMargin: 'Упущенная маржа за 1 недовыпущенную машину',
  repaintCost: 'Повторная окраска одного кузова',
  filterReplacement: 'Замена фильтра окрасочной камеры',
  robotService: 'Плановое ТО робота',
  overtimeHour: 'Час сверхурочной работы линии',
  saturdayShift: 'Дополнительная смена в субботу',
  expressDelivery: 'Срочная доставка комплектов',
};

export interface TwinConfig {
  taktMin: number;
  shiftPlan: number;
  /** Нет прохода VIN дольше N тактов — участок стоит */
  stopTakts: number;
  qualityWindowMin: number;
  defectNorm: number;
  oeeNorm: number;
  criticalDowntimeLimitMin: number;
  monthTargetDefault: number;
  filter: { normPa: number; dirtyPa: number; limitPa: number; forcedMin: number; plannedMin: number };
  robotIntervalCycles: number;
  /** Сколько остановки окраски гасит буфер перед сборкой (для оценки рычагов месяца) */
  bufferAbsorption: number;
  monteCarloRuns: number;
  money: MoneyParams;
}

export const DEFAULT_CONFIG: TwinConfig = {
  taktMin: 4,
  shiftPlan: 120,
  stopTakts: 3,
  qualityWindowMin: 120,
  defectNorm: 0.02,
  oeeNorm: 0.85,
  criticalDowntimeLimitMin: 60,
  monthTargetDefault: 5500,
  filter: { normPa: 250, dirtyPa: 300, limitPa: 450, forcedMin: 40, plannedMin: 25 },
  robotIntervalCycles: 6000,
  bufferAbsorption: 0.5,
  monteCarloRuns: 200,
  money: DEFAULT_MONEY,
};

/** Допущения прототипа — показываются в разделе «Допущения» */
export const ASSUMPTIONS: string[] = [
  'План — 120 машин на смену при такте 4 минуты, 2 смены по 8 часов (08:00–16:00, 16:00–24:00), ночь нерабочая.',
  'Целевой план октября — 5500 машин; по моделям — пропорционально выданному плану (Onix 2500, Cobalt 1800, J7 500).',
  'В плане октября учтены 2 рабочие субботы по 2 смены (17.10 и 24.10): без них при такте 4 минуты в октябре помещается не больше 5040 машин.',
  '26.10 — выходной (перенос Дня Республики с воскресенья 25.10). Итого 23 рабочих дня, 46 смен, 5520 машин мощности.',
  'Выпуск завода считается по линии «Сборка-1» (как в выданном сменном отчёте).',
  'Строка выданной таблицы «Работа линий» — первая смена дня.',
  'Состав цеха — по открытым данным о заводе Allur, укрупнённо и условно: три сварочные линии под Onix, Cobalt и J7 сходятся в общую окраску и сборку; 59 постов сборки — 11 групп на трёх участках конвейера. Нормы цикла, частота выборочного контроля (лаборатория геометрии — каждый 25-й кузов, полигон — около 10% машин) — по типовой практике, уточняются с заводом.',
  'Машинокомплект выдаётся на сварку целиком: без любой позиции модели встаёт линия этой модели, остальные работают (по типовой практике).',
  'Норма перепада на фильтре окрасочной камеры — до 250 Па, выше 300 Па резко растёт сорность, 450 Па — предел (вынужденная замена ~40 мин).',
  'Межсервисный интервал роботов сварки — 6000 циклов (кузовов).',
  'Буфер перед сборкой гасит около половины остановки окраски (для оценки рычагов «что если»).',
  'Все суммы в тенге условные и уточняются с заводом.',
];
