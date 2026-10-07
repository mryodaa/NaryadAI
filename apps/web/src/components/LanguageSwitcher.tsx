import { useTranslation } from '../i18n/store';
import type { Lang } from '../i18n/types';
import { cx } from '../lib/tones';

const LANGUAGES: { id: Lang; label: string; full: string }[] = [
  { id: 'kk', label: 'KZ', full: 'Қазақша' },
  { id: 'ru', label: 'RU', full: 'Русский' },
  { id: 'en', label: 'EN', full: 'English' },
];

export function LanguageSwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const { lang, setLang } = useTranslation();

  return (
    <div
      role="group"
      aria-label="Тілді таңдау / Выбор языка / Select language"
      className={cx('inline-flex shrink-0 items-center rounded-xl bg-surface-2 p-0.5 print:hidden ring-1 ring-line', className)}
    >
      {LANGUAGES.map((l) => {
        const active = lang === l.id;
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => setLang(l.id)}
            aria-pressed={active}
            title={l.full}
            className={cx(
              'rounded-lg px-2 py-1 text-sm font-semibold transition-all focus-visible:outline-2 focus-visible:outline-accent',
              active ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-2 hover:text-ink',
              compact && 'px-1.5 py-0.5 text-xs',
            )}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
