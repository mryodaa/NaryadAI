// «Сейчас»: выпуск к этому часу и один общий список карточек — новые сверху, отложенные внизу.
// Сигнал: «Да» → окно записи, «Нет» → причина одним касанием, «Позже» → вниз списка.
// Если мастер ничего не нажимает — ничего не происходит: сигнал остаётся «не проверено».
import { useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { NO_REASONS, type AreaView, type CrewRequest, type CrewSignal, type LogEntry, type NoReason } from '@allur/contracts/ref';
import { api } from '../../api/client';
import { usePlantModel } from '../../state/plant';
import { useTranslation } from '../../i18n/store';
import { cx } from '../../lib/tones';
import { signalText, sourcesText } from './crewText';
import { RequestCard } from './RequestCard';

export function NowTab({
  area,
  areaView,
  signals,
  requests,
  by,
  onOpenEntry,
}: {
  area: string;
  areaView: AreaView | null;
  signals: CrewSignal[];
  requests: CrewRequest[];
  by: string;
  onOpenEntry: (e: LogEntry) => void;
}) {
  const { t } = useTranslation();
  // ответ ушёл — карточку убираем сразу, не дожидаясь рассылки
  const [answered, setAnswered] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const mine = signals
    .filter((s) => s.area === area && (s.status === 'open' || s.status === 'later') && !answered.has(s.signalId))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.status === 'later') return Date.parse(a.laterAt ?? a.openedAt) - Date.parse(b.laterAt ?? b.openedAt);
      return Date.parse(b.openedAt) - Date.parse(a.openedAt);
    });

  // запросы руководителя — в том же списке; ждущие ответа руководителя и принятые тоже видны
  const myRequests = requests.filter((r) => r.area === area && (r.status === 'sent' || r.status === 'viewed' || r.status === 'accepted' || r.status === 'counter'));
  type Item = { key: string; at: number; later: boolean; node: React.ReactNode };
  const items: Item[] = [
    ...myRequests.map((r) => ({ key: r.requestId, at: Date.parse(r.at), later: false, node: <RequestCard key={r.requestId} req={r} by={by} onError={setError} /> })),
    ...mine.map((s) => ({
      key: s.signalId,
      at: Date.parse(s.status === 'later' ? (s.laterAt ?? s.openedAt) : s.openedAt),
      later: s.status === 'later',
      node: <SignalCard key={s.signalId} sig={s} onAnswer={(a, r) => void answer(s, a, r)} />,
    })),
  ].sort((a, b) => (a.later !== b.later ? (a.later ? 1 : -1) : a.later ? a.at - b.at : b.at - a.at));

  const answer = async (sig: CrewSignal, action: 'yes' | 'no' | 'later', noReason?: NoReason) => {
    setError(null);
    if (action !== 'later') setAnswered((s) => new Set(s).add(sig.signalId));
    try {
      const r = await api<{ ok: true; entry?: LogEntry }>(`/api/v1/crew/signals/${encodeURIComponent(sig.signalId)}`, {
        method: 'POST',
        json: { action, noReason, by },
      });
      if (action === 'yes' && r.entry) onOpenEntry(r.entry);
    } catch (e) {
      setAnswered((s) => {
        const n = new Set(s);
        n.delete(sig.signalId);
        return n;
      });
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <OutputLine areaView={areaView} />
      {error && <p className="rounded-xl bg-st-fault-bg p-3 text-lg text-st-fault-ink">{t.crew.sendError(error)}</p>}
      {items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-3 text-center text-lg text-ink-2">
          <CircleCheck className="size-12 text-emerald-400" aria-hidden />
          {t.crew.nowEmpty}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">{items.map((i) => i.node)}</ul>
      )}
    </div>
  );
}

/** «Выпуск 74 из 80 к этому часу» — зелёным или янтарным, без лишних цифр */
function OutputLine({ areaView }: { areaView: AreaView | null }) {
  const { t } = useTranslation();
  if (!areaView || areaView.planToNow <= 0) return null;
  const ok = areaView.done >= areaView.planToNow - 1;
  return (
    <div className={cx('rounded-2xl px-4 py-3 text-xl font-semibold', ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-st-attention-bg text-st-attention-ink')}>
      {t.crew.outputLine(areaView.done, areaView.planToNow)}
    </div>
  );
}

function SignalCard({ sig, onAnswer }: { sig: CrewSignal; onAnswer: (a: 'yes' | 'no' | 'later', r?: NoReason) => void }) {
  const { t, lang } = useTranslation();
  const model = usePlantModel();
  const [askNo, setAskNo] = useState(false);
  return (
    <li className={cx('rounded-2xl border-2 border-dashed bg-surface p-4', sig.status === 'later' ? 'border-line-strong opacity-80' : 'border-st-attention/70')}>
      <p className="text-xl font-semibold leading-snug">{signalText(sig, model, t, lang)}</p>
      <p className="mt-1 text-lg text-ink-2">
        {sourcesText(sig.sources, t)}
        {sig.status === 'later' && ` · ${t.crew.postponed}`}
      </p>
      {!askNo ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <BigButton onClick={() => onAnswer('yes')} primary>
            {t.crew.yes}
          </BigButton>
          <BigButton onClick={() => setAskNo(true)}>{t.crew.no}</BigButton>
          <BigButton onClick={() => onAnswer('later')} muted>
            {t.crew.later}
          </BigButton>
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-lg text-ink-2">{t.crew.whyNo}</p>
          <div className="grid grid-cols-2 gap-2">
            {NO_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onAnswer('no', r)}
                className="min-h-[4.5rem] rounded-xl bg-surface-2 px-2 text-lg font-semibold leading-tight ring-1 ring-line active:bg-line"
              >
                {t.crew.noReasons[r]}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setAskNo(false)} className="mt-2 min-h-14 w-full rounded-xl text-lg text-ink-2">
            {t.crew.cancel}
          </button>
        </div>
      )}
    </li>
  );
}

export function BigButton({ children, onClick, primary, muted, disabled }: { children: React.ReactNode; onClick: () => void; primary?: boolean; muted?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'min-h-14 rounded-xl px-2 text-lg font-semibold active:scale-[0.98] disabled:opacity-50',
        primary ? 'bg-accent text-white' : muted ? 'bg-transparent text-ink-2 ring-1 ring-line' : 'bg-surface-2 text-ink ring-1 ring-line-strong',
      )}
    >
      {children}
    </button>
  );
}
