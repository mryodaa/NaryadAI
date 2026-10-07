// Планировка цеха для 3D — процедурно из справочников (НСИ): участки по потоку слева направо,
// посты маршрута кузова, оборудование, ёмкость буферов. Придут с завода другие посты или
// оборудование — планировка перестроится сама, без правок сцены.
import { BUFFERS, EQUIPMENT, KITS, POSTS, type AreaId, type BufferId, type EquipmentKind } from '@allur/contracts/ref';
import { FLOW } from '../../state/selectors';

/** Кузов примерно в натуральную величину, метры */
export const BODY = { length: 4.2, width: 1.8, height: 1.35 } as const;
/** Глубина зон поперёк потока */
export const ZONE_DEPTH = 20;
const HALF = ZONE_DEPTH / 2;
/** Проход между зонами */
const GAP = 2;
/** Поле внутри зоны до первого поста */
const MARGIN = 1.4;
/** Сетка буфера: кузова стоят поперёк потока в четыре ряда, ближние к линии заполняются первыми */
const SLOT_X = 2.5;
const SLOT_Z = 5.3;
const BUFFER_ROWS = [-0.5, 0.5, -1.5, 1.5] as const;
const PARKING_ROWS = [0, -1, 1] as const;
/** Высота пола зоны (платформы) */
export const FLOOR_Y = 0.12;

/** Сколько места вдоль потока занимает пост с оборудованием этого типа */
const STEP: Record<EquipmentKind, number> = {
  robot: 4.9,
  pretreatment: 7.2,
  booth: 6.3,
  oven: 7.2,
  conveyor: 4.7,
  inspection: 6.2,
  track: 6.2,
  rain_test: 6.4,
};

/** Высота оборудования — для меток и плашек над ним */
const HEIGHT: Record<EquipmentKind, number> = {
  robot: 3.1,
  pretreatment: 1.7,
  booth: 4.2,
  oven: 3.8,
  conveyor: 3.4,
  inspection: 4,
  track: 0.6,
  rain_test: 4,
};

export type ProducingArea = 'weld' | 'paint' | 'assembly' | 'qc';
export const PRODUCING: readonly ProducingArea[] = ['weld', 'paint', 'assembly', 'qc'];

/** Сегменты пути кузова по порядку: посты участков и буферы между ними */
export type SegId = ProducingArea | BufferId | 'finished';

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
  kind: EquipmentKind;
  x: number;
  z: number;
  /** С какой стороны линии стоит (роботы — по обе стороны поочерёдно) */
  side: -1 | 1;
  /** Конвейер тянется через несколько постов */
  span?: [number, number];
  height: number;
}

export interface PlantLayout {
  zones: Record<AreaId, Rect>;
  buffers: Record<BufferId, Rect>;
  /** Места по сегментам: индекс 0 — ниже всех по потоку (голова очереди, последний пост) */
  segSpots: Record<SegId, Spot[]>;
  postSpots: Record<string, Spot>;
  equipment: EquipmentPlace[];
  kitSpots: { kitId: string; x: number; z: number }[];
  /** Откуда появляются новые кузова (начало сварки) */
  entry: Spot;
  bounds: Rect;
}

const EQ_BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

function kindOfPost(equipmentId: string | undefined): EquipmentKind {
  return (equipmentId && EQ_BY_ID.get(equipmentId)?.kind) || 'conveyor';
}

export function buildLayout(): PlantLayout {
  const zones = {} as Record<AreaId, Rect>;
  const buffers = {} as Record<BufferId, Rect>;
  const segSpots = {} as Record<SegId, Spot[]>;
  const postSpots: Record<string, Spot> = {};
  const kitSpots: PlantLayout['kitSpots'] = [];

  let x = 0;
  for (const area of FLOW) {
    const x0 = x;
    let width: number;
    if (area === 'warehouse') {
      width = 10;
      KITS.forEach((k, i) => kitSpots.push({ kitId: k.id, x: x0 + 2.2 + (i % 3) * 2.8, z: i < 3 ? -2.8 : 2.8 }));
    } else if (area === 'finished') {
      width = 10;
      // стоянка готовых машин: две колонки по три места поперёк потока
      segSpots.finished = Array.from({ length: 6 }, (_, i) => ({ x: x0 + 3 + Math.floor(i / 3) * (SLOT_X + 1.3), z: PARKING_ROWS[i % 3]! * SLOT_Z, rot: Math.PI / 2 }));
    } else {
      const posts = POSTS.filter((p) => p.area === area);
      const steps = posts.map((p) => STEP[kindOfPost(p.equipmentId)]);
      width = MARGIN * 2 + steps.reduce((a, b) => a + b, 0);
      let c = x0 + MARGIN;
      posts.forEach((p, i) => {
        const cx = c + steps[i]! / 2;
        c += steps[i]!;
        // полигон — выезд с линии назад, кузов там стоит в стороне от линии
        postSpots[p.id] = kindOfPost(p.equipmentId) === 'track' ? { x: cx, z: -HALF + 3.6, rot: 0 } : { x: cx, z: 0, rot: 0 };
      });
      segSpots[area] = posts.map((p) => postSpots[p.id]!).reverse();
    }
    zones[area] = { x0, x1: x0 + width, z0: -HALF, z1: HALF };
    x = x0 + width + GAP;

    const buf = BUFFERS.find((b) => b.from === area);
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

  const equipment: EquipmentPlace[] = [];
  const robotIndex: Partial<Record<AreaId, number>> = {};
  for (const e of EQUIPMENT) {
    const spots = POSTS.filter((p) => p.equipmentId === e.id).map((p) => postSpots[p.id]!).filter(Boolean);
    if (!spots.length) continue;
    const first = spots[0]!;
    let place: EquipmentPlace = { id: e.id, name: e.name, area: e.area, kind: e.kind, x: first.x, z: first.z, side: 1, height: HEIGHT[e.kind] };
    if (e.kind === 'robot') {
      const i = robotIndex[e.area] ?? 0;
      robotIndex[e.area] = i + 1;
      const side = i % 2 === 0 ? -1 : 1;
      place = { ...place, side, z: side * 3.1 };
    } else if (e.kind === 'conveyor') {
      const xs = spots.map((s) => s.x);
      const span: [number, number] = [Math.min(...xs) - 2.3, Math.max(...xs) + 2.3];
      place = { ...place, x: span[0], z: 0, span };
    }
    equipment.push(place);
  }

  return {
    zones,
    buffers,
    segSpots,
    postSpots,
    equipment,
    kitSpots,
    entry: { x: zones.weld.x0 + 0.4, z: 0, rot: 0 },
    bounds: { x0: 0, x1: x - GAP, z0: -HALF, z1: HALF },
  };
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
