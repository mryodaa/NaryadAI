// Состояние двойника — только то, что пришло событиями, и состав цеха из конфигурации.
// Никакого знания об имитаторах.
import { BodyTracker, type TrackTransition } from './tracker';
import {
  SEED_MODEL,
  shiftAt,
  type AreaId,
  type CanonicalEvent,
  type DowntimeCategoryId,
  type EquipmentStatus,
  type MetricId,
  type ModelId,
  type PlantModel,
  type SourceId,
} from '@allur/contracts';

/**
 * Отметка кузова, учтённая двойником (из трекера): вход и выход участка, отметка у оборудования.
 * vin — VIN кузова или его внутренний номер, пока VIN не нанесён.
 */
export interface Pass {
  /** Код точки отметки или поста 1С:MES */
  post: string;
  area: AreaId;
  ts: number;
  vin: string;
  model: ModelId;
  kind: 'entry' | 'exit' | 'mark';
  equipmentId?: string;
  restored?: boolean;
}

export interface Nc {
  ts: number;
  vin?: string;
  area: AreaId;
  responsible: AreaId;
  checkpoint: string;
  defect: string;
  decision: 'rework' | 'repaint' | 'scrap';
  source: SourceId;
  count: number;
}

export interface DowntimeRec {
  key: string;
  equipmentId: string;
  area: AreaId;
  reason: string;
  category: DowntimeCategoryId;
  from: number;
  to: number | null;
  registeredBy: string;
  source: SourceId;
  registeredAt: number;
}

export interface EqState {
  id: string;
  area: AreaId;
  status: EquipmentStatus | null;
  since: number;
  code?: string;
  text?: string;
  lastPlcTs: number | null;
  cycles: number | null;
  total: number | null;
  cyclesTs: number | null;
}

export interface AutoStop {
  equipmentId: string;
  area: AreaId;
  status: 'fault' | 'maintenance';
  from: number;
  to: number | null;
  code?: string;
  text?: string;
}

export interface Series {
  ts: number[];
  v: number[];
}

export interface ReportRec {
  date: string;
  shift: number;
  area: AreaId;
  line: string;
  plan: number;
  fact: number;
  hours: number;
  load: number;
  source: SourceId;
}

export interface QualityRec {
  date: string;
  shift: number;
  area: AreaId;
  produced: number;
  defects: number;
  pct: number;
  source: SourceId;
}

export interface StockRec {
  kitId: string;
  model: ModelId;
  qty: number;
  shiftsLeft: number;
  ts: number;
}

export interface CameraRec {
  ts: number;
  area: AreaId;
  cameraId: string;
  kind: 'line_stopped' | 'queue' | 'post_empty';
  value?: number;
  clipUrl?: string;
}

export interface PlanRec {
  month: string;
  target?: number;
  models: { model: ModelId; qty: number }[];
}

const SERIES_LIMIT = 3000;

export class TwinState {
  /** Состав цеха (конфигурация завода) */
  plant: PlantModel;
  runStartMs = 0;
  /** Трекер кузовов: где каждый кузов, маршрут, история */
  tracker: BodyTracker;
  /** Отметки текущего прогона (дня) по порядку времени */
  passes: Pass[] = [];
  /** Входов на участок за смену («смена|участок») — для ОТК это число проверенных после сборки */
  entryCount = new Map<string, number>();
  /** Кузовов, покинувших участок за смену («смена|участок»); у склада готовой продукции — принято */
  exitCount = new Map<string, number>();
  lastPassByArea: Partial<Record<AreaId, number>> = {};
  nc: Nc[] = [];
  downtimes = new Map<string, DowntimeRec>();
  eq: Record<string, EqState> = {};
  autoStops: AutoStop[] = [];
  telemetry = new Map<string, Series>();
  reports = new Map<string, ReportRec>();
  quality = new Map<string, QualityRec>();
  plans = new Map<string, PlanRec>();
  stock = new Map<string, StockRec>();
  camera: CameraRec[] = [];
  lastBySource: Partial<Record<SourceId, number>> = {};
  /** Время последнего события любого источника (по часам событий) */
  lastEventTs = 0;

  constructor(plant: PlantModel = SEED_MODEL) {
    this.plant = plant;
    this.tracker = new BodyTracker(plant);
    this.tracker.onTransition = (t) => this.onTransition(t);
    this.eq = {};
    this.addEquipment();
  }

  /** Новый состав цеха: появившееся оборудование получает пустое состояние, накопленное — сохраняется */
  setPlant(plant: PlantModel) {
    this.plant = plant;
    this.tracker.setPlant(plant);
    this.addEquipment();
  }

  private addEquipment() {
    for (const e of this.plant.equipment) {
      if (e.passive) continue;
      const s = this.eq[e.id];
      if (s) s.area = e.stageId;
      else this.eq[e.id] = { id: e.id, area: e.stageId, status: null, since: 0, lastPlcTs: null, cycles: null, total: null, cyclesTs: null } satisfies EqState;
    }
  }

  ingest(e: CanonicalEvent) {
    const ts = Date.parse(e.ts);
    this.lastBySource[e.source] = Math.max(this.lastBySource[e.source] ?? 0, ts);
    if (e.type !== 'shift_report' && e.type !== 'quality_summary' && e.type !== 'plan_set') this.lastEventTs = Math.max(this.lastEventTs, ts);

    switch (e.type) {
      case 'post_passed':
        this.tracker.postPassed(e.vin, e.payload.model, e.payload.post, ts, e.source);
        break;
      case 'production_order':
        this.tracker.order({ bodyId: e.payload.bodyId, vin: e.vin, model: e.payload.model, colorCode: e.payload.colorCode, trim: e.payload.trim, plannedSeq: e.payload.plannedSeq, ts, source: e.source });
        break;
      case 'body_checkpoint':
        this.tracker.checkpoint({ bodyId: e.payload.bodyId, vin: e.vin, checkpointId: e.payload.checkpointId, direction: e.payload.direction, postId: e.payload.postId, ts, source: e.source });
        break;
      case 'operation_result':
        this.tracker.operation({ bodyId: e.payload.bodyId, vin: e.vin, equipmentId: e.equipmentId, operation: e.payload.operation, result: e.payload.result, details: e.payload.details, ts, source: e.source });
        break;
      case 'vin_assigned':
        this.tracker.vinAssigned(e.payload.bodyId, e.vin, ts, e.source);
        break;
      case 'nonconformity':
        this.tracker.nonconformity(e.vin, e.area, e.payload.decision, `${e.payload.checkpoint}: ${e.payload.defect} → ${e.payload.decision}`, ts, e.source);
        this.nc.push({
          ts,
          vin: e.vin,
          area: e.area,
          responsible: e.payload.responsibleArea ?? e.area,
          checkpoint: e.payload.checkpoint,
          defect: e.payload.defect,
          decision: e.payload.decision,
          source: e.source,
          count: e.payload.count ?? 1,
        });
        break;
      case 'downtime_registered': {
        const from = Date.parse(e.payload.from);
        const key = `${e.equipmentId}|${from}`;
        const prev = this.downtimes.get(key);
        this.downtimes.set(key, {
          key,
          equipmentId: e.equipmentId,
          area: e.area,
          reason: e.payload.reason,
          category: e.payload.category,
          from,
          to: e.payload.to ? Date.parse(e.payload.to) : (prev?.to ?? null),
          registeredBy: e.payload.registeredBy,
          source: e.source,
          registeredAt: prev ? Math.min(prev.registeredAt, ts) : ts,
        });
        break;
      }
      case 'equipment_state': {
        const s = this.eq[e.equipmentId];
        if (!s) break;
        if (s.lastPlcTs !== null && ts < s.lastPlcTs) break;
        const was = s.status;
        s.status = e.payload.status;
        s.code = e.payload.code;
        s.text = e.payload.text;
        s.lastPlcTs = ts;
        if (was !== e.payload.status) s.since = ts;
        const open = this.autoStops.find((a) => a.equipmentId === e.equipmentId && a.to === null);
        if (e.payload.status === 'fault' || e.payload.status === 'maintenance') {
          if (!open) this.autoStops.push({ equipmentId: e.equipmentId, area: s.area, status: e.payload.status, from: ts, to: null, code: e.payload.code, text: e.payload.text });
        } else if (open) open.to = ts;
        break;
      }
      case 'equipment_counter': {
        const s = this.eq[e.equipmentId];
        if (!s || (s.cyclesTs !== null && ts < s.cyclesTs)) break;
        s.cycles = e.payload.cycles;
        s.total = e.payload.total;
        s.cyclesTs = ts;
        s.lastPlcTs = Math.max(s.lastPlcTs ?? 0, ts);
        break;
      }
      case 'telemetry': {
        const key = `${e.equipmentId}|${e.payload.metric}`;
        let s = this.telemetry.get(key);
        if (!s) {
          s = { ts: [], v: [] };
          this.telemetry.set(key, s);
        }
        const i = upperBound(s.ts, ts);
        s.ts.splice(i, 0, ts);
        s.v.splice(i, 0, e.payload.value);
        if (s.ts.length > SERIES_LIMIT) {
          s.ts.splice(0, s.ts.length - SERIES_LIMIT);
          s.v.splice(0, s.v.length - SERIES_LIMIT);
        }
        const st = this.eq[e.equipmentId];
        if (st) st.lastPlcTs = Math.max(st.lastPlcTs ?? 0, ts);
        break;
      }
      case 'camera_detection':
        this.camera.push({ ts, area: e.area, cameraId: e.payload.cameraId, kind: e.payload.kind, value: e.payload.value, clipUrl: e.payload.clipUrl });
        if (this.camera.length > 500) this.camera.splice(0, this.camera.length - 500);
        break;
      case 'stock_level': {
        const prev = this.stock.get(e.payload.kitId);
        if (!prev || ts >= prev.ts) this.stock.set(e.payload.kitId, { kitId: e.payload.kitId, model: e.payload.model, qty: e.payload.qty, shiftsLeft: e.payload.shiftsLeft, ts });
        break;
      }
      case 'plan_set': {
        // план по моделям без целевого числа не отменяет уже известный целевой план месяца
        const prev = this.plans.get(e.payload.month);
        this.plans.set(e.payload.month, { month: e.payload.month, target: e.payload.target ?? prev?.target, models: e.payload.models });
        break;
      }
      case 'shift_report':
        this.reports.set(`${e.payload.date}#${e.payload.shift ?? 1}|${e.area}`, {
          date: e.payload.date,
          shift: e.payload.shift ?? 1,
          area: e.area,
          line: e.payload.line,
          plan: e.payload.plan,
          fact: e.payload.fact,
          hours: e.payload.hours,
          load: e.payload.load,
          source: e.source,
        });
        break;
      case 'quality_summary':
        this.quality.set(`${e.payload.date}#${e.payload.shift ?? 1}|${e.area}`, {
          date: e.payload.date,
          shift: e.payload.shift ?? 1,
          area: e.area,
          produced: e.payload.produced,
          defects: e.payload.defects,
          pct: e.payload.pct,
          source: e.source,
        });
        break;
    }
  }

  /** Переход из трекера: вход и выход участка, отметка у оборудования — в счётчики смены */
  private onTransition(t: TrackTransition) {
    if (t.ts < this.runStartMs) return;
    const b = t.body;
    const pass: Pass = {
      post: t.pointId ?? t.postId ?? t.stageId,
      area: t.stageId,
      ts: t.ts,
      vin: b.vin ?? b.bodyId,
      model: b.model ?? 'onix',
      kind: t.kind,
      equipmentId: t.equipmentId,
      restored: t.restored,
    };
    insertSorted(this.passes, pass);
    this.lastPassByArea[t.stageId] = Math.max(this.lastPassByArea[t.stageId] ?? 0, t.ts);
    const shift = shiftAt(t.ts);
    if (!shift) return;
    const k = `${shift.key}|${t.stageId}`;
    const finished = this.plant.warehouseOut?.id === t.stageId;
    if (t.kind === 'entry') this.entryCount.set(k, (this.entryCount.get(k) ?? 0) + 1);
    if (t.kind === 'exit' || (finished && t.kind === 'entry')) this.exitCount.set(k, (this.exitCount.get(k) ?? 0) + 1);
  }

  /** Сколько кузовов вошло на участок за смену */
  entered(shiftKey: string, stageId: string): number {
    return this.entryCount.get(`${shiftKey}|${stageId}`) ?? 0;
  }

  /** Отметка — выпуск завода: приёмка на склад готовой продукции */
  isFinishPass(p: Pass): boolean {
    return p.kind === 'entry' && p.area === this.plant.warehouseOut?.id;
  }

  /** Сколько кузовов покинуло участок за смену (на склад ГП — принято) */
  stageDone(shiftKey: string, stageId: string): number {
    return this.exitCount.get(`${shiftKey}|${stageId}`) ?? 0;
  }

  series(equipmentId: string, metric: MetricId): Series | undefined {
    return this.telemetry.get(`${equipmentId}|${metric}`);
  }

  /** Значение датчика на момент ts (последнее известное до него) */
  valueAt(equipmentId: string, metric: MetricId, ts: number): number | null {
    const s = this.series(equipmentId, metric);
    if (!s || !s.ts.length) return null;
    const i = upperBound(s.ts, ts) - 1;
    if (i < 0) return null;
    if (ts - s.ts[i]! > 10 * 60_000) return null;
    return s.v[i]!;
  }

  /** Был ли поток данных с контроллеров недавно (ступень ≥ 1) */
  plcConnected(now: number): boolean {
    const t = this.lastBySource.plc;
    return t !== undefined && now - t < 20 * 60_000;
  }
}

function upperBound(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function insertSorted(arr: Pass[], p: Pass) {
  if (!arr.length || arr[arr.length - 1]!.ts <= p.ts) {
    arr.push(p);
    return;
  }
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.ts <= p.ts) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, p);
}
