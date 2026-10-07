// Где стоят кузова в 3D — только из данных двойника, без своей симуляции:
// · в буферах ровно столько кузовов, сколько в снимке (данные всегда побеждают);
// · кузов уходит с участка, когда растёт счётчик прохода его последнего поста (1С:MES);
// · кузов входит на участок, когда очередь перед ним уменьшилась — так считает и двойник
//   (буфер = кузова, прошедшие последний пост предыдущего участка и ещё не вошедшие на следующий);
// · сварка первая на линии: новые кузова появляются на её входе, пока она работает.
// В буфере кузов стоит на своём месте до выхода (очередь по времени прихода), остальные не перестраиваются.
// Анимация лишь плавно доводит картинку до состояния данных; длительность переезда
// подстраивается под то, как часто реально приходят проходы (×1 на заводе или ×300 на демо).
import type { AreaStatus, BufferId } from '@allur/contracts/ref';
import { PRODUCING, type PlantLayout, type ProducingArea, type SegId, type Spot } from './layout';

export interface FlowInput {
  runId: number;
  shiftKey: string | null;
  status: Record<ProducingArea, AreaStatus>;
  done: Record<ProducingArea | 'finished', number>;
  buffers: Record<BufferId, number>;
}

interface Tween {
  path: { x: number; z: number }[];
  len: number[];
  rot0: number;
  rot1: number;
  t0: number;
  dur: number;
}

interface Body {
  id: number;
  x: number;
  z: number;
  rot: number;
  scale: number;
  tween: Tween | null;
  /** появление/исчезновение: масштаб к цели */
  grow: { from: number; to: number; t0: number; dur: number } | null;
  dying: boolean;
}

const NEXT: Record<ProducingArea, SegId> = { weld: 'weld-paint', paint: 'paint-assembly', assembly: 'assembly-qc', qc: 'finished' };
/** Буфер и участок, в который из него входят кузова */
const FEEDS: [BufferId, ProducingArea][] = [
  ['weld-paint', 'paint'],
  ['paint-assembly', 'assembly'],
  ['assembly-qc', 'qc'],
];
const SEGS: SegId[] = ['weld', 'weld-paint', 'paint', 'paint-assembly', 'assembly', 'assembly-qc', 'qc', 'finished'];
/** Сегменты-стоянки: кузов занимает своё место и не двигается, пока не уедет */
const PARKING = new Set<SegId>(['weld-paint', 'paint-assembly', 'assembly-qc', 'finished']);
/** Сколько выходов с участка анимируем за одно обновление; больше — данные догоняем без переездов */
const MAX_MOVES = 3;
const GROW_S = 0.35;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const onLine = (p: { z: number }) => Math.abs(p.z) < 0.5;

export class FlowModel {
  private bodies = new Map<number, Body>();
  /** Кузова по сегментам по порядку: индекс 0 — первым уйдёт дальше по потоку */
  private segs = {} as Record<SegId, number[]>;
  /** Место кузова на стоянке (буфер, склад ГП) */
  private slots = new Map<number, { seg: SegId; slot: number }>();
  private prevDone: FlowInput['done'] | null = null;
  private runId = -1;
  private shiftKey: string | null = null;
  private nextId = 1;
  /** Средний интервал между проходами, с — под него подстраивается длительность переезда */
  private interval = 4;
  private lastMoveAt = 0;

  constructor(private layout: PlantLayout) {
    for (const s of SEGS) this.segs[s] = [];
  }

  update(input: FlowInput, now: number, reducedMotion: boolean) {
    if (input.runId !== this.runId || !this.prevDone) {
      this.rebuild(input, now);
      return;
    }
    const dur = reducedMotion ? 0 : Math.min(1.6, Math.max(0.35, this.interval * 0.6));
    if (input.shiftKey !== this.shiftKey) {
      // пересменка: счётчики смены обнулились — это не движение кузовов
      this.shiftKey = input.shiftKey;
      this.prevDone = { ...input.done };
    }

    // 1. Выходы: сначала нижние по потоку участки, чтобы освобождённое место сразу было видно
    let moved = false;
    for (const area of [...PRODUCING].reverse()) {
      const n = Math.max(0, input.done[area] - this.prevDone[area]);
      for (let i = 0; i < Math.min(n, MAX_MOVES); i++) {
        this.exit(area, now, dur);
        moved = true;
      }
    }
    this.prevDone = { ...input.done };
    if (moved) {
      if (this.lastMoveAt) this.interval = this.interval * 0.7 + Math.min(30, (now - this.lastMoveAt) / 1000) * 0.3;
      this.lastMoveAt = now;
    }

    // 2. Входы и сверка буферов с данными — сверху вниз по потоку
    for (const [buf, area] of FEEDS) {
      const target = Math.max(0, Math.min(input.buffers[buf] ?? 0, this.layout.segSpots[buf].length));
      const ids = this.segs[buf];
      // очередь в данных короче — первые по времени кузова вошли на участок
      while (ids.length > target) this.enter(buf, area, now, dur);
      // очередь в данных длиннее — кузова появляются на свободных местах
      while (ids.length < target) this.spawnParked(buf, now, dur);
    }

    // 3. Сварка первая на линии: пока работает, на её посты заходят новые кузова
    const weld = input.status.weld;
    if (weld === 'running' || weld === 'degraded_quality') {
      while (this.segs.weld.length < this.layout.segSpots.weld.length) this.spawnAt('weld', this.layout.entry, now, dur);
    }

    this.trimFinished(now, dur);
    this.retarget(now, dur);
  }

  /** Положения кузовов на момент now; moving — пока что-то едет */
  frame(now: number, write: (i: number, x: number, z: number, rot: number, scale: number) => void): { count: number; moving: boolean } {
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
      write(i++, b.x, b.z, b.rot, b.scale);
    }
    return { count: i, moving };
  }

  // ---------------------------------------------------------------------------

  /** Место на посту участка: кузова сдвигаются по постам, как на конвейере */
  private postSpot(seg: SegId, index: number): Spot {
    const spots = this.layout.segSpots[seg];
    return spots[Math.min(index, spots.length - 1)]!;
  }

  /** Место на стоянке: занимает ближайшее к выходу свободное и держит его до отъезда */
  private parkingSpot(seg: SegId, id: number): Spot {
    const spots = this.layout.segSpots[seg];
    let s = this.slots.get(id);
    if (!s || s.seg !== seg) {
      const used = new Set<number>();
      for (const v of this.slots.values()) if (v.seg === seg) used.add(v.slot);
      let k = 0;
      while (used.has(k) && k < spots.length - 1) k++;
      s = { seg, slot: k };
      this.slots.set(id, s);
    }
    return spots[s.slot]!;
  }

  private spotOf(seg: SegId, index: number, id: number): Spot {
    return PARKING.has(seg) ? this.parkingSpot(seg, id) : this.postSpot(seg, index);
  }

  private create(at: Spot, now: number, dur: number): number {
    const id = this.nextId++;
    const grow = dur > 0 ? { from: 0, to: 1, t0: now, dur: GROW_S } : null;
    this.bodies.set(id, { id, x: at.x, z: at.z, rot: at.rot, scale: grow ? 0 : 1, tween: null, grow, dying: false });
    return id;
  }

  /** Новый кузов в точке (вход сварки, пост) — дальше он доедет до своего места */
  private spawnAt(seg: SegId, at: Spot, now: number, dur: number) {
    this.segs[seg].push(this.create(at, now, dur));
  }

  /** Новый кузов сразу на свободном месте стоянки */
  private spawnParked(seg: SegId, now: number, dur: number) {
    const id = this.create({ x: 0, z: 0, rot: 0 }, now, dur);
    this.segs[seg].push(id);
    const at = this.parkingSpot(seg, id);
    const b = this.bodies.get(id)!;
    b.x = at.x;
    b.z = at.z;
    b.rot = at.rot;
  }

  private kill(id: number, now: number, dur: number) {
    this.slots.delete(id);
    const b = this.bodies.get(id);
    if (!b) return;
    if (dur <= 0) {
      this.bodies.delete(id);
      return;
    }
    b.dying = true;
    b.grow = { from: b.scale, to: 0, t0: now, dur: GROW_S };
  }

  /** Кузов прошёл последний пост участка — едет в следующую очередь (или на склад ГП) */
  private exit(area: ProducingArea, now: number, dur: number) {
    let id = this.segs[area].shift();
    if (id === undefined) {
      // в картинке участок был пуст, а проход в данных есть — кузов появляется на последнем посту
      id = this.create(this.postSpot(area, 0), now, dur);
    }
    this.segs[NEXT[area]].push(id);
  }

  /** Первый по времени кузов очереди входит на участок (на первый пост) */
  private enter(buf: BufferId, area: ProducingArea, now: number, dur: number) {
    const id = this.segs[buf].shift();
    if (id === undefined) return;
    this.slots.delete(id);
    this.segs[area].push(id);
    // в картинке на участке уже полно — значит передний кузов на деле ушёл дальше
    if (this.segs[area].length > this.layout.segSpots[area].length) this.exit(area, now, dur);
  }

  private trimFinished(now: number, dur: number) {
    const cap = this.layout.segSpots.finished.length;
    while (this.segs.finished.length > cap) this.kill(this.segs.finished.shift()!, now, dur);
  }

  /** Всем, у кого сменилось место, — плавный переезд */
  private retarget(now: number, dur: number) {
    for (const seg of SEGS) {
      this.segs[seg].forEach((id, index) => {
        const b = this.bodies.get(id);
        if (!b || b.dying) return;
        const to = this.spotOf(seg, index, id);
        const dest = b.tween ? b.tween.path[b.tween.path.length - 1]! : { x: b.x, z: b.z };
        if (Math.abs(dest.x - to.x) < 0.01 && Math.abs(dest.z - to.z) < 0.01) return;
        b.tween = makeTween({ x: b.x, z: b.z, rot: b.rot }, to, now, dur);
      });
    }
  }

  /** С нуля — без анимации: первый показ, новый прогон демо */
  private rebuild(input: FlowInput, now: number) {
    this.bodies.clear();
    this.slots.clear();
    for (const s of SEGS) this.segs[s] = [];
    this.runId = input.runId;
    this.shiftKey = input.shiftKey;
    this.prevDone = { ...input.done };
    for (const area of PRODUCING) {
      // ждущий кузов участок пуст; остальные (даже стоящие) держат кузова на постах
      if (input.status[area] === 'starved') continue;
      for (let i = 0; i < this.layout.segSpots[area].length; i++) this.spawnAt(area, this.postSpot(area, i), now, 0);
    }
    for (const [buf] of FEEDS) {
      const n = Math.min(input.buffers[buf] ?? 0, this.layout.segSpots[buf].length);
      for (let i = 0; i < n; i++) this.spawnParked(buf, now, 0);
    }
    const parked = Math.min(input.done.finished, Math.ceil(this.layout.segSpots.finished.length / 2));
    for (let i = 0; i < parked; i++) this.spawnParked('finished', now, 0);
  }
}

/** Путь переезда: по линии, затем поперёк на место стоянки (и обратно), чтобы не ехать сквозь оборудование */
function makeTween(from: Spot, to: Spot, now: number, dur: number): Tween {
  const path = [{ x: from.x, z: from.z }];
  if (onLine(from) && !onLine(to)) path.push({ x: to.x, z: from.z });
  else if (!onLine(from) && onLine(to)) path.push({ x: from.x, z: to.z });
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
