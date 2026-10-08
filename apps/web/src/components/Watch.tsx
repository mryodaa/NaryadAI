import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Star, X } from 'lucide-react';
import { MODEL_BY_ID } from '@allur/contracts/ref';
import { useLive } from '../state/live';
import { usePlantModel } from '../state/plant';
import { focusCar } from '../state/view';
import { carWhere, shortVin } from '../state/cars';
import { dismissToast, toggleWatch, useWatch } from '../state/watch';
import { useEscLayer } from './overlay';
import { timeHM } from '../lib/format';
import { useTranslation } from '../i18n/store';
import { translateDynamicText } from '../i18n/translator';

export function WatchBadge({ wide }: { wide: boolean }) {
  const { t, lang } = useTranslation();
  const ids = useWatch((s) => s.ids);
  const events = useWatch((s) => s.events);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bodies = useLive((s) => (open ? s.bodies : null));
  const nowIso = useLive((s) => s.snapshot?.now);
  const plant = usePlantModel();
  const navigate = useNavigate();
  const location = useLocation();
  useEscLayer(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);
  if (!ids.length) return null;
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const show = (bodyId: string) => {
    setOpen(false);
    if (location.pathname !== '/') navigate('/');
    const b = bodies?.find((x) => x.bodyId === bodyId);
    const stageId = b?.loc.kind === 'buffer' && b.loc.bufferId ? plant.bufferById.get(b.loc.bufferId)?.to : b?.loc.stageId;
    focusCar(bodyId, stageId);
  };
  const notInShopText =
    lang === 'kk'
      ? 'цехта жоқ — төлқұжатты ашыңыз'
      : lang === 'en'
        ? 'not in shop — view passport'
        : 'нет в цеху — откройте паспорт';
  const transitionsText = lang === 'kk' ? 'Өтулер' : lang === 'en' ? 'Transitions' : 'Переходы';

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        aria-label={t.watch.watching(ids.length)}
        title={t.watch.watching(ids.length)}
        className="flex h-9 items-center gap-1.5 rounded-xl bg-accent-bg px-2.5 text-base font-semibold text-accent-ink hover:bg-[#dfe8fb] focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Star className="size-4 fill-current" strokeWidth={2.25} aria-hidden />
        {wide ? t.watch.watching(ids.length) : t.watch.watchingShort(ids.length)}
      </button>
      {open && (
        <div className="view-in absolute right-0 top-full z-50 mt-2 w-[30rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-line">
          <h2 className="px-4 pb-1 pt-3 text-sm font-semibold uppercase tracking-wide text-ink-3">{t.watch.title}</h2>
          <ul className="pb-2">
            {ids.map((id) => {
              const b = bodies?.find((x) => x.bodyId === id);
              return (
                <li key={id} className="flex items-center gap-2 px-2">
                  <button type="button" onClick={() => show(id)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                    <span className="size-3 shrink-0 rounded-full ring-1 ring-line-strong" style={{ background: b?.color?.hex ?? 'transparent' }} aria-hidden />
                    <span className="shrink-0 font-semibold">{b ? MODEL_BY_ID[b.model].short : '—'}</span>
                    <span className="shrink-0 font-mono text-sm text-ink-2">{b ? shortVin(b) : id}</span>
                    <span className="min-w-0 truncate text-sm text-ink-2">{b ? carWhere(b, plant, now).title : notInShopText}</span>
                  </button>
                  <button type="button" onClick={() => toggleWatch(id)} aria-label={t.carCard.removeFromWatch} title={t.carCard.removeFromWatch} className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          {events.length > 0 && (
            <>
              <h3 className="border-t border-line px-4 pb-1 pt-2.5 text-sm font-semibold uppercase tracking-wide text-ink-3">{transitionsText}</h3>
              <ul className="max-h-40 overflow-y-auto px-4 pb-3">
                {events.slice(0, 8).map((e) => (
                  <li key={e.id} className="flex gap-2.5 py-0.5 text-[0.9375rem]">
                    <span className="num w-11 shrink-0 text-ink-3">{timeHM(e.at, lang)}</span>
                    <span>{translateDynamicText(e.text, lang)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Ненавязчивый тост о переходе стадии: внизу по центру, 4 секунды, новый заменяет старый */
export function WatchToast() {
  const { t, lang } = useTranslation();
  const toast = useWatch((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const tTimer = setTimeout(dismissToast, 4000);
    return () => clearTimeout(tTimer);
  }, [toast]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center print:hidden" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="view-in pointer-events-auto flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-[0.9375rem] font-medium text-white shadow-pop">
          <Star className="size-4 shrink-0 fill-current text-[#f5c542]" aria-hidden />
          {translateDynamicText(toast.text, lang)}
          <button type="button" onClick={dismissToast} aria-label={t.common.close} className="ml-1 grid size-6 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
