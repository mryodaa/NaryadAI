// SQLite через встроенный node:sqlite: журнал событий (идемпотентность по eventId),
// ошибки валидации, решения, настройки. Живое состояние двойника — в памяти.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { CanonicalEvent, ValidationIssue } from '@allur/contracts';

export interface StoredEvent {
  seq: number;
  event: CanonicalEvent;
  receivedAt: number;
}

export interface ValidationErrorRow {
  id: number;
  receivedAt: number;
  source: string | null;
  channel: string;
  issues: ValidationIssue[];
  sample: string | null;
}

export class Db {
  readonly raw: DatabaseSync;
  private insertEvent: StatementSync;
  private insertError: StatementSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        run_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL,
        area TEXT NOT NULL,
        equipment_id TEXT,
        vin TEXT,
        body TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_vin ON events(vin) WHERE vin IS NOT NULL;
      CREATE INDEX IF NOT EXISTS events_type_ts ON events(type, ts);
      CREATE INDEX IF NOT EXISTS events_run ON events(run_id);
      CREATE TABLE IF NOT EXISTS validation_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        received_at INTEGER NOT NULL,
        source TEXT,
        channel TEXT NOT NULL,
        issues TEXT NOT NULL,
        sample TEXT
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        run_id INTEGER NOT NULL,
        incident_id TEXT NOT NULL,
        option_id TEXT NOT NULL,
        decided_at INTEGER NOT NULL,
        decided_by TEXT,
        work_order TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.insertEvent = this.raw.prepare(
      `INSERT OR IGNORE INTO events (event_id, run_id, source, type, ts, area, equipment_id, vin, body, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.insertError = this.raw.prepare(
      `INSERT INTO validation_errors (received_at, source, channel, issues, sample) VALUES (?, ?, ?, ?, ?)`,
    );
  }

  /** true — новое событие, false — дубль по eventId */
  addEvent(e: CanonicalEvent, runId: number, receivedAt: number): boolean {
    const r = this.insertEvent.run(
      e.eventId,
      runId,
      e.source,
      e.type,
      Date.parse(e.ts),
      e.area,
      e.equipmentId ?? null,
      e.vin ?? null,
      JSON.stringify(e),
      receivedAt,
    );
    return Number(r.changes) > 0;
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  addValidationError(receivedAt: number, source: string | null, channel: string, issues: ValidationIssue[], sample: string | null) {
    this.insertError.run(receivedAt, source, channel, JSON.stringify(issues), sample ? sample.slice(0, 2000) : null);
  }

  recentValidationErrors(limit = 20): ValidationErrorRow[] {
    const rows = this.raw
      .prepare(`SELECT id, received_at, source, channel, issues, sample FROM validation_errors ORDER BY id DESC LIMIT ?`)
      .all(limit) as { id: number; received_at: number; source: string | null; channel: string; issues: string; sample: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      receivedAt: r.received_at,
      source: r.source,
      channel: r.channel,
      issues: JSON.parse(r.issues) as ValidationIssue[],
      sample: r.sample,
    }));
  }

  eventsByVin(vin: string): CanonicalEvent[] {
    const rows = this.raw.prepare(`SELECT body FROM events WHERE vin = ? ORDER BY ts, seq`).all(vin) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as CanonicalEvent);
  }

  /** События по порядку поступления — для восстановления состояния двойника */
  *iterateEvents(where = '1=1', params: (string | number)[] = []): Generator<CanonicalEvent> {
    const stmt = this.raw.prepare(`SELECT body FROM events WHERE ${where} ORDER BY seq`);
    for (const row of stmt.iterate(...params) as Iterable<{ body: string }>) {
      yield JSON.parse(row.body) as CanonicalEvent;
    }
  }

  countEvents(where = '1=1', params: (string | number)[] = []): number {
    const r = this.raw.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${where}`).get(...params) as { n: number };
    return Number(r.n);
  }

  /** Сброс демонстрации: живые события уходят, история (run_id = 0) остаётся */
  clearLive() {
    this.raw.exec(`DELETE FROM events WHERE run_id <> 0; DELETE FROM decisions;`);
  }

  getSetting<T>(key: string): T | undefined {
    const r = this.raw.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown) {
    this.raw.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
  }

  addDecision(d: { id: string; runId: number; incidentId: string; optionId: string; decidedAt: number; decidedBy?: string; workOrder?: unknown }) {
    this.raw
      .prepare(`INSERT OR REPLACE INTO decisions (id, run_id, incident_id, option_id, decided_at, decided_by, work_order) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(d.id, d.runId, d.incidentId, d.optionId, d.decidedAt, d.decidedBy ?? null, d.workOrder ? JSON.stringify(d.workOrder) : null);
  }
}
