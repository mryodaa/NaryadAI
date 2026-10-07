// Плавающие окна 3D-режима: показатели и «Требует внимания» поверх сцены, их можно свернуть.
// Внутри — те же компоненты, что в «Панели»: одинаковые числа и слова в обоих режимах.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, CircleCheck, TrendingDown, TriangleAlert } from 'lucide-react';
import type { AttentionItem, LiveSnapshot } from '@allur/contracts/ref';
import { KpiStrip } from './KpiStrip';
import { AttentionColumn } from './AttentionColumn';
import { TONE_CLASS, TONE_ICON, cx } from '../../lib/tones';
import { pct0, pct1, signed } from '../../lib/format';

function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {
      // без памяти браузера свернутость просто не запомнится
    }
  };
  return [value, set];
}

function ToggleButton({ collapsed, onClick, label, className }: { collapsed: boolean; onClick: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      className={cx('grid size-8 shrink-0 place-items-center rounded-full bg-surface text-ink-2 shadow-card ring-1 ring-line hover:bg-surface-2 hover:text-ink print:hidden', className)}
    >
      {collapsed ? <ChevronDown className="size-4" strokeWidth={2.5} /> : <ChevronUp className="size-4" strokeWidth={2.5} />}
    </button>
  );
}

type Kpi = LiveSnapshot['kpi'];

/** Верхняя полоса показателей; свёрнутая — одна строка с теми же четырьмя числами */
export function FloatingKpi({ kpi, now, onWhyPlan }: { kpi: Kpi; now: string; onWhyPlan: () => void }) {
  const [collapsed, setCollapsed] = useStoredFlag('float-kpi-collapsed');
  if (collapsed) {
    return (
      <div className="view-in flex items-center gap-3 self-start rounded-2xl bg-surface/95 py-1.5 pl-4 pr-1.5 shadow-card ring-1 ring-line backdrop-blur">
        <KpiSummary kpi={kpi} />
        <ToggleButton collapsed onClick={() => setCollapsed(false)} label="Развернуть показатели" />
      </div>
    );
  }
  return (
    <div className="view-in relative">
      <KpiStrip kpi={kpi} now={now} onWhyPlan={onWhyPlan} />
      <ToggleButton collapsed={false} onClick={() => setCollapsed(true)} label="Свернуть показатели" className="absolute -bottom-3 left-1/2 -translate-x-1/2" />
    </div>
  );
}

function KpiSummary({ kpi }: { kpi: Kpi }) {
  const plan = kpi.monthPlan;
  const lag = kpi.shiftOutput.planToNow - kpi.shiftOutput.done;
  const oeeLow = kpi.oee.value < kpi.oee.norm;
  const worst = kpi.defects.worst && kpi.defects.worst.pct > 0 ? kpi.defects.worst.pct : kpi.defects.pct;
  const defectsHigh = worst > kpi.defects.norm;
  return (
    <div className="num flex flex-wrap items-center gap-x-5 gap-y-1 text-base leading-tight">
      <Part bad={!plan.onTrack} icon={plan.onTrack ? CircleCheck : TrendingDown}>
        {plan.onTrack ? 'Успеваем' : 'Не успеваем'}: <b>{signed(plan.gap)}</b> {plan.onTrack ? 'машин запаса' : 'машин'}
      </Part>
      <Part bad={lag > 2}>
        Выпуск смены <b>{kpi.shiftOutput.done}</b> из {kpi.shiftOutput.plan}
      </Part>
      <Part bad={oeeLow} icon={oeeLow ? TriangleAlert : undefined}>
        OEE <b>{pct0(kpi.oee.value)}</b>
      </Part>
      <Part bad={defectsHigh} icon={defectsHigh ? TriangleAlert : undefined}>
        Брак за смену <b>{pct1(worst)}</b>
      </Part>
    </div>
  );
}

function Part({ bad, icon: Icon, children }: { bad: boolean; icon?: typeof CircleCheck; children: React.ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap', bad ? cx('font-medium', TONE_CLASS.attention.ink) : 'text-ink-2')}>
      {Icon && <Icon className={cx('size-[1.05em] shrink-0', !bad && 'text-st-neutral')} strokeWidth={2.4} aria-hidden />}
      <span>{children}</span>
    </span>
  );
}

/** «Требует внимания»: свёрнутое — кнопка с числом; пока открыта панель участка, сворачивается само */
export function FloatingAttention({
  items,
  total,
  onOpen,
  onMore,
  compact,
}: {
  items: AttentionItem[];
  total: number;
  onOpen: (id: string) => void;
  onMore: () => void;
  compact: boolean;
}) {
  const [collapsed, setCollapsed] = useStoredFlag('float-attention-collapsed');
  const [openedInCompact, setOpenedInCompact] = useState(false);
  useEffect(() => {
    if (!compact) setOpenedInCompact(false);
  }, [compact]);
  const isCollapsed = compact ? !openedInCompact : collapsed;
  const toggle = (v: boolean) => (compact ? setOpenedInCompact(!v) : setCollapsed(v));

  if (isCollapsed) {
    const urgent = items.filter((i) => i.tone !== 'neutral');
    const tone = urgent.find((i) => i.tone === 'fault')?.tone ?? urgent[0]?.tone ?? 'neutral';
    const Icon = TONE_ICON[tone];
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        aria-expanded={false}
        className="view-in flex shrink-0 items-center gap-2 self-end rounded-2xl bg-surface/95 py-2 pl-3 pr-2 text-base font-semibold shadow-card ring-1 ring-line backdrop-blur hover:bg-surface"
      >
        <Icon className={cx('size-5 shrink-0', tone === 'neutral' ? 'text-st-neutral' : TONE_CLASS[tone].ink)} strokeWidth={2.25} aria-hidden />
        Требует внимания
        <span className={cx('num rounded-md px-1.5 text-sm', urgent.length ? cx(TONE_CLASS[tone].bg, TONE_CLASS[tone].ink) : 'bg-surface-2 text-ink-2')}>{total}</span>
        <ChevronDown className="size-4 text-ink-3" strokeWidth={2.5} aria-hidden />
      </button>
    );
  }
  return (
    <div className="view-in relative min-h-0 shrink overflow-y-auto rounded-2xl">
      <AttentionColumn items={items} total={total} onOpen={onOpen} onMore={onMore} />
      <ToggleButton collapsed={false} onClick={() => toggle(true)} label="Свернуть «Требует внимания»" className="absolute right-2.5 top-2.5" />
    </div>
  );
}
