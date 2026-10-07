// Лента всех стадий машины для паспорта: по каждой стадии — статус, вход и выход, длительность против
// нормы, линия, вид кузова; петли перекраски и выборочный контроль — ответвлениями; будущие стадии —
// с ориентировочным временем. Данные — проходы участков и маршрут операций из трекера двойника.
import type { BodyDetail, BodyHistoryItem, BodyRouteStepView, BodyView, PlantModel, RouteStatus, VisualEffect } from '@allur/contracts/ref';
import { routeStepNorm, stageProgress, workMs, type StageForecast, type StageMark } from './cars';

/** Вид кузова на стадии — по визуальным эффектам операций */
export interface BodyLook {
  kind: 'kit' | 'metal' | 'ecoat' | 'primer' | 'paint' | 'assembled' | 'stand' | 'parked';
  label: string;
  color: string;
}

export interface RibbonOp {
  name: string;
  status: RouteStatus;
  at: string | null;
  /** Чем подтверждено — словами */
  how: string | null;
  source: string | null;
  loop: number;
  optional: boolean;
}

export interface RibbonBranch {
  kind: 'loop' | 'side';
  title: string;
  from: string | null;
  to: string | null;
}

export interface RibbonStage {
  id: string;
  name: string;
  /** Линия или станция, если на участке их несколько: «линия Onix» */
  line: string | null;
  mark: StageMark;
  in: string | null;
  out: string | null;
  /** Рабочих минут на стадии (для текущей — до сих пор) */
  minutes: number | null;
  normMin: number | null;
  late: boolean;
  /** Ориентировочно: для будущих — вход и выход, для текущей — выход */
  forecast: StageForecast | null;
  /** Прошла до начала отслеживания: времени нет, операции приняты по маршруту */
  assumed: boolean;
  look: BodyLook;
  restored: BodyHistoryItem[];
  branches: RibbonBranch[];
  ops: RibbonOp[];
}

const KIT = '#a8875f';
const METAL = '#a9b1ba';
const ECOAT = '#4b5058';
const PRIMER = '#c9ccce';

/** Вид кузова по накопленным эффектам операций (и для повтора истории) */
export function lookOf(effects: VisualEffect[], color: string | null, stageKind: string): BodyLook {
  const has = (e: VisualEffect) => effects.includes(e);
  if (stageKind === 'warehouse_in') return { kind: 'kit', label: 'машинокомплект', color: KIT };
  if (has('parked') || stageKind === 'warehouse_out') return { kind: 'parked', label: 'готовая машина', color: color ?? PRIMER };
  if (has('on_rollers') || has('on_alignment_stand') || has('in_water_booth')) return { kind: 'stand', label: 'на стенде', color: color ?? PRIMER };
  if (has('complete') || has('wheels') || has('chassis') || has('trim') || has('glass')) return { kind: 'assembled', label: 'сборка', color: color ?? PRIMER };
  if (has('color') || has('gloss')) return { kind: 'paint', label: 'в цвете', color: color ?? PRIMER };
  if (has('primer')) return { kind: 'primer', label: 'грунт', color: PRIMER };
  if (has('ecoat')) return { kind: 'ecoat', label: 'катафорез', color: ECOAT };
  return { kind: 'metal', label: 'металл', color: METAL };
}

const HOW: Record<NonNullable<BodyRouteStepView['by']>, string> = {
  operation: 'результат операции',
  station_out: 'выход со станции',
  stage_exit: 'выход участка',
  assumed: 'до начала отслеживания',
};

export function passportRibbon(v: BodyView, detail: BodyDetail, plant: PlantModel, forecast: Map<string, StageForecast>, now: number): RibbonStage[] {
  const marks = stageProgress(v, plant, detail.route);
  return plant.stages.map((st, i) => {
    const mark = marks[i]!.mark;
    const passes = detail.stages.filter((p) => p.stageId === st.id);
    const steps = detail.route.filter((s) => s.stageId === st.id);
    const first = passes[0];
    const lastPass = passes[passes.length - 1];
    const inAt = first?.in ?? null;
    // склад готовой продукции — конечная: машина там стоит, выхода и длительности нет
    const terminal = st.kind === 'warehouse_out';
    const outAt = terminal ? inAt : mark === 'done' ? (lastPass?.out ?? null) : null;
    const minutes = inAt && !terminal ? Math.round(workMs(Date.parse(inAt), outAt ? Date.parse(outAt) : now) / 60_000) : null;
    const normSec = steps.filter((s) => !s.optional && s.loop === 0).reduce((a, s) => a + routeStepNorm(plant, s), 0);
    const normMin = normSec > 0 ? Math.max(1, Math.round(normSec / 60)) : null;
    // линия: на участке с параллельными станциями — станция машины
    const eq = steps.map((s) => (s.equipmentId ? plant.equipmentById.get(s.equipmentId) : undefined)).find((e) => e?.stationId);
    const line = st.stations.length > 1 && eq ? (st.stations.find((x) => x.id === eq.stationId)?.name ?? null) : null;
    // вид кузова к концу стадии: эффекты всех операций до этой стадии включительно
    const upTo = detail.route.filter((s) => plant.stages.findIndex((x) => x.id === s.stageId) <= i && s.effect).map((s) => s.effect!);
    const look = lookOf(upTo, v.color?.hex ?? null, st.kind);
    const branches: RibbonBranch[] = [];
    // петли: по проходам участка, а если перекраску назначили до выхода с участка — по операциям второго прохода
    const loops = [...new Set([...passes.map((p) => p.loop), ...steps.map((x) => x.loop)])].filter((l) => l > 0).sort((a, b) => a - b);
    for (const loop of loops) {
      const p = passes.find((x) => x.loop === loop);
      const ls = steps.filter((x) => x.loop === loop && !x.optional);
      const times = ls.map((x) => x.at).filter((x): x is string => !!x).sort();
      const finished = ls.length > 0 && ls.every((x) => x.status === 'done' || x.status === 'failed');
      branches.push({
        kind: 'loop',
        title: `${st.kind === 'painting' ? 'Перекраска' : 'Повторный проход'}, ${loop + 1}-й проход`,
        from: p?.in ?? times[0] ?? null,
        to: p?.out ?? (finished ? (times[times.length - 1] ?? null) : null),
      });
    }
    for (const s of steps.filter((x) => x.optional && (x.status === 'done' || x.status === 'in_progress' || x.status === 'failed'))) {
      const e = s.equipmentId ? plant.equipmentById.get(s.equipmentId) : undefined;
      branches.push({ kind: 'side', title: `Выборочно: ${e?.name ?? s.name}`, from: s.at, to: null });
    }
    return {
      id: st.id,
      name: st.short,
      line,
      mark,
      in: inAt,
      out: outAt,
      minutes,
      normMin,
      late: minutes !== null && normMin !== null && minutes > normMin * 1.5,
      forecast: forecast.get(st.id) ?? null,
      // пройдена, а времени нет — была до начала отслеживания (или двойник её не застал)
      assumed: !first && mark === 'done',
      look,
      restored: detail.history.filter((h) => h.stageId === st.id && (h.kind === 'restored' || h.restored)),
      branches,
      ops: steps
        .filter((s) => !(s.optional && s.status === 'skipped'))
        .map((s) => ({ name: s.name, status: s.status, at: s.at, how: s.by ? HOW[s.by] : null, source: s.source, loop: s.loop, optional: s.optional })),
    };
  });
}
