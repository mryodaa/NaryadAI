// Путь машины по цеху: на полу линия её маршрута по раскладке. Пройденное — сплошной линией,
// впереди — пунктиром, текущее место — пульсирующая точка; петли перекраски и выборочный контроль
// (лаборатория, полировка, полигон) — отдельной дугой над полом.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Mesh } from 'three';
import type { BodyDetail } from '@allur/contracts/ref';
import { FLOOR_Y, type PlantLayout, type Spot } from './layout';
import type { BodyFlow } from './flow';
import { requestAmbient } from './ticker';

const PATH = '#2b5fd9';
const LOOP = '#d97706';
const Y = FLOOR_Y + 0.25;
/** Высота дуги петли над полом: не ниже оборудования, длинный прыжок — выше */
const ARC = 3;

type P = [number, number, number];

interface Node {
  x: number;
  z: number;
  past: boolean;
  /** Выборочный контроль в стороне от потока (лаборатория, полировка, полигон) */
  side: boolean;
  /** Повторный проход (перекраска) */
  repeat: boolean;
}

/** Маршрут машины по постам раскладки: склад, посты операций, склад готовой продукции */
function nodesOf(detail: BodyDetail, layout: PlantLayout): Node[] {
  const out: Node[] = [];
  const add = (s: Spot | undefined, past: boolean, side: boolean, repeat: boolean) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - s.x) < 0.3 && Math.abs(last.z - s.z) < 0.3) {
      last.past ||= past;
      return;
    }
    out.push({ x: s.x, z: s.z, past, side, repeat });
  };
  for (const s of detail.route) {
    const done = s.status === 'done' || s.status === 'failed';
    // выборочные операции, которых не было, на путь не попадают
    if (s.optional && !done && s.status !== 'in_progress') continue;
    let spot: Spot | undefined;
    if (s.operation === 'kit_issued') spot = layout.kitQueue[0];
    else if (s.postId && layout.postSpots[s.postId]) spot = layout.postSpots[s.postId];
    else if (s.stageId === layout.finishedId) spot = layout.segSpots[layout.finishedId]?.[0];
    add(spot, done, s.optional, s.loop > 0);
  }
  return out;
}

/** Переезд как у кузовов: по линии и поперёк, не наискосок через оборудование */
function leg(a: Node, b: Node): P[] {
  const pts: P[] = [[a.x, Y, a.z]];
  if (Math.abs(a.z - b.z) > 0.5 && Math.abs(a.x - b.x) > 0.5) pts.push(Math.abs(a.z) < 0.5 ? [b.x, Y, a.z] : [a.x, Y, b.z]);
  pts.push([b.x, Y, b.z]);
  return pts;
}

/** Дуга над полом — ответвление петли */
function arc(a: Node, b: Node): P[] {
  const pts: P[] = [];
  const h = Math.max(ARC, Math.hypot(b.x - a.x, b.z - a.z) * 0.3);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push([a.x + (b.x - a.x) * t, Y + h * 4 * t * (1 - t), a.z + (b.z - a.z) * t]);
  }
  return pts;
}

/** Ломаная → пары точек (Line с segments) */
function pairs(poly: P[], out: P[]) {
  for (let i = 1; i < poly.length; i++) out.push(poly[i - 1]!, poly[i]!);
}

export function CarPath({ detail, layout, flow }: { detail: BodyDetail; layout: PlantLayout; flow: BodyFlow }) {
  // пересчитываем, только когда меняются статусы маршрута (новый объект приходит каждые 3 секунды)
  const signature = detail.route.map((s) => `${s.postId}:${s.status[0]}${s.loop}`).join('|');
  const lines = useMemo(() => {
    const nodes = nodesOf(detail, layout);
    const past: P[] = [];
    const future: P[] = [];
    const loopPast: P[] = [];
    const loopFuture: P[] = [];
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!;
      const b = nodes[i]!;
      const done = b.past;
      // дугой — уход на выборочный контроль и возврат, прыжок назад на перекраску; сам повторный проход — оранжевым
      const jump = b.side || a.side || (b.repeat && !a.repeat);
      if (jump) pairs(arc(a, b), done ? loopPast : loopFuture);
      else if (b.repeat) pairs(leg(a, b), done ? loopPast : loopFuture);
      else pairs(leg(a, b), done ? past : future);
    }
    return { past, future, loopPast, loopFuture };
  }, [signature, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const dot = useRef<Mesh>(null);
  const ring = useRef<Mesh>(null);
  useFrame((state) => {
    const p = flow.pose(detail.bodyId);
    const t = state.clock.elapsedTime;
    for (const m of [dot.current, ring.current]) {
      if (!m) continue;
      m.visible = !!p;
      if (p) m.position.set(p.x, Y + 0.05, p.z);
    }
    if (ring.current && p) {
      const k = 1 + ((t * 0.9) % 1) * 1.6;
      ring.current.scale.set(k, k, k);
      (ring.current.material as { opacity: number }).opacity = 0.55 * (1 - ((t * 0.9) % 1));
      requestAmbient(state.invalidate);
    }
  });

  return (
    <group>
      {lines.past.length > 0 && <Line points={lines.past} segments color={PATH} lineWidth={5} depthTest={false} renderOrder={5} />}
      {lines.future.length > 0 && <Line points={lines.future} segments color={PATH} lineWidth={3} dashed dashSize={1.1} gapSize={0.8} transparent opacity={0.75} depthTest={false} renderOrder={5} />}
      {lines.loopPast.length > 0 && <Line points={lines.loopPast} segments color={LOOP} lineWidth={4} depthTest={false} renderOrder={6} />}
      {lines.loopFuture.length > 0 && <Line points={lines.loopFuture} segments color={LOOP} lineWidth={3} dashed dashSize={0.8} gapSize={0.6} depthTest={false} renderOrder={6} />}
      <mesh ref={dot} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[1.1, 32]} />
        <meshBasicMaterial color={PATH} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[1.2, 1.6, 40]} />
        <meshBasicMaterial color={PATH} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}
