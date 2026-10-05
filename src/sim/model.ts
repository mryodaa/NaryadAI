import { VIB_CRIT, VIB_NORM } from './config';
import type { Equipment } from './types';
import { num } from '../lib/format';

/**
 * «ИИ-модель» прогноза отказа. В демо это прозрачная логистическая регрессия
 * с фиксированными весами — тот же формат, что дала бы обученная модель
 * (CatBoost/LightGBM + SHAP): вероятность + вклад каждого признака.
 */

export interface RiskTerm {
  key: 'vib' | 'trend' | 'maint' | 'temp';
  label: string;
  w: number;
}

export interface Risk {
  /** Вероятность отказа в ближайшие 8 часов */
  p: number;
  /** Оценка времени до достижения критической вибрации, мин */
  ttf: number | null;
  trendH: number;
  terms: RiskTerm[];
}

const BIAS = -3.4;

export function slopePerMin(arr: number[], n = 60): number {
  const xs = arr.slice(-n);
  const k = xs.length;
  if (k < 5) return 0;
  const mx = (k - 1) / 2;
  const my = xs.reduce((a, b) => a + b, 0) / k;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < k; i++) {
    sxy += (i - mx) * (xs[i] - my);
    sxx += (i - mx) * (i - mx);
  }
  return sxy / sxx;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function assessRisk(e: Equipment): Risk {
  const trendH = slopePerMin(e.vibHist) * 60;
  const hr = e.hours / e.maintIntervalH;
  const dTemp = e.temp - e.tempBase;
  const terms: RiskTerm[] = [
    { key: 'vib', label: `Вибрация ${num(e.vib, 1)} мм/с (норма ≤ ${num(VIB_NORM, 1)})`, w: 0.6 * (e.vib - VIB_NORM) },
    { key: 'trend', label: `Тренд вибрации ${trendH >= 0 ? '+' : '−'}${num(Math.abs(trendH), 1)} мм/с за час`, w: 1.5 * Math.max(trendH, -0.5) },
    { key: 'maint', label: `${Math.round(e.hours)} ч после ТО (регламент ${e.maintIntervalH} ч)`, w: 2.4 * (hr - 0.75) },
    { key: 'temp', label: `Температура ${dTemp >= 0 ? '+' : '−'}${num(Math.abs(dTemp), 1)} °C к норме`, w: 0.08 * dTemp },
  ];
  const logit = BIAS + terms.reduce((a, t) => a + t.w, 0);
  const ttf = trendH > 0.15 ? Math.max(0, (VIB_CRIT - e.vib) / (trendH / 60)) : null;
  return { p: sigmoid(logit), ttf, trendH, terms };
}

export function topReasons(r: Risk, n = 3): string[] {
  return [...r.terms].sort((a, b) => b.w - a.w).slice(0, n).filter((t) => t.w > 0).map((t) => t.label);
}
