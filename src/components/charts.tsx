import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

export interface Series {
  name: string;
  color: string;
  points: [number, number][];
  dashed?: boolean;
}

interface LineChartProps {
  series: Series[];
  xDomain: [number, number];
  yDomain?: [number, number];
  height?: number;
  xTicks: number[];
  xFormat: (x: number) => string;
  yFormat: (y: number) => string;
  refLines?: { y: number; label: string; color: string }[];
  nowX?: number;
  legendExtra?: ReactNode;
}

const M = { l: 44, r: 14, t: 10, b: 24 };

export function LineChart({ series, xDomain, yDomain, height = 210, xTicks, xFormat, yFormat, refLines = [], nowX, legendExtra }: LineChartProps) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  let [y0, y1] = yDomain ?? [Infinity, -Infinity];
  if (!yDomain) {
    for (const s of series) for (const [, y] of s.points) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (const r of refLines) y1 = Math.max(y1, r.y);
    y0 = Math.min(0, y0);
    y1 = y1 * 1.08 || 1;
  }
  const yTicks = niceTicks(y0, y1, 4);
  const pw = w - M.l - M.r;
  const ph = height - M.t - M.b;
  const sx = (x: number) => M.l + ((x - xDomain[0]) / (xDomain[1] - xDomain[0] || 1)) * pw;
  const sy = (y: number) => M.t + ph - ((y - y0) / (y1 - y0 || 1)) * ph;

  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');

  const hoverRows =
    hover === null
      ? []
      : series
          .map((s) => {
            if (!s.points.length || hover < s.points[0][0] || hover > s.points[s.points.length - 1][0]) return null;
            let best = s.points[0];
            for (const p of s.points) if (Math.abs(p[0] - hover) < Math.abs(best[0] - hover)) best = p;
            return { s, p: best };
          })
          .filter((x): x is { s: Series; p: [number, number] } => x !== null);

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = xDomain[0] + ((e.clientX - r.left) / r.width) * (xDomain[1] - xDomain[0]);
    setHover(Math.round(x));
  };

  return (
    <div className="chart" ref={ref}>
      <div className="legend" style={{ marginBottom: 6 }}>
        {series.map((s) => (
          <span className="legend-item" key={s.name}>
            <span className={`legend-line${s.dashed ? ' dashed' : ''}`} style={{ borderColor: s.color }} />
            {s.name}
          </span>
        ))}
        {legendExtra}
      </div>
      <svg width={w} height={height} style={{ display: 'block' }} role="img">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={w - M.r} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" />
            <text x={M.l - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)" className="tnum">
              {yFormat(t)}
            </text>
          </g>
        ))}
        <line x1={M.l} x2={w - M.r} y1={sy(y0)} y2={sy(y0)} stroke="var(--axis)" />
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--text-muted)" className="tnum">
            {xFormat(t)}
          </text>
        ))}
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={M.l} x2={w - M.r} y1={sy(r.y)} y2={sy(r.y)} stroke={r.color} strokeWidth="1" opacity="0.7" />
            <text x={w - M.r - 4} y={sy(r.y) - 4} textAnchor="end" fontSize="10.5" fill="var(--text-secondary)">
              {r.label}
            </text>
          </g>
        ))}
        {nowX !== undefined && (
          <g>
            <line x1={sx(nowX)} x2={sx(nowX)} y1={M.t} y2={M.t + ph} stroke="var(--text-muted)" strokeWidth="1" />
            <text x={sx(nowX) + 4} y={M.t + 10} fontSize="10.5" fill="var(--text-muted)">
              сейчас
            </text>
          </g>
        )}
        {series.map((s) => (
          <path
            key={s.name}
            d={path(s.points)}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeDasharray={s.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {hover !== null && hoverRows.length > 0 && (
          <g pointerEvents="none">
            <line x1={sx(hover)} x2={sx(hover)} y1={M.t} y2={M.t + ph} stroke="var(--text-secondary)" strokeWidth="1" />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.name} cx={sx(p[0])} cy={sy(p[1])} r="4" fill={s.color} stroke="var(--surface-1)" strokeWidth="2" />
            ))}
          </g>
        )}
        <rect x={M.l} y={M.t} width={pw} height={ph} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && hoverRows.length > 0 && (
        <div
          className="tooltip"
          style={{
            left: Math.min(sx(hover) + 12, w - 170),
            top: 30,
          }}
        >
          <div className="tt-title">{xFormat(hover)}</div>
          {hoverRows.map(({ s, p }) => (
            <div className="tt-row" key={s.name}>
              <span className="swatch" style={{ background: s.color }} />
              {s.name}: <b>{yFormat(p[1])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  color?: string;
  note?: string;
}

export function HBar({ rows, format, max }: { rows: BarRow[]; format: (v: number) => string; max?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbar">
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'contents' }} onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}>
          <div className="hbar-label" title={r.label} style={hover === r.key ? { color: 'var(--text-primary)' } : undefined}>
            {r.label}
          </div>
          <div className="hbar-track">
            <div
              className="hbar-fill"
              style={{ width: `${(r.value / m) * 100}%`, background: r.color ?? 'var(--series-1)', opacity: hover && hover !== r.key ? 0.55 : 1 }}
            />
          </div>
          <div className="hbar-value">
            {format(r.value)}
            {r.note && <span className="muted"> · {r.note}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StackBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="stackbar">
        {visible.map((p) => (
          <div key={p.label} style={{ flex: p.value, background: p.color }} title={`${p.label}: ${Math.round((p.value / total) * 100)}%`} />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {parts.map((p) => (
          <span key={p.label} className="legend-item">
            <span className="swatch" style={{ background: p.color, marginRight: 0 }} />
            {p.label} <span className="tnum">{Math.round((p.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
