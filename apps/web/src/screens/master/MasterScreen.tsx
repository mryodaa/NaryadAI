// Рабочее место мастера на телефоне: три вкладки внизу — «Сейчас», «Журнал», «Смена» — и одно окно записи.
// Одна рука, перчатки: кнопки от 56 px, текст 18 px, тёмная тема. Участок выбирается один раз.
// Главное правило: у мастера не прибавляется работы — обязательна только причина простоя.
import { useEffect, useState } from 'react';
import { Bell, ClipboardList, Gauge, MapPin } from 'lucide-react';
import type { AreaId, LogEntry } from '@allur/contracts/ref';
import { useLive } from '../../state/live';
import { usePlant, usePlantModel } from '../../state/plant';
import { useTranslation } from '../../i18n/store';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { timeHM } from '../../lib/format';
import { cx } from '../../lib/tones';
import { NowTab } from './NowTab';
import { LogTab, needsReason } from './LogTab';
import { ShiftTab } from './ShiftTab';
import { EntrySheet } from './EntrySheet';
import { areaShort } from './crewText';

type Tab = 'now' | 'log' | 'shift';
const AREA_KEY = 'master-area';

function loadArea(): AreaId | null {
  const production = usePlant.getState().model.production;
  try {
    const v = localStorage.getItem(AREA_KEY);
    if (v && production.some((a) => a.id === v)) return v as AreaId;
  } catch {
    /* хранилище недоступно — спросим участок */
  }
  return null;
}

/** Тёмная тема — только на телефоне мастера */
function useDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = 'dark';
    return () => {
      if (prev) root.dataset.theme = prev;
      else delete root.dataset.theme;
    };
  }, []);
}

export function MasterScreen() {
  useDarkTheme();
  const { t, lang } = useTranslation();
  const model = usePlantModel();
  const [area, setArea] = useState<AreaId | null>(loadArea);
  const [tab, setTab] = useState<Tab>('now');
  const [sheet, setSheet] = useState<{ entryId: string | null; initial: LogEntry | null } | null>(null);
  const snapshot = useLive((s) => s.snapshot);
  const crew = useLive((s) => s.crew);

  const pick = (id: AreaId | null) => {
    try {
      if (id) localStorage.setItem(AREA_KEY, id);
      else localStorage.removeItem(AREA_KEY);
    } catch {
      /* не страшно — спросим ещё раз */
    }
    setArea(id);
    setTab('now');
  };

  if (!area || !model.stageById.has(area)) return <AreaSetup onPick={pick} />;

  const name = areaShort(model, t, area);
  const by = lang === 'kk'
    ? `«${name}» учаскесінің шебері`
    : lang === 'en'
    ? `Foreman of "${name}" area`
    : `Мастер участка «${model.stageById.get(area)?.short ?? area}»`;
  const areaView = snapshot?.areas.find((a) => a.id === area) ?? null;
  const entries = (crew?.log ?? []).filter((e) => e.area === area);
  const openSignals =
    (crew?.signals ?? []).filter((s) => s.area === area && (s.status === 'open' || s.status === 'later')).length +
    (crew?.requests ?? []).filter((r) => r.area === area && (r.status === 'sent' || r.status === 'viewed')).length;
  const withoutReason = entries.filter(needsReason).length;
  const sheetEntry = sheet ? (sheet.entryId ? (entries.find((e) => e.entryId === sheet.entryId) ?? sheet.initial) : null) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-[30rem] flex-col bg-page text-ink">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-page/95 px-4 pb-2 pt-3 backdrop-blur">
        <button type="button" onClick={() => pick(null)} className="flex min-h-14 min-w-0 items-center gap-2 text-left" aria-label={t.crew.changeArea}>
          <MapPin className="size-6 shrink-0 text-ink-2" aria-hidden />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-xl font-semibold">{name}</span>
            <span className="block text-base text-ink-2">
              {snapshot?.shift ? t.crew.shiftLabel(snapshot.shift.index) : t.crew.noShift}
              {snapshot ? ` · ${timeHM(snapshot.now)}` : ''}
            </span>
          </span>
        </button>
        <LanguageSwitcher />
      </header>

      <main className="flex-1 px-4 pb-28 pt-2">
        {tab === 'now' && (
          <NowTab
            area={area}
            areaView={areaView}
            signals={crew?.signals ?? []}
            requests={crew?.requests ?? []}
            by={by}
            onOpenEntry={(e) => setSheet({ entryId: e.entryId, initial: e })}
          />
        )}
        {tab === 'log' && (
          <LogTab entries={entries} nowIso={snapshot?.now ?? null} onOpen={(e) => setSheet({ entryId: e.entryId, initial: e })} onAdd={() => setSheet({ entryId: null, initial: null })} />
        )}
        {tab === 'shift' && <ShiftTab area={area} nowIso={snapshot?.now ?? null} by={by} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface">
        <div className="mx-auto grid max-w-[30rem] grid-cols-3">
          <TabButton active={tab === 'now'} onClick={() => setTab('now')} icon={<Bell className="size-6" aria-hidden />} label={t.crew.tabNow} badge={openSignals} />
          <TabButton active={tab === 'log'} onClick={() => setTab('log')} icon={<ClipboardList className="size-6" aria-hidden />} label={t.crew.tabLog} badge={withoutReason} />
          <TabButton active={tab === 'shift'} onClick={() => setTab('shift')} icon={<Gauge className="size-6" aria-hidden />} label={t.crew.tabShift} />
        </div>
      </nav>

      {sheet && <EntrySheet key={sheet.entryId ?? 'new'} entry={sheetEntry} area={area} by={by} nowIso={snapshot?.now ?? null} onClose={() => setSheet(null)} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx('relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-base font-semibold', active ? 'text-accent-ink' : 'text-ink-2')}
    >
      {icon}
      {label}
      {!!badge && (
        <span className="num absolute right-[calc(50%-1.9rem)] top-1.5 min-w-6 rounded-full bg-st-attention px-1.5 text-sm font-bold leading-6 text-black">{badge}</span>
      )}
    </button>
  );
}

function AreaSetup({ onPick }: { onPick: (id: AreaId) => void }) {
  const { t } = useTranslation();
  const model = usePlantModel();
  return (
    <div className="mx-auto flex min-h-screen max-w-[30rem] flex-col bg-page px-4 pb-6 pt-4 text-ink">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.crew.setupTitle}</h1>
        <LanguageSwitcher />
      </header>
      <div className="grid grid-cols-2 gap-3">
        {model.production.map((s) => (
          <button key={s.id} type="button" onClick={() => onPick(s.id)} className="min-h-20 rounded-2xl bg-surface px-2 text-xl font-semibold ring-1 ring-line active:bg-surface-2">
            {areaShort(model, t, s.id)}
          </button>
        ))}
      </div>
      <p className="mt-4 text-center text-lg text-ink-2">{t.crew.setupNote}</p>
    </div>
  );
}
