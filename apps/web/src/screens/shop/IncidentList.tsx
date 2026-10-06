// Все открытые инциденты (по «ещё N»), по ущербу плану.
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '../../api/client';
import type { Incident } from '../../api/types';
import { Modal } from '../../components/overlay';
import { TONE_CLASS, TONE_ICON, cx } from '../../lib/tones';
import { timeHM } from '../../lib/format';

export function IncidentList({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['incidents'], queryFn: () => api<Incident[]>('/api/v1/incidents'), enabled: open, refetchInterval: 4000 });
  return (
    <Modal open={open} onClose={onClose} title={<h2 className="text-[1.375rem] font-semibold">Все открытые инциденты</h2>}>
      <ul className="flex flex-col gap-2">
        {(q.data ?? []).map((i) => {
          const Icon = TONE_ICON[i.tone];
          return (
            <li key={i.id}>
              <button type="button" onClick={() => onOpen(i.id)} className="flex w-full items-center gap-3 rounded-xl bg-surface px-3 py-2.5 text-left shadow-card hover:bg-surface-2">
                <Icon className={cx('size-5 shrink-0', TONE_CLASS[i.tone].ink)} />
                <span className="flex-1">
                  <span className="block font-semibold">{i.title}</span>
                  <span className="block text-ink-2">{i.impactText}</span>
                </span>
                <span className="num text-sm text-ink-3">с {timeHM(i.openedAt)}</span>
                <ArrowRight className="size-4 text-accent-ink" />
              </button>
            </li>
          );
        })}
        {q.data && q.data.length === 0 && <li className="text-ink-2">Отклонений нет</li>}
      </ul>
    </Modal>
  );
}
