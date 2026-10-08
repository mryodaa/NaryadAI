import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Hourglass } from 'lucide-react';
import { MODEL_BY_ID, type BodyView } from '@allur/contracts/ref';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { focusCar, setViewMode, useView } from '../../state/view';
import { shortVin } from '../../state/cars';
import { columns, type Column, type Row } from '../../state/board';
import { TONE_CLASS, cx } from '../../lib/tones';
import { useTranslation } from '../../i18n/store';
import { translateArea } from '../../i18n/translator';
import type { Translations } from '../../i18n/types';

/** Сколько строк в колонке сразу; дальше — «ещё N» */
const FIRST = 12;
const STEP = 24;

function flagShort(f: BodyView['flags'][number], t: Translations): string {
  if (f === 'delayed') return t.cars.flagDelayed;
  if (f === 'rework') return t.cars.flagRework;
  if (f === 'nonconformity') return t.cars.flagNonconformity;
  if (f === 'restored_checkpoint') return t.cars.flagRestored;
  if (f === 'unknown_color') return t.cars.flagUnknownColor;
  return f;
}

export function CarsScreen() {
  const { t } = useTranslation();
  const bodies = useLive((s) => s.bodies);
  const nowIso = useLive((s) => s.snapshot?.now);
  const plant = usePlantModel();
  const selected = useView((v) => v.car);
  const navigate = useNavigate();
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const cols = useMemo(() => columns(bodies, plant, now), [bodies, plant, now]);
  const total = bodies.filter((b) => b.loc.kind !== 'finished').length;

  const open = (b: BodyView) => {
    const stageId = b.loc.kind === 'buffer' && b.loc.bufferId ? plant.bufferById.get(b.loc.bufferId)?.to : b.loc.stageId;
    navigate('/');
    setViewMode('3d');
    focusCar(b.bodyId, stageId);
  };

  return (
    <main className="flex flex-col gap-3 px-4 pb-4 pt-3 xl:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight max-sm:text-[1.375rem]">{t.cars.title}</h1>
        <p className="text-base text-ink-2">
          {t.cars.subtitle(total)}
        </p>
      </div>
      <div
        className="items-start gap-2.5 max-lg:-mx-4 max-lg:flex max-lg:snap-x max-lg:snap-mandatory max-lg:overflow-x-auto max-lg:px-4 max-lg:pb-2 lg:grid lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
        style={{ '--cols': cols.length } as React.CSSProperties}
      >
        {cols.map((c) => (
          <StageColumn key={c.id} c={c} selected={selected} onOpen={open} />
        ))}
      </div>
    </main>
  );
}

function StageColumn({ c, selected, onOpen }: { c: Column; selected: string | null; onOpen: (b: BodyView) => void }) {
  const { t, lang } = useTranslation();
  const [shown, setShown] = useState(FIRST);
  const late = c.avgMin !== null && c.avgNorm !== null && c.avgMin > c.avgNorm * 1.5;
  const queued = c.rows.filter((r) => r.queued).length;
  const localizedStageName = translateArea(c.id, lang, 'name') || c.name;

  return (
    <section aria-label={`${localizedStageName}: ${c.rows.length}`} className="flex min-w-0 flex-col rounded-2xl bg-surface shadow-card ring-1 ring-line max-lg:w-[17rem] max-lg:shrink-0 max-lg:snap-start">
      <header className="border-b border-line px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate text-lg font-semibold">{localizedStageName}</h2>
          <span className="num text-[1.375rem] font-semibold leading-none">{c.rows.length}</span>
        </div>
        <div className={cx('num text-sm', late ? cx('font-semibold', TONE_CLASS.attention.ink) : 'text-ink-2')}>
          {c.avgMin !== null ? (
            <>
              {t.cars.avgMinutes(c.avgMin)}{c.avgNorm ? ` · ${t.cars.normMinutes(c.avgNorm)}` : ''}
            </>
          ) : (
            <span className="text-ink-3">{t.cars.noTimeNorm}</span>
          )}
        </div>
        {queued > 0 && <div className="num text-sm text-ink-3">{t.cars.inQueueCount(queued)}</div>}
      </header>
      {c.rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-ink-3">{t.cars.noCars}</p>
      ) : (
        <ul className="flex flex-col py-1">
          {c.rows.slice(0, shown).map((r) => (
            <li key={r.b.bodyId}>
              <CarRow r={r} on={selected === r.b.bodyId} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
      {c.rows.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + STEP)} className="border-t border-line px-3 py-1.5 text-left text-[0.9375rem] font-semibold text-accent-ink hover:bg-surface-2">
          {t.cars.loadMore(c.rows.length - shown)}
        </button>
      )}
    </section>
  );
}

function CarRow({ r, on, onOpen }: { r: Row; on: boolean; onOpen: (b: BodyView) => void }) {
  const { t, lang } = useTranslation();
  const b = r.b;
  const delayed = b.flags.includes('delayed');
  const marks = b.flags.map((f) => flagShort(f, t)).filter(Boolean);
  const queueLabel = lang === 'kk' ? 'кезекте' : lang === 'en' ? 'in queue' : 'в очереди';

  return (
    <button
      type="button"
      onClick={() => onOpen(b)}
      aria-pressed={on}
      title={`${MODEL_BY_ID[b.model].name} ${b.vin ?? b.bodyId}${b.flags.length ? ` · ${b.flags.length}` : ''}`}
      className={cx(
        'grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1 text-left text-[0.9375rem] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        on ? 'bg-accent-bg' : 'hover:bg-surface-2',
      )}
    >
      <span className="size-3 rounded-full ring-1 ring-line-strong" style={{ background: b.color?.hex ?? 'transparent' }} aria-hidden />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 font-medium">{MODEL_BY_ID[b.model].short}</span>
        <span className="shrink-0 font-mono text-sm text-ink-2">{shortVin(b).replace('…', '')}</span>
        {marks.length > 0 && <span className={cx('truncate text-xs font-semibold', TONE_CLASS.attention.ink)}>{marks.join(' · ')}</span>}
      </span>
      <span className={cx('num inline-flex items-center gap-1 whitespace-nowrap text-sm', delayed ? cx('font-semibold', TONE_CLASS.attention.ink) : 'text-ink-3')}>
        {r.queued && <Hourglass className="size-3.5" aria-label={queueLabel} />}
        {r.min} {t.common.minuteUnit}
      </span>
    </button>
  );
}
