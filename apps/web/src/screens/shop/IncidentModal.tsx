// Инцидент в формате истории: что случилось → почему → чем грозит → что делать.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, ChevronDown, CircleCheck, Send } from 'lucide-react';
import { api } from '../../api/client';
import type { DecisionResponse, Incident, IncidentOption } from '../../api/types';
import { Modal } from '../../components/overlay';
import { DownloadButton } from '../../components/DownloadButton';
import { SourceBadge } from '../../components/SourceBadge';
import { ExplainView } from '../../components/ExplainView';
import { Button, StatusChip } from '../../components/ui';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { rememberOrder } from '../../state/decisions';
import { RequestStatus, useRecipient } from './RequestStatus';
import { TONE_CLASS, cx } from '../../lib/tones';
import { CARS, money, num, plural, timeHM } from '../../lib/format';

import { useTranslation } from '../../i18n/store';
import { translateDynamicText, translateRiskLevel } from '../../i18n/translator';

export function IncidentModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t, lang } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['incident', id], queryFn: () => api<Incident>(`/api/v1/incidents/${id}`), enabled: !!id, refetchInterval: 4000 });
  const forecast = useLive((s) => s.snapshot?.kpi.monthPlan.forecast ?? null);
  const [why, setWhy] = useState(false);
  const [result, setResult] = useState<DecisionResponse | null>(null);
  // мастер не может — руководитель выбирает другой вариант
  const [again, setAgain] = useState(false);
  const model = usePlantModel();
  const nowIso = useLive((s) => s.snapshot?.now ?? null);
  // последний запрос мастеру по этому инциденту
  const request = useLive((s) => s.crew?.requests.find((r) => r.incidentId === id) ?? null);
  const decide = useMutation({
    mutationFn: ({ optionId, dueAt }: { optionId: string; dueAt?: string }) =>
      api<DecisionResponse>('/api/v1/decisions', { method: 'POST', json: { incidentId: id, optionId, dueAt, decidedBy: t.crew.fromManager } }),
    onSuccess: (r) => {
      setResult(r);
      setAgain(false);
      if (id && r.workOrder) rememberOrder(id, r.workOrder.scheduledAt);
      void qc.invalidateQueries({ queryKey: ['incident', id] });
      void qc.invalidateQueries({ queryKey: ['incidents'] });
    },
  });
  const inc = q.data;
  const close = () => {
    setWhy(false);
    setResult(null);
    setAgain(false);
    decide.reset();
    onClose();
  };
  const noAction = inc?.options.find((o) => o.id === 'do_nothing' || o.id === 'postpone');
  // работы на оборудовании производственного участка уходят мастеру запросом (то же правило, что у шлюза)
  const toMaster = (o: IncidentOption) =>
    !!inc && o.id !== 'do_nothing' && o.id !== 'postpone' && model.production.some((s) => s.id === inc.area) && (!o.workOrder || MASTER_JOBS.has(o.workOrder.action));

  const toneWord = (tone: Incident['tone']): string => {
    return tone === 'fault' ? t.incident.toneFault : tone === 'maintenance' ? t.incident.toneMaintenance : tone === 'waiting' ? t.incident.toneWaiting : t.incident.toneAttention;
  };

  return (
    <Modal
      open={!!id}
      onClose={close}
      wide
      title={
        inc ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={inc.decision ? 'neutral' : inc.tone} label={inc.decision ? t.incident.modalStatusDecided : inc.status === 'resolved' ? t.incident.modalStatusResolved : toneWord(inc.tone)} className="self-start" />
              {(inc.check === 'signal' || inc.check === 'probable') && (
                <span className="rounded-lg border border-dashed border-line-strong px-2 py-0.5 text-sm font-semibold text-ink-2">
                  {inc.check === 'signal' ? t.crew.signalUnverified : t.crew.probableUnverified}
                </span>
              )}
            </div>
            <h2 className="text-[1.5rem] font-semibold leading-tight">{translateDynamicText(inc.title, lang)}</h2>
            <DownloadButton type="incident" formats={['pdf', 'docx']} params={{ incidentId: inc.id, by: t.reports.managerRole }} label={t.reports.incident} className="self-start" />
          </div>
        ) : (
          '…'
        )
      }
    >
      {!inc ? (
        <p className="text-ink-2">{q.isError ? t.incident.modalStatusResolved : t.common.loading}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Block n={1} title={t.incident.blockHappened}>
            <p className="text-lg leading-snug">
              {translateDynamicText(inc.happened.text, lang)} <span className="num whitespace-nowrap text-ink-3">· {timeHM(inc.happened.at)}</span>
            </p>
          </Block>

          <Block n={2} title={t.incident.blockWhy}>
            <p className="text-lg leading-snug">{translateDynamicText(inc.why.text, lang)}</p>
            {inc.why.chart && <FilterChart chart={inc.why.chart} />}
            {inc.signals.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {inc.signals.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-base text-ink-2">
                    <SourceBadge source={s.source} compact />
                    <span>{translateDynamicText(s.text, lang)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block n={3} title={t.incident.blockThreat}>
            <p className="text-lg leading-snug">{translateDynamicText(inc.threat.text, lang)}</p>
          </Block>

          <Block n={4} title={t.crew.variants}>
            {(inc.decision || result) && !again ? (
              <div className="flex flex-col gap-3">
                <Decided inc={inc} result={result} />
                {request && (
                  <div className="rounded-2xl bg-surface p-4 shadow-card">
                    <RequestStatus
                      req={request}
                      onChooseAnother={() => {
                        setAgain(true);
                        setResult(null);
                      }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(3, inc.options.length)}, minmax(0, 1fr))` }}>
                {inc.options.map((o) => (
                  <OptionCard
                    key={o.id}
                    o={o}
                    area={inc.area}
                    toMaster={toMaster(o)}
                    nowIso={nowIso}
                    monthForecast={forecast !== null && noAction ? forecast + noAction.carsLost - o.carsLost : null}
                    busy={decide.isPending}
                    onAccept={(dueAt) => decide.mutate({ optionId: o.id, dueAt })}
                  />
                ))}
              </div>
            )}
            {decide.isError && <p className="mt-2 font-medium text-st-fault-ink">{(decide.error as Error).message}</p>}
          </Block>

          <div>
            <button type="button" onClick={() => setWhy((v) => !v)} className="inline-flex items-center gap-1.5 font-semibold text-accent-ink hover:underline">
              {t.incident.whyTwinThinksSo}
              <ChevronDown className={cx('size-5 transition-transform', why && 'rotate-180')} />
            </button>
            {why && (
              <div className="mt-3 rounded-2xl bg-surface-2 p-4">
                <ExplainView explain={inc.explain} />
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Block({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3">
      <div className="grid size-8 place-items-center rounded-full bg-surface text-base font-semibold text-ink-2 shadow-card">{n}</div>
      <div>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
        {children}
      </div>
    </section>
  );
}

const MASTER_JOBS = new Set(['replace_filter', 'maintenance', 'repair', 'inspect']);

function OptionCard({
  o,
  area,
  toMaster,
  nowIso,
  monthForecast,
  onAccept,
  busy,
}: {
  o: IncidentOption;
  area: string;
  toMaster: boolean;
  nowIso: string | null;
  monthForecast: number | null;
  onAccept: (dueAt?: string) => void;
  busy: boolean;
}) {
  const { t, lang } = useTranslation();
  const recipient = useRecipient({ area });
  // «Отправить мастеру»: кому и срок — по умолчанию время из варианта, руководитель может поправить
  const defaultDue = o.workOrder ? timeHM(o.workOrder.scheduledAt) : nowIso ? timeHM(nowIso) : '';
  const [confirm, setConfirm] = useState(false);
  const [due, setDue] = useState(defaultDue);
  const send = () => {
    if (due === defaultDue || !nowIso) onAccept();
    else onAccept(`${nowIso.slice(0, 11)}${due}:00${nowIso.slice(19)}`);
  };
  return (
    <div className={cx('flex flex-col gap-2 rounded-2xl border-2 bg-surface p-4 shadow-card', o.recommended ? 'border-accent' : 'border-transparent')}>
      {o.recommended && <span className="self-start rounded-md bg-accent px-2 py-0.5 text-sm font-semibold text-white">{t.incident.recommended}</span>}
      <h4 className="text-[1.125rem] font-semibold leading-snug">{translateDynamicText(o.title, lang)}</h4>
      <p className="text-base leading-snug text-ink-2">{translateDynamicText(o.detail, lang)}</p>
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 text-base">
        <dt className="text-ink-3">{t.incident.carsLost}</dt>
        <dd className={cx('num text-right font-semibold', o.carsLost > 0 && 'text-st-attention-ink')}>
          {o.carsLost > 0 ? `${num(o.carsLost)} ${plural(o.carsLost, CARS, lang)}` : t.incident.noLosses}
        </dd>
        {o.repaints > 0 && (
          <>
            <dt className="text-ink-3">{t.incident.repaints}</dt>
            <dd className="num text-right font-semibold">{num(o.repaints)} {t.incident.repaintsUnit}</dd>
          </>
        )}
        <dt className="text-ink-3">{t.incident.cost}</dt>
        <dd className="num text-right font-semibold">{money(o.totalCost, lang)}</dd>
        <dt className="text-ink-3">{t.incident.risk}</dt>
        <dd className={cx('text-right font-semibold', o.risk === 'высокий' ? 'text-st-fault-ink' : o.risk === 'средний' ? 'text-st-attention-ink' : 'text-ink')}>{translateRiskLevel(o.risk, lang)}</dd>
        {monthForecast !== null && (
          <>
            <dt className="text-ink-3">{t.incident.monthForecast}</dt>
            <dd className="num text-right font-semibold">{t.incident.forecastValue(monthForecast)}</dd>
          </>
        )}
      </dl>
      <p className="text-sm text-ink-3">{translateDynamicText(o.riskText, lang)}</p>
      {toMaster && confirm ? (
        <div className="mt-1 flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
          <div className="text-base">
            <span className="text-ink-3">{t.crew.recipientLabel}:</span> <span className="font-semibold">{recipient}</span>
          </div>
          <label className="flex items-center justify-between gap-2 text-base">
            <span className="text-ink-3">{t.crew.dueLabel}</span>
            <input type="time" value={due} step={300} onChange={(e) => setDue(e.target.value)} className="num h-9 rounded-lg bg-surface px-2 font-semibold ring-1 ring-line" />
          </label>
          <Button variant="primary" onClick={busy ? undefined : send}>
            {busy ? t.common.loading : t.crew.send}
          </Button>
        </div>
      ) : (
        <Button variant={o.recommended ? 'primary' : 'secondary'} onClick={toMaster ? () => setConfirm(true) : () => onAccept()} className="mt-1">
          {busy ? t.common.loading : toMaster ? t.crew.sendToMaster : t.incident.acceptButton}
        </Button>
      )}
    </div>
  );
}

function Decided({ inc, result }: { inc: Incident; result: DecisionResponse | null }) {
  const { t, lang } = useTranslation();
  const opt = inc.options.find((o) => o.id === inc.decision?.optionId);
  const title = inc.decision?.title ? translateDynamicText(inc.decision.title, lang) : opt?.title ? translateDynamicText(opt.title, lang) : '';
  return (
    <div className={cx('flex flex-col gap-2 rounded-2xl p-4', TONE_CLASS.neutral.bg)}>
      <div className="flex items-center gap-2 text-lg font-semibold">
        <CircleCheck className="size-6 text-st-neutral" />
        {t.incident.acceptedTitle} {title}
      </div>
      {result?.workOrder && (
        <p className="flex items-center gap-2 text-base text-ink-2">
          <Send className="size-4" /> {t.incident.workOrderSent(translateDynamicText(result.workOrder.title, lang), timeHM(result.workOrder.scheduledAt))}
        </p>
      )}
      {result?.forecastBefore !== undefined && result.forecastAfter !== undefined && (
        <p className="text-lg">
          {t.incident.monthForecast}: <span className="num font-semibold">{num(result.forecastBefore)}</span> →{' '}
          <span className="num font-semibold">{num(result.forecastAfter)}</span>
          {result.forecastAfter > result.forecastBefore && (
            <span className="ml-2 inline-flex items-center gap-1 font-semibold text-ink">
              <Check className="size-5" /> +{num(result.forecastAfter - result.forecastBefore)}
            </span>
          )}
        </p>
      )}
      {!result && opt && <p className="text-base text-ink-2">{t.incident.twinTakesForecastDecision(opt.carsLost, plural(opt.carsLost, CARS, lang))}</p>}
    </div>
  );
}

function FilterChart({ chart }: { chart: NonNullable<Incident['why']['chart']> }) {
  const { t } = useTranslation();
  const data = chart.dp.map((p) => ({ t: p.t, v: Math.round(p.v) }));
  const defects = chart.defects.map((d) => ({ t: d.t, v: Math.round(d.dp) }));
  const min = data[0]?.t ?? 0;
  const max = data[data.length - 1]?.t ?? 1;
  return (
    <div className="mt-3 rounded-xl bg-surface p-3 shadow-card">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span className="font-semibold text-ink">{t.incident.dpFilterChartTitle}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-ink-2" /> {t.incident.dpFilterLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-st-attention ring-2 ring-surface" /> {t.incident.defectsBodyLabel}
        </span>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[min, max]} tickFormatter={(t) => timeHM(t)} tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} />
            <YAxis dataKey="v" domain={[100, 500]} ticks={[150, 250, 350, 450]} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} width={48} />
            <Tooltip labelFormatter={(t) => timeHM(Number(t))} formatter={(v) => [`${v} Pa`, t.incident.dpFilterLabel]} />
            <ReferenceLine y={chart.norm} stroke="var(--ink-2)" strokeDasharray="5 4" label={{ value: `${t.incident.filterNormLabel} ${chart.norm} Pa`, position: 'insideBottomLeft', fill: 'var(--ink-2)', fontSize: 13 }} />
            <ReferenceLine y={chart.limit} stroke="var(--st-fault)" strokeDasharray="5 4" label={{ value: `${t.incident.filterLimitLabel} ${chart.limit} Pa`, position: 'insideTopLeft', fill: 'var(--st-fault-ink)', fontSize: 13 }} />
            <Line data={data} dataKey="v" type="monotone" stroke="var(--ink-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Scatter data={defects} dataKey="v" fill="var(--st-attention)" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
