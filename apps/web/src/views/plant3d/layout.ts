// Планировка цеха для 3D — процедурно из конфигурации завода: участки по потоку слева направо,
// на участке — общее оборудование на входе, параллельные станции полосами (сварочные линии под
// модели), общее на выходе; то, что в стороне от потока (лаборатория, полигон, полировка), —
// у края зоны рядом с постом, откуда туда уходит кузов. Поменялся состав цеха — планировка
// перестраивается сама, без правок сцены. Размеры оборудования — из каталога типов.
import { DEFAULT_MIX, KITS, MODELS, type AreaId, type BufferId, type ModelId, type PlantEquipment, type PlantModel, type PlantStage, type StageKind } from '@allur/contracts/ref';

/** Кузов примерно в натуральную величину, метры */
export const BODY = { length: 4.2, width: 1.8, height: 1.35 } as const;
/** Глубина зон поперёк потока (участок в одну линию) */
export const ZONE_DEPTH = 20;
const HALF = ZONE_DEPTH / 2;
/** Расстояние между полосами параллельных станций: роботы по обе стороны каждой полосы */
export const LANE_GAP = 8.6;
/** Проход между зонами */
const GAP = 2;
/** Поле внутри зоны до первого поста; у участка с полосами — шире, там подписи линий */
const MARGIN = 1.4;
const LANE_MARGIN = 4.5;
/** Сетка буфера: кузова стоят поперёк потока в четыре ряда, ближние к линии заполняются первыми */
const SLOT_X = 2.5;
const SLOT_Z = 5.3;
const BUFFER_ROWS = [-0.5, 0.5, -1.5, 1.5] as const;
const PARKING_ROWS = [0, -1, 1] as const;
/** Высота пола зоны (платформы) */
export const FLOOR_Y = 0.12;

/** Сегменты пути кузова: буферы между участками и склад ГП (стоянки) */
export type SegId = string;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Место кузова: центр на полу и поворот вокруг вертикали */
export interface Spot {
  x: number;
  z: number;
  rot: number;
}

export interface EquipmentPlace {
  id: string;
  name: string;
  area: AreaId;
  /** Ключ 3D-модели из каталога (robot, booth, conveyor…) */
  model: string;
  x: number;
  z: number;
  /** С какой стороны линии стоит (роботы — по обе стороны поочерёдно) */
  side: -1 | 1;
  /** Конвейер тянется через несколько постов */
  span?: [number, number];
  /** Посты 1С:MES на оборудовании */
  posts: string[];
  height: number;
  /** В стороне от потока: лаборатория, полигон, полировка */
  aside?: boolean;
}

/** Полоса параллельной станции: посты по порядку прохода (от входа к выходу) */
export interface LaneLayout {
  stationId: string;
  name: string;
  models: ModelId[] | null;
  z: number;
  spots: Spot[];
  /** Где новый кузов появляется на полосе (вход участка, первый по потоку) */
  entry: Spot;
  /** Доля кузовов, которые идут по этой полосе (по моделям плана) */
  weight: number;
  x0: number;
  x1: number;
}

/** Производственный участок для потока кузовов: общее на входе → полосы станций → общее на выходе */
export interface StagePipe {
  inlet: Spot[];
  lanes: LaneLayout[];
  outlet: Spot[];
}

/** Оборудование в стороне от потока и места кузовов в нём */
export interface SideLayout {
  equipmentId: string;
  area: AreaId;
  /** После какого поста кузов уходит сюда */
  after: string | null;
  x: number;
  z: number;
  spots: Spot[];
}

export interface PlantLayout {
  /** Участки по потоку */
  stages: { id: AreaId; kind: StageKind }[];
  /** Производственные участки по потоку */
  producing: AreaId[];
  /** Буферы по потоку: из какого участка и в какой */
  bufferOrder: { id: BufferId; from: AreaId; to: AreaId }[];
  warehouseId: AreaId | null;
  finishedId: AreaId | null;
  /** Посты склада готовой продукции: кузов выпущен */
  finishPosts: string[];
  /** Названия участков для подписей */
  names: Record<AreaId, { name: string; short: string }>;
  zones: Record<AreaId, Rect>;
  buffers: Record<BufferId, Rect>;
  /** Места стоянок (буферы, склад ГП): индекс 0 — голова очереди */
  segSpots: Record<SegId, Spot[]>;
  /** Производственные участки: вход, полосы станций, выход */
  pipes: Record<AreaId, StagePipe>;
  sides: SideLayout[];
  postSpots: Record<string, Spot>;
  equipment: EquipmentPlace[];
  kitSpots: { kitId: string; x: number; z: number }[];
  /** Заказанные кузова: машинокомплекты, готовые к выдаче на сварку (у края склада) */
  kitQueue: Spot[];
  bounds: Rect;
}

/** Доли полос: модель делится поровну между полосами, которые её принимают */
function laneWeights(stage: PlantStage): number[] {
  const mix = MODELS.map((m) => [m.id, DEFAULT_MIX[m.id] ?? 0] as const);
  const total = mix.reduce((a, [, v]) => a + v, 0) || 1;
  const w = stage.stations.map(() => 0);
  for (const [m, v] of mix) {
    const takers = stage.stations.map((st, i) => (!st.models || st.models.includes(m) ? i : -1)).filter((i) => i >= 0);
    for (const i of takers) w[i]! += v / total / takers.length;
  }
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / sum);
}

/** Места кузовов в оборудовании в стороне: ряды поперёк потока */
function sideSpots(x: number, z: number, slots: number): Spot[] {
  const cols = Math.ceil(slots / 2);
  return Array.from({ length: slots }, (_, i) => ({
    x: x + (Math.floor(i / 2) - (cols - 1) / 2) * 2.7,
    z: z + (i % 2 === 0 ? -1 : 1) * (slots > 1 ? 1.4 : 0),
    rot: Math.PI / 2,
  }));
}

export function buildLayout(model: PlantModel): PlantLayout {
  const zones: Record<AreaId, Rect> = {};
  const buffers: Record<BufferId, Rect> = {};
  const segSpots: Record<SegId, Spot[]> = {};
  const pipes: Record<AreaId, StagePipe> = {};
  const sides: SideLayout[] = [];
  const postSpots: Record<string, Spot> = {};
  const kitSpots: PlantLayout['kitSpots'] = [];
  const kitQueue: Spot[] = [];
  const equipment: EquipmentPlace[] = [];

  let x = 0;
  for (const stage of model.stages) {
    const x0 = x;
    let width: number;
    let half = HALF;
    if (stage.kind === 'warehouse_in') {
      width = 10;
      KITS.forEach((k, i) => kitSpots.push({ kitId: k.id, x: x0 + 2.2 + (i % 3) * 2.8, z: i < 3 ? -2.8 : 2.8 }));
      for (const z of [6.6, -6.6]) for (let i = 0; i < 3; i++) kitQueue.push({ x: x0 + 7.6 - i * 2.8, z, rot: 0 });
    } else if (stage.kind === 'warehouse_out') {
      width = 10;
      // стоянка готовых машин: две колонки по три места поперёк потока
      segSpots[stage.id] = Array.from({ length: 6 }, (_, i) => ({ x: x0 + 3 + Math.floor(i / 3) * (SLOT_X + 1.3), z: PARKING_ROWS[i % 3]! * SLOT_Z, rot: Math.PI / 2 }));
    } else {
      const r = placeStage(stage, x0, postSpots, equipment, sides);
      width = r.width;
      half = r.half;
      pipes[stage.id] = r.pipe;
    }
    zones[stage.id] = { x0, x1: x0 + width, z0: -half, z1: half };
    x = x0 + width + GAP;

    const buf = stage.bufferAfter;
    if (buf) {
      const cols = Math.ceil(buf.capacity / BUFFER_ROWS.length);
      const bw = cols * SLOT_X + 1.4;
      buffers[buf.id] = { x0: x, x1: x + bw, z0: -HALF + 0.6, z1: HALF - 0.6 };
      const slots: Spot[] = [];
      // голова очереди — у правого края, ближе к следующему участку
      for (let col = cols - 1; col >= 0 && slots.length < buf.capacity; col--) {
        for (const r of BUFFER_ROWS) if (slots.length < buf.capacity) slots.push({ x: x + 0.7 + SLOT_X * (col + 0.5), z: r * SLOT_Z, rot: Math.PI / 2 });
      }
      segSpots[buf.id] = slots;
      x += bw + GAP;
    }
  }

  const zMax = Math.max(HALF, ...Object.values(zones).map((r) => r.z1));
  return {
    stages: model.stages.map((s) => ({ id: s.id, kind: s.kind })),
    producing: model.production.map((s) => s.id),
    bufferOrder: model.buffers.map((b) => ({ id: b.id, from: b.from, to: b.to })),
    warehouseId: model.warehouseIn?.id ?? null,
    finishedId: model.warehouseOut?.id ?? null,
    finishPosts: model.warehouseOut?.posts ?? [],
    names: Object.fromEntries(model.stages.map((s) => [s.id, { name: s.name, short: s.short }])),
    zones,
    buffers,
    segSpots,
    pipes,
    sides,
    postSpots,
    equipment,
    kitSpots,
    kitQueue,
    bounds: { x0: 0, x1: x - GAP, z0: -zMax, z1: zMax },
  };
}

/** Производственный участок: посты по x, полосы станций по z, оборудование в стороне — у края зоны */
function placeStage(stage: PlantStage, x0: number, postSpots: Record<string, Spot>, equipment: EquipmentPlace[], sides: SideLayout[]) {
  const lanesN = stage.stations.length;
  const multi = lanesN > 1;
  const half = multi ? Math.max(HALF, ((lanesN - 1) * LANE_GAP) / 2 + 6.5) : HALF;
  const laneZ = (i: number) => (multi ? (i - (lanesN - 1) / 2) * LANE_GAP : 0);
  const byAfter = new Map<string, typeof stage.sides>();
  for (const s of stage.sides) if (s.after) byAfter.set(s.after, [...(byAfter.get(s.after) ?? []), s]);
  // то, что в стороне, — к дальнему краю зоны; несколько — поочерёдно к ближнему
  let sideIndex = 0;

  /** Оборудование цепочки по порядку: свои посты по x, после поста с ответвлением — место под него */
  const chain = (items: PlantEquipment[], z: number, from: number): { spots: Spot[]; end: number } => {
    let c = from;
    const spots: Spot[] = [];
    let robots = 0;
    for (const e of items) {
      const step = e.type.footprint.x;
      const first = c;
      for (const p of e.posts) {
        const spot: Spot = { x: c + step / 2, z, rot: 0 };
        postSpots[p.id] = spot;
        spots.push(spot);
        c += step;
        for (const side of byAfter.get(p.id) ?? []) c = placeSide(side, c);
      }
      if (!e.posts.length) c += step;
      equipment.push(placeOf(e, first, c, z, robots));
      if (e.type.model === 'robot') robots++;
    }
    return { spots, end: c };
  };

  const placeSide = (side: (typeof stage.sides)[number], c: number): number => {
    const e = side.equipment;
    const step = e.type.footprint.x + 1;
    const sx = c + step / 2;
    const dir = sideIndex++ % 2 === 0 ? -1 : 1;
    // полигон — выезд за пределы зоны, остальное — у края зоны
    const sz = e.type.model === 'track' ? -half + 1 : dir * (half - e.type.footprint.z / 2 - 0.8);
    const spots = e.type.model === 'track'
      ? Array.from({ length: e.type.side?.slots ?? 1 }, (_, i) => ({ x: sx, z: -half - 3.2 - i * 5, rot: Math.PI / 2 }))
      : sideSpots(sx, sz, e.type.side?.slots ?? 1);
    sides.push({ equipmentId: e.id, area: stage.id, after: side.after, x: sx, z: sz, spots });
    for (const p of e.posts) postSpots[p.id] = spots[0]!;
    equipment.push({ id: e.id, name: e.name, area: stage.id, model: e.type.model, x: sx, z: sz, side: dir as -1 | 1, posts: e.posts.map((p) => p.id), height: e.type.height, aside: true });
    return c + step;
  };

  let c = x0 + (multi ? LANE_MARGIN : MARGIN);
  const inlet = chain(stage.inlet, 0, c);
  c = inlet.end;
  const weights = laneWeights(stage);
  const laneStart = c;
  const lanes: LaneLayout[] = stage.stations.map((st, i) => {
    const z = laneZ(i);
    const r = chain(st.equipment, z, laneStart);
    return {
      stationId: st.id,
      name: st.name,
      models: st.models,
      z,
      spots: r.spots,
      entry: { x: laneStart - (multi ? 1.5 : 0.4), z, rot: 0 },
      weight: weights[i] ?? 0,
      x0: laneStart,
      x1: r.end,
    };
  });
  c = Math.max(laneStart, ...lanes.map((l) => l.x1));
  const outlet = chain(stage.outlet, 0, c);
  c = outlet.end;
  return { width: c - x0 + MARGIN, half, pipe: { inlet: inlet.spots, lanes, outlet: outlet.spots } };
}

/** Место модели оборудования: роботы — по обе стороны своей полосы, конвейер — во всю длину постов */
function placeOf(e: PlantEquipment, from: number, to: number, z: number, robotIndex: number): EquipmentPlace {
  const base: EquipmentPlace = {
    id: e.id,
    name: e.name,
    area: e.stageId,
    model: e.type.model,
    x: (from + to) / 2,
    z,
    side: 1,
    posts: e.posts.map((p) => p.id),
    height: e.type.height,
  };
  if (e.type.model === 'robot') {
    const side = robotIndex % 2 === 0 ? -1 : 1;
    return { ...base, side, z: z + side * 3.1 };
  }
  if (e.type.model === 'conveyor' || e.posts.length > 1) return { ...base, x: from, span: [from, to] };
  return base;
}

/** Рамка для камеры: прямоугольник на полу и высота */
export interface FrameBox {
  min: [number, number, number];
  max: [number, number, number];
}

export function rectBox(r: Rect, height = 5): FrameBox {
  return { min: [r.x0, 0, r.z0], max: [r.x1, height, r.z1] };
}

export function equipmentBox(e: EquipmentPlace): FrameBox {
  const half = e.span ? (e.span[1] - e.span[0]) / 2 : 3.2;
  const cx = e.span ? (e.span[0] + e.span[1]) / 2 : e.x;
  return { min: [cx - half - 1, 0, e.z - 4], max: [cx + half + 1, e.height + 1, e.z + 4] };
}
