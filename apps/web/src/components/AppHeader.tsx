import { NavLink, useLocation, useNavigate } from 'react-router';
import { Settings } from 'lucide-react';
import { timeHM, dateShort, weekday } from '../lib/format';
import { cx } from '../lib/tones';

const NAV = [
  { to: '/', label: 'Цех сейчас' },
  { to: '/plan', label: 'План' },
  { to: '/quality', label: 'Качество' },
  { to: '/equipment', label: 'Оборудование' },
  { to: '/sources', label: 'Источники данных' },
] as const;

const ROLES = [
  { id: 'manager', label: 'Руководитель производства', to: '/' },
  { id: 'master', label: 'Мастер участка', to: '/master' },
  { id: 'integrator', label: 'Интегратор / IT завода', to: '/sources' },
] as const;

function roleFor(path: string): (typeof ROLES)[number]['id'] {
  if (path.startsWith('/master')) return 'master';
  if (path.startsWith('/sources')) return 'integrator';
  return 'manager';
}

export function AppHeader({ now, shiftIndex, speed }: { now: string | null; shiftIndex: 1 | 2 | null; speed: number }) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="flex h-14 items-center gap-5 px-4 xl:px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div className="leading-tight">
            <div className="font-semibold">Цифровой двойник</div>
            <div className="text-sm text-ink-3">Allur · Костанай</div>
          </div>
        </div>

        <nav className="flex h-full items-stretch gap-0.5" aria-label="Главное меню">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx(
                  'relative flex items-center whitespace-nowrap px-3 text-base font-medium transition-colors',
                  isActive
                    ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t after:bg-accent'
                    : 'text-ink-2 hover:text-ink',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {now && (
            <div className="text-right leading-tight" title="Время двойника">
              <div className="num font-semibold">
                {weekday(now)}, {dateShort(now)} · {timeHM(now)}
              </div>
              <div className="text-sm text-ink-3">
                {shiftIndex ? `${shiftIndex} смена` : 'смена не идёт'}
                {speed !== 1 && ` · ускорено ×${speed}`}
              </div>
            </div>
          )}
          <label className="sr-only" htmlFor="role">
            Роль
          </label>
          <select
            id="role"
            value={roleFor(location.pathname)}
            onChange={(e) => navigate(ROLES.find((r) => r.id === e.target.value)!.to)}
            className="h-9 rounded-xl border border-line-strong bg-surface px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <NavLink
            to="/settings"
            title="Допущения и параметры"
            aria-label="Допущения и параметры"
            className={({ isActive }) =>
              cx('grid size-9 place-items-center rounded-xl hover:bg-surface-2', isActive ? 'text-accent' : 'text-ink-2')
            }
          >
            <Settings className="size-5" />
          </NavLink>
        </div>
      </div>
    </header>
  );
}
