// 3D-модель цеха (отдельный чанк, грузится лениво). Состояние — те же данные, что у «Панели»:
// снимок двойника, детали участков, инциденты. Клик по зоне — панель участка, по плашке — инцидент.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ArrowLeft, CircleHelp, Info, Mouse, MousePointerClick, Route, WifiOff, X } from 'lucide-react';
import { MODEL_BY_ID, inflectLower, type AreaId, type BodyDetail, type BodyView, type LiveSnapshot } from '@allur/contracts/ref';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { backToPlant, clearCarPath, openAreaPanel, selectArea, selectCar, setTour, useView } from '../../state/view';
import { EQUIPMENT_STATUS, TONE_CLASS, cx } from '../../lib/tones';
import { num, pct0 } from '../../lib/format';
import { buildLayout, type PlantLayout } from './layout';
import { readPalette } from './palette';
import { BodyFlow } from './flow';
import { useSceneData, type SceneData } from './useSceneData';
import { Scene } from './Scene';
import { CameraRig, type Insets } from './CameraRig';
import type { HoverTarget } from './equipment';
import { cameraCommands, hintSeen, markHintSeen, notePointerDown } from './controls';
import { escLayerOpen, useEscLayer } from '../../components/overlay';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { shortVin } from '../../state/cars';
import { hoverPickable, setHover, useHover } from './hover';
import { FilterBar } from './FilterBar';
import { ReplayBar } from './ReplayBar';
import { buildReplay } from './replay';
import { useReplay } from '../../state/replay';
import { FollowBar } from '../../screens/shop/FollowBar';
import { useTranslation } from '../../i18n/store';
import { translateArea, translateDynamicText, translateEquipmentName, translateEquipmentStatus, translateStatus } from '../../i18n/translator';
import type { Lang } from '../../i18n/types';

/** Пресеты камеры: весь цех и каждый производственный участок */
function presets(layout: PlantLayout, lang: Lang): { label: string; area: AreaId | null }[] {
  const entireShop = lang === 'kk' ? 'Бүкіл цех' : lang === 'en' ? 'Entire shop' : 'Весь цех';
  return [{ label: entireShop, area: null }, ...layout.producing.map((id) => ({ label: translateArea(id, lang, 'short') || layout.names[id]?.short || id, area: id }))];
}

/** «Очередь перед окраской» */
function bufferName(layout: PlantLayout, id: string, lang: Lang): string {
  const to = layout.bufferOrder.find((b) => b.id === id)?.to;
  const short = to ? (translateArea(to, lang, 'short') || layout.names[to]?.short) : undefined;
  if (!short) return lang === 'kk' ? 'Кезек' : lang === 'en' ? 'Queue' : 'Очередь';
  if (lang === 'kk') return `${short} алдындағы кезек`;
  if (lang === 'en') return `Queue before ${short}`;
  return `Очередь перед ${inflectLower(short, 'ins')}`;
}

export default function Plant3DView({ active, onLost }: { active: boolean; onLost: () => void }) {
  const snapshot = useLive((s) => s.snapshot);
  if (!snapshot || !snapshot.ready) return null;
  return <PlantScene snapshot={snapshot} active={active} onLost={onLost} />;
}

function PlantScene({ snapshot: s, active, onLost }: { snapshot: LiveSnapshot; active: boolean; onLost: () => void }) {
  const model = usePlantModel();
  const layout = useMemo(() => buildLayout(model), [model]);
  const palette = useMemo(readPalette, []);
  const flow = useMemo(() => new BodyFlow(layout), [layout]);
  const data = useSceneData(s);
  const area = useView((v) => v.area);
  const equipment = useView((v) => v.equipment);
  const tour = useView((v) => v.tour);
  const carPath = useView((v) => v.carPath);
  // повтор истории: снимок маршрута на момент запуска (дальше история не нужна — повтор не «живой»)
  const replayId = useReplay((r) => r.bodyId);
  const replayQ = useQuery({
    queryKey: ['replay', replayId],
    queryFn: () => api<BodyDetail>(`/api/v1/bodies/${encodeURIComponent(replayId!)}`),
    enabled: !!replayId,
    staleTime: Infinity,
  });
  const replay = useMemo(() => (replayId && replayQ.data?.bodyId === replayId ? buildReplay(replayQ.data, layout, model) : null), [replayId, replayQ.data, layout, model]);
  const stageName = useCallback((id: string) => layout.names[id]?.short ?? id, [layout]);
  // повтор начался — показываем весь цех: путь машины виден целиком
  useEffect(() => {
    if (replayId && active) cameraCommands()?.home();
  }, [replayId, active]);
  // маршрут машины для пути — тот же запрос и кэш, что у карточки
  const pathQ = useQuery({
    queryKey: ['body', carPath],
    queryFn: () => api<BodyDetail>(`/api/v1/bodies/${encodeURIComponent(carPath!)}`),
    enabled: !!carPath,
    refetchInterval: 3000,
  });
  const car = useView((v) => v.car);
  const conn = useLive((x) => x.conn);
  const reducedMotion = useReducedMotion();
  const hostRef = useRef<HTMLDivElement>(null);
  const insets = useInsets(hostRef, active);
  const pointer = useRef({ x: 0, y: 0 });
  const tipRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const showFps = useMemo(() => new URLSearchParams(location.search).has('fps'), []);

  // Esc: сначала закрывается открытое окно (у него свой обработчик), потом — возврат к общему плану
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || escLayerOpen()) return;
      const v = useView.getState();
      if (v.area || v.equipment) backToPlant();
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

  // курсор как в картах: «рука» над сценой, «сжатая рука» при перемещении, «палец» над тем, что можно выбрать.
  // Меняется напрямую в DOM: движение мыши не перерисовывает сцену
  const dragging = useRef(false);
  const syncCursor = () => {
    const host = hostRef.current;
    if (host) host.style.cursor = dragging.current ? 'grabbing' : hoverPickable(useHover.getState().target) ? 'pointer' : 'grab';
  };
  useEffect(() => {
    syncCursor();
    const unsub = useHover.subscribe(syncCursor);
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      syncCursor();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      unsub();
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setHover(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hint = useControlsHint(active);

  const moveTip = () => {
    const el = tipRef.current;
    const host = hostRef.current;
    if (!el || !host) return;
    const w = host.clientWidth;
    const x = pointer.current.x + 16 + el.offsetWidth > w ? pointer.current.x - el.offsetWidth - 12 : pointer.current.x + 16;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(pointer.current.y + 16)}px)`;
  };

  const { t, lang } = useTranslation();
  const incidentsOnScene = useMemo(() => data.plaques.map((p) => ({ id: p.incidentId, area: p.area })), [data.plaques]);
  const ghost = !(data.plcConnected && s.stage >= 1);

  return (
    <section
      ref={hostRef}
      aria-label={sceneSummary(data, lang)}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Q E + - F Home Escape"
      tabIndex={0}
      data-scene-keys
      className="absolute inset-0 isolate overflow-hidden bg-page focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent"
      onPointerDownCapture={(e) => {
        notePointerDown(e);
        hint.dismiss();
        if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
        if (e.button === 0) {
          dragging.current = true;
          syncCursor();
        }
        // клавиши управляют камерой, пока фокус на сцене
        e.currentTarget.focus({ preventScroll: true });
      }}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={hint.dismiss}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (sceneKey(e.nativeEvent)) {
          e.preventDefault();
          hint.dismiss();
        }
      }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        moveTip();
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
          pathDetail={carPath && pathQ.data?.bodyId === carPath ? pathQ.data : null}
          replay={replay}
          stageName={stageName}
          selectedCar={car}
          onHover={setHover}
          onPick={openAreaPanel}
          onPickCar={selectCar}
        />
        <BodiesSync flow={flow} reducedMotion={reducedMotion} />
        <CameraRig layout={layout} flow={flow} area={area} equipment={equipment} insets={insets} tour={tour} incidents={incidentsOnScene} onUserControl={() => setTour(false)} />
        {showFps && <FpsProbe />}
      </Canvas>
      {/* подписи и плашки сцены — в постоянном слое поверх холста */}
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />

      <HoverTip tipRef={tipRef} onShow={moveTip} data={data} snapshot={s} layout={layout} />

      <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 print:hidden">
        {conn !== 'open' && (
          <Chip tone="attention" icon={<WifiOff className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />}>
            {lang === 'kk' ? 'Егізбен байланыс жоқ — соңғы белгілі күй көрсетілген' : lang === 'en' ? 'No connection to twin — showing last known state' : 'Нет связи с двойником — показано последнее известное состояние'}
          </Chip>
        )}
        {ghost && (
          <Chip icon={<Info className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />}>
            {s.stage === 0 ? (lang === 'kk' ? '0-деңгей · ' : lang === 'en' ? 'Stage 0 · ' : 'Ступень 0 · ') : ''}
            {lang === 'kk' ? 'Жабдық күйі VIN өтуі бойынша анықталады (1С:MES)' : lang === 'en' ? 'Equipment state determined by VIN pass (1C:MES)' : 'Состояние оборудования определяется по проходу VIN (1С:MES)'}
          </Chip>
        )}
        {carPath && <PathChip bodyId={carPath} />}
        {tour && (
          <Chip icon={<MousePointerClick className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />}>
            {lang === 'kk' ? 'Автокөрсетілім · тоқтату үшін кез келген басу' : lang === 'en' ? 'Autotour · click or key to stop' : 'Автопоказ · любой клик или клавиша — остановить'}
          </Chip>
        )}
        {hint.shown && !tour && (
          <span role="status" className="view-in inline-flex items-center gap-1.5 rounded-xl bg-ink/90 px-3 py-1.5 text-[0.9375rem] font-medium text-white shadow-card">
            <Mouse className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
            {getControlsHint(lang)}
          </span>
        )}
        {active && replayId && <ReplayBar bodyId={replayId} replay={replay} loading={replayQ.isLoading} stageName={stageName} />}
        {active && <FollowBar />}
        <FilterBar />
        <div data-occluder="bottom" className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-2xl bg-surface p-1 shadow-card ring-1 ring-line">
          {area && (
            <button type="button" onClick={backToPlant} className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-1.5 text-base font-semibold text-white hover:bg-ink-2">
              <ArrowLeft className="size-4" strokeWidth={2.5} aria-hidden />
              {lang === 'kk' ? 'Цехқа оралу' : lang === 'en' ? 'Back to plant' : 'Вернуться к цеху'}
            </button>
          )}
          {presets(layout, lang).map((p) => {
            const on = p.area === area && !equipment;
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={on}
                // пресет кадрирует заново и тогда, когда участок уже выбран, а камеру увели (колесо, поиск)
                onClick={() => (!p.area ? cameraCommands()?.home() : p.area === area ? cameraCommands()?.frame() : selectArea(p.area))}
                className={cx('rounded-xl px-3 py-1.5 text-base font-semibold transition-colors', on ? 'bg-accent-bg text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={hint.show}
            aria-label={lang === 'kk' ? 'Камераны қалай басқару керек' : lang === 'en' ? 'Camera controls help' : 'Как управлять камерой'}
            title={lang === 'kk' ? 'Камераны қалай басқару керек' : lang === 'en' ? 'Camera controls help' : 'Как управлять камерой'}
            className="grid size-9 place-items-center rounded-xl text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <CircleHelp className="size-5" strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}

/** Подсказка по управлению: на сенсорном экране — жесты пальцами */
function getControlsHint(lang: Lang): string {
  const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (isTouch) {
    if (lang === 'kk') return 'Бір саусақ: жылжыту · Екі саусақ: масштаб және бұру · Екі рет түрту: жақындату';
    if (lang === 'en') return 'One finger: pan · Two fingers: zoom & rotate · Double tap: zoom in';
    return 'Один палец: перемещение · Два пальца: масштаб и поворот · Двойное касание: приблизить';
  }
  if (lang === 'kk') return 'ТБТ: жылжыту · ОСТ: бұру · Дөңгелек: масштаб · Қос шерту: жақындату';
  if (lang === 'en') return 'LMB: pan · RMB: rotate · Wheel: zoom · Double click: zoom in';
  return 'ЛКМ: перемещение · ПКМ: поворот · Колесо: масштаб · Двойной клик: приблизить';
}

/** При первом открытии 3D — плашка с управлением; исчезает через 6 секунд или после первого действия */
function useControlsHint(active: boolean) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active || hintSeen()) return;
    setShown(true);
    markHintSeen();
  }, [active]);
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(false), 6000);
    return () => window.clearTimeout(t);
  }, [shown]);
  return {
    shown,
    show: () => setShown(true),
    dismiss: () => setShown(false),
  };
}

/**
 * Клавиши камеры, когда фокус на сцене (по физической клавише — работает и в русской раскладке):
 * стрелки и WASD — перемещение, Q/E — поворот, +/− — масштаб, F — к выбранному, Home — весь цех.
 */
function sceneKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const cam = cameraCommands();
  if (!cam) return false;
  const step = e.shiftKey ? 0.3 : 0.12;
  switch (e.code) {
    case 'ArrowLeft':
    case 'KeyA':
      cam.pan(-step, 0);
      return true;
    case 'ArrowRight':
    case 'KeyD':
      cam.pan(step, 0);
      return true;
    case 'ArrowUp':
    case 'KeyW':
      cam.pan(0, step);
      return true;
    case 'ArrowDown':
    case 'KeyS':
      cam.pan(0, -step);
      return true;
    case 'KeyQ':
      cam.rotate(0.2);
      return true;
    case 'KeyE':
      cam.rotate(-0.2);
      return true;
    case 'Equal':
    case 'NumpadAdd':
      cam.zoom(1);
      return true;
    case 'Minus':
    case 'NumpadSubtract':
      cam.zoom(-1);
      return true;
    case 'KeyF':
      cam.focus();
      return true;
    case 'Home':
      cam.home();
      return true;
  }
  return false;
}

/** Кузова: каждое обновление трекера доводит картинку до состояния данных (без перерисовки сцены) */
function BodiesSync({ flow, reducedMotion }: { flow: BodyFlow; reducedMotion: boolean }) {
  const bodies = useLive((x) => x.bodies);
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => {
    flow.update(bodies, performance.now(), reducedMotion);
    invalidate();
  }, [bodies, flow, reducedMotion, invalidate]);
  return null;
}

/** Подсказка при наведении: подписана на стор наведения сама, сцену не трогает */
function HoverTip({
  tipRef,
  onShow,
  data,
  snapshot,
  layout,
}: {
  tipRef: React.RefObject<HTMLDivElement | null>;
  onShow: () => void;
  data: SceneData;
  snapshot: LiveSnapshot;
  layout: PlantLayout;
}) {
  const hover = useHover((h) => h.target);
  const bodies = useLive((x) => (hover?.kind === 'body' ? x.bodies : null));
  useEffect(onShow, [hover]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hover) return null;
  return (
    <div ref={tipRef} className="pointer-events-none absolute left-0 top-0 z-40 max-w-[18rem] rounded-xl bg-surface px-3 py-2 text-base shadow-pop ring-1 ring-line">
      <TipContent hover={hover} data={data} snapshot={snapshot} layout={layout} bodies={bodies ?? []} />
    </div>
  );
}

/** Плашка пути: чья машина; крестик и Esc скрывают путь */
function PathChip({ bodyId }: { bodyId: string }) {
  const { t, lang } = useTranslation();
  const car = useLive((x) => x.bodies.find((b) => b.bodyId === bodyId));
  useEscLayer(clearCarPath);
  const carName = car ? `${MODEL_BY_ID[car.model].short} ${shortVin(car)}` : bodyId;
  const pathTitle = lang === 'kk' ? `Шанақ бағыты: ${carName}` : lang === 'en' ? `Car route: ${carName}` : `Путь машины ${carName}`;
  const legend = lang === 'kk'
    ? '· өткені — тұтас, алда — үзік, қайталау — қызғылт сары'
    : lang === 'en'
    ? '· completed — solid, ahead — dashed, loops — orange'
    : '· пройдено — линия, впереди — пунктир, петли — оранжевым';

  return (
    <span className="view-in pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-accent-bg py-1 pl-3 pr-1 text-[0.9375rem] font-semibold text-accent-ink shadow-card ring-1 ring-accent">
      <Route className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
      {pathTitle}
      <span className="font-normal text-accent-ink/80">{legend}</span>
      <button type="button" onClick={clearCarPath} aria-label={t.common.close} className="grid size-7 place-items-center rounded-lg hover:bg-surface">
        <X className="size-4" />
      </button>
    </span>
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
function TipContent({ hover, data, snapshot, layout, bodies }: { hover: HoverTarget; data: SceneData; snapshot: LiveSnapshot; layout: PlantLayout; bodies: BodyView[] }) {
  const { t, lang } = useTranslation();
  if (hover.kind === 'body') {
    const b = bodies.find((x) => x.bodyId === hover.id);
    return b ? <BodyTip b={b} layout={layout} data={data} now={snapshot.now} /> : null;
  }
  if (hover.kind === 'zone') {
    const r = data.rows[hover.id];
    if (!r) return null;
    const Icon = r.status.icon;
    const localizedZoneName = translateArea(hover.id, lang, 'name') || r.name;
    return (
      <div className="flex flex-col gap-1 leading-snug">
        <div className="font-semibold text-ink">{localizedZoneName}</div>
        <div className={cx('inline-flex items-center gap-1.5 font-semibold', r.status.tone === 'neutral' ? 'text-st-neutral-ink' : TONE_CLASS[r.status.tone].ink)}>
          <Icon className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
          {translateStatus(r.status.label, lang)}
        </div>
        {r.output && (
          <div className="num text-ink-2">
            {lang === 'kk' ? (
              <>Шығарылым <span className="font-semibold text-ink">{r.output.done}</span> / {r.output.plan} қазіргі сәтке</>
            ) : lang === 'en' ? (
              <>Output <span className="font-semibold text-ink">{r.output.done}</span> of {r.output.plan} to now</>
            ) : (
              <>Выпуск <span className="font-semibold text-ink">{r.output.done}</span> из {r.output.plan} к этому моменту</>
            )}
          </div>
        )}
        {r.metric && <div className={r.metric.tone === 'neutral' ? 'text-ink-2' : TONE_CLASS[r.metric.tone].ink}>{translateDynamicText(r.metric.text, lang)}</div>}
        {r.reason && <div className={cx('text-sm', r.reason.tone === 'neutral' ? 'text-ink-2' : TONE_CLASS[r.reason.tone].ink)}>{translateDynamicText(r.reason.text, lang)}</div>}
        <div className="text-sm text-ink-3">
          {lang === 'kk' ? 'Шерту — учаске панелі' : lang === 'en' ? 'Click — area panel' : 'Клик — панель участка'}
        </div>
      </div>
    );
  }
  if (hover.kind === 'equipment') {
    const e = data.equipment[hover.id];
    const st = e?.status ? EQUIPMENT_STATUS[e.status] : null;
    const live = data.plcConnected && snapshot.stage >= 1;
    return (
      <div className="flex flex-col gap-1 leading-snug">
        <div className="font-semibold text-ink">{translateEquipmentName(e?.name ?? hover.id, lang)}</div>
        {live && st ? (
          <div className={cx('font-semibold', st.tone === 'neutral' ? 'text-st-neutral-ink' : TONE_CLASS[st.tone].ink)}>
            {translateEquipmentStatus(st.label, lang)}
            {e?.code ? ` · ${lang === 'kk' ? 'код:' : lang === 'en' ? 'code' : 'код'} ${e.code}` : ''}
          </div>
        ) : (
          <div className="text-ink-3">
            {lang === 'kk' ? 'контроллер дерегі жоқ — күй 1С:MES бойынша' : lang === 'en' ? 'no PLC telemetry — state via 1C:MES' : 'нет данных контроллера — состояние по 1С:MES'}
          </div>
        )}
        {live && e?.text && e.status !== 'run' && <div className="text-sm text-ink-2">{translateDynamicText(e.text, lang)}</div>}
        {e?.resourceLeft !== null && e?.resourceLeft !== undefined && <div className="num text-ink-2">{t.shop.resourceToMaint(pct0(e.resourceLeft))}</div>}
        {live && e?.dp !== null && e?.dp !== undefined && (
          <div className="num text-ink-2">
            {lang === 'kk' ? 'сүзгі' : lang === 'en' ? 'filter' : 'фильтр'} {num(e.dp)} {lang === 'en' ? 'Pa' : 'Па'} · {t.shop.normUpTo(250)}
          </div>
        )}
        <div className="text-sm text-ink-3">
          {lang === 'kk' ? 'Шерту — учаске панелі' : lang === 'en' ? 'Click — area panel' : 'Клик — панель участка'}
        </div>
      </div>
    );
  }
  if (hover.kind === 'buffer') {
    const b = snapshot.buffers.find((x) => x.id === hover.id);
    if (!b) return null;
    return (
      <div className="leading-snug">
        <div className="font-semibold text-ink">{bufferName(layout, b.id, lang)}</div>
        <div className="num text-ink-2">
          {t.panel.inQueue(b.count, b.capacity)}
        </div>
      </div>
    );
  }
  const sensor = data.sensors.find((x) => x.equipmentId === hover.id);
  if (!sensor) return null;
  return (
    <div className="flex flex-col gap-0.5 leading-snug">
      <div className="font-semibold text-ink">{translateDynamicText(sensor.label, lang)}</div>
      {sensor.values.map((v) => (
        <div key={v.name} className="num text-ink-2">
          {translateDynamicText(v.name, lang)}: <span className="font-semibold text-ink">{translateDynamicText(v.value, lang)}</span>
        </div>
      ))}
    </div>
  );
}

/** Описание для экранных читалок: 3D — не единственный способ узнать состояние цеха */
function sceneSummary(data: SceneData, lang: Lang): string {
  const bad = Object.values(data.rows).filter((r) => r && r.status.tone !== 'neutral');
  if (lang === 'kk') {
    if (!bad.length) return 'Цехтың 3D-үлгісі. Барлық учаскелер ауытқусыз жұмыс істеуде. Толық мәліметтер «Панель» режимінде.';
    return `Цехтың 3D-үлгісі. ${bad.map((r) => `${translateArea(r!.id, 'kk', 'name')}: ${translateStatus(r!.status.label, 'kk').toLowerCase()}${r!.reason ? ` — ${translateDynamicText(r!.reason.text, 'kk')}` : ''}`).join('; ')}. Толық мәліметтер «Панель» режимінде.`;
  }
  if (lang === 'en') {
    if (!bad.length) return '3D shop model. All areas operating normally. Details in "Panel" mode.';
    return `3D shop model. ${bad.map((r) => `${translateArea(r!.id, 'en', 'name')}: ${translateStatus(r!.status.label, 'en').toLowerCase()}${r!.reason ? ` — ${translateDynamicText(r!.reason.text, 'en')}` : ''}`).join('; ')}. Details in "Panel" mode.`;
  }
  if (!bad.length) return '3D-модель цеха. Все участки работают без отклонений. Подробности — в режиме «Панель».';
  return `3D-модель цеха. ${bad.map((r) => `${r!.name}: ${r!.status.label.toLowerCase()}${r!.reason ? ` — ${r!.reason.text}` : ''}`).join('; ')}. Подробности — в режиме «Панель».`;
}

/** Подсказка кузова: модель и VIN, цвет из заказа, где он и сколько там против нормы */
function BodyTip({ b, layout, data, now }: { b: BodyView; layout: PlantLayout; data: SceneData; now: string }) {
  const { t, lang } = useTranslation();
  const stage = layout.names[b.loc.stageId];
  const stageName = translateArea(b.loc.stageId, lang, 'short') || stage?.short || b.loc.stageId;
  const eq = b.loc.equipmentId ? (data.equipment[b.loc.equipmentId]?.name ?? layout.equipment.find((e) => e.id === b.loc.equipmentId)?.name) : undefined;
  const localizedEq = eq ? translateEquipmentName(eq, lang) : undefined;
  const min = Math.max(0, Math.round((Date.parse(now) - Date.parse(b.since)) / 60_000));
  const norm = b.normSec ? Math.max(1, Math.round(b.normSec / 60)) : null;
  const delayed = b.flags.includes('delayed');
  let where: string;
  if (b.loc.kind === 'warehouse') where = lang === 'kk' ? 'Қоймадағы машина жиынтығы, дәнекерлеуге берілуін күтуде' : lang === 'en' ? 'Assembly kit in warehouse, waiting for welding' : 'Машинокомплект на складе, ждёт выдачи на сварку';
  else if (b.loc.kind === 'finished') where = lang === 'kk' ? 'Дайын өнімдер қоймасында' : lang === 'en' ? 'In finished goods warehouse' : 'На складе готовой продукции';
  else if (b.loc.kind === 'buffer') where = lang === 'kk' ? `«${stageName}» учаскесінен кейінгі кезекте` : lang === 'en' ? `In queue after area "${stageName}"` : `В очереди после участка «${stageName}»`;
  else if (b.loc.precision === 'stage') {
    const unspec = lang === 'kk' ? 'нақты орны белгіленбеген' : lang === 'en' ? 'exact location not marked' : 'точное место не отмечено';
    const normEq = localizedEq ? (lang === 'kk' ? `, уақыт нормасы бойынша — ${localizedEq}` : lang === 'en' ? `, by time standard — ${localizedEq}` : `, по норме времени — ${localizedEq}`) : '';
    where = `${stageName} (${unspec}${normEq})`;
  } else where = `${stageName}${localizedEq ? `, ${localizedEq}` : ''}`;

  const nonconformityText = lang === 'kk' ? 'сәйкессіздік бар' : lang === 'en' ? 'nonconformity' : 'есть несоответствие';
  const reworkText = lang === 'kk' ? 'қайта өңдеу' : lang === 'en' ? 'rework pass' : 'повторный проход';
  const restoredText = lang === 'kk' ? 'белгілердің бір бөлігі бағыт бойынша қалпына келтірілді' : lang === 'en' ? 'some marks restored along route' : 'часть отметок восстановлена по маршруту';

  return (
    <div className="flex flex-col gap-1 leading-snug">
      <div className="font-semibold text-ink">
        {MODEL_BY_ID[b.model].name} · {b.vin ? `VIN …${b.vin.slice(-5)}` : `${lang === 'kk' ? 'шанақ' : lang === 'en' ? 'body' : 'кузов'} ${b.bodyId}`}
      </div>
      <div className="flex items-center gap-1.5 text-ink-2">
        {b.color ? (
          <>
            <span className="size-3 shrink-0 rounded-full ring-1 ring-line-strong" style={{ background: b.color.hex }} aria-hidden />
            {translateDynamicText(b.color.name, lang)}
          </>
        ) : (
          <span className="text-ink-3">{lang === 'kk' ? 'Түс 1С-тен берілмеген' : lang === 'en' ? 'Color not specified in 1C' : 'Цвет не передан из 1С'}</span>
        )}
      </div>
      <div className="text-ink-2">{where}</div>
      <div className={cx('num', delayed ? cx('font-semibold', TONE_CLASS.attention.ink) : 'text-ink-2')}>
        {min} {t.common.minuteUnit}
        {norm && b.loc.kind !== 'buffer' ? (lang === 'kk' ? ` / норма ${norm}` : lang === 'en' ? ` of ${norm} target` : ` из ${norm} по норме`) : b.loc.kind === 'buffer' ? (lang === 'kk' ? ' кезекте' : lang === 'en' ? ' in queue' : ' в очереди') : ''}
        {delayed ? (lang === 'kk' ? ' · кешігуде' : lang === 'en' ? ' · delayed' : ' · задерживается') : ''}
      </div>
      {(b.flags.includes('nonconformity') || b.flags.includes('rework') || b.flags.includes('restored_checkpoint')) && (
        <div className="text-sm text-ink-3">
          {[b.flags.includes('nonconformity') && nonconformityText, b.flags.includes('rework') && reworkText, b.flags.includes('restored_checkpoint') && restoredText].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="text-sm text-ink-3">
        {lang === 'kk' ? 'Шерту — шанақ карточкасы' : lang === 'en' ? 'Click — car card' : 'Клик — карточка машины'}
      </div>
    </div>
  );
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
