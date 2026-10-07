// Физическая модель цеха — «настоящий» цех прототипа. Её видят все имитаторы (1С, контроллеры,
// камеры, склад), каждый со своей стороны и со своими задержками. Ядро двойника её не видит:
// оно знает о цехе только то, что пришло по сети.
// Топология — из конфигурации завода: участки по потоку, на каждом общее оборудование на входе,
// параллельные станции (кузов проходит оборудование станции по порядку) и общее на выходе.
import {
  KITS,
  KIT_BY_ID,
  MODELS,
  SEED_PLANT,
  colorMix,
  derivePlant,
  makeVin,
  plantParts,
  shiftAt,
  stageOfKind,
  type AreaId,
  type BufferId,
  type DowntimeCategoryId,
  type EquipmentTypeDef,
  type MetricId,
  type ModelId,
  type PlantConfig,
  type PlantModel,
  type PlantStage,
  type SamplingDef,
  type ShiftRef,
  type WorkOrder,
} from '@allur/contracts';
import { CAL, MIN, SHIFT_PLAN, filterModelOf, type FilterModel } from './calibration';
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
  /** Кузовов, ушедших с участка за смену (с ОТК — на склад готовой продукции) */
  output: Record<AreaId, number>;
  stoppedMin: Record<AreaId, number>;
  /** Брак по участку-виновнику */
  defects: Record<AreaId, number>;
}

export type WorldEvent =
  | { kind: 'pass'; t: number; vin: string; model: ModelId; post: string; area: AreaId; equipmentId?: string; body: BodyRef }
  /** Производственный заказ: кузов заказан, машинокомплект ждёт на складе */
  | { kind: 'order'; t: number; body: BodyRef }
  /** Машинокомплект выдан на сварку */
  | { kind: 'kit'; t: number; body: BodyRef }
  /** Кузов вошёл на участок и вышел с него (в буфер или на склад готовой продукции) */
  | { kind: 'enter' | 'exit'; t: number; body: BodyRef; area: AreaId }
  /** Кузов пришёл на пост и ушёл с него (тележка у считывателя RFID, позиция на конвейере) */
  | { kind: 'arrive' | 'leave'; t: number; body: BodyRef; post: string; area: AreaId; equipmentId: string }
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

/** Кузов для имитаторов систем завода: номер, VIN, модель и цвет заказа */
export interface BodyRef {
  bodyId: string;
  vin: string;
  model: ModelId;
  colorCode: string;
  serial: number;
}

interface Body {
  bodyId: string;
  vin: string;
  model: ModelId;
  colorCode: string;
  serial: number;
  /** Перепад на фильтре камеры, от которого зависит сорность, — в момент прохода кузова */
  dirtDp: number;
  repaint: boolean;
  /** Выбран на выборочную операцию в стороне от потока (код оборудования) */
  pendingSide?: string;
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
  onEnd?: 'filter' | 'robot_service' | 'chain_fixed';
  cycles: number;
  total: number;
}

interface Filter {
  bodies: number;
  model: FilterModel;
}

/** Участок в модели: общее на входе → параллельные станции → общее на выходе */
interface StageSim {
  stage: PlantStage;
  inlet: Post[];
  stations: Post[][];
  /** Всё оборудование каждой станции — станция стоит, если встало любое */
  stationEq: string[][];
  /** Принадлежности станции без своего поста (окрасочный робот, гайковёрт): без них посты станции не работают */
  stationAcc: string[][];
  /** Пост → номер станции */
  stationOf: Map<Post, number>;
  outlet: Post[];
  posts: Post[];
  bufIn: BufferId | null;
  bufOut: BufferId | null;
  capOut: number;
  first: boolean;
  /** Следующий — склад готовой продукции */
  last: boolean;
  /** Окраска: пост последней камеры станции, куда возвращается кузов на перекраску */
  repaintPosts: Set<Post>;
  /** Какие модели принимает станция (по индексу станции); null — любые */
  stationModels: (ModelId[] | null)[];
  /** В стороне от потока: лаборатория, полигон, полировка */
  sides: SideSim[];
}

/** Оборудование в стороне от потока: кузов уходит туда после поста after и возвращается */
interface SideSim {
  id: string;
  after: Post | null;
  inPost: string | null;
  returnPost: string | null;
  atExit: boolean;
  slots: number;
  minutes: [number, number];
  sampling: SamplingDef | null;
  inside: { body: Body; until: number }[];
  done: Body[];
  /** Сколько кузовов прошло пост after (для «каждый N-й») и сколько взято за сутки */
  seen: number;
  day: string;
  today: number;
}

export interface WorldPreset {
  startMs: number;
  seed: number;
  randomFailures: boolean;
  microStops: boolean;
  /** Кузовов через фильтр с последней замены — по камерам окраски */
  filterBodies: Record<string, number>;
  robotCycles: Record<string, number>;
  buffers: Record<BufferId, number>;
  /** Остаток комплектов, смен */
  kitShifts: Record<string, number>;
  /** Поставка комплекта не придёт до этого момента */
  delayedDeliveries: { kitId: string; untilMs: number }[];
  /** Обрыв цепи конвейера в заданный момент (сценарий) — по коду конвейера */
  chainBreakAt?: Record<string, number>;
  serial: number;
}

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

/** Перепад на фильтре по модели засорения камеры */
function dpOf(f: Filter): number {
  return f.model.kind === 'clog' ? filterDp(f.bodies) : CAL.filter.cleanPa + (f.bodies / f.model.lifeBodies) * f.model.risePa;
}

export class World {
  t: number;
  readonly rng: Rng;
  private plant: PlantModel;
  private stages: StageSim[] = [];
  private stageById = new Map<string, StageSim>();
  private posts: Post[] = [];
  private buf: Record<BufferId, Body[]> = {};
  private repaintQueue: Record<AreaId, Body[]> = {};
  private eq: Record<string, Eq> = {};
  private filters: Record<string, Filter> = {};
  private kits: Record<string, number> = {};
  private serial: number;
  private releaseTimer = 0;
  /** Время текущего шага — для событий прихода и ухода с постов */
  private tNow = 0;
  /** Заказанные кузова: по одному машинокомплекту каждой модели ждёт на складе */
  private pendingKit: Partial<Record<ModelId, Body>> = {};
  private colorRng: Rng;
  private patternIdx = 0;
  /** Перестановка очереди: модель пропускаем до момента (решение по дефициту комплектов) */
  private resequence: { model: ModelId; until: number } | null = null;
  /** Выборка кузовов на выборочные операции — отдельный поток случайных чисел */
  private sampleRng: Rng;
  private shift: ShiftRef | null = null;
  private stats: ShiftStats | null = null;
  private dayFactor = 1;
  private chainBreakAt: Record<string, number | null> = {};
  private scheduled: { at: number; run: () => void }[] = [];
  private delayed: { kitId: string; untilMs: number }[];
  private downSeq = 0;
  private lastTelemetryMin = -1;
  private stopNotified = new Set<string>();
  private queueNotified = new Set<string>();
  /** Модели без машинокомплекта: код оборудования их линии, которое стоит «нет деталей» */
  private kitsBlocked: Partial<Record<ModelId, string | null>> = {};
  /** Сорность — «рассеянием ошибки»: реальная доля брака плавно следует за вероятностью */
  private dirtAcc: number;
  private dirtThreshold: number;
  readonly preset: WorldPreset;
  out: WorldEvent[] = [];

  constructor(preset: WorldPreset, plant: PlantConfig = SEED_PLANT) {
    this.preset = preset;
    this.t = preset.startMs;
    this.rng = new Rng(preset.seed);
    this.sampleRng = new Rng(preset.seed ^ 0x2545f491);
    this.colorRng = new Rng(preset.seed ^ 0x7f4a7c15);
    this.tNow = preset.startMs;
    this.serial = preset.serial;
    this.delayed = [...preset.delayedDeliveries];
    this.dirtAcc = this.rng.next();
    this.dirtThreshold = this.rng.range(0.7, 1.3);
    this.plant = derivePlant(plant);

    for (const e of this.plant.equipment) {
      if (e.passive) continue;
      this.eq[e.id] = { id: e.id, area: e.stageId, status: 'run', downUntil: 0, down: null, cycles: preset.robotCycles[e.id] ?? 0, total: 40000 + (preset.robotCycles[e.id] ?? 0) };
      if (e.type.fields.includes('filterDpPa')) this.filters[e.id] = { bodies: preset.filterBodies[e.id] ?? 0, model: filterModelOf(e.id) };
      if (scheduledFailure(e.type)) this.chainBreakAt[e.id] = preset.chainBreakAt?.[e.id] ?? null;
    }
    this.build();
    for (const k of KITS) this.kits[k.id] = Math.round((preset.kitShifts[k.id] ?? CAL.kitTargetShifts) * kitNeedPerShift(k.model));
    this.fillWip(preset.buffers);
    for (const m of MODELS) this.orderKit(m.id);
  }

  /** Посты, станции и буферы по конфигурации завода */
  private build() {
    const plant = this.plant;
    const old = new Map(this.posts.map((p) => [p.id, p]));
    const oldSides = new Map(this.stages.flatMap((s) => s.sides.map((x) => [x.id, x] as const)));
    this.stages = [];
    this.posts = [];
    const production = plant.production;
    for (const stage of production) {
      const mk = (eqIds: string[]) =>
        eqIds.flatMap((id) => {
          const e = plant.equipmentById.get(id)!;
          return e.posts.map((p): Post => {
            const prev = old.get(p.id);
            const cycleMs = (e.cycleSec ?? 240) * 1000;
            return prev ? { ...prev, area: stage.id, eq: e.id, cycleMs } : { id: p.id, area: stage.id, eq: e.id, cycleMs, body: null, remaining: 0, doneAt: null };
          });
        });
      const inlet = mk(stage.inlet.map((e) => e.id));
      const stations = stage.stations.map((st) => mk(st.equipment.map((e) => e.id))).filter((ch) => ch.length > 0);
      const withPosts = stage.stations.filter((st) => st.posts.length > 0);
      const stationEq = withPosts.map((st) => st.equipment.filter((e) => !e.passive).map((e) => e.id));
      const stationAcc = withPosts.map((st) => st.equipment.filter((e) => !e.passive && e.posts.length === 0).map((e) => e.id));
      const stationOf = new Map<Post, number>();
      stations.forEach((ch, i) => ch.forEach((p) => stationOf.set(p, i)));
      const outlet = mk(stage.outlet.map((e) => e.id));
      const stationModels = withPosts.map((st) => st.models);
      const repaintPosts = new Set<Post>();
      if (stage.kind === 'painting') {
        for (const ch of stations) {
          const booths = ch.filter((p) => plant.equipmentById.get(p.eq)?.type.id === 'paint_booth');
          const last = booths[booths.length - 1];
          if (last) repaintPosts.add(last);
        }
        this.repaintQueue[stage.id] ??= [];
      }
      const sim: StageSim = {
        stage,
        inlet,
        stations,
        stationEq,
        stationAcc,
        stationOf,
        outlet,
        posts: [...inlet, ...stations.flat(), ...outlet],
        bufIn: stage.bufferBefore?.id ?? null,
        bufOut: stage.bufferAfter?.id ?? null,
        capOut: stage.bufferAfter?.capacity ?? 0,
        first: stage === production[0],
        last: plant.stageById.get(stage.bufferAfter?.to ?? '')?.kind === 'warehouse_out' || production[production.length - 1] === stage,
        repaintPosts,
        stationModels,
        sides: [],
      };
      const byId = new Map(sim.posts.map((p) => [p.id, p]));
      sim.sides = stage.sides.map((x): SideSim => {
        const prev = oldSides.get(x.equipment.id);
        oldSides.delete(x.equipment.id);
        const def = x.equipment.type.side;
        return {
          id: x.equipment.id,
          after: x.after ? (byId.get(x.after) ?? null) : null,
          inPost: x.inPost,
          returnPost: x.returnPost,
          atExit: x.atExit,
          slots: def?.slots ?? 1,
          minutes: def?.minutes ?? [10, 20],
          sampling: def?.sampling ?? null,
          inside: prev?.inside ?? [],
          done: prev?.done ?? [],
          seen: prev?.seen ?? 0,
          day: prev?.day ?? '',
          today: prev?.today ?? 0,
        };
      });
      this.stages.push(sim);
      this.posts.push(...sim.posts);
    }
    this.stageById = new Map(this.stages.map((s) => [s.stage.id, s]));
    for (const b of plant.buffers) this.buf[b.id] ??= [];
    // кузова с убранного оборудования в стороне — в первый буфер после участка
    for (const side of oldSides.values()) {
      const bodies = [...side.inside.map((x) => x.body), ...side.done];
      const target = this.stages.find((st) => st.bufOut)?.bufOut;
      if (target && bodies.length) this.buf[target]!.push(...bodies);
    }
  }

  /**
   * Новый состав цеха без остановки смены: кузова на сохранившихся постах остаются, с убранных
   * постов возвращаются в очередь перед участком; состояние оборудования и фильтров сохраняется.
   */
  reconfigure(plant: PlantConfig) {
    const was = new Map(this.posts.map((p) => [p.id, p]));
    const wasBuf = this.buf;
    this.plant = derivePlant(plant);
    for (const e of this.plant.equipment) {
      if (e.passive) continue;
      if (!this.eq[e.id]) this.eq[e.id] = { id: e.id, area: e.stageId, status: 'run', downUntil: 0, down: null, cycles: 0, total: 40000 };
      else this.eq[e.id]!.area = e.stageId;
      if (e.type.fields.includes('filterDpPa') && !this.filters[e.id]) this.filters[e.id] = { bodies: 0, model: filterModelOf(e.id) };
      if (scheduledFailure(e.type) && !(e.id in this.chainBreakAt)) this.chainBreakAt[e.id] = null;
    }
    const keep = new Set(this.plant.equipment.map((e) => e.id));
    for (const id of Object.keys(this.eq)) if (!keep.has(id)) delete this.eq[id];
    for (const id of Object.keys(this.filters)) if (!keep.has(id)) delete this.filters[id];
    for (const id of Object.keys(this.chainBreakAt)) if (!keep.has(id)) delete this.chainBreakAt[id];
    this.buf = {};
    this.build();
    // буферы сохраняем по коду; кузова пропавших буферов — в очередь перед тем же участком
    for (const [id, bodies] of Object.entries(wasBuf)) {
      if (this.buf[id]) this.buf[id]!.push(...bodies);
      else {
        const to = id.split('-').slice(1).join('-');
        const target = this.stageById.get(to)?.bufIn;
        if (target) this.buf[target]!.push(...bodies);
      }
    }
    for (const [id, p] of was) {
      if (!p.body || this.posts.some((x) => x.id === id)) continue;
      const sim = this.stageById.get(p.area);
      if (sim?.bufIn) this.buf[sim.bufIn]!.unshift(p.body);
    }
  }

  /** Незавершёнка на начало дня: посты заняты, буферы частично заполнены */
  private fillWip(buffers: Record<BufferId, number>) {
    const order: (Post | BufferId)[] = [];
    for (let i = this.stages.length - 1; i >= 0; i--) {
      const s = this.stages[i]!;
      order.push(...s.posts.slice().reverse());
      if (s.bufIn) order.push(s.bufIn);
    }
    let serial = this.serial - 1 - order.reduce((n, o) => n + (typeof o === 'string' ? (buffers[o] ?? 0) : 1), 0);
    for (const o of order) {
      if (typeof o === 'string') {
        for (let i = 0; i < (buffers[o] ?? 0); i++) this.buf[o]!.push(this.newBody(++serial, true));
      } else {
        o.body = this.newBody(++serial, true, this.stationModelsOf(o));
        o.remaining = this.rng.range(0.1, 1) * o.cycleMs;
      }
    }
  }

  /** Модель по плану на следующий такт, с учётом перестановки очереди */
  private plannedModel(): ModelId {
    const model = MIX_PATTERN[this.patternIdx % MIX_PATTERN.length]!;
    const r = this.resequence;
    if (r && model === r.model && this.t < r.until) {
      const others = MODELS.map((m) => m.id).filter((m) => m !== r.model);
      return others[(this.patternIdx + 1) % others.length]!;
    }
    return model;
  }

  /** Новый кузов незавершёнки; на станции под модели — модель этой станции */
  private newBody(serial: number, _wip = true, allowed: ModelId[] | null = null): Body {
    let model = MIX_PATTERN[this.patternIdx % MIX_PATTERN.length]!;
    this.patternIdx++;
    if (allowed && !allowed.includes(model)) model = allowed[0]!;
    return this.makeBody(model, serial);
  }

  /** Кузов с номером, VIN и цветом заказа (цвет — по долям спроса на модель) */
  private makeBody(model: ModelId, serial: number): Body {
    const mix = colorMix(this.plant.colors, model);
    const colorCode = mix.length ? this.colorRng.weighted(mix.map((c) => [c.code, c.share] as const)) : '';
    return { bodyId: `B-${String(serial).padStart(5, '0')}`, vin: makeVin(model, serial), model, colorCode, serial, dirtDp: 0, repaint: false };
  }

  /** Заказ 1С на следующий кузов модели: машинокомплект готовится на складе */
  private orderKit(model: ModelId) {
    const body = this.makeBody(model, this.serial++);
    this.pendingKit[model] = body;
    this.emit({ kind: 'order', t: this.tNow, body: ref(body) });
  }

  /** Какие модели принимает станция, к которой относится пост */
  private stationModelsOf(post: Post): ModelId[] | null {
    const s = this.stageById.get(post.area);
    const i = s?.stationOf.get(post);
    return s && i !== undefined ? (s.stationModels[i] ?? null) : null;
  }

  private accepts(s: StageSim, station: number, model: ModelId): boolean {
    const m = s.stationModels[station];
    return !m || m.includes(model);
  }

  /** Предыдущий пост по маршруту кузова — для снимка незавершёнки в 1С:MES */
  private prevPost(s: StageSim, p: Post): Post | null {
    const prevStage = () => {
      const i = this.stages.indexOf(s);
      const up = i > 0 ? this.stages[i - 1]! : null;
      if (!up) return null;
      const exit = up.stage.exitPosts[0];
      return up.posts.find((x) => x.id === exit) ?? null;
    };
    const k = s.inlet.indexOf(p);
    if (k > 0) return s.inlet[k - 1]!;
    if (k === 0) return prevStage();
    for (const ch of s.stations) {
      const j = ch.indexOf(p);
      if (j > 0) return ch[j - 1]!;
      if (j === 0) return s.inlet.length ? s.inlet[s.inlet.length - 1]! : prevStage();
    }
    const o = s.outlet.indexOf(p);
    if (o > 0) return s.outlet[o - 1]!;
    if (o === 0) {
      const ch = s.stations[0];
      return ch?.length ? ch[ch.length - 1]! : (s.inlet[s.inlet.length - 1] ?? prevStage());
    }
    return null;
  }

  /** Где кузов сейчас: снимок незавершёнки на начало смены (на постах и в буферах) */
  wipSnapshot(): ({ body: BodyRef; area: AreaId } & ({ at: 'post'; post: string; equipmentId: string } | { at: 'buffer' }))[] {
    const out: ({ body: BodyRef; area: AreaId } & ({ at: 'post'; post: string; equipmentId: string } | { at: 'buffer' }))[] = [];
    for (const s of this.stages) {
      for (const p of s.posts) if (p.body) out.push({ body: ref(p.body), area: s.stage.id, at: 'post', post: p.id, equipmentId: p.eq });
    }
    for (const b of this.plant.buffers) for (const body of this.buf[b.id] ?? []) out.push({ body: ref(body), area: b.from, at: 'buffer' });
    return out;
  }

  /** Сколько кузовов в буферах сейчас — для сверки двойника с «правдой» имитатора */
  bufferCounts(): Record<BufferId, number> {
    return Object.fromEntries(this.plant.buffers.map((b) => [b.id, this.buf[b.id]?.length ?? 0]));
  }

  /** Выпуск участков за текущую смену */
  shiftOutput(): Record<AreaId, number> {
    return { ...(this.stats?.output ?? {}) };
  }

  /** Заказанные кузова, чьи машинокомплекты ждут на складе */
  pendingSnapshot(): BodyRef[] {
    return Object.values(this.pendingKit).map((b) => ref(b!));
  }

  equipmentSnapshot() {
    return Object.values(this.eq).map((e) => ({ ...e }));
  }

  kitSnapshot() {
    return KITS.map((k) => ({ kitId: k.id, model: k.model, qty: this.kits[k.id]!, shiftsLeft: this.kits[k.id]! / kitNeedPerShift(k.model) }));
  }

  /** Перепад на фильтре камеры сейчас */
  filterDpOf(equipmentId: string): number | null {
    const f = this.filters[equipmentId];
    return f ? dpOf(f) : null;
  }

  /** Камеры, чей перепад отдаётся в снимке контроллеров при подключении */
  filterSnapshot(): { equipmentId: string; area: AreaId; dp: number }[] {
    return Object.entries(this.filters)
      .filter(([, f]) => f.model.snapshot)
      .map(([id, f]) => ({ equipmentId: id, area: this.eq[id]?.area ?? '', dp: dpOf(f) }));
  }

  /** Текущее состояние единицы оборудования (для проверки подключения) */
  equipmentState(id: string): { status: EqStatus; code?: string; text?: string; cycles: number; total: number; dp: number | null; current: number | null; vibration: number | null } | null {
    const e = this.eq[id];
    if (!e) return null;
    const type = this.typeOf(id);
    const drive = type?.fields.includes('motorCurrentA');
    const running = e.status === 'run' && !!this.shift;
    return {
      status: e.status,
      code: e.down?.code,
      text: e.down?.text ?? e.down?.reason,
      cycles: e.cycles,
      total: e.total,
      dp: this.filterDpOf(id),
      current: drive ? (running ? CAL.conveyor.currentA : 0.2) : null,
      vibration: drive ? (running ? CAL.conveyor.vibration : 0.2) : null,
    };
  }

  // ---------------------------------------------------------------------------

  step(dt: number) {
    const t0 = this.t;
    const t1 = t0 + dt;
    this.tNow = t1;
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

  private typeOf(eqId: string): EquipmentTypeDef | undefined {
    return this.plant.equipmentById.get(eqId)?.type;
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
    const zero = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 0]));
    const production = this.stages.map((x) => x.stage.id);
    this.stats = {
      shift: s,
      output: zero(production),
      stoppedMin: zero(production),
      defects: zero(this.stages.filter((x) => x.stage.kind === 'welding' || x.stage.kind === 'painting' || x.stage.kind === 'assembly').map((x) => x.stage.id)),
    };
    // Обрыв цепи готовится заранее: износ виден по току и вибрации привода (ступень 2)
    if (this.preset.randomFailures) {
      for (const [id, at] of Object.entries(this.chainBreakAt)) {
        const chain = scheduledFailure(this.typeOf(id))!;
        if (at === null && this.rng.chance(chain.perDay / 2)) this.chainBreakAt[id] = s.startMs + this.rng.range(60, 470) * MIN;
      }
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
    const e = this.eq[eqId];
    if (!e || e.down) return false;
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
    if (e.onEnd === 'filter' && this.filters[e.id]) this.filters[e.id]!.bodies = 0;
    if (e.onEnd === 'robot_service') {
      e.cycles = 0;
      this.emit({ kind: 'counter', t: at, equipmentId: e.id, area: e.area, cycles: 0, total: e.total });
    }
    e.onEnd = undefined;
  }

  private hazard(e: Eq): number {
    const interval = this.typeOf(e.id)?.serviceIntervalCycles;
    if (!interval) return 1;
    const ratio = e.cycles / interval;
    return ratio > 0.9 ? 1 + 25 * (ratio - 0.9) : 1;
  }

  private equipmentTick(_t0: number, t1: number, dt: number) {
    for (const e of Object.values(this.eq)) {
      if (e.down && t1 >= e.downUntil) this.endDowntime(e, e.downUntil);
    }
    if (!this.shift) return;
    for (const [id, at] of Object.entries(this.chainBreakAt)) {
      if (at === null || t1 < at) continue;
      const f = scheduledFailure(this.typeOf(id))!;
      const minutes = Math.max(35, Math.min(80, this.rng.normal(f.meanMin, f.sdMin)));
      this.startDowntime(id, at, minutes, { reason: f.reason, category: f.category, code: f.code, text: f.text, onEnd: 'chain_fixed' });
      this.chainBreakAt[id] = null;
    }
    const dayMs = 16 * 60 * MIN;
    if (this.preset.randomFailures) {
      for (const e of Object.values(this.eq)) {
        for (const f of this.typeOf(e.id)?.failures ?? []) {
          if (f.perDay <= 0 || f.scheduled) continue;
          if (e.down) continue;
          if (this.rng.chance((f.perDay * dt * this.hazard(e)) / dayMs)) {
            const minutes = Math.max(f.meanMin * 0.5, Math.min(f.meanMin * 1.6, this.rng.normal(f.meanMin, f.sdMin)));
            this.startDowntime(e.id, t1, minutes, { reason: f.reason, category: f.category, code: f.code, text: f.text });
          }
        }
      }
    }
    if (this.preset.microStops) {
      const shiftMs = 480 * MIN;
      for (const m of CAL.microStops) {
        const e = this.eq[m.equipment];
        if (!e || e.down) continue;
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

  /** Пост работает, если работает его оборудование и принадлежности станции */
  private canWork(s: StageSim, p: Post): boolean {
    if (!this.running(p.eq)) return false;
    const i = s.stationOf.get(p);
    return i === undefined || s.stationAcc[i]!.every((id) => this.running(id));
  }

  private process(t1: number, dt: number) {
    for (const s of this.stages) {
      for (const side of s.sides) {
        if (!side.inside.length || !this.running(side.id)) continue;
        const ready = side.inside.filter((x) => x.until <= t1);
        if (!ready.length) continue;
        side.inside = side.inside.filter((x) => x.until > t1);
        for (const x of ready) {
          this.sideComplete(s, side, x.body, x.until);
          side.done.push(x.body);
        }
      }
      for (const p of s.posts) {
        if (!p.body || p.doneAt !== null || !this.canWork(s, p)) continue;
        p.remaining -= dt;
        if (p.remaining <= 0) {
          p.doneAt = t1 + p.remaining;
          this.complete(s, p, p.doneAt);
        }
      }
    }
  }

  private complete(s: StageSim, p: Post, at: number) {
    const body = p.body!;
    this.emit({ kind: 'pass', t: at, vin: body.vin, model: body.model, post: p.id, area: p.area, equipmentId: p.eq, body: ref(body) });
    const e = this.eq[p.eq]!;
    const type = this.typeOf(p.eq);
    if (type?.fields.includes('cycleCounter')) {
      e.cycles++;
      e.total++;
      if (e.cycles % 10 === 0) this.emit({ kind: 'counter', t: at, equipmentId: e.id, area: e.area, cycles: e.cycles, total: e.total });
    }
    const stage = s.stage;
    const exit = stage.exitPosts.includes(p.id);
    if (stage.kind === 'welding' && exit) {
      if (this.rng.chance(CAL.defects.weld * this.dayFactor)) {
        this.defect(body, at, 'CP-WELD', p.area, p.area, this.rng.weighted([['weld_geometry', 0.6], ['weld_spot', 0.4]] as const), 'rework');
      }
    }
    const f = this.filters[p.eq];
    if (f) {
      if (f.model.affectsDirt) body.dirtDp = dpOf(f);
      f.bodies++;
      if (f.model.forced && dpOf(f) >= CAL.filter.limitPa && !e.down) {
        this.startDowntime(p.eq, at, CAL.filter.forcedMin, {
          reason: 'Замена фильтра (вынужденная)',
          category: 'breakdown',
          code: 'F-450',
          text: 'Перепад на фильтре достиг предела',
          status: 'maintenance',
          onEnd: 'filter',
        });
      }
    }
    if (stage.kind === 'painting' && exit) {
      body.repaint = false;
      this.dirtAcc += CAL.defects.paintDirt(body.dirtDp);
      if (this.dirtAcc >= this.dirtThreshold) {
        this.dirtAcc -= this.dirtThreshold;
        this.dirtThreshold = this.rng.range(0.7, 1.3);
        this.defect(body, at, 'CP-PAINT', p.area, p.area, 'paint_dirt', 'repaint');
        body.repaint = true;
      } else if (this.rng.chance(CAL.defects.paintOther)) {
        this.defect(body, at, 'CP-PAINT', p.area, p.area, this.rng.chance(0.6) ? 'paint_run' : 'paint_thin', 'repaint');
        body.repaint = true;
      }
    }
    // выборочные операции в стороне от потока: лаборатория геометрии, полигон
    for (const side of s.sides) if (side.after === p && side.sampling && this.sample(side, at)) body.pendingSide = side.id;
    // ОТК находит брак сборки: испытательная линия, водяная камера, финальный осмотр (полигон — в стороне)
    const asm = stageOfKind(this.plant, 'assembly')?.id ?? p.area;
    switch (type?.checkpoint) {
      case 'CP-FINAL':
        if (this.rng.chance(CAL.defects.assemblyFinal * this.dayFactor)) {
          this.defect(body, at, 'CP-FINAL', p.area, asm, this.rng.weighted([['asm_gap', 0.5], ['asm_torque', 0.3], ['asm_electric', 0.2]] as const), 'rework');
        }
        break;
      case 'CP-TEST':
        // проверка — на последнем посту испытательной линии, один раз на кузов
        if (this.plant.equipmentById.get(p.eq)?.posts.at(-1)?.id === p.id && this.rng.chance(CAL.defects.assemblyTest * this.dayFactor)) {
          this.defect(body, at, 'CP-TEST', p.area, asm, this.rng.chance(0.5) ? 'asm_torque' : 'asm_electric', 'rework');
        }
        break;
      case 'CP-RAIN':
        if (this.rng.chance(CAL.defects.assemblyRain * this.dayFactor)) {
          this.defect(body, at, 'CP-RAIN', p.area, asm, 'asm_leak', 'rework');
        }
        break;
    }
  }

  private defect(body: Body, at: number, checkpoint: string, area: AreaId, responsible: AreaId, defect: string, decision: Decision) {
    this.emit({ kind: 'defect', t: at, vin: body.vin, model: body.model, checkpoint, area, responsible, defect, decision });
    if (this.stats) this.stats.defects[responsible] = (this.stats.defects[responsible] ?? 0) + 1;
  }

  /** Берём ли кузов на выборочную операцию: каждый N-й или с вероятностью, не больше лимита в сутки и мест */
  private sample(side: SideSim, at: number): boolean {
    const smp = side.sampling!;
    side.seen++;
    const day = plantParts(at).date;
    if (side.day !== day) {
      side.day = day;
      side.today = 0;
    }
    if (smp.maxPerDay !== undefined && side.today >= smp.maxPerDay) return false;
    const pick = smp.everyN ? side.seen % smp.everyN === 0 : this.sampleRng.chance(smp.rate ?? 0);
    if (!pick || side.inside.length + side.done.length >= side.slots) return false;
    side.today++;
    return true;
  }

  /** Кузов уходит с поста в сторону от потока (если есть место) */
  private toSide(s: StageSim, p: Post): boolean {
    const body = p.body!;
    const side = s.sides.find((x) => x.id === body.pendingSide && x.after === p);
    body.pendingSide = undefined;
    if (!side || side.inside.length + side.done.length >= side.slots) return false;
    const at = p.doneAt!;
    const minutes = this.sampleRng.range(side.minutes[0], side.minutes[1]);
    side.inside.push({ body, until: at + minutes * MIN });
    this.free(p);
    if (side.inPost) this.emit({ kind: 'arrive', t: at, body: ref(body), post: side.inPost, area: s.stage.id, equipmentId: side.id });
    return true;
  }

  /** Операция в стороне закончена: полигон находит часть брака сборки */
  private sideComplete(s: StageSim, side: SideSim, body: Body, at: number) {
    if (this.typeOf(side.id)?.checkpoint === 'CP-TRACK' && this.sampleRng.chance(CAL.defects.assemblyTrackSampled * this.dayFactor)) {
      const asm = stageOfKind(this.plant, 'assembly')?.id ?? s.stage.id;
      this.defect(body, at, 'CP-TRACK', s.stage.id, asm, this.sampleRng.chance(0.5) ? 'asm_torque' : 'asm_electric', 'rework');
    }
  }

  /** Кузова возвращаются в поток: с выхода участка — в буфер, из середины — на пост, откуда ушли */
  private returnSides(s: StageSim, t1: number) {
    for (const side of s.sides) {
      while (side.done.length) {
        const body = side.done[0]!;
        if (side.atExit) {
          if (!this.canExit(s, body)) break;
          this.emit({ kind: 'leave', t: t1, body: ref(body), post: side.returnPost ?? side.inPost ?? side.id, area: s.stage.id, equipmentId: side.id });
          side.done.shift();
          this.exitBody(s, body, t1);
          continue;
        } else {
          const p = side.after;
          if (!p || p.body) break;
          p.body = body;
          p.remaining = 0;
          p.doneAt = t1;
        }
        side.done.shift();
        this.emit({ kind: 'leave', t: t1, body: ref(body), post: side.returnPost ?? side.inPost ?? side.id, area: s.stage.id, equipmentId: side.id });
      }
    }
  }

  private transfer(from: Post, to: Post, t1: number, dt: number) {
    const carry = Math.max(0, Math.min(dt, t1 - (from.doneAt ?? t1)));
    const b = from.body!;
    this.emit({ kind: 'leave', t: t1, body: ref(b), post: from.id, area: from.area, equipmentId: from.eq });
    this.emit({ kind: 'arrive', t: t1, body: ref(b), post: to.id, area: to.area, equipmentId: to.eq });
    to.body = from.body;
    to.remaining = to.cycleMs - carry;
    to.doneAt = null;
    from.body = null;
    from.doneAt = null;
  }

  private load(post: Post, body: Body) {
    this.emit({ kind: 'arrive', t: this.tNow, body: ref(body), post: post.id, area: post.area, equipmentId: post.eq });
    post.body = body;
    post.remaining = post.cycleMs;
    post.doneAt = null;
  }

  private free(post: Post) {
    if (post.body) this.emit({ kind: 'leave', t: this.tNow, body: ref(post.body), post: post.id, area: post.area, equipmentId: post.eq });
    post.body = null;
    post.doneAt = null;
  }

  /** Перекраска: свободная камера сначала берёт кузов из очереди перекраски */
  private tryRepaint(s: StageSim, post: Post) {
    if (!s.repaintPosts.has(post)) return;
    const q = this.repaintQueue[s.stage.id];
    if (!post.body && q?.length && this.running(post.eq)) {
      const body = q.shift()!;
      body.repaint = false;
      this.load(post, body);
    }
  }

  /** Свободный вход в станцию (первый пост), с учётом очереди перекраски */
  private freeStationEntry(s: StageSim, model: ModelId): Post | null {
    for (let i = 0; i < s.stations.length; i++) {
      if (!this.accepts(s, i, model)) continue;
      const first = s.stations[i]![0]!;
      this.tryRepaint(s, first);
      if (!first.body) return first;
    }
    return null;
  }

  /** Посты цепочки — с последнего к первому: готовый кузов уходит дальше, если там свободно */
  private moveChain(s: StageSim, chain: Post[], exit: (p: Post) => void, t1: number, dt: number) {
    for (let i = chain.length - 1; i >= 0; i--) {
      if (i + 1 < chain.length) this.tryRepaint(s, chain[i + 1]!);
      const p = chain[i]!;
      if (!p.body || p.doneAt === null) continue;
      if (p.body.pendingSide && this.toSide(s, p)) continue;
      if (i === chain.length - 1) exit(p);
      else if (!chain[i + 1]!.body) this.transfer(p, chain[i + 1]!, t1, dt);
    }
  }

  /** Кузов прошёл участок: в очередь перекраски, на склад готовой продукции или в буфер после участка */
  private exitStage(s: StageSim, p: Post) {
    const body = p.body!;
    if (!this.canExit(s, body)) return;
    this.free(p);
    // выход отмечают, когда кузов действительно ушёл (мог ждать места в буфере)
    this.exitBody(s, body, Math.max(p.doneAt ?? this.tNow, this.tNow));
  }

  /** Есть ли куда уйти с участка: перекраска и склад ГП — всегда, буфер — если есть место */
  private canExit(s: StageSim, body: Body): boolean {
    if ((s.stage.kind === 'painting' && body.repaint) || s.last) return true;
    const out = s.bufOut ? this.buf[s.bufOut] : undefined;
    return !!out && out.length < s.capOut;
  }

  private exitBody(s: StageSim, body: Body, at: number): boolean {
    const stats = this.stats!;
    if (s.stage.kind === 'painting' && body.repaint) {
      this.repaintQueue[s.stage.id]!.push(body);
      return true;
    }
    if (s.last) {
      this.emit({ kind: 'exit', t: at, body: ref(body), area: s.stage.id });
      if (this.plant.warehouseOut) this.emit({ kind: 'enter', t: at, body: ref(body), area: this.plant.warehouseOut.id });
      stats.output[s.stage.id] = (stats.output[s.stage.id] ?? 0) + 1;
      return true;
    }
    const out = s.bufOut ? this.buf[s.bufOut] : undefined;
    if (out && out.length < s.capOut) {
      out.push(body);
      this.emit({ kind: 'exit', t: at, body: ref(body), area: s.stage.id });
      stats.output[s.stage.id] = (stats.output[s.stage.id] ?? 0) + 1;
      return true;
    }
    return false;
  }

  private move(t1: number, dt: number) {
    // сначала нижние по потоку участки, чтобы освобождённое место сразу было видно
    for (let k = this.stages.length - 1; k >= 0; k--) {
      const s = this.stages[k]!;
      this.returnSides(s, t1);
      this.moveChain(s, s.outlet, (p) => this.exitStage(s, p), t1, dt);
      for (const ch of s.stations) {
        this.moveChain(
          s,
          ch,
          (p) => {
            if (!s.outlet.length) this.exitStage(s, p);
            else if (!s.outlet[0]!.body) this.transfer(p, s.outlet[0]!, t1, dt);
          },
          t1,
          dt,
        );
      }
      this.moveChain(
        s,
        s.inlet,
        (p) => {
          const target = this.freeStationEntry(s, p.body!.model);
          if (target) this.transfer(p, target, t1, dt);
        },
        t1,
        dt,
      );
      if (!s.first) this.enter(s);
    }
  }

  /** Вход на участок из буфера перед ним (очередь по порядку: голова ждёт свою станцию) */
  private enter(s: StageSim) {
    const queue = s.bufIn ? this.buf[s.bufIn] : undefined;
    if (!queue?.length) return;
    const target = s.inlet.length ? (s.inlet[0]!.body ? null : s.inlet[0]!) : this.freeStationEntry(s, queue[0]!.model);
    if (!target) return;
    const body = queue.shift()!;
    this.emit({ kind: 'enter', t: this.tNow, body: ref(body), area: s.stage.id });
    this.load(target, body);
  }

  /** Сварка (первый участок) берёт новые кузова в такт плана, догоняя, если буфер после неё опустел */
  private release(t1: number, dt: number) {
    this.releaseTimer -= dt;
    const s = this.stages[0];
    if (!s) return;
    this.unblockKits(t1);
    if (this.releaseTimer > 0) return;
    const model = this.plannedModel();
    if (!this.hasKits(model)) {
      // нет машинокомплекта: линия этой модели стоит, такт пропадает — остальные линии работают
      this.kitShortage(s, model, t1);
      this.patternIdx++;
      this.releaseTimer = CAL.taktMin * MIN;
      return;
    }
    const lines = s.stations.map((ch, i) => (this.accepts(s, i, model) ? ch[0]! : null)).filter((p): p is Post => !!p);
    const entry = s.inlet[0] ?? lines.find((p) => !p.body && this.running(p.eq)) ?? lines[0];
    if (!entry || entry.body || !this.running(entry.eq)) return;
    this.takeKits(model);
    this.patternIdx++;
    const body = this.pendingKit[model] ?? this.makeBody(model, this.serial++);
    delete this.pendingKit[model];
    this.emit({ kind: 'kit', t: t1, body: ref(body) });
    this.emit({ kind: 'enter', t: t1, body: ref(body), area: s.stage.id });
    this.load(entry, body);
    this.orderKit(model);
    const catchUp = (s.bufOut ? this.buf[s.bufOut]!.length : 0) < CAL.weldBufferTarget;
    this.releaseTimer = (catchUp ? CAL.releaseCatchUpMin : CAL.taktMin) * MIN;
  }

  /** Машинокомплект выдаётся со склада целиком: все позиции модели */
  private hasKits(model: ModelId): boolean {
    return KITS.filter((k) => k.model === model).every((k) => this.kits[k.id]! > 0);
  }

  private takeKits(model: ModelId) {
    for (const k of KITS) if (k.model === model) this.kits[k.id]!--;
  }

  /** Линия модели встаёт «нет деталей» (если она только под эту модель) */
  private kitShortage(s: StageSim, model: ModelId, t1: number) {
    if (model in this.kitsBlocked) return;
    const i = s.stationModels.findIndex((m) => m?.length === 1 && m[0] === model);
    const eq = i >= 0 ? s.stations[i]![0]!.eq : null;
    const kit = KITS.find((k) => k.model === model && this.kits[k.id]! <= 0) ?? KITS.find((k) => k.model === model)!;
    this.kitsBlocked[model] = eq;
    if (eq) this.startDowntime(eq, t1, 600, { reason: `Нет машинокомплектов: ${kit.name.toLowerCase()}`, category: 'no_parts', status: 'idle' });
  }

  private unblockKits(t1: number) {
    for (const [model, eq] of Object.entries(this.kitsBlocked) as [ModelId, string | null][]) {
      if (!this.hasKits(model)) continue;
      delete this.kitsBlocked[model];
      const e = eq ? this.eq[eq] : undefined;
      if (e?.down?.category === 'no_parts') e.downUntil = t1;
    }
  }

  /** Встал ли участок целиком: общее оборудование или все станции */
  private stageStopped(s: StageSim): boolean {
    const down = (id: string) => this.eq[id]?.down !== null && this.eq[id]?.down !== undefined;
    if ([...s.inlet, ...s.outlet].some((p) => down(p.eq))) return true;
    if (!s.stations.length) return false;
    return s.stationEq.every((ids) => ids.some(down));
  }

  /** Время, когда участок стоял из-за своего оборудования — для сменного отчёта */
  private accountStops(dt: number) {
    const st = this.stats!;
    for (const s of this.stages) {
      if (this.stageStopped(s)) st.stoppedMin[s.stage.id] = (st.stoppedMin[s.stage.id] ?? 0) + dt / MIN;
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
    for (const b of this.plant.buffers) {
      const q = this.buf[b.id] ?? [];
      const full = q.length >= Math.ceil(b.capacity * 0.85);
      if (full && !this.queueNotified.has(b.id)) {
        this.queueNotified.add(b.id);
        this.emit({ kind: 'queue', t: t1, area: b.to, count: q.length });
      } else if (!full && q.length < b.capacity * 0.5) this.queueNotified.delete(b.id);
    }
  }

  private telemetry(t1: number) {
    const minute = Math.floor(t1 / MIN);
    if (minute === this.lastTelemetryMin) return;
    this.lastTelemetryMin = minute;
    if (!this.shift && plantParts(t1).minute % 10 !== 0) return;
    const at = minute * MIN;
    const noise = () => this.rng.range(-2.5, 2.5);
    // перепад на фильтрах камер: порядок опроса — как в исходной калибровке (с конца потока)
    for (const [id, f] of Object.entries(this.filters).reverse()) {
      const e = this.eq[id];
      if (!e) continue;
      this.emit({ kind: 'telemetry', t: at, equipmentId: id, area: e.area, metric: 'filter_dp_pa', value: round1(dpOf(f) + noise()) });
    }
    const c = CAL.conveyor;
    for (const [id, breakAt] of Object.entries(this.chainBreakAt)) {
      let wear = 0;
      if (breakAt !== null) {
        const lead = (breakAt - at) / MIN;
        if (lead >= 0 && lead <= c.warnLeadMin) wear = Math.pow(1 - lead / c.warnLeadMin, 1.5);
      }
      const e = this.eq[id];
      if (!e) continue;
      const stopped = e.status !== 'run' || !this.shift;
      this.emit({
        kind: 'telemetry',
        t: at,
        equipmentId: id,
        area: e.area,
        metric: 'motor_current_a',
        value: stopped ? round1(this.rng.range(0, 0.4)) : round1(c.currentA + wear * c.currentRiseA + this.rng.range(-0.35, 0.35)),
      });
      this.emit({
        kind: 'telemetry',
        t: at,
        equipmentId: id,
        area: e.area,
        metric: 'vibration_mm_s',
        value: stopped ? round1(this.rng.range(0.1, 0.3)) : round1(c.vibration + wear * c.vibrationRise + this.rng.range(-0.15, 0.15)),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Наряды от двойника выполняют «люди завода» в назначенное время

  applyWorkOrder(wo: WorkOrder) {
    const at = Math.max(this.t, Date.parse(wo.scheduledAt));
    const minutes = wo.durationMin ?? 0;
    const done = () => this.emit({ kind: 'work_done', t: Math.max(this.t, at), workOrderId: wo.workOrderId, title: wo.title });
    switch (wo.action) {
      case 'replace_filter': {
        const id = wo.equipmentId && this.filters[wo.equipmentId] ? wo.equipmentId : Object.keys(this.filters)[0];
        if (!id) return;
        this.scheduled.push({
          at,
          run: () => {
            if (this.eq[id]!.down) this.endDowntime(this.eq[id]!, Math.max(this.t, at));
            this.startDowntime(id, Math.max(this.t, at), minutes || CAL.filter.plannedMin, {
              reason: 'Замена фильтра (по наряду)',
              category: 'planned',
              status: 'maintenance',
              onEnd: 'filter',
            });
            done();
          },
        });
        break;
      }
      case 'maintenance':
        if (!wo.equipmentId) return;
        this.scheduled.push({
          at,
          run: () => {
            this.startDowntime(wo.equipmentId!, Math.max(this.t, at), minutes || 30, {
              reason: 'Плановое ТО (по наряду)',
              category: 'planned',
              onEnd: this.typeOf(wo.equipmentId!)?.serviceIntervalCycles ? 'robot_service' : undefined,
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
            if (wo.equipmentId! in this.chainBreakAt) this.chainBreakAt[wo.equipmentId!] = null;
            this.startDowntime(wo.equipmentId!, Math.max(this.t, at), minutes || 20, {
              reason: wo.action === 'inspect' ? 'Осмотр и замена цепи (по наряду)' : 'Ремонт (по наряду)',
              category: 'planned',
            });
            done();
          },
        });
        break;
      case 'resequence':
        this.resequence = { model: String(wo.params?.model ?? 'j7') as ModelId, until: Number(wo.params?.untilMs ?? at + 24 * 60 * MIN) };
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

/** Отказ, который готовится заранее (обрыв цепи конвейера) */
function scheduledFailure(type: EquipmentTypeDef | undefined) {
  return type?.failures.find((f) => f.scheduled);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function ref(b: Body): BodyRef {
  return { bodyId: b.bodyId, vin: b.vin, model: b.model, colorCode: b.colorCode, serial: b.serial };
}
