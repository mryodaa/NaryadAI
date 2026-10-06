// Связка шлюза с ядром двойника. Ядро (twin-core) — чистая логика без сети;
// шлюз кормит его событиями и тиками часов, забирает снимки и выдаёт решения нарядами.
import { Twin, NO_LEVERS, type Levers, type MoneyParams } from '@allur/twin-core';
import type { CanonicalEvent, LiveSnapshot, WorkOrder } from '@allur/contracts';
import type { Db } from './db';
import type { DemoClock } from './clock';

export interface DecisionOutcome {
  ok: boolean;
  error?: string;
  workOrder?: WorkOrder;
  summary?: string;
  forecastBefore?: number;
  forecastAfter?: number;
}

export class TwinService {
  readonly twin: Twin;

  constructor(
    private db: Db,
    private clock: DemoClock,
  ) {
    this.twin = new Twin();
    const money = db.getSetting<Partial<MoneyParams>>('money');
    if (money) this.twin.setMoney(money);
    this.reset(clock.runStartMs);
  }

  ingest(e: CanonicalEvent) {
    this.twin.ingest(e);
  }

  tick(now: number) {
    this.twin.tick(now);
  }

  /** Сброс: двойник забывает прогон и заново читает историю (начальную загрузку из 1С и импорт) */
  reset(runStartMs: number) {
    this.twin.reset(runStartMs);
    for (const e of this.db.iterateEvents('run_id = 0')) this.twin.ingest(e);
    for (const e of this.db.iterateEvents('run_id = ?', [this.clock.runId])) this.twin.ingest(e);
  }

  snapshot(now: number): LiveSnapshot | null {
    if (!this.twin.ready) return null;
    const c = this.clock;
    return this.twin.snapshot(now, { runId: c.runId, stage: c.stage, speed: c.speed, paused: c.paused, scenario: c.scenario });
  }

  incidents() {
    return this.twin.incidents();
  }

  incident(id: string) {
    return this.twin.incident(id);
  }

  forecast(now: number, levers: Levers = NO_LEVERS) {
    if (!this.twin.ready) return null;
    return this.twin.forecast(now, levers);
  }

  areaDetail(area: Parameters<Twin['areaDetail']>[0], now: number) {
    return this.twin.areaDetail(area, now);
  }

  equipment(now: number) {
    return this.twin.equipmentOverview(now);
  }

  decide(incidentId: string, optionId: string, decidedBy: string | undefined, now: number): DecisionOutcome {
    return this.twin.decide(incidentId, optionId, decidedBy, now);
  }

  checks() {
    return this.twin.checks();
  }

  passport(vin: string, events: CanonicalEvent[], now: number) {
    return this.twin.passport(vin, events, now);
  }

  quality(now: number) {
    return this.twin.qualityOverview(now);
  }

  get money(): MoneyParams {
    return this.twin.cfg.money;
  }

  setMoney(m: Partial<MoneyParams>) {
    this.twin.setMoney(m);
    this.db.setSetting('money', this.twin.cfg.money);
  }
}
