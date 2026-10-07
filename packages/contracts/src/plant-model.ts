// Производная модель цеха из конфигурации: участки по порядку, станции, оборудование с типом
// из каталога, посты 1С:MES, буферы, входы и выходы участков, мощность по норме цикла.
// Чистые функции без зависимостей — одинаково работают в ядре, имитаторах, шлюзе и интерфейсе.
import type { ConnectionConfig, EquipmentConfig, IdPointConfig, PlantConfig, StageConfig } from './plant-config';
import { DEFAULT_COLORS, type ColorDef, type IdMethod, type IdPointRole } from './identification';
import { EQUIPMENT_TYPES, STATION_NOUN_BY_KIND, isProductionKind, type EquipmentTypeDef, type StageKind } from './equipment-catalog';
import { MODELS, type ModelId } from './plant';
import { SEED_PLANT } from './plant-seed';

/** Длительность смены, мин */
export const SHIFT_MIN = 480;

/** inlet / station / outlet — в потоке; side — в стороне от потока (лаборатория, полигон, полировка) */
export type EquipmentPlace = 'inlet' | 'station' | 'outlet' | 'side';

export interface PlantPost {
  id: string;
  name: string;
  stageId: string;
  stationId: string | null;
  equipmentId: string;
  place: EquipmentPlace;
  /** Порядок по всему потоку */
  order: number;
}

export interface PlantEquipment {
  id: string;
  name: string;
  type: EquipmentTypeDef;
  config: EquipmentConfig;
  stageId: string;
  stationId: string | null;
  place: EquipmentPlace;
  critical: boolean;
  /** Норма цикла, с: из конфигурации или каталога; null — своего такта нет */
  cycleSec: number | null;
  /** Ничего не обрабатывает и данных не даёт (стеллаж, площадка) */
  passive: boolean;
  posts: PlantPost[];
  aliases: string[];
  connection: ConnectionConfig;
  order: number;
}

/**
 * Оборудование в стороне от потока: после поста `after` часть кузовов уходит сюда (по выборке или
 * по решению контроля) и возвращается обратно в поток туда же, откуда ушла.
 */
export interface PlantSide {
  equipment: PlantEquipment;
  stageId: string;
  stationId: string | null;
  /** После какого поста кузов уходит сюда; null — не к чему привязать (ошибка конфигурации) */
  after: string | null;
  /** Пост приёма */
  inPost: string | null;
  /** Пост возврата в поток (если возврат отмечается отдельно) */
  returnPost: string | null;
  /** Уходит с выхода участка: вернувшийся кузов сразу идёт в буфер после участка */
  atExit: boolean;
}

export interface PlantStation {
  id: string;
  name: string;
  stageId: string;
  index: number;
  /** Оборудование в потоке по порядку (без того, что в стороне) */
  equipment: PlantEquipment[];
  /** Посты станции по порядку прохода кузова */
  posts: string[];
  /** Какие модели принимает (с учётом участка); null — любые */
  models: ModelId[] | null;
}

/** Точка отметки кузова: где система узнаёт, что кузов прошёл */
export interface PlantPoint {
  id: string;
  name: string;
  method: IdMethod;
  role: IdPointRole;
  stageId: string;
  stationId: string | null;
  equipmentId: string | null;
  connection: ConnectionConfig | null;
}

export interface PlantBuffer {
  /** «weld-paint»: код участка до и после */
  id: string;
  from: string;
  to: string;
  capacity: number;
}

export interface PlantStage {
  id: string;
  name: string;
  short: string;
  kind: StageKind;
  order: number;
  index: number;
  /** Производственный участок (не склад) */
  producing: boolean;
  config: StageConfig;
  /** Какие модели принимает участок; null — любые */
  models: ModelId[] | null;
  inlet: PlantEquipment[];
  stations: PlantStation[];
  outlet: PlantEquipment[];
  /** В стороне от потока: лаборатория, полигон, полировка */
  sides: PlantSide[];
  /** Всё оборудование участка по потоку: вход, станции, выход и то, что в стороне */
  equipment: PlantEquipment[];
  inletPosts: string[];
  outletPosts: string[];
  /** Посты, где кузов входит на участок */
  entryPosts: string[];
  /** Посты, после которых кузов покидает участок */
  exitPosts: string[];
  /** Посты возврата из того, что в стороне на выходе участка: после них кузов тоже в буфере */
  returnPosts: string[];
  /** Посты потока (без тех, что в стороне) */
  posts: string[];
  bufferBefore: PlantBuffer | null;
  bufferAfter: PlantBuffer | null;
}

export interface PlantModel {
  config: PlantConfig;
  version: number;
  stages: PlantStage[];
  production: PlantStage[];
  warehouseIn: PlantStage | null;
  warehouseOut: PlantStage | null;
  equipment: PlantEquipment[];
  posts: PlantPost[];
  buffers: PlantBuffer[];
  /** Точки отметки кузова по потоку */
  points: PlantPoint[];
  /** Справочник цветов кузова */
  colors: ColorDef[];
  stageById: Map<string, PlantStage>;
  equipmentById: Map<string, PlantEquipment>;
  postById: Map<string, PlantPost>;
  bufferById: Map<string, PlantBuffer>;
  pointById: Map<string, PlantPoint>;
  colorByCode: Map<string, ColorDef>;
}

/** Посты оборудования: из конфигурации, иначе — пост с кодом оборудования, если тип фиксирует проход */
export function postsOfConfig(e: EquipmentConfig): { id: string; name: string }[] {
  if (e.posts) return e.posts;
  const type = EQUIPMENT_TYPES[e.type];
  if (!type.registersPass) return [];
  if (type.side?.returnScan) {
    return [
      { id: `${e.id}-IN`, name: `${e.name}: приём` },
      { id: `${e.id}-OUT`, name: `${e.name}: возврат в поток` },
    ];
  }
  const n = type.defaultPosts ?? 1;
  return n <= 1 ? [{ id: e.id, name: e.name }] : Array.from({ length: n }, (_, i) => ({ id: `${e.id}-${i + 1}`, name: `${e.name}, пост ${i + 1}` }));
}

/** Оборудование в стороне от потока */
export function isSideType(e: EquipmentConfig): boolean {
  return EQUIPMENT_TYPES[e.type].placement === 'side';
}

/** Пересечение списков моделей; null — любые */
function intersectModels(a: ModelId[] | null, b: ModelId[] | null): ModelId[] | null {
  if (!a) return b;
  if (!b) return a;
  return a.filter((m) => b.includes(m));
}

const modelsOf = (m: ModelId[] | undefined): ModelId[] | null => (m && m.length ? [...m] : null);

const cache = new WeakMap<PlantConfig, PlantModel>();

export function derivePlant(config: PlantConfig): PlantModel {
  const hit = cache.get(config);
  if (hit) return hit;
  const sorted = [...config.stages].sort((a, b) => a.order - b.order);
  const equipment: PlantEquipment[] = [];
  const posts: PlantPost[] = [];
  const stages: PlantStage[] = [];
  const points: PlantPoint[] = [];
  const point = (c: IdPointConfig | undefined, role: IdPointRole, stageId: string, stationId: string | null, equipmentId: string | null) => {
    if (c) points.push({ id: c.id, name: c.name, method: c.method, role, stageId, stationId, equipmentId, connection: c.connection ?? null });
  };

  const add = (e: EquipmentConfig, stageId: string, stationId: string | null, place: EquipmentPlace): PlantEquipment => {
    const type = EQUIPMENT_TYPES[e.type];
    const item: PlantEquipment = {
      id: e.id,
      name: e.name,
      type,
      config: e,
      stageId,
      stationId,
      place,
      critical: e.critical,
      cycleSec: type.cycleTimeSec === null ? null : (e.cycleTimeSec ?? type.cycleTimeSec),
      passive: type.placement === 'passive',
      posts: [],
      aliases: e.aliases ?? [],
      connection: e.connection,
      order: equipment.length,
    };
    point(e.idPoint, 'equipment', stageId, stationId, e.id);
    for (const p of postsOfConfig(e)) {
      const post: PlantPost = { id: p.id, name: p.name, stageId, stationId, equipmentId: e.id, place, order: posts.length };
      item.posts.push(post);
      posts.push(post);
    }
    equipment.push(item);
    return item;
  };

  sorted.forEach((s, index) => {
    const sides: PlantSide[] = [];
    /** Список оборудования: то, что в потоке, — по порядку; то, что в стороне, привязано к предыдущему посту */
    const list = (items: EquipmentConfig[], stationId: string | null, place: 'inlet' | 'station' | 'outlet', before: string | null): PlantEquipment[] => {
      const flow: PlantEquipment[] = [];
      let last = before;
      for (const e of items) {
        if (isSideType(e)) {
          const item = add(e, s.id, stationId, 'side');
          const type = item.type;
          sides.push({
            equipment: item,
            stageId: s.id,
            stationId,
            after: last,
            inPost: item.posts[0]?.id ?? null,
            returnPost: type.side?.returnScan ? (item.posts[1]?.id ?? null) : null,
            atExit: false,
          });
          continue;
        }
        const item = add(e, s.id, stationId, place);
        flow.push(item);
        const lp = item.posts[item.posts.length - 1];
        if (lp) last = lp.id;
      }
      return flow;
    };
    point(s.idPoints?.entry, 'stage_entry', s.id, null, null);
    for (const st of s.stations) point(st.idPoints?.entry, 'station_entry', s.id, st.id, null);
    const stageModels = modelsOf(s.models);
    const inlet = list(s.inlet ?? [], null, 'inlet', null);
    const inletPosts = inlet.flatMap((e) => e.posts.map((p) => p.id));
    const stations = s.stations.map((st, i): PlantStation => {
      const eq = list(st.equipment, st.id, 'station', inletPosts[inletPosts.length - 1] ?? null);
      return {
        id: st.id,
        name: st.name,
        stageId: s.id,
        index: i,
        equipment: eq,
        posts: eq.flatMap((e) => e.posts.map((p) => p.id)),
        models: intersectModels(stageModels, modelsOf(st.models)),
      };
    });
    // у выхода предыдущего поста нет, если станций несколько: оборудованию в стороне не к чему привязаться
    const lastStation = stations.length === 1 ? (stations[0]!.posts[stations[0]!.posts.length - 1] ?? null) : null;
    const outlet = list(s.outlet ?? [], null, 'outlet', lastStation ?? (stations.length === 0 ? (inletPosts[inletPosts.length - 1] ?? null) : null));
    const outletPosts = outlet.flatMap((e) => e.posts.map((p) => p.id));
    for (const st of s.stations) point(st.idPoints?.exit, 'station_exit', s.id, st.id, null);
    point(s.idPoints?.exit, 'stage_exit', s.id, null, null);
    const stationFirst = stations.map((st) => st.posts[0]).filter((p): p is string => !!p);
    const stationLast = stations.map((st) => st.posts[st.posts.length - 1]).filter((p): p is string => !!p);
    const exitPosts = outletPosts.length ? [outletPosts[outletPosts.length - 1]!] : stationLast;
    for (const side of sides) side.atExit = side.after !== null && exitPosts.includes(side.after);
    const byId = new Map<string, PlantEquipment>();
    for (const e of [...inlet, ...stations.flatMap((st) => st.equipment), ...outlet, ...sides.map((x) => x.equipment)]) byId.set(e.id, e);
    stages.push({
      id: s.id,
      name: s.name,
      short: s.short || s.name,
      kind: s.kind,
      order: s.order,
      index,
      producing: isProductionKind(s.kind),
      config: s,
      models: stageModels,
      inlet,
      stations,
      outlet,
      sides,
      // по порядку конфигурации: то, что в стороне, — рядом с оборудованием, после которого кузов туда уходит
      equipment: [...(s.inlet ?? []), ...s.stations.flatMap((st) => st.equipment), ...(s.outlet ?? [])].map((e) => byId.get(e.id)!).filter(Boolean),
      inletPosts,
      outletPosts,
      entryPosts: inletPosts.length ? [inletPosts[0]!] : stationFirst,
      exitPosts,
      returnPosts: sides.filter((x) => x.atExit && x.returnPost).map((x) => x.returnPost!),
      posts: [...inletPosts, ...stations.flatMap((st) => st.posts), ...outletPosts],
      bufferBefore: null,
      bufferAfter: null,
    });
  });

  const buffers: PlantBuffer[] = [];
  for (let i = 0; i + 1 < stages.length; i++) {
    const a = stages[i]!;
    const b = stages[i + 1]!;
    if (!a.config.bufferAfter) continue;
    const buf: PlantBuffer = { id: `${a.id}-${b.id}`, from: a.id, to: b.id, capacity: a.config.bufferAfter.capacity };
    buffers.push(buf);
    a.bufferAfter = buf;
    b.bufferBefore = buf;
  }

  const model: PlantModel = {
    config,
    version: config.version,
    stages,
    production: stages.filter((s) => s.producing),
    warehouseIn: stages.find((s) => s.kind === 'warehouse_in') ?? null,
    warehouseOut: stages.find((s) => s.kind === 'warehouse_out') ?? null,
    equipment,
    posts,
    buffers,
    points,
    colors: config.colors?.length ? config.colors : DEFAULT_COLORS,
    stageById: new Map(stages.map((s) => [s.id, s])),
    equipmentById: new Map(equipment.map((e) => [e.id, e])),
    postById: new Map(posts.map((p) => [p.id, p])),
    bufferById: new Map(buffers.map((b) => [b.id, b])),
    pointById: new Map(points.map((p) => [p.id, p])),
    colorByCode: new Map((config.colors?.length ? config.colors : DEFAULT_COLORS).map((c) => [c.code, c])),
  };
  cache.set(config, model);
  return model;
}

export const SEED_MODEL: PlantModel = derivePlant(SEED_PLANT);

/** Первый участок этого вида */
export function stageOfKind(model: PlantModel, kind: StageKind): PlantStage | undefined {
  return model.stages.find((s) => s.kind === kind);
}

/** Существительное для счётчика станций: «Камеры окраски: 2», «Линии сварки: 3» */
export function stationNoun(stage: PlantStage): [string, string, string] {
  // тип даёт имя станции, только если станция из него одного (камера окраски, лазерная ячейка)
  const first = stage.stations[0];
  const only = first && first.equipment.length === 1 ? first.equipment[0] : undefined;
  return only?.type.stationNoun ?? STATION_NOUN_BY_KIND[stage.kind];
}

// ---------------------------------------------------------------------------
// Модели: кто какие кузова принимает

/** Станция принимает кузов этой модели */
export function stationAccepts(st: PlantStation, model: ModelId): boolean {
  return !st.models || st.models.includes(model);
}

/** Станции участка, через которые может пройти кузов модели */
export function stationsFor(stage: PlantStage, model: ModelId): PlantStation[] {
  return stage.stations.filter((st) => stationAccepts(st, model));
}

/** Станция только под одну модель («Линия J7») — её простой останавливает только эту модель */
export function dedicatedStation(stage: PlantStage, model: ModelId): PlantStation | undefined {
  const st = stationsFor(stage, model);
  return st.length === 1 && st[0]!.models?.length === 1 ? st[0] : undefined;
}

export interface RouteStage {
  stage: PlantStage;
  /** Станции, через которые может пройти кузов этой модели (одна из них) */
  stations: PlantStation[];
}

/** Маршрут кузова модели по производственным участкам: на каждом — допустимые станции */
export function modelRoute(plant: PlantModel, model: ModelId): RouteStage[] {
  return plant.production.map((stage) => ({ stage, stations: stationsFor(stage, model) }));
}

/** Доли моделей в плане; по умолчанию — план месяца из выданных данных */
export type ModelMix = Partial<Record<ModelId, number>>;

export const DEFAULT_MIX: ModelMix = Object.fromEntries(MODELS.map((m) => [m.id, m.givenPlan])) as ModelMix;

function normalizeMix(mix: ModelMix): [ModelId, number][] {
  const entries = (Object.entries(mix) as [ModelId, number][]).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return total > 0 ? entries.map(([m, v]) => [m, v / total]) : [];
}

// ---------------------------------------------------------------------------
// Мощность по норме цикла

/** Цикл станции — самое медленное оборудование в ней (кузов проходит его по очереди) */
export function stationCycleSec(st: PlantStation): number | null {
  let max: number | null = null;
  for (const e of st.equipment) if (e.cycleSec !== null && (max === null || e.cycleSec > max)) max = e.cycleSec;
  return max;
}

export interface NominalCapacity {
  /** Кузовов в смену при плановом составе моделей: станции складываются, но не больше общего оборудования */
  perShift: number;
  stations: { id: string; perShift: number; models: ModelId[] | null }[];
  shared: { id: string; perShift: number }[];
  /** Общее оборудование, которое ограничивает участок сильнее суммы станций */
  limitedBy: string | null;
  /** Модель, линии которой ограничивают участок при плановом составе моделей */
  limitedByModel: ModelId | null;
}

/**
 * Мощность участка. Если станции привязаны к моделям, считаем при плановом составе моделей: участок
 * выпускает X кузовов в смену, если линиям каждой модели хватает мощности на её долю в X.
 * Для станций, общих для нескольких моделей, это оценка сверху.
 */
export function stageNominal(stage: PlantStage, shiftMin = SHIFT_MIN, mix: ModelMix = DEFAULT_MIX): NominalCapacity | null {
  if (!stage.producing) return null;
  const stations = stage.stations
    .map((st) => ({ id: st.id, cycle: stationCycleSec(st), models: st.models }))
    .filter((x): x is { id: string; cycle: number; models: ModelId[] | null } => x.cycle !== null)
    .map((x) => ({ id: x.id, perShift: (shiftMin * 60) / x.cycle, models: x.models }));
  const shared = [...stage.inlet, ...stage.outlet].filter((e) => e.cycleSec !== null).map((e) => ({ id: e.id, perShift: (shiftMin * 60) / e.cycleSec! }));
  let perShift = stations.reduce((a, s) => a + s.perShift, 0);
  let limitedByModel: ModelId | null = null;
  if (stations.some((s) => s.models)) {
    for (const [m, share] of normalizeMix(mix)) {
      const cap = stations.filter((s) => !s.models || s.models.includes(m)).reduce((a, s) => a + s.perShift, 0);
      const byModel = cap / share;
      if (byModel < perShift) {
        perShift = byModel;
        limitedByModel = m;
      }
    }
  }
  let limitedBy: string | null = null;
  for (const s of shared) {
    if (s.perShift < perShift) {
      perShift = s.perShift;
      limitedBy = s.id;
      limitedByModel = null;
    }
  }
  return { perShift, stations, shared, limitedBy, limitedByModel };
}

// ---------------------------------------------------------------------------
// Поиск по названиям — для таблиц завода (импорт CSV, сменные отчёты)

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s_-]+/g, '')
    .replace(/(^|\D)0+(\d)/g, '$1$2');

/** «Окраска», «окраска», «paint», «ОТК» → участок */
export function stageFromName(model: PlantModel, name: string): PlantStage | undefined {
  const key = norm(name);
  if (!key) return undefined;
  return model.stages.find((s) => norm(s.id) === key || norm(s.name) === key || norm(s.short) === key);
}

/** Линия сменного отчёта: «Сварка-1» → участок «Сварка» */
export function stageFromLineName(model: PlantModel, line: string): PlantStage | undefined {
  return stageFromName(model, line.replace(/[-\s]*\d+$/, '')) ?? stageFromName(model, line);
}

/** «Камера-02», «Камера 2», «ABB01», «BOOTH-02» → оборудование */
export function equipmentFromNameIn(model: PlantModel, name: string): PlantEquipment | undefined {
  const key = norm(name);
  if (!key) return undefined;
  return model.equipment.find((e) => !e.passive && (norm(e.id) === key || norm(e.name) === key || e.aliases.some((a) => norm(a) === key)));
}
