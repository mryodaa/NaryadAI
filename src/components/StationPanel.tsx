import { useSim } from '../store';
import { useUi } from '../uiContext';
import { EQUIPMENT, STATIONS, VIB_CRIT, VIB_WARN, stationIndex } from '../sim/config';
import { availability } from '../sim/analytics';
import { assessRisk } from '../sim/model';
import { clock, dur, money, num, pct } from '../lib/format';
import { LineChart, StackBar } from './charts';
import { Card, Icon, StatusPill, riskColor } from './ui';

export function StationPanel() {
  const { s, la } = useSim();
  const ui = useUi();
  const id = ui.selectedStation ?? STATIONS[la.bottleneck].id;
  const i = stationIndex(id);
  const d = STATIONS[i];
  const st = s.stations[i];
  const eqs = s.equipment.filter((e) => e.stationId === id);
  const eqId = ui.selectedEquip && eqs.some((e) => e.id === ui.selectedEquip) ? ui.selectedEquip : [...eqs].sort((a, b) => assessRisk(b).p - assessRisk(a).p)[0].id;
  const e = eqs.find((x) => x.id === eqId)!;
  const r = assessRisk(e);
  const sh = st.shift;

  return (
    <Card
      title={
        <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {d.name} <StatusPill status={st.status} kind={st.downKind} />
        </span>
      }
      hint="Кликните на участок или точку оборудования на схеме."
    >
      <div className="stats">
        <div>
          <div className="stat-label">Выпуск за смену</div>
          <div className="stat-value">{sh.produced}</div>
        </div>
        <div>
          <div className="stat-label">Доступность (2 ч)</div>
          <div className="stat-value">{pct(availability(st))}</div>
        </div>
        <div>
          <div className="stat-label">Цена часа простоя сейчас</div>
          <div className="stat-value">{money(la.costPerHour[i])}</div>
        </div>
        <div>
          <div className="stat-label">Защита буфером</div>
          <div className="stat-value">{i === la.bottleneck ? 'нет (узкое место)' : dur(la.protect[i])}</div>
        </div>
      </div>
      <div>
        <div className="stat-label" style={{ marginBottom: 6 }}>
          Время смены по состояниям
        </div>
        <StackBar
          parts={[
            { label: 'Работа', value: sh.run, color: 'var(--good)' },
            { label: 'Ожидание', value: sh.starved + sh.blocked, color: 'var(--warning)' },
            { label: 'Простой', value: sh.down, color: 'var(--critical)' },
            { label: 'ТО', value: sh.maint, color: 'var(--maint)' },
          ]}
        />
      </div>

      <div>
        <div className="stat-label" style={{ marginBottom: 4 }}>
          Оборудование · риск отказа в ближайшие 8 ч
        </div>
        {eqs.map((x) => {
          const rx = assessRisk(x);
          return (
            <button key={x.id} className={`equip-row${x.id === eqId ? ' sel' : ''}`} onClick={() => ui.setSelectedEquip(x.id)}>
              <span>
                {x.name}
                {x.failed && <span className="muted"> · в ремонте</span>}
              </span>
              <span className="muted tnum">{num(x.vib, 1)} мм/с</span>
              <span className="pill tnum" style={{ minWidth: 56, justifyContent: 'flex-end' }}>
                <span className="swatch" style={{ background: riskColor(x.failed ? 1 : rx.p), marginRight: 0, borderRadius: 99 }} />
                {x.failed ? '—' : pct(rx.p)}
              </span>
            </button>
          );
        })}
      </div>

      <EquipmentDetail equipId={e.id} />
      {r.p >= 0.25 && !e.failed && (
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => ui.openWhatIf(e.id)}>
          <Icon name="scale" size={14} /> Что делать? Сравнить варианты
        </button>
      )}
    </Card>
  );
}

export function EquipmentDetail({ equipId }: { equipId: string }) {
  const { s } = useSim();
  const e = s.equipment.find((x) => x.id === equipId)!;
  const def = EQUIPMENT.find((x) => x.id === equipId)!;
  const r = assessRisk(e);
  const hist: [number, number][] = e.vibHist.map((v, k) => [s.t - e.vibHist.length + 1 + k, v]);
  const fc: [number, number][] = [];
  if (r.trendH > 0.15) for (let k = 0; k <= 120; k += 5) fc.push([s.t + k, Math.min(14, e.vib + (r.trendH / 60) * k)]);
  const maxW = Math.max(1.5, ...r.terms.map((t) => Math.abs(t.w)));
  const x0 = s.t - e.vibHist.length + 1;
  const ticks = [];
  for (let t = Math.ceil(x0 / 60) * 60; t <= s.t + 120; t += 60) ticks.push(t);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="stat-label" style={{ marginBottom: 4 }}>
          {def.name}: вибрация, мм/с
        </div>
        <LineChart
          height={170}
          series={[
            { name: 'Факт', color: 'var(--series-1)', points: hist },
            ...(fc.length ? [{ name: 'Тренд (прогноз)', color: 'var(--series-1)', points: fc, dashed: true }] : []),
          ]}
          xDomain={[x0, s.t + 120]}
          yDomain={[0, 14]}
          xTicks={ticks}
          xFormat={clock}
          yFormat={(v) => num(v)}
          refLines={[
            { y: VIB_WARN, label: 'предупреждение', color: 'var(--warning)' },
            { y: VIB_CRIT, label: 'критично', color: 'var(--critical)' },
          ]}
          nowX={s.t}
        />
      </div>
      <div>
        <div className="stat-label" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>Почему ИИ так считает (вклад признаков)</span>
          <span>
            риск <b style={{ color: 'var(--text-primary)' }}>{pct(r.p)}</b>
            {r.ttf != null && <> · отказ через ~{dur(r.ttf)}</>}
          </span>
        </div>
        <div className="terms">
          {[...r.terms]
            .sort((a, b) => b.w - a.w)
            .map((t) => (
              <div className="term" key={t.key}>
                <span className="secondary">{t.label}</span>
                <div className="term-bar" title={`${t.w >= 0 ? 'повышает' : 'снижает'} риск`}>
                  <div
                    style={{
                      left: t.w >= 0 ? '50%' : `${50 - (Math.abs(t.w) / maxW) * 50}%`,
                      width: `${(Math.abs(t.w) / maxW) * 50}%`,
                      background: t.w >= 0 ? 'var(--div-pos)' : 'var(--div-neg)',
                      borderRadius: t.w >= 0 ? '0 3px 3px 0' : '3px 0 0 3px',
                    }}
                  />
                </div>
              </div>
            ))}
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span className="legend-item">
            <span className="swatch" style={{ background: 'var(--div-pos)', marginRight: 0 }} /> повышает риск
          </span>
          <span className="legend-item">
            <span className="swatch" style={{ background: 'var(--div-neg)', marginRight: 0 }} /> снижает риск
          </span>
        </div>
      </div>
    </div>
  );
}
