import { useEffect, useState } from 'react';
import { useMinWidth } from '../lib/media';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Menu, Settings, X } from 'lucide-react';
import { timeHM, dateShort, weekday } from '../lib/format';
import { cx } from '../lib/tones';
import { CarSearch } from './CarSearch';
import { WatchBadge } from './Watch';
import { LanguageSwitcher } from './LanguageSwitcher';
import { CrewInbox } from './CrewInbox';
import { useEscLayer } from './overlay';
import { useTranslation } from '../i18n/store';

/**
 * В шапке меню, наблюдение, поиск, языки, часы и роль. Полные подписи — только там, где они помещаются:
 * меню — от 1800 px, поиск — от 2000 px, роль — от 2100 px; уже — короткие («Источники», «Руководитель»).
 * Название продукта рядом с логотипом — от 1700 px, полная дата у часов — от 1700 px.
 * Если меню всё равно не помещается, оно прокручивается, а правый блок остаётся на месте.
 * Уже 1024 px (планшет, телефон) меню, языки, роль и настройки — в выпадающей панели под кнопкой «Меню».
 */
function roleFor(path: string): 'manager' | 'master' | 'integrator' {
  if (path.startsWith('/master')) return 'master';
  if (path.startsWith('/sources')) return 'integrator';
  return 'manager';
}

export function AppHeader({ now, shiftIndex, speed }: { now: string | null; shiftIndex: 1 | 2 | null; speed: number }) {
  const { t, lang } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const desktop = useMinWidth(1024);
  const wide = useMinWidth(1800);
  const wideSearch = useMinWidth(2000);
  const wideRole = useMinWidth(2100);
  const wideClock = useMinWidth(1700);
  const [menuOpen, setMenuOpen] = useState(false);
  useEscLayer(() => setMenuOpen(false), menuOpen);
  // перешли на другой экран или расширили окно — панель меню закрывается
  useEffect(() => setMenuOpen(false), [location.pathname, desktop]);

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

  const roleSelect = (full: boolean) => (
    <>
      <label className="sr-only" htmlFor="role">
        {t.nav.roleLabel}
      </label>
      <select
        id="role"
        value={currentRoleId}
        onChange={(e) => navigate(ROLES.find((r) => r.id === e.target.value)!.to)}
        title={`${t.nav.roleLabel}: ${role.label}`}
        className={cx(
          'rounded-xl border border-line-strong bg-surface px-2.5 text-base text-ink focus-visible:outline-2 focus-visible:outline-accent',
          full ? 'h-11 w-full' : 'h-9',
        )}
      >
        {ROLES.map((r) => (
          <option key={r.id} value={r.id} title={r.label}>
            {full || wideRole ? r.label : r.short}
          </option>
        ))}
      </select>
    </>
  );

  const settingsLink = (
    <NavLink
      to="/settings"
      title={t.nav.settingsTooltip}
      aria-label={t.nav.settingsTooltip}
      className={({ isActive }) => cx('grid size-9 place-items-center rounded-xl hover:bg-surface-2', isActive ? 'text-accent' : 'text-ink-2')}
    >
      <Settings className="size-5" />
    </NavLink>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur print:hidden">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4 min-[1500px]:gap-3 2xl:gap-5 2xl:px-6">
        <div className="flex shrink-0 items-center gap-2.5" title={`${t.nav.digitalTwin} · ${t.nav.locationSubtitle}`}>
          <img src="/favicon.svg" alt="" className="size-8" />
          <div className="hidden leading-tight min-[1700px]:block">
            <div className="font-semibold">{t.nav.digitalTwin}</div>
            <div className="text-sm text-ink-3">{t.nav.locationSubtitle}</div>
          </div>
        </div>

        {desktop && (
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
        )}

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2 2xl:gap-3">
          <CrewInbox />
          <WatchBadge wide={wide} />
          <CarSearch wide={wideSearch} />
          {desktop && <LanguageSwitcher compact={!wide} />}
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
          {desktop ? (
            <>
              {roleSelect(false)}
              {settingsLink}
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="app-menu"
              aria-label={t.nav.menu}
              title={t.nav.menu}
              className={cx('grid size-10 place-items-center rounded-xl hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent', menuOpen ? 'bg-surface-2 text-ink' : 'text-ink-2')}
            >
              {menuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
            </button>
          )}
        </div>
      </div>

      {!desktop && menuOpen && (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 top-14 z-30 cursor-default bg-ink/20" onClick={() => setMenuOpen(false)} />
          <div id="app-menu" className="view-in absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-line bg-surface px-3 pb-4 pt-2 shadow-pop sm:px-4">
            <nav className="flex flex-col" aria-label={t.nav.digitalTwin}>
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'flex min-h-12 items-center rounded-xl px-3 text-lg font-medium',
                      isActive ? 'bg-accent-bg text-accent-ink' : 'text-ink hover:bg-surface-2',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">{roleSelect(true)}</div>
                {settingsLink}
              </div>
              <LanguageSwitcher className="self-start" />
            </div>
          </div>
        </>
      )}
    </header>
  );
}
