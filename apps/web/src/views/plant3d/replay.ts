// Повтор истории машины: её реальный маршрут по постам раскладки со временем отметок, ускоренно.
// Время — рабочее (ночь и выходные выпадают), вся история укладывается в одно и то же время показа.
// Где точного времени нет (участок отмечен только входом и выходом), посты получают время
// пропорционально между известными соседями.
import type { BodyDetail, PlantModel, VisualEffect } from '@allur/contracts/ref';
import { addWork, workMs } from '../../state/cars';
import { lookOf, type BodyLook } from '../../state/stages';
import type { PlantLayout, Spot } from './layout';

/** Вся история — за столько секунд показа */
export const REPLAY_SECONDS = 24;

export interface ReplayFrame {
  x: number;
  z: number;
  /** Рабочих мс от начала истории */
  u: number;
  stageId: string;
  look: BodyLook;
}

export interface Replay {
  t0: number;
  /** Рабочих мс во всей истории */
  total: number;
  frames: ReplayFrame[];
}

interface Node {
  x: number;
  z: number;
  t: number | null;
  stageId: string;
  effects: VisualEffect[];
}

export function buildReplay(detail: BodyDetail, layout: PlantLayout, plant: PlantModel): Replay | null {
  const nodes: Node[] = [];
  const effects: VisualEffect[] = [];
  let prevStage = '';
  const passIdx = new Map<string, number>();
  for (const s of detail.route) {
    const done = s.status === 'done' || s.status === 'failed';
    if (!done) continue;
    if (s.effect) effects.push(s.effect);
    let spot: Spot | undefined;
    if (s.operation === 'kit_issued') spot = layout.kitQueue[0];
    else if (s.postId && layout.postSpots[s.postId]) spot = layout.postSpots[s.postId];
    else if (s.stageId === layout.finishedId) spot = layout.segSpots[layout.finishedId]?.[0];
    if (!spot) continue;
    // точное время — у результата операции и выхода со станции; выход участка — общее время для всех
    let t = s.at && (s.by === 'operation' || s.by === 'station_out') ? Date.parse(s.at) : null;
    const key = `${s.stageId}#${s.loop}`;
    if (key !== prevStage) {
      // первый пост прохода участка — время входа участка
      const i = passIdx.get(s.stageId) ?? 0;
      const pass = detail.stages.filter((p) => p.stageId === s.stageId)[i];
      passIdx.set(s.stageId, i + 1);
      if (t === null && pass?.in) t = Date.parse(pass.in);
      prevStage = key;
    }
    nodes.push({ x: spot.x, z: spot.z, t, stageId: s.stageId, effects: [...effects] });
  }
  // выход участка — время последнего поста прохода
  for (const p of detail.stages) {
    if (!p.out) continue;
    const last = [...nodes].reverse().find((n) => n.stageId === p.stageId);
    if (last && last.t === null) last.t = Date.parse(p.out);
  }
  if (nodes.length < 2) return null;
  // неизвестное время — пропорционально между известными соседями
  const known = nodes.map((n, i) => (n.t !== null ? i : -1)).filter((i) => i >= 0);
  if (!known.length) return null;
  nodes.forEach((n, i) => {
    if (n.t !== null) return;
    const a = [...known].reverse().find((k) => k < i);
    const b = known.find((k) => k > i);
    if (a === undefined) n.t = nodes[b!]!.t;
    else if (b === undefined) n.t = nodes[a]!.t;
    else n.t = nodes[a]!.t! + ((nodes[b]!.t! - nodes[a]!.t!) * (i - a)) / (b - a);
  });
  for (let i = 1; i < nodes.length; i++) nodes[i]!.t = Math.max(nodes[i]!.t!, nodes[i - 1]!.t!);
  const t0 = nodes[0]!.t!;
  const color = detail.color?.hex ?? null;
  const frames = nodes.map((n) => ({
    x: n.x,
    z: n.z,
    u: workMs(t0, n.t!),
    stageId: n.stageId,
    look: lookOf(n.effects, color, plant.stageById.get(n.stageId)?.kind ?? ''),
  }));
  const total = frames[frames.length - 1]!.u;
  return total > 0 ? { t0, total, frames } : null;
}

export interface ReplaySample {
  x: number;
  z: number;
  rot: number;
  frame: ReplayFrame;
  /** Время на заводских часах */
  at: number;
}

/** Где копия машины в момент pos (0..1): по линии и поперёк, как ездят кузова */
export function sampleReplay(r: Replay, pos: number, prevRot = 0): ReplaySample {
  const u = Math.max(0, Math.min(1, pos)) * r.total;
  let i = 0;
  while (i < r.frames.length - 2 && r.frames[i + 1]!.u < u) i++;
  const a = r.frames[i]!;
  const b = r.frames[i + 1] ?? a;
  const span = b.u - a.u;
  const f = span > 0 ? Math.min(1, Math.max(0, (u - a.u) / span)) : u <= a.u ? 0 : 1;
  // переезд — по линии потока, потом поперёк (или наоборот со стоянки), как в BodyFlow
  const corner = Math.abs(a.z - b.z) > 0.5 && Math.abs(a.x - b.x) > 0.5 ? (Math.abs(a.z) < 0.5 ? { x: b.x, z: a.z } : { x: a.x, z: b.z }) : null;
  const pts = corner ? [a, corner, b] : [a, b];
  const lens = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k]!.x, p.z - pts[k]!.z));
  const total = lens.reduce((s, l) => s + l, 0);
  let d = f * total;
  let x = b.x;
  let z = b.z;
  let rot = prevRot;
  for (let k = 0; k < lens.length; k++) {
    const p = pts[k]!;
    const q = pts[k + 1]!;
    if (d <= lens[k]! || k === lens.length - 1) {
      const g = lens[k]! > 0 ? d / lens[k]! : 1;
      x = p.x + (q.x - p.x) * g;
      z = p.z + (q.z - p.z) * g;
      if (lens[k]! > 0.01 && f > 0 && f < 1) rot = Math.atan2(-(q.z - p.z), q.x - p.x);
      break;
    }
    d -= lens[k]!;
  }
  return { x, z, rot, frame: f < 0.5 ? a : b, at: addWork(r.t0, u) };
}
