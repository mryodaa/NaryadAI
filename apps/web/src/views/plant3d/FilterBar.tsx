import { MODELS } from '@allur/contracts/ref';
import { useLive } from '../../state/live';
import { resetFilters, toggleFlagFilter, toggleModelFilter, useView } from '../../state/view';
import { filtersActive, matchesFilters } from '../../state/search';
import { cx } from '../../lib/tones';
import { useTranslation } from '../../i18n/store';

export function FilterBar() {
  const { t, lang } = useTranslation();
  const filters = useView((v) => v.filters);
  const active = filtersActive(filters);
  // список кузовов нужен только для счётчика — пока фильтр выключен, раз в секунду не перерисовываемся
  const bodies = useLive((s) => (active ? s.bodies : null));
  const shown = bodies ? bodies.filter((b) => matchesFilters(b, filters)).length : 0;
  const chip = (on: boolean) =>
    cx('rounded-xl px-2.5 py-1 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent', on ? 'bg-accent text-white' : 'text-ink-2 hover:bg-surface-2 hover:text-ink');

  const groupAria = lang === 'kk' ? 'Шанақтарды жылдам сүзу' : lang === 'en' ? 'Quick car filters' : 'Быстрые фильтры машин';
  const labelCars = lang === 'kk' ? 'Шанақтар:' : lang === 'en' ? 'Cars:' : 'Машины:';
  const labelDelayed = lang === 'kk' ? 'Кешігуде' : lang === 'en' ? 'Delayed' : 'Задерживаются';
  const labelRework = lang === 'kk' ? 'Қайта бояу' : lang === 'en' ? 'Rework' : 'Перекраска';

  return (
    <div role="group" aria-label={groupAria} className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-2xl bg-surface p-1 shadow-card ring-1 ring-line">
      <span className="px-1.5 text-sm font-semibold text-ink-3">{labelCars}</span>
      <button type="button" aria-pressed={filters.delayed} onClick={() => toggleFlagFilter('delayed')} className={chip(filters.delayed)}>
        {labelDelayed}
      </button>
      <button type="button" aria-pressed={filters.rework} onClick={() => toggleFlagFilter('rework')} className={chip(filters.rework)}>
        {labelRework}
      </button>
      {MODELS.map((m) => {
        const on = filters.models.includes(m.id);
        return (
          <button key={m.id} type="button" aria-pressed={on} onClick={() => toggleModelFilter(m.id)} className={chip(on)}>
            {m.short}
          </button>
        );
      })}
      {active && bodies && (
        <span className="num flex items-center gap-1 pl-1.5 pr-1 text-[0.9375rem] text-ink-2" role="status">
          {lang === 'kk' ? (
            <>Көрсетілді: <b className="text-ink">{shown}</b> / {bodies.length} ·</>
          ) : lang === 'en' ? (
            <>Showing <b className="text-ink">{shown}</b> of {bodies.length} ·</>
          ) : (
            <>Показано <b className="text-ink">{shown}</b> из {bodies.length} ·</>
          )}
          <button type="button" onClick={resetFilters} className="rounded-lg px-1 font-semibold text-accent-ink hover:underline">
            {t.common.reset}
          </button>
        </span>
      )}
    </div>
  );
}
