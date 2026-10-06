// Физическая модель цеха — «настоящий» цех прототипа. Её видят все имитаторы (1С, контроллеры,
// камеры, склад), каждый со своей стороны и со своими задержками. Ядро двойника её не видит:
// оно знает о цехе только то, что пришло по сети.
import {
  BUFFERS,
  EQUIPMENT_BY_ID,
  KITS,
  KIT_BY_ID,
  MODELS,
  POSTS,
  makeVin,
  plantParts,
  shiftAt,
  type AreaId,
  type BufferId,
  type DowntimeCategoryId,
  type MetricId,
  type ModelId,
  type ShiftRef,
  type WorkOrder,
} from '@allur/contracts';
import { CAL, MIN, SHIFT_PLAN } from './calibration';
import { Rng } from './rng';

export type EqStatus = 'run' | 'idle' | 'fault' | 'maintenance';
export type Decision = 'rework' | 'repaint' | 'scrap';

export interface DowntimeInfo {
  id: string;
  equipmentId: string;
  area: AreaId;
  reason: string;
  category: DowntimeCategoryId;
  code?: string;
  text?: string;
  from: number;
  /** Короткая остановка — мастер её в MES не запишет */
  micro: boolean;
}

export interface ShiftStats {
  shift: ShiftRef;
  output: Record<'weld' | 'paint' | 'assembly' | 'qc', number>;
  stoppedMin: Record<'weld' | 'paint' | 'assembly' | 'qc', number>;
  defects: Record<'weld' | 'paint' | 'assembly', number>;
}

export type WorldEvent =
  | { kind: 'pass'; t: number; vin: string; model: ModelId; post: string; area: AreaId; equipmentId?: string }
  | { kind: 'defect'; t: number; vin: string; model: ModelId; checkpoint: string; area: AreaId; responsible: AreaId; defect: string; decision: Decision }
  | { kind: 'state'; t: number; equipmentId: string; area: AreaId; status: EqStatus; code?: string; text?: string }
  | { kind: 'counter'; t: number; equipmentId: string; area: AreaId; cycles: number; total: number }
  | { kind: 'telemetry'; t: number; equipmentId: string; area: AreaId; metric: MetricId; value: number }
  | { kind: 'downtime_start'; t: number; info: DowntimeInfo }
  | { kind: 'downtime_end'; t: number; info: DowntimeInfo; to: number }
  | { kind: 'stock'; t: number; kitId: string; model: ModelId; qty: number; shiftsLeft: number }
  | { kind: 'shift_end'; t: number; stats: ShiftStats }
  | { kind: 'line_stopped'; t: number; area: AreaId; equipmentId: string }
  | { kind: 'queue'; t: number; area: AreaId; count: number }
  | { kind: 'work_done'; t: number; workOrderId: string; title: string };

interface Body {
  vin: string;
  model: ModelId;
  serial: number;
  dpAtB2: number;
  repaint: boolean;
}

interface Post {
  id: string;
  area: AreaId;
  eq: string;
  cycleMs: number;
  body: Body | null;
  remaining: number;
  doneAt: number | null;
}

interface Eq {
  id: string;
  area: AreaId;
  status: EqStatus;
  downUntil: number;
  down: DowntimeInfo | null;
  /** Что сделать по окончании остановки */
  onEnd?: 'filter_b2' | 'robot_service' | 'chain_fixed';
  cycles: number;
  total: number;
}

export interface WorldPreset {
  startMs: number;
  seed: number;
  randomFailures: boolean;
  microStops: boolean;
  filterB2Bodies: number;
  filterB1Bodies: number;
  robotCycles: Record<string, number>;
  buffers: Record<BufferId, number>;
  /** Остаток комплектов, смен */
  kitShifts: Record<string, number>;
  /** Поставка комплекта не придёт до этого момента */
  delayedDeliveries: { kitId: string; untilMs: number }[];
  /** Обрыв цепи в заданный момент (сценарий) */
  chainBreakAt?: number;
  /** Отказ ABB-04 в заданный момент, если не обслужат (сценарий) */
  serial: number;
}

const AREA_KEYS = ['weld', 'paint', 'assembly', 'qc'] as const;
type AreaKey = (typeof AREA_KEYS)[number];

const MIX_PATTERN: ModelId[] = buildMixPattern();

function buildMixPattern(): ModelId[] {
  // Равномерное перемешивание 26 / 19 / 5 на 50 позиций (без «пачек» одной модели)
  const counts = { ...CAL.mix };
  const total = counts.onix + counts.cobalt + counts.j7;
  const acc: Record<ModelId, number> = { onix: 0, cobalt: 0, j7: 0 };
  const out: ModelId[] = [];
  for (let i = 0; i < total; i++) {
    let best: ModelId = 'onix';
    let bestScore = -Infinity;
    for (const m of MODELS) {
      acc[m.id] += counts[m.id] / total;
      if (acc[m.id] > bestScore) {
        bestScore = acc[m.id];
        best = m.id;
      }
    }
    acc[best] -= 1;
    out.push(best);
  }
  return out;
}

export function kitNeedPerShift(model: ModelId): number {
  const total = CAL.mix.onix + CAL.mix.cobalt + CAL.mix.j7;
  return (SHIFT_PLAN * CAL.mix[model]) / total;
}

/** Сколько кузовов нужно прогнать через свежий фильтр, чтобы перепад дошёл до dp */
export function filterBodiesAt(dp: number): number {
  const f = CAL.filter;
  const share = (dp - f.cleanPa) / (f.limitPa - f.cleanPa);
  return (Math.log(1 + share * (Math.exp(f.curveK) - 1)) / f.curveK) * f.lifeBodies;
}

export function filterDp(bodies: number): number {
  const f = CAL.filter;
  const x = Math.max(0, bodies) / f.lifeBodies;
  return f.cleanPa + (f.limitPa - f.cleanPa) * ((Math.exp(f.curveK * x) - 1) / (Math.exp(f.curveK) - 1));
}

export class World {
  t: number;
  readonly rng: Rng;
  private posts: Post[] = [];
  private byArea: Record<AreaKey, Post[]>;
  private buf: Record<BufferId, Body[]> = { 'weld-paint': [], 'paint-assembly': [], 'assembly-qc': [] };
  private repaintQueue: Body[] = [];
  private eq: Record<string, Eq> = {};
  private kits: Record<string, number> = {};
  private serial: number;
  private releaseTimer = 0;
  private patternIdx = 0;
  private noJ7Until = 0;
  private filterB2 = 0;
  private filterB1 = 0;
  private shift: ShiftRef | null = null;
  private stats: ShiftStats | null = null;
  private dayFactor = 1;
  private chainBreakAt: number | null = null;
  private scheduled: { at: number; run: () => void }[] = [];
  private delayed: { kitId: string; untilMs: number }[];
  private downSeq = 0;
  private lastTelemetryMin = -1;
  private stopNotified = new Set<string>();
  private queueNotified = new Set<string>();
  private kitsBlocked = false;
  /** Сорность — «рассеянием ошибки»: реальная доля брака плавно следует за вероятностью */
  private dirtAcc: number;
  private dirtThreshold: number;
  readonly preset: WorldPreset;
  out: WorldEvent[] = [];

  constructor(preset: WorldPreset) {
    this.preset = preset;
    this.t = preset.startMs;
    this.rng = new Rng(preset.seed);
    this.serial = preset.serial;
    this.filterB2 = preset.filterB2Bodies;
    this.filterB1 = preset.filterB1Bodies;
    this.delayed = [...preset.delayedDeliveries];
    this.chainBreakAt = preset.chainBreakAt ?? null;
    this.dirtAcc = this.rng.next();
    this.dirtThreshold = this.rng.range(0.7, 1.3);

    for (const e of Object.values(EQUIPMENT_BY_ID)) {
      this.eq[e.id] = { id: e.id, area: e.area, status: 'run', downUntil: 0, down: null, cycles: preset.robotCycles[e.id] ?? 0, total: 40000 + (preset.robotCycles[e.id] ?? 0) };
    }
    for (const p of POSTS) {
      if (p.area === 'finished' || !p.equipmentId) continue;
      const cycle = CAL.cycleMin[p.area as AreaKey] ?? CAL.taktMin;
      this.posts.push({ id: p.id, area: p.area, eq: p.equipmentId, cycleMs: cycle * MIN, body: null, remaining: 0, doneAt: null });
    }
    this.byArea = {
      weld: this.posts.filter((p) => p.area === 'weld'),
      paint: this.posts.filter((p) => p.area === 'paint'),
      assembly: this.posts.filter((p) => p.area === 'assembly'),
      qc: this.posts.filter((p) => p.area === 'qc'),
    };
    for (const k of KITS) this.kits[k.id] = Math.round((preset.kitShifts[k.id] ?? CAL.kitTargetShifts) * kitNeedPerShift(k.model));
    this.fillWip(preset.buffers);
  }

  /** Незавершёнка на начало дня: посты заняты, буферы частично заполнены */
  private fillWip(buffers: Record<BufferId, number>) {
    const order: (Post | BufferId)[] = [
      ...this.byArea.qc.slice().reverse(),
      'assembly-qc',
      ...this.byArea.assembly.slice().reverse(),
      'paint-assembly',
      ...this.byArea.paint.slice().reverse(),
      'weld-paint',
      ...this.byArea.weld.slice().reverse(),
    ];
    let serial = this.serial - 1 - order.reduce((n, o) => n + (typeof o === 'string' ? buffers[o] : 1), 0);
    for (const o of order) {
      if (typeof o === 'string') {
        for (let i = 0; i < buffers[o]; i++) this.buf[o].push(this.newBody(++serial, true));
      } else {
        o.body = this.newBody(++serial, true);
        o.remaining = this.rng.range(0.1, 1) * o.cycleMs;
      }
    }
  }

  private newBody(serial: number, wip = false): Body {
    let model = MIX_PATTERN[this.patternIdx % MIX_PATTERN.length]!;
    this.patternIdx++;
    if (!wip && model === 'j7' && this.t < this.noJ7Until) model = this.patternIdx % 2 ? 'onix' : 'cobalt';
    return { vin: makeVin(model, serial), model, serial, dpAtB2: 0, repaint: false };
  }

  /** Где кузов сейчас: для снимка незавершёнки в 1С:MES на начало смены */
  wipSnapshot(): { vin: string; model: ModelId; lastPost: string; area: AreaId }[] {
    const out: { vin: string; model: ModelId; lastPost: string; area: AreaId }[] = [];
    const prevPost = (p: Post): string | null => {
      const idx = POSTS.findIndex((x) => x.id === p.id);
      return idx > 0 ? POSTS[idx - 1]!.id : null;
    };
    for (const p of this.posts) {
      if (!p.body) continue;
      const last = prevPost(p);
      if (last) out.push({ vin: p.body.vin, model: p.body.model, lastPost: last, area: POSTS.find((x) => x.id === last)!.area });
    }
    const lastOf: Record<BufferId, string> = { 'weld-paint': 'WELD-4', 'paint-assembly': 'PAINT-OVEN', 'assembly-qc': 'ASM-6' };
    for (const b of BUFFERS) {
      for (const body of this.buf[b.id]) out.push({ vin: body.vin, model: body.model, lastPost: lastOf[b.id], area: b.from });
    }
    return out;
  }

  equipmentSnapshot() {
    return Object.values(this.eq).map((e) => ({ ...e }));
  }

  kitSnapshot() {
    return KITS.map((k) => ({ kitId: k.id, model: k.model, qty: this.kits[k.id]!, shiftsLeft: this.kits[k.id]! / kitNeedPerShift(k.model) }));
  }

  get filterB2Dp() {
    return filterDp(this.filterB2);
  }

  // ---------------------------------------------------------------------------

  step(dt: number) {
    const t0 = this.t;
    const t1 = t0 + dt;
    this.runScheduled(t1);
    this.crossings(t0, t1);

    if (this.shift && t1 >= this.shift.endMs) this.endShift();
    if (!this.shift) {
      const s = shiftAt(t1);
      if (s) this.startShift(s);
    }

    this.equipmentTick(t0, t1, dt);
    if (this.shift) {
      this.process(t1, dt);
      this.move(t1, dt);
      this.release(t1, dt);
      this.accountStops(dt);
      this.cameras(t1);
    }
    this.telemetry(t1);
    this.t = t1;
  }

  private emit(e: WorldEvent) {
    this.out.push(e);
  }

  drain(): WorldEvent[] {
    const out = this.out;
    this.out = [];
    return out;
  }

  private runScheduled(t1: number) {
    if (!this.scheduled.length) return;
    const due = this.scheduled.filter((s) => s.at <= t1).sort((a, b) => a.at - b.at);
    this.scheduled = this.scheduled.filter((s) => s.at > t1);
    for (const s of due) s.run();
  }

  /** Поставки на склад в 07:00, отчёт склада раз в час */
  private crossings(t0: number, t1: number) {
    const p0 = plantParts(t0);
    const p1 = plantParts(t1);
    if (p0.hour !== p1.hour || p0.date !== p1.date) {
      if (p1.hour === CAL.kitDeliveryHour) this.deliver(t1);
      if (p1.hour >= 6) this.stockReport(t1);
    }
  }

  private deliver(t: number) {
    const p = plantParts(t);
    if (p.weekday > 6) return;
    for (const k of KITS) {
      if (this.delayed.some((d) => d.kitId === k.id && d.untilMs > t)) continue;
      const target = Math.round(CAL.kitTargetShifts * kitNeedPerShift(k.model));
      if (this.kits[k.id]! < target) this.kits[k.id] = target;
    }
  }

  private stockReport(t: number) {
    for (const s of this.kitSnapshot()) this.emit({ kind: 'stock', t, ...s });
  }

  private startShift(s: ShiftRef) {
    this.shift = s;
    this.dayFactor = this.rng.range(0.78, 1.22);
    this.stats = {
      shift: s,
      output: { weld: 0, paint: 0, assembly: 0, qc: 0 },
      stoppedMin: { weld: 0, paint: 0, assembly: 0, qc: 0 },
      defects: { weld: 0, paint: 0, assembly: 0 },
    };
    // Обрыв цепи готовится заранее: износ виден по току и вибрации привода (ступень 2)
    if (this.preset.randomFailures && this.chainBreakAt === null) {
      const chain = CAL.failures.find((f) => f.equipment.includes('CONV-03'))!;
      if (this.rng.chance(chain.perDay / 2)) this.chainBreakAt = s.startMs + this.rng.range(60, 470) * MIN;
    }
    if (this.releaseTimer > 0) this.releaseTimer = 0;
  }

  private endShift() {
    if (!this.shift || !this.stats) return;
    this.emit({ kind: 'shift_end', t: this.shift.endMs, stats: this.stats });
    this.shift = null;
    this.stats = null;
  }

  // ---------------------------------------------------------------------------
  // Оборудование: окончание остановок, случайные отказы, микропростои

  private running(eqId: string) {
    return this.eq[eqId]!.status === 'run';
  }

  startDowntime(
    eqId: string,
    at: number,
    minutes: number,
    info: { reason: string; category: DowntimeCategoryId; code?: string; text?: string; micro?: boolean; status?: EqStatus; onEnd?: Eq['onEnd'] },
  ) {
    const e = this.eq[eqId]!;
    if (e.down) return false;
    const status: EqStatus = info.status ?? (info.category === 'planned' ? 'maintenance' : 'fault');
    const down: DowntimeInfo = {
      id: `dt-${++this.downSeq}`,
      equipmentId: eqId,
      area: e.area,
      reason: info.reason,
      category: info.category,
      code: info.code,
      text: info.text,
      from: at,
      micro: info.micro ?? false,
    };
    e.down = down;
    e.status = status;
    e.downUntil = at + minutes * MIN;
    e.onEnd = info.onEnd;
    this.emit({ kind: 'state', t: at, equipmentId: eqId, area: e.area, status, code: info.code, text: info.text ?? info.reason });
    this.emit({ kind: 'downtime_start', t: at, info: down });
    return true;
  }

  private endDowntime(e: Eq, at: number) {
    const down = e.down!;
    e.down = null;
    e.status = 'run';
    this.emit({ kind: 'state', t: at, equipmentId: e.id, area: e.area, status: 'run' });
    this.emit({ kind: 'downtime_end', t: at, info: down, to: at });
    this.stopNotified.delete(e.id);
    if (e.onEnd === 'filter_b2') this.filterB2 = 0;
    if (e.onEnd === 'robot_service') {
      e.cycles = 0;
      this.emit({ kind: 'counter', t: at, equipmentId: e.id, area: e.area, cycles: 0, total: e.total });
    }
    e.onEnd = undefined;
  }

  private hazard(e: Eq): number {
    const interval = EQUIPMENT_BY_ID[e.id]?.serviceIntervalCycles;
    if (!interval) return 1;
    const ratio = e.cycles / interval;
    return ratio > 0.9 ? 1 + 25 * (ratio - 0.9) : 1;
  }

  private equipmentTick(_t0: number, t1: number, dt: number) {
    for (const e of Object.values(this.eq)) {
      if (e.down && t1 >= e.downUntil) this.endDowntime(e, e.downUntil);
    }
    if (!this.shift) return;
    if (this.chainBreakAt !== null && t1 >= this.chainBreakAt) {
      const f = CAL.failures.find((x) => x.equipment.includes('CONV-03'))!;
      const minutes = Math.max(35, Math.min(80, this.rng.normal(f.meanMin, f.sdMin)));
      this.startDowntime('CONV-03', this.chainBreakAt, minutes, { reason: f.reason, category: f.category, code: f.code, text: f.text, onEnd: 'chain_fixed' });
      this.chainBreakAt = null;
    }
    const dayMs = 16 * 60 * MIN;
    if (this.preset.randomFailures) {
      for (const f of CAL.failures) {
        if (f.equipment.includes('CONV-03')) continue;
        for (const id of f.equipment) {
          const e = this.eq[id]!;
          if (e.down) continue;
          if (this.rng.chance((f.perDay * dt * this.hazard(e)) / dayMs)) {
            const minutes = Math.max(f.meanMin * 0.5, Math.min(f.meanMin * 1.6, this.rng.normal(f.meanMin, f.sdMin)));
            this.startDowntime(id, t1, minutes, { reason: f.reason, category: f.category, code: f.code, text: f.text });
          }
        }
      }
    }
    if (this.preset.microStops) {
      const shiftMs = 480 * MIN;
      for (const m of CAL.microStops) {
        const e = this.eq[m.equipment]!;
        if (e.down) continue;
        if (this.rng.chance((m.perShift * dt) / shiftMs)) {
          this.startDowntime(m.equipment, t1, this.rng.range(m.minMin, m.maxMin), {
            reason: 'Микропростой',
            category: 'breakdown',
            code: m.code,
            text: m.text,
            micro: true,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Поток кузовов

  private process(t1: number, dt: number) {
    for (const p of this.posts) {
      if (!p.body || p.doneAt !== null || !this.running(p.eq)) continue;
      p.remaining -= dt;
      if (p.remaining <= 0) {
        p.doneAt = t1 + p.remaining;
        this.complete(p, p.doneAt);
      }
    }
  }

  private complete(p: Post, at: number) {
    const body = p.body!;
    this.emit({ kind: 'pass', t: at, vin: body.vin, model: body.model, post: p.id, area: p.area, equipmentId: p.eq });
    const e = this.eq[p.eq]!;
    if (p.area === 'weld') {
      e.cycles++;
      e.total++;
      if (e.cycles % 10 === 0) this.emit({ kind: 'counter', t: at, equipmentId: e.id, area: e.area, cycles: e.cycles, total: e.total });
    }
    switch (p.id) {
      case 'WELD-4':
        if (this.rng.chance(CAL.defects.weld * this.dayFactor)) {
          this.defect(body, at, 'CP-WELD', 'weld', 'weld', this.rng.weighted([['weld_geometry', 0.6], ['weld_spot', 0.4]] as const), 'rework');
        }
        break;
      case 'PAINT-B1':
        this.filterB1++;
        break;
      case 'PAINT-B2': {
        body.dpAtB2 = this.filterB2Dp;
        this.filterB2++;
        if (this.filterB2Dp >= CAL.filter.limitPa && !this.eq['BOOTH-02']!.down) {
          this.startDowntime('BOOTH-02', at, CAL.filter.forcedMin, {
            reason: 'Замена фильтра (вынужденная)',
            category: 'breakdown',
            code: 'F-450',
            text: 'Перепад на фильтре достиг предела',
            status: 'maintenance',
            onEnd: 'filter_b2',
          });
        }
        break;
      }
      case 'PAINT-OVEN': {
        body.repaint = false;
        this.dirtAcc += CAL.defects.paintDirt(body.dpAtB2);
        if (this.dirtAcc >= this.dirtThreshold) {
          this.dirtAcc -= this.dirtThreshold;
          this.dirtThreshold = this.rng.range(0.7, 1.3);
          this.defect(body, at, 'CP-PAINT', 'paint', 'paint', 'paint_dirt', 'repaint');
          body.repaint = true;
        } else if (this.rng.chance(CAL.defects.paintOther)) {
          this.defect(body, at, 'CP-PAINT', 'paint', 'paint', this.rng.chance(0.6) ? 'paint_run' : 'paint_thin', 'repaint');
          body.repaint = true;
        }
        break;
      }
      case 'ASM-1':
        this.kits[kitId(body.model, 'HARNESS')]!--;
        this.kits[kitId(body.model, 'INTERIOR')]!--;
        break;
      case 'QC-1':
        if (this.rng.chance(CAL.defects.assemblyFinal * this.dayFactor)) {
          this.defect(body, at, 'CP-FINAL', 'qc', 'assembly', this.rng.weighted([['asm_gap', 0.5], ['asm_torque', 0.3], ['asm_electric', 0.2]] as const), 'rework');
        }
        break;
      case 'QC-2':
        if (this.rng.chance(CAL.defects.assemblyTrack * this.dayFactor)) {
          this.defect(body, at, 'CP-TRACK', 'qc', 'assembly', this.rng.chance(0.5) ? 'asm_torque' : 'asm_electric', 'rework');
        }
        break;
      case 'QC-3':
        if (this.rng.chance(CAL.defects.assemblyRain * this.dayFactor)) {
          this.defect(body, at, 'CP-RAIN', 'qc', 'assembly', 'asm_leak', 'rework');
        }
        break;
    }
  }

  private defect(body: Body, at: number, checkpoint: string, area: AreaId, responsible: 'weld' | 'paint' | 'assembly', defect: string, decision: Decision) {
    this.emit({ kind: 'defect', t: at, vin: body.vin, model: body.model, checkpoint, area, responsible, defect, decision });
    if (this.stats) this.stats.defects[responsible]++;
  }

  private transfer(from: Post, to: Post, t1: number, dt: number) {
    const carry = Math.max(0, Math.min(dt, t1 - (from.doneAt ?? t1)));
    to.body = from.body;
    to.remaining = to.cycleMs - carry;
    to.doneAt = null;
    from.body = null;
    from.doneAt = null;
  }

  private load(post: Post, body: Body) {
    post.body = body;
    post.remaining = post.cycleMs;
    post.doneAt = null;
  }

  private free(post: Post) {
    post.body = null;
    post.doneAt = null;
  }

  private move(t1: number, dt: number) {
    const { weld, paint, assembly, qc } = this.byArea;
    const s = this.stats!;

    // ОТК → склад готовой продукции
    for (let i = qc.length - 1; i >= 0; i--) {
      const p = qc[i]!;
      if (!p.body || p.doneAt === null) continue;
      if (i === qc.length - 1) {
        this.emit({ kind: 'pass', t: p.doneAt, vin: p.body.vin, model: p.body.model, post: 'FG-IN', area: 'finished' });
        s.output.qc++;
        this.free(p);
      } else if (!qc[i + 1]!.body) this.transfer(p, qc[i + 1]!, t1, dt);
    }
    if (!qc[0]!.body && this.buf['assembly-qc'].length) this.load(qc[0]!, this.buf['assembly-qc'].shift()!);

    // Сборка
    for (let i = assembly.length - 1; i >= 0; i--) {
      const p = assembly[i]!;
      if (!p.body || p.doneAt === null) continue;
      if (i === assembly.length - 1) {
        if (this.buf['assembly-qc'].length < cap('assembly-qc')) {
          this.buf['assembly-qc'].push(p.body);
          s.output.assembly++;
          this.free(p);
        }
      } else if (!assembly[i + 1]!.body) this.transfer(p, assembly[i + 1]!, t1, dt);
    }
    const asm1 = assembly[0]!;
    if (!asm1.body && this.buf['paint-assembly'].length) {
      const next = this.buf['paint-assembly'][0]!;
      if (this.kits[kitId(next.model, 'HARNESS')]! > 0 && this.kits[kitId(next.model, 'INTERIOR')]! > 0) {
        this.load(asm1, this.buf['paint-assembly'].shift()!);
        if (this.kitsBlocked) {
          this.kitsBlocked = false;
          if (this.eq['CONV-03']!.down?.category === 'no_parts') this.eq['CONV-03']!.downUntil = t1;
        }
      } else if (!this.kitsBlocked) {
        this.kitsBlocked = true;
        const kit = KIT_BY_ID[kitId(next.model, this.kits[kitId(next.model, 'HARNESS')]! > 0 ? 'INTERIOR' : 'HARNESS')]!;
        this.startDowntime('CONV-03', t1, 600, { reason: `Нет комплектов: ${kit.name}`, category: 'no_parts', status: 'idle' });
      }
    }

    // Окраска: после сушки — контроль; брак уходит на повторную окраску в Камеру-02
    const [pre, b1, b2, oven] = paint as [Post, Post, Post, Post];
    if (oven.body && oven.doneAt !== null) {
      if (oven.body.repaint) {
        this.repaintQueue.push(oven.body);
        this.free(oven);
      } else if (this.buf['paint-assembly'].length < cap('paint-assembly')) {
        this.buf['paint-assembly'].push(oven.body);
        s.output.paint++;
        this.free(oven);
      }
    }
    if (b2.body && b2.doneAt !== null && !oven.body) this.transfer(b2, oven, t1, dt);
    if (!b2.body && this.repaintQueue.length && this.running('BOOTH-02')) {
      const body = this.repaintQueue.shift()!;
      body.repaint = false;
      this.load(b2, body);
    }
    if (b1.body && b1.doneAt !== null && !b2.body) this.transfer(b1, b2, t1, dt);
    if (pre.body && pre.doneAt !== null && !b1.body) this.transfer(pre, b1, t1, dt);
    if (!pre.body && this.buf['weld-paint'].length) this.load(pre, this.buf['weld-paint'].shift()!);

    // Сварка
    for (let i = weld.length - 1; i >= 0; i--) {
      const p = weld[i]!;
      if (!p.body || p.doneAt === null) continue;
      if (i === weld.length - 1) {
        if (this.buf['weld-paint'].length < cap('weld-paint')) {
          this.buf['weld-paint'].push(p.body);
          s.output.weld++;
          this.free(p);
        }
      } else if (!weld[i + 1]!.body) this.transfer(p, weld[i + 1]!, t1, dt);
    }
  }

  private release(_t1: number, dt: number) {
    this.releaseTimer -= dt;
    const w1 = this.byArea.weld[0]!;
    if (this.releaseTimer > 0 || w1.body || !this.running(w1.eq)) return;
    const body = this.newBody(this.serial++);
    this.load(w1, body);
    const catchUp = this.buf['weld-paint'].length < CAL.weldBufferTarget;
    this.releaseTimer = (catchUp ? CAL.releaseCatchUpMin : CAL.taktMin) * MIN;
  }

  /** Время, когда участок стоял из-за своего оборудования — для сменного отчёта */
  private accountStops(dt: number) {
    const s = this.stats!;
    for (const a of AREA_KEYS) {
      const down = this.byArea[a].some((p) => this.eq[p.eq]!.down !== null);
      if (down) s.stoppedMin[a] += dt / MIN;
    }
  }

  /** Видеоаналитика: линия стоит дольше минуты, очередь перед участком */
  private cameras(t1: number) {
    for (const e of Object.values(this.eq)) {
      if (!e.down || e.down.micro || this.stopNotified.has(e.id)) continue;
      if (t1 - e.down.from >= MIN) {
        this.stopNotified.add(e.id);
        this.emit({ kind: 'line_stopped', t: t1, area: e.area, equipmentId: e.id });
      }
    }
    for (const b of BUFFERS) {
      const full = this.buf[b.id].length >= Math.ceil(b.capacity * 0.85);
      if (full && !this.queueNotified.has(b.id)) {
        this.queueNotified.add(b.id);
        this.emit({ kind: 'queue', t: t1, area: b.to, count: this.buf[b.id].length });
      } else if (!full && this.buf[b.id].length < b.capacity * 0.5) this.queueNotified.delete(b.id);
    }
  }

  private telemetry(t1: number) {
    const minute = Math.floor(t1 / MIN);
    if (minute === this.lastTelemetryMin) return;
    this.lastTelemetryMin = minute;
    if (!this.shift && plantParts(t1).minute % 10 !== 0) return;
    const at = minute * MIN;
    const noise = () => this.rng.range(-2.5, 2.5);
    this.emit({ kind: 'telemetry', t: at, equipmentId: 'BOOTH-02', area: 'paint', metric: 'filter_dp_pa', value: round1(this.filterB2Dp + noise()) });
    this.emit({
      kind: 'telemetry',
      t: at,
      equipmentId: 'BOOTH-01',
      area: 'paint',
      metric: 'filter_dp_pa',
      value: round1(CAL.filter.cleanPa + (this.filterB1 / CAL.filterB1LifeBodies) * 150 + noise()),
    });
    const c = CAL.conveyor;
    let wear = 0;
    if (this.chainBreakAt !== null) {
      const lead = (this.chainBreakAt - at) / MIN;
      if (lead >= 0 && lead <= c.warnLeadMin) wear = Math.pow(1 - lead / c.warnLeadMin, 1.5);
    }
    const conveyorStopped = this.eq['CONV-03']!.status !== 'run' || !this.shift;
    this.emit({
      kind: 'telemetry',
      t: at,
      equipmentId: 'CONV-03',
      area: 'assembly',
      metric: 'motor_current_a',
      value: conveyorStopped ? round1(this.rng.range(0, 0.4)) : round1(c.currentA + wear * c.currentRiseA + this.rng.range(-0.35, 0.35)),
    });
    this.emit({
      kind: 'telemetry',
      t: at,
      equipmentId: 'CONV-03',
      area: 'assembly',
      metric: 'vibration_mm_s',
      value: conveyorStopped ? round1(this.rng.range(0.1, 0.3)) : round1(c.vibration + wear * c.vibrationRise + this.rng.range(-0.15, 0.15)),
    });
  }

  // ---------------------------------------------------------------------------
  // Наряды от двойника выполняют «люди завода» в назначенное время

  applyWorkOrder(wo: WorkOrder) {
    const at = Math.max(this.t, Date.parse(wo.scheduledAt));
    const minutes = wo.durationMin ?? 0;
    const done = () => this.emit({ kind: 'work_done', t: Math.max(this.t, at), workOrderId: wo.workOrderId, title: wo.title });
    switch (wo.action) {
      case 'replace_filter':
        this.scheduled.push({
          at,
          run: () => {
            if (this.eq['BOOTH-02']!.down) this.endDowntime(this.eq['BOOTH-02']!, Math.max(this.t, at));
            this.startDowntime('BOOTH-02', Math.max(this.t, at), minutes || CAL.filter.plannedMin, {
              reason: 'Замена фильтра (по наряду)',
              category: 'planned',
              status: 'maintenance',
              onEnd: 'filter_b2',
            });
            done();
          },
        });
        break;
      case 'maintenance':
        if (!wo.equipmentId) return;
        this.scheduled.push({
          at,
          run: () => {
            this.startDowntime(wo.equipmentId!, Math.max(this.t, at), minutes || 30, {
              reason: 'Плановое ТО (по наряду)',
              category: 'planned',
              onEnd: EQUIPMENT_BY_ID[wo.equipmentId!]?.kind === 'robot' ? 'robot_service' : undefined,
            });
            done();
          },
        });
        break;
      case 'inspect':
      case 'repair':
        if (!wo.equipmentId) return;
        this.scheduled.push({
          at,
          run: () => {
            if (wo.equipmentId === 'CONV-03') this.chainBreakAt = null;
            this.startDowntime(wo.equipmentId!, Math.max(this.t, at), minutes || 20, {
              reason: wo.action === 'inspect' ? 'Осмотр и замена цепи (по наряду)' : 'Ремонт (по наряду)',
              category: 'planned',
            });
            done();
          },
        });
        break;
      case 'resequence':
        this.noJ7Until = Number(wo.params?.untilMs ?? at + 24 * 60 * MIN);
        done();
        break;
      case 'expedite_parts': {
        const kit = String(wo.params?.kitId ?? '');
        this.scheduled.push({
          at,
          run: () => {
            if (KIT_BY_ID[kit]) {
              this.kits[kit] = Math.round(CAL.kitTargetShifts * kitNeedPerShift(KIT_BY_ID[kit]!.model));
              this.delayed = this.delayed.filter((d) => d.kitId !== kit);
              this.stockReport(Math.max(this.t, at));
            }
            done();
          },
        });
        break;
      }
      case 'none':
        break;
    }
  }

  /** Сценарий: заранее запланированное событие */
  schedule(at: number, run: (w: World) => void) {
    this.scheduled.push({ at, run: () => run(this) });
  }
}

function cap(id: BufferId): number {
  return BUFFERS.find((b) => b.id === id)!.capacity;
}

function kitId(model: ModelId, kind: 'HARNESS' | 'INTERIOR'): string {
  return `KIT-${model.toUpperCase()}-${kind}`;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
