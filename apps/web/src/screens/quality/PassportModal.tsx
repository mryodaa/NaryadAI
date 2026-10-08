// Паспорт автомобиля: сверху — лента всех стадий машины (время, нормы, петли, будущие стадии),
// ниже — отметки по порядку с условиями на оборудовании в момент прохода и замечания контроля.
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CircleCheck, Play, Route, TriangleAlert } from 'lucide-react';
import { MODEL_BY_ID, type BodyView } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { Passport } from '../../api/types';
import { Modal } from '../../components/overlay';
import { SourceBadge } from '../../components/SourceBadge';
import { TONE_CLASS, cx } from '../../lib/tones';
import { ENABLE_3D } from '../../lib/features';
import { webglSupport } from '../../lib/webgl';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { showCarPath } from '../../state/view';
import { startReplay } from '../../state/replay';
import { projectStages } from '../../state/cars';
import { passportRibbon } from '../../state/stages';
import { dateTime, timeHM } from '../../lib/format';
import { useI18n } from '../../i18n/store';
import { translateDynamicText } from '../../i18n/translator';
import { StageRibbon } from './StageRibbon';
import { Vin } from '../shop/CarCard';

export function PassportModal({ vin, onClose }: { vin: string | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['passport', vin], queryFn: () => api<Passport>(`/api/v1/vin/${vin}`), enabled: !!vin, retry: false, refetchInterval: 5000 });
  const p = q.data;
  const navigate = useNavigate();
  const plant = usePlantModel();
  const live = useLive((s) => (p?.body ? s.bodies.find((b) => b.bodyId === p.body!.bodyId) : undefined));
  const bodies = useLive((s) => s.bodies);
  const buffers = useLive((s) => s.snapshot?.buffers) ?? [];
  const nowIso = useLive((s) => s.snapshot?.now);
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const body = p?.body ?? null;
  const view: BodyView | null = live ?? body;
  const ribbon = body && view ? passportRibbon(view, body, plant, projectStages(view, body, plant, bodies, buffers, now), now) : null;

  // события по времени: проходы постов и отметки контроля
  const timeline = p
    ? [...p.steps.map((s) => ({ kind: 'step' as const, at: s.at, step: s })), ...p.checks.map((c) => ({ kind: 'check' as const, at: c.at, check: c }))].sort(
        (a, b) => Date.parse(a.at) - Date.parse(b.at),
      )
    : [];
  const canPath = !!body && ENABLE_3D && webglSupport() !== 'none';
  return (
    <Modal
      open={!!vin}
      onClose={onClose}
      wide
      title={
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-ink-3">{t.quality.passportModalTitle}</div>
            {vin && <Vin vin={vin} className="text-[1.375rem]" />}
            {p && (
              <div className="flex items-center gap-2 text-base text-ink-2">
                {view?.color && <span className="size-3 rounded-full ring-1 ring-line-strong" style={{ background: view.color.hex }} aria-hidden />}
                {view ? `${MODEL_BY_ID[view.model].name}${view.color ? `, ${view.color.name.toLowerCase()}` : ''}` : p.modelName} · {p.where}
              </div>
            )}
          </div>
          {canPath && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <button
                type="button"
                onClick={() => {
                  showCarPath(body!.bodyId);
                  onClose();
                  navigate('/');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent-bg px-3 py-1.5 text-base font-semibold text-accent-ink hover:bg-[#dfe8fb]"
              >
                <Route className="size-4" strokeWidth={2.25} aria-hidden />
                {t.quality.showPathInShop}
              </button>
              {/* повтор истории: копия машины проезжает её реальный путь за ~25 секунд */}
              <button
                type="button"
                onClick={() => {
                  startReplay(body!.bodyId);
                  onClose();
                  navigate('/');
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-base font-semibold text-white hover:bg-accent-ink"
              >
                <Play className="size-4" strokeWidth={2.25} aria-hidden />
                {lang === 'kk' ? 'Жолды қайталау' : lang === 'en' ? 'Replay route' : 'Повторить путь'}
              </button>
            </div>
          )}
        </div>
      }
    >
      {q.isError && <p className="text-lg text-ink-2">{(q.error as Error).message}</p>}
      {!p && !q.isError && <p className="text-ink-2">{t.common.loading}</p>}
      {p && (
        <>
          {ribbon && (
            <div className="mb-5">
              <StageRibbon stages={ribbon} />
              <p className="mt-2 text-sm text-ink-3">{t.quality.futureStageEstimateNote}</p>
            </div>
          )}

          <h3 className="mb-2 text-lg font-semibold">{t.quality.equipmentConditions}</h3>
          {p.checks.length === 0 ? (
            <p className="mb-4 flex items-center gap-2 text-lg font-medium text-ink">
              <CircleCheck className="size-6 text-st-neutral" /> {t.quality.noQualityDefects}
            </p>
          ) : (
            <p className="mb-4 flex items-center gap-2 text-lg font-semibold text-st-attention-ink">
              <TriangleAlert className="size-6" /> {t.quality.qualityDefectsCount(p.checks.length)}
            </p>
          )}
          <ol className="relative ml-3 border-l-2 border-line pl-6">
            {timeline.map((tItem, i) =>
              tItem.kind === 'step' ? (
                <li key={i} className="relative pb-3">
                  <span className="absolute -left-[1.95rem] top-1.5 size-3 rounded-full bg-st-neutral ring-4 ring-page" />
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="num w-12 shrink-0 text-ink-3">{timeHM(tItem.at, lang)}</span>
                    <span className="font-semibold">{translateDynamicText(tItem.step.postName, lang)}</span>
                  </div>
                  {tItem.step.conditions.map((c, k) => (
                    <div key={k} className="ml-[3.75rem] mt-0.5 flex items-center gap-2 text-base">
                      <SourceBadge source={c.source} compact />
                      <span className="text-ink-2">{translateDynamicText(c.label, lang)}:</span>
                      <span className={cx('font-semibold', c.tone !== 'neutral' && TONE_CLASS[c.tone].ink)}>{translateDynamicText(c.value, lang)}</span>
                    </div>
                  ))}
                </li>
              ) : (
                <li key={i} className="relative pb-3">
                  <span className="absolute -left-[2.05rem] top-1 size-4 rounded-full bg-st-attention ring-4 ring-page" />
                  <div className="ml-[3.75rem] rounded-xl bg-st-attention-bg px-3 py-2">
                    <div className="flex items-center gap-2 font-semibold text-st-attention-ink">
                      <SourceBadge source={tItem.check.source} compact /> {translateDynamicText(tItem.check.checkpoint, lang)}: {translateDynamicText(tItem.check.defect, lang).toLowerCase()}
                    </div>
                    <div className="text-base text-ink-2">
                      {t.quality.decisionLabel(translateDynamicText(tItem.check.decision, lang))} · {dateTime(tItem.at, lang)}
                    </div>
                  </div>
                </li>
              ),
            )}
          </ol>
          {!p.plcConnected && (
            <p className="mt-2 text-sm text-ink-3">{t.quality.plcConditionsNote}</p>
          )}
        </>
      )}
    </Modal>
  );
}
