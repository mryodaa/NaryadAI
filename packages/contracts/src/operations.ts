// Операции над кузовом и маршрут по составу цеха. Каждая операция может менять вид кузова
// (визуальный эффект): голый металл по частям, катафорез, грунт, цвет, лак, салон, шасси, колёса…
// Операции привязываются к постам: у части типов оборудования они свои (ванна подготовки — подготовка
// и катафорез), у остальных — по порядку постов участка (роботы линии сварки, группы постов сборки).
// Без зависимостей — используется ядром, имитаторами и интерфейсом.
import type { EquipmentTypeId, StageKind } from './equipment-catalog';
import type { ModelId } from './plant';
import { stationsFor, type PlantEquipment, type PlantModel, type PlantStation } from './plant-model';

export const VISUAL_EFFECTS = [
  'kit',
  'biw_underbody',
  'biw_sides',
  'biw_roof',
  'biw_closures',
  'ecoat',
  'primer',
  'color',
  'gloss',
  'trim',
  'chassis',
  'wheels',
  'glass',
  'complete',
  'on_rollers',
  'on_alignment_stand',
  'in_water_booth',
  'parked',
] as const;
export type VisualEffect = (typeof VISUAL_EFFECTS)[number];

export interface OperationDef {
  id: string;
  name: string;
  effect?: VisualEffect;
  /** Выборочная: проходят не все кузова (лаборатория, полигон, полировка) */
  optional?: boolean;
}

const op = (id: string, name: string, effect?: VisualEffect, optional?: boolean): OperationDef => ({ id, name, effect, optional });

export const OPERATIONS: Record<string, OperationDef> = Object.fromEntries(
  [
    op('kit_issued', 'Выдача машинокомплекта', 'kit'),
    op('weld_underbody', 'Сварка основания', 'biw_underbody'),
    op('weld_sides', 'Сварка боковин', 'biw_sides'),
    op('weld_roof', 'Сварка крыши', 'biw_roof'),
    op('hang_closures', 'Навеска дверей, капота и крышки багажника', 'biw_closures'),
    op('vin_marking', 'Нанесение VIN'),
    op('metal_finish', 'Рихтовка и доводка'),
    op('geometry_check', 'Контроль геометрии в лаборатории', undefined, true),
    op('pretreatment', 'Подготовка поверхности'),
    op('ecoat', 'Катафорезное грунтование', 'ecoat'),
    op('ecoat_cure', 'Сушка катафореза'),
    op('sealing', 'Герметизация швов'),
    op('primer', 'Вторичный грунт', 'primer'),
    op('basecoat', 'Базовая эмаль', 'color'),
    op('clearcoat', 'Лак', 'gloss'),
    op('curing', 'Сушка'),
    op('paint_inspection', 'Контроль покрытия'),
    op('polishing', 'Полировка', undefined, true),
    op('wiring', 'Проводка'),
    op('instrument_panel', 'Панель приборов'),
    op('interior', 'Обивка салона', 'trim'),
    op('seats', 'Сиденья'),
    op('chassis_marriage', '«Свадьба» кузова и шасси', 'chassis'),
    op('suspension', 'Подвеска и выпуск'),
    op('wheels', 'Колёса', 'wheels'),
    op('glazing', 'Стёкла', 'glass'),
    op('doors', 'Двери'),
    op('ecu_programming', 'Программирование блоков'),
    op('fluids', 'Заправка жидкостей', 'complete'),
    op('roll_test', 'Роликовый стенд', 'on_rollers'),
    op('alignment', 'Развал-схождение', 'on_alignment_stand'),
    op('headlight_aim', 'Настройка фар'),
    op('water_test', 'Проверка герметичности', 'in_water_booth'),
    op('track_test', 'Пробег на полигоне', undefined, true),
    op('final_inspection', 'Финальный осмотр'),
    op('parked', 'Приёмка на склад готовой продукции', 'parked'),
  ].map((o) => [o.id, o]),
);

/** Операции, которые делает сам тип оборудования, где бы он ни стоял */
const TYPE_OPS: Partial<Record<EquipmentTypeId, string[]>> = {
  weld_finish: ['metal_finish'],
  geometry_lab: ['geometry_check'],
  geometry_station: ['geometry_check'],
  pretreatment: ['pretreatment', 'ecoat'],
  sealer: ['sealing'],
  primer_booth: ['primer'],
  paint_inspection: ['paint_inspection'],
  polishing: ['polishing'],
  rain_test: ['water_test'],
  test_track: ['track_test'],
  inspection_post: ['final_inspection'],
};

/** Операции по порядку постов участка — для оборудования без своих операций (группы постов) */
const STAGE_TEMPLATE: Partial<Record<StageKind, string[][]>> = {
  welding: [['weld_underbody'], ['weld_sides'], ['weld_roof'], ['hang_closures', 'vin_marking']],
  painting: [['basecoat'], ['clearcoat']],
  assembly: [['wiring'], ['instrument_panel'], ['interior'], ['seats'], ['chassis_marriage'], ['suspension'], ['wheels'], ['glazing'], ['doors'], ['ecu_programming'], ['fluids']],
  inspection: [['roll_test'], ['alignment'], ['headlight_aim']],
};

/** Операции поста: фиксированные по типу или по порядку постов участка */
export interface PostOps {
  postId: string;
  equipmentId: string;
  stageId: string;
  stationId: string | null;
  ops: string[];
  /** Норма на пост, с (норма цикла оборудования или время выборочной операции) */
  normSec: number;
  optional: boolean;
}

const cache = new WeakMap<PlantModel, Map<string, PostOps>>();

/** Свои операции типа оборудования; печь на входе окраски — сушка катафореза */
function fixedOps(e: PlantEquipment): string[] | undefined {
  if (e.type.id === 'oven') return e.place === 'inlet' ? ['ecoat_cure'] : ['curing'];
  return TYPE_OPS[e.type.id];
}

/** Операции каждого поста цеха */
export function plantOperations(plant: PlantModel): Map<string, PostOps> {
  const hit = cache.get(plant);
  if (hit) return hit;
  const out = new Map<string, PostOps>();
  const set = (e: PlantEquipment, postId: string, ops: string[], optional = false, normSec = e.cycleSec ?? 0) =>
    out.set(postId, { postId, equipmentId: e.id, stageId: e.stageId, stationId: e.stationId, ops, normSec, optional });
  for (const stage of plant.production) {
    const flow = [...stage.inlet, ...stage.stations.flatMap((st) => st.equipment), ...stage.outlet];
    for (const e of flow) {
      const f = fixedOps(e);
      if (f) for (const p of e.posts) set(e, p.id, f);
    }
    // остальные посты — по шаблону участка, по порядку: вход, станция, выход (у каждой станции свой)
    const template = STAGE_TEMPLATE[stage.kind] ?? [];
    const free = (eqs: PlantEquipment[]) => eqs.flatMap((e) => (fixedOps(e) ? [] : e.posts.map((p) => ({ e, id: p.id }))));
    for (const st of stage.stations) {
      const posts = [...free(stage.inlet), ...free(st.equipment), ...free(stage.outlet)];
      const assign = new Map<string, string[]>(posts.map((p) => [p.id, []]));
      template.forEach((group, i) => {
        if (posts.length) assign.get(posts[Math.min(posts.length - 1, Math.floor((i * posts.length) / template.length))]!.id)!.push(...group);
      });
      for (const p of posts) if (p.e.stationId === st.id || !out.has(p.id)) set(p.e, p.id, assign.get(p.id) ?? []);
    }
    for (const side of stage.sides) {
      const e = side.equipment;
      const minutes = e.type.side?.minutes ?? [10, 20];
      for (const p of e.posts) set(e, p.id, p.id === side.inPost ? (fixedOps(e) ?? []) : [], true, ((minutes[0] + minutes[1]) / 2) * 60);
    }
  }
  cache.set(plant, out);
  return out;
}

/** Шаг маршрута кузова: операция на посту */
export interface RouteStep {
  operation: string;
  stageId: string;
  stationId: string | null;
  equipmentId: string | null;
  postId: string | null;
  /** Норма операции, с */
  normSec: number;
  optional: boolean;
  effect?: VisualEffect;
}

/**
 * Маршрут кузова модели: выдача комплекта → участки по порядку (вход, станция модели, выход, выборочные
 * операции после своего поста) → приёмка на склад готовой продукции. Станция — первая подходящая
 * (линия под модель — единственная), stations позволяет выбрать другую на участке.
 */
export function modelOperations(plant: PlantModel, model: ModelId, stations: Record<string, string> = {}): RouteStep[] {
  const posts = plantOperations(plant);
  const steps: RouteStep[] = [];
  const push = (postId: string | null, stageId: string, stationId: string | null, equipmentId: string | null, ops: string[], normSec: number, optional: boolean) => {
    const each = ops.length ? normSec / ops.length : 0;
    for (const o of ops) steps.push({ operation: o, stageId, stationId, equipmentId, postId, normSec: each, optional: optional || !!OPERATIONS[o]?.optional, effect: OPERATIONS[o]?.effect });
  };
  if (plant.warehouseIn) push(null, plant.warehouseIn.id, null, null, ['kit_issued'], 0, false);
  for (const stage of plant.production) {
    const st: PlantStation | undefined = stage.stations.find((s) => s.id === stations[stage.id]) ?? stationsFor(stage, model)[0];
    const chain = [...stage.inletPosts, ...(st?.posts ?? []), ...stage.outletPosts];
    for (const postId of chain) {
      const p = posts.get(postId);
      if (p) push(postId, stage.id, p.stationId, p.equipmentId, p.ops, p.normSec, false);
      for (const side of stage.sides) {
        if (side.after !== postId || !side.inPost) continue;
        const sp = posts.get(side.inPost);
        if (sp) push(side.inPost, stage.id, side.stationId, side.equipment.id, sp.ops, sp.normSec, true);
      }
    }
  }
  if (plant.warehouseOut) push(plant.warehouseOut.posts[0] ?? null, plant.warehouseOut.id, null, null, ['parked'], 0, false);
  return steps;
}

/** Норма на участке, с: сумма норм обязательных операций маршрута на нём */
export function stageNormSec(route: RouteStep[], stageId: string): number {
  return route.filter((s) => s.stageId === stageId && !s.optional).reduce((a, s) => a + s.normSec, 0);
}
