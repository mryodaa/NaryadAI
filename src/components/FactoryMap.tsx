import { BUFFER_CAPS, EQUIPMENT, KITS, STATIONS } from '../sim/config';
import type { MapFrame, StationId } from '../sim/types';
import { clock, dur, money, pct } from '../lib/format';
import { IconG, STATUS_META, riskColor } from './ui';

export type MapLayer = 'status' | 'cost' | 'risk';

const BOX_W = 130;
const BOX_H = 150;
const BOX_Y = 180;
const GAP = 70;
const CONV_Y = BOX_Y + 75;
const sx = (i: number) => 20 + i * (BOX_W + GAP);

const EQ_BY_STATION = STATIONS.map((d) => EQUIPMENT.filter((e) => e.stationId === d.id));

function trunc(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

interface Props {
  frame: MapFrame;
  layer: MapLayer;
  mode: 'live' | 'past' | 'future';
  selected: StationId | null;
  selectedEquip: string | null;
  onSelect: (id: StationId) => void;
  onSelectEquip: (id: string) => void;
}

export function FactoryMap({ frame, layer, mode, selected, selectedEquip, onSelect, onSelectEquip }: Props) {
  const maxCost = Math.max(1, ...frame.costPerHour);
  const cover = frame.kits / 0.95;
  const toDelivery = frame.kitsNextAt - frame.t;
  const kitsShort = cover < 60 && toDelivery > cover;

  return (
    <div className={`map-wrap ${mode}`}>
      {mode !== 'live' && (
        <div className="map-banner">
          {mode === 'future' ? (
            <>
              <IconSvg name="sparkle" /> Прогноз двойника на {clock(frame.t)}
            </>
          ) : (
            <>
              <IconSvg name="rewind" /> История: {clock(frame.t)}
            </>
          )}
        </div>
      )}
      <svg className="map-svg" viewBox="0 0 1100 370" role="img" aria-label="Схема производственной линии">
        {/* склад комплектующих */}
        <g>
          <rect x={sx(3)} y={24} width={BOX_W} height={100} rx={10} fill="var(--surface-1)" stroke={kitsShort ? 'var(--serious)' : 'var(--axis)'} strokeWidth={kitsShort ? 2 : 1.5} />
          <IconG name="truck" x={sx(3) + 10} y={33} size={16} color="var(--text-secondary)" />
          <text x={sx(3) + 32} y={46} fontSize="12" fontWeight="600" fill="var(--text-primary)">
            Склад компл.
          </text>
          <text x={sx(3) + 12} y={72} fontSize="18" fontWeight="650" fill="var(--text-primary)" className="tnum">
            {Math.round(frame.kits)}
            <tspan fontSize="11" fontWeight="400" fill="var(--text-muted)">
              {' '}
              / {KITS.cap}
            </tspan>
          </text>
          <rect x={sx(3) + 12} y={80} width={BOX_W - 24} height={5} rx={2.5} fill="var(--surface-3)" />
          <rect x={sx(3) + 12} y={80} width={Math.max(2, ((BOX_W - 24) * frame.kits) / KITS.cap)} height={5} rx={2.5} fill="var(--series-1)" />
          <text x={sx(3) + 12} y={102} fontSize="10.5" fill={kitsShort ? 'var(--text-primary)' : 'var(--text-muted)'}>
            {kitsShort ? `⚠ запас на ${Math.round(cover)} мин` : `запас на ${dur(cover)}`}
          </text>
          <text x={sx(3) + 12} y={116} fontSize="10.5" fill="var(--text-muted)">
            поставка через {dur(toDelivery)}
          </text>
          <line x1={sx(3) + BOX_W / 2} x2={sx(3) + BOX_W / 2} y1={124} y2={BOX_Y - 22} stroke="var(--axis)" strokeWidth="2" className={frame.statuses[3] === 'run' ? 'flow' : undefined} />
        </g>

        {/* конвейеры и буферы */}
        {STATIONS.map((d, i) => {
          const x1 = sx(i) + BOX_W;
          const x2 = i < STATIONS.length - 1 ? sx(i + 1) : 980;
          const flowing = frame.statuses[i] === 'run';
          const isBuf = i < STATIONS.length - 1;
          const level = isBuf ? frame.buffers[i] : 0;
          const cap = isBuf ? BUFFER_CAPS[i] : 1;
          return (
            <g key={`c-${d.id}`}>
              <line x1={x1} x2={x2} y1={CONV_Y} y2={CONV_Y} stroke={flowing ? 'var(--text-muted)' : 'var(--axis)'} strokeWidth="2" className={flowing ? 'flow' : undefined} />
              <path d={`M${x2 - 7},${CONV_Y - 5} L${x2 - 1},${CONV_Y} L${x2 - 7},${CONV_Y + 5}`} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" />
              {isBuf && (
                <g>
                  <text x={(x1 + x2) / 2} y={CONV_Y - 26} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                    буфер
                  </text>
                  <rect x={x1 + 10} y={CONV_Y - 18} width={GAP - 20} height={6} rx={3} fill="var(--surface-3)" />
                  <rect x={x1 + 10} y={CONV_Y - 18} width={Math.max(level > 0 ? 2 : 0, ((GAP - 20) * level) / cap)} height={6} rx={3} fill="var(--series-1)" />
                  <text x={(x1 + x2) / 2} y={CONV_Y + 20} textAnchor="middle" fontSize="11" fill={level === 0 ? 'var(--text-primary)' : 'var(--text-secondary)'} className="tnum">
                    {level}/{cap}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* отгрузка */}
        <g>
          <rect x={980} y={BOX_Y + 35} width={100} height={80} rx={10} fill="var(--surface-1)" stroke="var(--axis)" strokeWidth="1.5" />
          <text x={992} y={BOX_Y + 56} fontSize="12" fontWeight="600" fill="var(--text-primary)">
            Отгрузка
          </text>
          <text x={992} y={BOX_Y + 82} fontSize="20" fontWeight="650" fill="var(--text-primary)" className="tnum">
            {Math.round(frame.shipped)}
          </text>
          <text x={992} y={BOX_Y + 102} fontSize="10.5" fill="var(--text-muted)" className="tnum">
            брак: {Math.round(frame.rejected)}
          </text>
        </g>

        {/* участки */}
        {STATIONS.map((d, i) => {
          const x = sx(i);
          const status = frame.statuses[i];
          const meta = STATUS_META[status];
          const eqs = EQ_BY_STATION[i];
          const maxRisk = Math.max(...eqs.map((e) => frame.risks[e.id] ?? 0));
          const maxRiskEq = eqs.reduce((a, b) => ((frame.risks[b.id] ?? 0) > (frame.risks[a.id] ?? 0) ? b : a));
          const cost = frame.costPerHour[i];
          const k = cost / maxCost;
          const stopped = status === 'down' || status === 'maint';

          let stroke = meta.color;
          let fill = 'var(--surface-1)';
          if (layer === 'cost') {
            stroke = 'var(--axis)';
            fill = `rgba(57, 135, 229, ${(0.08 + 0.55 * k).toFixed(3)})`;
          }
          if (layer === 'risk') stroke = riskColor(maxRisk);
          const isSel = selected === d.id;

          let label = 'Выпуск за смену';
          let value: string = String(frame.produced[i]);
          if (layer === 'status' && stopped) {
            label = status === 'maint' ? 'Плановое ТО' : 'Причина';
            value = trunc(frame.causes[i], 17);
          }
          if (layer === 'cost') {
            label = i === frame.bottleneck ? 'Буфер не защищает' : `Буфер: ${dur(frame.protect[i])}`;
            value = money(cost);
          }
          if (layer === 'risk') {
            label = `Макс. риск · ${maxRiskEq.id}`;
            value = pct(maxRisk);
          }

          return (
            <g key={d.id} className="station" onClick={() => onSelect(d.id)}>
              {i === frame.bottleneck && (
                <g>
                  <rect x={x + BOX_W / 2 - 52} y={BOX_Y - 22} width={104} height={18} rx={9} fill="var(--bottleneck)" />
                  <text x={x + BOX_W / 2} y={BOX_Y - 9} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff" letterSpacing="0.04em">
                    УЗКОЕ МЕСТО
                  </text>
                </g>
              )}
              {isSel && <rect x={x - 5} y={BOX_Y - 5} width={BOX_W + 10} height={BOX_H + 10} rx={14} fill="none" stroke="var(--accent)" strokeWidth="1.5" />}
              <rect
                className={`station-box${status === 'down' && layer === 'status' ? ' pulse' : ''}`}
                x={x}
                y={BOX_Y}
                width={BOX_W}
                height={BOX_H}
                rx={10}
                fill={fill}
                stroke={stroke}
                strokeWidth={2}
                strokeDasharray={mode === 'future' ? '6 4' : undefined}
              />
              <text x={x + 12} y={BOX_Y + 24} fontSize="14" fontWeight="650" fill="var(--text-primary)">
                {d.short}
              </text>
              <circle cx={x + 19} cy={BOX_Y + 44} r={7} fill={meta.color} />
              <IconG name={meta.icon} x={x + 14} y={BOX_Y + 39} size={10} color="#0d0d0d" strokeWidth={3} fill={meta.icon === 'play'} />
              <text x={x + 31} y={BOX_Y + 48} fontSize="12" fill="var(--text-primary)">
                {status === 'down' && frame.causes[i].startsWith('Отказ') ? 'Авария' : meta.label}
              </text>
              <text x={x + 12} y={BOX_Y + 72} fontSize="10.5" fill="var(--text-muted)">
                {trunc(label, 20)}
              </text>
              <text x={x + 12} y={BOX_Y + 92} fontSize={value.length > 12 ? 12 : 16} fontWeight="650" fill="var(--text-primary)" className="tnum">
                {value}
              </text>
              {eqs.map((e, j) => {
                const cx = x + 22 + j * 40;
                const r = frame.risks[e.id] ?? 0;
                const sel = selectedEquip === e.id;
                return (
                  <g
                    key={e.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelect(d.id);
                      onSelectEquip(e.id);
                    }}
                  >
                    <title>{`${e.name}: риск отказа ${pct(r)}`}</title>
                    <rect x={cx - 18} y={BOX_Y + 104} width={36} height={40} fill="transparent" />
                    {sel && <circle cx={cx} cy={BOX_Y + 118} r={10} fill="none" stroke="var(--accent)" strokeWidth="2" />}
                    <circle cx={cx} cy={BOX_Y + 118} r={6} fill={riskColor(r)} className={r >= 0.8 ? 'pulse' : undefined} />
                    <text x={cx} y={BOX_Y + 140} textAnchor="middle" fontSize="9.5" fill="var(--text-secondary)">
                      {e.id}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function IconSvg({ name }: { name: 'sparkle' | 'rewind' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24">
      <IconG name={name} x={0} y={0} size={24} />
    </svg>
  );
}

export function MapLegend({ layer, maxCost }: { layer: MapLayer; maxCost: number }) {
  if (layer === 'cost')
    return (
      <div className="map-legend">
        <span>
          Значение в блоке — цена часа простоя участка: 0
          <span className="ramp" style={{ background: 'linear-gradient(90deg, rgba(57,135,229,.08), rgba(57,135,229,.63))' }} />
          {money(maxCost)}
        </span>
        <span className="muted">Буфер «защищает» участок, пока не опустеет. Узкое место не защищено — каждая минута его простоя теряет выпуск.</span>
      </div>
    );
  if (layer === 'risk')
    return (
      <div className="map-legend">
        <span>Риск отказа в ближайшие 8 ч (ИИ):</span>
        {[
          ['< 25%', 'var(--good)'],
          ['25–50%', 'var(--warning)'],
          ['50–80%', 'var(--serious)'],
          ['≥ 80%', 'var(--critical)'],
        ].map(([l, c]) => (
          <span key={l}>
            <span className="swatch" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    );
  return (
    <div className="map-legend">
      {(['run', 'starved', 'blocked', 'down', 'maint'] as const).map((s) => (
        <span key={s}>
          <span className="swatch" style={{ background: STATUS_META[s].color }} />
          {STATUS_META[s].label}
        </span>
      ))}
      <span>
        <span className="swatch" style={{ background: 'var(--bottleneck)' }} />
        Узкое место
      </span>
      <span className="muted">Точки — оборудование, цвет — риск отказа по оценке ИИ</span>
    </div>
  );
}
