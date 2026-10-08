import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Search } from 'lucide-react';
import { VIN_RE } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { QualityOverview } from '../../api/types';
import { Card, WhyButton } from '../../components/ui';
import { DownloadButton } from '../../components/DownloadButton';
import { Modal } from '../../components/overlay';
import { ExplainView } from '../../components/ExplainView';
import { Booting } from '../../components/Booting';
import { PassportModal } from './PassportModal';
import { num1, pct1, timeHM } from '../../lib/format';
import { useTranslation } from '../../i18n/store';
import { translateArea, translateDynamicText } from '../../i18n/translator';

export function QualityScreen() {
  const { t, lang } = useTranslation();
  const q = useQuery({ queryKey: ['quality'], queryFn: () => api<QualityOverview>('/api/v1/quality'), refetchInterval: 5000 });
  const [why, setWhy] = useState(false);
  const [vin, setVin] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <Booting />;
  const data = d.areas.map((a) => ({
    name: translateArea(a.area, lang, 'name') || a.name,
    shift: Math.round(a.shiftPct * 1000) / 10,
    week: Math.round(a.weekPct * 1000) / 10,
  }));
  const clean = vin.trim().toUpperCase();
  const valid = VIN_RE.test(clean);

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3 xl:gap-4 xl:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight max-sm:text-[1.375rem]">{t.quality.title}</h1>
        <DownloadButton type="quality" formats={['xlsx', 'pdf']} params={{ by: t.reports.managerRole }} label={t.reports.quality} />
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start gap-3 max-lg:grid-cols-1 xl:gap-4">
        <Card className="p-4">
          <h2 className="mb-1 text-[1.125rem] font-semibold">{t.quality.chartTitle}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 16, right: 16, left: -12, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--ink-2)', fontSize: 15 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} unit="%" />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v, n) => [`${num1(Number(v))}%`, n === 'shift' ? t.quality.shiftLegend : t.quality.weekLegend]} />
                <Legend formatter={(v) => (v === 'shift' ? t.quality.shiftLegend : t.quality.weekLegend)} iconType="square" wrapperStyle={{ fontSize: 14, color: 'var(--ink-2)' }} />
                <Bar dataKey="shift" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                <Bar dataKey="week" fill="var(--st-neutral)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                <ReferenceLine
                  y={d.norm * 100}
                  stroke="var(--ink-2)"
                  strokeDasharray="5 4"
                  label={{ value: `${t.quality.normLabel} ${Math.round(d.norm * 100)}%`, position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 13 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="flex flex-col gap-3 xl:gap-4">
          <Card className="p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-[1.125rem] font-semibold">{t.quality.equipmentLinkTitle}</h2>
              {d.pattern && <WhyButton onClick={() => setWhy(true)} />}
            </div>
            {d.pattern ? (
              <>
                <p className="text-lg font-semibold leading-snug text-st-attention-ink">{translateDynamicText(d.pattern.text, lang)}</p>
                <p className="mt-1 text-base leading-snug text-ink-2">{translateDynamicText(d.pattern.sentence, lang)}.</p>
              </>
            ) : (
              <p className="text-base text-ink-2">
                {d.plcConnected
                  ? t.quality.equipmentLinkNone
                  : t.quality.equipmentLinkPlcReq}
              </p>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 text-[1.125rem] font-semibold">{t.quality.topDefectsTitle}</h2>
            {d.top.length === 0 ? (
              <p className="text-ink-2">{t.quality.topDefectsNone}</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {d.top.map((topItem, i) => {
                  const areaObj = d.areas.find((a) => a.area === topItem.area);
                  const areaName = areaObj ? (translateArea(areaObj.area, lang, 'name') || areaObj.name) : '';
                  return (
                    <li key={topItem.defect} className="flex items-center gap-3 text-base">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 font-semibold text-ink-2">{i + 1}</span>
                      <span className="flex-1">
                        <span className="font-semibold">{translateDynamicText(topItem.name, lang)}</span> <span className="text-ink-3">· {areaName}</span>
                      </span>
                      <span className="num font-semibold">{topItem.count}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="text-[1.125rem] font-semibold">{t.quality.passportSearchTitle}</h2>
        <p className="mb-3 text-base text-ink-2">{t.quality.passportSearchDesc}</p>
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
              placeholder={t.quality.passportInputPlaceholder}
              maxLength={17}
              className="h-11 w-[20rem] max-w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 font-mono text-base uppercase tracking-wide focus-visible:outline-2 focus-visible:outline-accent"
            />
          </label>
          <button type="submit" disabled={!valid} className="h-11 rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-40">
            {t.quality.findButton}
          </button>
          {vin && !valid && (
            <span className="text-base text-ink-3">
              {lang === 'kk' ? 'VIN — 17 таңба: I, O, Q әріптерінсіз латын және сандар' : lang === 'en' ? 'VIN — 17 characters: latin without I, O, Q, and digits' : 'VIN — 17 символов: латиница без I, O, Q и цифры'}
            </span>
          )}
        </form>
        {(d.recent.length > 0 || d.lastVins.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-base">
            <span className="text-ink-3">{t.quality.exampleVins}</span>
            {d.recent.slice(0, 3).map((r) => (
              <button
                key={r.vin + r.at}
                type="button"
                onClick={() => setOpen(r.vin)}
                className="rounded-lg bg-st-attention-bg px-2.5 py-1 font-mono text-sm text-st-attention-ink hover:underline"
              >
                {r.vin} · {translateDynamicText(r.defect.split(' (')[0]!, lang).toLowerCase()} · {timeHM(r.at, lang)}
              </button>
            ))}
            {d.lastVins.slice(0, 2).map((v) => (
              <button key={v} type="button" onClick={() => setOpen(v)} className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-sm text-ink-2 hover:underline">
                {v} · {lang === 'kk' ? 'шығарылған' : lang === 'en' ? 'produced' : 'выпущен'}
              </button>
            ))}
          </div>
        )}
      </Card>

      <PassportModal vin={open} onClose={() => setOpen(null)} />
      <Modal
        open={why}
        onClose={() => setWhy(false)}
        title={<h2 className="text-[1.375rem] font-semibold">{lang === 'kk' ? 'Ақау мен жабдық байланысы қалай табылды' : lang === 'en' ? 'How defect-equipment correlation was identified' : 'Как найдена связь брака с оборудованием'}</h2>}
      >
        {d.pattern && <ExplainView explain={d.pattern.explain} />}
        {d.pattern && (
          <p className="mt-3 text-base text-ink-2">
            {lang === 'kk'
              ? `Шектен жоғары ақау — ${pct1(d.pattern.rateAbove)}, төмен — ${pct1(d.pattern.rateBelow)}.`
              : lang === 'en'
              ? `Above threshold defect rate is ${pct1(d.pattern.rateAbove)}, below — ${pct1(d.pattern.rateBelow)}.`
              : `Выше порога брак — ${pct1(d.pattern.rateAbove)}, ниже — ${pct1(d.pattern.rateBelow)}.`}
          </p>
        )}
      </Modal>
    </main>
  );
}
