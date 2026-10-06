// «План»: успеваем ли план месяца и что на это влияет?
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CircleCheck, Minus, Plus, TrendingDown } from 'lucide-react';
import { api } from '../../api/client';
import type { Levers, MonthForecast } from '../../api/types';
import { Card, WhyButton } from '../../components/ui';
import { Modal } from '../../components/overlay';
import { ExplainView } from '../../components/ExplainView';
import { Booting } from '../../components/Booting';
import { cx } from '../../lib/tones';
import { CARS, dateShort, num, num1, plural, signed } from '../../lib/format';

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
  const [levers, setLevers] = useState<Levers>(NO_LEVERS);
  const [why, setWhy] = useState(false);
  const base = useForecast(NO_LEVERS);
  const withLevers = useForecast(levers);
  const f = base.data;
  const g = withLevers.data ?? f;
  if (!f || !g) return <Booting message={base.isError ? 'Прогноз появится, когда двойник получит историю' : null} />;
  const anyLever = levers.moveMaintenance || levers.filterBySchedule || levers.saturdayShifts > 0;

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3 xl:gap-4 xl:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Успеваем ли план месяца</h1>

      <Card className="@container flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base text-ink-2">Прогноз на конец октября · двойник пересчитывает по каждой смене</span>
          <WhyButton onClick={() => setWhy(true)} />
        </div>
        <Answer gap={f.gap} />
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-base text-ink-2">
          <span>
            прогноз <b className="num text-ink">{num(f.p50)}</b> из {num(f.target)}
          </span>
          <span>
            коридор <span className="num">{num(f.p10)}–{num(f.p90)}</span>
          </span>
          <span>
            выпущено <span className="num">{num(f.produced)}</span>
          </span>
          {f.mainCause && (
            <span>
              главная причина: <b className="text-ink">{f.mainCause}</b>
            </span>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] items-start gap-3 xl:gap-4">
        <CumulativeChart f={g} hasLevers={anyLever} />
        <WhatIf f={f} g={g} levers={levers} setLevers={setLevers} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 xl:gap-4">
        <Losses f={f} />
        <Models f={g} />
      </div>

      <Modal open={why} onClose={() => setWhy(false)} title={<h2 className="text-[1.375rem] font-semibold">Как считается прогноз плана</h2>}>
        <ExplainView explain={f.explain} />
        <p className="mt-4 text-base text-ink-2">{f.capacityNote}</p>
        <p className="mt-2 text-sm text-ink-3">На старте прогнозы строятся на правилах, статистике и симуляции; модели машинного обучения дообучаются на истории завода в ходе пилота.</p>
      </Modal>
    </main>
  );
}

function Answer({ gap }: { gap: number }) {
  const behind = gap < 0;
  return (
    <div className={cx('flex items-center gap-[0.3em] whitespace-nowrap font-semibold leading-none text-[clamp(1.5rem,4.2cqw,2.5rem)]', behind ? 'text-st-attention-ink' : 'text-ink')}>
      {behind ? <TrendingDown className="size-[1em] shrink-0" strokeWidth={2.5} /> : <CircleCheck className="size-[1em] shrink-0 text-st-neutral" strokeWidth={2.5} />}
      <span className="tracking-tight">{behind ? 'Не успеваем:' : 'Успеваем с запасом'}</span>
      <span className="num text-[1.5em] tracking-tight">{signed(gap)}</span>
      <span className="self-end pb-[0.2em] text-[0.7em]">{plural(gap, CARS)}</span>
    </div>
  );
}

function CumulativeChart({ f, hasLevers }: { f: MonthForecast; hasLevers: boolean }) {
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
  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-[1.125rem] font-semibold">Накопленный выпуск за октябрь{hasLevers ? ' — с выбранными мерами' : ''}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-5 rounded bg-accent" /> факт
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm bg-accent/20" /> прогноз: коридор и середина
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-5 border-t-2 border-dashed border-ink-3" /> план
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
              labelFormatter={(_, p) => (p[0] ? dateShort(`${(p[0].payload as { date: string }).date}T12:00:00+05:00`) : '')}
              formatter={(v, name, item) => {
                if (name === 'lo') return [null, null];
                if (name === 'spread') {
                  const pl = item.payload as { p10: number; p90: number };
                  return [`${num(pl.p10)}–${num(pl.p90)}`, 'Коридор прогноза'];
                }
                const label = name === 'fact' ? 'Факт' : name === 'plan' ? 'План' : 'Прогноз';
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
        Темп последних {f.paceShifts} смен — {num1(f.pace)} машины за смену, осталось {f.remainingShifts} {plural(f.remainingShifts, ['смена', 'смены', 'смен'])}.
      </p>
    </Card>
  );
}

function WhatIf({ f, g, levers, setLevers }: { f: MonthForecast; g: MonthForecast; levers: Levers; setLevers: (l: Levers) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const info = (id: keyof Levers) => f.levers.find((l) => l.id === id)!;
  const sat = info('saturdayShifts');
  const delta = g.p50 - f.p50;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-[1.125rem] font-semibold">Что если</h2>
      {(['moveMaintenance', 'filterBySchedule'] as const).map((id) => {
        const l = info(id);
        const on = levers[id];
        return (
          <div key={id} className={cx('rounded-xl border-2 p-3', on ? 'border-accent bg-accent-bg' : 'border-line bg-surface')}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={on} onChange={(e) => setLevers({ ...levers, [id]: e.target.checked })} className="mt-1 size-5 accent-[var(--accent)]" />
              <span className="flex-1">
                <span className="block font-semibold leading-snug">{l.label}</span>
                <span className="num block text-ink-2">+{num(l.gain)} {plural(l.gain, CARS)} к концу месяца</span>
              </span>
            </label>
            <button type="button" onClick={() => setOpen(open === id ? null : id)} className="mt-1 pl-8 text-sm font-medium text-accent-ink hover:underline">
              {open === id ? 'Скрыть' : 'Почему?'}
            </button>
            {open === id && <p className="mt-1 pl-8 text-sm leading-snug text-ink-2">{l.explain}</p>}
          </div>
        );
      })}
      <div className={cx('rounded-xl border-2 p-3', levers.saturdayShifts > 0 ? 'border-accent bg-accent-bg' : 'border-line bg-surface')}>
        <div className="flex items-center gap-3">
          <span className="flex-1">
            <span className="block font-semibold leading-snug">{sat.label}</span>
            <span className="num block text-ink-2">+{num(sat.perShift)} машин за каждую смену</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Меньше смен"
              disabled={levers.saturdayShifts <= 0}
              onClick={() => setLevers({ ...levers, saturdayShifts: Math.max(0, levers.saturdayShifts - 1) })}
              className="grid size-9 place-items-center rounded-lg bg-surface-2 text-ink disabled:opacity-40"
            >
              <Minus className="size-4" />
            </button>
            <span className="num w-6 text-center text-lg font-semibold">{levers.saturdayShifts}</span>
            <button
              type="button"
              aria-label="Больше смен"
              disabled={levers.saturdayShifts >= (sat.max ?? 0)}
              onClick={() => setLevers({ ...levers, saturdayShifts: Math.min(sat.max ?? 0, levers.saturdayShifts + 1) })}
              className="grid size-9 place-items-center rounded-lg bg-surface-2 text-ink disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(open === 'sat' ? null : 'sat')} className="mt-1 text-sm font-medium text-accent-ink hover:underline">
          {open === 'sat' ? 'Скрыть' : 'Почему?'}
        </button>
        {open === 'sat' && <p className="mt-1 text-sm leading-snug text-ink-2">{sat.explain}</p>}
      </div>
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="text-sm text-ink-3">Прогноз с выбранными мерами</div>
        <div className={cx('text-[1.375rem] font-semibold leading-tight', g.gap < 0 ? 'text-st-attention-ink' : 'text-ink')}>
          <span className="num">{num(g.p50)}</span> · {g.gap < 0 ? `не успеваем ${signed(g.gap)}` : `успеваем, запас ${signed(g.gap)}`}
        </div>
        {delta !== 0 && <div className="num text-base text-ink-2">{signed(delta)} к прогнозу без мер</div>}
      </div>
    </Card>
  );
}

function Losses({ f }: { f: MonthForecast }) {
  const data = f.losses.map((l) => ({ ...l, short: l.label }));
  const top = f.bottleneck?.area;
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-[1.125rem] font-semibold">Где теряем машины с начала месяца</h2>
        {f.bottleneck && (
          <span className="text-base">
            Узкое место сейчас: <b className="text-st-attention-ink">{f.bottleneck.label}</b>
          </span>
        )}
      </div>
      {data.length === 0 ? (
        <p className="text-ink-2">Потерь нет</p>
      ) : (
        <div style={{ height: Math.max(120, data.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }} barCategoryGap={8}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="short" width={230} tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-2)', fontSize: 14 }} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => [`${num(Number(v))} машин`, 'Потеряно']} />
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
      <p className="mt-1 text-sm text-ink-3">Простои — по журналу 1С:MES, перекраска — по 1С:QLS; буферы гасят часть остановок, поэтому сумма приведена к фактической недостаче.</p>
    </Card>
  );
}

function Models({ f }: { f: MonthForecast }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {f.models.map((m) => {
        const risky = m.stockRisk !== 'низкий';
        return (
          <Card key={m.model} className="flex flex-col gap-1.5 p-4">
            <h3 className="font-semibold leading-tight">{m.name}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base">
              <dt className="text-ink-3">план</dt>
              <dd className="num text-right font-semibold">{num(m.plan)}</dd>
              <dt className="text-ink-3">выпущено</dt>
              <dd className="num text-right">{num(m.produced)}</dd>
              <dt className="text-ink-3">прогноз</dt>
              <dd className={cx('num text-right font-semibold', m.forecast < m.plan && 'text-st-attention-ink')}>{num(m.forecast)}</dd>
            </dl>
            {m.stockText && (
              <p className={cx('mt-auto text-sm leading-snug', risky ? 'font-medium text-st-attention-ink' : 'text-ink-3')}>
                комплекты: {m.stockText}
                {risky ? ` — риск ${m.stockRisk}` : ''}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
