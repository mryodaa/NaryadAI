// Имитаторы систем завода. Каждый видит физический цех со своей стороны и говорит со шлюзом
// на своём языке: 1С (MES, QLS, WMS) — пакетами событий по HTTP, контроллеры и камеры — по MQTT.
import {
  CAMERAS,
  CANONICAL_FIELD_DEF,
  ID_METHOD_DEF,
  SEED_MODEL,
  plantOperations,
  shiftAt,
  topics,
  toPlantIso,
  type AreaId,
  type CanonicalEvent,
  type CanonicalField,
  type IdPointRole,
  type PlantModel,
  type PlantPoint,
  type Stage,
} from '@allur/contracts';
import { CAL, MIN } from './calibration';
import { Rng } from './rng';
import type { BodyRef, DowntimeInfo, World, WorldEvent } from './world';

export interface Outbox {
  /** 1С и мобильный ввод: POST /api/v1/events */
  http(event: CanonicalEvent): void;
  /** Контроллеры и камеры: MQTT */
  mqtt(source: 'plc' | 'camera', topic: string, payload: object, qos?: 0 | 1): void;
}

/** Кто записывает простой в 1С:MES — по виду участка */
const MASTER_BY_KIND: Record<string, string> = {
  warehouse_in: 'Кладовщик',
  welding: 'Мастер сварки',
  painting: 'Мастер окраски',
  assembly: 'Мастер сборки',
  inspection: 'Мастер ОТК',
  warehouse_out: 'Кладовщик ГП',
};

export function masterOf(plant: PlantModel, area: AreaId): string {
  const st = plant.stageById.get(area);
  return (st && MASTER_BY_KIND[st.kind]) ?? (st ? `Мастер участка «${st.short}»` : 'Мастер');
}

/** Участки со сменным отчётом в 1С:MES и их линии: «Сварка-1», «Окраска-1», «Сборка-1» */
export function reportLines(plant: PlantModel): { area: AreaId; line: string }[] {
  return plant.production.filter((s) => s.kind === 'welding' || s.kind === 'painting' || s.kind === 'assembly' || s.kind === 'custom').map((s) => ({ area: s.id, line: `${s.short}-1` }));
}

/**
 * Даёт ли имитатор данные контроллера по оборудованию: способ «Имитатор (демо)», а с флагом
 * «имитировать всё» — и любой автоматический (OPC UA, Modbus, SCADA, датчик); поле — по ступени.
 */
export function simulatesField(plant: PlantModel, equipmentId: string, field: CanonicalField, stage: Stage, simulateAll: boolean): boolean {
  const e = plant.equipmentById.get(equipmentId);
  if (!e || e.passive || !e.type.fields.includes(field)) return false;
  const m = e.connection.method;
  const on = m === 'simulator' || (simulateAll && m !== 'none' && m !== 'manual');
  if (!on) return false;
  const need = m === 'retrofit_sensor' ? 2 : CANONICAL_FIELD_DEF[field].stage;
  return stage >= need;
}

export class Adapters {
  private seq: Record<string, number> = {};
  private pendingMes: { at: number; event: CanonicalEvent }[] = [];
  private openRegs = new Map<string, { from: string; equipmentId: string; area: AreaId; reason: string; category: DowntimeInfo['category'] }>();
  private delays: Rng;
  /** Отметки кузовов: задержка человека, пропуски и дубли — свой поток случайных чисел */
  private scans: Rng;
  /** Последняя отметка 1С:MES по кузову: человек сканирует по порядку */
  private lastScan = new Map<string, number>();
  /** Кузова с нанесённым VIN: после этого 1С и контроллеры отмечают их и по VIN */
  private vinShown = new Set<string>();
  /**
   * Ложные сигналы: данные ошиблись, а цех работает. На ступени 1+ контроллер робота на несколько минут
   * шлёт «авария» (сбой датчика), на ступени 0 сканер 1С:MES участка отдаёт отметки с опозданием.
   */
  falseSignals = false;
  private fsRng: Rng;
  private nextFalseAt: number | null = null;
  private glitch: { equipmentId: string; area: AreaId; until: number; real: { status: string; code?: string; text?: string } } | null = null;
  private mesHold: { area: AreaId; until: number } | null = null;

  constructor(
    private runId: number,
    seed: number,
    private out: Outbox,
    private stage: () => Stage,
    private plant: () => PlantModel = () => SEED_MODEL,
    private simulateAll: () => boolean = () => false,
  ) {
    this.delays = new Rng(seed ^ 0x5bd1e995);
    this.scans = new Rng(seed ^ 0x27d4eb2f);
    this.fsRng = new Rng(seed ^ 0x6c8e9cf5);
  }

  // ---------------------------------------------------------------------------
  // Отметки кузова

  private point(pred: (p: PlantPoint) => boolean): PlantPoint | undefined {
    return this.plant().points.find(pred);
  }

  private stagePoint(area: AreaId, role: IdPointRole): PlantPoint | undefined {
    return this.point((p) => p.stageId === area && p.role === role);
  }

  /** Точка работает на этой ступени: сканер 1С — всегда, RFID и ПЛК — с подключёнными контроллерами */
  private active(p: PlantPoint | undefined): p is PlantPoint {
    if (!p || ID_METHOD_DEF[p.method].stage > this.stage()) return false;
    if (p.method === 'mes_scan' || p.method === 'manual') return true;
    const m = p.connection?.method;
    return m === 'simulator' || (this.simulateAll() && !!m && m !== 'none' && m !== 'manual');
  }

  private vinOf(b: BodyRef): string | undefined {
    return this.vinShown.has(b.bodyId) ? b.vin : undefined;
  }

  /**
   * Скан 1С:MES: человек сканирует с задержкой до 2 минут и по порядку; около 1% отметок теряется,
   * около 0,5% уходит дважды. reliable — отметка, без которой учёт не сходится (выдача комплекта, приёмка ГП).
   */
  private mesScan(b: BodyRef, p: PlantPoint, direction: 'in' | 'out', t: number, opts: { reliable?: boolean; delayMin?: number } = {}) {
    if (!opts.reliable && this.scans.chance(0.01)) return;
    let ts = t + this.scans.range(0, opts.delayMin ?? 2) * MIN;
    // сканер участка «завис»: отметки уходят пачкой, когда его перезапустят
    if (this.mesHold && this.mesHold.area === p.stageId && ts < this.mesHold.until) ts = this.mesHold.until + this.scans.range(0, 1) * MIN;
    ts = Math.max(ts, (this.lastScan.get(b.bodyId) ?? 0) + 5000);
    this.lastScan.set(b.bodyId, ts);
    const event = (at: number): CanonicalEvent => ({
      eventId: this.id('mes'),
      source: ID_METHOD_DEF[p.method].source === 'master' ? 'master' : 'mes',
      ts: toPlantIso(at),
      area: p.stageId,
      vin: this.vinOf(b),
      type: 'body_checkpoint',
      payload: { bodyId: b.bodyId, checkpointId: p.id, direction },
    });
    this.pendingMes.push({ at: ts, event: event(ts) });
    if (!opts.reliable && this.scans.chance(0.005)) {
      const again = ts + this.scans.range(5, 40) * 1000;
      this.pendingMes.push({ at: again, event: event(again) });
    }
  }

  /** RFID или трекинг ПЛК: сразу по MQTT, с теми же пропусками и дублями */
  private plcMark(b: BodyRef, p: PlantPoint, direction: 'in' | 'out', t: number, postId?: string) {
    if (this.scans.chance(0.01)) return;
    const payload = { bodyId: b.bodyId, vin: this.vinOf(b), direction, postId, ts: toPlantIso(t) };
    this.out.mqtt('plc', topics.checkpoint(p.stageId, p.id), payload, 1);
    if (this.scans.chance(0.005)) this.out.mqtt('plc', topics.checkpoint(p.stageId, p.id), { ...payload, ts: toPlantIso(t + this.scans.range(3, 30) * 1000) }, 1);
  }

  /** Кузов у оборудования: точка оборудования (RFID, ПЛК, приём в лаборатории) */
  private atEquipment(b: BodyRef, equipmentId: string, postId: string, direction: 'in' | 'out', t: number) {
    const p = this.point((x) => x.equipmentId === equipmentId);
    if (!this.active(p)) return;
    if (p.method === 'mes_scan' || p.method === 'manual') this.mesScan(b, p, direction, t, { reliable: true, delayMin: 1 });
    else if (p.method === 'plc_tracking') {
      if (direction === 'in') this.plcMark(b, p, 'in', t, postId);
    } else this.plcMark(b, p, direction, t, postId);
  }

  /** Операции поста выполнены: результат от робота или инструмента (ступень 1), VIN — в 1С:MES */
  private operations(b: BodyRef, post: string, equipmentId: string, area: AreaId, t: number) {
    const ops = plantOperations(this.plant()).get(post)?.ops ?? [];
    if (ops.includes('vin_marking') && !this.vinShown.has(b.bodyId)) {
      this.vinShown.add(b.bodyId);
      this.out.http({ eventId: this.id('mes'), source: 'mes', ts: toPlantIso(t), area, vin: b.vin, type: 'vin_assigned', payload: { bodyId: b.bodyId } });
    }
    if (!this.emits(equipmentId, 'state')) return;
    for (const op of ops) {
      if (op === 'vin_marking') continue;
      this.out.mqtt('plc', topics.operation(area, equipmentId), { bodyId: b.bodyId, vin: this.vinOf(b), operation: op, result: 'ok', ts: toPlantIso(t) }, 0);
    }
  }

  private emits(equipmentId: string, field: CanonicalField): boolean {
    return simulatesField(this.plant(), equipmentId, field, this.stage(), this.simulateAll());
  }

  private id(source: string): string {
    this.seq[source] = (this.seq[source] ?? 0) + 1;
    return `${source}-r${this.runId}-${this.seq[source]}`;
  }

  handle(e: WorldEvent) {
    const stage = this.stage();
    switch (e.kind) {
      case 'pass':
        if (e.equipmentId) this.operations(e.body, e.post, e.equipmentId, e.area, e.t);
        break;

      case 'order': {
        const color = this.plant().colorByCode.get(e.body.colorCode);
        this.out.http({
          eventId: `erp-r${this.runId}-order-${e.body.bodyId}`,
          source: 'erp',
          ts: toPlantIso(e.t),
          area: this.plant().warehouseIn?.id ?? 'warehouse',
          type: 'production_order',
          payload: { bodyId: e.body.bodyId, model: e.body.model, colorCode: e.body.colorCode || undefined, colorName: color?.name, plannedSeq: e.body.serial },
        });
        break;
      }

      case 'kit': {
        const p = this.plant().warehouseIn ? this.stagePoint(this.plant().warehouseIn!.id, 'stage_exit') : undefined;
        if (this.active(p)) this.mesScan(e.body, p, 'out', e.t, { reliable: true, delayMin: 0.3 });
        break;
      }

      case 'enter': {
        const p = this.stagePoint(e.area, 'stage_entry');
        const finished = this.plant().warehouseOut?.id === e.area;
        if (this.active(p)) this.mesScan(e.body, p, 'in', e.t, { reliable: finished });
        break;
      }

      case 'exit': {
        const p = this.stagePoint(e.area, 'stage_exit');
        if (this.active(p)) this.mesScan(e.body, p, 'out', e.t);
        break;
      }

      case 'arrive':
        this.atEquipment(e.body, e.equipmentId, e.post, 'in', e.t);
        break;

      case 'leave':
        this.atEquipment(e.body, e.equipmentId, e.post, 'out', e.t);
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
            payload: { reason: e.info.reason, category: e.info.category, from: toPlantIso(from), registeredBy: masterOf(this.plant(), e.info.area) },
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
              payload: { reason: reg.reason, category: reg.category, from: reg.from, to: toPlantIso(roundTo5(e.to)), registeredBy: masterOf(this.plant(), reg.area) },
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
        for (const { area, line } of reportLines(this.plant())) {
          const hours = Math.max(0, (480 - (s.stoppedMin[area] ?? 0)) / 60);
          const produced = s.output[area] ?? 0;
          const defects = s.defects[area] ?? 0;
          this.out.http({
            eventId: `mes-r${this.runId}-report-${s.shift.key}-${area}`,
            source: 'mes',
            ts,
            area,
            type: 'shift_report',
            payload: { date: s.shift.date, shift: s.shift.index, line, plan: 120, fact: produced, hours: round1(hours), load: Math.round((hours / 8) * 100) },
          });
          this.out.http({
            eventId: `qls-r${this.runId}-quality-${s.shift.key}-${area}`,
            source: 'qls',
            ts,
            area,
            type: 'quality_summary',
            payload: { date: s.shift.date, shift: s.shift.index, produced, defects, pct: produced ? round1((defects / produced) * 100) : 0 },
          });
        }
        break;
      }

      case 'state':
        // контроллер «врёт»: настоящее состояние запоминаем и пришлём, когда сбой датчика пройдёт
        if (this.glitch?.equipmentId === e.equipmentId) {
          this.glitch.real = { status: e.status, code: e.code, text: e.text };
          break;
        }
        if (this.emits(e.equipmentId, 'state')) this.out.mqtt('plc', topics.state(e.area, e.equipmentId), { status: e.status, code: e.code, text: e.text, ts: toPlantIso(e.t) }, 1);
        break;

      case 'counter':
        if (this.emits(e.equipmentId, 'cycleCounter')) this.out.mqtt('plc', topics.counter(e.area, e.equipmentId), { cycles: e.cycles, total: e.total, ts: toPlantIso(e.t) }, 1);
        break;

      case 'telemetry':
        if (this.emits(e.equipmentId, METRIC_FIELD[e.metric])) {
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

  /**
   * Ложный сигнал сейчас: на ступени 1+ — сбой датчика робота сварки (контроллер шлёт «авария»,
   * кузова при этом идут), на ступени 0 — сканер 1С:MES сварки отдаёт отметки с опозданием.
   */
  falseSignal(t: number, minutes: number, equipmentId?: string): string | null {
    const plant = this.plant();
    const weld = plant.production.find((s) => s.kind === 'welding');
    if (!weld) return null;
    if (this.stage() >= 1) {
      if (this.glitch) return null;
      const robots = weld.equipment.filter((e) => !e.passive && e.type.serviceIntervalCycles && this.emits(e.id, 'state'));
      const eq = robots.find((e) => e.id === equipmentId) ?? robots[this.fsRng.int(0, robots.length - 1)];
      if (!eq) return null;
      this.glitch = { equipmentId: eq.id, area: weld.id, until: t + minutes * MIN, real: { status: 'run' } };
      this.out.mqtt('plc', topics.state(weld.id, eq.id), { status: 'fault', code: 'E-417', text: 'Датчик положения: нет сигнала', ts: toPlantIso(t) }, 1);
      return `контроллер ${eq.id}: ложная авария на ${Math.round(minutes)} мин`;
    }
    if (this.mesHold) return null;
    this.mesHold = { area: weld.id, until: t + minutes * MIN };
    return `сканер 1С:MES участка ${weld.short}: отметки с опозданием ${Math.round(minutes)} мин`;
  }

  private tickFalseSignals(now: number) {
    if (this.glitch && now >= this.glitch.until) {
      const g = this.glitch;
      this.glitch = null;
      if (this.emits(g.equipmentId, 'state')) this.out.mqtt('plc', topics.state(g.area, g.equipmentId), { ...g.real, ts: toPlantIso(now) }, 1);
    }
    if (this.mesHold && now >= this.mesHold.until) this.mesHold = null;
    if (!this.falseSignals) return;
    // в среднем раз в 2,5 часа рабочего времени
    if (this.nextFalseAt === null) this.nextFalseAt = now + this.fsRng.range(40, 260) * MIN;
    if (now < this.nextFalseAt) return;
    this.nextFalseAt = now + this.fsRng.range(60, 240) * MIN;
    if (shiftAt(now)) this.falseSignal(now, this.fsRng.range(8, 16));
  }

  /** Отложенные записи мастера в 1С:MES, время которых наступило */
  flushDue(now: number) {
    this.tickFalseSignals(now);
    if (!this.pendingMes.length) return;
    const due = this.pendingMes.filter((p) => p.at <= now).sort((a, b) => a.at - b.at);
    if (!due.length) return;
    this.pendingMes = this.pendingMes.filter((p) => p.at > now);
    for (const p of due) this.out.http(p.event);
  }

  /** Незавершёнка в 1С:MES на начало смены: где какой кузов */
  wip(world: World, at: number) {
    const plant = this.plant();
    const firstStage = plant.production[0]?.id;
    world.wipSnapshot().forEach((w, i) => {
      const b = w.body;
      const ts = at - 90_000 + i * 500;
      const color = plant.colorByCode.get(b.colorCode);
      this.out.http({
        eventId: `erp-r${this.runId}-order-${b.bodyId}`,
        source: 'erp',
        ts: toPlantIso(at - 4 * 3600_000),
        area: plant.warehouseIn?.id ?? 'warehouse',
        type: 'production_order',
        payload: { bodyId: b.bodyId, model: b.model, colorCode: b.colorCode || undefined, colorName: color?.name, plannedSeq: b.serial },
      });
      // VIN уже нанесён, если кузов прошёл пост маркировки (всё после сварки и доводка)
      const atVinOrLater = w.area !== firstStage || (w.at === 'post' && plant.stageById.get(w.area)?.outletPosts.includes(w.post));
      if (atVinOrLater) {
        this.vinShown.add(b.bodyId);
        this.out.http({ eventId: `mes-r${this.runId}-wipvin-${b.bodyId}`, source: 'mes', ts: toPlantIso(at - 3 * 3600_000), area: firstStage ?? w.area, vin: b.vin, type: 'vin_assigned', payload: { bodyId: b.bodyId } });
      }
      const point = this.stagePoint(w.area, w.at === 'post' ? 'stage_entry' : 'stage_exit');
      if (this.active(point)) {
        this.out.http({
          eventId: `mes-r${this.runId}-wip-${b.bodyId}`,
          source: 'mes',
          ts: toPlantIso(ts),
          area: w.area,
          vin: this.vinOf(b),
          type: 'body_checkpoint',
          payload: { bodyId: b.bodyId, checkpointId: point.id, direction: w.at === 'post' ? 'in' : 'out' },
        });
        this.lastScan.set(b.bodyId, ts);
      }
      if (w.at === 'post') {
        const p = this.point((x) => x.equipmentId === w.equipmentId);
        if (this.active(p) && p.method !== 'mes_scan') this.out.mqtt('plc', topics.checkpoint(p.stageId, p.id), { bodyId: b.bodyId, vin: this.vinOf(b), direction: 'in', postId: w.post, ts: toPlantIso(ts + 200) }, 1);
      }
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

  /** При подключении контроллеров — текущее состояние и счётчики подключённого оборудования */
  plcSnapshot(world: World, at: number, only?: string) {
    for (const e of world.equipmentSnapshot()) {
      if (only && e.id !== only) continue;
      if (this.emits(e.id, 'state')) this.out.mqtt('plc', topics.state(e.area, e.id), { status: e.status, code: e.down?.code, text: e.down?.text ?? e.down?.reason, ts: toPlantIso(at) }, 1);
      if (this.emits(e.id, 'cycleCounter')) this.out.mqtt('plc', topics.counter(e.area, e.id), { cycles: e.cycles, total: e.total, ts: toPlantIso(at) }, 1);
    }
    for (const f of world.filterSnapshot()) {
      if (only && f.equipmentId !== only) continue;
      if (this.emits(f.equipmentId, 'filterDpPa')) this.out.mqtt('plc', topics.telemetry(f.area, f.equipmentId), { metric: 'filter_dp_pa', value: round1(f.dp), ts: toPlantIso(at) });
    }
  }

  /** Пульс связи подключённого оборудования: шлюз видит, что данные идут, даже если состояние не меняется */
  heartbeat(world: World, at: number) {
    for (const e of world.equipmentSnapshot()) {
      if (this.emits(e.id, 'state')) this.out.mqtt('plc', topics.heartbeat(e.area, e.id), { status: e.status, ts: toPlantIso(at) }, 0);
    }
  }

  stockSnapshot(world: World, at: number) {
    for (const s of world.kitSnapshot()) this.handle({ kind: 'stock', t: at, ...s });
  }
}

const METRIC_FIELD: Record<string, CanonicalField> = {
  filter_dp_pa: 'filterDpPa',
  motor_current_a: 'motorCurrentA',
  vibration_mm_s: 'vibrationMmS',
  temperature_c: 'temperatureC',
  pressure_bar: 'pressureBar',
  torque_nm: 'torqueNm',
};

/** Видеокамера участка: из справочника камер, для новых участков — CAM-<код> */
function cameraOf(area: AreaId): string {
  return CAMERAS.find((c) => c.area === area)?.id ?? `CAM-${area.toUpperCase()}`;
}

function roundTo5(ms: number): number {
  const step = 5 * MIN;
  return Math.round(ms / step) * step;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
