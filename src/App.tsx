import { useCallback, useEffect, useRef, useState } from 'react';
import { SimProvider, useSim } from './store';
import { Ui, type TabId, type UiCtx } from './uiContext';
import { applyScenario, type ScenarioId } from './sim/engine';
import type { StationId } from './sim/types';
import { clock } from './lib/format';
import { Icon, type IconName } from './components/ui';
import { WhatIfModal } from './components/WhatIfModal';
import { ShopView } from './views/ShopView';
import { DirectorView } from './views/DirectorView';
import { MechanicView } from './views/MechanicView';
import { JournalView } from './views/JournalView';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'shop', label: 'Цех', icon: 'factory' },
  { id: 'director', label: 'Директор', icon: 'chart' },
  { id: 'mechanic', label: 'Механик', icon: 'phone' },
  { id: 'journal', label: 'Журналы', icon: 'doc' },
];

const SCENARIOS: { id: ScenarioId; title: string; text: string; watch: string; tab: TabId; station: StationId; equip?: string }[] = [
  {
    id: 'press',
    title: 'Износ подшипника пресса П-2',
    text: 'Вибрация начнёт расти — классический предотказ.',
    watch: 'Включите слой «Риск ИИ». Через ~40 мин модельного времени ИИ поднимет тревогу и выпишет наряд, а «Сравнить решения» покажет цену каждого варианта.',
    tab: 'shop',
    station: 'press',
    equip: 'P-2',
  },
  {
    id: 'supply',
    title: 'Задержка поставки комплектующих',
    text: 'Запас на складе ~55 мин, фура опаздывает на 2,5 ч.',
    watch: 'Двойник посчитает, когда встанет сборка и во сколько это обойдётся. Запросите экстренную поставку прямо из инцидента.',
    tab: 'shop',
    station: 'assembly',
  },
  {
    id: 'paint',
    title: 'Дрейф качества окраски',
    text: 'Влажность в камере K-1 растёт, брак ЛКП увеличивается.',
    watch: 'Следите за KPI «Брак на ОТК». ИИ найдёт источник дефектов и выпишет наряд на камеру K-1.',
    tab: 'shop',
    station: 'paint',
    equip: 'K-1',
  },
  {
    id: 'failure',
    title: 'Внезапный отказ робота R-14',
    text: 'Аварийная остановка сварки на ~55 мин.',
    watch: 'Смотрите, как расходуется буфер перед окраской, смещается узкое место и создаётся аварийный наряд.',
    tab: 'shop',
    station: 'weld',
    equip: 'R-14',
  },
];

const SPEEDS = [
  { v: 0, label: 'Пауза' },
  { v: 1, label: '1×' },
  { v: 5, label: '5×' },
  { v: 20, label: '20×' },
  { v: 60, label: '60×' },
];

interface Toast {
  id: number;
  title: string;
  text: string;
}

function Shell() {
  const { s, speed, setSpeed, dispatch, reset, setOffset } = useSim();
  const [tab, setTab] = useState<TabId>('shop');
  const [selectedStation, setSelectedStation] = useState<StationId | null>(null);
  const [selectedEquip, setSelectedEquip] = useState<string | null>(null);
  const [whatIfEquip, setWhatIfEquip] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const toast = useCallback((title: string, text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, title, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const ui: UiCtx = {
    openWhatIf: (id) => {
      setOffset(0);
      setWhatIfEquip(id);
    },
    toast,
    focusStation: (id, equipId) => {
      setSelectedStation(id);
      setSelectedEquip(equipId ?? null);
      setTab('shop');
    },
    selectedStation,
    selectedEquip,
    setSelectedEquip,
    goto: setTab,
  };

  const activeIncidents = s.incidents.filter((i) => i.resolvedAt === null && i.sev !== 'info').length;
  const myOrders = s.orders.filter((o) => o.status === 'new' || o.status === 'assigned' || o.status === 'review').length;

  return (
    <Ui.Provider value={ui}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 18V6l12 12V6" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="brand-name">NaryadAI</div>
            <div className="brand-sub">Цифровой двойник завода</div>
          </div>
        </div>
        <nav className="tabs" aria-label="Роли">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={15} />
              {t.label}
              {t.id === 'shop' && activeIncidents > 0 && <span className="count">{activeIncidents}</span>}
              {t.id === 'mechanic' && myOrders > 0 && <span className="count" style={{ background: 'var(--series-1)' }}>{myOrders}</span>}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="demo-badge">демо · данные генерирует симулятор</span>
          <div className="clock">
            <span className="clock-time">{clock(s.t)}</span>
            <span className="clock-sub">смена {s.shift.index + 1} · модельное время</span>
          </div>
          <div className="seg" aria-label="Скорость симуляции">
            {SPEEDS.map((x) => (
              <button key={x.v} className={speed === x.v ? 'on' : ''} onClick={() => setSpeed(x.v)} title={x.v ? `${x.v} мин модельного времени в секунду` : 'Пауза'}>
                {x.v === 0 ? <Icon name="pause" size={13} /> : x.label}
              </button>
            ))}
          </div>
          <div className="menu-wrap" ref={menuRef}>
            <button className="btn primary" onClick={() => setMenu(!menu)} aria-expanded={menu}>
              <Icon name="flask" size={14} /> Сценарии
            </button>
            {menu && (
              <div className="menu" role="menu">
                {SCENARIOS.map((sc) => (
                  <button
                    key={sc.id}
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      dispatch((x) => applyScenario(x, sc.id));
                      setOffset(0);
                      if (speed === 0) setSpeed(5);
                      setMenu(false);
                      setTab(sc.tab);
                      setSelectedStation(sc.station);
                      setSelectedEquip(sc.equip ?? null);
                      toast(`Сценарий: ${sc.title}`, sc.watch);
                    }}
                  >
                    <b>{sc.title}</b>
                    <span>{sc.text}</span>
                  </button>
                ))}
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  role="menuitem"
                  onClick={() => {
                    reset();
                    setMenu(false);
                    setSelectedStation(null);
                    setSelectedEquip(null);
                    toast('Симуляция перезапущена', 'Завод вернулся в исходное состояние, 10:30 первой смены.');
                  }}
                >
                  <b>Сбросить всё</b>
                  <span>Вернуть завод в исходное состояние</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="page">
        {tab === 'shop' && <ShopView />}
        {tab === 'director' && <DirectorView />}
        {tab === 'mechanic' && <MechanicView />}
        {tab === 'journal' && <JournalView />}
      </main>

      {whatIfEquip && <WhatIfModal equipId={whatIfEquip} onClose={() => setWhatIfEquip(null)} onDone={toast} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <b>{t.title}</b>
            <span className="secondary">{t.text}</span>
          </div>
        ))}
      </div>
    </Ui.Provider>
  );
}

export default function App() {
  return (
    <SimProvider>
      <Shell />
    </SimProvider>
  );
}
