import { useMemo, useState } from 'react';
import { MODEL_BY_ID, type AreaId, type BodyView } from '@allur/contracts/ref';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { selectCar, useView } from '../../state/view';
import { FLAG_TEXT, carsOfArea, minutesHere, normMinutes, shortVin } from '../../state/cars';
import { TONE_CLASS, cx } from '../../lib/tones';
import { useTranslation } from '../../i18n/store';
import { translateDynamicText } from '../../i18n/translator';
import type { Lang } from '../../i18n/types';

/** Сколько строк видно сразу */
const FIRST = 8;

export function AreaCars({ area }: { area: AreaId }) {
  const { t, lang } = useTranslation();
  const bodies = useLive((s) => s.bodies);
  const nowIso = useLive((s) => s.snapshot?.now);
  const plant = usePlantModel();
  const selected = useView((v) => v.car);
  const [all, setAll] = useState(false);
  const { here, queued } = useMemo(() => carsOfArea(bodies, plant, area), [bodies, plant, area]);
  if (!here.length && !queued.length) return null;
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const shown = all ? here : here.slice(0, FIRST);
  const sectionAria = lang === 'kk' ? 'Учаскедегі шанақтар' : lang === 'en' ? 'Cars on area' : 'Машины на участке';

  return (
    <section className="mt-3" aria-label={sectionAria}>
      <h4 className="mb-1 text-sm font-semibold text-ink-3">
        {t.panel.areaCarsTitle(here.length, queued.length)}
      </h4>
      {here.length > 0 && (
        <ul className="divide-y divide-line">
          {shown.map((b) => (
            <li key={b.bodyId}>
              <CarRow b={b} now={now} on={selected === b.bodyId} where={whereShort(b, plant.equipmentById.get(b.loc.equipmentId ?? '')?.name, lang)} />
            </li>
          ))}
        </ul>
      )}
      {here.length > FIRST && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-1 rounded-lg px-1 text-base font-semibold text-accent-ink hover:underline">
          {all ? t.common.collapse : t.panel.areaCarsQueueMore(here.length - FIRST)}
        </button>
      )}
      {queued.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-ink-3">{t.panel.areaCarsQueueOnly}</span>
          {queued.slice(0, all ? undefined : FIRST).map((b) => (
            <button
              key={b.bodyId}
              type="button"
              onClick={() => selectCar(b.bodyId)}
              aria-pressed={selected === b.bodyId}
              className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-sm hover:bg-surface-2', selected === b.bodyId ? 'bg-accent-bg text-accent-ink' : 'bg-page text-ink-2')}
            >
              <ColorDot b={b} lang={lang} />
              {shortVin(b)}
            </button>
          ))}
          {!all && queued.length > FIRST && <span className="text-sm text-ink-3">{t.panel.areaCarsQueueMore(queued.length - FIRST)}</span>}
        </div>
      )}
    </section>
  );
}

function whereShort(b: BodyView, equipment: string | undefined, lang: Lang): string {
  if (b.loc.kind === 'warehouse') return lang === 'kk' ? 'машина жиынтығы' : lang === 'en' ? 'assembly kit' : 'машинокомплект';
  if (b.loc.kind === 'finished') return lang === 'kk' ? 'қоймада' : lang === 'en' ? 'in warehouse' : 'на складе';
  if (b.loc.precision === 'stage') return lang === 'kk' ? 'нақты орны белгіленбеген' : lang === 'en' ? 'exact location not marked' : 'точное место не отмечено';
  return equipment ?? b.loc.equipmentId ?? '';
}

function ColorDot({ b, lang }: { b: BodyView; lang: Lang }) {
  const fallbackColor = lang === 'kk' ? 'түс берілмеген' : lang === 'en' ? 'color not specified' : 'цвет не передан';
  return <span className="size-3 shrink-0 rounded-full ring-1 ring-line-strong" style={{ background: b.color?.hex ?? 'transparent' }} title={b.color?.name ?? fallbackColor} aria-hidden />;
}

function CarRow({ b, now, on, where }: { b: BodyView; now: number; on: boolean; where: string }) {
  const { t, lang } = useTranslation();
  const min = minutesHere(b, now);
  const norm = normMinutes(b);
  const delayed = b.flags.includes('delayed');
  const marks = b.flags.filter((f) => f !== 'delayed' && f !== 'unknown_color');
  return (
    <button
      type="button"
      onClick={() => selectCar(b.bodyId)}
      aria-pressed={on}
      className={cx(
        'grid w-full grid-cols-[auto_4.5rem_5.5rem_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-lg px-1.5 py-1 text-left text-[0.9375rem] focus-visible:outline-2 focus-visible:outline-accent',
        on ? 'bg-accent-bg' : 'hover:bg-surface-2',
      )}
    >
      <ColorDot b={b} lang={lang} />
      <span className="truncate font-medium">{MODEL_BY_ID[b.model].short}</span>
      <span className="font-mono text-sm text-ink-2">{shortVin(b)}</span>
      <span className="truncate text-ink-2">
        {where}
        {marks.length > 0 && <span className={cx('ml-1.5 text-sm font-semibold', TONE_CLASS.attention.ink)}>{marks.map((f) => translateDynamicText(FLAG_TEXT[f], lang)).join(', ')}</span>}
      </span>
      <span className={cx('num whitespace-nowrap text-sm', delayed ? cx('font-semibold', TONE_CLASS.attention.ink) : 'text-ink-3')}>
        {min}
        {norm && b.loc.kind !== 'buffer' ? ` / ${norm}` : ''} {t.common.minuteUnit}
      </span>
    </button>
  );
}
