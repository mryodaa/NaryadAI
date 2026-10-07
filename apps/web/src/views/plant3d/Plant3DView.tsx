// 3D-модель цеха (отдельный чанк, грузится лениво). Состояние — те же данные, что у «Панели»:
// снимок двойника, детали участков, инциденты. Клик по зоне — панель участка, по плашке — инцидент.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, invalidate } from '@react-three/fiber';
import { ArrowLeft, Info, MousePointerClick, Route, WifiOff, X } from 'lucide-react';
import type { AreaId, LiveSnapshot } from '@allur/contracts/ref';
import { useLive } from '../../state/live';
import { backToPlant, clearVinPath, openAreaPanel, selectArea, setTour, useView } from '../../state/view';
import { EQUIPMENT_STATUS, TONE_CLASS, cx } from '../../lib/tones';
import { BODIES, num, pct0, plural } from '../../lib/format';
import { buildLayout, PRODUCING } from './layout';
import { readPalette } from './palette';
import { FlowModel, type FlowInput } from './flow';
import { useSceneData, type SceneData } from './useSceneData';
import { Scene } from './Scene';
import { CameraRig, type Insets } from './CameraRig';
import type { HoverTarget } from './equipment';

const PRESETS: { label: string; area: AreaId | null }[] = [
  { label: 'Весь цех', area: null },
  { label: 'Сварка', area: 'weld' },
  { label: 'Окраска', area: 'paint' },
  { label: 'Сборка', area: 'assembly' },
  { label: 'ОТК', area: 'qc' },
];

const BUFFER_NAME: Record<string, string> = { 'weld-paint': 'Очередь перед окраской', 'paint-assembly': 'Очередь перед сборкой', 'assembly-qc': 'Очередь перед ОТК' };

export default function Plant3DView({ active, onLost }: { active: boolean; onLost: () => void }) {
  const snapshot = useLive((s) => s.snapshot);
  if (!snapshot || !snapshot.ready) return null;
  return <PlantScene snapshot={snapshot} active={active} onLost={onLost} />;
}

function PlantScene({ snapshot: s, active, onLost }: { snapshot: LiveSnapshot; active: boolean; onLost: () => void }) {
  const layout = useMemo(buildLayout, []);
  const palette = useMemo(readPalette, []);
  const flow = useMemo(() => new FlowModel(layout), [layout]);
  const data = useSceneData(s);
  const area = useView((v) => v.area);
  const equipment = useView((v) => v.equipment);
  const tour = useView((v) => v.tour);
  const vinPath = useView((v) => v.vinPath);
  const conn = useLive((x) => x.conn);
  const reducedMotion = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const insets = useInsets(hostRef, active);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const tipRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const showFps = useMemo(() => new URLSearchParams(location.search).has('fps'), []);

  // кузова: каждое обновление снимка доводит картинку до состояния данных
  useEffect(() => {
    flow.update(flowInput(s), performance.now(), reducedMotion);
    invalidate();
  }, [s, flow, reducedMotion]);

  // Esc: сначала закрывается открытое окно (у него свой обработчик), потом — возврат к общему плану
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role=dialog], [data-esc-layer]')) return;
      const v = useView.getState();
      if (v.vinPath) clearVinPath();
      else if (v.area || v.equipment) backToPlant();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active]);

  // автопоказ выключается любым кликом, клавишей или заметным движением мыши
  useEffect(() => {
    if (!tour || !active) return;
    const started = performance.now();
    let moved = 0;
    let last: { x: number; y: number } | null = null;
    const stop = () => setTour(false);
    const onMove = (e: PointerEvent) => {
      if (performance.now() - started < 1500) return;
      if (last) moved += Math.hypot(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
      if (moved > 30) stop();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyD') stop();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', stop, true);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('keydown', onKey);
    };
  }, [tour, active]);

  useEffect(() => {
    if (!hover) document.body.style.removeProperty('cursor');
    else document.body.style.cursor = hover.kind === 'zone' || hover.kind === 'equipment' ? 'pointer' : 'default';
    return () => void document.body.style.removeProperty('cursor');
  }, [hover]);

  const moveTip = () => {
    const el = tipRef.current;
    const host = hostRef.current;
    if (!el || !host) return;
    const w = host.clientWidth;
    const x = pointer.current.x + 16 + el.offsetWidth > w ? pointer.current.x - el.offsetWidth - 12 : pointer.current.x + 16;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(pointer.current.y + 16)}px)`;
  };
  useEffect(moveTip, [hover]);

  const incidentsOnScene = useMemo(() => data.plaques.map((p) => ({ id: p.incidentId, area: p.area })), [data.plaques]);
  const ghost = !(data.plcConnected && s.stage >= 1);

  return (
    <section
      ref={hostRef}
      aria-label={sceneSummary(data)}
      className="absolute inset-0 isolate overflow-hidden bg-page"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (hover) moveTip();
      }}
      onPointerLeave={() => setHover(null)}
    >
      <Canvas
        flat
        dpr={[1, 1.5]}
        // пока открыта «Панель», сцена в памяти, но не рисуется; с ?fps — непрерывно, для замера
        frameloop={!active ? 'never' : showFps ? 'always' : 'demand'}
        camera={{ fov: 32, near: 1, far: 1200, position: [60, 120, 160] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', onLost, { once: true })}
        onPointerMissed={() => setHover(null)}
      >
        <Scene
          layout={layout}
          palette={palette}
          data={data}
          buffers={s.buffers}
          stage={s.stage}
          flow={flow}
          focusArea={area}
          reducedMotion={reducedMotion}
          portal={labelsRef}
          vinPath={vinPath}
          onHover={setHover}
          onPick={(a, eq) => openAreaPanel(a, eq)}
        />
        <CameraRig layout={layout} area={area} equipment={equipment} insets={insets} tour={tour} incidents={incidentsOnScene} onUserControl={() => setTour(false)} />
        {showFps && <FpsProbe />}
      </Canvas>
      {/* подписи и плашки сцены — в постоянном слое поверх холста */}
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />

      {hover && (
        <div ref={tipRef} className="pointer-events-none absolute left-0 top-0 z-40 max-w-[18rem] rounded-xl bg-surface px-3 py-2 text-base shadow-pop ring-1 ring-line">
          <TipContent hover={hover} data={data} snapshot={s} />
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 print:hidden">
        {conn !== 'open' && (
          <Chip tone="attention" icon={<WifiOff className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />}>
            Нет связи с двойником — показано последнее известное состояние
          </Chip>
        )}
        {ghost && (
          <Chip icon={<Info className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />}>
            {s.stage === 0 ? 'Ступень 0 · ' : ''}Состояние оборудования определяется по проходу VIN (1С:MES)
          </Chip>
        )}
        {vinPath && (
          <span className="view-in pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-accent-bg py-1 pl-3 pr-1 text-[0.9375rem] font-semibold text-accent-ink shadow-card ring-1 ring-accent">
            <Route className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            Путь кузова <span className="font-mono">{vinPath.vin}</span>
            <button type="button" onClick={clearVinPath} aria-label="Скрыть путь кузова" className="grid size-7 place-items-center rounded-lg hover:bg-surface">
              <X className="size-4" />
            </button>
          </span>
        )}
        {tour && (
          <Chip icon={<MousePointerClick className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />}>Автопоказ · любой клик или клавиша — остановить</Chip>
        )}
        <div data-occluder="bottom" className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-2xl bg-surface/90 p-1 shadow-card ring-1 ring-line backdrop-blur">
          {area && (
            <button type="button" onClick={backToPlant} className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-1.5 text-base font-semibold text-white hover:bg-ink-2">
              <ArrowLeft className="size-4" strokeWidth={2.5} aria-hidden />
              Вернуться к цеху
            </button>
          )}
          {PRESETS.map((p) => {
            const on = p.area === area && !equipment;
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                onClick={() => (p.area ? selectArea(p.area) : backToPlant())}
                className={cx('rounded-xl px-3 py-1.5 text-base font-semibold transition-colors', on ? 'bg-accent-bg text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Chip({ children, icon, tone }: { children: ReactNode; icon: ReactNode; tone?: 'attention' }) {
  return (
    <span
      className={cx(
        'view-in inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[0.9375rem] font-medium shadow-card ring-1',
        tone ? cx(TONE_CLASS[tone].bg, TONE_CLASS[tone].ink, 'ring-st-attention') : 'bg-surface/95 text-ink-2 ring-line',
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Подсказка при наведении: название, статус, выпуск и главный показатель — те же, что в «Панели» */
function TipContent({ hover, data, snapshot }: { hover: HoverTarget; data: SceneData; snapshot: LiveSnapshot }) {
  if (hover.kind === 'zone') {
    const r = data.rows[hover.id];
    if (!r) return null;
    const Icon = r.status.icon;
    return (
      <div className="flex flex-col gap-1 leading-snug">
        <div className="font-semibold text-ink">{r.name}</div>
        <div className={cx('inline-flex items-center gap-1.5 font-semibold', r.status.tone === 'neutral' ? 'text-st-neutral-ink' : TONE_CLASS[r.status.tone].ink)}>
          <Icon className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
          {r.status.label}
        </div>
        {r.output && (
          <div className="num text-ink-2">
            Выпуск <span className="font-semibold text-ink">{r.output.done}</span> из {r.output.plan} к этому моменту
          </div>
        )}
        {r.metric && <div className={r.metric.tone === 'neutral' ? 'text-ink-2' : TONE_CLASS[r.metric.tone].ink}>{r.metric.text}</div>}
        {r.reason && <div className={cx('text-sm', r.reason.tone === 'neutral' ? 'text-ink-2' : TONE_CLASS[r.reason.tone].ink)}>{r.reason.text}</div>}
        <div className="text-sm text-ink-3">Клик — панель участка</div>
      </div>
    );
  }
  if (hover.kind === 'equipment') {
    const e = data.equipment[hover.id];
    const st = e?.status ? EQUIPMENT_STATUS[e.status] : null;
    const live = data.plcConnected && snapshot.stage >= 1;
    return (
      <div className="flex flex-col gap-1 leading-snug">
        <div className="font-semibold text-ink">{e?.name ?? hover.id}</div>
        {live && st ? (
          <div className={cx('font-semibold', st.tone === 'neutral' ? 'text-st-neutral-ink' : TONE_CLASS[st.tone].ink)}>
            {st.label}
            {e?.code ? ` · код ${e.code}` : ''}
          </div>
        ) : (
          <div className="text-ink-3">нет данных контроллера — состояние по 1С:MES</div>
        )}
        {live && e?.text && e.status !== 'run' && <div className="text-sm text-ink-2">{e.text}</div>}
        {e?.resourceLeft !== null && e?.resourceLeft !== undefined && <div className="num text-ink-2">ресурс до ТО {pct0(e.resourceLeft)}</div>}
        {live && e?.dp !== null && e?.dp !== undefined && <div className="num text-ink-2">фильтр {num(e.dp)} Па · норма до 250</div>}
        <div className="text-sm text-ink-3">Клик — панель участка</div>
      </div>
    );
  }
  if (hover.kind === 'buffer') {
    const b = snapshot.buffers.find((x) => x.id === hover.id);
    if (!b) return null;
    return (
      <div className="leading-snug">
        <div className="font-semibold text-ink">{BUFFER_NAME[b.id] ?? 'Очередь'}</div>
        <div className="num text-ink-2">
          В очереди {b.count} {plural(b.count, BODIES)} из {b.capacity}
        </div>
      </div>
    );
  }
  const sensor = data.sensors.find((x) => x.equipmentId === hover.id);
  if (!sensor) return null;
  return (
    <div className="flex flex-col gap-0.5 leading-snug">
      <div className="font-semibold text-ink">{sensor.label}</div>
      {sensor.values.map((v) => (
        <div key={v.name} className="num text-ink-2">
          {v.name}: <span className="font-semibold text-ink">{v.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Описание для экранных читалок: 3D — не единственный способ узнать состояние цеха */
function sceneSummary(data: SceneData): string {
  const bad = Object.values(data.rows).filter((r) => r && r.status.tone !== 'neutral');
  if (!bad.length) return '3D-модель цеха. Все участки работают без отклонений. Подробности — в режиме «Панель».';
  return `3D-модель цеха. ${bad.map((r) => `${r!.name}: ${r!.status.label.toLowerCase()}${r!.reason ? ` — ${r!.reason.text}` : ''}`).join('; ')}. Подробности — в режиме «Панель».`;
}

function flowInput(s: LiveSnapshot): FlowInput {
  const by = new Map(s.areas.map((a) => [a.id, a]));
  const buf = new Map(s.buffers.map((b) => [b.id, b.count]));
  const status = {} as FlowInput['status'];
  const done = {} as FlowInput['done'];
  for (const a of PRODUCING) {
    status[a] = by.get(a)?.status ?? 'idle';
    done[a] = by.get(a)?.done ?? 0;
  }
  done.finished = by.get('finished')?.done ?? 0;
  return {
    runId: s.runId,
    shiftKey: s.shift?.key ?? null,
    status,
    done,
    buffers: { 'weld-paint': buf.get('weld-paint') ?? 0, 'paint-assembly': buf.get('paint-assembly') ?? 0, 'assembly-qc': buf.get('assembly-qc') ?? 0 },
  };
}

/** Свободная от плавающих панелей часть сцены: элементы с data-occluder сверху, справа, снизу, слева */
function useInsets(ref: React.RefObject<HTMLElement | null>, active: boolean): Insets {
  const [insets, setInsets] = useState<Insets>({ top: 0, right: 0, bottom: 0, left: 0 });
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const host = ref.current;
      if (!host) return;
      const c = host.getBoundingClientRect();
      if (c.width < 10) return;
      const next: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
      document.querySelectorAll<HTMLElement>('[data-occluder]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) return;
        const side = el.dataset.occluder;
        if (side === 'top') next.top = Math.max(next.top, r.bottom - c.top + 12);
        else if (side === 'right') next.right = Math.max(next.right, c.right - r.left + 12);
        else if (side === 'bottom') next.bottom = Math.max(next.bottom, c.bottom - r.top + 12);
        else if (side === 'left') next.left = Math.max(next.left, r.right - c.left + 12);
      });
      setInsets((prev) => (Math.abs(prev.top - next.top) + Math.abs(prev.right - next.right) + Math.abs(prev.bottom - next.bottom) + Math.abs(prev.left - next.left) < 6 ? prev : next));
    };
    measure();
    const id = window.setInterval(measure, 350);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('resize', measure);
    };
  }, [active, ref]);
  return insets;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setReduced(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return reduced;
}

/** Замер кадров в секунду (только с ?fps): сцена рисуется непрерывно, число — в углу */
function FpsProbe() {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  useEffect(() => {
    let raf = 0;
    const count = () => {
      frames.current++;
      raf = requestAnimationFrame(count);
    };
    raf = requestAnimationFrame(count);
    const id = window.setInterval(() => {
      setFps(frames.current);
      frames.current = 0;
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(id);
    };
  }, []);
  return <FpsLabel fps={fps} />;
}

function FpsLabel({ fps }: { fps: number }) {
  useEffect(() => {
    document.documentElement.dataset.fps = String(fps);
  }, [fps]);
  return null;
}
