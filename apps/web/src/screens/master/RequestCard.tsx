// Запрос руководителя на телефоне мастера. Открыл — руководитель видит «просмотрено» (само).
// «Принять» — одно касание; «Предложить иначе» — время и строка по желанию; «Не могу» — плитка причины.
// После «Принять» остаётся одна кнопка «Сделано». Мастер молчит — ничего не происходит.
import { useEffect, useRef, useState } from 'react';
import { CANT_REASONS, type CantReason, type CrewRequest } from '@allur/contracts/ref';
import { api } from '../../api/client';
import { useLive } from '../../state/live';
import { useTranslation } from '../../i18n/store';
import { translateDynamicText } from '../../i18n/translator';
import { timeHM } from '../../lib/format';
import { cx } from '../../lib/tones';
import { usePlantModel } from '../../state/plant';
import { BigButton } from './NowTab';
import { requestText } from './crewText';

type Mode = 'idle' | 'counter' | 'cant';
type Action = 'view' | 'accept' | 'counter' | 'cant' | 'done';

export function RequestCard({ req, by, onError }: { req: CrewRequest; by: string; onError: (e: string) => void }) {
  const { t, lang } = useTranslation();
  const model = usePlantModel();
  const now = useLive((s) => s.snapshot?.now ?? null);
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(() => suggestTime(req.dueAt, now));
  const [text, setText] = useState('');
  const viewed = useRef(false);

  const send = async (action: Action, extra: { at?: string; text?: string; cantReason?: CantReason } = {}) => {
    setBusy(true);
    try {
      await api(`/api/v1/crew/requests/${encodeURIComponent(req.requestId)}`, { method: 'POST', json: { action, by, ...extra } });
      setMode('idle');
      setText('');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // карточка на экране — значит, мастер её видит: «просмотрено» без касаний
  useEffect(() => {
    if (req.status !== 'sent' || viewed.current) return;
    viewed.current = true;
    void api(`/api/v1/crew/requests/${encodeURIComponent(req.requestId)}`, { method: 'POST', json: { action: 'view', by } }).catch(() => {
      viewed.current = false;
    });
  }, [req.status, req.requestId, by]);

  const waiting = req.status === 'sent' || req.status === 'viewed';
  return (
    <li className="rounded-2xl bg-surface p-4 ring-1 ring-line-strong">
      <p className="text-base text-ink-2">{t.crew.fromManager}</p>
      <p className="text-xl font-semibold leading-snug">{requestText(req, model, t, lang)}</p>
      <p className="mt-1 text-lg text-ink-2">
        {t.crew.dueBy(timeHM(req.dueAt))} · {t.crew.whyLabel}: {translateDynamicText(req.why, lang)}
      </p>
      {req.managerAnswer === 'keep' && waiting && <p className="mt-2 text-lg font-semibold text-st-attention-ink">{t.crew.managerKept}</p>}

      {waiting && mode === 'idle' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="col-span-2 grid">
            <BigButton primary disabled={busy} onClick={() => void send('accept')}>
              {t.crew.accept}
            </BigButton>
          </div>
          <BigButton disabled={busy} onClick={() => setMode('counter')}>
            {t.crew.counterOffer}
          </BigButton>
          <BigButton disabled={busy} onClick={() => setMode('cant')}>
            {t.crew.cant}
          </BigButton>
        </div>
      )}

      {waiting && mode === 'counter' && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 text-lg text-ink-2">
            {t.crew.counterTimeLabel}
            <input
              type="time"
              value={time}
              step={300}
              onChange={(e) => setTime(e.target.value)}
              className="num min-h-14 rounded-xl bg-surface-2 px-3 text-xl font-semibold text-ink ring-1 ring-line"
            />
          </label>
          <input
            type="text"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.crew.counterTextPlaceholder}
            className="min-h-14 rounded-xl bg-surface-2 px-4 text-lg ring-1 ring-line placeholder:text-ink-3"
          />
          <div className="grid grid-cols-2 gap-2">
            <BigButton muted onClick={() => setMode('idle')}>
              {t.crew.cancel}
            </BigButton>
            <BigButton primary disabled={busy || !time || !now} onClick={() => now && void send('counter', { at: atTime(now, time), text })}>
              {t.crew.send}
            </BigButton>
          </div>
        </div>
      )}

      {waiting && mode === 'cant' && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.crew.cantTextPlaceholder}
            className="min-h-14 rounded-xl bg-surface-2 px-4 text-lg ring-1 ring-line placeholder:text-ink-3"
          />
          <div className="grid grid-cols-3 gap-2">
            {CANT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={busy}
                onClick={() => void send('cant', { cantReason: r, text })}
                className="min-h-[4.5rem] rounded-xl bg-surface-2 px-1 text-lg font-semibold leading-tight ring-1 ring-line active:bg-line"
              >
                {t.crew.cantReasons[r]}
              </button>
            ))}
          </div>
          <BigButton muted onClick={() => setMode('idle')}>
            {t.crew.cancel}
          </BigButton>
        </div>
      )}

      {req.status === 'counter' && <p className="mt-3 rounded-xl bg-surface-2 p-3 text-lg text-ink-2">{t.crew.waitingManager(req.counter?.at ? timeHM(req.counter.at) : '—')}</p>}

      {req.status === 'accepted' && (
        <div className="mt-3 flex flex-col gap-2">
          <p className={cx('text-lg font-semibold', req.managerAnswer === 'agree' ? 'text-emerald-300' : 'text-ink-2')}>
            {req.managerAnswer === 'agree' ? t.crew.managerAgreed(timeHM(req.dueAt)) : t.crew.acceptedFor(timeHM(req.dueAt))}
          </p>
          <BigButton primary disabled={busy} onClick={() => void send('done')}>
            {t.crew.done}
          </BigButton>
        </div>
      )}
    </li>
  );
}

/** Предложение по умолчанию: через 20 минут от сейчас, кратно 5 минутам (раньше срока — то же самое) */
function suggestTime(dueAt: string, now: string | null): string {
  const base = now ? Date.parse(now) + 20 * 60_000 : Date.parse(dueAt);
  const rounded = Math.ceil(base / (5 * 60_000)) * 5 * 60_000;
  return timeHM(rounded);
}

/** «14:10» → время завода в формате двойника на ту же дату, что и сейчас */
function atTime(nowIso: string, hhmm: string): string {
  return `${nowIso.slice(0, 11)}${hhmm}:00${nowIso.slice(19)}`;
}
