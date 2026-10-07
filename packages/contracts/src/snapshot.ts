// Снимок двойника для интерфейса (WebSocket /ws и GET /api/v1/state).
import type { AreaId, BufferId, SourceId } from './plant';
import type { ConnectionStatus } from './equipment-catalog';
import type { PlantConfig } from './plant-config';
import type { ScenarioId, Stage } from './scenarios';
import type { ModelId } from './plant';
import type { ColorFinish, IdMethod } from './identification';
import type { VisualEffect } from './operations';

/** reduced — встала одна из параллельных станций: участок работает, но мощность ниже */
export type AreaStatus = 'running' | 'reduced' | 'starved' | 'blocked' | 'fault' | 'degraded_quality' | 'maintenance' | 'idle';

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
  /** Версия конфигурации завода, по которой посчитан снимок */
  plantVersion: number;
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

/** Связь с оборудованием сейчас — считает шлюз по реальному потоку данных */
export interface ConnectionRuntime {
  equipmentId: string;
  status: ConnectionStatus;
  lastSeenAt: string | null;
  error: string | null;
  /** Почему подключение не активно: «ступень 0 — контроллеры не подключены» */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Кузова: где каждый, как выглядит, сколько времени на месте против нормы

export type BodyFlag = 'delayed' | 'nonconformity' | 'rework' | 'restored_checkpoint' | 'unknown_color';
export type BodyLocKind = 'warehouse' | 'buffer' | 'stage' | 'station' | 'finished';

export interface BodyColorView {
  code: string;
  name: string;
  hex: string;
  finish: ColorFinish;
}

export interface BodyLocation {
  kind: BodyLocKind;
  /** Участок (для буфера — участок, после которого кузов ждёт) */
  stageId: string;
  bufferId?: string;
  equipmentId?: string;
  postId?: string;
  /** station — место отмечено (RFID, ПЛК), stage — известен только участок */
  precision: 'station' | 'stage';
  /** Оборудование не отмечено, а оценено по норме времени */
  estimated: boolean;
}

export interface BodyView {
  bodyId: string;
  vin: string | null;
  model: ModelId;
  color: BodyColorView | null;
  loc: BodyLocation;
  /** С какого момента на текущем месте */
  since: string;
  /** С какого момента на текущем участке (вход участка); нет — очередь, склад */
  stageSince?: string | null;
  /** Норма на текущем месте, с (нет — очередь или склад) */
  normSec: number | null;
  /** Накопленные визуальные эффекты: вид кузова (при точности до участка — с оценкой по времени) */
  visual: VisualEffect[];
  flags: BodyFlag[];
  /** Порядок прихода на текущее место: очередь в буфере */
  order: number;
}

export type RouteStatus = 'waiting' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface BodyRouteStepView {
  operation: string;
  name: string;
  stageId: string;
  equipmentId: string | null;
  postId: string | null;
  status: RouteStatus;
  at: string | null;
  /** Чем подтверждено: событием операции, выходом со станции или участка, известно до начала отслеживания */
  by: 'operation' | 'station_out' | 'stage_exit' | 'assumed' | null;
  source: string | null;
  effect?: VisualEffect;
  optional: boolean;
  /** Номер прохода участка: 0 — первый, 1 — перекраска и т. д. */
  loop: number;
}

export interface BodyHistoryItem {
  at: string;
  kind: 'order' | 'checkpoint' | 'operation' | 'vin' | 'nonconformity' | 'restored' | 'rework' | 'duplicate';
  text: string;
  stageId?: string;
  checkpointId?: string;
  equipmentId?: string;
  method?: IdMethod | null;
  source: string;
  restored?: boolean;
}

/** Проход участка: вход и выход; повторный проход (перекраска) — отдельной записью с loop > 0 */
export interface BodyStagePass {
  stageId: string;
  loop: number;
  in: string | null;
  out: string | null;
}

export interface BodyDetail extends BodyView {
  plannedSeq: number | null;
  trim: string | null;
  /** Проходы участков по порядку: время входа и выхода */
  stages: BodyStagePass[];
  route: BodyRouteStepView[];
  history: BodyHistoryItem[];
}

/** Сообщения WebSocket от шлюза к интерфейсу */
export type ServerMessage =
  | { t: 'snapshot'; data: LiveSnapshot }
  | { t: 'feed'; items: FeedItem[] }
  | { t: 'sources'; items: SourceStatus[] }
  | { t: 'booting'; message: string }
  /** plant_config_changed: применена новая версия конфигурации завода (и при подключении) */
  | { t: 'plant'; config: PlantConfig }
  | { t: 'connections'; items: ConnectionRuntime[] }
  /** Кузова в цехе: раз в секунду */
  | { t: 'bodies'; at: string; items: BodyView[] };
