import { CircleCheck, TrendingDown, TriangleAlert } from 'lucide-react';
import type { LiveSnapshot } from '@allur/contracts/ref';
import { stageShort, usePlantModel } from '../../state/plant';
import { Card, WhyButton } from '../../components/ui';
import { num, pct0, pct1, signed, timeHM } from '../../lib/format';
import { cx } from '../../lib/tones';
import { useTranslation } from '../../i18n/store';
import { translateAreaName, translateDynamicText } from '../../i18n/translator';

type Kpi = LiveSnapshot['kpi'];

export function KpiStrip({ kpi, now, onWhyPlan }: { kpi: Kpi; now: string; onWhyPlan?: () => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.75fr)_repeat(3,minmax(0,1fr))] gap-3 xl:gap-4">
      <MonthPlanTile plan={kpi.monthPlan} onWhy={onWhyPlan} />
      <ShiftOutputTile out={kpi.shiftOutput} now={now} />
      <OeeTile oee={kpi.oee} />
      <DefectsTile d={kpi.defects} />
    </div>
  );
}

function TileLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-base leading-tight text-ink-2">{children}</div>;
}

function MonthPlanTile({ plan, onWhy }: { plan: Kpi['monthPlan']; onWhy?: () => void }) {
  const { t, lang } = useTranslation();
  const behind = !plan.onTrack;
  return (
    <Card className="@container flex flex-col gap-2 p-3.5 2xl:p-4">
      <div className="flex items-center justify-between gap-2">
        <TileLabel>{t.kpi.monthPlanTitle}</TileLabel>
        <WhyButton onClick={onWhy} />
      </div>
      <div
        className={cx(
          'flex items-center gap-[0.3em] whitespace-nowrap font-semibold leading-none text-[clamp(1.375rem,6.9cqw,2.125rem)]',
          behind ? 'text-st-attention-ink' : 'text-ink',
        )}
      >
        {behind ? (
          <TrendingDown className="size-[1em] shrink-0" strokeWidth={2.5} aria-hidden />
        ) : (
          <CircleCheck className="size-[1em] shrink-0 text-st-neutral" strokeWidth={2.5} aria-hidden />
        )}
        <span className="tracking-tight">{behind ? t.kpi.monthPlanBehind : t.kpi.monthPlanOnTrack}</span>
        <span className="num text-[1.65em] tracking-tight">{signed(plan.gap)}</span>
        <span className="self-end pb-[0.2em] text-[0.75em]">{behind ? t.kpi.carsUnit : t.kpi.carsReserveUnit}</span>
      </div>
      <div className="text-base text-ink-2">
        {t.kpi.monthPlanForecast} <span className="num font-semibold text-ink">{num(plan.forecast)}</span> {t.kpi.monthPlanTarget} {num(plan.target)}
        {plan.mainCause && (
          <>
            {' · '}{t.kpi.monthPlanMainCause} <span className="font-semibold text-ink">{translateDynamicText(plan.mainCause, lang)}</span>
          </>
        )}
      </div>
    </Card>
  );
}

function ShiftOutputTile({ out, now }: { out: Kpi['shiftOutput']; now: string }) {
  const { t, lang } = useTranslation();
  const lag = out.planToNow - out.done;
  const behind = lag > 2;
  const donePct = Math.min(100, (out.done / out.plan) * 100);
  const markPct = Math.min(100, (out.planToNow / out.plan) * 100);
  return (
    <Card className="flex flex-col gap-1.5 p-3.5 2xl:p-4">
      <TileLabel>{t.kpi.shiftOutputTitle}</TileLabel>
      <div className="flex items-baseline gap-1.5 font-semibold leading-none">
        <span className="num text-[2.75rem] tracking-tight">{out.done}</span>
        <span className="text-xl text-ink-2">{t.kpi.monthPlanTarget} {out.plan}</span>
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-line" aria-hidden>
        <div className={cx('absolute inset-y-0 left-0 rounded-full', behind ? 'bg-st-attention' : 'bg-st-neutral')} style={{ width: `${donePct}%` }} />
        <div className="absolute -top-1 h-4 w-[3px] -translate-x-1/2 rounded bg-ink" style={{ left: `${markPct}%` }} title={t.kpi.whereShouldBeNow} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 text-base leading-tight">
        <span className={cx('inline-flex items-center gap-1', behind ? 'font-semibold text-st-attention-ink' : 'text-ink-2')}>
          {behind && <TriangleAlert className="size-[1.05em] shrink-0" strokeWidth={2.25} aria-hidden />}
          {behind ? t.kpi.shiftOutputBehind(lag) : t.kpi.shiftOutputOnTrack}
        </span>
        <span className="num text-ink-3">{t.kpi.shiftOutputPlanToNow(timeHM(now, lang), out.planToNow)}</span>
      </div>
    </Card>
  );
}

function OeeTile({ oee }: { oee: Kpi['oee'] }) {
  const { t } = useTranslation();
  const low = oee.value < oee.norm;
  return (
    <Card className="flex flex-col gap-1.5 p-3.5 2xl:p-4">
      <TileLabel>
        <span title={t.kpi.oeeTooltip}>{t.kpi.oeeTitle}</span>
      </TileLabel>
      <ValueVsNorm value={pct0(oee.value)} norm={`${t.kpi.oeeNorm} ${pct0(oee.norm)}`} bad={low} badWord={t.kpi.oeeLow} />
      <div className="text-[0.9375rem] leading-snug text-ink-3">
        {t.kpi.oeeMinutesUseful(Math.round(oee.value * 100))}
      </div>
    </Card>
  );
}

function DefectsTile({ d }: { d: Kpi['defects'] }) {
  const { t, lang } = useTranslation();
  const model = usePlantModel();
  const worst = d.worst && d.worst.pct > 0 ? d.worst : null;
  const value = worst ? worst.pct : d.pct;
  const high = value > d.norm;
  const worstAreaName = worst ? translateAreaName(stageShort(model, worst.area), lang).toLowerCase() : '';
  return (
    <Card className="flex flex-col gap-1.5 p-3.5 2xl:p-4">
      <TileLabel>{t.kpi.defectsTitle}</TileLabel>
      <ValueVsNorm
        value={pct1(value)}
        norm={worst ? `${worstAreaName} · ${t.kpi.defectsNorm} ${pct0(d.norm)}` : `${t.kpi.defectsNorm} ${pct0(d.norm)}`}
        bad={high}
        badWord={t.kpi.defectsHigh}
      />
      <div className="text-[0.9375rem] leading-snug text-ink-3">{t.kpi.acrossAllAreas(pct1(d.pct))}</div>
    </Card>
  );
}

function ValueVsNorm({ value, norm, bad, badWord }: { value: string; norm: string; bad: boolean; badWord: string }) {
  const { t } = useTranslation();
  return (
    <>
      <div className={cx('flex items-center gap-2 font-semibold leading-none', bad ? 'text-st-attention-ink' : 'text-ink')}>
        <span className="num text-[2.75rem] tracking-tight">{value}</span>
        {bad ? (
          <TriangleAlert className="size-7 shrink-0" strokeWidth={2.5} aria-hidden />
        ) : (
          <CircleCheck className="size-7 shrink-0 text-st-neutral" strokeWidth={2.5} aria-hidden />
        )}
      </div>
      <div className="text-base leading-tight">
        <span className="text-ink-2">{norm}</span>
        <span className={bad ? 'font-semibold text-st-attention-ink' : 'text-ink-2'}> · {bad ? badWord : t.kpi.inNorm}</span>
      </div>
    </>
  );
}
