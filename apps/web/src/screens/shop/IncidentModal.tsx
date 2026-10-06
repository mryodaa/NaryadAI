// Инцидент в формате истории: что случилось → почему → чем грозит → что делать.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { Check, ChevronDown, CircleCheck, Send } from 'lucide-react';
import { api } from '../../api/client';
import type { DecisionResponse, Incident, IncidentOption } from '../../api/types';
import { Modal } from '../../components/overlay';
import { SourceBadge } from '../../components/SourceBadge';
import { ExplainView } from '../../components/ExplainView';
import { Button, StatusChip } from '../../components/ui';
import { useLive } from '../../state/live';
import { TONE_CLASS, cx } from '../../lib/tones';
import { CARS, money, num, plural, timeHM } from '../../lib/format';

export function IncidentModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['incident', id], queryFn: () => api<Incident>(`/api/v1/incidents/${id}`), enabled: !!id, refetchInterval: 4000 });
  const forecast = useLive((s) => s.snapshot?.kpi.monthPlan.forecast ?? null);
  const [why, setWhy] = useState(false);
  const [result, setResult] = useState<DecisionResponse | null>(null);
  const decide = useMutation({
    mutationFn: (optionId: string) => api<DecisionResponse>('/api/v1/decisions', { method: 'POST', json: { incidentId: id, optionId, decidedBy: 'Начальник производства' } }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['incident', id] });
    },
  });
  const inc = q.data;
  const close = () => {
    setWhy(false);
    setResult(null);
    decide.reset();
    onClose();
  };
  const noAction = inc?.options.find((o) => o.id === 'do_nothing' || o.id === 'postpone');

  return (
    <Modal
      open={!!id}
      onClose={close}
      wide
      title={
        inc ? (
          <div className="flex flex-col gap-1.5">
            <StatusChip tone={inc.decision ? 'neutral' : inc.tone} label={inc.decision ? 'Решение принято' : inc.status === 'resolved' ? 'Закрыт' : toneWord(inc.tone)} className="self-start" />
            <h2 className="text-[1.5rem] font-semibold leading-tight">{inc.title}</h2>
          </div>
        ) : (
          '…'
        )
      }
    >
      {!inc ? (
        <p className="text-ink-2">{q.isError ? 'Инцидент уже закрыт' : 'Загружаю…'}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Block n={1} title="Что случилось">
            <p className="text-lg leading-snug">
              {inc.happened.text} <span className="num whitespace-nowrap text-ink-3">· {timeHM(inc.happened.at)}</span>
            </p>
          </Block>

          <Block n={2} title="Почему">
            <p className="text-lg leading-snug">{inc.why.text}</p>
            {inc.why.chart && <FilterChart chart={inc.why.chart} />}
            {inc.signals.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {inc.signals.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-base text-ink-2">
                    <SourceBadge source={s.source} compact />
                    <span>{s.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block n={3} title="Чем грозит">
            <p className="text-lg leading-snug">{inc.threat.text}</p>
          </Block>

          <Block n={4} title="Что делать">
            {inc.decision || result ? (
              <Decided inc={inc} result={result} />
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(3, inc.options.length)}, minmax(0, 1fr))` }}>
                {inc.options.map((o) => (
                  <OptionCard
                    key={o.id}
                    o={o}
                    monthForecast={forecast !== null && noAction ? forecast + noAction.carsLost - o.carsLost : null}
                    busy={decide.isPending}
                    onAccept={() => decide.mutate(o.id)}
                  />
                ))}
              </div>
            )}
            {decide.isError && <p className="mt-2 font-medium text-st-fault-ink">{(decide.error as Error).message}</p>}
          </Block>

          <div>
            <button type="button" onClick={() => setWhy((v) => !v)} className="inline-flex items-center gap-1.5 font-semibold text-accent-ink hover:underline">
              Почему двойник так считает?
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

function toneWord(tone: Incident['tone']): string {
  return tone === 'fault' ? 'Авария' : tone === 'maintenance' ? 'Обслуживание' : tone === 'waiting' ? 'Ожидание' : 'Требует внимания';
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

function OptionCard({ o, monthForecast, onAccept, busy }: { o: IncidentOption; monthForecast: number | null; onAccept: () => void; busy: boolean }) {
  return (
    <div className={cx('flex flex-col gap-2 rounded-2xl border-2 bg-surface p-4 shadow-card', o.recommended ? 'border-accent' : 'border-transparent')}>
      {o.recommended && <span className="self-start rounded-md bg-accent px-2 py-0.5 text-sm font-semibold text-white">Рекомендуем</span>}
      <h4 className="text-[1.125rem] font-semibold leading-snug">{o.title}</h4>
      <p className="text-base leading-snug text-ink-2">{o.detail}</p>
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 text-base">
        <dt className="text-ink-3">Теряем</dt>
        <dd className={cx('num text-right font-semibold', o.carsLost > 0 && 'text-st-attention-ink')}>
          {o.carsLost > 0 ? `${num(o.carsLost)} ${plural(o.carsLost, CARS)}` : 'без потерь'}
        </dd>
        {o.repaints > 0 && (
          <>
            <dt className="text-ink-3">Перекраска</dt>
            <dd className="num text-right font-semibold">{num(o.repaints)} кузов.</dd>
          </>
        )}
        <dt className="text-ink-3">Обойдётся</dt>
        <dd className="num text-right font-semibold">{money(o.totalCost)}</dd>
        <dt className="text-ink-3">Риск</dt>
        <dd className={cx('text-right font-semibold', o.risk === 'высокий' ? 'text-st-fault-ink' : o.risk === 'средний' ? 'text-st-attention-ink' : 'text-ink')}>{o.risk}</dd>
        {monthForecast !== null && (
          <>
            <dt className="text-ink-3">План месяца</dt>
            <dd className="num text-right font-semibold">прогноз {num(monthForecast)}</dd>
          </>
        )}
      </dl>
      <p className="text-sm text-ink-3">{o.riskText}</p>
      <Button variant={o.recommended ? 'primary' : 'secondary'} onClick={onAccept} className="mt-1">
        {busy ? 'Отправляю…' : 'Принять'}
      </Button>
    </div>
  );
}

function Decided({ inc, result }: { inc: Incident; result: DecisionResponse | null }) {
  const opt = inc.options.find((o) => o.id === inc.decision?.optionId);
  return (
    <div className={cx('flex flex-col gap-2 rounded-2xl p-4', TONE_CLASS.neutral.bg)}>
      <div className="flex items-center gap-2 text-lg font-semibold">
        <CircleCheck className="size-6 text-st-neutral" />
        Принято: {inc.decision?.title ?? opt?.title}
      </div>
      {result?.workOrder && (
        <p className="flex items-center gap-2 text-base text-ink-2">
          <Send className="size-4" /> Наряд «{result.workOrder.title}» отправлен в системы завода · выполнить в {timeHM(result.workOrder.scheduledAt)}
        </p>
      )}
      {result?.forecastBefore !== undefined && result.forecastAfter !== undefined && (
        <p className="text-lg">
          Прогноз плана месяца: <span className="num font-semibold">{num(result.forecastBefore)}</span> →{' '}
          <span className="num font-semibold">{num(result.forecastAfter)}</span>
          {result.forecastAfter > result.forecastBefore && (
            <span className="ml-2 inline-flex items-center gap-1 font-semibold text-ink">
              <Check className="size-5" /> +{num(result.forecastAfter - result.forecastBefore)}
            </span>
          )}
        </p>
      )}
      {!result && opt && <p className="text-base text-ink-2">Двойник учитывает решение в прогнозе: потеряем {num(opt.carsLost)} {plural(opt.carsLost, CARS)}.</p>}
    </div>
  );
}

function FilterChart({ chart }: { chart: NonNullable<Incident['why']['chart']> }) {
  const data = chart.dp.map((p) => ({ t: p.t, v: Math.round(p.v) }));
  const defects = chart.defects.map((d) => ({ t: d.t, v: Math.round(d.dp) }));
  const min = data[0]?.t ?? 0;
  const max = data[data.length - 1]?.t ?? 1;
  return (
    <div className="mt-3 rounded-xl bg-surface p-3 shadow-card">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span className="font-semibold text-ink">Перепад давления на фильтре Камеры-02 и брак</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded bg-ink-2" /> перепад, Па
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-st-attention ring-2 ring-surface" /> кузов с сорностью
        </span>
      </div>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={[min, max]} tickFormatter={(t) => timeHM(t)} tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} />
            <YAxis dataKey="v" domain={[100, 500]} ticks={[150, 250, 350, 450]} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} width={48} />
            <Tooltip labelFormatter={(t) => timeHM(Number(t))} formatter={(v) => [`${v} Па`, 'Перепад']} />
            <ReferenceLine y={chart.norm} stroke="var(--ink-2)" strokeDasharray="5 4" label={{ value: `норма до ${chart.norm} Па`, position: 'insideBottomLeft', fill: 'var(--ink-2)', fontSize: 13 }} />
            <ReferenceLine y={chart.limit} stroke="var(--st-fault)" strokeDasharray="5 4" label={{ value: `предел ${chart.limit} Па`, position: 'insideTopLeft', fill: 'var(--st-fault-ink)', fontSize: 13 }} />
            <Line data={data} dataKey="v" type="monotone" stroke="var(--ink-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Scatter data={defects} dataKey="v" fill="var(--st-attention)" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
