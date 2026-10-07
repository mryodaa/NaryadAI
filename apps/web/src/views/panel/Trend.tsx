import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AreaDetail } from '../../api/types';
import { useTranslation } from '../../i18n/store';

type Point = AreaDetail['chart'][number];

export function Trend({ kind, points, shiftRunning }: { kind: AreaDetail['chartKind']; points: Point[]; shiftRunning: boolean }) {
  const { t, lang } = useTranslation();
  const pctFmt = new Intl.NumberFormat(lang === 'en' ? 'en-US' : lang === 'kk' ? 'kk-KZ' : 'ru-RU', { maximumFractionDigits: 1 });
  const data = shiftRunning ? points.slice(0, -1) : points;
  const defects = kind === 'defects';
  const title = defects ? t.panel.trendTitleDefects : t.panel.trendTitleOutput;
  const fmt = (v: number) => (defects ? `${pctFmt.format(v)}%` : `${v}`);
  const norm = data[0]?.norm ?? points[0]?.norm ?? 0;
  const perHourSuffix = lang === 'kk' ? 'сағатына' : lang === 'en' ? 'per hour' : 'в час';
  const normDisplay = defects ? fmt(norm) : `${norm} ${perHourSuffix}`;
  const head = (
    <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-sm leading-tight">
      <span className="font-semibold text-ink">{title}</span>
      <span className="text-ink-3">{t.panel.trendNorm(normDisplay)}</span>
    </div>
  );
  if (data.length < 2) {
    return (
      <figure className="flex flex-col gap-1">
        {head}
        <p className="text-sm text-ink-3">{t.panel.trendWaitTwoHours}</p>
      </figure>
    );
  }
  const lastIdx = data.length - 1;
  const last = data[lastIdx]!;
  // цвет статуса — только когда брак выше нормы; выпуск чуть ниже 15 в час — обычный разброс, не тревога
  const over = defects && last.value > norm;
  const max = Math.max(norm, ...data.map((d) => d.value)) * 1.25 || 1;
  const lastHourLabel = lang === 'kk' ? 'соңғы толық сағат' : lang === 'en' ? 'last full hour' : 'последний полный час';
  const tooltipSeriesName = defects ? (lang === 'kk' ? 'Ақау' : lang === 'en' ? 'Defects' : 'Брак') : (lang === 'kk' ? 'Өнім' : lang === 'en' ? 'Output' : 'Выпуск');
  return (
    <figure className="flex flex-col gap-1">
      {head}
      <div className="h-[72px]" aria-label={`${title}: ${lastHourLabel} ${fmt(last.value)}, ${t.panel.trendNorm(fmt(norm))}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 44, bottom: 4, left: 4 }}>
            <XAxis dataKey="hour" hide />
            <YAxis hide domain={[0, max]} />
            <ReferenceLine y={norm} stroke="var(--ink-3)" strokeDasharray="4 4" ifOverflow="extendDomain" />
            <Tooltip
              cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
              isAnimationActive={false}
              formatter={(v) => [fmt(Number(v)), tooltipSeriesName]}
              labelFormatter={(l) => t.panel.trendHourFrom(String(l))}
            />
            <Line
              dataKey="value"
              type="linear"
              stroke="var(--ink-2)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              isAnimationActive={false}
              activeDot={{ r: 4, fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 2 }}
              dot={(p: { cx?: number; cy?: number; index?: number }) =>
                p.index === lastIdx && p.cx !== undefined && p.cy !== undefined ? (
                  <circle key="end" cx={p.cx} cy={p.cy} r={4} fill={over ? 'var(--st-attention)' : 'var(--ink-2)'} stroke="var(--surface)" strokeWidth={2} />
                ) : (
                  <g key={p.index} />
                )
              }
              label={(p: { x?: number | string; y?: number | string; index?: number }) =>
                p.index === lastIdx ? (
                  <text key="end-label" x={Number(p.x) + 9} y={Number(p.y) + 4} fontSize={13} fontWeight={600} fill={over ? 'var(--st-attention-ink)' : 'var(--ink)'}>
                    {fmt(last.value)}
                  </text>
                ) : (
                  <g key={p.index} />
                )
              }
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="num flex justify-between pr-11 text-xs text-ink-3" aria-hidden>
        <span>{data[0]!.hour}</span>
        <span>{last.hour}</span>
      </div>
    </figure>
  );
}
