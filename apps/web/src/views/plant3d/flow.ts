// Где стоят кузова в 3D — по трекеру двойника: у каждого кузова своё место из данных.
// · отмечен у оборудования (RFID, ПЛК, 1С:MES) — на посту этого оборудования;
// · известен только участок (ступень 0) — на посту, оцененном по норме времени (помечено как оценка);
// · в буфере — на месте очереди по порядку прихода, на складе ГП — на парковке;
// · заказан, но комплект ещё на складе — паллета у края склада.
// Машины не стоят друг в друге: если место занято (два кузова на посту — оценка, перекраска), кузов встаёт
// рядом с линией у того же поста или на ближайшее свободное место.
// Анимация лишь плавно доводит картинку до данных: переезд в обход оборудования, появление и уход.
// Данные приходят раз в секунду: новый переезд продолжает текущую скорость машины (без остановки
// на каждом сообщении), положение считается по времени — и после скрытой вкладки машина уже на месте.
import type { BodyView } from '@allur/contracts/ref';
import { BODY, type PlantLayout, type Spot } from './layout';

interface Tween {
  path: { x: number; z: number }[];
  len: number[];
  rot0: number;
  rot1: number;
  t0: number;
  dur: number;
  /** Начальная скорость вдоль пути в долях пути за переезд: 0 — с места, иначе — продолжает движение */
  m0: number;
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
/** Дольше интервала данных (1 с): машина, которая едет дальше, не успевает остановиться */
const MOVE_S = 1.4;
/** Переезд длиннее — не через весь цех, а перестановка с коротким появлением на новом месте */
const MAX_GLIDE = 36;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Доля пройденного пути: кривая Эрмита с начальной скоростью m0 и остановкой в конце (m0 = 0 — плавный старт) */
const progress = (t: number, m0: number) => (t * t * t - 2 * t * t + t) * m0 + (3 * t * t - 2 * t * t * t);
const progressRate = (t: number, m0: number) => (3 * t * t - 4 * t + 1) * m0 + (6 * t - 6 * t * t);

/** Место каждого кузова по данным трекера: чистая функция, без анимации */
export function placeBodies(views: BodyView[], layout: PlantLayout, prev?: ReadonlyMap<string, Spot>): Map<string, Spot> {
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
  // сначала — места «по праву»: первый на посту, отмеченный точно; остальные встают на ближайшее свободное
  const want: { v: BodyView; s: Spot; rank: number }[] = [];
  for (const [key, g] of groups) {
    // по порядку прихода: в очереди первым стоит тот, кто пришёл раньше; на складе ГП — новые ближе к входу
    const items = [...g.items].sort((a, b) => (key === 'finished' ? b.order - a.order : a.order - b.order));
    if (key === 'kit') {
      items.forEach((v, i) => i < g.base.length && out.set(v.bodyId, g.base[i]!));
    } else if (g.queue) items.forEach((v, i) => want.push({ v, s: g.base[0]!, rank: i }));
    else {
      // буфер, стоянка, оборудование в стороне: машина остаётся на своём месте, пока не уедет —
      // ряды стоят поперёк потока, и сдвиг всей очереди провёл бы машины одна сквозь другую
      const used = new Set<number>();
      const rest: BodyView[] = [];
      for (const v of items) {
        const was = prev?.get(v.bodyId);
        const k = was ? g.base.findIndex((b, j) => !used.has(j) && Math.abs(b.x - was.x) < 0.01 && Math.abs(b.z - was.z) < 0.01) : -1;
        if (k >= 0) {
          used.add(k);
          want.push({ v, s: g.base[k]!, rank: 0 });
        } else rest.push(v);
      }
      for (const v of rest) {
        const k = g.base.findIndex((_b, j) => !used.has(j));
        if (k < 0) break;
        used.add(k);
        want.push({ v, s: g.base[k]!, rank: 0 });
      }
    }
  }
  want.sort((a, b) => a.rank - b.rank || Number(a.v.loc.estimated) - Number(b.v.loc.estimated) || a.v.order - b.v.order);
  const taken: Spot[] = [];
  const free = (s: Spot) => taken.every((t) => !hits(s, t));
  for (const w of want) {
    const zone = w.v.loc.kind === 'station' || w.v.loc.kind === 'stage' ? layout.zones[w.v.loc.stageId] : undefined;
    const inside = (s: Spot) => !zone || (s.z - BODY.width > zone.z0 && s.z + BODY.width < zone.z1);
    let spot = w.s;
    if (!free(spot)) {
      for (const c of around(w.s)) {
        if (inside(c) && free(c)) {
          spot = c;
          break;
        }
      }
    }
    taken.push(spot);
    out.set(w.v.bodyId, spot);
  }
  return out;
}

/** Габарит кузова на полу с зазором: поперёк потока (rot ≈ 90°) длина идёт вдоль z */
function extent(s: Spot): [number, number] {
  return Math.abs(Math.sin(s.rot)) > 0.5 ? [BODY.width / 2, BODY.length / 2] : [BODY.length / 2, BODY.width / 2];
}

function hits(a: Spot, b: Spot): boolean {
  const [ax, az] = extent(a);
  const [bx, bz] = extent(b);
  return Math.abs(a.x - b.x) < ax + bx + 0.2 && Math.abs(a.z - b.z) < az + bz + 0.2;
}

/** Рядом с линией — дальше стенок камер и печей */
const ASIDE = 4.6;

/** Свободные места рядом, по близости: на линии — сбоку от того же поста, потом за ним; поперёк — соседние ряды */
function* around(s: Spot): Generator<Spot> {
  if (Math.abs(Math.sin(s.rot)) > 0.5) {
    for (let k = 1; k <= 8; k++) for (const d of [k, -k]) yield { ...s, x: s.x + d * 2.7 };
    for (const dz of [5.4, -5.4]) for (let k = 0; k <= 4; k++) for (const d of k ? [k, -k] : [0]) yield { ...s, x: s.x + d * 2.7, z: s.z + dz };
    return;
  }
  for (let j = 0; j <= 8; j++) {
    const x = s.x - j * (BODY.length + 0.5);
    if (j > 0) yield { ...s, x };
    for (const dz of [ASIDE, -ASIDE, ASIDE + 2.4, -ASIDE - 2.4]) yield { ...s, x, z: s.z + dz };
  }
}

export class BodyFlow {
  private bodies = new Map<string, Body>();
  /** Номер экземпляра в InstancedMesh → номер кузова: заполняется в каждом кадре вместе с матрицами */
  private ids: string[] = [];

  constructor(private layout: PlantLayout) {}


  /** Новая раскладка из редактора: машины переезжают с текущих мест на новые, а не появляются заново */
  setLayout(layout: PlantLayout, views: BodyView[], now: number, reducedMotion: boolean) {
    if (layout === this.layout) return;
    this.layout = layout;
    this.update(views, now, reducedMotion);
  }

  /** Новое состояние из данных: кому переехать, кому появиться, кому уйти */
  update(views: BodyView[], now: number, reducedMotion: boolean) {
    const prev = new Map<string, Spot>();
    for (const b of this.bodies.values()) if (!b.dying) prev.set(b.id, b.target);
    const spots = placeBodies(views, this.layout, prev);
    const dur = reducedMotion ? 0 : MOVE_S;
    const seen = new Set<string>();
    const moves: { b: Body; to: Spot }[] = [];
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
      // где машина на самом деле сейчас (сцена могла не рисоваться: скрытая вкладка, «Панель»)
      advance(b, now);
      if (b.dying) {
        b.dying = false;
        b.grow = dur > 0 ? { from: b.scale, to: 1, t0: now, dur: GROW_S } : null;
        if (!b.grow) b.scale = 1;
      }
      if (Math.abs(b.target.x - to.x) > 0.01 || Math.abs(b.target.z - to.z) > 0.01 || b.target.rot !== to.rot) moves.push({ b, to });
    }
    // стоящие машины — препятствия: переезд выбирает путь в обход них
    const moving = new Set(moves.map((m) => m.b.id));
    const still: Spot[] = [];
    for (const b of this.bodies.values()) if (!b.dying && !b.tween && !moving.has(b.id) && b.view.loc.kind !== 'warehouse') still.push(b.target);
    for (const { b, to } of moves) {
      b.target = to;
      const tw = dur > 0 ? clearTween(b, to, now, dur, still) : makeTween(b, to, now, dur);
      const total = tw ? tw.len[tw.len.length - 1]! : Infinity;
      if (!tw || (dur > 0 && total > MAX_GLIDE)) {
        // далеко или не проехать, не задев стоящие машины, — короткое появление на новом месте
        b.x = to.x;
        b.z = to.z;
        b.rot = to.rot;
        b.tween = null;
        if (!b.grow) b.grow = { from: 0.35, to: 1, t0: now, dur: GROW_S };
        continue;
      }
      tw.m0 = dur > 0 && total > 0 ? Math.min(2, (carrySpeed(b.tween, now, tw) * dur) / total) : 0;
      b.tween = tw;
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
    this.ids.length = 0;
    for (const b of [...this.bodies.values()]) {
      if (b.tween) {
        advance(b, now);
        if (b.tween) moving = true;
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
      this.ids[i] = b.id;
      write(i++, b.x, b.z, b.rot, b.scale, b.view);
    }
    return { count: i, moving };
  }

  /** Где кузов сейчас на сцене (для камеры: подлёт и слежение) */
  pose(id: string): { x: number; z: number } | null {
    const b = this.bodies.get(id);
    return b && !b.dying ? { x: b.x, z: b.z } : null;
  }

  has(id: string): boolean {
    return this.bodies.has(id);
  }

  /** Кузов по номеру экземпляра в последнем кадре (наведение и выбор) */
  idAt(index: number): string | null {
    return this.ids[index] ?? null;
  }
}

/**
 * Путь переезда без проезда сквозь оборудование: на стоянку — по линии, затем поперёк; со стоянки —
 * поперёк, затем по линии; между полосами участка — по линии почти до поста, поперёк и на пост;
 * назад по линии (перекраска) и через несколько постов — по проходу сбоку от линии.
 */
function routes(from: Spot, to: Spot): { x: number; z: number }[][] {
  const a = { x: from.x, z: from.z };
  const b = { x: to.x, z: to.z };
  const onLine = Math.abs(from.z - to.z) <= 0.5 && from.rot === 0 && to.rot === 0;
  if (onLine) {
    const detours = [ASIDE, -ASIDE].map((d) => [a, { x: from.x, z: from.z + d }, { x: to.x, z: from.z + d }, b]);
    // вперёд — прямо, если путь свободен; назад (перекраска) — только по проходу сбоку
    return to.x < from.x - 0.5 ? detours : [[a, b], ...detours];
  }
  if (Math.abs(from.z - to.z) <= 0.5 || Math.abs(from.x - to.x) <= 0.5) return [[a, b]];
  const mid = Math.max(from.x, to.x - 2.4);
  const lineFirst = [a, { x: to.x, z: from.z }, b];
  const crossFirst = [a, { x: from.x, z: to.z }, b];
  const viaMid = [a, { x: mid, z: from.z }, { x: mid, z: to.z }, b];
  if (to.rot !== 0) return [lineFirst, crossFirst, viaMid];
  if (from.rot !== 0) return [crossFirst, lineFirst, viaMid];
  return [viaMid, crossFirst, lineFirst];
}

function tweenOf(path: { x: number; z: number }[], from: Spot, to: Spot, now: number, dur: number): Tween {
  const len = [0];
  for (let i = 1; i < path.length; i++) len.push(len[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
  return { path, len, rot0: from.rot, rot1: to.rot, t0: now, dur, m0: 0 };
}

function makeTween(from: Spot, to: Spot, now: number, dur: number): Tween {
  return tweenOf(routes(from, to)[0]!, from, to, now, dur);
}

/** Первый путь, который не проходит сквозь стоящие машины; null — такого нет */
function clearTween(from: Spot, to: Spot, now: number, dur: number, still: Spot[]): Tween | null {
  for (const path of routes(from, to)) {
    const tw = tweenOf(path, from, to, now, dur);
    const total = tw.len[tw.len.length - 1]!;
    let ok = true;
    for (let d = 0.5; ok && d < total - 0.5; d += 0.5) {
      const u = d / total;
      const p = along(tw, u);
      const probe = { x: p.x, z: p.z, rot: tw.rot0 + (tw.rot1 - tw.rot0) * u };
      ok = still.every((s) => !touches(probe, s));
    }
    if (ok) return tw;
  }
  return null;
}

/** Касание при проезде: габариты чуть ужаты — соседние посты и ряды стоянки не считаются */
function touches(a: Spot, b: Spot): boolean {
  const [ax, az] = extent(a);
  const [bx, bz] = extent(b);
  return Math.abs(a.x - b.x) < (ax + bx) * 0.9 && Math.abs(a.z - b.z) < (az + bz) * 0.9;
}

/** Довести положение кузова до момента now по его переезду */
function advance(b: Body, now: number) {
  const tw = b.tween;
  if (!tw) return;
  const t = tw.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - tw.t0) / 1000 / tw.dur));
  const k = t >= 1 ? 1 : progress(t, tw.m0);
  const p = along(tw, k);
  b.x = p.x;
  b.z = p.z;
  b.rot = tw.rot0 + (tw.rot1 - tw.rot0) * k;
  if (t >= 1) b.tween = null;
}

/** Скорость машины (м/с) вдоль начала нового пути: проекция текущей скорости, без разворота назад */
function carrySpeed(tw: Tween | null, now: number, next: Tween): number {
  if (!tw || tw.dur <= 0) return 0;
  const t = (now - tw.t0) / 1000 / tw.dur;
  if (t <= 0 || t >= 1) return 0;
  const total = tw.len[tw.len.length - 1]!;
  const speed = (progressRate(t, tw.m0) * total) / tw.dur;
  const d = progress(t, tw.m0) * total;
  let i = 1;
  while (i < tw.path.length - 1 && d > tw.len[i]!) i++;
  const a = tw.path[i - 1]!;
  const b = tw.path[i]!;
  const n0 = next.path[0]!;
  const n1 = next.path[1] ?? n0;
  const la = Math.hypot(b.x - a.x, b.z - a.z);
  const ln = Math.hypot(n1.x - n0.x, n1.z - n0.z);
  if (la <= 0 || ln <= 0) return 0;
  const cos = ((b.x - a.x) * (n1.x - n0.x) + (b.z - a.z) * (n1.z - n0.z)) / (la * ln);
  return Math.max(0, speed * cos);
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
