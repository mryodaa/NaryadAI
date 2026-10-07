// Поиск машины в шапке, на всех экранах: «/» или Ctrl+K. Ищет по данным трекера в памяти (мгновенно),
// а если номер не нашёлся среди машин в цехе — по всем машинам двойника на шлюзе, и уже отгруженным.
// Выбор: машина выбрана, карточка открыта; в 3D камера подлетает, в «Панели» раскрыт её участок.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { History, LoaderCircle, Search, X } from 'lucide-react';
import { MODEL_BY_ID, type BodyView } from '@allur/contracts/ref';
import { api } from '../api/client';
import { useLive } from '../state/live';
import { usePlantModel } from '../state/plant';
import { focusCar } from '../state/view';
import { carWhere } from '../state/cars';
import { looksLikeVinQuery, recentSearches, rememberSearch, searchCars, searchIndex, type SearchHit } from '../state/search';
import { CARS, plural } from '../lib/format';
import { cx } from '../lib/tones';
import { useTranslation } from '../i18n/store';
import { translateCarFlag } from '../i18n/translator';

type Archive = { query: string; state: 'loading' | 'done' | 'error'; items: BodyView[] };

export function CarSearch({ wide = false }: { wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [archive, setArchive] = useState<Archive | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const plant = usePlantModel();
  const bodies = useLive((s) => s.bodies);
  const nowIso = useLive((s) => s.snapshot?.now);

  const entries = useMemo(() => (open ? searchIndex(bodies, plant) : []), [open, bodies, plant]);
  const q = query.trim();
  const found = useMemo(() => (q ? searchCars(entries, q) : null), [entries, q]);
  // по истории — только для того же запроса, который отправили
  const fromArchive = archive && archive.query === q ? archive : null;
  const options: SearchHit[] = found?.hits.length ? found.hits : fromArchive?.state === 'done' ? fromArchive.items.slice(0, 8).map((b) => ({ body: b, mark: markIn(b, q) })) : [];

  const openSearch = () => {
    setRecent(recentSearches());
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const close = () => {
    setOpen(false);
    setQuery('');
    setArchive(null);
  };

  // «/» и Ctrl+K — с любого экрана, если не идёт набор текста
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
      const ctrlK = (e.ctrlKey || e.metaKey) && e.code === 'KeyK';
      const slash = !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '/' || (e.code === 'Slash' && !e.shiftKey));
      if (ctrlK || (slash && !typing)) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // клик мимо — закрыть
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);

  useEffect(() => setActive(0), [q, fromArchive?.state]);

  const pick = (b: BodyView) => {
    rememberSearch(q || b.vin || b.bodyId);
    close();
    if (location.pathname !== '/') navigate('/');
    // в «Панели» раскрываем участок, где машина (из очереди — следующий участок)
    const stageId = b.loc.kind === 'buffer' && b.loc.bufferId ? plant.bufferById.get(b.loc.bufferId)?.to : b.loc.stageId;
    focusCar(b.bodyId, stageId);
  };

  const searchArchive = () => {
    const query = q;
    setArchive({ query, state: 'loading', items: [] });
    api<BodyView[]>(`/api/v1/bodies?query=${encodeURIComponent(query)}&limit=8`)
      .then((items) => setArchive((a) => (a?.query === query ? { query, state: 'done', items } : a)))
      .catch(() => setArchive((a) => (a?.query === query ? { query, state: 'error', items: [] } : a)));
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Esc закрывает только поиск: карточка и выбор в сцене остаются
      e.preventDefault();
      close();
      return;
    }
    if (!q && recent.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : recent.length - 1)) % recent.length);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return;
      e.preventDefault();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!q && recent[active]) setQuery(recent[active]!);
      else if (options[active]) pick(options[active]!.body);
      else if (found && !found.total && looksLikeVinQuery(q) && !fromArchive) searchArchive();
    }
  };

  const { t } = useTranslation();
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const announce = !q
    ? ''
    : found?.total
      ? t.search.found(found.total, plural(found.total, CARS))
      : fromArchive?.state === 'done'
        ? fromArchive.items.length
          ? t.search.foundArchive(fromArchive.items.length, plural(fromArchive.items.length, CARS))
          : t.search.notFoundArchive
        : t.search.notFound;

  return (
    <div ref={wrapRef} className="relative">
      {!open ? (
        <button
          type="button"
          onClick={openSearch}
          aria-label={t.search.triggerAria}
          title={t.search.triggerTitle}
          className="flex h-9 items-center gap-2 rounded-xl border border-line-strong bg-surface pl-2.5 pr-1.5 text-base text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Search className="size-[1.1rem]" strokeWidth={2.25} aria-hidden />
          {wide && <span>{t.search.buttonLabel}</span>}
          <kbd className="rounded-md bg-surface-2 px-1.5 font-mono text-sm text-ink-3">/</kbd>
        </button>
      ) : (
        <div className="flex h-9 w-[19rem] items-center gap-2 rounded-xl border border-accent bg-surface pl-2.5 pr-1 ring-2 ring-accent/25">
          <Search className="size-[1.1rem] shrink-0 text-ink-3" strokeWidth={2.25} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t.search.placeholder}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options.length || (!q && recent.length) ? `${listId}-${active}` : undefined}
            aria-label={t.search.inputAria}
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
          />
          <button type="button" onClick={close} aria-label={t.search.closeAria} className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {open ? announce : ''}
      </div>

      {open && (
        <div className="view-in absolute right-0 top-full z-50 mt-2 w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-line">
          {!q ? (
            recent.length ? (
              <ul id={listId} role="listbox" aria-label={t.search.recentSearches} className="py-1.5">
                <li className="px-4 pb-1 pt-0.5 text-sm font-semibold text-ink-3" role="presentation">
                  {t.search.recentSearches}
                </li>
                {recent.map((r, i) => (
                  <li
                    key={r}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setQuery(r)}
                    className={cx('flex cursor-pointer items-center gap-2 px-4 py-1.5 text-base', i === active ? 'bg-accent-bg text-accent-ink' : 'text-ink-2 hover:bg-surface-2')}
                  >
                    <History className="size-4 shrink-0 text-ink-3" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-base text-ink-2">{t.search.emptyTip}</p>
            )
          ) : options.length ? (
            <ul id={listId} role="listbox" aria-label={t.search.inShop} className="max-h-[26rem] overflow-y-auto py-1.5">
              {!found?.hits.length && (
                <li className="px-4 pb-1 pt-0.5 text-sm font-semibold text-ink-3" role="presentation">
                  {t.search.fromArchive}
                </li>
              )}
              {options.map((h, i) => (
                <li
                  key={h.body.bodyId}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(h.body)}
                  className={cx('grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 px-4 py-2', i === active ? 'bg-accent-bg' : 'hover:bg-surface-2')}
                >
                  <span className="mt-1.5 size-3 rounded-full ring-1 ring-line-strong" style={{ background: h.body.color?.hex ?? 'transparent' }} aria-hidden />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold text-ink">{MODEL_BY_ID[h.body.model].short}</span>
                      <MarkedId body={h.body} mark={h.mark} />
                      {h.body.flags
                        .filter((f) => f !== 'unknown_color')
                        .map((f) => (
                          <span key={f} className="rounded bg-st-attention-bg px-1 text-xs font-semibold text-st-attention-ink">
                            {translateCarFlag(f)}
                          </span>
                        ))}
                    </span>
                    <span className="block truncate text-sm text-ink-2">{carWhere(h.body, plant, now).title}</span>
                  </span>
                </li>
              ))}
              {(found?.total ?? 0) > options.length && (
                <li className="px-4 pt-1 text-sm text-ink-3" role="presentation">
                  {t.search.andMore(found!.total - options.length)}
                </li>
              )}
            </ul>
          ) : (
            <div className="px-4 py-3 text-base">
              {fromArchive?.state === 'loading' ? (
                <p className="flex items-center gap-2 text-ink-2">
                  <LoaderCircle className="size-4 animate-spin" aria-hidden /> {t.search.searchingArchive}
                </p>
              ) : fromArchive?.state === 'error' ? (
                <p className="text-ink-2">{t.search.errorArchive}</p>
              ) : (
                <>
                  <p className="text-ink">
                    {fromArchive ? t.search.notFoundDescArchive : t.search.notFoundDescShop}
                  </p>
                  {!fromArchive && looksLikeVinQuery(q) && (
                    <button type="button" onClick={searchArchive} className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg font-semibold text-accent-ink hover:underline">
                      <History className="size-4" aria-hidden />
                      {t.search.searchArchiveBtn}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <p className="border-t border-line bg-page px-4 py-1.5 text-sm text-ink-3">{t.search.shortcutsHelp}</p>
        </div>
      )}
    </div>
  );
}

/** Где в VIN или номере совпал запрос (для результатов из истории считаем сами) */
function markIn(b: BodyView, q: string): SearchHit['mark'] {
  const up = q.toUpperCase().replace(/[^0-9A-Z-]/g, '');
  const iv = b.vin ? b.vin.indexOf(up) : -1;
  if (up && iv >= 0) return { field: 'vin', start: iv, length: up.length };
  const ib = b.bodyId.toUpperCase().indexOf(up);
  return up && ib >= 0 ? { field: 'bodyId', start: ib, length: up.length } : null;
}

/** VIN (или номер кузова) с подсвеченным совпадением */
function MarkedId({ body, mark }: { body: BodyView; mark: SearchHit['mark'] }) {
  const text = mark?.field === 'bodyId' || !body.vin ? body.bodyId : body.vin;
  const m = mark && (mark.field === 'vin' ? !!body.vin : true) ? mark : null;
  if (!m) return <span className="font-mono text-sm text-ink-2">{text}</span>;
  return (
    <span className="font-mono text-sm text-ink-2">
      {text.slice(0, m.start)}
      <mark className="rounded-sm bg-st-attention-bg px-px font-semibold text-ink">{text.slice(m.start, m.start + m.length)}</mark>
      {text.slice(m.start + m.length)}
    </span>
  );
}
