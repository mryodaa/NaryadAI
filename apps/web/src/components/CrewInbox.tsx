// Ответы мастеров и просьбы о помощи — значок в шапке руководителя со списком. Главный экран не перегружаем:
// цифра — только то, что ждёт руководителя: «предложено иначе», «не может» и непросмотренные просьбы.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, HandHelping, Inbox } from 'lucide-react';
import type { LogEntry } from '@allur/contracts/ref';
import { api } from '../api/client';
import { useLive } from '../state/live';
import { openIncident } from '../state/view';
import { useEscLayer } from './overlay';
import { Button } from './ui';
import { useTranslation } from '../i18n/store';
import { translateDynamicText } from '../i18n/translator';
import { timeHM } from '../lib/format';
import { cx } from '../lib/tones';
import { RequestStatus, useRecipient } from '../screens/shop/RequestStatus';
import { defectFacts } from '../screens/master/EntrySheet';

export function CrewInbox() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const requests = useLive((s) => s.crew?.requests) ?? [];
  const log = useLive((s) => s.crew?.log) ?? [];
  const help = log.filter((e) => e.needHelp && e.helpAt).sort((a, b) => Date.parse(b.helpAt!) - Date.parse(a.helpAt!));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEscLayer(() => setOpen(false), open);
  const pending = requests.filter((r) => r.status === 'counter' || r.status === 'cant').length + help.filter((e) => !e.helpAckAt).length;

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t.crew.inboxTitle}
        aria-label={t.crew.inboxTitle}
        aria-expanded={open}
        className={cx('relative grid size-9 place-items-center rounded-xl hover:bg-surface-2', open ? 'text-accent' : 'text-ink-2')}
      >
        <Inbox className="size-5" />
        {pending > 0 && (
          <span className="num absolute -right-1 -top-1 min-w-5 rounded-full bg-st-attention px-1 text-xs font-bold leading-5 text-white">{pending}</span>
        )}
      </button>
      {open && (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 flex max-h-[70vh] w-[26rem] flex-col max-lg:fixed max-lg:inset-x-2 max-lg:top-16 max-lg:w-auto gap-2 overflow-y-auto rounded-2xl bg-surface p-3 shadow-pop ring-1 ring-line">
            {help.length > 0 && (
              <>
                <h2 className="px-1 text-lg font-semibold">{t.crew.helpTitle}</h2>
                {help.map((e) => (
                  <HelpItem key={e.entryId} e={e} />
                ))}
              </>
            )}
            <h2 className="px-1 text-lg font-semibold">{t.crew.inboxTitle}</h2>
            {requests.length === 0 && <p className="px-1 pb-2 text-ink-2">{t.crew.inboxEmpty}</p>}
            {requests.map((r) => (
              <div key={r.requestId} className={cx('flex flex-col gap-2 rounded-xl p-3', r.status === 'counter' || r.status === 'cant' ? 'bg-st-attention-bg/60' : 'bg-surface-2')}>
                <RequestStatus req={r} compact />
                {r.incidentId && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      navigate('/');
                      openIncident(r.incidentId!);
                    }}
                    className="inline-flex items-center gap-1 self-start text-base font-semibold text-accent-ink hover:underline"
                  >
                    {t.shop.investigate}
                    <ArrowRight className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Просьба мастера: запись журнала с «Нужна помощь начальника» */
function HelpItem({ e }: { e: LogEntry }) {
  const { t, lang } = useTranslation();
  const who = useRecipient(e);
  const [busy, setBusy] = useState(false);
  const ack = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/v1/crew/log/${encodeURIComponent(e.entryId)}/ack`, { method: 'POST' });
    } finally {
      setBusy(false);
    }
  };
  const what = e.kind === 'defect' ? defectFacts(e, t, lang) : translateDynamicText(e.facts, lang);
  const why = e.kind === 'defect' ? (e.decision ? t.crew.decisions[e.decision] : '') : e.reason ? t.crew.stopReasons[e.reason] : '';
  return (
    <div className={cx('flex flex-col gap-1.5 rounded-xl p-3', e.helpAckAt ? 'bg-surface-2' : 'bg-st-attention-bg/60')}>
      <div className="flex items-center gap-2 font-semibold">
        <HandHelping className="size-4 shrink-0 text-st-attention-ink" aria-hidden />
        {t.crew.helpFrom(who)}
        <span className="num ml-auto text-sm font-normal text-ink-3">{e.helpAt ? timeHM(e.helpAt) : ''}</span>
      </div>
      <p className="leading-snug">
        {what}
        {why && <span className="text-ink-2"> · {why}</span>}
      </p>
      {e.comment && <p className="text-ink-2">«{e.comment}»</p>}
      {!e.helpAckAt && (
        <Button variant="primary" onClick={() => void ack()} className="self-start">
          {t.crew.helpAck}
        </Button>
      )}
    </div>
  );
}
