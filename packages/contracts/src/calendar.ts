// Производственный календарь (в реальном внедрении — из 1С:ERP).
import { DAY, MINUTE, addDays, monthDates, plantMs, plantParts } from './time';

export const SHIFT_MINUTES = 480;

export interface ShiftDef {
  index: 1 | 2;
  startMin: number;
  endMin: number;
  name: string;
}

export const SHIFTS: readonly ShiftDef[] = [
  { index: 1, startMin: 8 * 60, endMin: 16 * 60, name: '1 смена' },
  { index: 2, startMin: 16 * 60, endMin: 24 * 60, name: '2 смена' },
];

export interface CalendarOverride {
  date: string;
  working: boolean;
  note: string;
}

/**
 * Отклонения от пятидневки. Субботы — допущение прототипа: без них план 5500
 * физически не помещается в октябрь (см. docs/ASSUMPTIONS.md).
 */
export const CALENDAR_OVERRIDES: readonly CalendarOverride[] = [
  { date: '2026-10-17', working: true, note: 'Рабочая суббота (допущение: заложена в план 5500)' },
  { date: '2026-10-24', working: true, note: 'Рабочая суббота (допущение: заложена в план 5500)' },
  { date: '2026-10-26', working: false, note: 'Выходной: перенос Дня Республики (25.10 — воскресенье)' },
];

const OVERRIDE_BY_DATE = new Map(CALENDAR_OVERRIDES.map((o) => [o.date, o]));

export function isWorkingDay(date: string, extraSaturdays: readonly string[] = []): boolean {
  const o = OVERRIDE_BY_DATE.get(date);
  if (o) return o.working;
  if (extraSaturdays.includes(date)) return true;
  const wd = plantParts(plantMs(date, 12 * 60)).weekday;
  return wd <= 5;
}

export interface ShiftRef {
  date: string;
  index: 1 | 2;
  startMs: number;
  endMs: number;
  /** «2026-10-07#1» */
  key: string;
}

export function shiftRef(date: string, index: 1 | 2): ShiftRef {
  const def = SHIFTS[index - 1]!;
  return {
    date,
    index,
    startMs: plantMs(date, def.startMin),
    endMs: plantMs(date, def.endMin),
    key: `${date}#${index}`,
  };
}

/** Смена, идущая в момент ms; null — нерабочее время */
export function shiftAt(ms: number): ShiftRef | null {
  const p = plantParts(ms);
  if (!isWorkingDay(p.date)) return null;
  const def = SHIFTS.find((s) => p.minuteOfDay >= s.startMin && p.minuteOfDay < s.endMin);
  return def ? shiftRef(p.date, def.index) : null;
}

/** Текущая смена, а если сейчас нерабочее время — ближайшая следующая */
export function currentOrNextShift(ms: number): ShiftRef {
  const now = shiftAt(ms);
  if (now) return now;
  let date = plantParts(ms).date;
  for (let i = 0; i < 30; i++) {
    if (isWorkingDay(date)) {
      for (const s of SHIFTS) {
        const ref = shiftRef(date, s.index);
        if (ref.startMs > ms) return ref;
      }
    }
    date = addDays(date, 1);
  }
  throw new Error('Не найдена рабочая смена в ближайшие 30 дней');
}

/** Предыдущая завершённая смена */
export function previousShift(ms: number): ShiftRef {
  let date = plantParts(ms).date;
  for (let i = 0; i < 30; i++) {
    if (isWorkingDay(date)) {
      for (const s of [...SHIFTS].reverse()) {
        const ref = shiftRef(date, s.index);
        if (ref.endMs <= ms) return ref;
      }
    }
    date = addDays(date, -1);
  }
  throw new Error('Не найдена прошедшая смена за 30 дней');
}

/** Рабочие смены месяца по порядку */
export function monthShifts(month: string, extraSaturdays: readonly string[] = []): ShiftRef[] {
  const out: ShiftRef[] = [];
  for (const date of monthDates(month)) {
    if (!isWorkingDay(date, extraSaturdays)) continue;
    for (const s of SHIFTS) out.push(shiftRef(date, s.index));
  }
  return out;
}

/** Рабочие смены, начинающиеся в интервале дат [fromDate, toDate] включительно */
export function shiftsBetweenDates(fromDate: string, toDate: string): ShiftRef[] {
  const out: ShiftRef[] = [];
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    for (const s of SHIFTS) out.push(shiftRef(d, s.index));
  }
  return out;
}

/** Субботы месяца, которые по календарю нерабочие (кандидаты на доп. смены) */
export function freeSaturdays(month: string): string[] {
  return monthDates(month).filter((d) => plantParts(plantMs(d, 12 * 60)).weekday === 6 && !isWorkingDay(d));
}

export function minutesInto(shift: ShiftRef, ms: number): number {
  return Math.max(0, Math.min(SHIFT_MINUTES, (ms - shift.startMs) / MINUTE));
}

export const ONE_DAY_MS = DAY;
