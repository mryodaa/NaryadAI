// Слова и числа по участкам — общие для «Панели» и 3D: один источник правды — снимок двойника.
// Здесь только то, что выводится из снимка; своей модели цеха у интерфейса нет.
import type { LucideIcon } from 'lucide-react';
import { AREA_BY_ID, BUFFERS, type AreaId, type AreaView, type BufferView, type LiveSnapshot, type Tone } from '@allur/contracts/ref';
import { AREA_STATUS, TONE_ICON } from '../lib/tones';
import { num1, pct0, pct1 } from '../lib/format';

/** Порядок потока производства: так участки идут и в «Панели», и в 3D */
export const FLOW: readonly AreaId[] = ['warehouse', 'weld', 'paint', 'assembly', 'qc', 'finished'];

/** Запаса меньше двух смен — дефицит (то же правило, что у инцидента по складу) */
const STOCK_LOW_SHIFTS = 2;

export interface StatusView {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export interface TextView {
  text: string;
  tone: Tone;
}

export interface AreaRowView {
  id: AreaId;
  name: string;
  status: StatusView;
  /** Выпуск за смену и план к этому моменту; у склада комплектующих нет */
  output: { done: number; plan: number } | null;
  /** Главный показатель участка: брак окраски, запас склада, загрузка остальных */
  metric: TextView | null;
  /** Одна строка: причина отклонения или что происходит */
  reason: TextView | null;
}

const ROW_NAME: Record<AreaId, string> = {
  warehouse: AREA_BY_ID.warehouse.name,
  weld: AREA_BY_ID.weld.name,
  paint: AREA_BY_ID.paint.name,
  assembly: AREA_BY_ID.assembly.name,
  qc: AREA_BY_ID.qc.short,
  finished: AREA_BY_ID.finished.name,
};

function stockLow(a: AreaView): boolean {
  return !!a.worstKit && a.worstKit.shiftsLeft < STOCK_LOW_SHIFTS;
}

/** У складов нет такта: их статус — запас и приёмка, как на карточках потока */
export function areaStatus(a: AreaView): StatusView {
  if (a.id === 'warehouse') {
    return stockLow(a) ? { label: 'Есть дефицит', tone: 'attention', icon: TONE_ICON.attention } : { label: 'Запас в норме', tone: 'neutral', icon: TONE_ICON.neutral };
  }
  if (a.id === 'finished') return { label: 'Принимает', tone: 'neutral', icon: TONE_ICON.neutral };
  return AREA_STATUS[a.status];
}

/**
 * Загрузка участка за смену — доля времени без остановок (как «Загрузка, %» в отчёте «Работа линий»).
 * Считается по тем же отрезкам простоя, что рисует лента смены; отрезки брака (не остановки) не входят.
 */
export function areaLoad(s: LiveSnapshot, area: AreaId): number | null {
  if (!s.shift) return null;
  const start = Date.parse(s.shift.startsAt);
  const now = Math.min(Date.parse(s.now), Date.parse(s.shift.endsAt));
  const elapsed = now - start;
  if (elapsed < 10 * 60_000) return null;
  const stops = s.timeline.segments
    .filter((g) => g.area === area && g.tone !== 'attention')
    .map((g) => [Math.max(start, Date.parse(g.from)), Math.min(now, g.to ? Date.parse(g.to) : now)] as const)
    .filter(([from, to]) => to > from)
    .sort((x, y) => x[0] - y[0]);
  let stopped = 0;
  let curFrom = -1;
  let curTo = -1;
  for (const [from, to] of stops) {
    if (from > curTo) {
      if (curTo > curFrom) stopped += curTo - curFrom;
      curFrom = from;
      curTo = to;
    } else curTo = Math.max(curTo, to);
  }
  if (curTo > curFrom) stopped += curTo - curFrom;
  return Math.max(0, Math.min(1, 1 - stopped / elapsed));
}

/** Доля брака окраски за смену: если окраска — худший участок, берём то же число, что в плитке «Брак за смену» */
export function paintDefectLive(s: LiveSnapshot): number | null {
  const worst = s.kpi.defects.worst;
  return worst && worst.area === 'paint' ? worst.pct : null;
}

function areaMetric(s: LiveSnapshot, a: AreaView, paintDefect: number | null): TextView | null {
  switch (a.id) {
    case 'warehouse':
      return a.worstKit ? { text: `запас на ${num1(a.worstKit.shiftsLeft)} смены · ${a.worstKit.name}`, tone: stockLow(a) ? 'attention' : 'neutral' } : null;
    case 'paint': {
      if (paintDefect === null) return null;
      const norm = s.kpi.defects.norm;
      return { text: `брак ${pct1(paintDefect)} · норма ${pct0(norm)}`, tone: paintDefect > norm ? 'attention' : 'neutral' };
    }
    case 'finished':
      return null;
    default: {
      const load = areaLoad(s, a.id);
      return load === null ? null : { text: `загрузка ${pct0(load)}`, tone: 'neutral' };
    }
  }
}

function areaReason(s: LiveSnapshot, a: AreaView, status: StatusView): TextView | null {
  if (a.reason) return { text: a.reason, tone: status.tone };
  // нет отклонения статуса, но есть инцидент участка в «Требует внимания» — показываем его же словами
  const item = s.attention.find((i) => i.area === a.id);
  if (!item) return null;
  const decided = item.tone === 'neutral';
  return { text: decided || a.id === 'warehouse' ? item.impact : item.title, tone: item.tone };
}

export function areaRows(s: LiveSnapshot, paintDefect: number | null): AreaRowView[] {
  const byId = new Map(s.areas.map((a) => [a.id, a]));
  return FLOW.flatMap((id) => {
    const a = byId.get(id);
    if (!a) return [];
    const status = areaStatus(a);
    return [
      {
        id,
        name: ROW_NAME[id],
        status,
        output: id === 'warehouse' ? null : { done: a.done, plan: a.planToNow },
        metric: areaMetric(s, a, paintDefect),
        reason: areaReason(s, a, status),
      },
    ];
  });
}

/** Буфер сразу после участка по потоку (между складом и сваркой, ОТК и складом ГП буферов нет) */
export function bufferAfter(s: LiveSnapshot, area: AreaId): BufferView | null {
  const def = BUFFERS.find((b) => b.from === area);
  return def ? (s.buffers.find((b) => b.id === def.id) ?? null) : null;
}
