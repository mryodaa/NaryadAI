// «Смена»: выпуск за смену и по часам (план и факт), простои, записи без причины.
// В последний час — «Сдать смену»: сводка собирается сама, заметка следующей смене — по желанию.
// Мастер не сдал — смена закрывается сама по времени, со сводкой без заметки.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewShiftView } from '@allur/contracts/ref';
import { api } from '../../api/client';
import { useTranslation } from '../../i18n/store';
import { timeHM } from '../../lib/format';
import { cx } from '../../lib/tones';

export function ShiftTab({ area, nowIso, by }: { area: string; nowIso: string | null; by: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['crew-shift', area], queryFn: () => api<CrewShiftView>(`/api/v1/crew/shift/${encodeURIComponent(area)}`), refetchInterval: 5000 });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = q.data;
  if (!v) return null;
  const s = v.summary;
  const endMs = v.endsAt ? Date.parse(v.endsAt) : null;
  const lastHour = endMs !== null && nowIso !== null && endMs - Date.parse(nowIso) <= 60 * 60_000;

  const handOver = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/crew/shift/${encodeURIComponent(area)}/close`, { method: 'POST', json: { note, by } });
      await qc.invalidateQueries({ queryKey: ['crew-shift', area] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {v.prevNote && (
        <div className="rounded-2xl bg-st-waiting-bg p-4 text-lg">
          <div className="text-base text-ink-2">
            {t.crew.prevNote} · {timeHM(v.prevNote.at)}
          </div>
          «{v.prevNote.note}»
        </div>
      )}

      <div className="rounded-2xl bg-surface p-4">
        <div className="text-lg text-ink-2">{t.crew.shiftOutput}</div>
        <div className="num text-[2rem] font-bold">{t.crew.shiftOutputValue(s.done, s.plan)}</div>
      </div>

      {v.hours.length > 0 && (
        <div className="rounded-2xl bg-surface p-4">
          <div className="mb-1 text-lg text-ink-2">{t.crew.byHours}</div>
          <table className="num w-full text-lg">
            <thead>
              <tr className="text-left text-base text-ink-3">
                <th className="py-1 font-medium">{t.crew.hourCol}</th>
                <th className="py-1 text-right font-medium">{t.crew.planCol}</th>
                <th className="py-1 text-right font-medium">{t.crew.factCol}</th>
              </tr>
            </thead>
            <tbody>
              {v.hours.map((h) => (
                <tr key={h.hour} className="border-t border-line">
                  <td className="py-1.5">{h.hour}</td>
                  <td className="py-1.5 text-right text-ink-2">{h.plan}</td>
                  <td className={cx('py-1.5 text-right font-semibold', h.fact < h.plan - 1 && 'text-st-attention-ink')}>{h.fact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1 rounded-2xl bg-surface p-4 text-lg">
        <span>{t.crew.downtimeMin(s.downtimeMin)}</span>
        <span className={cx(s.withoutReason > 0 && 'font-semibold text-st-attention-ink')}>{t.crew.withoutReason(s.withoutReason)}</span>
        <span>{t.crew.openRequests(s.openRequests)}</span>
      </div>

      {v.close ? (
        <div className="rounded-2xl bg-surface p-4 text-lg">
          <div className="font-semibold">{v.close.auto ? t.crew.autoClosed(timeHM(v.close.at)) : t.crew.handedOver(timeHM(v.close.at))}</div>
          {v.close.note && <div className="text-ink-2">«{v.close.note}»</div>}
        </div>
      ) : lastHour ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.crew.handOverNote}
            className="min-h-14 rounded-xl bg-surface px-4 text-lg ring-1 ring-line placeholder:text-ink-3"
          />
          <button type="button" disabled={busy} onClick={() => void handOver()} className="min-h-16 rounded-2xl bg-accent text-xl font-bold text-white disabled:opacity-40">
            {t.crew.handOver}
          </button>
        </div>
      ) : (
        endMs !== null && <p className="text-center text-base text-ink-3">{t.crew.handOverSoon(timeHM(endMs - 60 * 60_000))}</p>
      )}
      {error && <p className="rounded-xl bg-st-fault-bg p-3 text-lg text-st-fault-ink">{t.crew.sendError(error)}</p>}
    </div>
  );
}
