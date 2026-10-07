// Единая точка приёма: проверка схемой → журнал (дубли по eventId отсекаются) → двойник.
// Сюда сходятся REST (1С, мастер, импорт) и MQTT (контроллеры, камеры).
import {
  CanonicalEvent,
  SOURCE_IDS,
  bodyEventIssues,
  zodIssues,
  type CanonicalEvent as Event,
  type FeedItem,
  type IngestResult,
  type PlantModel,
  type SourceId,
  type ValidationIssue,
} from '@allur/contracts';
import type { Db } from './db';
import type { DemoClock } from './clock';
import type { SourceRegistry } from './sources';
import type { ConnectionMonitor } from './connections';

/**
 * Что переживает сброс демонстрации: начальная загрузка истории из 1С (eventId с префиксом hist:)
 * и импорт таблиц. Всё остальное относится к текущему прогону.
 */
function isPersistent(e: Event): boolean {
  return e.eventId.startsWith('hist:') || e.source === 'import';
}
const FEED_SIZE = 300;

export interface TwinSink {
  ingest(e: Event): void;
}

export class Hub {
  private feed: FeedItem[] = [];
  private pendingFeed: FeedItem[] = [];
  private feedSeq = 0;
  private sinks = new Set<TwinSink>();

  constructor(
    private db: Db,
    private clock: DemoClock,
    private sources: SourceRegistry,
    /** Текущий состав цеха: события по неизвестным участкам и оборудованию отклоняются */
    private plant: () => PlantModel,
    private connections: ConnectionMonitor,
  ) {}

  /** Участок и оборудование события есть в конфигурации завода (история — прошлое, её не проверяем) */
  private checkPlant(e: Event): ValidationIssue[] {
    if (e.eventId.startsWith('hist:')) return [];
    const plant = this.plant();
    const issues: ValidationIssue[] = [...bodyEventIssues(e)];
    if (e.type === 'body_checkpoint' && !plant.pointById.has(e.payload.checkpointId) && !plant.postById.has(e.payload.checkpointId)) {
      issues.push({ path: 'payload.checkpointId', message: `Точка отметки «${e.payload.checkpointId}» не найдена в конфигурации завода` });
    }
    if (!plant.stageById.has(e.area)) {
      issues.push({ path: 'area', message: `Участок «${e.area}» не найден в конфигурации завода (есть: ${plant.stages.map((s) => s.id).join(', ')})` });
    }
    if (e.equipmentId && !plant.equipmentById.has(e.equipmentId)) {
      issues.push({ path: 'equipmentId', message: `Оборудование «${e.equipmentId}» не найдено в конфигурации завода` });
    }
    return issues;
  }

  addSink(sink: TwinSink) {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  /** Сырые события (тело POST /events): каждое проверяется отдельно */
  ingestRaw(items: unknown[], channel: string): IngestResult {
    const result: IngestResult = { accepted: 0, duplicates: 0, rejected: [] };
    const valid: Event[] = [];
    items.forEach((item, index) => {
      const r = CanonicalEvent.safeParse(item);
      const plantIssues = r.success ? this.checkPlant(r.data) : [];
      if (r.success && !plantIssues.length) {
        valid.push(r.data);
      } else {
        const issues = r.success ? plantIssues : zodIssues(r.error);
        const eventId = typeof (item as { eventId?: unknown })?.eventId === 'string' ? (item as { eventId: string }).eventId : undefined;
        result.rejected.push({ index, eventId, issues });
        this.reject(channel, guessSource(item), issues, item);
      }
    });
    const r = this.ingest(valid, channel);
    result.accepted = r.accepted;
    result.duplicates = r.duplicates;
    return result;
  }

  /** Уже приведённые к канону события (REST-конвертеры, MQTT) */
  ingest(input: Event[], channel: string): IngestResult {
    const result: IngestResult = { accepted: 0, duplicates: 0, rejected: [] };
    const events: Event[] = [];
    input.forEach((e, index) => {
      const issues = this.checkPlant(e);
      if (!issues.length) return void events.push(e);
      result.rejected.push({ index, eventId: e.eventId, issues });
      this.reject(channel, e.source, issues, e);
    });
    if (events.length === 0) return result;
    const receivedAt = Date.now();
    const fresh: Event[] = [];
    this.db.transaction(() => {
      for (const e of events) {
        const runId = isPersistent(e) ? 0 : this.clock.runId;
        if (this.db.addEvent(e, runId, receivedAt)) fresh.push(e);
        else result.duplicates++;
      }
    });
    result.accepted = fresh.length;
    for (const e of fresh) {
      this.sources.message(e.source, receivedAt);
      if (e.equipmentId && e.source === 'plc') this.connections.seen(e.equipmentId, receivedAt);
      for (const sink of this.sinks) sink.ingest(e);
    }
    // В ленту — не больше 50 строк за раз, чтобы пакеты истории её не затопили
    for (const e of fresh.slice(-50)) this.pushFeed({ source: e.source, channel, summary: summarize(e), ok: true });
    if (result.duplicates > 0) {
      this.pushFeed({ source: events[0]!.source, channel, summary: `Повтор: ${result.duplicates} событ. уже были приняты (по eventId)`, ok: true, duplicate: true });
    }
    return result;
  }

  reject(channel: string, source: SourceId | null, issues: ValidationIssue[], raw: unknown) {
    const at = Date.now();
    const sample = typeof raw === 'string' ? raw : safeJson(raw);
    this.db.addValidationError(at, source, channel, issues, sample);
    this.sources.error(source, at);
    this.pushFeed({
      source: source ?? 'unknown',
      channel,
      summary: `Отклонено: ${issues
        .slice(0, 2)
        .map((i) => `${i.path} — ${i.message}`)
        .join('; ')}`,
      ok: false,
    });
  }

  private pushFeed(item: Omit<FeedItem, 'id' | 'receivedAt'>) {
    const full: FeedItem = { id: ++this.feedSeq, receivedAt: new Date().toISOString(), ...item };
    this.feed.push(full);
    if (this.feed.length > FEED_SIZE) this.feed.splice(0, this.feed.length - FEED_SIZE);
    this.pendingFeed.push(full);
  }

  recentFeed(limit = 100): FeedItem[] {
    return this.feed.slice(-limit);
  }

  /** Новые строки ленты с прошлого вызова — для рассылки по WebSocket */
  drainFeed(): FeedItem[] {
    const out = this.pendingFeed;
    this.pendingFeed = [];
    return out.slice(-100);
  }
}

function guessSource(item: unknown): SourceId | null {
  const s = (item as { source?: unknown })?.source;
  return typeof s === 'string' && (SOURCE_IDS as readonly string[]).includes(s) ? (s as SourceId) : null;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Короткая техническая строка для ленты входящих сообщений */
export function summarize(e: Event): string {
  switch (e.type) {
    case 'post_passed':
      return `post_passed ${e.vin} ${e.payload.model} → ${e.payload.post}`;
    case 'nonconformity':
      return `nonconformity ${e.vin ?? '(без VIN)'} ${e.payload.defect} → ${e.payload.decision}`;
    case 'downtime_registered':
      return `downtime_registered ${e.equipmentId} «${e.payload.reason}» c ${e.payload.from.slice(11, 16)}${e.payload.to ? ` до ${e.payload.to.slice(11, 16)}` : ''}`;
    case 'equipment_state':
      return `equipment_state ${e.equipmentId} ${e.payload.status}${e.payload.code ? ` код ${e.payload.code}` : ''}`;
    case 'equipment_counter':
      return `equipment_counter ${e.equipmentId} cycles=${e.payload.cycles}`;
    case 'telemetry':
      return `telemetry ${e.equipmentId} ${e.payload.metric}=${e.payload.value}`;
    case 'camera_detection':
      return `camera_detection ${e.payload.cameraId} ${e.payload.kind}${e.payload.value !== undefined ? `=${e.payload.value}` : ''}`;
    case 'stock_level':
      return `stock_level ${e.payload.kitId} qty=${e.payload.qty} (${e.payload.shiftsLeft} смен)`;
    case 'plan_set':
      return `plan_set ${e.payload.month} ${e.payload.models.map((m) => `${m.model}=${m.qty}`).join(' ')}`;
    case 'shift_report':
      return `shift_report ${e.payload.date} ${e.payload.line} ${e.payload.fact}/${e.payload.plan}`;
    case 'quality_summary':
      return `quality_summary ${e.payload.date} ${e.area} ${e.payload.defects}/${e.payload.produced}`;
    case 'production_order':
      return `production_order ${e.payload.bodyId} ${e.payload.model}${e.payload.colorCode ? ` цвет ${e.payload.colorCode}` : ''}`;
    case 'body_checkpoint':
      return `body_checkpoint ${e.payload.bodyId ?? e.vin} ${e.payload.checkpointId} ${e.payload.direction}${e.payload.postId ? ` ${e.payload.postId}` : ''}`;
    case 'operation_result':
      return `operation_result ${e.payload.bodyId ?? e.vin} ${e.equipmentId} ${e.payload.operation}=${e.payload.result}`;
    case 'vin_assigned':
      return `vin_assigned ${e.payload.bodyId} → ${e.vin}`;
  }
}
