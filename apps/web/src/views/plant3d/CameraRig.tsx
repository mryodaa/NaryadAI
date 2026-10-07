// Камера «как в картах»: левая кнопка (один палец) — перемещение по полу, правая и средняя — вращение
// вокруг точки под курсором, колесо — масштаб к курсору, щипок — масштаб, два пальца — вращение.
// Пресеты «Весь цех», участок, оборудование — плавный подлёт ~1 с; кадр центрируется в свободной от
// плавающих панелей части экрана. Нельзя уйти под пол и перевернуть камеру; вышли за цех — мягкий возврат.
// Автопоказ: медленный облёт, при новом инциденте — подлёт к участку и 5 секунд на нём.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { Box3, MathUtils, Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { AreaId } from '@allur/contracts/ref';
import { backToPlant, pauseFollow, stopFollow, useView } from '../../state/view';
import type { BodyFlow } from './flow';
import { equipmentBox, rectBox, type FrameBox, type PlantLayout } from './layout';
import { setCameraCommands } from './controls';
import { damp, requestAmbient } from './ticker';

const { ACTION } = CameraControlsImpl;

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
/** Наклон: от почти вертикального вида сверху до 70° от вертикали */
const MIN_POLAR = 0.03;
const MAX_POLAR = MathUtils.degToRad(70);
/** Ближе всего — одна машина крупно */
const MIN_DISTANCE = 7;
/** Запас вокруг цеха, в пределах которого цель камеры может свободно ходить */
const SOFT_MARGIN = { x: 14, z: 18 };
/** Дальше этого цель не уходит даже при резком рывке; после отпускания — мягкий возврат в запас */
const HARD_MARGIN = { x: 40, z: 40 };
/** Подлёт к машине: она крупно, видно соседей по линии */
const CAR_DISTANCE = 26;
/** Слежение: ракурс сверху-сбоку, машина и пост вокруг неё */
const FOLLOW_DISTANCE = 34;
const FOLLOW_POLAR = MathUtils.degToRad(50);
/** Перемещение больше этого (px) левой кнопкой или одним пальцем — пользователь ведёт камеру сам */
const PAN_PX = 5;
/** Двойной клик: насколько близко подлетаем к точке */
const FLY_DISTANCE = { min: 16, max: 46 };

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
  return { position: target.clone().addScaledVector(dir, d), target, distance: d };
}

export function CameraRig({
  layout,
  flow,
  area,
  equipment,
  insets,
  tour,
  incidents,
  onUserControl,
}: {
  layout: PlantLayout;
  /** Кузова на сцене: камера подлетает к выбранной машине */
  flow: BodyFlow;
  area: AreaId | null;
  equipment: string | null;
  insets: Insets;
  tour: boolean;
  /** Инциденты на плашках: на новый автопоказ подлетает сам */
  incidents: { id: string; area: AreaId }[];
  onUserControl: () => void;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  /** Пользователь сам повернул или приблизил камеру — не перекадрируем при смене панелей */
  const free = useRef(false);
  const offset = useRef({ x: 0, y: 0, ready: false });
  const first = useRef(true);
  const tourState = useRef({ seen: new Set<string>(), holdUntil: 0, resumeAt: 0, t0: 0 });
  // актуальные значения для команд клавиатуры и обработчиков DOM
  const latest = useRef({ layout, flow, area, equipment, onUserControl });
  latest.current = { layout, flow, area, equipment, onUserControl };

  const safe = () => ({
    w: Math.max(240, size.width - insets.left - insets.right - 150),
    h: Math.max(180, size.height - insets.top - insets.bottom - 48),
  });

  const fly = (shot: Shot, transition: boolean) => {
    const c = controls.current;
    if (!c) return;
    const s = safe();
    const { position, target } = fit(shot, camera.fov, s.w, s.h, size.height);
    // вращение вокруг точки под курсором сдвигает фокус — пресет возвращает камеру к обычному центру
    void c.setFocalOffset(0, 0, 0, transition);
    void c.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, transition);
    invalidate();
  };
  const flyRef = useRef(fly);
  flyRef.current = fly;

  /** Плавно к точке на полу, сохраняя направление взгляда; наклон не круче 55° от вертикали */
  const flyToPoint = (x: number, y: number, z: number, distance: number, polarAt?: number) => {
    const c = controls.current;
    if (!c) return;
    const polar = polarAt ?? Math.min(c.polarAngle, MathUtils.degToRad(55));
    const az = c.azimuthAngle;
    const dir = new Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az));
    void c.setFocalOffset(0, 0, 0, true);
    void c.setLookAt(x + dir.x * distance, y + dir.y * distance, z + dir.z * distance, x, y, z, true);
    invalidate();
  };


  // кнопки, жесты, пределы масштаба и наклона
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.mouseButtons.left = ACTION.SCREEN_PAN;
    c.mouseButtons.right = ACTION.ROTATE;
    c.mouseButtons.middle = ACTION.ROTATE;
    c.mouseButtons.wheel = ACTION.DOLLY;
    c.touches.one = ACTION.TOUCH_SCREEN_PAN;
    c.touches.two = ACTION.TOUCH_DOLLY_ROTATE;
    c.touches.three = ACTION.TOUCH_SCREEN_PAN;
  }, []);

  // самое дальнее — весь цех с запасом
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const s = safe();
    const all = fit(shotOf(layout, null, null), camera.fov, s.w, s.h, size.height);
    c.maxDistance = Math.max(80, all.distance * 1.45);
  }, [layout, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // границы: цель камеры не уходит далеко от цеха; после отпускания — мягкий возврат в пределы цеха
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const b = layout.bounds;
    c.setBoundary(new Box3(new Vector3(b.x0 - HARD_MARGIN.x, 0, b.z0 - HARD_MARGIN.z), new Vector3(b.x1 + HARD_MARGIN.x, 10, b.z1 + HARD_MARGIN.z)));
    const t = new Vector3();
    const onRest = () => {
      c.getTarget(t, true);
      const x = MathUtils.clamp(t.x, b.x0 - SOFT_MARGIN.x, b.x1 + SOFT_MARGIN.x);
      const z = MathUtils.clamp(t.z, b.z0 - SOFT_MARGIN.z, b.z1 + SOFT_MARGIN.z);
      if (Math.abs(x - t.x) > 0.01 || Math.abs(z - t.z) > 0.01) {
        void c.moveTo(x, t.y, z, true);
        invalidate();
      }
    };
    c.addEventListener('rest', onRest);
    return () => c.removeEventListener('rest', onRest);
  }, [layout, invalidate]);

  // вращение вокруг точки под курсором; Shift + колесо — перемещение; щипок на тачпаде — масштаб к курсору
  useEffect(() => {
    const el = gl.domElement;
    const host = el.parentElement;
    if (!host) return;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const floor = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    const floorAt = (clientX: number, clientY: number): Vector3 | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(floor, hit);
    };
    // перемещение левой кнопкой или одним пальцем при слежении — камера дальше у пользователя (пауза)
    const pointers = new Map<number, { x: number; y: number }>();
    const onMove = (e: PointerEvent) => {
      const start = pointers.get(e.pointerId);
      if (!start || pointers.size !== 1) return;
      const f = useView.getState().follow;
      if (f && !f.paused && Math.hypot(e.clientX - start.x, e.clientY - start.y) > PAN_PX) pauseFollow();
    };
    const onUp = (e: PointerEvent) => pointers.delete(e.pointerId);
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = controls.current;
      if (!c || e.pointerType !== 'mouse' || (e.button !== 1 && e.button !== 2)) return;
      // при слежении вращаем вокруг машины, а не вокруг точки под курсором
      const f = useView.getState().follow;
      if (f && !f.paused) return;
      const p = floorAt(e.clientX, e.clientY);
      if (!p) return;
      const b = latest.current.layout.bounds;
      p.x = MathUtils.clamp(p.x, b.x0 - SOFT_MARGIN.x, b.x1 + SOFT_MARGIN.x);
      p.z = MathUtils.clamp(p.z, b.z0 - SOFT_MARGIN.z, b.z1 + SOFT_MARGIN.z);
      const d = p.distanceTo(camera.position);
      if (d < c.minDistance || d > c.maxDistance) return;
      c.setOrbitPoint(p.x, 0, p.z);
    };
    const onWheel = (e: WheelEvent) => {
      const c = controls.current;
      if (!c) return;
      if (e.shiftKey) {
        // перемещение: колесо и прокрутка двумя пальцами (Shift превращает вертикальную прокрутку в горизонтальную)
        e.preventDefault();
        e.stopPropagation();
        const k = (c.distance * Math.tan((camera.fov * Math.PI) / 360) * 2) / Math.max(1, el.clientHeight);
        const dx = e.deltaX;
        const dy = e.deltaX !== 0 && e.deltaY === 0 ? 0 : e.deltaY;
        void c.truck(dx * k, 0, true);
        void c.forward(-dy * k, true);
        free.current = true;
        latest.current.onUserControl();
        invalidate();
        return;
      }
      if (e.ctrlKey) {
        // щипок на тачпаде приходит как колесо с Ctrl: масштаб тем же приближением к курсору, а не зумом объектива
        e.preventDefault();
        e.stopPropagation();
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: e.deltaY * 4, deltaMode: 0, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
        return;
      }
      free.current = true;
      latest.current.onUserControl();
    };
    host.addEventListener('pointerdown', onDown, true);
    host.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      host.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [gl, camera, invalidate]);

  // команды для клавиатуры и двойного клика
  useEffect(() => {
    const touch = () => {
      free.current = true;
      latest.current.onUserControl();
      invalidate();
    };
    const view = () => {
      const c = controls.current!;
      return c.distance * Math.tan((camera.fov * Math.PI) / 360) * 2;
    };
    setCameraCommands({
      flyTo: (x, y, z) => {
        flyToPoint(x, y, z, MathUtils.clamp((controls.current?.distance ?? 60) * 0.45, FLY_DISTANCE.min, FLY_DISTANCE.max));
        touch();
      },
      pan: (right, forward) => {
        const c = controls.current;
        if (!c) return;
        pauseFollow();
        const h = view();
        void c.truck(right * h, 0, true);
        void c.forward(forward * h, true);
        touch();
      },
      rotate: (az) => {
        const c = controls.current;
        if (!c) return;
        void c.rotate(az, 0, true);
        touch();
      },
      zoom: (steps) => {
        const c = controls.current;
        if (!c) return;
        void c.dolly(c.distance * (1 - Math.pow(0.8, steps)), true);
        touch();
      },
      focus: () => {
        const { layout: l, area: a, equipment: e } = latest.current;
        // выбрана машина — к ней, иначе к выбранному участку или оборудованию
        const car = useView.getState().car;
        const p = car ? latest.current.flow.pose(car) : null;
        if (p) {
          flyToPoint(p.x, 0.7, p.z, CAR_DISTANCE);
          touch();
          return;
        }
        free.current = false;
        flyRef.current(shotOf(l, a, e), true);
      },
      frame: () => {
        const { layout: l, area: a, equipment: e } = latest.current;
        free.current = false;
        flyRef.current(shotOf(l, a, e), true);
      },
      home: () => {
        free.current = false;
        backToPlant();
        flyRef.current(shotOf(latest.current.layout, null, null), true);
      },
    });
    return () => setCameraCommands(null);
  }, [camera, invalidate]);

  // выбор участка или оборудования (из 3D, из «Панели», из пресетов) — плавный подлёт
  useEffect(() => {
    free.current = false;
    // участок выбрали в 3D во время слежения — камера летит к участку, слежение на паузе («Вернуться к машине»)
    if (!first.current && useView.getState().mode === '3d') pauseFollow();
    fly(shotOf(layout, area, equipment), !first.current);
    first.current = false;
  }, [area, equipment]); // eslint-disable-line react-hooks/exhaustive-deps

  // свернули или развернули панель, поменялся размер окна — кадрируем заново, если камеру не трогали руками
  useEffect(() => {
    if (!free.current && !first.current) fly(shotOf(layout, area, equipment), true);
  }, [insets.top, insets.right, insets.bottom, insets.left, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // машину нашли поиском — подлетаем к ней (после кадрирования участка: в «Панели» поиск раскрывает и участок)
  const flyCar = useView((v) => v.flyCar);
  useEffect(() => {
    if (!flyCar) return;
    const p = flow.pose(flyCar.bodyId);
    if (!p) return;
    free.current = true;
    flyToPoint(p.x, 0.7, p.z, CAR_DISTANCE);
    onUserControl();
  }, [flyCar]); // eslint-disable-line react-hooks/exhaustive-deps

  // слежение: подлёт к машине в ракурсе сверху-сбоку; колесо приближает к машине, а не к курсору
  const follow = useView((v) => v.follow);
  const following = !!follow && !follow.paused;
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.dollyToCursor = !following;
    if (!following || !follow) return;
    const p = flow.pose(follow.bodyId);
    free.current = true;
    if (p) flyToPoint(p.x, 0.7, p.z, Math.min(Math.max(c.distance, 18), FOLLOW_DISTANCE), FOLLOW_POLAR);
  }, [follow?.bodyId, following]); // eslint-disable-line react-hooks/exhaustive-deps

  // автопоказ: старт — весь цех; новые инциденты — подлёт к участку на 5 секунд
  useEffect(() => {
    const st = tourState.current;
    if (!tour) return;
    stopFollow();
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

  const followAt = useMemo(() => new Vector3(), []);
  useFrame((state, dt) => {
    // слежение: цель камеры плавно идёт за машиной, ракурс и расстояние — как выбрал пользователь
    const f = following && follow ? flow.pose(follow.bodyId) : null;
    const fc = controls.current;
    if (f && fc) {
      fc.getTarget(followAt, true);
      if (Math.abs(followAt.x - f.x) > 0.02 || Math.abs(followAt.z - f.z) > 0.02) void fc.moveTo(f.x, 0.7, f.z, true);
    }

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
      // плавность короткая: камера не «плывёт» после отпускания
      smoothTime={0.22}
      draggingSmoothTime={0.06}
      minDistance={MIN_DISTANCE}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      dollyToCursor
      onControlStart={() => {
        free.current = true;
        onUserControl();
      }}
    />
  );
}
