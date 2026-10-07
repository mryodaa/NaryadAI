// Статус в строгом виде: маленькая цветная метка + иконка + слово (цвет только у отклонений).
import type { StatusView } from '../../state/selectors';
import { TONE_CLASS, cx } from '../../lib/tones';

export function StatusMark({ status, extra, wrap }: { status: StatusView; extra?: string; wrap?: boolean }) {
  const Icon = status.icon;
  const neutral = status.tone === 'neutral';
  return (
    <span className={cx('inline-flex min-w-0 gap-1.5 font-semibold leading-tight', wrap ? 'items-start' : 'items-center', neutral ? 'text-st-neutral-ink' : TONE_CLASS[status.tone].ink)}>
      <span className={cx('size-2 shrink-0 rounded-full', TONE_CLASS[status.tone].solid, wrap && 'mt-[0.35em]')} aria-hidden />
      <Icon className={cx('size-[1.05em] shrink-0', neutral && 'text-st-neutral', wrap && 'mt-[0.1em]')} strokeWidth={2.25} aria-hidden />
      <span className={wrap ? undefined : 'truncate'}>
        {status.label}
        {extra && (
          <>
            {' · '}
            <span className="whitespace-nowrap font-normal">{extra}</span>
          </>
        )}
      </span>
    </span>
  );
}
