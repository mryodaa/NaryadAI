// Трекер кузовов: где каждый кузов, какие операции по нему выполнены, сколько он на месте против
// нормы. Чистая логика без сети. Вход — события 1С и контроллеров (заказ, отметки в точках, результаты
// операций, VIN, несоответствия, проходы постов 1С:MES); выход — положение, маршрут, история и флаги.
// Грязные данные: пропущенная отметка достраивается (restored), отметка не по порядку не применяется
// и уходит в «Противоречия в данных», повтор той же отметки в течение 60 с игнорируется, повторный
// законный проход (перекраска) открывает маршрут участка заново.
import {
  ID_METHOD_DEF,
  MODEL_BY_ID,
  OPERATIONS,
  VISUAL_EFFECTS,
  modelOperations,
  stationsFor,
  toPlantIso,
  type BodyDetail,
  type BodyFlag,
  type BodyHistoryItem,
  type BodyLocation,
  type BodyView,
  type IdMethod,
  type ModelId,
  type PlantModel,
  type PlantStage,
  type RouteStatus,
  type RouteStep,
  type SourceId,
  type VisualEffect,
} from '@allur/contracts';

/** Повтор той же отметки в течение этого времени — дубль */
const DUP_MS = 60_000;
/** Отметка дальше по маршруту, но раньше последней отметки больше чем на это — противоречие */
const BACKWARDS_MS = 120_000;
/** Опоздавшая отметка прошлого участка допустима в этих пределах (человек сканирует с задержкой) */
const LATE_MS = 5 * 60_000;
/** Восстановленная отметка становится флагом, если её не подтвердили за это время */
const RESTORED_GRACE_MS = 5 * 60_000;
/** Задержка: дольше нормы во столько раз */
const DELAY_FACTOR = 1.5;

export interface TrackStep extends RouteStep {
  status: RouteStatus;
  at: number | null;
  by: 'operation' | 'station_out' | 'stage_exit' | 'assumed' | null;
  source: string | null;
  loop: number;
}

export interface TrackHistory {
  ts: number;
  kind: BodyHistoryItem['kind'];
  text: string;
  stageId?: string;
  checkpointId?: string;
  equipmentId?: string;
  method?: IdMethod | null;
  source: string;
  restored?: boolean;
  /** Что именно восстановлено: вход или выход участка — для подтверждения опоздавшей отметкой */
  mark?: 'entry' | 'exit';
}

export interface TrackedBody {
  bodyId: string;
  vin: string | null;
  model: ModelId | null;
  colorCode: string | null;
  trim: string | null;
  plannedSeq: number | null;
  /** Индекс участка в plant.stages; −1 — ещё нигде не отмечен */
  stageIdx: number;
  /** Участок пройден (кузов в буфере после него или в пути на следующий) */
  exited: boolean;
  loc: BodyLocation;
  since: number;
  lastTs: number;
  /** Порядок прихода на текущее место */
  order: number;
  route: TrackStep[];
  stations: Record<string, string>;
  stageTimes: Record<string, { in?: number; out?: number }>;
  /** Проходы участков по порядку (с петлями перекраски) — для ленты стадий в паспорте */
  passes: { stageId: string; loop: number; in?: number; out?: number }[];
  history: TrackHistory[];
  lastMarks: Map<string, number>;
  nonconformity: boolean;
  rework: number;
  finished: boolean;
  /** Выходы участков, уже учтённые счётчиками: «участок#петля» */
  exitsCounted: Set<string>;
}

/** Переход, который видят счётчики двойника: вход и выход участка, отметка у оборудования */
export interface TrackTransition {
  kind: 'entry' | 'exit' | 'mark';
  body: TrackedBody;
  stageId: string;
  ts: number;
  equipmentId?: string;
  postId?: string;
  pointId?: string;
  restored: boolean;
}

export interface TrackContradiction {
  ts: number;
  bodyId: string;
  vin: string | null;
  text: string;
}

/** Куда указывает событие: участок и что произошло */
interface Target {
  stageIdx: number;
  kind: 'entry' | 'exit' | 'in' | 'out';
  equipmentId?: string;
  postId?: string;
  pointId?: string;
  method: IdMethod | null;
  source: string;
  ts: number;
  label: string;
}

export class BodyTracker {
  bodies = new Map<string, TrackedBody>();
  private byVin = new Map<string, string>();
  contradictions: TrackContradiction[] = [];
  duplicates = 0;
  private seq = 0;
  /** Подписчик на переходы — счётчики выпуска, буферов и качества в состоянии двойника */
  onTransition: ((t: TrackTransition) => void) | null = null;

  constructor(private plant: PlantModel) {}

  setPlant(plant: PlantModel) {
    this.plant = plant;
  }

  reset() {
    this.bodies.clear();
    this.byVin.clear();
    this.contradictions = [];
    this.duplicates = 0;
  }

  // ---------------------------------------------------------------------------
  // Вход: события

  order(o: { bodyId: string; vin?: string; model: ModelId; colorCode?: string; trim?: string; plannedSeq?: number; ts: number; source: string }) {
    const b = this.body(o.bodyId, o.vin, o.ts);
    b.model = o.model;
    b.colorCode = o.colorCode ?? null;
    b.trim = o.trim ?? null;
    b.plannedSeq = o.plannedSeq ?? null;
    if (!b.route.length) b.route = this.buildRoute(b);
    const color = o.colorCode ? this.plant.colorByCode.get(o.colorCode) : undefined;
    this.log(b, { ts: o.ts, kind: 'order', text: `Заказ: ${MODEL_BY_ID[o.model].name}${color ? `, ${color.name}` : o.colorCode ? `, цвет ${o.colorCode}` : ''}`, source: o.source });
    if (b.stageIdx < 0 && this.plant.warehouseIn) {
      b.stageIdx = this.plant.warehouseIn.index;
      this.place(b, { kind: 'warehouse', stageId: this.plant.warehouseIn.id, precision: 'stage', estimated: false }, o.ts);
      // на складе — с момента заказа: машинокомплект ждёт выдачи
      this.pass(b, this.plant.warehouseIn.id, 'in', o.ts);
    }
  }

  vinAssigned(bodyId: string, vin: string, ts: number, source: string) {
    const b = this.body(bodyId, vin, ts);
    if (b.vin !== vin) {
      b.vin = vin;
      this.byVin.set(vin, b.bodyId);
    }
    this.log(b, { ts, kind: 'vin', text: `Нанесён VIN ${vin}`, source });
  }

  /** Отметка в точке из конфигурации завода */
  checkpoint(c: { bodyId?: string; vin?: string; checkpointId: string; direction: 'in' | 'out'; postId?: string; ts: number; source: string }): boolean {
    const p = this.plant.pointById.get(c.checkpointId);
    if (!p) return false;
    const stage = this.plant.stageById.get(p.stageId);
    if (!stage) return false;
    const b = this.body(c.bodyId ?? null, c.vin, c.ts);
    let kind: Target['kind'];
    if (p.role === 'stage_entry') kind = c.direction === 'in' ? 'entry' : 'in';
    else if (p.role === 'stage_exit') kind = c.direction === 'out' ? 'exit' : 'in';
    else kind = c.direction;
    const equipmentId = p.equipmentId ?? undefined;
    const postId = c.postId ?? (equipmentId ? this.plant.equipmentById.get(equipmentId)?.posts[0]?.id : undefined);
    this.apply(b, { stageIdx: stage.index, kind, equipmentId, postId, pointId: p.id, method: p.method, source: c.source, ts: c.ts, label: p.name });
    return true;
  }

  /** Проход поста 1С:MES (прежний формат): пост → вход, выход участка или отметка у оборудования */
  postPassed(vin: string, model: ModelId, postId: string, ts: number, source: string) {
    const post = this.plant.postById.get(postId);
    if (!post) return;
    const stage = this.plant.stageById.get(post.stageId)!;
    const b = this.body(null, vin, ts);
    if (!b.model) {
      b.model = model;
      b.route = this.buildRoute(b);
    }
    const base = { stageIdx: stage.index, equipmentId: post.equipmentId, postId, pointId: postId, method: 'mes_scan' as const, source, ts, label: post.name };
    if (stage.kind === 'warehouse_out') return this.apply(b, { ...base, kind: 'entry' });
    if (stage.entryPosts.includes(postId)) this.apply(b, { ...base, kind: 'entry' });
    const side = stage.sides.find((x) => x.inPost === postId || x.returnPost === postId);
    // пост приёма в стороне от потока — кузов там; пост 1С — кузов прошёл его
    this.apply(b, { ...base, kind: side && side.inPost === postId ? 'in' : 'out' });
    if (stage.exitPosts.includes(postId) || stage.returnPosts.includes(postId)) this.apply(b, { ...base, kind: 'exit', ts: ts + 1 });
  }

  operation(o: { bodyId?: string; vin?: string; equipmentId: string; operation: string; result: 'ok' | 'nok'; details?: string; ts: number; source: string }) {
    const e = this.plant.equipmentById.get(o.equipmentId);
    if (!e) return;
    const stage = this.plant.stageById.get(e.stageId)!;
    const b = this.body(o.bodyId ?? null, o.vin, o.ts);
    const point = this.plant.points.find((p) => p.equipmentId === e.id);
    // результат операции — значит кузов на этом оборудовании
    this.apply(b, { stageIdx: stage.index, kind: 'in', equipmentId: e.id, postId: e.posts[0]?.id, pointId: point?.id, method: 'tool_result', source: o.source, ts: o.ts, label: e.name }, true);
    const step = this.openStep(b, (s) => s.operation === o.operation && s.equipmentId === e.id) ?? this.openStep(b, (s) => s.operation === o.operation && s.stageId === stage.id);
    if (step) this.done(step, o.result === 'ok' ? 'done' : 'failed', o.ts, 'operation', o.source);
    const name = OPERATIONS[o.operation]?.name ?? o.operation;
    if (o.result === 'nok') b.nonconformity = true;
    this.log(b, { ts: o.ts, kind: 'operation', text: `${name}: ${o.result === 'ok' ? 'выполнено' : 'не выполнено'}${o.details ? ` — ${o.details}` : ''}`, stageId: stage.id, equipmentId: e.id, source: o.source, method: 'tool_result' });
  }

  /** Несоответствие 1С:QLS: перекраска открывает маршрут окраски заново */
  nonconformity(vin: string | undefined, area: string, decision: 'rework' | 'repaint' | 'scrap', text: string, ts: number, source: string) {
    if (!vin) return;
    const id = this.byVin.get(vin);
    const b = id ? this.bodies.get(id) : undefined;
    if (!b) return;
    b.nonconformity = true;
    this.log(b, { ts, kind: 'nonconformity', text, stageId: area, source });
    if (decision !== 'repaint') return;
    const stage = this.plant.stageById.get(area);
    if (!stage) return;
    this.reopen(b, stage, ts, source);
  }

  // ---------------------------------------------------------------------------
  // Выход: представления

  /** Кузова для сцены: всё, что в цехе, и последние принятые на склад готовой продукции */
  views(now: number, finishedLimit = 12): BodyView[] {
    const out: BodyView[] = [];
    const finished: TrackedBody[] = [];
    for (const b of this.bodies.values()) {
      if (b.finished) finished.push(b);
      else if (now - b.lastTs < 16 * 3600_000) out.push(this.view(b, now));
    }
    finished.sort((a, b) => b.since - a.since);
    for (const b of finished.slice(0, finishedLimit)) out.push(this.view(b, now));
    return out;
  }

  view(b: TrackedBody, now: number): BodyView {
    const color = b.colorCode ? this.plant.colorByCode.get(b.colorCode) : undefined;
    const norm = this.normAt(b);
    const est = b.loc.precision === 'stage' && b.loc.kind === 'stage' ? this.estimate(b, now) : null;
    const flags: BodyFlag[] = [];
    if (norm && b.loc.kind !== 'buffer' && b.loc.kind !== 'warehouse' && b.loc.kind !== 'finished' && now - b.since > norm * 1000 * DELAY_FACTOR) flags.push('delayed');
    if (b.nonconformity) flags.push('nonconformity');
    if (b.rework > 0) flags.push('rework');
    if (b.history.some((h) => h.restored && now - h.ts > RESTORED_GRACE_MS)) flags.push('restored_checkpoint');
    if (b.model && !color) flags.push('unknown_color');
    return {
      bodyId: b.bodyId,
      vin: b.vin,
      model: b.model ?? 'onix',
      color: color ? { code: color.code, name: color.name, hex: color.hex, finish: color.finish } : null,
      loc: est ? { ...b.loc, equipmentId: est.equipmentId ?? undefined, postId: est.postId ?? undefined, estimated: true } : b.loc,
      since: toPlantIso(b.since),
      stageSince: (b.loc.kind === 'stage' || b.loc.kind === 'station') && b.stageTimes[b.loc.stageId]?.in !== undefined ? toPlantIso(b.stageTimes[b.loc.stageId]!.in!) : null,
      normSec: norm,
      visual: this.visual(b, est?.doneIdx ?? -1),
      flags,
      order: b.order,
    };
  }

  detail(b: TrackedBody, now: number): BodyDetail {
    return {
      ...this.view(b, now),
      plannedSeq: b.plannedSeq,
      trim: b.trim,
      stages: b.passes.map((p) => ({ stageId: p.stageId, loop: p.loop, in: p.in === undefined ? null : toPlantIso(p.in), out: p.out === undefined ? null : toPlantIso(p.out) })),
      route: b.route.map((s) => ({
        operation: s.operation,
        name: OPERATIONS[s.operation]?.name ?? s.operation,
        stageId: s.stageId,
        equipmentId: s.equipmentId,
        postId: s.postId,
        status: s.status,
        at: s.at === null ? null : toPlantIso(s.at),
        by: s.by,
        source: s.source,
        effect: s.effect,
        optional: s.optional,
        loop: s.loop,
      })),
      history: b.history.map((h) => ({ at: toPlantIso(h.ts), kind: h.kind, text: h.text, stageId: h.stageId, checkpointId: h.checkpointId, equipmentId: h.equipmentId, method: h.method, source: h.source, restored: h.restored })),
    };
  }

  /**
   * Поиск по всем кузовам, которые знает трекер, — и тем, что давно на складе готовой продукции:
   * часть VIN (последние 4–6 знаков) или номера кузова. Совпадение в конце VIN — выше, затем свежие.
   */
  search(query: string, now: number, limit = 20): BodyView[] {
    const q = query.toUpperCase().replace(/[^0-9A-Z-]/g, '');
    if (q.length < 3) return [];
    const hits: { b: TrackedBody; rank: number }[] = [];
    for (const b of this.bodies.values()) {
      const vin = b.vin ?? '';
      const rank = vin.endsWith(q) ? 0 : vin.includes(q) ? 1 : b.bodyId.toUpperCase().includes(q) ? 2 : -1;
      if (rank >= 0) hits.push({ b, rank });
    }
    hits.sort((x, y) => x.rank - y.rank || y.b.lastTs - x.b.lastTs);
    return hits.slice(0, limit).map((h) => this.view(h.b, now));
  }

  find(idOrVin: string): TrackedBody | undefined {
    return this.bodies.get(idOrVin) ?? this.bodies.get(this.byVin.get(idOrVin) ?? '');
  }

  // ---------------------------------------------------------------------------
  // Ядро: применение отметки

  private body(bodyId: string | null, vin: string | undefined, ts: number): TrackedBody {
    let id = bodyId ?? (vin ? this.byVin.get(vin) : undefined) ?? null;
    // кузов известен по VIN под другим номером — связываем
    if (bodyId && vin && !this.bodies.has(bodyId) && this.byVin.has(vin)) id = this.byVin.get(vin)!;
    if (!id) id = vin ?? `BODY-${++this.seq}`;
    let b = this.bodies.get(id);
    if (!b) {
      b = {
        bodyId: id,
        vin: vin ?? null,
        model: null,
        colorCode: null,
        trim: null,
        plannedSeq: null,
        stageIdx: -1,
        exited: false,
        loc: { kind: 'warehouse', stageId: this.plant.warehouseIn?.id ?? '', precision: 'stage', estimated: false },
        since: ts,
        lastTs: ts,
        order: ++this.seq,
        route: [],
        stations: {},
        stageTimes: {},
        passes: [],
        history: [],
        lastMarks: new Map(),
        nonconformity: false,
        rework: 0,
        finished: false,
        exitsCounted: new Set(),
      };
      this.bodies.set(id, b);
    }
    if (vin && !b.vin) b.vin = vin;
    if (vin) this.byVin.set(vin, b.bodyId);
    return b;
  }

  private buildRoute(b: TrackedBody): TrackStep[] {
    if (!b.model) return [];
    return modelOperations(this.plant, b.model, b.stations).map((s) => ({ ...s, status: 'waiting' as RouteStatus, at: null, by: null, source: null, loop: 0 }));
  }

  private apply(b: TrackedBody, t: Target, quiet = false) {
    // 1. Дубль: та же отметка в течение 60 с
    const key = `${t.pointId ?? ''}|${t.kind}|${t.equipmentId ?? ''}|${t.postId ?? ''}`;
    const last = b.lastMarks.get(key);
    if (last !== undefined && Math.abs(t.ts - last) < DUP_MS) {
      if (!quiet) {
        this.duplicates++;
        this.log(b, { ts: t.ts, kind: 'duplicate', text: `Повтор отметки «${t.label}» — не учтён`, checkpointId: t.pointId, source: t.source, method: t.method });
      }
      return;
    }
    b.lastMarks.set(key, t.ts);
    const stages = this.plant.stages;
    const target = stages[t.stageIdx]!;

    // 2. Первое событие по кузову: всё до этого места кузов прошёл до начала отслеживания
    if (b.stageIdx < 0 || (b.loc.kind === 'warehouse' && t.stageIdx > b.stageIdx && b.history.every((h) => h.kind === 'order' || h.kind === 'vin'))) {
      const first = b.stageIdx < 0;
      for (let i = Math.max(0, b.stageIdx); i < t.stageIdx; i++) this.closeStage(b, stages[i]!, t.ts, 'assumed', t.source, !first && i === b.stageIdx);
      b.stageIdx = t.stageIdx;
      b.exited = false;
      // вход на участок, где кузов застало начало отслеживания, — известен до него, это не пропуск
      if (t.kind !== 'entry') this.enter(b, target, t.ts, t.source, 'assumed');
    } else if (t.stageIdx > b.stageIdx) {
      // 3. Дальше по маршруту
      if (t.ts < b.lastTs - BACKWARDS_MS) {
        this.contradict(b, t, `«${t.label}» отмечен в ${hmOf(t.ts)} — раньше, чем кузов прошёл «${stages[b.stageIdx]!.short}» (${hmOf(b.lastTs)}). Отметка не применена`);
        return;
      }
      if (!b.exited) this.exitStage(b, stages[b.stageIdx]!, t.ts, t.source, true);
      for (let i = b.stageIdx + 1; i < t.stageIdx; i++) {
        const s = stages[i]!;
        this.enter(b, s, t.ts, t.source, 'restored');
        this.exitStage(b, s, t.ts, t.source, true);
      }
      b.stageIdx = t.stageIdx;
      b.exited = false;
      if (t.kind !== 'entry') this.enter(b, target, t.ts, t.source, 'soft');
    } else if (t.stageIdx < b.stageIdx) {
      // 4. Опоздавшая отметка прошлого участка: подтверждает восстановленную или идёт в историю
      const mark = t.kind === 'entry' ? 'entry' : t.kind === 'exit' ? 'exit' : null;
      const restored = mark ? b.history.find((h) => h.restored && h.stageId === target.id && h.mark === mark) : undefined;
      if (restored) {
        restored.restored = false;
        restored.text = `${t.label} (отметка пришла с опозданием)`;
        restored.source = t.source;
        restored.method = t.method;
        return;
      }
      const next = stages[t.stageIdx + 1];
      const nextIn = next ? b.stageTimes[next.id]?.in : undefined;
      if (nextIn === undefined || t.ts <= nextIn + LATE_MS) {
        this.log(b, { ts: t.ts, kind: 'checkpoint', text: `${t.label} (отметка пришла с опозданием)`, stageId: target.id, checkpointId: t.pointId, equipmentId: t.equipmentId, method: t.method, source: t.source });
        return;
      }
      this.contradict(b, t, `«${t.label}» отмечен в ${hmOf(t.ts)}, а кузов уже на «${stages[b.stageIdx]!.short}». Отметка не применена`);
      return;
    } else if (b.exited) {
      // 5. Тот же участок после выхода: опоздавшая отметка или повторный проход (перекраска)
      const out = b.stageTimes[target.id]?.out ?? 0;
      const aside = t.equipmentId ? this.plant.equipmentById.get(t.equipmentId)?.place === 'side' : false;
      if (aside) {
        // выборочная операция после выхода участка (лаборатория, полировка): кузов снова на участке, не петля
        b.exited = false;
      } else if (t.ts <= out + DUP_MS || t.kind === 'exit') {
        this.log(b, { ts: t.ts, kind: 'checkpoint', text: `${t.label} (отметка пришла с опозданием)`, stageId: target.id, checkpointId: t.pointId, equipmentId: t.equipmentId, method: t.method, source: t.source });
        return;
      } else {
        this.reopen(b, target, t.ts, t.source);
        if (t.kind !== 'entry') this.enter(b, target, t.ts, t.source, null);
      }
    }

    // 6. Применяем на участке
    b.lastTs = Math.max(b.lastTs, t.ts);
    switch (t.kind) {
      case 'entry':
        this.enter(b, target, t.ts, t.source, null, t);
        break;
      case 'exit':
        this.exitStage(b, target, t.ts, t.source, false, t);
        break;
      case 'in':
        this.atEquipment(b, target, t);
        break;
      case 'out':
        this.leftEquipment(b, target, t);
        break;
    }
  }

  /** Вход на участок. soft — выведен из отметки на оборудовании (подтвердится опоздавшим сканом), restored — пропущен */
  private enter(b: TrackedBody, stage: PlantStage, ts: number, source: string, how: 'soft' | 'restored' | 'assumed' | null, t?: Target) {
    const times = (b.stageTimes[stage.id] ??= {});
    const already = b.loc.stageId === stage.id && b.loc.kind !== 'buffer' && b.loc.kind !== 'warehouse' && times.in !== undefined && !b.exited;
    if (already) {
      // кузов уже на участке (по отметке оборудования) — скан входа подтверждает восстановленный вход
      if (t) {
        const r = b.history.find((h) => h.restored && h.stageId === stage.id && h.mark === 'entry');
        if (r) {
          r.restored = false;
          r.text = t.label;
          r.source = source;
          r.method = t.method;
        }
      }
      return;
    }
    times.in = ts;
    times.out = undefined;
    this.pass(b, stage.id, 'in', ts);
    b.exited = false;
    if (stage.kind === 'warehouse_out') {
      b.finished = true;
      for (const s of b.route) if (s.stageId === stage.id && s.status !== 'done') this.done(s, 'done', ts, 'stage_exit', source);
      this.place(b, { kind: 'finished', stageId: stage.id, precision: 'stage', estimated: false }, ts);
    } else {
      this.place(b, { kind: 'stage', stageId: stage.id, precision: 'stage', estimated: false }, ts);
    }
    const restored = how === 'restored' || how === 'soft';
    this.log(b, {
      ts,
      kind: restored ? 'restored' : 'checkpoint',
      text: restored ? `Вход «${stage.name}» — отметки нет, восстановлено по маршруту` : how === 'assumed' ? `На участке «${stage.name}» к началу отслеживания` : (t?.label ?? `Вход «${stage.name}»`),
      stageId: stage.id,
      checkpointId: t?.pointId,
      method: t?.method ?? null,
      source,
      restored,
      mark: 'entry',
    });
    this.onTransition?.({ kind: 'entry', body: b, stageId: stage.id, ts, restored, pointId: t?.pointId });
  }

  private exitStage(b: TrackedBody, stage: PlantStage, ts: number, source: string, restored: boolean, t?: Target) {
    if (b.exited && b.loc.stageId === stage.id) return;
    this.closeStage(b, stage, ts, 'stage_exit', source, false);
    const times = (b.stageTimes[stage.id] ??= {});
    // выход участка в этой петле уже учтён (кузов вернулся из лаборатории) — только место
    const counted = `${stage.id}#${this.loopOf(b, stage.id)}`;
    const again = b.exitsCounted.has(counted);
    b.exitsCounted.add(counted);
    times.out = ts;
    this.pass(b, stage.id, 'out', ts);
    b.exited = true;
    this.place(b, { kind: 'buffer', stageId: stage.id, bufferId: stage.bufferAfter?.id, precision: 'stage', estimated: false }, ts);
    this.log(b, {
      ts,
      kind: restored ? 'restored' : 'checkpoint',
      text: restored ? `Выход «${stage.name}» — отметки нет, восстановлено по маршруту` : (t?.label ?? `Выход «${stage.name}»`),
      stageId: stage.id,
      checkpointId: t?.pointId,
      method: t?.method ?? null,
      source,
      restored,
      mark: 'exit',
    });
    if (!again) this.onTransition?.({ kind: 'exit', body: b, stageId: stage.id, ts, restored, pointId: t?.pointId });
  }

  /** Операции участка, не подтверждённые отдельно, считаются выполненными; выборочные без отметки — пропущены */
  private closeStage(b: TrackedBody, stage: PlantStage, ts: number, by: 'stage_exit' | 'assumed', source: string, exitTransition: boolean) {
    for (const s of b.route) {
      if (s.stageId !== stage.id || s.status === 'done' || s.status === 'failed' || s.status === 'skipped') continue;
      if (s.optional && s.status === 'waiting') s.status = 'skipped';
      else this.done(s, 'done', ts, by, by === 'assumed' ? 'до начала отслеживания' : source);
    }
    if (exitTransition) {
      (b.stageTimes[stage.id] ??= {}).out = ts;
      this.pass(b, stage.id, 'out', ts);
      this.onTransition?.({ kind: 'exit', body: b, stageId: stage.id, ts, restored: false });
    }
  }

  private atEquipment(b: TrackedBody, stage: PlantStage, t: Target) {
    const e = t.equipmentId ? this.plant.equipmentById.get(t.equipmentId) : undefined;
    if (!e) return;
    // станция кузова на участке: по отметке оборудования (параллельные станции)
    if (e.stationId && b.stations[stage.id] !== e.stationId && stage.stations.length > 1) {
      b.stations[stage.id] = e.stationId;
      this.rebindStage(b, stage);
    }
    const idx = b.route.findIndex((s) => s.stageId === stage.id && s.loop === this.loopOf(b, stage.id) && (s.postId === t.postId || s.equipmentId === e.id));
    if (idx >= 0) {
      // кузов здесь — значит прошёл всё, что раньше на участке (кроме выборочного)
      for (let i = 0; i < idx; i++) {
        const s = b.route[i]!;
        if (s.stageId !== stage.id || s.loop !== b.route[idx]!.loop || s.status === 'done' || s.status === 'failed' || s.status === 'skipped') continue;
        if (s.optional) s.status = s.status === 'in_progress' ? 'done' : 'skipped';
        else this.done(s, 'done', t.ts, 'station_out', t.source);
      }
      for (const s of b.route) if (s.stageId === stage.id && s.loop === b.route[idx]!.loop && (s.postId === t.postId || (!t.postId && s.equipmentId === e.id)) && s.status === 'waiting') s.status = 'in_progress';
    }
    this.place(b, { kind: 'station', stageId: stage.id, equipmentId: e.id, postId: t.postId, precision: 'station', estimated: false }, t.ts);
    this.log(b, { ts: t.ts, kind: 'checkpoint', text: t.label, stageId: stage.id, checkpointId: t.pointId, equipmentId: e.id, method: t.method, source: t.source });
    this.onTransition?.({ kind: 'mark', body: b, stageId: stage.id, ts: t.ts, equipmentId: e.id, postId: t.postId, pointId: t.pointId, restored: false });
  }

  private leftEquipment(b: TrackedBody, stage: PlantStage, t: Target) {
    const e = t.equipmentId ? this.plant.equipmentById.get(t.equipmentId) : undefined;
    if (!e) return;
    const loop = this.loopOf(b, stage.id);
    for (const s of b.route) {
      if (s.stageId !== stage.id || s.loop !== loop || s.equipmentId !== e.id || s.status === 'done' || s.status === 'failed') continue;
      this.done(s, 'done', t.ts, 'station_out', t.source);
    }
    // после выхода с оборудования кузов на участке; место известно до станции, пока не отметят дальше
    this.place(b, { kind: 'station', stageId: stage.id, equipmentId: e.id, postId: t.postId, precision: 'station', estimated: false }, b.loc.equipmentId === e.id ? b.since : t.ts);
    this.log(b, { ts: t.ts, kind: 'checkpoint', text: `${t.label}: кузов ушёл`, stageId: stage.id, checkpointId: t.pointId, equipmentId: e.id, method: t.method, source: t.source });
    this.onTransition?.({ kind: 'mark', body: b, stageId: stage.id, ts: t.ts, equipmentId: e.id, postId: t.postId, pointId: t.pointId, restored: false });
  }

  /** Повторный проход участка (перекраска): шаги с первого цветного — заново, новая петля */
  private reopen(b: TrackedBody, stage: PlantStage, ts: number, source: string) {
    const loop = this.loopOf(b, stage.id) + 1;
    const steps = b.route.filter((s) => s.stageId === stage.id && s.loop === loop - 1);
    if (!steps.length) return;
    const from = Math.max(0, steps.findIndex((s) => s.effect === 'color'));
    const copies = steps.slice(from).map((s) => ({ ...s, status: 'waiting' as RouteStatus, at: null, by: null, source: null, loop }));
    const lastIdx = b.route.lastIndexOf(steps[steps.length - 1]!);
    b.route.splice(lastIdx + 1, 0, ...copies);
    b.rework++;
    if (b.exited && b.loc.stageId === stage.id) {
      b.exited = false;
      b.stageIdx = stage.index;
      this.place(b, { kind: 'stage', stageId: stage.id, precision: 'stage', estimated: false }, ts);
    }
    this.log(b, { ts, kind: 'rework', text: `Повторный проход «${stage.name}» (${loop + 1}-й)`, stageId: stage.id, source });
  }

  /** Перестроить шаги участка под станцию кузова (другая параллельная станция) */
  private rebindStage(b: TrackedBody, stage: PlantStage) {
    if (!b.model) return;
    const fresh = modelOperations(this.plant, b.model, b.stations).filter((s) => s.stageId === stage.id);
    const old = b.route.filter((s) => s.stageId === stage.id);
    const at = b.route.findIndex((s) => s.stageId === stage.id);
    if (at < 0) return;
    const merged = fresh.map((s) => {
      const prev = old.find((o) => o.operation === s.operation && o.loop === 0 && o.status !== 'waiting' && (o.equipmentId === s.equipmentId || !s.stationId));
      return prev ? { ...s, status: prev.status, at: prev.at, by: prev.by, source: prev.source, loop: 0 } : { ...s, status: 'waiting' as RouteStatus, at: null, by: null, source: null, loop: 0 };
    });
    b.route.splice(at, old.length, ...merged);
  }

  /** Запись прохода участка: вход открывает проход текущей петли, выход закрывает последний */
  private pass(b: TrackedBody, stageId: string, kind: 'in' | 'out', ts: number) {
    const loop = this.loopOf(b, stageId);
    const last = [...b.passes].reverse().find((p) => p.stageId === stageId);
    if (kind === 'in') {
      if (last && last.loop === loop && last.out === undefined) return;
      b.passes.push({ stageId, loop, in: ts });
    } else if (last && last.out === undefined) last.out = ts;
    else if (!last || last.loop !== loop) b.passes.push({ stageId, loop, out: ts });
    else last.out = ts;
  }

  private loopOf(b: TrackedBody, stageId: string): number {
    let l = 0;
    for (const s of b.route) if (s.stageId === stageId && s.loop > l) l = s.loop;
    return l;
  }

  private openStep(b: TrackedBody, pred: (s: TrackStep) => boolean): TrackStep | undefined {
    return b.route.find((s) => pred(s) && s.status !== 'done' && s.status !== 'failed') ?? [...b.route].reverse().find(pred);
  }

  private done(s: TrackStep, status: 'done' | 'failed', ts: number, by: TrackStep['by'], source: string) {
    s.status = status;
    s.at = ts;
    s.by = by;
    s.source = source;
  }

  private place(b: TrackedBody, loc: BodyLocation, ts: number) {
    const moved = b.loc.kind !== loc.kind || b.loc.stageId !== loc.stageId || b.loc.equipmentId !== loc.equipmentId || b.loc.postId !== loc.postId;
    b.loc = loc;
    if (moved) {
      b.since = ts;
      b.order = ++this.seq;
    }
    b.lastTs = Math.max(b.lastTs, ts);
  }

  private log(b: TrackedBody, h: TrackHistory) {
    b.history.push(h);
    if (b.history.length > 400) b.history.splice(0, b.history.length - 400);
  }

  private contradict(b: TrackedBody, t: Target, text: string) {
    this.contradictions.push({ ts: t.ts, bodyId: b.bodyId, vin: b.vin, text });
    if (this.contradictions.length > 200) this.contradictions.splice(0, this.contradictions.length - 200);
    this.log(b, { ts: t.ts, kind: 'checkpoint', text: `Противоречие: ${text}`, stageId: this.plant.stages[t.stageIdx]?.id, checkpointId: t.pointId, method: t.method, source: t.source });
  }

  // ---------------------------------------------------------------------------
  // Норма, оценка места и вид кузова

  /** Норма на текущем месте, с */
  private normAt(b: TrackedBody): number | null {
    if (b.loc.kind === 'station' && b.loc.equipmentId) {
      const steps = b.route.filter((s) => s.equipmentId === b.loc.equipmentId && (!b.loc.postId || s.postId === b.loc.postId));
      const n = steps.reduce((a, s) => a + s.normSec, 0);
      return n > 0 ? n : (this.plant.equipmentById.get(b.loc.equipmentId)?.cycleSec ?? null);
    }
    if (b.loc.kind === 'stage') {
      const loop = this.loopOf(b, b.loc.stageId);
      const n = b.route.filter((s) => s.stageId === b.loc.stageId && !s.optional && s.loop === loop).reduce((a, s) => a + s.normSec, 0);
      return n > 0 ? n : null;
    }
    return null;
  }

  /** Точность до участка: где кузов по норме времени — оценка, а не отметка */
  private estimate(b: TrackedBody, now: number): { equipmentId: string | null; postId: string | null; doneIdx: number } {
    const loop = this.loopOf(b, b.loc.stageId);
    let t = (now - b.since) / 1000;
    let pick: TrackStep | null = null;
    let doneIdx = -1;
    b.route.forEach((s, i) => {
      if (s.stageId !== b.loc.stageId || s.optional || s.loop !== loop || pick) return;
      if (t < s.normSec) pick = s;
      else {
        t -= s.normSec;
        doneIdx = i;
      }
    });
    const last = pick ?? [...b.route].reverse().find((s) => s.stageId === b.loc.stageId && !s.optional && s.loop === loop) ?? null;
    return { equipmentId: (last as TrackStep | null)?.equipmentId ?? null, postId: (last as TrackStep | null)?.postId ?? null, doneIdx };
  }

  /** Накопленные визуальные эффекты выполненных операций (и оцененных по времени до doneIdx) */
  private visual(b: TrackedBody, estDoneIdx: number): VisualEffect[] {
    const set = new Set<VisualEffect>();
    b.route.forEach((s, i) => {
      if (s.effect && (s.status === 'done' || i <= estDoneIdx)) set.add(s.effect);
    });
    // на складе — комплект, на склад ГП — готовая машина
    if (b.loc.kind === 'warehouse') set.add('kit');
    return VISUAL_EFFECTS.filter((e) => set.has(e));
  }
}

function hmOf(ms: number): string {
  return toPlantIso(ms).slice(11, 16);
}

/** Какой системой отмечено — для подписи в паспорте */
export function methodSource(m: IdMethod | null): SourceId | null {
  return m ? ID_METHOD_DEF[m].source : null;
}

export { stationsFor };
