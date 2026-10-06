// Имитаторы систем завода. Каждый видит физический цех со своей стороны и говорит со шлюзом
// на своём языке: 1С (MES, QLS, WMS) — пакетами событий по HTTP, контроллеры и камеры — по MQTT.
import {
  topics,
  toPlantIso,
  type AreaId,
  type CanonicalEvent,
  type Stage,
} from '@allur/contracts';
import { CAL, MIN } from './calibration';
import { Rng } from './rng';
import type { DowntimeInfo, World, WorldEvent } from './world';

export interface Outbox {
  /** 1С и мобильный ввод: POST /api/v1/events */
  http(event: CanonicalEvent): void;
  /** Контроллеры и камеры: MQTT */
  mqtt(source: 'plc' | 'camera', topic: string, payload: object, qos?: 0 | 1): void;
}

const MASTER_OF: Record<AreaId, string> = {
  warehouse: 'Кладовщик',
  weld: 'Мастер сварки',
  paint: 'Мастер окраски',
  assembly: 'Мастер сборки',
  qc: 'Мастер ОТК',
  finished: 'Кладовщик ГП',
};

const LINE_OF = { weld: 'Сварка-1', paint: 'Окраска-1', assembly: 'Сборка-1' } as const;

export class Adapters {
  private seq: Record<string, number> = {};
  private pendingMes: { at: number; event: CanonicalEvent }[] = [];
  private openRegs = new Map<string, { from: string; equipmentId: string; area: AreaId; reason: string; category: DowntimeInfo['category'] }>();
  private delays: Rng;

  constructor(
    private runId: number,
    seed: number,
    private out: Outbox,
    private stage: () => Stage,
  ) {
    this.delays = new Rng(seed ^ 0x5bd1e995);
  }

  private id(source: string): string {
    this.seq[source] = (this.seq[source] ?? 0) + 1;
    return `${source}-r${this.runId}-${this.seq[source]}`;
  }

  handle(e: WorldEvent) {
    const stage = this.stage();
    switch (e.kind) {
      case 'pass':
        this.out.http({
          eventId: this.id('mes'),
          source: 'mes',
          ts: toPlantIso(e.t),
          area: e.area,
          equipmentId: e.equipmentId,
          vin: e.vin,
          type: 'post_passed',
          payload: { model: e.model, post: e.post },
        });
        break;

      case 'defect':
        this.out.http({
          eventId: this.id('qls'),
          source: 'qls',
          ts: toPlantIso(e.t),
          area: e.area,
          vin: e.vin,
          type: 'nonconformity',
          payload: { checkpoint: e.checkpoint, defect: e.defect, decision: e.decision, responsibleArea: e.responsible },
        });
        break;

      case 'downtime_start': {
        if (e.info.micro && e.info.category !== 'no_parts') break;
        // Мастер вносит простой в 1С:MES с задержкой, время начала — примерно, с точностью до 5 минут
        const delay = this.delays.range(CAL.mesDelayMin[0], CAL.mesDelayMin[1]) * MIN;
        const from = roundTo5(e.info.from);
        this.openRegs.set(e.info.id, { from: toPlantIso(from), equipmentId: e.info.equipmentId, area: e.info.area, reason: e.info.reason, category: e.info.category });
        this.pendingMes.push({
          at: e.t + delay,
          event: {
            eventId: this.id('mes'),
            source: 'mes',
            ts: toPlantIso(e.t + delay),
            area: e.info.area,
            equipmentId: e.info.equipmentId,
            type: 'downtime_registered',
            payload: { reason: e.info.reason, category: e.info.category, from: toPlantIso(from), registeredBy: MASTER_OF[e.info.area] },
          },
        });
        break;
      }

      case 'downtime_end': {
        const reg = this.openRegs.get(e.info.id);
        if (!reg) break;
        this.openRegs.delete(e.info.id);
        const durationMin = (e.to - e.info.from) / MIN;
        // Короткие остановки мастер не записывает — их видно только по контроллерам
        if (durationMin < CAL.mesMinDurationMin && e.info.category !== 'planned') {
          this.pendingMes = this.pendingMes.filter((p) => !(p.event.type === 'downtime_registered' && p.event.equipmentId === reg.equipmentId && p.event.payload.from === reg.from));
          break;
        }
        const pending = this.pendingMes.find((p) => p.event.type === 'downtime_registered' && p.event.equipmentId === reg.equipmentId && p.event.payload.from === reg.from);
        if (pending && pending.event.type === 'downtime_registered') {
          // ещё не успели записать — запишут сразу с окончанием
          pending.event.payload.to = toPlantIso(roundTo5(e.to));
        } else {
          const at = e.t + this.delays.range(2, 8) * MIN;
          this.pendingMes.push({
            at,
            event: {
              eventId: this.id('mes'),
              source: 'mes',
              ts: toPlantIso(at),
              area: reg.area,
              equipmentId: reg.equipmentId,
              type: 'downtime_registered',
              payload: { reason: reg.reason, category: reg.category, from: reg.from, to: toPlantIso(roundTo5(e.to)), registeredBy: MASTER_OF[reg.area] },
            },
          });
        }
        break;
      }

      case 'stock':
        this.out.http({
          eventId: `wms-r${this.runId}-${e.kitId}-${e.t}`,
          source: 'wms',
          ts: toPlantIso(e.t),
          area: 'warehouse',
          type: 'stock_level',
          payload: { kitId: e.kitId, model: e.model, qty: Math.max(0, e.qty), shiftsLeft: Math.max(0, Math.round(e.shiftsLeft * 100) / 100) },
        });
        break;

      case 'shift_end': {
        const s = e.stats;
        const ts = toPlantIso(e.t + 3 * MIN);
        for (const area of ['weld', 'paint', 'assembly'] as const) {
          const hours = Math.max(0, (480 - s.stoppedMin[area]) / 60);
          this.out.http({
            eventId: `mes-r${this.runId}-report-${s.shift.key}-${area}`,
            source: 'mes',
            ts,
            area,
            type: 'shift_report',
            payload: { date: s.shift.date, shift: s.shift.index, line: LINE_OF[area], plan: 120, fact: s.output[area], hours: round1(hours), load: Math.round((hours / 8) * 100) },
          });
          const produced = s.output[area];
          this.out.http({
            eventId: `qls-r${this.runId}-quality-${s.shift.key}-${area}`,
            source: 'qls',
            ts,
            area,
            type: 'quality_summary',
            payload: { date: s.shift.date, shift: s.shift.index, produced, defects: s.defects[area], pct: produced ? round1((s.defects[area] / produced) * 100) : 0 },
          });
        }
        break;
      }

      case 'state':
        if (stage >= 1) this.out.mqtt('plc', topics.state(e.area, e.equipmentId), { status: e.status, code: e.code, text: e.text, ts: toPlantIso(e.t) }, 1);
        break;

      case 'counter':
        if (stage >= 1) this.out.mqtt('plc', topics.counter(e.area, e.equipmentId), { cycles: e.cycles, total: e.total, ts: toPlantIso(e.t) }, 1);
        break;

      case 'telemetry':
        if (e.metric === 'filter_dp_pa' ? stage >= 1 : stage >= 2) {
          this.out.mqtt('plc', topics.telemetry(e.area, e.equipmentId), { metric: e.metric, value: e.value, ts: toPlantIso(e.t) });
        }
        break;

      case 'line_stopped':
        if (stage >= 1) {
          this.out.mqtt('camera', topics.detection(e.area, cameraOf(e.area)), { kind: 'line_stopped', clipUrl: `/media/clips/${e.area}-stop.mp4`, ts: toPlantIso(e.t) }, 1);
        }
        break;

      case 'queue':
        if (stage >= 1) this.out.mqtt('camera', topics.detection(e.area, cameraOf(e.area)), { kind: 'queue', value: e.count, ts: toPlantIso(e.t) }, 1);
        break;

      case 'work_done':
        break;
    }
  }

  /** Отложенные записи мастера в 1С:MES, время которых наступило */
  flushDue(now: number) {
    if (!this.pendingMes.length) return;
    const due = this.pendingMes.filter((p) => p.at <= now).sort((a, b) => a.at - b.at);
    if (!due.length) return;
    this.pendingMes = this.pendingMes.filter((p) => p.at > now);
    for (const p of due) this.out.http(p.event);
  }

  /** Незавершёнка в 1С:MES на начало смены: где какой кузов */
  wip(world: World, at: number) {
    world.wipSnapshot().forEach((b, i) => {
      this.out.http({
        eventId: `mes-r${this.runId}-wip-${b.vin}`,
        source: 'mes',
        ts: toPlantIso(at - (60 - i) * 1000),
        area: b.area,
        vin: b.vin,
        type: 'post_passed',
        payload: { model: b.model, post: b.lastPost },
      });
    });
  }

  /** Запись 1С:MES о плановом ТО до начала смены (например, ночью) */
  serviceRecord(equipmentId: string, area: AreaId, from: number, to: number) {
    this.out.http({
      eventId: `mes-r${this.runId}-service-${equipmentId}-${from}`,
      source: 'mes',
      ts: toPlantIso(to + 5 * MIN),
      area,
      equipmentId,
      type: 'downtime_registered',
      payload: { reason: 'Плановое ТО', category: 'planned', from: toPlantIso(from), to: toPlantIso(to), registeredBy: 'Служба ТО' },
    });
  }

  /** При подключении контроллеров — текущее состояние и счётчики всего оборудования */
  plcSnapshot(world: World, at: number) {
    for (const e of world.equipmentSnapshot()) {
      this.out.mqtt('plc', topics.state(e.area, e.id), { status: e.status, code: e.down?.code, text: e.down?.text ?? e.down?.reason, ts: toPlantIso(at) }, 1);
      if (e.id.startsWith('ABB-')) this.out.mqtt('plc', topics.counter(e.area, e.id), { cycles: e.cycles, total: e.total, ts: toPlantIso(at) }, 1);
    }
    this.out.mqtt('plc', topics.telemetry('paint', 'BOOTH-02'), { metric: 'filter_dp_pa', value: round1(world.filterB2Dp), ts: toPlantIso(at) });
  }

  stockSnapshot(world: World, at: number) {
    for (const s of world.kitSnapshot()) this.handle({ kind: 'stock', t: at, ...s });
  }
}

function cameraOf(area: AreaId): string {
  return area === 'weld' ? 'CAM-WELD' : area === 'paint' ? 'CAM-PAINT' : area === 'qc' ? 'CAM-QC' : 'CAM-ASM';
}

function roundTo5(ms: number): number {
  const step = 5 * MIN;
  return Math.round(ms / step) * step;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
