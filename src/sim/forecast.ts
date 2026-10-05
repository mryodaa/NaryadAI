import { MAINT_COST, MAINT_MIN, MAJOR_REPAIR_MIN, MARGIN_PER_CAR, REPAIR_COST, SHIFT_LEN, STATIONS } from './config';
import { step } from './engine';
import { frameOf, shiftBounds } from './analytics';
import { assessRisk, type Risk } from './model';
import type { Forced, MapFrame, SimState } from './types';
import { clock } from '../lib/format';

/**
 * Прогноз = прогон копии цифрового двойника вперёд по времени.
 * В копии нет случайностей: микропростои заменены средней доступностью,
 * а деградация оборудования продолжается по текущему тренду.
 */
export function cloneSim(s: SimState): SimState {
  const { incidents: _i, orders: _o, downtime: _d, mechanics: _m, ...rest } = s;
  const c = structuredClone(rest) as unknown as SimState;
  c.incidents = [];
  c.orders = [];
  c.downtime = [];
  c.mechanics = [];
  c.forecast = true;
  c.forecastEvents = [];
  c.forced = [];
  c.forecastAvail = STATIONS.map((d) => 1 - d.microP * 7.5);
  return c;
}

export interface Forecast {
  at: number;
  frames: MapFrame[];
  curve: [number, number][];
  endShipped: number;
  shiftEnd: number;
  failures: { t: number; equipId: string }[];
}

export const FUTURE_MIN = 120;

export function buildForecast(s: SimState): Forecast {
  const c = cloneSim(s);
  const { end } = shiftBounds(s.t);
  const horizon = Math.max(FUTURE_MIN, end - s.t);
  const frames: MapFrame[] = [];
  const curve: [number, number][] = [[s.t, s.shift.shipped]];
  let endShipped = s.shift.shipped;
  for (let k = 0; k < horizon; k++) {
    step(c);
    if (k < FUTURE_MIN) frames.push(frameOf(c));
    if (c.t < end) {
      curve.push([c.t, c.shift.shipped]);
      endShipped = c.shift.shipped;
    }
  }
  return { at: s.t, frames, curve, endShipped, shiftEnd: end, failures: c.forecastEvents };
}

/* ------------------------------------------------------------------ «Что если?» */

export interface WhatIfOption {
  id: 'now' | 'planned' | 'none';
  title: string;
  subtitle: string;
  lostCars: number;
  costRub: number;
  pFail: number;
  notes: string[];
  recommended: boolean;
}

export interface WhatIfResult {
  equipId: string;
  risk: Risk;
  horizon: number;
  plannedAt: number;
  options: WhatIfOption[];
}

function failProb(r: Risk, horizonMin: number): number {
  const byP = (r.p * horizonMin) / 480;
  const byTtf = r.ttf != null ? 1 / (1 + Math.exp(-(horizonMin - r.ttf) / 30)) : 0;
  return Math.min(0.99, Math.max(0.01, byP, byTtf));
}

export function whatIf(s: SimState, equipId: string): WhatIfResult {
  const e = s.equipment.find((x) => x.id === equipId)!;
  const r = assessRisk(e);
  const ttf = r.ttf ?? 240;
  let plannedAt = shiftBounds(s.t).end;
  if (plannedAt - s.t < 30) plannedAt += SHIFT_LEN;
  // горизонт должен вместить отказ и весь аварийный ремонт, иначе бездействие выглядит дешевле
  const H = Math.min(720, Math.max(360, plannedAt - s.t + 90, ttf + MAJOR_REPAIR_MIN + 60));

  // каждый вариант — отдельный прогон двойника на H минут вперёд
  const run = (forced: Omit<Forced, 'equipId'>[]) => {
    const c = cloneSim(s);
    c.equipment.find((x) => x.id === equipId)!.drift = 0;
    c.forced = forced.map((f) => ({ ...f, equipId }));
    for (let k = 0; k < H; k++) step(c);
    return c.totalShipped - s.totalShipped;
  };
  const failAt = (limit: number) => s.t + Math.max(2, Math.round(Math.min(ttf, limit)));

  const base = run([]);
  const now = run([{ t: s.t + 1, kind: 'maint', dur: MAINT_MIN }]);
  const dtPlanned = plannedAt - s.t;
  const pB = failProb(r, dtPlanned);
  const bFail = run([{ t: failAt(dtPlanned - 5), kind: 'fail', dur: MAJOR_REPAIR_MIN }]);
  const bOk = run([{ t: plannedAt, kind: 'maint', dur: MAINT_MIN }]);
  const pC = failProb(r, H);
  const cFail = run([{ t: failAt(H - MAJOR_REPAIR_MIN - 60), kind: 'fail', dur: MAJOR_REPAIR_MIN }]);

  const M = MARGIN_PER_CAR;
  const lostNow = Math.max(0, base - now);
  const lostBFail = Math.max(0, base - bFail);
  const lostBOk = Math.max(0, base - bOk);
  const lostCFail = Math.max(0, base - cFail);

  const options: WhatIfOption[] = [
    {
      id: 'now',
      title: 'Остановить на ТО сейчас',
      subtitle: `${MAINT_MIN} мин плановой остановки`,
      lostCars: lostNow,
      costRub: lostNow * M + MAINT_COST,
      pFail: 0,
      notes: [
        lostNow < 1 ? 'Буферы полностью поглощают остановку' : `Буферы поглощают часть остановки, потери ${Math.round(lostNow)} авто`,
        'Риск аварии устраняется',
      ],
      recommended: false,
    },
    {
      id: 'planned',
      title: 'ТО в пересменку',
      subtitle: `остановка в ${clock(plannedAt)}, если доработает`,
      lostCars: pB * lostBFail + (1 - pB) * lostBOk,
      costRub: pB * (lostBFail * M + REPAIR_COST) + (1 - pB) * (lostBOk * M + MAINT_COST),
      pFail: pB,
      notes: [`Вероятность отказа до пересменки — ${Math.round(pB * 100)}%`, `При отказе: аварийный ремонт ~${Math.round(MAJOR_REPAIR_MIN / 60 * 10) / 10} ч`],
      recommended: false,
    },
    {
      id: 'none',
      title: 'Ничего не делать',
      subtitle: `работать до отказа (горизонт ${Math.round(H / 60)} ч)`,
      lostCars: pC * lostCFail,
      costRub: pC * (lostCFail * M + REPAIR_COST),
      pFail: pC,
      notes: [`Вероятность отказа — ${Math.round(pC * 100)}%`, `Потери при отказе: ${Math.round(lostCFail)} авто + ремонт`],
      recommended: false,
    },
  ];
  const best = options.reduce((a, b) => (b.costRub < a.costRub ? b : a));
  best.recommended = true;
  return { equipId, risk: r, horizon: H, plannedAt, options };
}
