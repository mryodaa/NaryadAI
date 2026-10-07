// Режим «Панель»: участки строго по потоку, между ними очереди буферов, внизу лента смены.
// Ноль декора — только слова, числа, статусы и одна линия тренда в раскрытой строке.
import { Fragment } from 'react';
import { ArrowDown, ChevronDown, CircleSlash, Hourglass } from 'lucide-react';
import type { BufferView, LiveSnapshot } from '@allur/contracts/ref';
import { usePaintDefect } from '../../api/queries';
import { Card } from '../../components/ui';
import { areaRows, bufferAfter, type AreaRowView, type TextView } from '../../state/selectors';
import { selectArea, useView } from '../../state/view';
import { TONE_CLASS, cx } from '../../lib/tones';
import { BODIES, plural, timeHM } from '../../lib/format';
import { ShiftTimeline } from '../../screens/shop/ShiftTimeline';
import { AreaDetails } from './AreaDetails';
import { StatusMark } from './StatusMark';

/**
 * Колонки списка: участок · статус · выпуск · главный показатель · что происходит · стрелка раскрытия.
 * Минимумы подобраны под 1366: статус «Работает с браком» и причина вида «Камера-02: фильтр забит (346 Па)» не режутся.
 */
const COLS =
  'grid grid-cols-[minmax(11rem,0.9fr)_minmax(11rem,0.9fr)_minmax(6rem,0.5fr)_minmax(10rem,0.8fr)_minmax(0,1.6fr)_1rem] items-center gap-x-3';

/** На 1366 строки чуть мельче, чтобы пять колонок вставали в одну строку */
const ROW_TEXT = 'text-[0.9375rem] 2xl:text-base';

export function PanelView({ snapshot: s, onIncident }: { snapshot: LiveSnapshot; onIncident: (id: string) => void }) {
  const paintDefect = usePaintDefect(s);
  const selected = useView((v) => v.area);
  const rows = areaRows(s, paintDefect);
  return (
    <div className="view-in flex flex-col gap-3 xl:gap-4">
      <Card className="overflow-hidden">
        <div className={cx(COLS, 'border-b border-line px-3.5 py-2 text-sm font-semibold leading-tight text-ink-3')} aria-hidden>
          <span>Участок</span>
          <span>Статус</span>
          <span>Выпуск, план к {timeHM(s.now)}</span>
          <span>Главный показатель</span>
          <span>Что происходит</span>
          <span />
        </div>
        {rows.map((r) => {
          const b = bufferAfter(s, r.id);
          return (
            <Fragment key={r.id}>
              <AreaRow row={r} open={selected === r.id} shiftRunning={!!s.shift} />
              {b && <BufferRow b={b} />}
            </Fragment>
          );
        })}
      </Card>
      {s.shift && <ShiftTimeline shift={s.shift} now={s.now} timeline={s.timeline} onIncident={onIncident} />}
    </div>
  );
}

function AreaRow({ row, open, shiftRunning }: { row: AreaRowView; open: boolean; shiftRunning: boolean }) {
  // у склада готовой продукции нет оборудования и графика — раскрывать нечего
  const expandable = row.id !== 'finished';
  const deviation = row.status.tone !== 'neutral';
  const detailsId = `area-details-${row.id}`;
  const cells = (
    <>
      <span className="font-semibold leading-tight">{row.name}</span>
      <StatusMark status={row.status} />
      <span className="num whitespace-nowrap">
        {row.output ? (
          <>
            <span className="font-semibold">{row.output.done}</span> <span className="text-ink-2">из {row.output.plan}</span>
          </>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </span>
      <Cell v={row.metric} />
      <Cell v={row.reason} truncate />
      {expandable ? <ChevronDown className={cx('size-4 text-ink-3 transition-transform print:hidden', open && 'rotate-180')} aria-hidden /> : <span />}
    </>
  );
  return (
    <div className={cx('border-t border-line first:border-t-0', deviation && TONE_CLASS[row.status.tone].bg)}>
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
  if (!v) return <span className="text-ink-3">—</span>;
  return (
    <span className={cx('min-w-0 leading-snug', v.tone === 'neutral' ? 'text-ink' : cx('font-medium', TONE_CLASS[v.tone].ink), truncate && 'truncate')} title={truncate ? v.text : undefined}>
      {v.text}
    </span>
  );
}

/** Очередь между участками: только число и короткая полоса, без силуэтов */
function BufferRow({ b }: { b: BufferView }) {
  const full = b.count >= b.capacity;
  const empty = b.count === 0;
  const Flag = full ? CircleSlash : Hourglass;
  return (
    <div className={cx(COLS, 'border-t border-line px-3.5 py-1 text-sm leading-tight')}>
      <span className="flex justify-end pr-1 text-ink-3" aria-hidden>
        <ArrowDown className="size-3.5" strokeWidth={2.25} />
      </span>
      <span className="col-span-4 flex items-center gap-3 text-ink-2">
        <span>
          В очереди <span className="num font-semibold text-ink">{b.count}</span> {plural(b.count, BODIES)} из {b.capacity}
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
            {full ? 'буфер полон' : 'буфер пуст'}
          </span>
        )}
      </span>
      <span />
    </div>
  );
}
