import { ArrowRight, CircleCheck } from 'lucide-react';
import type { AttentionItem } from '@allur/contracts/ref';
import { Card } from '../../components/ui';
import { TONE_CLASS, TONE_ICON, cx } from '../../lib/tones';
import { useTranslation } from '../../i18n/store';
import { translateDynamicText } from '../../i18n/translator';

export function AttentionColumn({
  items,
  total,
  onOpen,
  onMore,
}: {
  items: AttentionItem[];
  total: number;
  onOpen?: (incidentId: string) => void;
  onMore?: () => void;
}) {
  const { t } = useTranslation();
  const shown = items.slice(0, 3);
  const more = Math.max(0, total - shown.length);
  return (
    <Card className="flex flex-col gap-2.5 p-3 2xl:gap-3 2xl:p-4">
      <h2 className="text-[1.125rem] font-semibold leading-tight">{t.shop.attentionTitle}</h2>
      {shown.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-lg text-ink-2">
          <CircleCheck className="size-6 text-st-neutral" aria-hidden />
          {t.shop.attentionNone}
        </div>
      ) : (
        <ul className="flex flex-col gap-2 2xl:gap-2.5">
          {shown.map((item) => (
            <AttentionCard key={item.incidentId} item={item} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {more > 0 && (
        <button type="button" onClick={onMore} className="self-start text-base font-medium text-accent-ink hover:underline">
          {t.common.more(more)}
        </button>
      )}
    </Card>
  );
}

function AttentionCard({ item, onOpen }: { item: AttentionItem; onOpen?: (id: string) => void }) {
  const { t } = useTranslation();
  const Icon = TONE_ICON[item.tone];
  const tc = TONE_CLASS[item.tone];
  return (
    <li className={cx('flex flex-col gap-1.5 rounded-xl border-l-4 p-2.5 2xl:p-3', tc.bg, tc.border, item.fresh && 'fresh')}>
      <div className={cx('flex items-start gap-2 text-[1.0625rem] font-semibold leading-snug', tc.ink)}>
        <Icon className="mt-[0.15em] size-[1.1em] shrink-0" strokeWidth={2.25} aria-hidden />
        <span className="text-ink">{translateDynamicText(item.title)}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5 pl-[1.6rem]">
        <span className={cx('text-base font-medium leading-snug', tc.ink)}>{translateDynamicText(item.impact)}</span>
        <button
          type="button"
          onClick={() => onOpen?.(item.incidentId)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 text-base font-semibold text-accent-ink shadow-card hover:bg-accent-bg focus-visible:outline-2 focus-visible:outline-accent print:hidden"
        >
          {t.shop.investigate}
          <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </li>
  );
}
