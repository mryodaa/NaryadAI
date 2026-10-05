import { useState } from 'react';
import { useSim, useViewFrame } from '../store';
import { useUi } from '../uiContext';
import { MARGIN_PER_CAR, REJECT_NORM, SHIFT_PLAN, STATIONS } from '../sim/config';
import { kpis, riskItems } from '../sim/analytics';
import { money, num, pct } from '../lib/format';
import { FactoryMap, MapLegend, type MapLayer } from '../components/FactoryMap';
import { TimeMachine } from '../components/TimeMachine';
import { IncidentFeed } from '../components/Incidents';
import { OrdersPanel } from '../components/Orders';
import { StationPanel } from '../components/StationPanel';
import { OutputChart, ParetoChart } from '../components/Production';
import { Card, Kpi } from '../components/ui';

export function KpiStrip() {
  const { s, la, forecast } = useSim();
  const k = kpis(s);
  const diff = s.shift.shipped - k.plan;
  const gap = SHIFT_PLAN - forecast.endShipped;
  const atRisk = riskItems(s, la).reduce((a, r) => a + r.rub, 0);
  const active = s.incidents.filter((i) => i.resolvedAt === null).length;
  return (
    <div className="kpis">
      <Kpi
        icon="factory"
        label="Выпуск смены"
        value={
          <>
            {num(s.shift.shipped)} <small>/ {num(k.plan)}</small>
          </>
        }
        sub={<span className={diff >= 0 ? 'delta-up' : 'delta-down'}>{diff >= 0 ? '▲ +' : '▼ −'}{num(Math.abs(diff))} к плану на сейчас</span>}
      />
      <Kpi
        icon="sparkle"
        label="Прогноз на конец смены"
        value={
          <>
            {num(forecast.endShipped)} <small>/ {SHIFT_PLAN}</small>
          </>
        }
        sub={gap > 3 ? <span className="delta-down">▼ −{num(gap)} авто ≈ {money(gap * MARGIN_PER_CAR)}</span> : <span className="delta-up">▲ план выполняется</span>}
      />
      <Kpi icon="chart" label="OEE смены" value={pct(k.oee)} sub={`A ${pct(k.A)} · P ${pct(k.P)} · Q ${pct(k.Q)}`} />
      <Kpi icon="check" label="Брак на ОТК (60 авто)" value={pct(k.rejectRate, 1)} sub={k.rejectRate > REJECT_NORM ? <span className="delta-down">▲ выше нормы {pct(REJECT_NORM)}</span> : `норма ≤ ${pct(REJECT_NORM)}`} />
      <Kpi icon="bolt" label="Узкое место" value={STATIONS[la.bottleneck].short} sub={`${Math.round(la.lineRate * 60)} авто/ч · час простоя ${money(la.costPerHour[la.bottleneck])}`} />
      <Kpi icon="alert" label="Деньги под риском" value={money(atRisk)} sub={`${active} активн. инцидент${active === 1 ? '' : active >= 2 && active <= 4 ? 'а' : 'ов'}`} />
    </div>
  );
}

export function ShopView() {
  const [layer, setLayer] = useState<MapLayer>('status');
  const { frame, mode } = useViewFrame();
  const ui = useUi();

  return (
    <>
      <KpiStrip />
      <div className="row main">
        <Card
          title="Цифровой двойник линии"
          idea="машина времени"
          hint="Живая схема потока: участки, буферы, оборудование. Двигайте ползунок влево — история, вправо — прогноз состояния завода."
          actions={
            <div className="seg" role="tablist" aria-label="Слой схемы">
              {(
                [
                  ['status', 'Статус'],
                  ['cost', 'Цена простоя'],
                  ['risk', 'Риск ИИ'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} className={layer === id ? 'on' : ''} onClick={() => setLayer(id)} role="tab" aria-selected={layer === id}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <FactoryMap
            frame={frame}
            layer={layer}
            mode={mode}
            selected={ui.selectedStation}
            selectedEquip={ui.selectedEquip}
            onSelect={(id) => ui.focusStation(id)}
            onSelectEquip={(id) => ui.setSelectedEquip(id)}
          />
          <TimeMachine />
          <MapLegend layer={layer} maxCost={Math.max(...frame.costPerHour)} />
        </Card>
        <div className="stack">
          <IncidentFeed limit={10} />
        </div>
      </div>
      <div className="row three">
        <StationPanel />
        <div className="stack">
          <OutputChart />
          <ParetoChart />
        </div>
        <OrdersPanel />
      </div>
    </>
  );
}
