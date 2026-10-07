// Паспорт автомобиля: вертикальная лента маршрута кузова с условиями в момент прохода.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Box, CircleCheck, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import type { Passport } from '../../api/types';
import { Modal } from '../../components/overlay';
import { SourceBadge } from '../../components/SourceBadge';
import { TONE_CLASS, cx } from '../../lib/tones';
import { ENABLE_3D } from '../../lib/features';
import { webglSupport } from '../../lib/webgl';
import { showVinPath } from '../../state/view';
import { dateTime, timeHM } from '../../lib/format';

export function PassportModal({ vin, onClose }: { vin: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['passport', vin], queryFn: () => api<Passport>(`/api/v1/vin/${vin}`), enabled: !!vin, retry: false });
  const p = q.data;
  const navigate = useNavigate();
  // события по времени: проходы постов и отметки контроля
  const timeline = p
    ? [...p.steps.map((s) => ({ kind: 'step' as const, at: s.at, step: s })), ...p.checks.map((c) => ({ kind: 'check' as const, at: c.at, check: c }))].sort(
        (a, b) => Date.parse(a.at) - Date.parse(b.at),
      )
    : [];
  return (
    <Modal
      open={!!vin}
      onClose={onClose}
      title={
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-ink-3">Паспорт автомобиля</div>
          <h2 className="font-mono text-[1.375rem] font-semibold tracking-wide">{vin}</h2>
          {p && (
            <div className="text-base text-ink-2">
              {p.modelName} · {p.where}
            </div>
          )}
          {p && ENABLE_3D && webglSupport() !== 'none' && p.steps.length > 1 && (
            <button
              type="button"
              onClick={() => {
                showVinPath(p.vin, p.steps.map((s) => s.post));
                onClose();
                navigate('/?view=3d');
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-accent-bg px-3 py-1.5 text-base font-semibold text-accent-ink hover:bg-[#dfe8fb] print:hidden"
            >
              <Box className="size-4" strokeWidth={2.25} aria-hidden />
              Показать путь в 3D
            </button>
          )}
        </div>
      }
    >
      {q.isError && <p className="text-lg text-ink-2">{(q.error as Error).message}</p>}
      {!p && !q.isError && <p className="text-ink-2">Загружаю…</p>}
      {p && (
        <>
          {p.checks.length === 0 ? (
            <p className="mb-4 flex items-center gap-2 text-lg font-medium text-ink">
              <CircleCheck className="size-6 text-st-neutral" /> Замечаний контроля качества нет
            </p>
          ) : (
            <p className="mb-4 flex items-center gap-2 text-lg font-semibold text-st-attention-ink">
              <TriangleAlert className="size-6" /> Замечаний контроля: {p.checks.length}
            </p>
          )}
          <ol className="relative ml-3 border-l-2 border-line pl-6">
            {timeline.map((t, i) =>
              t.kind === 'step' ? (
                <li key={i} className="relative pb-3">
                  <span className="absolute -left-[1.95rem] top-1.5 size-3 rounded-full bg-st-neutral ring-4 ring-page" />
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="num w-12 shrink-0 text-ink-3">{timeHM(t.at)}</span>
                    <span className="font-semibold">{t.step.postName}</span>
                  </div>
                  {t.step.conditions.map((c, k) => (
                    <div key={k} className="ml-[3.75rem] mt-0.5 flex items-center gap-2 text-base">
                      <SourceBadge source={c.source} compact />
                      <span className="text-ink-2">{c.label}:</span>
                      <span className={cx('font-semibold', c.tone !== 'neutral' && TONE_CLASS[c.tone].ink)}>{c.value}</span>
                    </div>
                  ))}
                </li>
              ) : (
                <li key={i} className="relative pb-3">
                  <span className="absolute -left-[2.05rem] top-1 size-4 rounded-full bg-st-attention ring-4 ring-page" />
                  <div className="ml-[3.75rem] rounded-xl bg-st-attention-bg px-3 py-2">
                    <div className="flex items-center gap-2 font-semibold text-st-attention-ink">
                      <SourceBadge source={t.check.source} compact /> {t.check.checkpoint}: {t.check.defect.toLowerCase()}
                    </div>
                    <div className="text-base text-ink-2">
                      решение — {t.check.decision} · {dateTime(t.at)}
                    </div>
                  </div>
                </li>
              ),
            )}
          </ol>
          {!p.plcConnected && (
            <p className="mt-2 text-sm text-ink-3">Условия на оборудовании видны со ступени 1, когда подключены контроллеры. Сейчас — только маршрут из 1С:MES и отметки 1С:QLS.</p>
          )}
        </>
      )}
    </Modal>
  );
}
