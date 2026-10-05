export type StationId = 'press' | 'weld' | 'paint' | 'assembly' | 'qc';
export type StationStatus = 'run' | 'starved' | 'blocked' | 'down' | 'maint';
export type StopKind = 'failure' | 'micro' | 'maint';
export type Severity = 'info' | 'warning' | 'serious' | 'critical';

export type LossCategory =
  | 'Механика'
  | 'Электрика'
  | 'Наладка'
  | 'Нет комплектующих'
  | 'Ожидание персонала'
  | 'Плановое ТО'
  | 'Материалы';

export interface Equipment {
  id: string;
  name: string;
  stationId: StationId;
  failCat: LossCategory;
  parts: string[];
  action: string;
  /** Виброскорость, мм/с */
  vib: number;
  vibBase: number;
  /** Скрытая скорость деградации, мм/с за минуту (модель её не видит, только последствия) */
  drift: number;
  temp: number;
  tempBase: number;
  /** Моточасы с последнего ТО */
  hours: number;
  maintIntervalH: number;
  vibHist: number[];
  failed: boolean;
}

export interface StationShift {
  run: number;
  starved: number;
  blocked: number;
  down: number;
  maint: number;
  produced: number;
}

export interface Station {
  id: StationId;
  status: StationStatus;
  progress: number;
  downUntil: number;
  downCause: string;
  downCat: LossCategory;
  downEquip: string | null;
  downKind: StopKind | null;
  shift: StationShift;
  /** Статусы за последние 120 минут — для оценки доступности */
  recent: StationStatus[];
}

export interface DowntimeEvent {
  id: number;
  stationId: StationId;
  equipId: string | null;
  cause: string;
  cat: LossCategory;
  start: number;
  end: number | null;
  source: 'sensor' | 'journal';
}

export interface Incident {
  id: number;
  key: string;
  t: number;
  sev: Severity;
  title: string;
  text: string;
  stationId: StationId | null;
  equipId: string | null;
  resolvedAt: number | null;
  action: 'expedite' | 'whatif' | null;
}

export type OrderStatus = 'new' | 'assigned' | 'in_progress' | 'review' | 'closed';
export type OrderKind = 'predictive' | 'emergency' | 'quality';

export interface WorkOrder {
  id: string;
  kind: OrderKind;
  equipId: string;
  stationId: StationId;
  title: string;
  action: string;
  reasons: string[];
  parts: string[];
  createdAt: number;
  deadline: number;
  durationMin: number;
  /** Деньги под риском, если ничего не делать */
  priorityRub: number;
  status: OrderStatus;
  assignee: string | null;
  startedAt: number | null;
  avoidedRub: number;
  feedback: 'confirmed' | 'false' | null;
}

export interface Mechanic {
  id: string;
  name: string;
  role: 'Механик' | 'Электрик';
  orderId: string | null;
}

/** Принудительное событие — используется в прогонах «что если» */
export interface Forced {
  t: number;
  kind: 'maint' | 'fail';
  equipId: string;
  dur: number;
}

export interface SimState {
  t: number;
  rng: number;
  seq: number;
  incSeq: number;
  stations: Station[];
  buffers: number[];
  kits: { level: number; nextAt: number; nextQty: number; expedited: boolean };
  equipment: Equipment[];
  shift: { index: number; shipped: number; rejected: number; lossMin: Record<LossCategory, number> };
  rejectsBy: Record<StationId, number>;
  totalShipped: number;
  qcRecent: number[];
  paintExtra: number;
  paintDrift: boolean;
  downtime: DowntimeEvent[];
  incidents: Incident[];
  orders: WorkOrder[];
  mechanics: Mechanic[];
  ai: { confirmed: number; falseAlarm: number; avoidedRub: number };
  bottleneck: number;
  /** true — это копия для прогноза: без случайностей, со средними потерями */
  forecast: boolean;
  forecastAvail: number[];
  forecastEvents: { t: number; equipId: string }[];
  forced: Forced[];
}

/** Снимок состояния для схемы завода — живой, исторический или прогнозный */
export interface MapFrame {
  t: number;
  shiftIndex: number;
  statuses: StationStatus[];
  causes: string[];
  produced: number[];
  buffers: number[];
  kits: number;
  kitsNextAt: number;
  shipped: number;
  rejected: number;
  risks: Record<string, number>;
  costPerHour: number[];
  protect: number[];
  bottleneck: number;
  lineRate: number;
}
