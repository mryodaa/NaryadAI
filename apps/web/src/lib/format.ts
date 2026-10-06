// Русская локаль: «7 окт, 14:20», «5 288», «3,4%», «1 250 000 ₸».
// Время показываем по заводу (UTC+5), независимо от часового пояса браузера.
import { plantParts } from '@allur/contracts/ref';

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const MINUS = '−';

export function num(n: number): string {
  return nf0.format(Math.round(n));
}

export function num1(n: number): string {
  return nf1.format(n);
}

/** Со знаком: +40, −212 (настоящий минус) */
export function signed(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0';
  return (r > 0 ? '+' : MINUS) + nf0.format(Math.abs(r));
}

/** Доля 0..1 → «3,4%» */
export function pct1(share: number): string {
  return `${nf1.format(share * 100)}%`;
}

export function pct0(share: number): string {
  return `${nf0.format(share * 100)}%`;
}

export function money(tenge: number): string {
  return `${nf0.format(Math.round(tenge))} ₸`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function ms(iso: string | number): number {
  return typeof iso === 'number' ? iso : Date.parse(iso);
}

export function timeHM(iso: string | number): string {
  const p = plantParts(ms(iso));
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function dateShort(iso: string | number): string {
  const p = plantParts(ms(iso));
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** «7 окт, 14:20» */
export function dateTime(iso: string | number): string {
  return `${dateShort(iso)}, ${timeHM(iso)}`;
}

export function weekday(iso: string | number): string {
  return WEEKDAYS[plantParts(ms(iso)).weekday - 1]!;
}

/** «1 ч 25 мин», «40 мин» */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}

/** Склонение: plural(5, ['машина', 'машины', 'машин']) */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.round(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const CARS: [string, string, string] = ['машина', 'машины', 'машин'];
