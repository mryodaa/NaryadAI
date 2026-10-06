// Тексты для людей: числа и время по-русски, по времени завода (UTC+5).
import { plantParts } from '@allur/contracts';

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const num = (n: number) => nf0.format(Math.round(n));
export const num1 = (n: number) => nf1.format(n);
export const pct1 = (share: number) => `${nf1.format(share * 100)}%`;
export const money = (n: number) => `${nf0.format(Math.round(n))} ₸`;

export function hm(ms: number): string {
  const p = plantParts(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function dayMonth(ms: number): string {
  const p = plantParts(ms);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

export function ddmm(ms: number): string {
  const p = plantParts(ms);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}`;
}

export function minutes(m: number): string {
  const v = Math.max(0, Math.round(m));
  if (v < 60) return `${v} мин`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const cars = (n: number) => `${num(n)} ${plural(n, ['машина', 'машины', 'машин'])}`;
export const bodies = (n: number) => `${num(n)} ${plural(n, ['кузов', 'кузова', 'кузовов'])}`;

/** «−12 машин», «+40 машин» */
export function signedCars(n: number): string {
  const r = Math.round(n);
  const sign = r > 0 ? '+' : r < 0 ? '−' : '';
  return `${sign}${num(Math.abs(r))} ${plural(r, ['машина', 'машины', 'машин'])}`;
}

export function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
