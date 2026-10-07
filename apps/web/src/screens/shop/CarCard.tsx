// Карточка машины: на месте панели участка (3D — плавающее окно, «Панель» — боковая панель).
// Шесть блоков сверху вниз: кто это, где сейчас, прогресс по стадиям, когда будет готова, отметки,
// последние события. Весь маршрут и история — в паспорте автомобиля.
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Circle,
  Crosshair,
  CircleCheck,
  CircleDot,
  CircleX,
  Cpu,
  Drill,
  FileText,
  HardHat,
  Hourglass,
  MapPin,
  RadioTower,
  Route,
  ScanBarcode,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { MODEL_BY_ID, type BodyDetail, type BodyRouteStepView, type BodyView } from '@allur/contracts/ref';
import { api } from '../../api/client';
import { Drawer } from '../../components/overlay';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { closeCar, openPassport, startFollow, stopFollow, toggleCarPath, useView } from '../../state/view';
import { ENABLE_3D } from '../../lib/features';
import { webglSupport } from '../../lib/webgl';
import { WATCH_LIMIT, toggleWatch, useWatch } from '../../state/watch';
import {
  FLAG_TEXT,
  ON_PLAN_MIN,
  carEta,
  carWhere,
  lastEvents,
  shortVin,
  stageOperations,
  stageProgress,
  type CarStage,
  type EventKind,
} from '../../state/cars';
import { TONE_CLASS, cx } from '../../lib/tones';
import { duration, timeHM } from '../../lib/format';
import { FloatingWindow } from './AreaPanel';
import { useTranslation } from '../../i18n/store';
import { translateCarFlag, translateAreaName, translateDynamicText } from '../../i18n/translator';

/** Машина: то, что пришло по WebSocket (раз в секунду), и подробности с маршрутом (REST) */
function useCar(bodyId: string) {
  const live = useLive((s) => s.bodies.find((b) => b.bodyId === bodyId));
  const q = useQuery({
    queryKey: ['body', bodyId],
    queryFn: () => api<BodyDetail>(`/api/v1/bodies/${encodeURIComponent(bodyId)}`),
    refetchInterval: 3000,
  });
  const view: BodyView | undefined = live ?? q.data;
  return { view, detail: q.data, error: q.isError && !live };
}

export function CarCard({ bodyId, floating }: { bodyId: string; floating?: boolean }) {
  const { t } = useTranslation();
  const { view, detail, error } = useCar(bodyId);
  const title = view ? <CarTitle v={view} /> : <div className="text-[1.375rem] font-semibold leading-tight">{error ? t.carCard.notFound : '…'}</div>;
  const body = view ? (
    <CarBody v={view} detail={detail} />
  ) : (
    <p className="text-ink-2">{error ? t.carCard.bodyNotFound(bodyId) : t.common.loading}</p>
  );
  if (floating) {
    const collapsed = view ? `${MODEL_BY_ID[view.model].name} ${shortVin(view)}` : bodyId;
    return (
      <FloatingWindow key={bodyId} label={t.shop.openCarCard} title={title} collapsedTitle={collapsed} onClose={closeCar}>
        {body}
      </FloatingWindow>
    );
  }
  return (
    <Drawer open onClose={closeCar} title={title} width="w-[30rem]">
      {body}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// 1. Шапка: модель, цвет, VIN крупно (последние 6 знаков выделены), номер кузова, паспорт

function CarTitle({ v }: { v: BodyView }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="text-[1.25rem] font-semibold leading-tight">{MODEL_BY_ID[v.model].name}</span>
        {v.color ? (
          <span className="inline-flex items-center gap-1.5 text-base text-ink-2">
            <span className="size-3.5 shrink-0 rounded-full ring-1 ring-line-strong" style={{ background: v.color.hex }} aria-hidden />
            {v.color.name}
          </span>
        ) : (
          <span className="text-base text-ink-3">{t.cars.flagUnknownColor}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 flex-col">
          {v.vin ? <Vin vin={v.vin} /> : <span className="text-base text-ink-2">{t.carCard.vinNotYetApplied}</span>}
          <span className="font-mono text-sm text-ink-3">{t.carCard.bodyNumberLabel(v.bodyId)}</span>
        </span>
      </div>
    </div>
  );
}

/** Действия с машиной: следить, наблюдать, паспорт, путь в цеху — одной строкой над содержимым */
function CarActions({ v }: { v: BodyView }) {
  const { t } = useTranslation();
  const following = useView((s) => s.follow?.bodyId === v.bodyId);
  const watched = useWatch((s) => s.ids.includes(v.bodyId));
  const full = useWatch((s) => s.ids.length >= WATCH_LIMIT);
  const done = v.loc.kind === 'finished';
  const pathOn = useView((s) => s.carPath === v.bodyId);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!done && (
        <button
          type="button"
          onClick={() => (following ? stopFollow() : startFollow(v.bodyId))}
          aria-pressed={following}
          title={following ? 'Esc' : 'T'}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[0.9375rem] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            following ? 'bg-accent-bg text-accent-ink ring-1 ring-accent' : 'bg-accent text-white hover:bg-accent-ink',
          )}
        >
          <Crosshair className="size-4" strokeWidth={2.25} aria-hidden />
          {following ? t.shop.following : t.shop.follow}
        </button>
      )}
      <button
        type="button"
        onClick={() => toggleWatch(v.bodyId)}
        disabled={!watched && full}
        aria-pressed={watched}
        aria-label={watched ? t.carCard.removeFromWatch : t.carCard.addToWatch}
        title={watched ? t.carCard.removeFromWatch : full ? `max ${WATCH_LIMIT}` : t.carCard.addToWatch}
        className={cx(
          'grid size-8 place-items-center rounded-xl hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent',
          watched ? 'text-[#d9a514]' : 'text-ink-3',
        )}
      >
        <Star className={cx('size-5', watched && 'fill-current')} strokeWidth={2.25} aria-hidden />
      </button>
      <button
        type="button"
        disabled={!v.vin}
        onClick={() => v.vin && openPassport(v.vin)}
        title={v.vin ? t.carCard.openPassport : t.carCard.vinNotYetApplied}
        className="inline-flex items-center gap-1.5 rounded-xl bg-accent-bg px-3 py-1 text-base font-semibold text-accent-ink hover:bg-[#dfe8fb] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <FileText className="size-4" strokeWidth={2.25} aria-hidden />
        {t.carCard.openPassport}
      </button>
      {ENABLE_3D && webglSupport() !== 'none' && (
        <button
          type="button"
          onClick={() => toggleCarPath(v.bodyId)}
          aria-pressed={pathOn}
          title={pathOn ? t.carCard.hideRoutePath : t.carCard.showRoutePath}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[0.9375rem] font-semibold focus-visible:outline-2 focus-visible:outline-accent',
            pathOn ? 'bg-accent-bg text-accent-ink ring-1 ring-accent' : 'bg-accent-bg text-accent-ink hover:bg-[#dfe8fb]',
          )}
        >
          <Route className="size-4" strokeWidth={2.25} aria-hidden />
          {t.carCard.showRoutePath}
        </button>
      )}
    </div>
  );
}

export function Vin({ vin, className }: { vin: string; className?: string }) {
  return (
    <span className={cx('font-mono text-[1.25rem] leading-tight tracking-wide', className)} aria-label={`VIN ${vin}`}>
      <span className="text-ink-3">{vin.slice(0, -6)}</span>
      <span className="rounded bg-accent-bg px-0.5 font-semibold text-ink">{vin.slice(-6)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

function CarBody({ v, detail }: { v: BodyView; detail: BodyDetail | undefined }) {
  const { t, lang } = useTranslation();
  const plant = usePlantModel();
  const now = Date.parse(useLive((s) => s.snapshot?.now) ?? new Date().toISOString());
  const bodies = useLive((s) => s.bodies);
  const buffers = useLive((s) => s.snapshot?.buffers) ?? [];
  const where = carWhere(v, plant, now);
  const stages = stageProgress(v, plant, detail?.route);
  const eta = carEta(v, detail, plant, bodies, buffers, now);
  const events = detail ? lastEvents(detail.history) : [];
  const current = stages.find((s) => s.mark === 'now');
  return (
    <div className="flex flex-col gap-3 text-[0.9375rem] leading-snug">
      <CarActions v={v} />
      {/* 2. Где сейчас */}
      <Block title={t.carCard.whereNowTitle} quiet>
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" strokeWidth={2.25} aria-hidden />
          <div className="min-w-0">
            <div className="font-semibold text-ink">{where.title}</div>
            <div className={cx('num', where.tone === 'neutral' ? 'text-ink-2' : cx('font-semibold', TONE_CLASS[where.tone].ink))}>
              {where.detail}
              {v.flags.includes('delayed') ? ` · ${translateCarFlag('delayed', lang)}` : ''}
            </div>
          </div>
        </div>
      </Block>

      {/* 3. Прогресс по стадиям */}
      <Block title={t.carCard.stageProgressTitle} quiet>
        <StageRibbon stages={stages} />
        {current && detail && <CurrentOps stage={current} ops={stageOperations(detail.route, current.id)} />}
      </Block>

      {/* 4. Когда будет готова */}
      <Block title={t.carCard.etaTitle}>
        {!eta ? (
          <p className="text-ink-3">{t.carCard.calculating}</p>
        ) : eta.done ? (
          <p className="font-semibold text-ink">{t.carCard.readyInWarehouseAt(timeHM(eta.at))}</p>
        ) : (
          <div>
            <p className="num">
              <span className="font-semibold text-ink">{t.carCard.etaInWarehouse(timeHM(eta.at))}</span>
              <Lateness late={eta.lateMin} kit={v.loc.kind === 'warehouse'} />
            </p>
            <p className="text-sm text-ink-3">{t.carCard.etaEstimatedSubtitle}</p>
          </div>
        )}
      </Block>

      {/* 5. Отметки — только если есть */}
      {v.flags.length > 0 && (
        <Block title={t.carCard.marksTitle} quiet>
          <div className="flex flex-wrap gap-1.5">
            {v.flags.map((f) => (
              <span
                key={f}
                className={cx(
                  'rounded-md px-2 py-0.5 text-sm font-semibold',
                  f === 'delayed' || f === 'nonconformity' || f === 'rework' ? cx(TONE_CLASS.attention.bg, TONE_CLASS.attention.ink) : 'bg-surface-2 text-ink-2',
                )}
              >
                {translateCarFlag(f, lang)}
              </span>
            ))}
          </div>
        </Block>
      )}

      {/* 6. Последние события */}
      {events.length > 0 && (
        <Block title={t.carCard.recentEventsTitle} action={v.vin ? <PassportLink vin={v.vin} /> : undefined}>
          <ul className="flex flex-col gap-1">
            {events.map((e, i) => {
              const Icon = EVENT_ICON[e.kind];
              return (
                <li key={i} className="flex items-start gap-2">
                  <span title={e.label} className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-2">
                    <Icon className="size-3.5" strokeWidth={2.25} aria-label={e.label} />
                  </span>
                  <span className="num w-11 shrink-0 pt-0.5 text-sm text-ink-3">{timeHM(e.at)}</span>
                  <span className="min-w-0 flex-1 truncate pt-0.5" title={e.text}>
                    {translateDynamicText(e.text, lang)}
                    {e.restored && <span className="text-ink-3"> · {t.carCard.restoredMark}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      {!events.length && v.vin && <PassportLink vin={v.vin} />}
    </div>
  );
}

/** Блок карточки; quiet — подпись только для экранных читалок (содержимое говорит само за себя) */
function Block({ title, children, quiet, action }: { title: string; children: ReactNode; quiet?: boolean; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className={cx('flex items-baseline justify-between gap-2', quiet && 'sr-only')}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function PassportLink({ vin }: { vin: string }) {
  const { t } = useTranslation();
  return (
    <button type="button" onClick={() => openPassport(vin)} className="shrink-0 self-start rounded-lg px-1 text-[0.9375rem] font-semibold text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent">
      {t.carCard.allStagesDetail}
    </button>
  );
}

/** Отставание от плана; плана нет — машина ещё на складе или вход на сварку двойник не застал */
function Lateness({ late, kit }: { late: number | null; kit: boolean }) {
  const { t } = useTranslation();
  if (late === null) return kit ? <span className="text-ink-2"> · {t.carCard.notIssuedToProduction}</span> : null;
  if (Math.abs(late) < ON_PLAN_MIN) return <span className="text-ink-2"> · {t.carCard.etaOnPlan}</span>;
  if (late < 0) return <span className="text-ink-2"> · {t.carCard.aheadOfPlanBy(duration(-late))}</span>;
  return <span className={cx('font-semibold', TONE_CLASS.attention.ink)}> · {t.carCard.laggingPlanBy(duration(late))}</span>;
}

const EVENT_ICON: Record<EventKind, LucideIcon> = {
  scanner: ScanBarcode,
  rfid: RadioTower,
  plc: Cpu,
  tool: Drill,
  master: HardHat,
  onec: FileText,
  twin: Bot,
};

// ---------------------------------------------------------------------------
// Лента стадий: выполнено · сейчас · в очереди · впереди

function StageRibbon({ stages }: { stages: CarStage[] }) {
  const { t } = useTranslation();
  const markText = (m: CarStage['mark']) => (m === 'done' ? t.carCard.stageDone : m === 'now' ? t.carCard.stageNow : m === 'queue' ? t.carCard.stageQueueBefore : t.carCard.stageAhead);
  return (
    <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((s, i) => {
        const name = translateAreaName(s.name);
        return (
          <li key={s.id} className="flex min-w-0 flex-col items-center gap-1 text-center" aria-label={`${name}: ${markText(s.mark)}${s.loop ? `, ${t.carCard.repeatPass}` : ''}`}>
            <div className="relative flex w-full items-center justify-center">
              {i > 0 && <span className={cx('absolute right-1/2 top-1/2 h-0.5 w-full -translate-y-1/2', s.mark === 'ahead' || s.mark === 'queue' ? 'bg-line' : 'bg-st-neutral')} aria-hidden />}
              <StageDot mark={s.mark} />
            </div>
            <span className={cx('w-full truncate text-xs leading-tight', s.mark === 'now' ? 'font-semibold text-ink' : s.mark === 'ahead' ? 'text-ink-3' : 'text-ink-2')} title={name}>
              {name}
            </span>
            {s.loop > 0 && <span className={cx('rounded px-1 text-[0.6875rem] font-semibold leading-tight', TONE_CLASS.attention.bg, TONE_CLASS.attention.ink)}>×{s.loop + 1}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function StageDot({ mark }: { mark: CarStage['mark'] }) {
  const cls = 'relative size-5 rounded-full bg-surface';
  if (mark === 'done') return <CircleCheck className={cx(cls, 'text-st-neutral')} strokeWidth={2.5} aria-hidden />;
  if (mark === 'now') return <CircleDot className={cx(cls, 'text-accent')} strokeWidth={2.75} aria-hidden />;
  if (mark === 'queue') return <Hourglass className={cx(cls, 'p-0.5 text-st-waiting')} strokeWidth={2.5} aria-hidden />;
  return <Circle className={cx(cls, 'text-line-strong')} strokeWidth={2} aria-hidden />;
}

/** Операции текущей стадии: свёрнуто — одна строка, развёрнуто — список с галочками */
function CurrentOps({ stage, ops }: { stage: CarStage; ops: BodyRouteStepView[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!ops.length) return null;
  const done = ops.filter((o) => o.status === 'done').length;
  const next = ops.find((o) => o.status !== 'done' && o.status !== 'skipped');
  const stageName = translateAreaName(stage.name);
  return (
    <div className="rounded-xl bg-surface px-3 py-2 shadow-card">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex w-full items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-accent">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{stageName}:</span>{' '}
          <span className="num text-ink-2">
            {t.carCard.opsDoneOf(done, ops.length)}{next ? ` · ${t.carCard.nextOp(next.name.toLowerCase())}` : ''}
          </span>
        </span>
        {open ? <ChevronUp className="size-4 shrink-0 text-ink-3" aria-hidden /> : <ChevronDown className="size-4 shrink-0 text-ink-3" aria-hidden />}
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {ops.map((o, i) => (
            <li key={i} className="flex items-center gap-2">
              {o.status === 'done' ? (
                <CircleCheck className="size-4 shrink-0 text-st-neutral" strokeWidth={2.5} aria-label={t.carCard.stageDone} />
              ) : o.status === 'failed' ? (
                <CircleX className={cx('size-4 shrink-0', TONE_CLASS.attention.ink)} strokeWidth={2.5} aria-label="failed" />
              ) : (
                <Circle className="size-4 shrink-0 text-line-strong" strokeWidth={2} aria-label={t.carCard.stageAhead} />
              )}
              <span className={cx('min-w-0 flex-1 truncate', o.status === 'done' ? 'text-ink-2' : 'text-ink')}>
                {o.name}
                {o.optional ? <span className="text-ink-3"> · {t.carCard.optionalOp}</span> : null}
              </span>
              {o.at && <span className="num shrink-0 text-sm text-ink-3">{timeHM(o.at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
