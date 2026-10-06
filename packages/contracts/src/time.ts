// Время завода. Костанай — UTC+5 круглый год (единый часовой пояс РК с 2024 г.).
// Считаем смещение вручную, а не через Intl с 'Asia/Qostanay': в старых базах
// часовых поясов у Костаная ещё UTC+6.

export const PLANT_UTC_OFFSET_MIN = 300;
const OFFSET_MS = PLANT_UTC_OFFSET_MIN * 60_000;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface PlantParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 — понедельник … 7 — воскресенье */
  weekday: number;
  /** ГГГГ-ММ-ДД по времени завода */
  date: string;
  minuteOfDay: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function plantParts(ms: number): PlantParts {
  const d = new Date(ms + OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const wd = d.getUTCDay();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second: d.getUTCSeconds(),
    weekday: wd === 0 ? 7 : wd,
    date: `${year}-${pad(month)}-${pad(day)}`,
    minuteOfDay: hour * 60 + minute,
  };
}

export function plantDate(ms: number): string {
  return plantParts(ms).date;
}

/** Момент времени по дате завода и минуте от полуночи */
export function plantMs(date: string, minuteOfDay = 0): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) + minuteOfDay * MINUTE - OFFSET_MS;
}

/** ISO 8601 со смещением завода: 2026-10-07T13:40:00+05:00 */
export function toPlantIso(ms: number): string {
  const p = plantParts(ms);
  const sign = PLANT_UTC_OFFSET_MIN >= 0 ? '+' : '-';
  const off = Math.abs(PLANT_UTC_OFFSET_MIN);
  return `${p.date}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`;
}

export function addDays(date: string, n: number): string {
  return plantDate(plantMs(date, 12 * 60) + n * DAY);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

export function monthDates(month: string): string[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** «01.10.2026» или «2026-10-01» → «2026-10-01» */
export function normalizeDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return null;
}

/** Старт демонстрации: среда, 7 октября 2026, начало первой смены */
export const DEMO_START_ISO = '2026-10-07T08:00:00+05:00';
export const DEMO_START_MS = Date.parse(DEMO_START_ISO);
