// Оборудование из примитивов. Один стиль — матовые светлые поверхности; цвет только у статусов.
// На ступени 0 (только 1С) оборудование «призрачное»: его состояние видно лишь по проходу VIN.
import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Instance, Instances } from '@react-three/drei';
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Group } from 'three';
import type { AreaId, Tone } from '@allur/contracts/ref';
import { FLOOR_Y, type EquipmentPlace, type PlantLayout } from './layout';
import type { Palette } from './palette';
import type { EquipmentView } from './useSceneData';
import { damp, requestAmbient } from './ticker';

export interface Mats {
  solid: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  opening: MeshStandardMaterial;
}

export type HoverTarget = { kind: 'zone'; id: AreaId } | { kind: 'equipment'; id: string } | { kind: 'buffer'; id: string } | { kind: 'sensor'; id: string } | { kind: 'body'; id: string };

export function useMaterials(p: Palette): Mats {
  return useMemo(
    () => ({
      solid: new MeshStandardMaterial({ color: p.equipment, roughness: 0.85, metalness: 0, transparent: true }),
      dark: new MeshStandardMaterial({ color: p.equipmentDark, roughness: 0.8, metalness: 0, transparent: true }),
      glass: new MeshStandardMaterial({ color: p.glass, roughness: 0.35, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }),
      opening: new MeshStandardMaterial({ color: p.opening, roughness: 1, transparent: true }),
    }),
    [p],
  );
}

/** Плавный переход «живое ⇄ призрачное» сразу для всех материалов оборудования */
export function GhostFader({ mats, palette, ghost }: { mats: Mats; palette: Palette; ghost: boolean }) {
  const k = useRef(-1);
  useFrame((state, dt) => {
    const target = ghost ? 1 : 0;
    const next = k.current < 0 ? target : damp(k.current, target, 5, dt);
    if (Math.abs(next - k.current) < 0.002) return;
    k.current = Math.abs(next - target) < 0.002 ? target : next;
    const g = k.current;
    mats.solid.opacity = 1 - 0.58 * g;
    mats.solid.color.copy(palette.equipment).lerp(palette.ghost, g);
    mats.dark.opacity = 1 - 0.58 * g;
    mats.dark.color.copy(palette.equipmentDark).lerp(palette.ghost, g);
    mats.glass.opacity = 0.5 * (1 - 0.45 * g);
    mats.opening.opacity = 1 - 0.6 * g;
    state.invalidate();
  });
  return null;
}

interface ModelProps {
  place: EquipmentPlace;
  view: EquipmentView | undefined;
  mats: Mats;
  palette: Palette;
  layout: PlantLayout;
  /** есть данные контроллеров: оборудование «живое» */
  live: boolean;
  reducedMotion: boolean;
  onHover: (t: HoverTarget | null) => void;
  onPick: (area: AreaId, equipmentId: string) => void;
}

export function EquipmentModel(props: ModelProps) {
  const { place, view, mats, palette, layout, live, reducedMotion, onHover, onPick } = props;
  const status = live ? (view?.status ?? null) : null;
  let model: React.ReactNode;
  switch (place.model) {
    case 'robot':
      model = <Robot place={place} mats={mats} animate={status === 'run' && !reducedMotion} />;
      break;
    case 'booth':
      model = <Booth place={place} mats={mats} palette={palette} dp={live ? (view?.dp ?? null) : null} />;
      break;
    case 'pretreatment':
      model = <Pretreatment place={place} mats={mats} />;
      break;
    case 'oven':
      model = <Oven place={place} mats={mats} />;
      break;
    case 'conveyor':
      model = <Conveyor place={place} mats={mats} layout={layout} />;
      break;
    case 'inspection':
      model = <Inspection place={place} mats={mats} />;
      break;
    case 'rain_test':
      model = <RainBooth place={place} mats={mats} />;
      break;
    case 'track':
      model = <Track place={place} mats={mats} />;
      break;
    case 'laser_cell':
      model = <LaserCell place={place} mats={mats} />;
      break;
    case 'weld_finish':
      model = <WeldFinish place={place} mats={mats} />;
      break;
    case 'geometry_lab':
      model = <GeometryLab place={place} mats={mats} />;
      break;
    case 'sealer':
      model = <Sealer place={place} mats={mats} />;
      break;
    case 'paint_inspection':
      model = <LightTunnel place={place} mats={mats} />;
      break;
    case 'polishing':
      model = <PolishingBay place={place} mats={mats} />;
      break;
    case 'test_line':
      model = <TestLine place={place} mats={mats} layout={layout} />;
      break;
    default:
      model = <GenericUnit place={place} mats={mats} />;
  }
  const tone: Tone | null = status === 'fault' ? 'fault' : status === 'maintenance' ? 'maintenance' : null;
  return (
    <group
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onHover({ kind: 'equipment', id: place.id });
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 6) return;
        e.stopPropagation();
        onPick(place.area, place.id);
      }}
    >
      {model}
      {tone && <StatusPin place={place} color={palette.tone[tone]} pulse={tone === 'fault' && !reducedMotion} />}
    </group>
  );
}

/** Метка проблемного оборудования: красная — авария, фиолетовая — обслуживание */
function StatusPin({ place, color, pulse }: { place: EquipmentPlace; color: Color; pulse: boolean }) {
  const ref = useRef<Group>(null);
  const base = FLOOR_Y + place.height + 1.3;
  const x = place.span ? place.span[0] + 1.2 : place.x;
  useFrame((state) => {
    if (!ref.current) return;
    const s = pulse ? 1 + 0.12 * Math.sin(state.clock.elapsedTime * 3) : 1;
    ref.current.scale.setScalar(s);
    if (pulse) requestAmbient(state.invalidate);
  });
  return (
    <group ref={ref} position={[x, base, place.z]}>
      <mesh rotation-x={Math.PI} position-y={-0.1}>
        <coneGeometry args={[0.42, 0.9, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.6} />
      </mesh>
      <mesh position-y={0.55}>
        <sphereGeometry args={[0.34, 18, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Робот сварки: основание, поворотная колонна, два звена и голова со сварочными клещами */
function Robot({ place, mats, animate }: { place: EquipmentPlace; mats: Mats; animate: boolean }) {
  const turret = useRef<Group>(null);
  const upper = useRef<Group>(null);
  const fore = useRef<Group>(null);
  const amp = useRef(animate ? 1 : 0);
  const phase = useMemo(() => [...place.id].reduce((a, c) => a + c.charCodeAt(0), 0) * 0.7, [place.id]);
  useFrame((state, dt) => {
    if (!turret.current || !upper.current || !fore.current) return;
    // плавный старт и остановка руки: робот не «замирает» рывком
    amp.current = damp(amp.current, animate ? 1 : 0, 2.5, dt);
    const a = amp.current;
    const t = state.clock.elapsedTime;
    turret.current.rotation.y = a * 0.42 * Math.sin(t * 0.9 + phase);
    upper.current.rotation.x = 0.32 + a * 0.16 * Math.sin(t * 1.3 + phase);
    fore.current.rotation.x = 0.62 + a * 0.22 * Math.sin(t * 0.8 + phase * 1.3);
    if (animate || a > 0.003) requestAmbient(state.invalidate);
  });
  return (
    <group position={[place.x, FLOOR_Y, place.z]} rotation-y={place.side < 0 ? 0 : Math.PI}>
      <mesh position-y={0.28} material={mats.dark}>
        <cylinderGeometry args={[0.62, 0.72, 0.56, 22]} />
      </mesh>
      <group ref={turret} position-y={0.56}>
        <mesh position-y={0.24} material={mats.solid}>
          <cylinderGeometry args={[0.44, 0.5, 0.48, 20]} />
        </mesh>
        <group ref={upper} position-y={0.48}>
          <mesh position-y={0.86} material={mats.solid}>
            <boxGeometry args={[0.38, 1.72, 0.38]} />
          </mesh>
          <group ref={fore} position-y={1.72}>
            <mesh position-z={0.76} material={mats.solid}>
              <boxGeometry args={[0.32, 0.32, 1.52]} />
            </mesh>
            <mesh position-z={1.6} material={mats.dark}>
              <boxGeometry args={[0.36, 0.36, 0.42]} />
            </mesh>
            <mesh position={[0, -0.32, 1.66]} material={mats.dark}>
              <cylinderGeometry args={[0.06, 0.06, 0.5, 8]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Окрасочная камера: закрытый бокс с проёмами, фильтр — панель на передней стене */
function Booth({ place, mats, palette, dp }: { place: EquipmentPlace; mats: Mats; palette: Palette; dp: number | null }) {
  const filter = useMemo(() => new MeshStandardMaterial({ color: palette.wall, roughness: 0.7 }), [palette]);
  const target = useMemo(() => new Color(), []);
  useFrame((state, dt) => {
    // загрязнение фильтра: до нормы 250 Па — нейтрально, к пределу 450 Па — янтарный
    const k = dp === null ? 0 : Math.max(0, Math.min(1, (dp - 250) / 200));
    target.copy(palette.wall).lerp(palette.tone.attention, k);
    const before = filter.color.getHex();
    filter.color.lerp(target, 1 - Math.exp(-4 * Math.min(dt, 0.1)));
    if (filter.color.getHex() !== before) state.invalidate();
  });
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={1.8} material={mats.glass}>
        <boxGeometry args={[5.8, 3.6, 4.8]} />
      </mesh>
      <mesh position-y={3.68} material={mats.solid}>
        <boxGeometry args={[6.1, 0.18, 5.1]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 2.92, 1.25, 0]} rotation-y={(s * Math.PI) / 2} material={mats.opening}>
          <planeGeometry args={[2.6, 2.3]} />
        </mesh>
      ))}
      <mesh position={[0, 2.95, 2.43]} material={filter}>
        <planeGeometry args={[4.2, 0.95]} />
      </mesh>
    </group>
  );
}

/** Подготовка поверхности: длинная ванна с перегородками (13 ванн в 1С) */
function Pretreatment({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={0.7} material={mats.solid}>
        <boxGeometry args={[7.2, 1.4, 4.2]} />
      </mesh>
      <mesh position-y={1.41} rotation-x={-Math.PI / 2} material={mats.opening}>
        <planeGeometry args={[6.8, 3.8]} />
      </mesh>
      {[-2.4, -0.8, 0.8, 2.4].map((dx) => (
        <mesh key={dx} position={[dx, 1.45, 0]} material={mats.dark}>
          <boxGeometry args={[0.12, 0.12, 3.9]} />
        </mesh>
      ))}
    </group>
  );
}

/** Сушка: туннельная печь с проёмами */
function Oven({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={1.75} material={mats.solid}>
        <boxGeometry args={[7, 3.5, 4.6]} />
      </mesh>
      <mesh position={[1.8, 3.9, -1]} material={mats.dark}>
        <boxGeometry args={[1, 0.8, 1]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 3.51, 1.2, 0]} rotation-y={(s * Math.PI) / 2} material={mats.opening}>
          <planeGeometry args={[2.6, 2.2]} />
        </mesh>
      ))}
    </group>
  );
}

/** Конвейер-03: лента через все посты сборки, стойки постов, привод в начале */
function Conveyor({ place, mats, layout }: { place: EquipmentPlace; mats: Mats; layout: PlantLayout }) {
  const [x0, x1] = place.span ?? [place.x - 3, place.x + 3];
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const posts = useMemo(() => place.posts.map((id) => layout.postSpots[id]?.x).filter((x): x is number => x !== undefined), [place.posts, layout]);
  return (
    <group position={[0, FLOOR_Y, place.z]}>
      <mesh position={[cx, 0.35, 0]} material={mats.dark}>
        <boxGeometry args={[len, 0.3, 2.6]} />
      </mesh>
      {[-1.42, 1.42].map((z) => (
        <mesh key={z} position={[cx, 0.6, z]} material={mats.solid}>
          <boxGeometry args={[len, 0.16, 0.16]} />
        </mesh>
      ))}
      {/* привод — на нём датчики тока и вибрации (ступень 2) */}
      <mesh position={[x0 + 0.9, 0.75, -2.4]} material={mats.dark}>
        <boxGeometry args={[1.5, 1.5, 1.6]} />
      </mesh>
      <Instances limit={posts.length * 2} material={mats.solid}>
        <boxGeometry args={[0.24, 3.2, 0.24]} />
        {posts.flatMap((x) => [<Instance key={`${x}a`} position={[x, 1.6, -2.7]} />, <Instance key={`${x}b`} position={[x, 1.6, 2.7]} />])}
      </Instances>
      <Instances limit={posts.length} material={mats.solid}>
        <boxGeometry args={[0.3, 0.3, 5.7]} />
        {posts.map((x) => (
          <Instance key={x} position={[x, 3.2, 0]} />
        ))}
      </Instances>
    </group>
  );
}

/** Пост контроля: арка со светильником */
function Inspection({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      {[-2.7, 2.7].map((z) => (
        <mesh key={z} position={[0, 1.75, z]} material={mats.solid}>
          <boxGeometry args={[0.45, 3.5, 0.45]} />
        </mesh>
      ))}
      <mesh position={[0, 3.6, 0]} material={mats.solid}>
        <boxGeometry args={[1.2, 0.4, 5.9]} />
      </mesh>
      <mesh position={[0, 3.38, 0]} material={mats.dark}>
        <boxGeometry args={[0.9, 0.06, 5]} />
      </mesh>
    </group>
  );
}

/** Камера герметичности: закрытый бокс */
function RainBooth({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={1.8} material={mats.glass}>
        <boxGeometry args={[5.8, 3.6, 4.8]} />
      </mesh>
      <mesh position-y={3.68} material={mats.solid}>
        <boxGeometry args={[6.1, 0.18, 5.1]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 2.92, 1.25, 0]} rotation-y={(s * Math.PI) / 2} material={mats.opening}>
          <planeGeometry args={[2.6, 2.3]} />
        </mesh>
      ))}
    </group>
  );
}

/** Выезд на полигон: дорога с линии за край зоны и дальше, за пределы цеха (машины — выборочно) */
function Track({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  const from = 2;
  const to = place.z - 8;
  return (
    <group position={[place.x, FLOOR_Y + 0.01, 0]}>
      <mesh position={[0, 0, (from + to) / 2]} rotation-x={-Math.PI / 2} material={mats.dark}>
        <planeGeometry args={[3.2, from - to]} />
      </mesh>
      <mesh position={[0, 0.01, to]} rotation-x={-Math.PI / 2} material={mats.dark}>
        <ringGeometry args={[2.2, 3.4, 32, 1, 0, Math.PI]} />
      </mesh>
    </group>
  );
}

/** Опора робота без анимации — для ячеек, где роботов много (лазерная ячейка, герметизация) */
function RobotStub({ x, z, facing, mats }: { x: number; z: number; facing: 1 | -1; mats: Mats }) {
  return (
    <group position={[x, 0, z]} rotation-y={facing > 0 ? 0 : Math.PI}>
      <mesh position-y={0.3} material={mats.dark}>
        <cylinderGeometry args={[0.38, 0.44, 0.6, 14]} />
      </mesh>
      <mesh position={[0, 1.15, 0.15]} rotation-x={0.35} material={mats.solid}>
        <boxGeometry args={[0.26, 1.4, 0.26]} />
      </mesh>
      <mesh position={[0, 1.75, 0.75]} material={mats.solid}>
        <boxGeometry args={[0.22, 0.22, 1.1]} />
      </mesh>
    </group>
  );
}

/** Лазерная ячейка крыши: закрытый бокс с полупрозрачными стенами, внутри 8 роботов */
function LaserCell({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  const xs = [-2.7, -0.9, 0.9, 2.7];
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={1.7} material={mats.glass}>
        <boxGeometry args={[8.2, 3.4, 6.8]} />
      </mesh>
      <mesh position-y={3.46} material={mats.solid}>
        <boxGeometry args={[8.5, 0.14, 7.1]} />
      </mesh>
      {xs.flatMap((x) => [
        <RobotStub key={`${x}a`} x={x} z={-2.7} facing={1} mats={mats} />,
        <RobotStub key={`${x}b`} x={x} z={2.7} facing={-1} mats={mats} />,
      ])}
    </group>
  );
}

/** Рихтовка и доводка: две площадки рабочих по бокам и светильник над кузовом */
function WeldFinish({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      {[-2.4, 2.4].map((z) => (
        <mesh key={z} position={[0, 0.25, z]} material={mats.dark}>
          <boxGeometry args={[4.2, 0.5, 1.1]} />
        </mesh>
      ))}
      {[-2.9, 2.9].map((z) => (
        <mesh key={z} position={[-1.9, 1.4, z]} material={mats.solid}>
          <boxGeometry args={[0.2, 2.8, 0.2]} />
        </mesh>
      ))}
      <mesh position={[-1.9, 2.8, 0]} material={mats.solid}>
        <boxGeometry args={[0.5, 0.2, 6]} />
      </mesh>
      <mesh position={[1.6, 0.5, -2.4]} material={mats.solid}>
        <boxGeometry args={[0.8, 1, 0.6]} />
      </mesh>
    </group>
  );
}

/** Лаборатория геометрии: комната со стеклянным фасадом и мостовой измерительной машиной */
function GeometryLab({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={0.04} material={mats.dark}>
        <boxGeometry args={[7.6, 0.08, 6.4]} />
      </mesh>
      <mesh position-y={1.55} material={mats.glass}>
        <boxGeometry args={[7.6, 3.1, 6.4]} />
      </mesh>
      <mesh position-y={3.14} material={mats.solid}>
        <boxGeometry args={[7.9, 0.12, 6.7]} />
      </mesh>
      {[-2.6, 2.6].map((z) => (
        <mesh key={z} position={[0, 0.5, z]} material={mats.solid}>
          <boxGeometry args={[6.6, 0.2, 0.3]} />
        </mesh>
      ))}
      <mesh position={[-0.8, 2.3, 0]} material={mats.solid}>
        <boxGeometry args={[0.35, 0.35, 5.6]} />
      </mesh>
      {[-2.6, 2.6].map((z) => (
        <mesh key={z} position={[-0.8, 1.4, z]} material={mats.solid}>
          <boxGeometry args={[0.3, 1.8, 0.3]} />
        </mesh>
      ))}
      <mesh position={[-0.8, 1.6, 0.8]} material={mats.dark}>
        <boxGeometry args={[0.16, 1.2, 0.16]} />
      </mesh>
    </group>
  );
}

/** Герметизация швов: закрытая кабина с двумя роботами нанесения мастики */
function Sealer({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={1.5} material={mats.glass}>
        <boxGeometry args={[5.6, 3, 4.6]} />
      </mesh>
      <mesh position-y={3.06} material={mats.dark}>
        <boxGeometry args={[5.9, 0.14, 4.9]} />
      </mesh>
      <RobotStub x={0} z={-1.9} facing={1} mats={mats} />
      <RobotStub x={0} z={1.9} facing={-1} mats={mats} />
    </group>
  );
}

/** Контроль покрытия: световой туннель — рама с яркими панелями по бокам и сверху */
function LightTunnel({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  const light = useMemo(() => new MeshBasicMaterial({ color: '#ffffff' }), []);
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      {[-1.6, 1.6].map((x) => (
        <group key={x} position-x={x}>
          {[-2.5, 2.5].map((z) => (
            <mesh key={z} position={[0, 1.6, z]} material={mats.solid}>
              <boxGeometry args={[0.25, 3.2, 0.25]} />
            </mesh>
          ))}
          <mesh position={[0, 3.25, 0]} material={mats.solid}>
            <boxGeometry args={[0.25, 0.25, 5.25]} />
          </mesh>
        </group>
      ))}
      {[-2.42, 2.42].map((z) => (
        <mesh key={z} position={[0, 1.7, z]} rotation-y={z < 0 ? 0 : Math.PI} material={light}>
          <planeGeometry args={[3, 1.8]} />
        </mesh>
      ))}
      <mesh position={[0, 3.12, 0]} rotation-x={Math.PI / 2} material={light}>
        <planeGeometry args={[3, 4.6]} />
      </mesh>
    </group>
  );
}

/** Полировка: открытая площадка в стороне от линии со светильниками на стойках */
function PolishingBay({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={0.02} rotation-x={-Math.PI / 2} material={mats.opening}>
        <planeGeometry args={[4.8, 4.6]} />
      </mesh>
      {[-2.2, 2.2].map((x) => (
        <group key={x} position-x={x}>
          <mesh position-y={1.2} material={mats.solid}>
            <boxGeometry args={[0.16, 2.4, 0.16]} />
          </mesh>
          <mesh position={[0, 2.45, 0]} material={mats.dark}>
            <boxGeometry args={[0.5, 0.18, 1.8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Испытательная линия: роликовый стенд, стенд развал-схождения, экран настройки фар — по постам */
function TestLine({ place, mats, layout }: { place: EquipmentPlace; mats: Mats; layout: PlantLayout }) {
  const xs = place.posts.map((id) => layout.postSpots[id]?.x).filter((x): x is number => x !== undefined);
  const [rollers, align, lamps] = xs;
  return (
    <group position={[0, FLOOR_Y, place.z]}>
      {rollers !== undefined && (
        <group position-x={rollers}>
          <mesh position-y={0.01} rotation-x={-Math.PI / 2} material={mats.opening}>
            <planeGeometry args={[4.4, 2.4]} />
          </mesh>
          {[-1.3, 1.3].flatMap((dx) =>
            [-0.18, 0.18].map((d) => (
              <mesh key={`${dx}${d}`} position={[dx + d, 0.12, 0]} rotation-x={Math.PI / 2} material={mats.dark}>
                <cylinderGeometry args={[0.14, 0.14, 2.2, 12]} />
              </mesh>
            )),
          )}
          <mesh position={[0, 0.9, -2.6]} material={mats.solid}>
            <boxGeometry args={[1, 1.8, 0.5]} />
          </mesh>
        </group>
      )}
      {align !== undefined && (
        <group position-x={align}>
          {[-1.3, 1.3].flatMap((dx) =>
            [-1.5, 1.5].map((dz) => (
              <mesh key={`${dx}${dz}`} position={[dx, 0.45, dz]} material={mats.dark}>
                <boxGeometry args={[0.6, 0.6, 0.08]} />
              </mesh>
            )),
          )}
          <mesh position={[2.1, 1.1, -2.6]} material={mats.solid}>
            <boxGeometry args={[0.2, 2.2, 0.2]} />
          </mesh>
          <mesh position={[2.1, 2.1, -2.45]} material={mats.dark}>
            <boxGeometry args={[1, 0.7, 0.08]} />
          </mesh>
        </group>
      )}
      {lamps !== undefined && (
        <group position-x={lamps}>
          <mesh position={[2.3, 1, 0]} material={mats.solid}>
            <boxGeometry args={[0.12, 1.6, 3.2]} />
          </mesh>
          <mesh position={[0.4, 0.6, 0]} material={mats.dark}>
            <boxGeometry args={[0.5, 1.2, 0.5]} />
          </mesh>
        </group>
      )}
    </group>
  );
}

/** Оборудование без своей модели: корпус по высоте из каталога */
function GenericUnit({ place, mats }: { place: EquipmentPlace; mats: Mats }) {
  return (
    <group position={[place.x, FLOOR_Y, place.z]}>
      <mesh position-y={place.height / 2} material={mats.solid}>
        <boxGeometry args={[3.6, place.height, 3.6]} />
      </mesh>
      <mesh position-y={place.height + 0.06} material={mats.dark}>
        <boxGeometry args={[3.8, 0.12, 3.8]} />
      </mesh>
    </group>
  );
}

/** Склад комплектующих: стеллаж и стопки контейнеров — высота стопки по запасу (1С:WMS) */
export function WarehouseContent({ layout, stock, mats, palette }: { layout: PlantLayout; stock: Record<string, number | null>; mats: Mats; palette: Palette }) {
  const z = layout.zones[layout.warehouseId ?? ''];
  const boxes = useMemo(() => {
    const out: { key: string; pos: [number, number, number]; color: Color }[] = [];
    for (const k of layout.kitSpots) {
      const left = stock[k.kitId];
      const n = left === null || left === undefined ? 2 : Math.max(0, Math.min(6, Math.round(left * 1.5)));
      const low = left !== null && left !== undefined && left < 2;
      for (let i = 0; i < n; i++) {
        out.push({ key: `${k.kitId}-${i}`, pos: [k.x, FLOOR_Y + 0.36 + i * 0.74, k.z], color: low && i === n - 1 ? palette.tone.attention : palette.equipmentDark });
      }
    }
    return out;
  }, [layout, stock, palette]);
  if (!z) return null;
  return (
    <group>
      <Rack x0={z.x0 + 0.8} x1={z.x1 - 0.8} zc={z.z0 + 1.6} mats={mats} />
      <Instances limit={48}>
        <boxGeometry args={[2.1, 0.7, 1.5]} />
        <meshStandardMaterial roughness={0.85} />
        {boxes.map((b) => (
          <Instance key={b.key} position={b.pos} color={b.color} />
        ))}
      </Instances>
    </group>
  );
}

/** Склад готовой продукции: стеллаж и разметка мест стоянки */
export function FinishedContent({ layout, mats }: { layout: PlantLayout; mats: Mats }) {
  const z = layout.zones[layout.finishedId ?? ''];
  if (!z) return null;
  return (
    <group>
      <Rack x0={z.x0 + 0.8} x1={z.x1 - 0.8} zc={z.z0 + 1.6} mats={mats} />
      {(layout.segSpots[layout.finishedId!] ?? []).map((s, i) => (
        <mesh key={i} position={[s.x, FLOOR_Y + 0.006, s.z]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[2.3, 4.8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function Rack({ x0, x1, zc, mats }: { x0: number; x1: number; zc: number; mats: Mats }) {
  const len = x1 - x0;
  const uprights = Math.max(2, Math.round(len / 3) + 1);
  return (
    <group position-y={FLOOR_Y}>
      {[0.9, 1.9, 2.9].map((y) => (
        <mesh key={y} position={[(x0 + x1) / 2, y, zc]} material={mats.solid}>
          <boxGeometry args={[len, 0.12, 1.5]} />
        </mesh>
      ))}
      <Instances limit={uprights * 2} material={mats.dark}>
        <boxGeometry args={[0.14, 3.1, 0.14]} />
        {Array.from({ length: uprights }, (_, i) => x0 + (len * i) / (uprights - 1)).flatMap((x) => [
          <Instance key={`${x}a`} position={[x, 1.55, zc - 0.7]} />,
          <Instance key={`${x}b`} position={[x, 1.55, zc + 0.7]} />,
        ])}
      </Instances>
    </group>
  );
}
