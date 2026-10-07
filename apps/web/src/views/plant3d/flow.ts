// Где стоят кузова в 3D — по трекеру двойника: у каждого кузова своё место из данных.
// · отмечен у оборудования (RFID, ПЛК, 1С:MES) — на посту этого оборудования;
// · известен только участок (ступень 0) — на посту, оцененном по норме времени (помечено как оценка);
// · в буфере — на месте очереди по порядку прихода, на складе ГП — на парковке;
// · заказан, но комплект ещё на складе — паллета у края склада.
// Несколько кузовов на одном посту (оценка, ожидание) становятся в очередь за ним.
// Анимация лишь плавно доводит картинку до данных: переезд в обход оборудования, появление и уход.
import type { BodyView } from '@allur/contracts/ref';
import { BODY, type PlantLayout, type Spot } from './layout';

interface Tween {
  path: { x: number; z: number }[];
  len: number[];
  rot0: number;
  rot1: number;
  t0: number;
  dur: number;
}

interface Body {
  id: string;
  x: number;
  z: number;
  rot: number;
  scale: number;
  tween: Tween | null;
  /** появление/исчезновение: масштаб к цели */
  grow: { from: number; to: number; t0: number; dur: number } | null;
  dying: boolean;
  view: BodyView;
  target: Spot;
}

const GROW_S = 0.35;
const MOVE_S = 1.1;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Место каждого кузова по данным трекера: чистая функция, без анимации */
export function placeBodies(views: BodyView[], layout: PlantLayout): Map<string, Spot> {
  const out = new Map<string, Spot>();
  const groups = new Map<string, { base: Spot[]; items: BodyView[]; queue: boolean }>();
  const add = (key: string, base: Spot[], v: BodyView, queue = false) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { base, items: [], queue }));
    g.items.push(v);
  };
  const sides = new Map(layout.sides.map((s) => [s.equipmentId, s]));
  const postOf = (equipmentId?: string, postId?: string): Spot | undefined =>
    (postId ? layout.postSpots[postId] : undefined) ?? layout.equipment.find((e) => e.id === equipmentId && !e.aside)?.posts.map((p) => layout.postSpots[p]).find(Boolean);
  for (const v of views) {
    const loc = v.loc;
    if (loc.kind === 'warehouse') add('kit', layout.kitQueue, v);
    else if (loc.kind === 'finished') add('finished', layout.segSpots[loc.stageId] ?? [], v);
    else if (loc.kind === 'buffer') {
      const slots = loc.bufferId ? layout.segSpots[loc.bufferId] : undefined;
      if (slots?.length) add(`buf:${loc.bufferId}`, slots, v);
      else {
        // в пути на следующий участок без буфера — у выхода участка
        const pipe = layout.pipes[loc.stageId];
        const last = pipe?.outlet[pipe.outlet.length - 1] ?? pipe?.lanes[0]?.spots[pipe.lanes[0].spots.length - 1];
        if (last) add(`exit:${loc.stageId}`, [{ ...last, x: last.x + 2.4 }], v, true);
      }
    } else {
      const side = loc.equipmentId ? sides.get(loc.equipmentId) : undefined;
      if (side && !loc.estimated) add(`side:${side.equipmentId}`, side.spots, v);
      else {
        const spot = postOf(loc.equipmentId, loc.postId);
        if (spot) add(`post:${loc.postId ?? loc.equipmentId}`, [spot], v, true);
        else {
          const z = layout.zones[loc.stageId];
          if (z) add(`zone:${loc.stageId}`, [{ x: (z.x0 + z.x1) / 2, z: 0, rot: 0 }], v, true);
        }
      }
    }
  }
  for (const [key, g] of groups) {
    // по порядку прихода: в очереди первым стоит тот, кто пришёл раньше; на складе ГП — новые ближе к входу
    const items = [...g.items].sort((a, b) => (key === 'finished' ? b.order - a.order : a.order - b.order));
    items.forEach((v, i) => {
      if (g.queue) {
        // несколько кузовов на одном посту: становятся друг за другом против потока
        const s = g.base[0]!;
        out.set(v.bodyId, { x: s.x - i * (BODY.length + 0.5), z: s.z, rot: s.rot });
      } else if (i < g.base.length) out.set(v.bodyId, g.base[i]!);
    });
  }
  return out;
}

export class BodyFlow {
  private bodies = new Map<string, Body>();

  constructor(private layout: PlantLayout) {}

  /** Новое состояние из данных: кому переехать, кому появиться, кому уйти */
  update(views: BodyView[], now: number, reducedMotion: boolean) {
    const spots = placeBodies(views, this.layout);
    const dur = reducedMotion ? 0 : MOVE_S;
    const seen = new Set<string>();
    for (const v of views) {
      const to = spots.get(v.bodyId);
      if (!to) continue;
      seen.add(v.bodyId);
      const b = this.bodies.get(v.bodyId);
      if (!b) {
        const grow = dur > 0 ? { from: 0, to: 1, t0: now, dur: GROW_S } : null;
        this.bodies.set(v.bodyId, { id: v.bodyId, x: to.x, z: to.z, rot: to.rot, scale: grow ? 0 : 1, tween: null, grow, dying: false, view: v, target: to });
        continue;
      }
      b.view = v;
      if (b.dying) {
        b.dying = false;
        b.grow = dur > 0 ? { from: b.scale, to: 1, t0: now, dur: GROW_S } : null;
        if (!b.grow) b.scale = 1;
      }
      if (Math.abs(b.target.x - to.x) > 0.01 || Math.abs(b.target.z - to.z) > 0.01 || b.target.rot !== to.rot) {
        b.target = to;
        b.tween = makeTween({ x: b.x, z: b.z, rot: b.rot }, to, now, dur);
      }
    }
    for (const b of this.bodies.values()) {
      if (seen.has(b.id) || b.dying) continue;
      if (dur <= 0) this.bodies.delete(b.id);
      else {
        b.dying = true;
        b.grow = { from: b.scale, to: 0, t0: now, dur: GROW_S };
      }
    }
  }

  /** Положения кузовов на момент now; moving — пока что-то едет */
  frame(now: number, write: (i: number, x: number, z: number, rot: number, scale: number, view: BodyView) => void): { count: number; moving: boolean } {
    let i = 0;
    let moving = false;
    for (const b of [...this.bodies.values()]) {
      if (b.tween) {
        const t = b.tween.dur <= 0 ? 1 : Math.min(1, (now - b.tween.t0) / 1000 / b.tween.dur);
        const k = ease(t);
        const p = along(b.tween, k);
        b.x = p.x;
        b.z = p.z;
        b.rot = b.tween.rot0 + (b.tween.rot1 - b.tween.rot0) * k;
        if (t >= 1) b.tween = null;
        else moving = true;
      }
      if (b.grow) {
        const t = b.grow.dur <= 0 ? 1 : Math.min(1, (now - b.grow.t0) / 1000 / b.grow.dur);
        b.scale = b.grow.from + (b.grow.to - b.grow.from) * ease(t);
        if (t >= 1) {
          b.grow = null;
          if (b.dying) {
            this.bodies.delete(b.id);
            continue;
          }
        } else moving = true;
      }
      write(i++, b.x, b.z, b.rot, b.scale, b.view);
    }
    return { count: i, moving };
  }

  /** Кузов по номеру экземпляра в последнем кадре (для наведения) */
  idAt(index: number): string | null {
    let i = 0;
    for (const b of this.bodies.values()) {
      if (i === index) return b.id;
      i++;
    }
    return null;
  }
}

/**
 * Путь переезда без проезда сквозь оборудование: на стоянку — по линии, затем поперёк; со стоянки —
 * поперёк, затем по линии; между полосами участка — по линии почти до поста, поперёк и на пост.
 */
function makeTween(from: Spot, to: Spot, now: number, dur: number): Tween {
  const path = [{ x: from.x, z: from.z }];
  if (Math.abs(from.z - to.z) > 0.5 && Math.abs(from.x - to.x) > 0.5) {
    if (to.rot !== 0) path.push({ x: to.x, z: from.z });
    else if (from.rot !== 0) path.push({ x: from.x, z: to.z });
    else {
      const mid = Math.max(from.x, to.x - 2.4);
      path.push({ x: mid, z: from.z }, { x: mid, z: to.z });
    }
  }
  path.push({ x: to.x, z: to.z });
  const len = [0];
  for (let i = 1; i < path.length; i++) len.push(len[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  return { path, len, rot0: from.rot, rot1: to.rot, t0: now, dur };
}

function along(tw: Tween, t: number): { x: number; z: number } {
  const total = tw.len[tw.len.length - 1]!;
  if (total <= 0) return tw.path[tw.path.length - 1]!;
  const d = t * total;
  for (let i = 1; i < tw.path.length; i++) {
    if (d <= tw.len[i]! || i === tw.path.length - 1) {
      const seg = tw.len[i]! - tw.len[i - 1]!;
      const k = seg > 0 ? (d - tw.len[i - 1]!) / seg : 1;
      const a = tw.path[i - 1]!;
      const b = tw.path[i]!;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
  }
  return tw.path[tw.path.length - 1]!;
}
