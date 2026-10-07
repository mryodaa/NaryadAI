// Боковая панель и модальное окно: закрываются по Esc и клику мимо.
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../lib/tones';
import { useTranslation } from '../i18n/store';

// Слои для Esc: одно нажатие закрывает только верхний слой — открытый последним (паспорт поверх
// карточки машины, карточка поверх сцены). Каждый слушатель по отдельности не годится: React успевает
// убрать закрытое окно между слушателями, и следующий слой закрылся бы тем же нажатием.
const layers: { close: () => void }[] = [];

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const top = layers[layers.length - 1];
    if (!top) return;
    e.preventDefault();
    top.close();
  });
}

/** Открыт ли сейчас хотя бы один слой (окно, панель, карточка) — тогда Esc принадлежит ему */
export function escLayerOpen(): boolean {
  return layers.length > 0;
}

/** Слой, который закрывается по Esc, пока active */
export function useEscLayer(onClose: () => void, active = true) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!active) return;
    const layer = { close: () => ref.current() };
    layers.push(layer);
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [active]);
}

export function Drawer({ open, onClose, title, children, width = 'w-[34rem]' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  const { t } = useTranslation();
  useEscLayer(onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <aside className={cx('drawer-in absolute inset-y-0 right-0 flex max-w-[92vw] flex-col bg-page shadow-pop', width)}>
        <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label={t.common.close}>
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  useEscLayer(onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-ink/30" onClick={onClose} />
      <div className="relative flex min-h-full items-start justify-center px-4 py-6">
        <div className={cx('modal-in relative w-full rounded-2xl bg-page shadow-pop', wide ? 'max-w-[68rem]' : 'max-w-[44rem]')}>
          <header className="flex items-start justify-between gap-3 rounded-t-2xl border-b border-line bg-surface px-6 py-4">
            <div className="min-w-0 flex-1">{title}</div>
            <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label={t.common.close}>
              <X className="size-5" />
            </button>
          </header>
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
