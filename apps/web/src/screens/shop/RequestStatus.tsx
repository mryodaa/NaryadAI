// Запрос мастеру у руководителя: статус одним словом, ответ мастера, «Согласен» / «Оставить как было».
import { useState } from 'react';
import { Send } from 'lucide-react';
import type { CrewRequest } from '@allur/contracts/ref';
import { api } from '../../api/client';
import { usePlantModel } from '../../state/plant';
import { useTranslation } from '../../i18n/store';
import { translateDynamicText } from '../../i18n/translator';
import { timeHM } from '../../lib/format';
import { cx } from '../../lib/tones';
import { Button } from '../../components/ui';
import { requestText } from '../master/crewText';

const STATUS_TONE: Record<CrewRequest['status'], string> = {
  sent: 'bg-surface-2 text-ink-2',
  viewed: 'bg-surface-2 text-ink-2',
  accepted: 'bg-st-neutral-bg text-st-neutral-ink',
  counter: 'bg-st-attention-bg text-st-attention-ink',
  cant: 'bg-st-fault-bg text-st-fault-ink',
  done: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
};

export function useRecipient(req: Pick<CrewRequest, 'area'>): string {
  const { t } = useTranslation();
  const model = usePlantModel();
  return t.crew.areaMaster(t.domain.areas[req.area]?.short ?? model.stageById.get(req.area)?.short ?? req.area);
}

/** Статус одним словом */
export function RequestStatusChip({ req }: { req: CrewRequest }) {
  const { t } = useTranslation();
  return <span className={cx('rounded-md px-2 py-0.5 text-sm font-semibold', STATUS_TONE[req.status])}>{t.crew.requestStatus[req.status]}</span>;
}

export function RequestStatus({ req, compact, onChooseAnother }: { req: CrewRequest; compact?: boolean; onChooseAnother?: () => void }) {
  const { t, lang } = useTranslation();
  const model = usePlantModel();
  const recipient = useRecipient(req);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (a: 'agree' | 'keep') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/crew/requests/${encodeURIComponent(req.requestId)}/answer`, { method: 'POST', json: { answer: a } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Send className="size-4 text-ink-3" aria-hidden />
        <span className="font-semibold">{t.crew.requestTitle(recipient)}</span>
        <RequestStatusChip req={req} />
      </div>
      <p className={cx('leading-snug', compact ? 'text-base' : 'text-lg')}>
        {requestText(req, model, t, lang)} <span className="num text-ink-3">· {t.crew.dueBy(timeHM(req.dueAt))}</span>
      </p>
      {req.status === 'counter' && (
        <>
          <p className="font-semibold text-st-attention-ink">{t.crew.masterProposes(req.counter?.at ? timeHM(req.counter.at) : '—', req.counter?.text ?? '')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void answer('agree')}>
              {t.crew.agree}
            </Button>
            <Button variant="secondary" onClick={() => void answer('keep')}>
              {t.crew.keep}
            </Button>
          </div>
        </>
      )}
      {req.status === 'cant' && (
        <>
          <p className="font-semibold text-st-fault-ink">{t.crew.masterCant((t.crew.cantReasons[req.cantReason ?? ''] ?? '').toLowerCase(), req.cantText ?? '')}</p>
          {onChooseAnother && (
            <Button variant="secondary" onClick={onChooseAnother} className="self-start">
              {t.crew.chooseAnother}
            </Button>
          )}
        </>
      )}
      {req.managerAnswer === 'keep' && (req.status === 'viewed' || req.status === 'sent') && <p className="text-ink-2">{t.crew.managerKept}</p>}
      {(req.status === 'accepted' || req.status === 'done') && (
        <p className="text-ink-2">{req.action ? (req.workOrderAt ? t.crew.workOrderAt(timeHM(req.workOrderAt)) : '') : t.crew.noWorkOrder}</p>
      )}
      {error && <p className="font-medium text-st-fault-ink">{error}</p>}
    </div>
  );
}
