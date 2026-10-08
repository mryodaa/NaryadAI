// Слова и числа по участкам — общие для «Панели» и 3D: один источник правды — снимок двойника,
// состав цеха — конфигурация завода. Своей модели цеха у интерфейса нет.
import type { LucideIcon } from 'lucide-react';
import type { AreaId, AreaView, BufferView, LiveSnapshot, PlantModel, PlantStage, StageKind, Tone } from '@allur/contracts/ref';
import { AREA_STATUS, TONE_ICON } from '../lib/tones';
import { num1, pct0, pct1 } from '../lib/format';

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
  kind: StageKind;
  name: string;
  status: StatusView;
  /** Выпуск за смену и план к этому моменту; у склада комплектующих нет */
  output: { done: number; plan: number } | null;
  /** Главный показатель участка: брак окраски, запас склада, загрузка остальных */
  metric: TextView | null;
  /** Одна строка: причина отклонения или что происходит */
  reason: TextView | null;
  /** Отклонение пока только по сигналу: signal — один источник, probable — два, на месте не проверено */
  check?: 'signal' | 'probable';
}

/** Название строки участка: у ОТК — короткое, у остальных — полное */
export function rowName(stage: PlantStage): string {
  return stage.kind === 'inspection' ? stage.short : stage.name;
}

function stockLow(a: AreaView): boolean {
  return !!a.worstKit && a.worstKit.shiftsLeft < STOCK_LOW_SHIFTS;
}

/** У складов нет такта: их статус — запас и приёмка, как на карточках потока */
export function areaStatus(a: AreaView, kind: StageKind): StatusView {
  if (kind === 'warehouse_in') {
    return stockLow(a) ? { label: 'Есть дефицит', tone: 'attention', icon: TONE_ICON.attention } : { label: 'Запас в норме', tone: 'neutral', icon: TONE_ICON.neutral };
  }
  if (kind === 'warehouse_out') return { label: 'Принимает', tone: 'neutral', icon: TONE_ICON.neutral };
  return AREA_STATUS[a.status];
}

/**
 * Загрузка участка за смену — доля времени без остановок (как «Загрузка, %» в отчёте «Работа линий»).
 * Считается по тем же отрезкам простоя, что рисует лента смены; отрезки брака (не остановки) и остановки
 * одной из параллельных станций (участок работает) не входят.
 */
export function areaLoad(s: LiveSnapshot, area: AreaId): number | null {
  if (!s.shift) return null;
  const start = Date.parse(s.shift.startsAt);
  const now = Math.min(Date.parse(s.now), Date.parse(s.shift.endsAt));
  const elapsed = now - start;
  if (elapsed < 10 * 60_000) return null;
  const stops = s.timeline.segments
    .filter((g) => g.area === area && g.tone !== 'attention' && !g.label.endsWith('(остальные станции работают)'))
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

/** Участок окраски, по которому показываем брак (первый участок вида «окраска») */
export function paintStageId(model: PlantModel): AreaId | null {
  return model.stages.find((st) => st.kind === 'painting')?.id ?? null;
}

/** Доля брака окраски за смену: если окраска — худший участок, берём то же число, что в плитке «Брак за смену» */
export function paintDefectLive(s: LiveSnapshot, paintId: AreaId | null): number | null {
  const worst = s.kpi.defects.worst;
  return worst && paintId && worst.area === paintId ? worst.pct : null;
}

function areaMetric(s: LiveSnapshot, a: AreaView, kind: StageKind, isPaint: boolean, paintDefect: number | null): TextView | null {
  switch (kind) {
    case 'warehouse_in':
      return a.worstKit ? { text: `запас на ${num1(a.worstKit.shiftsLeft)} смены · ${a.worstKit.name}`, tone: stockLow(a) ? 'attention' : 'neutral' } : null;
    case 'warehouse_out':
      return null;
    default: {
      if (isPaint) {
        if (paintDefect === null) return null;
        const norm = s.kpi.defects.norm;
        return { text: `брак ${pct1(paintDefect)} · норма ${pct0(norm)}`, tone: paintDefect > norm ? 'attention' : 'neutral' };
      }
      const load = areaLoad(s, a.id);
      return load === null ? null : { text: `загрузка ${pct0(load)}`, tone: 'neutral' };
    }
  }
}

function areaReason(s: LiveSnapshot, a: AreaView, kind: StageKind, status: StatusView): TextView | null {
  if (a.reason) return { text: a.reason, tone: status.tone };
  // нет отклонения статуса, но есть инцидент участка в «Требует внимания» — показываем его же словами
  const item = s.attention.find((i) => i.area === a.id);
  if (!item) return null;
  const decided = item.tone === 'neutral';
  return { text: decided || kind === 'warehouse_in' ? item.impact : item.title, tone: item.tone };
}

/** Строки участков по потоку — порядок и названия из конфигурации завода */
export function areaRows(s: LiveSnapshot, paintDefect: number | null, model: PlantModel): AreaRowView[] {
  const byId = new Map(s.areas.map((a) => [a.id, a]));
  const paintId = paintStageId(model);
  return model.stages.flatMap((stage) => {
    const a = byId.get(stage.id);
    if (!a) return [];
    const status = areaStatus(a, stage.kind);
    return [
      {
        id: stage.id,
        kind: stage.kind,
        name: rowName(stage),
        status,
        output: stage.kind === 'warehouse_in' ? null : { done: a.done, plan: a.planToNow },
        metric: areaMetric(s, a, stage.kind, stage.id === paintId, paintDefect),
        reason: areaReason(s, a, stage.kind, status),
        check: a.check,
      },
    ];
  });
}

/** Буфер сразу после участка по потоку (между складом и сваркой, ОТК и складом ГП буферов нет) */
export function bufferAfter(s: LiveSnapshot, area: AreaId, model: PlantModel): BufferView | null {
  const id = model.stageById.get(area)?.bufferAfter?.id;
  return id ? (s.buffers.find((b) => b.id === id) ?? null) : null;
}
