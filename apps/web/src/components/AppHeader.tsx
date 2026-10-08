import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Settings } from 'lucide-react';
import { timeHM, dateShort, weekday } from '../lib/format';
import { cx } from '../lib/tones';
import { CarSearch } from './CarSearch';
import { WatchBadge } from './Watch';
import { LanguageSwitcher } from './LanguageSwitcher';
import { CrewInbox } from './CrewInbox';
import { useTranslation } from '../i18n/store';

/**
 * В шапке меню, наблюдение, поиск, языки, часы и роль. Полные подписи — только там, где они помещаются:
 * меню — от 1800 px, поиск — от 2000 px, роль — от 2100 px; уже — короткие («Источники», «Руководитель»).
 * Название продукта рядом с логотипом — от 1700 px, полная дата у часов — от 1700 px.
 * Если меню всё равно не помещается (узкий экран), оно прокручивается, а правый блок остаётся на месте.
 */
function useMinWidth(px: number): boolean {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => typeof matchMedia === 'undefined' || matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const h = () => setOk(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [q]);
  return ok;
}

function roleFor(path: string): 'manager' | 'master' | 'integrator' {
  if (path.startsWith('/master')) return 'master';
  if (path.startsWith('/sources')) return 'integrator';
  return 'manager';
}

export function AppHeader({ now, shiftIndex, speed }: { now: string | null; shiftIndex: 1 | 2 | null; speed: number }) {
  const { t, lang } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useMinWidth(1800);
  const wideSearch = useMinWidth(2000);
  const wideRole = useMinWidth(2100);
  const wideClock = useMinWidth(1700);

  const NAV = [
    { to: '/', label: t.nav.shopNow },
    { to: '/cars', label: t.nav.cars },
    { to: '/plan', label: t.nav.plan },
    { to: '/quality', label: t.nav.quality },
    { to: '/equipment', label: t.nav.equipment },
    { to: '/sources', label: t.nav.sources, short: t.nav.sourcesShort },
  ];

  const ROLES = [
    { id: 'manager', label: t.nav.roles.manager, short: t.nav.roles.managerShort, to: '/' },
    { id: 'master', label: t.nav.roles.master, short: t.nav.roles.masterShort, to: '/master' },
    { id: 'integrator', label: t.nav.roles.integrator, short: t.nav.roles.integratorShort, to: '/sources' },
  ] as const;

  const currentRoleId = roleFor(location.pathname);
  const role = ROLES.find((r) => r.id === currentRoleId) ?? ROLES[0];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur print:hidden">
      <div className="flex h-14 items-center gap-2 px-4 min-[1500px]:gap-3 2xl:gap-5 2xl:px-6">
        <div className="flex shrink-0 items-center gap-2.5" title={`${t.nav.digitalTwin} · ${t.nav.locationSubtitle}`}>
          <img src="/favicon.svg" alt="" className="size-8" />
          <div className="hidden leading-tight min-[1700px]:block">
            <div className="font-semibold">{t.nav.digitalTwin}</div>
            <div className="text-sm text-ink-3">{t.nav.locationSubtitle}</div>
          </div>
        </div>

        <nav className="flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]" aria-label={t.nav.digitalTwin}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx(
                  'relative flex items-center whitespace-nowrap px-2 text-base font-medium transition-colors min-[1500px]:px-2.5 2xl:px-3',
                  isActive
                    ? 'text-ink after:absolute after:inset-x-2 after:bottom-0 min-[1500px]:after:inset-x-2.5 2xl:after:inset-x-3 after:h-[3px] after:rounded-t after:bg-accent'
                    : 'text-ink-2 hover:text-ink',
                )
              }
            >
              {!wide && 'short' in item && item.short ? item.short : item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 2xl:gap-3">
          <CrewInbox />
          <WatchBadge wide={wide} />
          <CarSearch wide={wideSearch} />
          <LanguageSwitcher compact={!wide} />
          {now && (
            <div
              className="whitespace-nowrap text-right leading-tight"
              title={`${t.nav.twinTime}: ${weekday(now, lang)}, ${dateShort(now, lang)} · ${timeHM(now)}${speed !== 1 ? t.nav.accelerated(speed) : ''}`}
            >
              <div className="num font-semibold">
                {wideClock && `${weekday(now, lang)}, `}
                {dateShort(now, lang)} · {timeHM(now)}
              </div>
              <div className="text-sm text-ink-3">
                {shiftIndex ? t.nav.shiftNumber(shiftIndex) : t.nav.noShift}
                {speed !== 1 && (wideClock ? t.nav.accelerated(speed) : ` · ×${speed}`)}
              </div>
            </div>
          )}
          <label className="sr-only" htmlFor="role">
            {t.nav.roleLabel}
          </label>
          <select
            id="role"
            value={currentRoleId}
            onChange={(e) => navigate(ROLES.find((r) => r.id === e.target.value)!.to)}
            title={`${t.nav.roleLabel}: ${role.label}`}
            className="h-9 rounded-xl border border-line-strong bg-surface px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id} title={r.label}>
                {wideRole ? r.label : r.short}
              </option>
            ))}
          </select>
          <NavLink
            to="/settings"
            title={t.nav.settingsTooltip}
            aria-label={t.nav.settingsTooltip}
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
