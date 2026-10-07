// Типы ответов REST, которые отдаёт ядро двойника (повторяют twin-core, без зависимости от него).
import type { AreaId, AreaStatus, Explain, ExplainInput, SourceId, Tone, BodyDetail } from '@allur/contracts/ref';

export interface SignalView {
  source: SourceId | 'twin';
  ts: string;
  text: string;
  equipmentId?: string;
  code?: string;
  clipUrl?: string;
}

export interface AreaDetail {
  area: AreaId;
  name: string;
  status: AreaStatus;
  reason: string | null;
  since: string | null;
  summary: string;
  rule: string | null;
  signals: SignalView[];
  equipment: {
    id: string;
    name: string;
    status: 'run' | 'idle' | 'fault' | 'maintenance' | null;
    code?: string;
    text?: string;
    resourceLeft: number | null;
    cycles: number | null;
    interval: number | null;
    cyclesSource: SourceId | null;
    dp: number | null;
  }[];
  chartKind: 'defects' | 'output';
  chart: { hour: string; value: number; norm: number }[];
  incidents: { id: string; title: string; status: 'open' | 'decided' | 'resolved'; openedAt: string; tone: Tone }[];
  clip: { url: string; at: string } | null;
  plcConnected: boolean;
  stock?: { kitId: string; name: string; qty: number | null; shiftsLeft: number | null }[];
}

export interface IncidentOption {
  id: string;
  title: string;
  detail: string;
  carsLost: number;
  repaints: number;
  directCost: number;
  totalCost: number;
  risk: 'низкий' | 'средний' | 'высокий';
  riskText: string;
  recommended: boolean;
  workOrder: { action: string; scheduledAt: string; durationMin?: number; title: string } | null;
}

export interface Incident {
  id: string;
  type: 'quality' | 'stop' | 'equipment' | 'stock' | 'early_warning';
  area: AreaId;
  equipmentId?: string;
  tone: Tone;
  openedAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  status: 'open' | 'decided' | 'resolved';
  title: string;
  impactText: string;
  impactCars: number;
  happened: { text: string; at: number };
  why: {
    text: string;
    chain: ExplainInput[];
    chart: { kind: 'filter'; threshold: number; norm: number; limit: number; dp: { t: number; v: number }[]; defects: { t: number; dp: number }[] } | null;
  };
  threat: { text: string; carsLost: number; repaints: number; money: number };
  options: IncidentOption[];
  explain: Explain;
  signals: { source: SourceId | 'twin'; ts: number; text: string; clipUrl?: string }[];
  decision: { optionId: string; decidedAt: number; decidedBy?: string; workOrderId: string; title: string } | null;
}

export interface DecisionResponse {
  ok: boolean;
  summary?: string;
  forecastBefore?: number;
  forecastAfter?: number;
  workOrder?: { title: string; scheduledAt: string };
}

export interface Levers {
  moveMaintenance: boolean;
  filterBySchedule: boolean;
  saturdayShifts: number;
}

export interface MonthForecast {
  month: string;
  target: number;
  produced: number;
  p10: number;
  p50: number;
  p90: number;
  gap: number;
  onTrack: boolean;
  pace: number;
  paceShifts: number;
  remainingShifts: number;
  incidentLoss: number;
  leverGain: number;
  days: { date: string; fact: number | null; plan: number; p10: number | null; p50: number | null; p90: number | null }[];
  losses: { key: string; label: string; cars: number; area?: AreaId }[];
  bottleneck: { area: AreaId; label: string; reason: string } | null;
  mainCause: string | null;
  levers: { id: keyof Levers; label: string; gain: number; perShift: number; max?: number; explain: string }[];
  models: { model: string; name: string; plan: number; produced: number; forecast: number; stockShifts: number | null; stockRisk: 'низкий' | 'средний' | 'высокий'; stockText: string | null }[];
  capacityNote: string;
  explain: Explain;
}

export interface DataCheck {
  id: string;
  severity: 'contradiction' | 'norm';
  title: string;
  detail: string;
  source: string;
}

export interface SourcesResponse {
  stage: 0 | 1 | 2;
  contradictions: DataCheck[];
  unaccounted: { autoMin: number; mesMin: number; unaccountedMin: number; microCount: number } | null;
  validationErrors: { id: number; receivedAt: number; source: string | null; channel: string; issues: { path: string; message: string }[]; sample: string | null }[];
  endpoints: { rest: string; swagger: string; asyncapi: string; mqttTcp: string | null; mqttWs: string };
  lan: string[];
}

export interface ImportResponse {
  kind: string | null;
  kindLabel: string;
  rows: number;
  accepted: number;
  duplicates: number;
  issues: { row: number; path: string; message: string }[];
  contradictions: DataCheck[];
}

export interface SettingsResponse {
  money: Record<string, number>;
  defaults: Record<string, number>;
  labels: Record<string, string>;
  assumptions: string[];
  note: string;
}

export interface QualityOverview {
  norm: number;
  areas: { area: AreaId; name: string; shiftPct: number; weekPct: number; shiftDefects: number }[];
  top: { defect: string; name: string; area: AreaId; count: number }[];
  pattern: { text: string; sentence: string; lift: number; rateAbove: number; rateBelow: number; explain: Explain } | null;
  plcConnected: boolean;
  recent: { vin: string; defect: string; at: string }[];
  lastVins: string[];
}

export interface Passport {
  vin: string;
  model: string | null;
  modelName: string;
  where: string;
  steps: { post: string; postName: string; area: AreaId; at: string; conditions: { label: string; value: string; tone: Tone; source: SourceId }[] }[];
  checks: { at: string; checkpoint: string; defect: string; decision: string; source: SourceId }[];
  plcConnected: boolean;
  /** Кузов по трекеру: проходы стадий, маршрут операций, история отметок */
  body: BodyDetail | null;
}

export interface EquipmentOverview {
  items: {
    id: string;
    name: string;
    area: AreaId;
    resourceLeft: number | null;
    cycles: number | null;
    interval: number | null;
    source: SourceId | null;
    risk: 'низкий' | 'средний' | 'высокий';
    errors24h: number | null;
    dp: number | null;
    recommendation: string | null;
    incidentId: string | null;
  }[];
  criticalDowntime: { minutes: number; limit: number; items: { from: string; to: string; label: string }[] };
  plcConnected: boolean;
  unaccounted: { autoMin: number; mesMin: number; unaccountedMin: number; microCount: number } | null;
}
