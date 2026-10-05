import { useSim } from '../store';
import { SHIFT_PLAN, STATIONS } from '../sim/config';
import { shiftBounds } from '../sim/analytics';
import { clock, dur, money, num } from '../lib/format';
import { HBar, LineChart } from './charts';
import { Card } from './ui';

export function OutputChart() {
  const { s, frames, forecast } = useSim();
  const { start, end } = shiftBounds(s.t);
  const fact: [number, number][] = frames.filter((f) => f.shiftIndex === s.shift.index && f.t >= start).map((f) => [f.t, f.shipped]);
  const ticks: number[] = [];
  for (let t = start; t <= end; t += 60) ticks.push(t);
  const gap = SHIFT_PLAN - forecast.endShipped;

  return (
    <Card
      title="Выпуск смены: факт, план, прогноз"
      hint={
        <>
          Прогноз — прогон копии двойника до конца смены с текущим состоянием оборудования.{' '}
          {gap > 3 ? (
            <b style={{ color: 'var(--text-primary)' }}>
              Ожидается {Math.round(forecast.endShipped)} из {SHIFT_PLAN} (−{Math.round(gap)} авто).
            </b>
          ) : (
            <>Ожидается {Math.round(forecast.endShipped)} из {SHIFT_PLAN}: план выполняется.</>
          )}
        </>
      }
    >
      <LineChart
        series={[
          { name: 'Факт', color: 'var(--series-1)', points: fact },
          { name: 'Прогноз', color: 'var(--series-1)', points: forecast.curve, dashed: true },
          { name: 'План', color: 'var(--text-muted)', points: [[start, 0], [end, SHIFT_PLAN]] },
        ]}
        xDomain={[start, end]}
        yDomain={[0, Math.max(SHIFT_PLAN, forecast.endShipped) * 1.08]}
        xTicks={ticks}
        xFormat={clock}
        yFormat={(v) => num(v)}
        nowX={s.t}
      />
    </Card>
  );
}

export function ParetoChart() {
  const { s } = useSim();
  const rows = Object.entries(s.shift.lossMin)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: k, value: v }));
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <Card title="Потери времени по причинам" hint="Парето за текущую смену: участко-минуты простоя. Сюда же попадают записи из журналов операторов.">
      {rows.length ? (
        <HBar rows={rows.map((r) => ({ ...r, note: `${Math.round((r.value / total) * 100)}%` }))} format={(v) => dur(v)} />
      ) : (
        <div className="empty">Потерь пока нет</div>
      )}
    </Card>
  );
}

export function CostByStation() {
  const { la } = useSim();
  return (
    <Card
      title="Цена часа простоя по участкам"
      idea="динамическая цена"
      hint="Меняется каждую минуту: зависит от того, где узкое место и сколько деталей в буферах. Это задаёт приоритет ремонтов."
    >
      <HBar
        rows={STATIONS.map((d, i) => ({
          key: d.id,
          label: d.short,
          value: la.costPerHour[i],
          color: i === la.bottleneck ? 'var(--series-1)' : 'var(--text-muted)',
          note: i === la.bottleneck ? 'узкое место' : `буфер ${dur(la.protect[i])}`,
        }))}
        format={money}
      />
    </Card>
  );
}
