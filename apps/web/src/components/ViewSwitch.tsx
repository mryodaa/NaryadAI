// Переключатель вида «Цех сейчас»: объёмная модель или строгая панель. Клавиша V.
import { Box, Rows3, type LucideIcon } from 'lucide-react';
import { setViewMode, useView, NO_3D_MESSAGE, type ViewMode } from '../state/view';
import { webglSupport } from '../lib/webgl';
import { loadPlant3D } from '../views/plant3d/load';
import { cx } from '../lib/tones';

const OPTIONS: { id: ViewMode; label: string; icon: LucideIcon }[] = [
  { id: '3d', label: '3D цех', icon: Box },
  { id: 'panel', label: 'Панель', icon: Rows3 },
];

export function ViewSwitch() {
  const mode = useView((v) => v.mode);
  const no3d = webglSupport() === 'none';
  return (
    <div role="radiogroup" aria-label="Вид экрана" className="inline-flex shrink-0 rounded-xl bg-line p-0.5 print:hidden">
      {OPTIONS.map(({ id, label, icon: Icon }) => {
        const on = mode === id;
        const disabled = id === '3d' && no3d;
        const prefetch = id === '3d' && !disabled ? () => void loadPlant3D() : undefined;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={disabled ? NO_3D_MESSAGE : `${label} · клавиша V`}
            onClick={() => setViewMode(id)}
            onPointerEnter={prefetch}
            onFocus={prefetch}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-[0.6rem] px-3 py-1 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              on ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
              disabled && 'cursor-not-allowed opacity-50 hover:text-ink-2',
            )}
          >
            <Icon className="size-[1.1em] shrink-0" strokeWidth={2.25} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
