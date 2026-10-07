// Машина в цехе простыми словами: где она, сколько там против нормы, прогресс по стадиям, когда будет
// готова, отметки и последние события. Считается на фронте из трекера двойника (кузов, его маршрут
// и история) и конфигурации завода (нормы операций, ёмкость буферов, мощность участков).
import {
  ID_METHOD_DEF,
  SHIFT_MIN,
  currentOrNextShift,
  plantDate,
  shiftsBetweenDates,
  inflectLower,
  modelOperations,
  plantOperations,
  stageNominal,
  type BodyDetail,
  type BodyFlag,
  type BodyHistoryItem,
  type BodyRouteStepView,
  type BodyView,
  type BufferView,
  type PlantModel,
  type Tone,
} from '@allur/contracts/ref';

const MIN = 60_000;

/** Минут на текущем месте */
export function minutesHere(v: BodyView, now: number): number {
  return Math.max(0, Math.round((now - Date.parse(v.since)) / MIN));
}

/** Норма на текущем месте, мин (нет — очередь, склад) */
export function normMinutes(v: BodyView): number | null {
  return v.normSec ? Math.max(1, Math.round(v.normSec / 60)) : null;
}

/** Последние 6 знаков VIN — так машину называют в цеху; без VIN — номер кузова */
export function shortVin(v: { vin: string | null; bodyId: string }): string {
  return v.vin ? `…${v.vin.slice(-6)}` : v.bodyId;
}

// ---------------------------------------------------------------------------
// Где сейчас

export interface CarWhere {
  /** «Окраска · Камера-02», «Очередь перед сборкой» */
  title: string;
  /** «18 мин, норма 20» */
  detail: string;
  tone: Tone;
}

import { getI18n } from '../i18n/store';
import { translateAreaName, translateEquipmentName } from '../i18n/translator';

export function carWhere(v: BodyView, plant: PlantModel, now: number, lang = getI18n().lang): CarWhere {
  const stage = plant.stageById.get(v.loc.stageId);
  const rawShort = stage?.short ?? v.loc.stageId;
  const short = translateAreaName(rawShort, lang);
  const min = minutesHere(v, now);
  const norm = normMinutes(v);
  const tone: Tone = v.flags.includes('delayed') ? 'attention' : 'neutral';
  const loc = v.loc;
  const minUnit = lang === 'kk' ? 'мин' : lang === 'en' ? 'min' : 'мин';
  const normLabel = lang === 'kk' ? 'норма' : lang === 'en' ? 'norm' : 'норма';

  if (loc.kind === 'warehouse') {
    const title = lang === 'kk' ? `${short}: жинақ` : lang === 'en' ? `${short}: vehicle kit` : `${short}: машинокомплект`;
    const detail = lang === 'kk' ? `дәнекерлеуге берілуді күтуде · ${min} ${minUnit}` : lang === 'en' ? `waiting for release to welding · ${min} ${minUnit}` : `ждёт выдачи на сварку · ${min} мин`;
    return { title, detail, tone };
  }
  if (loc.kind === 'finished') {
    const title = translateAreaName(stage?.name ?? rawShort, lang);
    const detail = lang === 'kk' ? 'көлік дайын және қоймаға қабылданды' : lang === 'en' ? 'vehicle completed and stored in warehouse' : 'машина готова и принята на склад';
    return { title, detail, tone };
  }
  if (loc.kind === 'buffer') {
    const to = loc.bufferId ? plant.stageById.get(plant.bufferById.get(loc.bufferId)?.to ?? '') : undefined;
    const toShort = to ? translateAreaName(to.short, lang) : '';
    const title = to
      ? lang === 'kk' ? `Кезек: ${toShort} алдында` : lang === 'en' ? `Queue before ${toShort}` : `Очередь перед ${inflectLower(to.short, 'ins')}`
      : lang === 'kk' ? `«${short}» учаскесінен кейін, жолда` : lang === 'en' ? `After "${short}" area, en route` : `После участка «${short}», в пути дальше`;
    const detail = lang === 'kk' ? `кезекте ${min} ${minUnit}` : lang === 'en' ? `${min} ${minUnit} in queue` : `${min} мин в очереди`;
    return { title, detail, tone };
  }
  const time = `${min} ${minUnit}${norm ? `, ${normLabel} ${norm}` : ''}`;
  if (loc.precision === 'stage') {
    const notMarked = lang === 'kk' ? '(дәл орны белгіленбеген)' : lang === 'en' ? '(exact position not marked)' : '(точное место не отмечено)';
    return { title: `${short} ${notMarked}`, detail: time, tone };
  }
  const eq = loc.equipmentId ? plant.equipmentById.get(loc.equipmentId) : undefined;
  const eqName = eq?.name ? translateEquipmentName(eq.name, lang) : loc.equipmentId;
  const station = eq?.stationId && stage && stage.stations.length > 1 ? stage.stations.find((s) => s.id === eq.stationId)?.name : undefined;
  return { title: [short, station, eqName].filter(Boolean).join(' · '), detail: time, tone };
}

// ---------------------------------------------------------------------------
// Прогресс по стадиям

export type StageMark = 'done' | 'now' | 'queue' | 'ahead';

export interface CarStage {
  id: string;
  name: string;
  mark: StageMark;
  /** Повторный проход (перекраска): номер прохода, 0 — первый */
  loop: number;
}

export function stageProgress(v: BodyView, plant: PlantModel, route?: BodyRouteStepView[]): CarStage[] {
  const idx = plant.stages.findIndex((s) => s.id === v.loc.stageId);
  return plant.stages.map((s, i) => {
    let mark: StageMark;
    if (v.loc.kind === 'finished') mark = 'done';
    else if (v.loc.kind === 'buffer') mark = i <= idx ? 'done' : i === idx + 1 ? 'queue' : 'ahead';
    else mark = i < idx ? 'done' : i === idx ? 'now' : 'ahead';
    const loop = route ? route.reduce((a, r) => (r.stageId === s.id && r.loop > a && r.status !== 'waiting' ? r.loop : a), 0) : 0;
    return { id: s.id, name: s.short, mark, loop };
  });
}

/** Операции стадии (последний проход): что сделано, что сейчас, что впереди */
export function stageOperations(route: BodyRouteStepView[], stageId: string): BodyRouteStepView[] {
  const steps = route.filter((r) => r.stageId === stageId);
  const loop = steps.reduce((a, r) => Math.max(a, r.loop), 0);
  return steps.filter((r) => r.loop === loop && !(r.optional && r.status === 'skipped'));
}

// ---------------------------------------------------------------------------
// Когда будет готова: по нормам операций и текущим очередям, в рабочем времени смен

export interface CarEta {
  /** Машина уже на складе готовой продукции */
  done: boolean;
  /** Ориентировочный выход на склад ГП, мс */
  at: number;
  /** Отставание от плана, мин (+ — позже плана); null — ещё не выдана в производство */
  lateMin: number | null;
}

/** Расхождение меньше этого — «по плану» */
export const ON_PLAN_MIN = 10;
/** Обычная очередь в буфере для плана: половина ёмкости */
const NORMAL_QUEUE = 0.5;

/** Рабочее время между a и b, мс: только смены (ночь и выходные не считаются) */
export function workMs(a: number, b: number): number {
  if (b <= a) return 0;
  let sum = 0;
  for (const s of shiftsBetweenDates(plantDate(a), plantDate(b))) sum += Math.max(0, Math.min(b, s.endMs) - Math.max(a, s.startMs));
  return sum;
}

/** Когда закончится работа длиной ms, начатая в from: по сменам (между сменами цех стоит) */
export function addWork(from: number, ms: number): number {
  let t = from;
  let left = ms;
  for (let i = 0; i < 90 && left > 0; i++) {
    const s = currentOrNextShift(t);
    const start = Math.max(t, s.startMs);
    const avail = s.endMs - start;
    if (left <= avail) return start + left;
    left -= avail;
    t = s.endMs;
  }
  return t + left;
}

function stepNorm(plant: PlantModel) {
  const posts = plantOperations(plant);
  return (s: BodyRouteStepView) => {
    const p = s.postId ? posts.get(s.postId) : undefined;
    return p ? p.normSec / Math.max(1, p.ops.length) : 0;
  };
}

/** Такт участка, с: смена / мощность участка по норме цикла */
function taktSec(plant: PlantModel, stageId: string): number {
  const st = plant.stageById.get(stageId);
  const cap = st ? stageNominal(st) : null;
  return cap && cap.perShift > 0 ? (SHIFT_MIN * 60) / cap.perShift : 0;
}

/** Прогноз стадий машины: когда войдёт и выйдет (текущая — когда выйдет), по нормам и текущим очередям */
export interface StageForecast {
  /** null — вход уже был (текущая стадия) */
  in: number | null;
  out: number;
}

export function projectStages(v: BodyView, detail: BodyDetail, plant: PlantModel, bodies: BodyView[], buffers: BufferView[], now: number): Map<string, StageForecast> {
  const norm = stepNorm(plant);
  const out = new Map<string, StageForecast>();
  if (v.loc.kind === 'finished') return out;
  const idx = plant.stages.findIndex((s) => s.id === v.loc.stageId);
  const inBuffer = v.loc.kind === 'buffer';
  // работа на стадии: обязательные операции, которые ещё не сделаны (последний проход)
  const work = (stageId: string) =>
    detail.route.filter((s) => s.stageId === stageId && !s.optional && (s.status === 'waiting' || s.status === 'in_progress')).reduce((a, s) => a + norm(s), 0);
  let t = now;
  plant.stages.forEach((st, i) => {
    if (i < idx || (inBuffer && i === idx)) return;
    if (i === idx) {
      // текущая стадия: остаток работы минус уже прошедшее время на текущем месте
      let w = work(st.id);
      if (v.loc.kind === 'station' || v.loc.kind === 'stage') w -= Math.min((now - Date.parse(v.since)) / 1000, v.normSec ?? 0);
      t = addWork(t, Math.max(0, w) * 1000);
      out.set(st.id, { in: null, out: t });
      return;
    }
    // очередь перед стадией: в своём буфере — кто впереди, в остальных — сколько там сейчас
    let wait = 0;
    const buf = plant.buffers.find((b) => b.to === st.id);
    if (buf) {
      const count = inBuffer && v.loc.bufferId === buf.id ? bodies.filter((b) => b.loc.kind === 'buffer' && b.loc.bufferId === buf.id && b.order < v.order).length : (buffers.find((b) => b.id === buf.id)?.count ?? 0);
      wait += count * taktSec(plant, st.id);
    }
    if (v.loc.kind === 'warehouse' && st.id === plant.production[0]?.id) wait += bodies.filter((b) => b.loc.kind === 'warehouse' && b.order < v.order).length * taktSec(plant, st.id);
    const enter = addWork(t, wait * 1000);
    t = addWork(enter, work(st.id) * 1000);
    out.set(st.id, { in: enter, out: t });
  });
  return out;
}

export function carEta(v: BodyView, detail: BodyDetail | null | undefined, plant: PlantModel, bodies: BodyView[], buffers: BufferView[], now: number): CarEta | null {
  if (v.loc.kind === 'finished') return { done: true, at: Date.parse(v.since), lateMin: null };
  if (!detail) return null;
  const forecast = projectStages(v, detail, plant, bodies, buffers, now);
  const last = plant.warehouseOut ? forecast.get(plant.warehouseOut.id) : undefined;
  const at = last?.in ?? [...forecast.values()].pop()?.out ?? now;

  // план: вход на первый производственный участок + все нормы + обычные очереди
  const norm = stepNorm(plant);
  const first = plant.production[0]?.id;
  const start = detail.history.find((h) => h.stageId === first && (h.kind === 'checkpoint' || h.kind === 'restored'));
  if (!start) return { done: false, at, lateMin: null };
  const lead =
    detail.route.filter((s) => !s.optional && s.loop === 0).reduce((a, s) => a + norm(s), 0) +
    plant.buffers.reduce((a, b) => a + b.capacity * NORMAL_QUEUE * taktSec(plant, b.to), 0);
  // сравниваем рабочее время: машина, простоявшая ночь между сменами, от плана не отстала
  return { done: false, at, lateMin: Math.round((workMs(Date.parse(start.at), at) - lead * 1000) / MIN) };
}

/** Норма стадии для модели, с: сумма норм обязательных операций маршрута (для «Машин по стадиям») */
const stageNormCache = new WeakMap<PlantModel, Map<string, number>>();
export function stageNorm(plant: PlantModel, model: BodyView['model'], stageId: string): number {
  let m = stageNormCache.get(plant);
  if (!m) stageNormCache.set(plant, (m = new Map()));
  const key = `${model}|${stageId}`;
  let n = m.get(key);
  if (n === undefined) {
    n = modelOperations(plant, model).filter((s) => s.stageId === stageId && !s.optional).reduce((a, s) => a + s.normSec, 0);
    m.set(key, n);
  }
  return n;
}

/** Норма шага маршрута, с (по операциям поста из конфигурации завода) */
export function routeStepNorm(plant: PlantModel, step: BodyRouteStepView): number {
  return stepNorm(plant)(step);
}

// ---------------------------------------------------------------------------
// Отметки и события

export const FLAG_TEXT: Record<BodyFlag, string> = {
  delayed: 'задерживается',
  nonconformity: 'несоответствие',
  rework: 'перекраска',
  restored_checkpoint: 'восстановленная отметка',
  unknown_color: 'цвет не передан из 1С',
};

/** Проблемные — те, что требуют внимания прямо сейчас */
export function isProblem(v: BodyView): boolean {
  return v.flags.includes('delayed') || v.flags.includes('rework') || v.flags.includes('nonconformity');
}

export type EventKind = 'scanner' | 'rfid' | 'plc' | 'tool' | 'master' | 'onec' | 'twin';

export interface CarEvent {
  at: string;
  text: string;
  kind: EventKind;
  /** «Сканер 1С:MES», «RFID тележки», «Инструмент поста» */
  label: string;
  restored: boolean;
}

const ONE_C: Record<string, string> = { mes: '1С:MES', erp: '1С:ERP', qls: '1С:QLS', wms: '1С:WMS' };

function eventOf(h: BodyHistoryItem): CarEvent {
  const restored = h.kind === 'restored' || !!h.restored;
  const base = { at: h.at, text: h.text, restored };
  switch (h.method) {
    case 'mes_scan':
      return { ...base, kind: 'scanner', label: ID_METHOD_DEF.mes_scan.label };
    case 'rfid':
      return { ...base, kind: 'rfid', label: ID_METHOD_DEF.rfid.label };
    case 'plc_tracking':
      return { ...base, kind: 'plc', label: ID_METHOD_DEF.plc_tracking.label };
    case 'tool_result':
      return { ...base, kind: 'tool', label: ID_METHOD_DEF.tool_result.label };
    case 'manual':
      return { ...base, kind: 'master', label: ID_METHOD_DEF.manual.label };
  }
  if (ONE_C[h.source]) return { ...base, kind: 'onec', label: ONE_C[h.source]! };
  if (h.source === 'plc') return { ...base, kind: 'plc', label: 'Контроллер' };
  if (h.source === 'master') return { ...base, kind: 'master', label: 'Мастер' };
  return { ...base, kind: 'twin', label: 'Двойник' };
}

/** Последние события по машине, новые сверху (повторы отметок не показываем) */
export function lastEvents(history: BodyHistoryItem[], n = 3): CarEvent[] {
  const out: CarEvent[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < n; i--) {
    const h = history[i]!;
    if (h.kind !== 'duplicate') out.push(eventOf(h));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Машины участка (список в «Панели»)

/** Сначала проблемные, затем дольше всех на месте */
export function sortCars(list: BodyView[]): BodyView[] {
  return [...list].sort((a, b) => Number(isProblem(b)) - Number(isProblem(a)) || Date.parse(a.since) - Date.parse(b.since));
}

/** На участке и в очереди перед ним */
export function carsOfArea(bodies: BodyView[], plant: PlantModel, area: string): { here: BodyView[]; queued: BodyView[] } {
  const before = plant.buffers.find((b) => b.to === area)?.id;
  const here: BodyView[] = [];
  const queued: BodyView[] = [];
  for (const b of bodies) {
    if (b.loc.kind === 'buffer') {
      if (before && b.loc.bufferId === before) queued.push(b);
    } else if (b.loc.stageId === area) here.push(b);
  }
  return { here: sortCars(here), queued: [...queued].sort((a, b) => a.order - b.order) };
}
