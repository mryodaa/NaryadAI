// «Требует внимания»: не больше 3 карточек, по ущербу плану. Остальное — «ещё N».
import { ArrowRight, CircleCheck } from 'lucide-react';
import type { AttentionItem } from '@allur/contracts/ref';
import { Card } from '../../components/ui';
import { TONE_CLASS, TONE_ICON, cx } from '../../lib/tones';

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
  const shown = items.slice(0, 3);
  const more = Math.max(0, total - shown.length);
  return (
    <Card className="flex flex-col gap-2.5 p-3 2xl:gap-3 2xl:p-4">
      <h2 className="text-[1.125rem] font-semibold leading-tight">Требует внимания</h2>
      {shown.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-lg text-ink-2">
          <CircleCheck className="size-6 text-st-neutral" aria-hidden />
          Отклонений нет
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
          ещё {more}
        </button>
      )}
    </Card>
  );
}

function AttentionCard({ item, onOpen }: { item: AttentionItem; onOpen?: (id: string) => void }) {
  const Icon = TONE_ICON[item.tone];
  const t = TONE_CLASS[item.tone];
  return (
    <li className={cx('flex flex-col gap-1.5 rounded-xl border-l-4 p-2.5 2xl:p-3', t.bg, t.border, item.fresh && 'fresh')}>
      <div className={cx('flex items-start gap-2 text-[1.0625rem] font-semibold leading-snug', t.ink)}>
        <Icon className="mt-[0.15em] size-[1.1em] shrink-0" strokeWidth={2.25} aria-hidden />
        <span className="text-ink">{item.title}</span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5 pl-[1.6rem]">
        <span className={cx('text-base font-medium leading-snug', t.ink)}>{item.impact}</span>
        <button
          type="button"
          onClick={() => onOpen?.(item.incidentId)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 text-base font-semibold text-accent-ink shadow-card hover:bg-accent-bg focus-visible:outline-2 focus-visible:outline-accent print:hidden"
        >
          Разобраться
          <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </li>
  );
}
