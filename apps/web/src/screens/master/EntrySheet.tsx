// Окно записи: что, где, когда уже заполнено; причина — одно касание (единственное обязательное),
// комментарий — одна строка по желанию, «Нужна помощь начальника» — по желанию, «Как было раньше» —
// свёрнуто, ничего не подставляет само. Брак по кузову — вместо причины три плитки решения.
// Закрыли без причины — запись остаётся «нужна причина».
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { CHECKPOINTS, DEFECT_DECISIONS, STOP_REASONS, type DefectDecision, type LogEntry, type PastCase, type StopReason } from '@allur/contracts/ref';
import { api } from '../../api/client';
import { usePlantModel } from '../../state/plant';
import { useTranslation } from '../../i18n/store';
import { translateDefect, translateDynamicText } from '../../i18n/translator';
import { dateShort, timeHM } from '../../lib/format';
import { cx } from '../../lib/tones';
import { equipmentName, minutesBetween } from './crewText';

export function EntrySheet({ entry, area, by, nowIso, onClose }: { entry: LogEntry | null; area: string; by: string; nowIso: string | null; onClose: () => void }) {
  const { t, lang } = useTranslation();
  const model = usePlantModel();
  const defect = entry?.kind === 'defect';
  const [reason, setReason] = useState<StopReason | null>(entry?.reason ?? null);
  const [decision, setDecision] = useState<DefectDecision | null>(entry?.decision ?? null);
  const [comment, setComment] = useState(entry?.comment ?? '');
  const [needHelp, setNeedHelp] = useState(entry?.needHelp ?? false);
  const equipment = (model.stageById.get(area)?.equipment ?? []).filter((e) => !e.passive);
  const [eq, setEq] = useState<string>(entry?.equipmentId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = defect ? !!decision : !!reason;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/v1/crew/log', {
        method: 'POST',
        json: entry
          ? { entryId: entry.entryId, area, reason: reason ?? undefined, decision: decision ?? undefined, comment, needHelp, by }
          : { area, equipmentId: eq || undefined, reason, comment, needHelp, by, facts: eq ? t.crew.manualFacts(model.equipmentById.get(eq)?.name ?? eq) : undefined },
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const mins = entry ? minutesBetween(entry.from, entry.to, nowIso ?? undefined) : null;
  const title = defect ? t.crew.defectTitle : entry ? t.crew.entryTitle : t.crew.entryNewTitle;
  const historyEq = entry?.equipmentId ?? eq;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-page" role="dialog" aria-modal="true" aria-label={title}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="grid size-14 place-items-center rounded-2xl bg-surface" aria-label={t.crew.close}>
          <X className="size-7" />
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {entry ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-2xl bg-surface p-4 text-lg">
            <dt className="text-ink-2">{t.crew.whatLabel}</dt>
            <dd className="font-semibold">{defect ? defectFacts(entry, t, lang) : translateDynamicText(entry.facts, lang)}</dd>
            {entry.from && (
              <>
                <dt className="text-ink-2">{t.crew.whenLabel}</dt>
                <dd>
                  {defect
                    ? timeHM(entry.from)
                    : entry.to
                      ? t.crew.fromTo(timeHM(entry.from), timeHM(entry.to))
                      : t.crew.sinceOngoing(timeHM(entry.from))}
                  {!defect && mins !== null && ` · ${t.crew.minutes(mins)}`}
                </dd>
              </>
            )}
            {entry.code && (
              <>
                <dt className="text-ink-2">{t.crew.codeLabel}</dt>
                <dd className="num">{entry.code}</dd>
              </>
            )}
          </dl>
        ) : (
          equipment.length > 0 && (
            <div>
              <div className="mb-1.5 text-lg text-ink-2">{t.crew.equipmentLabel}</div>
              <div className="flex flex-wrap gap-2">
                {[{ id: '', label: t.crew.wholeArea }, ...equipment.map((e) => ({ id: e.id, label: equipmentName(model, e.id, lang) }))].map((o) => (
                  <button
                    key={o.id || 'area'}
                    type="button"
                    onClick={() => setEq(o.id)}
                    className={cx('min-h-14 rounded-xl px-3 text-lg font-semibold', eq === o.id ? 'bg-ink text-page' : 'bg-surface ring-1 ring-line')}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )
        )}

        {defect ? (
          <div>
            <div className="mb-1.5 text-lg text-ink-2">{t.crew.decisionTitle}</div>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t.crew.decisionTitle}>
              {DEFECT_DECISIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={decision === d}
                  onClick={() => setDecision(d)}
                  className={cx('min-h-[4.5rem] rounded-2xl px-1 text-lg font-semibold leading-tight', decision === d ? 'bg-accent text-white' : 'bg-surface ring-1 ring-line')}
                >
                  {t.crew.decisions[d]}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-1.5 text-lg text-ink-2">{t.crew.reasonTitle}</div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.crew.reasonTitle}>
              {STOP_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  onClick={() => setReason(r)}
                  className={cx('min-h-[4.5rem] rounded-2xl px-2 text-xl font-semibold', reason === r ? 'bg-accent text-white' : 'bg-surface ring-1 ring-line')}
                >
                  {t.crew.stopReasons[r]}
                </button>
              ))}
            </div>
          </div>
        )}

        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={300}
          placeholder={t.crew.commentPlaceholder}
          className="min-h-14 w-full rounded-xl bg-surface px-4 text-lg ring-1 ring-line placeholder:text-ink-3 focus:outline-2 focus:outline-accent"
        />

        <button
          type="button"
          role="switch"
          aria-checked={needHelp}
          onClick={() => setNeedHelp((v) => !v)}
          className="flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-surface px-4 text-left ring-1 ring-line"
        >
          <span className="leading-tight">
            <span className="block text-lg font-semibold">{t.crew.needHelp}</span>
            <span className="block text-base text-ink-2">{t.crew.needHelpNote}</span>
          </span>
          <span className={cx('relative h-8 w-14 shrink-0 rounded-full transition-colors', needHelp ? 'bg-st-attention' : 'bg-line-strong')}>
            <span className={cx('absolute top-1 size-6 rounded-full bg-white transition-all', needHelp ? 'left-7' : 'left-1')} />
          </span>
        </button>

        {!defect && historyEq && <PastCases equipmentId={historyEq} exclude={entry?.entryId} />}

        {error && <p className="rounded-xl bg-st-fault-bg p-3 text-lg text-st-fault-ink">{t.crew.sendError(error)}</p>}
      </div>

      <footer className="mx-auto w-full max-w-[30rem] px-4 pb-5 pt-2">
        {!ready && <p className="mb-2 text-center text-base text-ink-2">{defect ? t.crew.decisionRequired : t.crew.reasonRequired}</p>}
        <button type="button" onClick={() => void save()} disabled={!ready || saving} className="min-h-16 w-full rounded-2xl bg-accent text-xl font-bold text-white disabled:opacity-40">
          {t.crew.save}
        </button>
      </footer>
    </div>
  );
}

/** «Как было раньше» — свёрнуто; по касанию последние 3 случая с этим оборудованием. Ничего не подставляет */
function PastCases({ equipmentId, exclude }: { equipmentId: string; exclude?: string }) {
  const { t, lang } = useTranslation();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['crew-history', equipmentId, exclude],
    queryFn: () => api<PastCase[]>(`/api/v1/crew/history/${encodeURIComponent(equipmentId)}${exclude ? `?exclude=${encodeURIComponent(exclude)}` : ''}`),
    enabled: open,
  });
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-line">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-14 w-full items-center justify-between px-4 text-lg font-semibold">
        {t.crew.history}
        <ChevronDown className={cx('size-6 text-ink-2 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="flex flex-col gap-1 px-4 pb-3 text-lg">
          {q.data?.length === 0 && <li className="text-ink-2">{t.crew.historyEmpty}</li>}
          {q.data?.map((c) => (
            <li key={c.from} className="flex flex-wrap gap-x-2 border-t border-line pt-1.5">
              <span className="num text-ink-2">
                {dateShort(c.from, lang)} {timeHM(c.from)}
              </span>
              <span className="font-semibold">{c.reason ? t.crew.stopReasons[c.reason] : translateDynamicText(c.text ?? '', lang)}</span>
              <span className="text-ink-2">· {t.crew.minutes(c.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** «Кузов …00123: сорность, контроль покрытия» */
export function defectFacts(e: LogEntry, t: ReturnType<typeof useTranslation>['t'], lang: ReturnType<typeof useTranslation>['lang']): string {
  const cp = CHECKPOINTS.find((c) => c.id === e.checkpoint)?.name ?? e.checkpoint ?? '';
  return t.crew.defectFacts((e.vin ?? '').slice(-5), translateDefect(e.defect ?? '', lang).toLowerCase(), translateDynamicText(cp, lang).toLowerCase());
}
