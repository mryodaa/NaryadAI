// Локализованное форматирование: числа, время завода (UTC+5), даты, длительность и плюрализация.
import { plantParts } from '@allur/contracts/ref';
import { useI18n } from '../i18n/store';
import type { Lang } from '../i18n/types';

function currentLang(lang?: Lang): Lang {
  if (lang) return lang;
  try {
    return useI18n.getState().lang;
  } catch {
    return 'ru';
  }
}

const NF = {
  ru: {
    nf0: new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }),
    nf1: new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  },
  kk: {
    nf0: new Intl.NumberFormat('kk-KZ', { maximumFractionDigits: 0 }),
    nf1: new Intl.NumberFormat('kk-KZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  },
  en: {
    nf0: new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }),
    nf1: new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  },
};

const MONTHS: Record<Lang, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  kk: ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const WEEKDAYS: Record<Lang, string[]> = {
  ru: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'],
  kk: ['дүй', 'сей', 'сәр', 'бей', 'жұм', 'сен', 'жек'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

const MINUS = '−';

export function num(n: number, lang?: Lang): string {
  const l = currentLang(lang);
  return NF[l].nf0.format(Math.round(n));
}

export function num1(n: number, lang?: Lang): string {
  const l = currentLang(lang);
  return NF[l].nf1.format(n);
}

/** Со знаком: +40, −212 (настоящий минус) */
export function signed(n: number, lang?: Lang): string {
  const l = currentLang(lang);
  const r = Math.round(n);
  if (r === 0) return '0';
  return (r > 0 ? '+' : MINUS) + NF[l].nf0.format(Math.abs(r));
}

/** Доля 0..1 → «3,4%» / «3.4%» */
export function pct1(share: number, lang?: Lang): string {
  const l = currentLang(lang);
  return `${NF[l].nf1.format(share * 100)}%`;
}

export function pct0(share: number, lang?: Lang): string {
  const l = currentLang(lang);
  return `${NF[l].nf0.format(share * 100)}%`;
}

/** Ускорение времени двойника: «×60», «×1,5» / «×1.5» */
export function speedLabel(speed: number, lang?: Lang): string {
  const l = currentLang(lang);
  return `×${Number.isInteger(speed) ? NF[l].nf0.format(speed) : NF[l].nf1.format(speed)}`;
}

export function money(tenge: number, lang?: Lang): string {
  const l = currentLang(lang);
  return `${NF[l].nf0.format(Math.round(tenge))} ₸`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function ms(iso: string | number): number {
  return typeof iso === 'number' ? iso : Date.parse(iso);
}

export function timeHM(iso: string | number, _lang?: Lang): string {
  const p = plantParts(ms(iso));
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function dateShort(iso: string | number, lang?: Lang): string {
  const l = currentLang(lang);
  const p = plantParts(ms(iso));
  const monthName = MONTHS[l][p.month - 1];
  if (l === 'en') {
    return `${monthName} ${p.day}`;
  }
  return `${p.day} ${monthName}`;
}

/** «7 окт, 14:20» / «7 қаз, 14:20» / «Oct 7, 14:20» */
export function dateTime(iso: string | number, lang?: Lang): string {
  return `${dateShort(iso, lang)}, ${timeHM(iso)}`;
}

export function weekday(iso: string | number, lang?: Lang): string {
  const l = currentLang(lang);
  return WEEKDAYS[l][plantParts(ms(iso)).weekday - 1]!;
}

/** «1 ч 25 мин», «40 мин» / «1 сағ 25 мин» / «1 h 25 min» */
export function duration(minutes: number, lang?: Lang): string {
  const l = currentLang(lang);
  const m = Math.max(0, Math.round(minutes));
  const hUnit = l === 'kk' ? 'сағ' : l === 'en' ? 'h' : 'ч';
  const mUnit = l === 'en' ? 'min' : 'мин';

  if (m < 60) return `${m} ${mUnit}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ${hUnit} ${r} ${mUnit}` : `${h} ${hUnit}`;
}

/** Склонение с поддержкой ru, kk, en */
export function plural(n: number, forms: [string, string, string], lang?: Lang): string {
  const l = currentLang(lang);
  const abs = Math.abs(Math.round(n));

  if (l === 'kk') {
    // В казахском языке существительное с числительным стоит в единственном числе: 5 машина, 10 көлік
    return forms[0];
  }

  if (l === 'en') {
    return abs === 1 ? forms[0] : forms[1];
  }

  // Русский: 1 форма, 2-4 форма, 5+ форма
  const a = abs % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function getCarsUnit(lang?: Lang): [string, string, string] {
  const l = currentLang(lang);
  if (l === 'kk') return ['көлік', 'көлік', 'көлік'];
  if (l === 'en') return ['car', 'cars', 'cars'];
  return ['машина', 'машины', 'машин'];
}

export function getBodiesUnit(lang?: Lang): [string, string, string] {
  const l = currentLang(lang);
  if (l === 'kk') return ['шанақ', 'шанақ', 'шанақ'];
  if (l === 'en') return ['body', 'bodies', 'bodies'];
  return ['кузов', 'кузова', 'кузовов'];
}

export const CARS: [string, string, string] = ['машина', 'машины', 'машин'];
export const BODIES: [string, string, string] = ['кузов', 'кузова', 'кузовов'];
