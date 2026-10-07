// Камера: «Весь цех», участок, оборудование — плавный подлёт ~1 с; нельзя уйти под пол и улететь далеко;
// мышь и сенсорный экран. Кадр центрируется в свободной от плавающих панелей части экрана.
// Автопоказ: медленный облёт, при новом инциденте — подлёт к участку и 5 секунд на нём.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import { Box3, Vector3, type PerspectiveCamera } from 'three';
import type { AreaId } from '@allur/contracts/ref';
import { equipmentBox, rectBox, type FrameBox, type PlantLayout } from './layout';
import { damp, requestAmbient } from './ticker';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Shot {
  box: FrameBox;
  az: number;
  el: number;
}

const ALL_AZ = -0.32;
const ALL_EL = 0.86;
const UP = new Vector3(0, 1, 0);

function shotOf(layout: PlantLayout, area: AreaId | null, equipment: string | null): Shot {
  const e = equipment ? layout.equipment.find((x) => x.id === equipment) : undefined;
  if (e) return { box: equipmentBox(e), az: -0.3, el: 0.6 };
  if (area) return { box: rectBox(layout.zones[area], 4.5), az: -0.2, el: 0.88 };
  return { box: rectBox(layout.bounds, 5), az: ALL_AZ, el: ALL_EL };
}

/** Расстояние, при котором рамка целиком влезает в свободную часть экрана */
function fit(shot: Shot, fovDeg: number, safeW: number, safeH: number, fullH: number) {
  const { box, az, el } = shot;
  const target = new Vector3((box.min[0] + box.max[0]) / 2, box.min[1] + 0.8, (box.min[2] + box.max[2]) / 2);
  const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const forward = dir.clone().negate();
  const right = new Vector3().crossVectors(forward, UP).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const tanY = Math.tan((fovDeg * Math.PI) / 360) * (safeH / fullH);
  const tanX = tanY * (safeW / safeH);
  let d = 4;
  const v = new Vector3();
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        v.set(x, y, z).sub(target);
        const toCam = v.dot(dir);
        d = Math.max(d, Math.abs(v.dot(right)) / tanX + toCam, Math.abs(v.dot(up)) / tanY + toCam);
      }
  d *= 1.1;
  return { position: target.clone().addScaledVector(dir, d), target };
}

export function CameraRig({
  layout,
  area,
  equipment,
  insets,
  tour,
  incidents,
  onUserControl,
}: {
  layout: PlantLayout;
  area: AreaId | null;
  equipment: string | null;
  insets: Insets;
  tour: boolean;
  /** Инциденты на плашках: на новый автопоказ подлетает сам */
  incidents: { id: string; area: AreaId }[];
  onUserControl: () => void;
}) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  /** Пользователь сам повернул или приблизил камеру — не перекадрируем при смене панелей */
  const free = useRef(false);
  const offset = useRef({ x: 0, y: 0, ready: false });
  const first = useRef(true);
  const tourState = useRef({ seen: new Set<string>(), holdUntil: 0, resumeAt: 0, t0: 0 });

  const safe = () => ({
    w: Math.max(240, size.width - insets.left - insets.right - 150),
    h: Math.max(180, size.height - insets.top - insets.bottom - 48),
  });

  const fly = (shot: Shot, transition: boolean) => {
    const c = controls.current;
    if (!c) return;
    const s = safe();
    const { position, target } = fit(shot, camera.fov, s.w, s.h, size.height);
    void c.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, transition);
    invalidate();
  };

  // границы: цель камеры не уходит далеко от цеха, камера — под пол
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const b = layout.bounds;
    c.setBoundary(new Box3(new Vector3(b.x0 - 12, 0, b.z0 - 16), new Vector3(b.x1 + 12, 10, b.z1 + 16)));
  }, [layout]);

  // выбор участка или оборудования (из 3D, из «Панели», из пресетов) — плавный подлёт
  useEffect(() => {
    free.current = false;
    fly(shotOf(layout, area, equipment), !first.current);
    first.current = false;
  }, [area, equipment]); // eslint-disable-line react-hooks/exhaustive-deps

  // свернули или развернули панель, поменялся размер окна — кадрируем заново, если камеру не трогали руками
  useEffect(() => {
    if (!free.current && !first.current) fly(shotOf(layout, area, equipment), true);
  }, [insets.top, insets.right, insets.bottom, insets.left, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // автопоказ: старт — весь цех; новые инциденты — подлёт к участку на 5 секунд
  useEffect(() => {
    const st = tourState.current;
    if (!tour) return;
    st.seen = new Set(incidents.map((i) => i.id));
    st.holdUntil = 0;
    st.resumeAt = performance.now() + 1300;
    free.current = false;
    fly(shotOf(layout, null, null), true);
  }, [tour]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tour) return;
    const st = tourState.current;
    for (const inc of incidents) {
      if (st.seen.has(inc.id)) continue;
      st.seen.add(inc.id);
      fly(shotOf(layout, inc.area, null), true);
      st.holdUntil = performance.now() + 1200 + 5000;
      st.resumeAt = 0;
      break;
    }
  }, [tour, incidents]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((state, dt) => {
    // смещение кадра под свободную область — плавно, без рывка при сворачивании панелей
    const o = offset.current;
    const tx = (insets.right - insets.left) / 2;
    const ty = (insets.bottom - insets.top) / 2;
    const stale = !camera.view || camera.view.fullWidth !== size.width || camera.view.fullHeight !== size.height;
    if (stale || Math.abs(o.x - tx) > 0.25 || Math.abs(o.y - ty) > 0.25 || !o.ready) {
      o.x = o.ready ? damp(o.x, tx, 7, dt) : tx;
      o.y = o.ready ? damp(o.y, ty, 7, dt) : ty;
      if (Math.abs(o.x - tx) < 0.25) o.x = tx;
      if (Math.abs(o.y - ty) < 0.25) o.y = ty;
      o.ready = true;
      camera.setViewOffset(size.width, size.height, o.x, o.y, size.width, size.height);
      camera.updateProjectionMatrix();
      state.invalidate();
    }

    if (!tour) return;
    const st = tourState.current;
    const c = controls.current;
    if (!c) return;
    const now = performance.now();
    if (st.holdUntil) {
      if (now < st.holdUntil) {
        requestAmbient(state.invalidate);
        return;
      }
      st.holdUntil = 0;
      st.resumeAt = now + 1300;
      fly(shotOf(layout, null, null), true);
    }
    if (st.resumeAt && now < st.resumeAt) {
      requestAmbient(state.invalidate);
      return;
    }
    if (st.resumeAt) {
      st.resumeAt = 0;
      st.t0 = state.clock.elapsedTime;
    }
    // медленный облёт: качание по азимуту вокруг общего плана, линия потока остаётся слева направо
    const t = state.clock.elapsedTime - st.t0;
    void c.rotateTo(ALL_AZ + 0.34 * Math.sin(t * 0.12), Math.PI / 2 - ALL_EL + 0.06 * Math.sin(t * 0.07), false);
    requestAmbient(state.invalidate);
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.32}
      draggingSmoothTime={0.12}
      minDistance={7}
      maxDistance={330}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI * 0.45}
      dollyToCursor
      onControlStart={() => {
        free.current = true;
        onUserControl();
      }}
    />
  );
}
