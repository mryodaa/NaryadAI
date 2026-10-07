import type { ReactNode } from 'react';
import { CircleHelp, type LucideIcon } from 'lucide-react';
import type { Tone } from '@allur/contracts/ref';
import { TONE_CLASS, TONE_ICON, cx } from '../lib/tones';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl bg-surface shadow-card', className)}>{children}</div>;
}

/** Статус словом + цветом + иконкой. Нормальное состояние — серым, без подложки. */
export function StatusChip({
  tone,
  label,
  icon,
  className,
}: {
  tone: Tone;
  label: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const Icon = icon ?? TONE_ICON[tone];
  const t = TONE_CLASS[tone];
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-start gap-1.5 text-base font-semibold leading-tight',
        tone === 'neutral' ? 'text-st-neutral-ink' : cx('rounded-lg px-2 py-0.5', t.ink, t.bg),
        className,
      )}
    >
      <Icon className={cx('mt-[0.1em] size-[1.05em] shrink-0', tone === 'neutral' && 'text-st-neutral')} strokeWidth={2.25} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function WhyButton({ onClick, label = 'Почему?' }: { onClick?: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-base font-medium text-accent-ink hover:bg-accent-bg focus-visible:outline-2 focus-visible:outline-accent print:hidden"
    >
      <CircleHelp className="size-[1.05em]" strokeWidth={2.25} aria-hidden />
      {label}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  /** submit — отправляет форму, в которой стоит */
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        variant === 'primary' ? 'bg-accent text-white hover:bg-accent-ink' : 'bg-accent-bg text-accent-ink hover:bg-[#dfe8fb]',
        className,
      )}
    >
      {children}
    </button>
  );
}
