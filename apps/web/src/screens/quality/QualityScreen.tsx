// «Качество»: где появляется брак и почему? Плюс паспорт автомобиля по VIN.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Search } from 'lucide-react';
import { VIN_RE } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { QualityOverview } from '../../api/types';
import { Card, WhyButton } from '../../components/ui';
import { Modal } from '../../components/overlay';
import { ExplainView } from '../../components/ExplainView';
import { Booting } from '../../components/Booting';
import { PassportModal } from './PassportModal';
import { num1, pct1, timeHM } from '../../lib/format';

export function QualityScreen() {
  const q = useQuery({ queryKey: ['quality'], queryFn: () => api<QualityOverview>('/api/v1/quality'), refetchInterval: 5000 });
  const [why, setWhy] = useState(false);
  const [vin, setVin] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <Booting />;
  const data = d.areas.map((a) => ({ name: a.name, shift: Math.round(a.shiftPct * 1000) / 10, week: Math.round(a.weekPct * 1000) / 10 }));
  const clean = vin.trim().toUpperCase();
  const valid = VIN_RE.test(clean);

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3 xl:gap-4 xl:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Где появляется брак и почему</h1>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start gap-3 xl:gap-4">
        <Card className="p-4">
          <h2 className="mb-1 text-[1.125rem] font-semibold">Брак по участкам: эта смена и последние 7 дней, %</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 16, right: 16, left: -12, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--ink-2)', fontSize: 15 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} unit="%" />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v, n) => [`${num1(Number(v))}%`, n === 'shift' ? 'Эта смена' : '7 дней']} />
                <Legend formatter={(v) => (v === 'shift' ? 'эта смена' : '7 дней')} iconType="square" wrapperStyle={{ fontSize: 14, color: 'var(--ink-2)' }} />
                <Bar dataKey="shift" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                <Bar dataKey="week" fill="var(--st-neutral)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                <ReferenceLine
                  y={d.norm * 100}
                  stroke="var(--ink-2)"
                  strokeDasharray="5 4"
                  label={{ value: `норма ${Math.round(d.norm * 100)}%`, position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 13 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="flex flex-col gap-3 xl:gap-4">
          <Card className="p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-[1.125rem] font-semibold">Связь с оборудованием</h2>
              {d.pattern && <WhyButton onClick={() => setWhy(true)} />}
            </div>
            {d.pattern ? (
              <>
                <p className="text-lg font-semibold leading-snug text-st-attention-ink">{d.pattern.text}</p>
                <p className="mt-1 text-base leading-snug text-ink-2">{d.pattern.sentence}.</p>
              </>
            ) : (
              <p className="text-base text-ink-2">
                {d.plcConnected
                  ? 'Устойчивых связей брака с состоянием оборудования сейчас не найдено.'
                  : 'Чтобы искать связь брака с оборудованием, нужны данные контроллеров (ступень 1): сейчас видны только несоответствия из 1С:QLS.'}
              </p>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-[1.125rem] font-semibold">Главные дефекты за сутки</h2>
            {d.top.length === 0 ? (
              <p className="text-ink-2">Дефектов за сутки нет.</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {d.top.map((t, i) => (
                  <li key={t.defect} className="flex items-center gap-3 text-base">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 font-semibold text-ink-2">{i + 1}</span>
                    <span className="flex-1">
                      <span className="font-semibold">{t.name}</span> <span className="text-ink-3">· {d.areas.find((a) => a.area === t.area)?.name ?? ''}</span>
                    </span>
                    <span className="num font-semibold">{t.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="text-[1.125rem] font-semibold">Паспорт автомобиля</h2>
        <p className="mb-3 text-base text-ink-2">Маршрут кузова по постам, условия на оборудовании в момент прохода и отметки контроля качества.</p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) setOpen(clean);
          }}
        >
          <label className="relative">
            <span className="sr-only">VIN</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-3" />
            <input
              value={vin}
              onChange={(e) => setVin(e.target.value)}
              placeholder="VIN, 17 символов"
              maxLength={17}
              className="h-11 w-[20rem] rounded-xl border border-line-strong bg-surface pl-10 pr-3 font-mono text-base uppercase tracking-wide focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
          <button type="submit" disabled={!valid} className="h-11 rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-40">
            Открыть паспорт
          </button>
          {vin && !valid && <span className="text-base text-ink-3">VIN — 17 символов: латиница без I, O, Q и цифры</span>}
        </form>
        {(d.recent.length > 0 || d.lastVins.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-base">
            <span className="text-ink-3">Например:</span>
            {d.recent.slice(0, 3).map((r) => (
              <button
                key={r.vin + r.at}
                type="button"
                onClick={() => setOpen(r.vin)}
                className="rounded-lg bg-st-attention-bg px-2.5 py-1 font-mono text-sm text-st-attention-ink hover:underline"
              >
                {r.vin} · {r.defect.split(' (')[0]!.toLowerCase()} · {timeHM(r.at)}
              </button>
            ))}
            {d.lastVins.slice(0, 2).map((v) => (
              <button key={v} type="button" onClick={() => setOpen(v)} className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-sm text-ink-2 hover:underline">
                {v} · выпущен
              </button>
            ))}
          </div>
        )}
      </Card>

      <PassportModal vin={open} onClose={() => setOpen(null)} />
      <Modal open={why} onClose={() => setWhy(false)} title={<h2 className="text-[1.375rem] font-semibold">Как найдена связь брака с оборудованием</h2>}>
        {d.pattern && <ExplainView explain={d.pattern.explain} />}
        {d.pattern && (
          <p className="mt-3 text-base text-ink-2">
            Выше порога брак — {pct1(d.pattern.rateAbove)}, ниже — {pct1(d.pattern.rateBelow)}.
          </p>
        )}
      </Modal>
    </main>
  );
}
