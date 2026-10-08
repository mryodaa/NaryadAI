// Сцена цеха: пол, зоны участков с контуром статуса, буферы, оборудование, кузова, плашки.
// Состояние — только из данных двойника; переходы цвета и положения плавные.
import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Grid, Html, Line } from '@react-three/drei';
import { BackSide, Color, MeshBasicMaterial, MeshStandardMaterial, Object3D, type InstancedMesh, type Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Activity, Clock, Video, Wrench } from 'lucide-react';
import { CAMERAS, MODEL_BY_ID, type AreaId, type BodyDetail, type BufferView, type Tone } from '@allur/contracts/ref';
import { openIncident } from '../../state/view';
import { TONE_CLASS, TONE_ICON, cx } from '../../lib/tones';
import { BODY, FLOOR_Y, type PlantLayout, type Rect } from './layout';
import type { Palette } from './palette';
import type { BodyFlow } from './flow';
import { bodyTint } from './bodyLook';
import type { Plaque, SceneData } from './useSceneData';
import { EquipmentModel, FinishedContent, GhostFader, WarehouseContent, useMaterials, type HoverTarget } from './equipment';
import { damp, requestAmbient } from './ticker';
import { cameraCommands, isClick } from './controls';
import { useHover } from './hover';
import { CarPath } from './CarPath';
import { ReplayGhost } from './ReplayGhost';
import type { Replay } from './replay';
import { useView } from '../../state/view';
import { filtersActive, matchesFilters } from '../../state/search';
import { useTranslation } from '../../i18n/store';
import { translateArea, translateDynamicText, translateStatus } from '../../i18n/translator';

const MAX_BODIES = 160;
/** Слои подписей: плашки поверх подписей зон, всё — ниже плавающих панелей интерфейса */
const Z_LABEL: [number, number] = [20, 10];
const Z_PLAQUE: [number, number] = [40, 21];

type Portal = RefObject<HTMLElement | null>;

export interface SceneProps {
  layout: PlantLayout;
  palette: Palette;
  data: SceneData;
  buffers: BufferView[];
  stage: 0 | 1 | 2;
  flow: BodyFlow;
  focusArea: AreaId | null;
  reducedMotion: boolean;
  /** Постоянный слой для подписей поверх холста: подписи не пересоздаются при старте сцены */
  portal: Portal;
  /** Путь машины по цеху: маршрут из трекера */
  pathDetail: BodyDetail | null;
  /** Повтор истории машины: полупрозрачная копия проезжает её путь */
  replay?: Replay | null;
  stageName?: (id: string) => string;
  /** Выбранная и наведённая машины — подсвечены поверх экземпляра */
  selectedCar: string | null;
  onHover: (t: HoverTarget | null) => void;
  onPick: (area: AreaId, equipmentId: string | null) => void;
  onPickCar: (bodyId: string) => void;
}

export function Scene(props: SceneProps) {
  const { layout, palette, data, stage, flow, focusArea, reducedMotion, portal, onHover, onPick } = props;
  const { t, lang } = useTranslation();
  const mats = useMaterials(palette);
  const live = data.plcConnected && stage >= 1;
  const b = layout.bounds;
  const midX = (b.x0 + b.x1) / 2;
  const width = b.x1 - b.x0;
  return (
    <>
      <color attach="background" args={[palette.background]} />
      {/* двойной клик по полу, участку, оборудованию или машине — плавно приблизиться к этой точке */}
      <group
        onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          cameraCommands()?.flyTo(e.point.x, Math.min(e.point.y, 2), e.point.z);
        }}
      >
        <hemisphereLight args={['#ffffff', '#e3e7ec', 2.1]} />
        <directionalLight position={[midX - 50, 80, 60]} intensity={1.5} />

        <mesh position={[midX, 0, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[1800, 1800]} />
          <meshBasicMaterial color={palette.floor} />
        </mesh>
        <Grid
          position={[midX, 0.004, 0]}
          args={[width + 160, 160]}
          cellSize={2}
          cellThickness={0.6}
          cellColor={palette.grid}
          sectionSize={10}
          sectionThickness={1}
          sectionColor={palette.gridSection}
          fadeDistance={300}
          fadeStrength={1.6}
        />
        {/* разметка проходов вдоль линии */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[midX, 0.008, s * (layout.bounds.z1 + 1.3)]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[width + 8, 0.34]} />
            <meshBasicMaterial color={palette.aisle} />
          </mesh>
        ))}

        {layout.stages.map(({ id: area }, i) => (
          <Zone
            key={area}
            id={area}
            rect={layout.zones[area]}
            name={translateArea(area, lang, 'name') || data.rows[area]?.name || area}
            tone={data.rows[area]?.status.tone ?? 'neutral'}
            statusLabel={data.rows[area]?.check === 'signal' ? t.crew.signalUnverified : translateStatus(data.rows[area]?.status.label ?? '', lang)}
            unverified={data.rows[area]?.check === 'signal'}
            selected={focusArea === area}
            dimmed={focusArea !== null && focusArea !== area}
            labelY={i % 2 ? 10.2 : 7.6}
            palette={palette}
            reducedMotion={reducedMotion}
            portal={portal}
            onHover={onHover}
            onPick={onPick}
          />
        ))}

        <LaneMarkings layout={layout} palette={palette} />
        <LaneLabels layout={layout} focusArea={focusArea} portal={portal} />

        {props.buffers.map((buf) => (
          <BufferPad key={buf.id} rect={layout.buffers[buf.id]} buf={buf} palette={palette} portal={portal} onHover={onHover} />
        ))}

        <GhostFader mats={mats} palette={palette} ghost={!live} />
        {layout.equipment.map((place) => (
          <EquipmentModel
            key={place.id}
            place={place}
            view={data.equipment[place.id]}
            mats={mats}
            palette={palette}
            layout={layout}
            live={live}
            reducedMotion={reducedMotion}
            onHover={onHover}
            onPick={onPick}
          />
        ))}
        <WarehouseContent layout={layout} stock={data.stock} mats={mats} palette={palette} />
        <FinishedContent layout={layout} mats={mats} />

        <Bodies flow={flow} selected={props.selectedCar} onHover={onHover} onPick={props.onPickCar} />
        {props.pathDetail && <CarPath detail={props.pathDetail} layout={layout} flow={flow} />}
        {props.replay && props.stageName && <ReplayGhost replay={props.replay} stageName={props.stageName} portal={portal} />}

        <Plaques layout={layout} data={data} portal={portal} />
        {stage >= 1 && <CameraIcons layout={layout} portal={portal} />}
        {stage >= 2 && <SensorBadges layout={layout} data={data} portal={portal} onHover={onHover} />}

        <Shadows x={midX} width={width} />
      </group>
    </>
  );
}

/**
 * Мягкие тени считаются один раз. Отдельный неизменяемый компонент: у drei ContactShadows массив scale —
 * в зависимостях, и перерисовка сцены на каждый снимок пересоздавала бы его текстуры (утечка видеопамяти).
 */
const Shadows = memo(function Shadows({ x, width }: { x: number; width: number }) {
  const scale = useMemo<[number, number]>(() => [width + 30, 50], [width]);
  return <ContactShadows position={[x, 0.01, 0]} scale={scale} resolution={1024} blur={3} far={5} opacity={0.22} frames={1} color="#3d4652" />;
});

// ---------------------------------------------------------------------------
// Зона участка: платформа, низкие полупрозрачные стены, контур цвета статуса, подпись

const Zone = memo(function Zone({
  id,
  rect,
  name,
  tone,
  statusLabel,
  unverified,
  selected,
  dimmed,
  labelY,
  palette,
  reducedMotion,
  portal,
  onHover,
  onPick,
}: {
  id: AreaId;
  rect: Rect;
  name: string;
  tone: Tone;
  statusLabel: string;
  /** Отклонение только по сигналу одного источника — контур пунктиром */
  unverified: boolean;
  selected: boolean;
  /** выбран другой участок — подпись этой зоны не нужна в кадре */
  dimmed: boolean;
  labelY: number;
  palette: Palette;
  reducedMotion: boolean;
  portal: Portal;
  onHover: (t: HoverTarget | null) => void;
  onPick: (area: AreaId, equipmentId: string | null) => void;
}) {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const midX = (rect.x0 + rect.x1) / 2;
  const midZ = (rect.z0 + rect.z1) / 2;
  const deviation = tone !== 'neutral';
  const wall = useMemo(() => new MeshStandardMaterial({ color: palette.wall, transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.9 }), [palette]);
  const lineRef = useRef<{ material: { color: Color; opacity: number; linewidth: number } } | null>(null);
  // начальный цвет контура задаём один раз — дальше он плавно меняется в кадре
  const initial = useMemo(() => '#' + (deviation ? palette.tone[tone] : palette.edge).getHexString(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const wallTarget = useMemo(() => new Color(), []);
  const lineTarget = useMemo(() => new Color(), []);
  const accent = useMemo(() => new Color('#2b5fd9'), []);
  // точки контура — один раз: новый массив на каждый снимок заставлял бы drei пересоздавать линию и её шейдер
  const outline = useMemo<[number, number, number][]>(() => {
    const y = FLOOR_Y + 0.03;
    return [
      [rect.x0, y, rect.z0],
      [rect.x1, y, rect.z0],
      [rect.x1, y, rect.z1],
      [rect.x0, y, rect.z1],
      [rect.x0, y, rect.z0],
    ];
  }, [rect]);

  useFrame((state, dt) => {
    const line = lineRef.current;
    if (!line) return;
    wallTarget.copy(deviation ? palette.tone[tone] : palette.wall);
    lineTarget.copy(deviation ? palette.tone[tone] : selected ? accent : palette.edge);
    const k = 1 - Math.exp(-5 * Math.min(dt, 0.1));
    const beforeWall = wall.color.getHex();
    const beforeLine = line.material.color.getHex();
    const beforeWidth = line.material.linewidth;
    wall.color.lerp(wallTarget, k);
    wall.opacity = damp(wall.opacity, deviation ? 0.42 : 0.28, 5, dt);
    line.material.color.lerp(lineTarget, k);
    line.material.linewidth = damp(line.material.linewidth, selected ? 5 : deviation ? 3.6 : 1.4, 6, dt);
    // авария — мягкая пульсация контура, не мигание; при «уменьшить движение» — без неё
    const pulse = tone === 'fault' && !reducedMotion;
    line.material.opacity = pulse ? 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 2.4)) : 1;
    if (pulse) requestAmbient(state.invalidate);
    else if (wall.color.getHex() !== beforeWall || line.material.color.getHex() !== beforeLine || Math.abs(line.material.linewidth - beforeWidth) > 0.01) state.invalidate();
  });

  const Icon = TONE_ICON[tone];
  const walls: [number, number, number, number][] = [
    [midX, rect.z0 + 0.06, w, 0.12],
    [midX, rect.z1 - 0.06, w, 0.12],
    [rect.x0 + 0.06, midZ, 0.12, d],
    [rect.x1 - 0.06, midZ, 0.12, d],
  ];
  return (
    <group>
      <mesh
        position={[midX, FLOOR_Y / 2, midZ]}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover({ kind: 'zone', id });
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!isClick(e.nativeEvent)) return;
          e.stopPropagation();
          onPick(id, null);
        }}
      >
        <boxGeometry args={[w, FLOOR_Y, d]} />
        <meshBasicMaterial color={palette.platform} />
      </mesh>
      {walls.map(([x, z, sx, sz], i) => (
        <mesh key={i} position={[x, FLOOR_Y + 0.45, z]} material={wall}>
          <boxGeometry args={[sx, 0.9, sz]} />
        </mesh>
      ))}
      {unverified ? (
        <Line ref={lineRef as never} points={outline} color={initial} lineWidth={1.4} transparent dashed dashSize={1.6} gapSize={1.1} />
      ) : (
        <Line ref={lineRef as never} points={outline} color={initial} lineWidth={1.4} transparent />
      )}
      {!dimmed && (
      <Html portal={portal as never} position={[midX, labelY, rect.z0 + 0.6]} center zIndexRange={Z_LABEL} pointerEvents="none">
        <div className="flex select-none flex-col items-center gap-1">
          <span className={cx('max-w-[9.5rem] rounded-lg px-2.5 py-1 text-center text-base font-semibold leading-tight shadow-card transition-colors', selected ? 'bg-ink text-white' : 'bg-surface/95 text-ink')}>
            {name}
          </span>
          {deviation && (
            <span className={cx('view-in inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-sm font-semibold shadow-card', TONE_CLASS[tone].bg, TONE_CLASS[tone].ink)}>
              <Icon className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              {statusLabel}
            </span>
          )}
        </div>
      </Html>
      )}
    </group>
  );
});

// ---------------------------------------------------------------------------
// Разметка полос на полу: линии расходятся с общего входа и сходятся в общий выход участка

const MARK = 0.3;

const LaneMarkings = memo(function LaneMarkings({ layout, palette }: { layout: PlantLayout; palette: Palette }) {
  const strips = useMemo(() => {
    const out: { key: string; x: number; z: number; w: number; d: number }[] = [];
    const hx = (key: string, x0: number, x1: number, z: number) => x1 > x0 && out.push({ key, x: (x0 + x1) / 2, z, w: x1 - x0, d: MARK });
    const vz = (key: string, x: number, z0: number, z1: number) => z1 > z0 && out.push({ key, x, z: (z0 + z1) / 2, w: MARK, d: z1 - z0 + MARK });
    for (const [area, pipe] of Object.entries(layout.pipes)) {
      if (pipe.lanes.length < 2) continue;
      const zs = pipe.lanes.map((l) => l.z);
      const split = pipe.inlet.length ? pipe.lanes[0]!.x0 - 0.6 : null;
      const merge = Math.max(...pipe.lanes.map((l) => l.x1)) + 0.6;
      for (const l of pipe.lanes) hx(`${area}-${l.stationId}`, split ?? l.entry.x, merge, l.z);
      vz(`${area}-merge`, merge, Math.min(...zs), Math.max(...zs));
      if (split !== null) vz(`${area}-split`, split, Math.min(...zs), Math.max(...zs));
      const out0 = pipe.outlet[0];
      if (out0) hx(`${area}-out`, merge, out0.x, 0);
    }
    return out;
  }, [layout]);
  const material = useMemo(() => new MeshBasicMaterial({ color: palette.aisle }), [palette]);
  return (
    <group position-y={FLOOR_Y + 0.006}>
      {strips.map((st) => (
        <mesh key={st.key} position={[st.x, 0, st.z]} rotation-x={-Math.PI / 2} material={material}>
          <planeGeometry args={[st.w, st.d]} />
        </mesh>
      ))}
    </group>
  );
});

// ---------------------------------------------------------------------------
// Подписи полос участка с параллельными станциями: «Onix», «Cobalt», «J7» у входа каждой линии

const LaneLabels = memo(function LaneLabels({ layout, focusArea, portal }: { layout: PlantLayout; focusArea: AreaId | null; portal: Portal }) {
  const items = useMemo(
    () =>
      Object.entries(layout.pipes).flatMap(([area, pipe]) =>
        pipe.lanes.length < 2
          ? []
          : pipe.lanes.map((l) => ({
              key: `${area}-${l.stationId}`,
              area,
              // линия под одну модель — подписываем моделью, иначе — названием станции
              text: l.models?.length === 1 ? MODEL_BY_ID[l.models[0]!].short : l.name,
              title: `${l.name}${l.models ? ` — ${l.models.map((m) => MODEL_BY_ID[m].name).join(', ')}` : ''}`,
              at: [l.x0 - 2.2, 0.5, l.z] as [number, number, number],
            })),
      ),
    [layout],
  );
  return (
    <>
      {items.map((it) =>
        focusArea !== null && focusArea !== it.area ? null : (
          <Html key={it.key} portal={portal as never} position={it.at} center zIndexRange={Z_LABEL} pointerEvents="none">
            <span title={it.title} className="select-none whitespace-nowrap rounded-md bg-surface/95 px-1.5 py-0.5 text-sm font-semibold text-ink-2 shadow-card ring-1 ring-line">
              {it.text}
            </span>
          </Html>
        ),
      )}
    </>
  );
});

// ---------------------------------------------------------------------------
// Буфер между участками: площадка и число кузовов — те же цифры, что в «Панели»

const BufferPad = memo(
  function BufferPad({ rect, buf, palette, portal, onHover }: { rect: Rect; buf: BufferView; palette: Palette; portal: Portal; onHover: (t: HoverTarget | null) => void }) {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const midX = (rect.x0 + rect.x1) / 2;
  const midZ = (rect.z0 + rect.z1) / 2;
  const full = buf.count >= buf.capacity;
  const empty = buf.count === 0;
  const outline = useMemo<[number, number, number][]>(
    () => [
      [rect.x0, 0.03, rect.z0],
      [rect.x1, 0.03, rect.z0],
      [rect.x1, 0.03, rect.z1],
      [rect.x0, 0.03, rect.z1],
      [rect.x0, 0.03, rect.z0],
    ],
    [rect],
  );
  const edge = useMemo(() => '#' + palette.edge.getHexString(), [palette]);
  const { lang } = useTranslation();
  const fullLabel = lang === 'kk' ? ' · толы' : lang === 'en' ? ' · full' : ' · полон';
  const emptyLabel = lang === 'kk' ? ' · бос' : lang === 'en' ? ' · empty' : ' · пуст';
  const ofWord = lang === 'kk' ? '/' : lang === 'en' ? 'of' : 'из';
  return (
    <group>
      <mesh
        position={[midX, 0.012, midZ]}
        rotation-x={-Math.PI / 2}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover({ kind: 'buffer', id: buf.id });
        }}
        onPointerOut={() => onHover(null)}
      >
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={palette.pad} />
      </mesh>
      <Line
        points={outline}
        color={edge}
        lineWidth={1}
        dashed
        dashSize={0.8}
        gapSize={0.6}
      />
      <Html portal={portal as never} position={[midX, 0.3, rect.z1 + 1.2]} center zIndexRange={Z_LABEL} pointerEvents="none">
        <span
          className={cx(
            'num select-none whitespace-nowrap rounded-md px-1.5 py-0.5 text-sm font-semibold shadow-card',
            full || empty ? cx(TONE_CLASS.waiting.bg, TONE_CLASS.waiting.ink) : 'bg-surface/95 text-ink-2',
          )}
        >
          {buf.count} {ofWord} {buf.capacity}
          {full ? fullLabel : empty ? emptyLabel : ''}
        </span>
      </Html>
    </group>
  );
  },
  // снимок приходит 4 раза в секунду с новым объектом буфера — перерисовываем, только если изменилось число
  (a, b) => a.rect === b.rect && a.palette === b.palette && a.portal === b.portal && a.onHover === b.onHover && a.buf.count === b.buf.count && a.buf.capacity === b.buf.capacity && a.buf.id === b.buf.id,
);

// ---------------------------------------------------------------------------
// Кузова: один InstancedMesh, у каждого экземпляра свой цвет — вид кузова по выполненным операциям
// (голый металл, катафорез, грунт, цвет заказа); машинокомплект на складе — низкая паллета

const SELECT_COLOR = '#2b5fd9';
/** Приглушённая машина при включённом фильтре — почти цвет пола */
const DIM_COLOR = new Color('#e4e8ed');

function Bodies({
  flow,
  selected,
  onHover,
  onPick,
}: {
  flow: BodyFlow;
  selected: string | null;
  onHover: (t: HoverTarget | null) => void;
  onPick: (bodyId: string) => void;
}) {
  const ref = useRef<InstancedMesh>(null);
  const selRef = useRef<Mesh>(null);
  const hovRef = useRef<Mesh>(null);
  const pinRef = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const hovered = useHover((h) => (h.target?.kind === 'body' ? h.target.id : null));
  const filters = useView((v) => v.filters);
  const matchRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new RoundedBoxGeometry(BODY.length, BODY.height, BODY.width, 2, 0.42), []);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.1 }), []);
  // подсветка — увеличенный полупрозрачный дубль кузова изнутри наружу: читается как контур, без постобработки
  const selMat = useMemo(() => new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.85, side: BackSide, depthWrite: false }), []);
  const hovMat = useMemo(() => new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.45, side: BackSide, depthWrite: false }), []);
  const matchMat = useMemo(() => new MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.5, side: BackSide, depthWrite: false }), []);
  const dummy = useMemo(() => new Object3D(), []);
  const ring = useMemo(() => new Object3D(), []);
  const tint = useMemo(() => new Color(), []);
  useEffect(() => invalidate(), [selected, hovered, filters, invalidate]);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    let sel = false;
    let hov = false;
    const filtering = filtersActive(filters);
    const match = matchRef.current;
    let matched = 0;
    const outline = (m: Mesh | null, k: number) => {
      if (!m) return;
      m.position.copy(dummy.position);
      m.rotation.copy(dummy.rotation);
      m.scale.copy(dummy.scale).multiplyScalar(k);
    };
    const { count, moving } = flow.frame(performance.now(), (i, x, z, rot, s, view) => {
      if (i >= MAX_BODIES) return;
      const k = Math.max(0.001, s);
      const kit = view.loc.kind === 'warehouse';
      const h = kit ? 0.55 : BODY.height;
      dummy.position.set(x, FLOOR_Y + (h / 2) * k, z);
      dummy.rotation.set(0, rot, 0);
      if (kit) dummy.scale.set(0.62 * k, 0.4 * k, 0.75 * k);
      else dummy.scale.setScalar(k);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const color = bodyTint(view, tint);
      if (filtering) {
        if (matchesFilters(view, filters)) {
          // подходящая под фильтр — обведена
          if (match) {
            ring.position.copy(dummy.position);
            ring.rotation.copy(dummy.rotation);
            ring.scale.copy(dummy.scale).multiplyScalar(1.12);
            ring.updateMatrix();
            match.setMatrixAt(matched++, ring.matrix);
          }
        } else color.lerp(DIM_COLOR, 0.6);
      }
      mesh.setColorAt(i, color);
      if (view.bodyId === selected) {
        sel = true;
        outline(selRef.current, 1.18);
        pinRef.current?.position.set(x, FLOOR_Y + h * k + 2.2, z);
      } else if (view.bodyId === hovered) {
        hov = true;
        outline(hovRef.current, 1.12);
      }
    });
    if (selRef.current) selRef.current.visible = sel;
    if (pinRef.current) pinRef.current.visible = sel;
    if (hovRef.current) hovRef.current.visible = hov;
    if (match) {
      match.count = matched;
      match.instanceMatrix.needsUpdate = true;
    }
    mesh.count = Math.min(count, MAX_BODIES);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (moving) state.invalidate();
  });
  return (
    <>
      <instancedMesh
        ref={ref}
        args={[geometry, material, MAX_BODIES]}
        frustumCulled={false}
        userData={{ cars: true }}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (e.instanceId === undefined) return;
          const id = flow.idAt(e.instanceId);
          if (!id) return;
          e.stopPropagation();
          onHover({ kind: 'body', id });
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (e.instanceId === undefined || !isClick(e.nativeEvent)) return;
          const id = flow.idAt(e.instanceId);
          if (!id) return;
          e.stopPropagation();
          onPick(id);
        }}
      />
      <instancedMesh ref={matchRef} args={[geometry, matchMat, MAX_BODIES]} count={0} frustumCulled={false} raycast={() => null} />
      <mesh ref={selRef} geometry={geometry} material={selMat} visible={false} raycast={() => null} />
      <mesh ref={hovRef} geometry={geometry} material={hovMat} visible={false} raycast={() => null} />
      {/* метка над выбранной машиной — видна и на общем плане цеха */}
      <mesh ref={pinRef} visible={false} rotation-x={Math.PI} raycast={() => null}>
        <coneGeometry args={[0.7, 1.6, 20]} />
        <meshStandardMaterial color={SELECT_COLOR} emissive={SELECT_COLOR} emissiveIntensity={0.35} />
      </mesh>
    </>
  );
}

// ---------------------------------------------------------------------------
// Плашки: проблемы (не больше трёх — как «Требует внимания») и принятые решения

function anchorOf(layout: PlantLayout, area: AreaId, equipmentId: string | undefined): [number, number, number] {
  const e = equipmentId ? layout.equipment.find((x) => x.id === equipmentId) : undefined;
  if (e) return [e.span ? e.span[0] + 1.2 : e.x, FLOOR_Y + e.height + 2.2, e.z + 3];
  const r = layout.zones[area];
  return [(r.x0 + r.x1) / 2, 4.5, 4];
}

/** Коротко, как в ТЗ: «Брак 10,0% и растёт», «ABB-04: ресурс до ТО 6%» — участок и так подписан над зоной */
function shortTitle(p: Plaque, layout: PlantLayout): string {
  const n = layout.names[p.area];
  const names = n ? [n.short, n.name] : [];
  let t = p.title;
  for (const n of names) {
    for (const prefix of [`${n} стоит: `, `${n}: `]) if (t.startsWith(prefix)) t = t.slice(prefix.length);
  }
  t = t.replace(/^Робот /, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function Plaques({ layout, data, portal }: { layout: PlantLayout; data: SceneData; portal: Portal }) {
  const { lang } = useTranslation();
  // соседние плашки не должны наезжать друг на друга: поднимаем следующую, если близко по потоку
  const items = useMemo(() => {
    const all = [
      ...data.plaques.map((p) => ({ key: `p-${p.incidentId}`, kind: 'problem' as const, p, at: anchorOf(layout, p.area, p.equipmentId) })),
      ...data.decisions.map((d) => ({ key: `d-${d.incidentId}`, kind: 'decision' as const, d, at: anchorOf(layout, d.area, d.equipmentId) })),
    ].sort((a, b) => a.at[0] - b.at[0]);
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const cur = all[i]!;
      if (Math.abs(cur.at[0] - prev.at[0]) < 14) cur.at = [cur.at[0], Math.max(cur.at[1], prev.at[1] + 3), cur.at[2]];
    }
    return all;
  }, [layout, data.plaques, data.decisions]);

  return (
    <>
      {items.map((it) => {
        if (it.kind === 'problem') {
          const Icon = TONE_ICON[it.p.tone];
          const openIncidentText = lang === 'kk' ? 'Инцидентті ашу' : lang === 'en' ? 'Open incident' : 'Открыть инцидент';
          const title = `${translateDynamicText(it.p.title, lang)} — ${translateDynamicText(it.p.impact, lang)}. ${openIncidentText}`;
          const rawShort = shortTitle(it.p, layout);
          const localizedShort = translateDynamicText(rawShort, lang);
          return (
            <Html key={it.key} portal={portal as never} position={it.at} center zIndexRange={Z_PLAQUE}>
              <button
                type="button"
                onClick={() => openIncident(it.p.incidentId)}
                title={title}
                className={cx(
                  'view-in pointer-events-auto inline-flex max-w-[15rem] items-center gap-1.5 whitespace-nowrap rounded-xl border-l-4 bg-surface py-1.5 pl-2 pr-3 text-[0.9375rem] font-semibold text-ink shadow-pop hover:bg-surface-2',
                  TONE_CLASS[it.p.tone].border,
                  it.p.check === 'signal' && 'border-2 border-dashed text-ink-2',
                )}
              >
                <Icon className={cx('size-4 shrink-0', TONE_CLASS[it.p.tone].ink)} strokeWidth={2.25} aria-hidden />
                <span className="truncate">{localizedShort}</span>
              </button>
            </Html>
          );
        }
        return (
          <Html key={it.key} portal={portal as never} position={it.at} center zIndexRange={Z_PLAQUE}>
            <button
              type="button"
              onClick={() => openIncident(it.d.incidentId)}
              className={cx(
                'view-in pointer-events-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-[0.9375rem] font-semibold shadow-pop ring-1',
                it.d.tone === 'maintenance' ? cx(TONE_CLASS.maintenance.bg, TONE_CLASS.maintenance.ink, 'ring-st-maintenance') : 'bg-surface text-ink ring-line hover:bg-surface-2',
              )}
            >
              {it.d.tone === 'maintenance' ? <Wrench className="size-4 shrink-0" strokeWidth={2.25} aria-hidden /> : <Clock className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />}
              {translateDynamicText(it.d.text, lang)}
            </button>
          </Html>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ступень 1: камеры видеонаблюдения на участках; ступень 2: датчики на приводе и фильтрах

function CameraIcons({ layout, portal }: { layout: PlantLayout; portal: Portal }) {
  return (
    <>
      {layout.producing.map((area) => {
        const cam = CAMERAS.find((c) => c.area === area);
        if (!cam) return null;
        const r = layout.zones[area];
        return (
          <Html key={area} portal={portal as never} position={[r.x0 + 1.4, 3.2, r.z1 - 1.4]} center zIndexRange={Z_LABEL}>
            <span title={cam.name} className="view-in pointer-events-auto grid size-7 place-items-center rounded-full bg-surface text-ink-2 shadow-card ring-1 ring-line">
              <Video className="size-4" strokeWidth={2.25} aria-label={cam.name} />
            </span>
          </Html>
        );
      })}
    </>
  );
}

function SensorBadges({ layout, data, portal, onHover }: { layout: PlantLayout; data: SceneData; portal: Portal; onHover: (t: HoverTarget | null) => void }) {
  const { lang } = useTranslation();
  const sensorText = lang === 'kk' ? 'датчик' : lang === 'en' ? 'sensor' : 'датчик';
  return (
    <>
      {data.sensors.map((s) => {
        const e = layout.equipment.find((x) => x.id === s.equipmentId);
        if (!e) return null;
        const at: [number, number, number] = e.model === 'conveyor' ? [(e.span?.[0] ?? e.x) + 0.9, 2.6, -2.4] : [e.x, FLOOR_Y + 4.3, e.z + 2.5];
        return (
          <Html key={s.equipmentId} portal={portal as never} position={at} center zIndexRange={Z_PLAQUE}>
            <span
              onMouseEnter={() => onHover({ kind: 'sensor', id: s.equipmentId })}
              onMouseLeave={() => onHover(null)}
              className="view-in pointer-events-auto inline-flex cursor-default items-center gap-1 rounded-full bg-ink px-1.5 py-0.5 text-xs font-semibold text-white shadow-card"
            >
              <Activity className="size-3.5" strokeWidth={2.5} aria-hidden />
              {sensorText}
            </span>
          </Html>
        );
      })}
    </>
  );
}
