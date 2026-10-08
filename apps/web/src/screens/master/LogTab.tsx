// «Журнал»: записи смены участка. Без причины — сверху с пометкой «нужна причина»:
// это единственное, что мастер делает и сегодня. «+» — та же запись с пустыми полями.
import { Plus } from 'lucide-react';
import type { LogEntry } from '@allur/contracts/ref';
import { usePlantModel } from '../../state/plant';
import { useTranslation } from '../../i18n/store';
import { translateDefect, translateDynamicText } from '../../i18n/translator';
import { timeHM } from '../../lib/format';
import { cx } from '../../lib/tones';
import { equipmentName, minutesBetween } from './crewText';

export function LogTab({ entries, nowIso, onOpen, onAdd }: { entries: LogEntry[]; nowIso: string | null; onOpen: (e: LogEntry) => void; onAdd: () => void }) {
  const { t, lang } = useTranslation();
  const model = usePlantModel();
  const sorted = [...entries].sort((a, b) => {
    const na = needsReason(a) ? 0 : 1;
    const nb = needsReason(b) ? 0 : 1;
    return na - nb || Date.parse(b.from ?? b.at) - Date.parse(a.from ?? a.at);
  });
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onAdd} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-surface text-lg font-semibold ring-1 ring-line active:bg-surface-2">
        <Plus className="size-6" aria-hidden />
        {t.crew.addEntry}
      </button>
      {sorted.length === 0 && <p className="mt-4 text-center text-lg text-ink-2">{t.crew.logEmpty}</p>}
      <ul className="flex flex-col gap-2">
        {sorted.map((e) => {
          const need = needsReason(e);
          const defect = e.kind === 'defect';
          const mins = defect ? null : minutesBetween(e.from, e.to, nowIso ?? undefined);
          const name = defect
            ? t.crew.bodyShort((e.vin ?? '').slice(-5))
            : e.equipmentId
              ? equipmentName(model, e.equipmentId, lang)
              : translateDynamicText(e.facts, lang);
          const detail = defect ? (e.defect ? translateDefect(e.defect, lang) : '') : mins !== null ? t.crew.minutes(mins) : '';
          const done = defect ? (e.decision ? t.crew.decisions[e.decision] : '') : e.reason ? t.crew.stopReasons[e.reason] : '';
          return (
            <li key={e.entryId}>
              <button
                type="button"
                onClick={() => onOpen(e)}
                className={cx('flex min-h-16 w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left', need && 'ring-2 ring-st-attention')}
              >
                <span className="num w-[3.25rem] shrink-0 text-lg text-ink-2">{e.from ? timeHM(e.from) : timeHM(e.at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold">{name}</span>
                  <span className="block truncate text-base text-ink-2">
                    {detail}
                    {done && ` · ${done}`}
                    {e.needHelp && ` · ${t.crew.needHelp.toLowerCase()}`}
                  </span>
                </span>
                {need && <span className="shrink-0 rounded-lg bg-st-attention-bg px-2 py-1 text-base font-semibold text-st-attention-ink">{defect ? t.crew.needDecision : t.crew.needReason}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function needsReason(e: LogEntry): boolean {
  return e.kind === 'downtime' ? !e.reason : !e.decision;
}
