import type { CSSProperties, ReactNode } from 'react';
import type { OrderStatus, Severity, StationStatus, StopKind } from '../sim/types';

const PATHS = {
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5v14M16 5v14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 3.5 2.5 20.5h19L12 3.5zM12 10v4.5M12 17.5h.01',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  truck: 'M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7M6.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  minus: 'M6 12h12',
  bar: 'M5 5v14M5 12h14',
  bolt: 'M13 2.5 4.5 14h7l-1 7.5L19 10h-7z',
  factory: 'M3 20V10l5 3V10l5 3V6l8-3v17zM3 20h18',
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7',
  phone: 'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18h2',
  doc: 'M6.5 2.5h8l4 4v15h-12zM14 2.5v4.5h4.5M9 12h6M9 15.5h6',
  rewind: 'M11 6 4 12l7 6zM20 6l-7 6 7 6z',
  live: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14',
  flask: 'M9.5 3h5M10.5 3v6L5 19.5A1 1 0 0 0 5.9 21h12.2a1 1 0 0 0 .9-1.5L13.5 9V3',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, fill = false, strokeWidth = 2 }: { name: IconName; size?: number; fill?: boolean; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path
        d={PATHS[name]}
        fill={fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Иконка внутри SVG-сцены */
export function IconG({ name, x, y, size = 16, color = 'currentColor', fill = false, strokeWidth = 2 }: { name: IconName; x: number; y: number; size?: number; color?: string; fill?: boolean; strokeWidth?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${size / 24})`} pointerEvents="none">
      <path d={PATHS[name]} fill={fill ? color : 'none'} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

export function Card({
  title,
  hint,
  idea,
  actions,
  children,
  style,
}: {
  title: ReactNode;
  hint?: ReactNode;
  idea?: string;
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="card" style={style}>
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title">
            {title}
            {idea && (
              <span className="idea-tag" title="Ключевая фишка концепции">
                <Icon name="sparkle" size={11} /> {idea}
              </span>
            )}
          </h2>
          {hint && <div className="card-hint">{hint}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export const STATUS_META: Record<StationStatus, { label: string; color: string; icon: IconName }> = {
  run: { label: 'Работает', color: 'var(--good)', icon: 'play' },
  starved: { label: 'Нет заготовок', color: 'var(--warning)', icon: 'minus' },
  blocked: { label: 'Выход занят', color: 'var(--warning)', icon: 'bar' },
  down: { label: 'Простой', color: 'var(--critical)', icon: 'x' },
  maint: { label: 'ТО', color: 'var(--maint)', icon: 'wrench' },
};

export function statusLabel(st: StationStatus, kind?: StopKind | null) {
  if (st === 'down' && kind === 'failure') return 'Авария';
  return STATUS_META[st].label;
}

export function StatusPill({ status, kind }: { status: StationStatus; kind?: StopKind | null }) {
  const m = STATUS_META[status];
  return (
    <span className="pill">
      <span className="dot" style={{ background: m.color }}>
        <Icon name={m.icon} size={10} strokeWidth={3} fill={m.icon === 'play'} />
      </span>
      {statusLabel(status, kind)}
    </span>
  );
}

export const SEV_META: Record<Severity, { label: string; color: string; icon: IconName }> = {
  info: { label: 'Событие', color: 'var(--text-muted)', icon: 'info' },
  warning: { label: 'Внимание', color: 'var(--warning)', icon: 'alert' },
  serious: { label: 'Серьёзно', color: 'var(--serious)', icon: 'alert' },
  critical: { label: 'Критично', color: 'var(--critical)', icon: 'x' },
};

export function SevPill({ sev }: { sev: Severity }) {
  const m = SEV_META[sev];
  return (
    <span className="pill" style={{ fontSize: 11.5 }}>
      <span style={{ color: m.color, display: 'flex' }}>
        <Icon name={m.icon} size={14} />
      </span>
      {m.label}
    </span>
  );
}

export const ORDER_STATUS: Record<OrderStatus, { label: string; color: string }> = {
  new: { label: 'Новый', color: 'var(--warning)' },
  assigned: { label: 'Назначен', color: 'var(--series-1)' },
  in_progress: { label: 'В работе', color: 'var(--maint)' },
  review: { label: 'Ждёт отзыва', color: 'var(--serious)' },
  closed: { label: 'Закрыт', color: 'var(--good)' },
};

export function OrderChip({ status }: { status: OrderStatus }) {
  const m = ORDER_STATUS[status];
  return (
    <span className="chip">
      <span className="swatch" style={{ background: m.color, marginRight: 0, width: 8, height: 8, borderRadius: 99 }} />
      {m.label}
    </span>
  );
}

export function Kpi({ label, value, sub, icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: IconName }) {
  return (
    <div className="kpi">
      <div className="kpi-label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** Цвет риска — статусная шкала с порогами, всегда вместе с подписью-процентом */
export function riskColor(p: number) {
  if (p >= 0.8) return 'var(--critical)';
  if (p >= 0.5) return 'var(--serious)';
  if (p >= 0.25) return 'var(--warning)';
  return 'var(--good)';
}
