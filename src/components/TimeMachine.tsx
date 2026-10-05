import { useSim } from '../store';
import { FUTURE_MIN } from '../sim/forecast';
import { clock } from '../lib/format';
import { Icon } from './ui';

const PAST_MAX = 240;

export function TimeMachine() {
  const { s, frames, forecast, offset, setOffset } = useSim();
  const min = -Math.min(PAST_MAX, frames.length - 1);
  const max = FUTURE_MIN;
  const pos = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const marks = forecast.failures.filter((f) => f.t - s.t <= FUTURE_MIN);

  const ticks: number[] = [];
  for (let v = Math.ceil(min / 60) * 60; v <= max; v += 60) ticks.push(v);

  const t = s.t + offset;
  return (
    <div className="tm">
      <div className="tm-label">
        <span className="muted">{offset === 0 ? 'Сейчас' : offset < 0 ? 'История' : 'Прогноз'}</span>
        <b className="tnum">
          {clock(t)}
          {offset !== 0 && <span className="muted" style={{ fontWeight: 400 }}> ({offset > 0 ? '+' : '−'}{Math.abs(offset)} мин)</span>}
        </b>
      </div>
      <div className="tm-track">
        <div className="tm-now" style={{ left: pos(0) }} />
        {marks.map((m) => (
          <div key={`${m.equipId}-${m.t}`} className="tm-mark" style={{ left: pos(m.t - s.t) }} title={`Прогноз отказа: ${s.equipment.find((e) => e.id === m.equipId)?.name} в ${clock(m.t)}`} />
        ))}
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={offset}
          onChange={(e) => setOffset(Number(e.target.value))}
          aria-label="Машина времени: прошлое и прогноз"
        />
        <div className="tm-scale">
          {ticks.map((v) => (
            <span key={v} style={{ left: pos(v) }}>
              {v === 0 ? 'сейчас' : `${v > 0 ? '+' : '−'}${Math.abs(v / 60)} ч`}
            </span>
          ))}
        </div>
      </div>
      <button className="btn" onClick={() => setOffset(0)} disabled={offset === 0} title="Вернуться в реальное время">
        <Icon name="live" size={14} /> Live
      </button>
    </div>
  );
}
