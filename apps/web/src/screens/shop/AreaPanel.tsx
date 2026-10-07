// Панель участка: «Что с этим участком и почему?»
// В «Панели» — выезжающая справа панель; в 3D — плавающее окно сбоку (сцена не затемняется), его можно свернуть.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronUp, CirclePlay, Video, X } from 'lucide-react';
import type { AreaId } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { AreaDetail } from '../../api/types';
import { Drawer } from '../../components/overlay';
import { SourceBadge } from '../../components/SourceBadge';
import { StatusChip } from '../../components/ui';
import { AREA_STATUS, EQUIPMENT_STATUS, TONE_CLASS, cx } from '../../lib/tones';
import { num, num1, pct0, timeHM } from '../../lib/format';

export function AreaPanel({
  area,
  onClose,
  onIncident,
  floating,
  highlight,
}: {
  area: AreaId | null;
  onClose: () => void;
  onIncident: (id: string) => void;
  /** 3D: плавающее окно вместо выезжающей панели */
  floating?: boolean;
  /** Оборудование, по которому кликнули в 3D, — подсвечено в списке */
  highlight?: string | null;
}) {
  const q = useQuery({
    queryKey: ['area', area],
    queryFn: () => api<AreaDetail>(`/api/v1/areas/${area}`),
    enabled: !!area,
    refetchInterval: 3000,
  });
  const d = q.data;
  const meta = d ? AREA_STATUS[d.status] : null;
  const title = (
    <div className="flex flex-col gap-1.5">
      <div className="text-[1.375rem] font-semibold leading-tight">{d?.name ?? '…'}</div>
      {meta && <StatusChip tone={meta.tone} label={meta.label} icon={meta.icon} className="self-start" />}
    </div>
  );
  const body = !d ? <p className="text-ink-2">Загружаю…</p> : <AreaBody d={d} onIncident={onIncident} highlight={highlight ?? null} />;

  if (floating) {
    if (!area) return null;
    return (
      <FloatingWindow key={area} title={title} onClose={onClose} collapsedTitle={d ? `${d.name} · ${meta?.label ?? ''}` : '…'}>
        {body}
      </FloatingWindow>
    );
  }
  return (
    <Drawer open={!!area} onClose={onClose} title={title}>
      {body}
    </Drawer>
  );
}

/** Плавающее окно 3D-режима: не затемняет сцену, сворачивается в одну строку, закрывается по Esc */
function FloatingWindow({ title, collapsedTitle, onClose, children }: { title: ReactNode; collapsedTitle: string; onClose: () => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <aside data-esc-layer aria-label="Панель участка" className="view-in pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-page shadow-pop ring-1 ring-line">
      <header className="flex items-start justify-between gap-2 border-b border-line bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">{collapsed ? <div className="truncate text-lg font-semibold leading-tight">{collapsedTitle}</div> : title}</div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2"
          aria-label={collapsed ? 'Развернуть панель участка' : 'Свернуть панель участка'}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          {collapsed ? <ChevronDown className="size-5" /> : <ChevronUp className="size-5" />}
        </button>
        <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2" aria-label="Закрыть">
          <X className="size-5" />
        </button>
      </header>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>}
    </aside>
  );
}

function AreaBody({ d, onIncident, highlight }: { d: AreaDetail; onIncident: (id: string) => void; highlight: string | null }) {
  const lit = useRef<HTMLLIElement>(null);
  useEffect(() => {
    lit.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlight]);
  return (
    <div className="flex flex-col gap-5">
      <p className="text-lg leading-snug">{d.summary}</p>

      {d.signals.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Откуда мы это знаем</h3>
          <ul className="flex flex-col gap-2">
            {d.signals.map((s, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-xl bg-surface px-3 py-2 shadow-card">
                <SourceBadge source={s.source} compact />
                <span className="flex-1 leading-snug">{s.text}</span>
                <span className="num shrink-0 text-sm text-ink-3">{timeHM(s.ts)}</span>
              </li>
            ))}
          </ul>
          {!d.plcConnected && <p className="mt-2 text-sm text-ink-3">Данные с контроллеров не подключены — двойник оценивает состояние по 1С:MES.</p>}
        </section>
      )}

      {d.clip && (
        <section>
          <a href={d.clip.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white hover:bg-ink-2">
            <span className="grid size-10 place-items-center rounded-full bg-white/15">
              <CirclePlay className="size-6" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">Видео с поста, 30 сек</span>
              <span className="text-sm text-white/70">камера участка, {timeHM(d.clip.at)}</span>
            </span>
            <Video className="ml-auto size-5 text-white/60" />
          </a>
        </section>
      )}

      {d.stock && (
        <section>
          <h3 className="mb-2 font-semibold">Запас комплектов (1С:WMS)</h3>
          <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface shadow-card">
            {d.stock.map((s) => {
              const low = s.shiftsLeft !== null && s.shiftsLeft < 2;
              return (
                <li key={s.kitId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{s.name}</span>
                  <span className={cx('num font-semibold', low && 'text-st-attention-ink')}>{s.shiftsLeft === null ? '—' : `на ${num1(s.shiftsLeft)} смены`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {d.equipment.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Оборудование</h3>
          <ul className="flex flex-col divide-y divide-line rounded-xl bg-surface shadow-card">
            {d.equipment.map((e) => {
              const st = e.status ? EQUIPMENT_STATUS[e.status] : null;
              const on = e.id === highlight;
              return (
                <li key={e.id} ref={on ? lit : undefined} className={cx('flex flex-col gap-1.5 px-3 py-2.5', on && 'rounded-xl bg-accent-bg ring-2 ring-accent')}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{e.name}</span>
                    {st ? (
                      <span className={cx('text-sm font-semibold', st.tone === 'neutral' ? 'text-ink-3' : TONE_CLASS[st.tone].ink)}>
                        {st.label}
                        {e.code ? ` · код ${e.code}` : ''}
                      </span>
                    ) : (
                      <span className="text-sm text-ink-3">нет данных контроллера</span>
                    )}
                  </div>
                  {e.dp !== null && (
                    <div className="text-sm text-ink-2">
                      Перепад на фильтре: <span className={cx('num font-semibold', e.dp > 300 ? 'text-st-attention-ink' : 'text-ink')}>{num(e.dp)} Па</span> · норма до 250
                    </div>
                  )}
                  {e.resourceLeft !== null && (
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-line">
                        <div className={cx('h-2 rounded-full', e.resourceLeft < 0.1 ? 'bg-st-maintenance' : 'bg-st-neutral')} style={{ width: `${Math.max(2, e.resourceLeft * 100)}%` }} />
                      </div>
                      <span className="num w-[12rem] shrink-0 text-right text-sm text-ink-2">ресурс до ТО {pct0(e.resourceLeft)}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {d.chart.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">{d.chartKind === 'defects' ? 'Брак по часам смены, %' : 'Выпуск по часам смены'}</h3>
          <div className="h-48 rounded-xl bg-surface px-2 pb-1 pt-3 shadow-card">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.chart} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <XAxis dataKey="hour" tickLine={false} axisLine={{ stroke: 'var(--line)' }} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 13 }} allowDecimals={d.chartKind === 'defects'} />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  formatter={(v) => [d.chartKind === 'defects' ? `${num1(Number(v))}%` : `${v} машин`, d.chartKind === 'defects' ? 'Брак' : 'Выпуск']}
                  labelFormatter={(l) => `Час с ${l}`}
                />
                <Bar dataKey="value" fill={d.chartKind === 'defects' ? 'var(--st-attention)' : 'var(--st-neutral)'} radius={[4, 4, 0, 0]} maxBarSize={24} />
                <ReferenceLine
                  y={d.chart[0]!.norm}
                  stroke="var(--ink-2)"
                  strokeDasharray="5 4"
                  label={{ value: d.chartKind === 'defects' ? `норма ${num1(d.chart[0]!.norm)}%` : `норма ${d.chart[0]!.norm} в час`, position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 13 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {d.incidents.length > 0 && (
        <section>
          <h3 className="mb-2 font-semibold">Последние инциденты</h3>
          <ul className="flex flex-col gap-2">
            {d.incidents.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => onIncident(i.id)} className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 text-left shadow-card hover:bg-surface-2">
                  <span>{i.title}</span>
                  <span className="num shrink-0 text-sm text-ink-3">
                    {timeHM(i.openedAt)} · {i.status === 'resolved' ? 'закрыт' : i.status === 'decided' ? 'решение принято' : 'открыт'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
