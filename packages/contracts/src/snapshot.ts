// Снимок двойника для интерфейса (WebSocket /ws и GET /api/v1/state).
import type { AreaId, BufferId, SourceId } from './plant';
import type { ScenarioId, Stage } from './scenarios';

export type AreaStatus = 'running' | 'starved' | 'blocked' | 'fault' | 'degraded_quality' | 'maintenance' | 'idle';

/** Тон отклонения: от него зависят цвет, иконка и слово */
export type Tone = 'neutral' | 'waiting' | 'attention' | 'fault' | 'maintenance';

export interface ExplainInput {
  label: string;
  value: string;
  source?: SourceId;
  at?: string;
}

/** Ответ на «Почему?»: сигнал → причина → норма → вывод, с источниками */
export interface Explain {
  rule: string;
  inputs: ExplainInput[];
  sources: SourceId[];
  conclusion: string;
  assumptions?: string[];
}

export interface MonthPlanKpi {
  month: string;
  target: number;
  produced: number;
  forecast: number;
  p10: number;
  p90: number;
  /** forecast − target */
  gap: number;
  onTrack: boolean;
  mainCause: string | null;
  explain?: Explain;
}

export interface ShiftOutputKpi {
  done: number;
  plan: number;
  planToNow: number;
}

export interface OeeKpi {
  value: number;
  norm: number;
  availability: number;
  performance: number;
  quality: number;
}

export interface DefectsKpi {
  pct: number;
  norm: number;
  defects: number;
  inspected: number;
  /** Участок с наибольшей долей брака за смену */
  worst?: { area: AreaId; pct: number } | null;
}

export interface AreaView {
  id: AreaId;
  status: AreaStatus;
  /** За смену: сделано и план к этому моменту */
  done: number;
  planToNow: number;
  /** Одна строка причины, если есть отклонение */
  reason: string | null;
  /** Только склад комплектующих */
  stockShifts?: number;
  worstKit?: { name: string; shiftsLeft: number } | null;
}

export interface BufferView {
  id: BufferId;
  count: number;
  capacity: number;
}

export interface AttentionItem {
  incidentId: string;
  tone: Tone;
  title: string;
  impact: string;
  area: AreaId;
  openedAt: string;
  /** Появился недавно — мягкая подсветка */
  fresh: boolean;
}

export interface TimelineSegment {
  area: AreaId;
  from: string;
  /** null — продолжается */
  to: string | null;
  tone: Tone;
  label: string;
  /** Микропростой: рисуется тоньше и бледнее */
  minor?: boolean;
}

export interface TimelineMark {
  area: AreaId;
  at: string;
  tone: Tone;
  label: string;
  incidentId?: string;
}

export interface ShiftView {
  key: string;
  date: string;
  index: 1 | 2;
  startsAt: string;
  endsAt: string;
  elapsedMin: number;
}

export interface LiveSnapshot {
  ready: boolean;
  now: string;
  runId: number;
  stage: Stage;
  speed: number;
  paused: boolean;
  scenario: ScenarioId;
  /** null — нерабочее время */
  shift: ShiftView | null;
  nextShiftStartsAt: string | null;
  kpi: {
    monthPlan: MonthPlanKpi;
    shiftOutput: ShiftOutputKpi;
    oee: OeeKpi;
    defects: DefectsKpi;
  };
  areas: AreaView[];
  buffers: BufferView[];
  attention: AttentionItem[];
  attentionTotal: number;
  timeline: { segments: TimelineSegment[]; marks: TimelineMark[] };
  /** Честное пояснение о неполноте данных на текущей ступени */
  dataNote: string | null;
}

/** Строка живой ленты входящих сообщений (экран «Источники данных») */
export interface FeedItem {
  id: number;
  receivedAt: string;
  source: SourceId | 'unknown';
  channel: string;
  summary: string;
  ok: boolean;
  duplicate?: boolean;
}

export interface SourceStatus {
  id: SourceId;
  connected: boolean;
  expected: boolean;
  lastMessageAt: string | null;
  perMinute: number;
  errorsLastHour: number;
  clients: number;
}

/** Сообщения WebSocket от шлюза к интерфейсу */
export type ServerMessage =
  | { t: 'snapshot'; data: LiveSnapshot }
  | { t: 'feed'; items: FeedItem[] }
  | { t: 'sources'; items: SourceStatus[] }
  | { t: 'booting'; message: string };
