import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CircleCheck, Minus, Plus, TrendingDown } from 'lucide-react';
import { api } from '../../api/client';
import type { Levers, MonthForecast } from '../../api/types';
import { Card, WhyButton } from '../../components/ui';
import { DownloadButton } from '../../components/DownloadButton';
import { Modal } from '../../components/overlay';
import { ExplainView } from '../../components/ExplainView';
import { Booting } from '../../components/Booting';
import { cx } from '../../lib/tones';
import { CARS, dateShort, num, num1, plural, signed } from '../../lib/format';
import { useTranslation } from '../../i18n/store';
import { translateDynamicText, translateRisk } from '../../i18n/translator';

const NO_LEVERS: Levers = { moveMaintenance: false, filterBySchedule: false, saturdayShifts: 0 };

function useForecast(levers: Levers) {
  const qs = `moveMaintenance=${levers.moveMaintenance ? 1 : 0}&filterBySchedule=${levers.filterBySchedule ? 1 : 0}&saturdayShifts=${levers.saturdayShifts}`;
  return useQuery({
    queryKey: ['forecast', qs],
    queryFn: () => api<MonthForecast>(`/api/v1/forecast?${qs}`),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
}

export function PlanScreen() {
  const { t, lang } = useTranslation();
  const [levers, setLevers] = useState<Levers>(NO_LEVERS);
  const [why, setWhy] = useState(false);
  const base = useForecast(NO_LEVERS);
  const withLevers = useForecast(levers);
  const f = base.data;
  const g = withLevers.data ?? f;
  if (!f || !g) {
    const errorMsg = lang === 'kk' ? 'Двойник тарихты алғанда болжам пайда болады' : lang === 'en' ? 'Forecast will appear when twin receives history' : 'Прогноз появится, когда двойник получит историю';
    return <Booting message={base.isError ? errorMsg : null} />;
  }
  const anyLever = levers.moveMaintenance || levers.filterBySchedule || levers.saturdayShifts > 0;

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3 xl:gap-4 xl:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight max-sm:text-[1.375rem]">{t.plan.title}</h1>
        <DownloadButton type="plan" formats={['xlsx']} params={{ by: t.reports.managerRole }} label={t.reports.plan} />
      </div>

      <Card className="@container flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base text-ink-2">{t.plan.forecastCardSubtitle}</span>
          <WhyButton onClick={() => setWhy(true)} />
        </div>
        <Answer gap={f.gap} />
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-base text-ink-2">
          <span>
            {t.plan.forecastLabel} <b className="num text-ink">{num(f.p50)}</b> {lang === 'kk' ? '/' : lang === 'en' ? 'of' : 'из'} {num(f.target)}
          </span>
          <span>
            {t.plan.corridorLabel} <span className="num">{num(f.p10)}–{num(f.p90)}</span>
          </span>
          <span>
            {t.plan.producedLabel} <span className="num">{num(f.produced)}</span>
          </span>
          {f.mainCause && (
            <span>
              {t.plan.mainCauseLabel} <b className="text-ink">{translateDynamicText(f.mainCause, lang)}</b>
            </span>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-start gap-3 max-lg:grid-cols-1 xl:gap-4">
        <CumulativeChart f={g} hasLevers={anyLever} />
        <WhatIf f={f} g={g} levers={levers} setLevers={setLevers} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 max-lg:grid-cols-1 xl:gap-4">
        <Losses f={f} />
        <Models f={g} />
      </div>

      <Modal open={why} onClose={() => setWhy(false)} title={<h2 className="text-[1.375rem] font-semibold">{t.plan.howPlanCalculated}</h2>}>
        <ExplainView explain={f.explain} />
        <p className="mt-4 text-base text-ink-2">{translateDynamicText(f.capacityNote, lang)}</p>
        <p className="mt-2 text-sm text-ink-3">{t.plan.machineLearningNote}</p>
      </Modal>
    </main>
  );
}

function Answer({ gap }: { gap: number }) {
  const { t, lang } = useTranslation();
  const behind = gap < 0;
  return (
    <div className={cx('flex items-center gap-[0.3em] whitespace-nowrap font-semibold leading-none text-[clamp(1.5rem,4.2cqw,2.5rem)]', behind ? 'text-st-attention-ink' : 'text-ink')}>
      {behind ? <TrendingDown className="size-[1em] shrink-0" strokeWidth={2.5} /> : <CircleCheck className="size-[1em] shrink-0 text-st-neutral" strokeWidth={2.5} />}
      <span className="tracking-tight">{behind ? t.plan.behindText : t.plan.onTrackText}</span>
      <span className="num text-[1.5em] tracking-tight">{signed(gap)}</span>
      <span className="self-end pb-[0.2em] text-[0.7em]">{plural(gap, CARS, lang)}</span>
    </div>
  );
}

function CumulativeChart({ f, hasLevers }: { f: MonthForecast; hasLevers: boolean }) {
  const { t, lang } = useTranslation();
  const data = f.days.map((d) => ({
    day: Number(d.date.slice(8)),
    date: d.date,
    fact: d.fact,
    plan: d.plan,
    p50: d.p50,
    // коридор — стопкой: прозрачное основание до P10 и залитая полоса до P90
    lo: d.p10,
    spread: d.p10 !== null && d.p90 !== null ? Math.max(1, d.p90 - d.p10) : null,
    p10: d.p10,
    p90: d.p90,
  }));
  const chartTitle = `${lang === 'kk' ? 'Ай бойы жинақталған өнім' : lang === 'en' ? 'Cumulative output for month' : 'Накопленный выпуск за месяц'}${hasLevers ? (lang === 'kk' ? ' — таңдалған шаралармен' : lang === 'en' ? ' — with selected levers' : ' — с выбранными мерами') : ''}`;

  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-[1.125rem] font-semibold">{chartTitle}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-5 rounded bg-accent" /> {t.plan.chartFact}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm bg-accent/20" /> {t.plan.chartForecast}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dashed border-ink-3" /> {t.plan.chartTarget}
          </span>
        </div>
      </div>
      <div className="h-64 2xl:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} ticks={[1, 5, 10, 15, 20, 25, 31]} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} tickFormatter={(v) => num(Number(v))} width={52} domain={[0, 'auto']} />
            <Tooltip
              labelFormatter={(_, p) => (p[0] ? dateShort(`${(p[0].payload as { date: string }).date}T12:00:00+05:00`, lang) : '')}
              formatter={(v, name, item) => {
                if (name === 'lo') return [null, null];
                if (name === 'spread') {
                  const pl = item.payload as { p10: number; p90: number };
                  return [`${num(pl.p10)}–${num(pl.p90)}`, t.plan.chartCorridor];
                }
                const label = name === 'fact' ? t.plan.chartFact : name === 'plan' ? t.plan.chartTarget : t.plan.chartForecast;
                return [num(Number(v)), label];
              }}
            />
            <Area dataKey="lo" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} connectNulls activeDot={false} />
            <Area dataKey="spread" stackId="band" stroke="none" fill="var(--accent)" fillOpacity={0.18} isAnimationActive={false} connectNulls activeDot={false} />
            <Line dataKey="plan" stroke="var(--ink-3)" strokeDasharray="6 5" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="p50" stroke="var(--accent)" strokeDasharray="6 4" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="fact" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-sm text-ink-3">
        {lang === 'kk'
          ? `Соңғы ${f.paceShifts} ауысым қарқыны — ауысымына ${num1(f.pace)} шанақ, қалғаны ${f.remainingShifts} ауысым.`
          : lang === 'en'
          ? `Pace of last ${f.paceShifts} shifts is ${num1(f.pace)} cars/shift, ${f.remainingShifts} shifts remaining.`
          : `Темп последних ${f.paceShifts} смен — ${num1(f.pace)} машины за смену, осталось ${f.remainingShifts} ${plural(f.remainingShifts, ['смена', 'смены', 'смен'])}.`}
      </p>
    </Card>
  );
}

function WhatIf({ f, g, levers, setLevers }: { f: MonthForecast; g: MonthForecast; levers: Levers; setLevers: (l: Levers) => void }) {
  const { t, lang } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const info = (id: keyof Levers) => f.levers.find((l) => l.id === id)!;
  const sat = info('saturdayShifts');
  const delta = g.p50 - f.p50;
  const endMonthSuffix = lang === 'kk' ? 'ай соңына қарай' : lang === 'en' ? 'to month end' : 'к концу месяца';
  const perShiftSuffix = lang === 'kk' ? 'әр ауысым үшін' : lang === 'en' ? 'cars per shift' : 'машин за каждую смену';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-[1.125rem] font-semibold">{t.plan.whatIfTitle}</h2>
      {(['moveMaintenance', 'filterBySchedule'] as const).map((id) => {
        const l = info(id);
        const on = levers[id];
        return (
          <div key={id} className={cx('rounded-xl border-2 p-3', on ? 'border-accent bg-accent-bg' : 'border-line bg-surface')}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={on} onChange={(e) => setLevers({ ...levers, [id]: e.target.checked })} className="mt-1 size-5 accent-[var(--accent)]" />
              <span className="flex-1">
                <span className="block font-semibold leading-snug">{translateDynamicText(l.label, lang)}</span>
                <span className="num block text-ink-2">+{num(l.gain)} {plural(l.gain, CARS, lang)} {endMonthSuffix}</span>
              </span>
            </label>
            <button type="button" onClick={() => setOpen(open === id ? null : id)} className="mt-1 pl-8 text-sm font-medium text-accent-ink hover:underline">
              {open === id ? t.common.hide : t.common.why}
            </button>
            {open === id && <p className="mt-1 pl-8 text-sm leading-snug text-ink-2">{translateDynamicText(l.explain, lang)}</p>}
          </div>
        );
      })}
      <div className={cx('rounded-xl border-2 p-3', levers.saturdayShifts > 0 ? 'border-accent bg-accent-bg' : 'border-line bg-surface')}>
        <div className="flex items-center gap-3">
          <span className="flex-1">
            <span className="block font-semibold leading-snug">{translateDynamicText(sat.label, lang)}</span>
            <span className="num block text-ink-2">+{num(sat.perShift)} {perShiftSuffix}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={lang === 'kk' ? 'Ауысымды азайту' : lang === 'en' ? 'Fewer shifts' : 'Меньше смен'}
              disabled={levers.saturdayShifts <= 0}
              onClick={() => setLevers({ ...levers, saturdayShifts: Math.max(0, levers.saturdayShifts - 1) })}
              className="grid size-9 place-items-center rounded-lg bg-surface-2 text-ink disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="num w-6 text-center text-lg font-semibold">{levers.saturdayShifts}</span>
            <button
              type="button"
              aria-label={lang === 'kk' ? 'Ауысымды көбейту' : lang === 'en' ? 'More shifts' : 'Больше смен'}
              disabled={levers.saturdayShifts >= (sat.max ?? 0)}
              onClick={() => setLevers({ ...levers, saturdayShifts: Math.min(sat.max ?? 0, levers.saturdayShifts + 1) })}
              className="grid size-9 place-items-center rounded-lg bg-surface-2 text-ink disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(open === 'sat' ? null : 'sat')} className="mt-1 text-sm font-medium text-accent-ink hover:underline">
          {open === 'sat' ? t.common.hide : t.common.why}
        </button>
        {open === 'sat' && <p className="mt-1 text-sm leading-snug text-ink-2">{translateDynamicText(sat.explain, lang)}</p>}
      </div>
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="text-sm text-ink-3">{t.plan.whatIfSubtitle}</div>
        <div className={cx('text-[1.375rem] font-semibold leading-tight', g.gap < 0 ? 'text-st-attention-ink' : 'text-ink')}>
          <span className="num">{num(g.p50)}</span> · {g.gap < 0 ? (lang === 'kk' ? `үлгермейміз ${signed(g.gap)}` : lang === 'en' ? `behind by ${signed(g.gap)}` : `не успеваем ${signed(g.gap)}`) : (lang === 'kk' ? `үлгереміз, қор ${signed(g.gap)}` : lang === 'en' ? `on track, reserve ${signed(g.gap)}` : `успеваем, запас ${signed(g.gap)}`)}
        </div>
        {delta !== 0 && (
          <div className="num text-base text-ink-2">
            {signed(delta)} {lang === 'kk' ? 'шарасыз болжамға' : lang === 'en' ? 'vs baseline forecast' : 'к прогнозу без мер'}
          </div>
        )}
      </div>
    </Card>
  );
}

function Losses({ f }: { f: MonthForecast }) {
  const { t, lang } = useTranslation();
  const data = f.losses.map((l) => ({ ...l, short: translateDynamicText(l.label, lang) }));
  const top = f.bottleneck?.area;
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[1.125rem] font-semibold">{t.plan.bottleneckTitle}</h2>
        {f.bottleneck && (
          <span className="text-base">
            {lang === 'kk' ? 'Қазіргі тар жер:' : lang === 'en' ? 'Current bottleneck:' : 'Узкое место сейчас:'} <b className="text-st-attention-ink">{translateDynamicText(f.bottleneck.label, lang)}</b>
          </span>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-ink-2">{lang === 'kk' ? 'Шығын жоқ' : lang === 'en' ? 'No losses' : 'Потерь нет'}</p>
      ) : (
        <div style={{ height: Math.max(120, data.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }} barCategoryGap={8}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="short" width={230} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 14 }} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => [`${num(Number(v))} ${t.kpi.carsUnit}`, lang === 'kk' ? 'Жоғалды' : lang === 'en' ? 'Lost' : 'Потеряно']} />
              <Bar dataKey="cars" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.key} fill={d.area && d.area === top ? 'var(--st-attention)' : 'var(--st-neutral)'} />
                ))}
                <LabelList dataKey="cars" position="right" formatter={(v: unknown) => num(Number(v))} style={{ fill: 'var(--ink)', fontSize: 14, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-1 text-sm text-ink-3">{t.plan.bottleneckDesc}</p>
    </Card>
  );
}

function Models({ f }: { f: MonthForecast }) {
  const { t, lang } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
      {f.models.map((m) => {
        const risky = m.stockRisk !== 'низкий';
        return (
          <Card key={m.model} className="flex flex-col gap-1.5 p-4">
            <h3 className="font-semibold leading-tight">{m.name}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base">
              <dt className="text-ink-3">{t.common.plan}</dt>
              <dd className="num text-right font-semibold">{num(m.plan)}</dd>
              <dt className="text-ink-3">{t.plan.producedLabel}</dt>
              <dd className="num text-right">{num(m.produced)}</dd>
              <dt className="text-ink-3">{t.plan.chartForecast}</dt>
              <dd className={cx('num text-right font-semibold', m.forecast < m.plan && 'text-st-attention-ink')}>{num(m.forecast)}</dd>
            </dl>
            {m.stockText && (
              <p className={cx('mt-auto text-sm leading-snug', risky ? 'font-medium text-st-attention-ink' : 'text-ink-3')}>
                {lang === 'kk' ? 'жинақтар:' : lang === 'en' ? 'kits:' : 'комплекты:'} {translateDynamicText(m.stockText, lang)}
                {risky ? ` — ${lang === 'kk' ? 'қауіп' : lang === 'en' ? 'risk' : 'риск'} ${translateRisk(m.stockRisk, lang)}` : ''}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
