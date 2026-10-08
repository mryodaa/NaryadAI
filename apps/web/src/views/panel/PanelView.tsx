import { Fragment } from 'react';
import { ArrowDown, ChevronDown, CircleSlash, Crosshair, Hourglass } from 'lucide-react';
import { MODEL_BY_ID, type BufferView, type LiveSnapshot, type PlantModel } from '@allur/contracts/ref';
import { usePaintDefect } from '../../api/queries';
import { Card } from '../../components/ui';
import { areaRows, bufferAfter, type AreaRowView, type TextView } from '../../state/selectors';
import { selectArea, useView } from '../../state/view';
import { useLive } from '../../state/live';
import { shortVin } from '../../state/cars';
import { usePlantModel } from '../../state/plant';
import { TONE_CLASS, cx } from '../../lib/tones';
import { timeHM } from '../../lib/format';
import { ShiftTimeline } from '../../screens/shop/ShiftTimeline';
import { AreaDetails } from './AreaDetails';
import { StatusMark } from './StatusMark';
import { useTranslation } from '../../i18n/store';
import { translateArea, translateDynamicText } from '../../i18n/translator';
import type { Translations } from '../../i18n/types';

/**
 * Колонки списка: участок · статус · выпуск · главный показатель · что происходит · стрелка раскрытия.
 * Минимумы подобраны под 1366: статус «Работает с браком» и причина вида «Камера-02: фильтр забит (346 Па)» не режутся.
 */
const GRID =
  'grid grid-cols-[minmax(11rem,0.9fr)_minmax(11rem,0.9fr)_minmax(6rem,0.5fr)_minmax(10rem,0.8fr)_minmax(0,1.6fr)_1rem] items-center gap-x-3';
/** На телефоне — две колонки: участок и статус, ниже выпуск и показатель, «что происходит» — во всю ширину */
const COLS = `${GRID} max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-1 max-md:[&>*:nth-child(5)]:col-span-2 max-md:[&>*:nth-child(6)]:hidden max-md:[&>*:first-child]:break-words`;

/** На 1366 строки чуть мельче, чтобы пять колонок вставали в одну строку */
const ROW_TEXT = 'text-[0.9375rem] 2xl:text-base';

export function PanelView({ snapshot: s, onIncident }: { snapshot: LiveSnapshot; onIncident: (id: string) => void }) {
  const { t, lang } = useTranslation();
  const paintDefect = usePaintDefect(s);
  const selected = useView((v) => v.area);
  const model = usePlantModel();
  const rows = areaRows(s, paintDefect, model);
  // слежение в «Панели»: подсвечен участок, где машина сейчас (из очереди — участок, куда она едет)
  const followArea = useView((v) => v.follow?.bodyId ?? null);
  const followed = useLive((x) => (followArea ? x.bodies.find((b) => b.bodyId === followArea) : undefined));
  const followStage = followed ? (followed.loc.kind === 'buffer' && followed.loc.bufferId ? model.bufferById.get(followed.loc.bufferId)?.to : followed.loc.stageId) : undefined;
  const inQueueLabel = lang === 'kk' ? ' · кезекте' : lang === 'en' ? ' · in queue' : ' · в очереди';

  return (
    <div className="view-in flex flex-col gap-3 xl:gap-4">
      <Card className="overflow-hidden">
        <div className={cx(COLS, 'border-b border-line px-3.5 py-2 text-sm font-semibold leading-tight text-ink-3 max-md:hidden')} aria-hidden>
          <span>{t.panel.colArea}</span>
          <span>{t.panel.colStatus}</span>
          <span>{t.panel.colOutput(timeHM(s.now))}</span>
          <span>{t.panel.colMetric}</span>
          <span>{t.panel.colHappening}</span>
          <span />
        </div>
        {rows.map((r) => {
          const b = bufferAfter(s, r.id, model);
          return (
            <Fragment key={r.id}>
              <AreaRow
                row={r}
                open={selected === r.id}
                shiftRunning={!!s.shift}
                lines={linesOf(model, r.id, t)}
                car={followStage === r.id && followed ? `${MODEL_BY_ID[followed.model].short} ${shortVin(followed)}${followed.loc.kind === 'buffer' ? inQueueLabel : ''}` : null}
              />
              {b && <BufferRow b={b} />}
            </Fragment>
          );
        })}
      </Card>
      {s.shift && <ShiftTimeline shift={s.shift} now={s.now} timeline={s.timeline} onIncident={onIncident} />}
    </div>
  );
}

/** Параллельные линии участка коротко: «Линии: Onix · Cobalt · J7» (линия под одну модель — по модели) */
function linesOf(model: PlantModel, area: string, t: Translations): string | null {
  const st = model.stageById.get(area)?.stations ?? [];
  if (st.length < 2) return null;
  return t.panel.linesLabel(st.map((x) => (x.models?.length === 1 ? MODEL_BY_ID[x.models[0]!].short : x.name)).join(' · '));
}

function AreaRow({ row, open, shiftRunning, lines, car }: { row: AreaRowView; open: boolean; shiftRunning: boolean; lines: string | null; car: string | null }) {
  const { t, lang } = useTranslation();
  // у склада готовой продукции нет оборудования и графика — раскрывать нечего
  const expandable = row.kind !== 'warehouse_out';
  const deviation = row.status.tone !== 'neutral';
  const detailsId = `area-details-${row.id}`;
  const localizedAreaName = translateArea(row.id, lang, 'name') || row.name;
  const cells = (
    <>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="font-semibold">{localizedAreaName}</span>
        {lines && <span className="mt-0.5 text-sm text-ink-3">{lines}</span>}
        {car && (
          <span className="mt-1 inline-flex items-center gap-1 self-start rounded-md bg-accent px-1.5 py-0.5 text-sm font-semibold text-white">
            <Crosshair className="size-3.5" strokeWidth={2.5} aria-hidden />
            {car}
          </span>
        )}
      </span>
      <StatusMark status={row.status} />
      <span className="num whitespace-nowrap">
        {row.output ? (
          <>
            <span className="font-semibold">{row.output.done}</span> <span className="text-ink-2">{t.shop.ofPlan(row.output.plan)}</span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </span>
      <Cell v={row.metric} />
      <span className="flex min-w-0 items-baseline gap-2">
        <Cell v={row.reason} truncate />
        {row.check === 'signal' && <span className="shrink-0 rounded border border-dashed border-line-strong px-1.5 text-sm text-ink-2">{t.crew.signalUnverified}</span>}
      </span>
      {expandable ? <ChevronDown className={cx('size-4 text-ink-3 transition-transform print:hidden', open && 'rotate-180')} aria-hidden /> : <span />}
    </>
  );
  return (
    <div className={cx('border-t border-line first:border-t-0', deviation && TONE_CLASS[row.status.tone].bg, car && 'shadow-[inset_4px_0_0_var(--accent)]')}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => selectArea(open ? null : row.id)}
          className={cx(COLS, ROW_TEXT, 'w-full px-3.5 py-2 text-left hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent')}
        >
          {cells}
        </button>
      ) : (
        <div className={cx(COLS, ROW_TEXT, 'px-3.5 py-2')}>{cells}</div>
      )}
      {open && expandable && (
        <div id={detailsId}>
          <AreaDetails area={row.id} shiftRunning={shiftRunning} />
        </div>
      )}
    </div>
  );
}

function Cell({ v, truncate }: { v: TextView | null; truncate?: boolean }) {
  const { lang } = useTranslation();
  if (!v) return <span className="text-ink-3">—</span>;
  const translated = translateDynamicText(v.text, lang);
  return (
    <span className={cx('min-w-0 leading-snug', v.tone === 'neutral' ? 'text-ink' : cx('font-medium', TONE_CLASS[v.tone].ink), truncate && 'truncate')} title={truncate ? translated : undefined}>
      {translated}
    </span>
  );
}

/** Очередь между участками: только число и короткая полоса, без силуэтов */
function BufferRow({ b }: { b: BufferView }) {
  const { t, lang } = useTranslation();
  const full = b.count >= b.capacity;
  const empty = b.count === 0;
  const Flag = full ? CircleSlash : Hourglass;
  const bufferPrefix = lang === 'kk' ? 'буфер' : lang === 'en' ? 'buffer' : 'буфер';
  return (
    <div className={cx(GRID, 'border-t border-line px-3.5 py-1 text-sm leading-tight max-md:grid-cols-[1rem_minmax(0,1fr)]')}>
      <span className="flex justify-end pr-1 text-ink-3" aria-hidden>
        <ArrowDown className="size-3.5" strokeWidth={2.25} />
      </span>
      <span className="col-span-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2 max-md:col-span-1">
        <span>
          {t.panel.inQueue(b.count, b.capacity)}
        </span>
        <span className="relative h-1.5 w-24 shrink-0 rounded-full bg-line" aria-hidden>
          <span
            className={cx('absolute inset-y-0 left-0 rounded-full', full || empty ? 'bg-st-waiting' : 'bg-st-neutral')}
            style={{ width: `${Math.min(100, (b.count / b.capacity) * 100)}%` }}
          />
        </span>
        {(full || empty) && (
          <span className="inline-flex items-center gap-1 font-semibold text-st-waiting-ink">
            <Flag className="size-[1.05em]" strokeWidth={2.25} aria-hidden />
            {`${bufferPrefix} ${full ? t.shop.bufferFull : t.shop.bufferEmpty}`}
          </span>
        )}
      </span>
      <span className="max-md:hidden" />
    </div>
  );
}
