// Русские форматы для файлов: 08.10.2026 14:20, 1 250 000, 3,5%, 1 250 000 ₸ (время завода, UTC+5).
import { plantParts } from '@allur/contracts';
import type { CellValue, ColType } from './model';

/** Неразрывный пробел: число не переносится по строкам в PDF и Word */
const NBSP = ' ';
const pad = (n: number) => String(n).padStart(2, '0');

export function fmtInt(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const g = s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (n < 0 && Math.round(Math.abs(n)) !== 0 ? '−' : '') + g;
}

export function fmtDec(n: number, digits = 1): string {
  const fixed = Math.abs(n).toFixed(digits);
  const [i, f] = fixed.split('.');
  const g = i!.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (n < 0 && Number(fixed) !== 0 ? '−' : '') + g + (f ? `,${f}` : '');
}

/** Доля 0..1 → «3,5%» */
export function fmtPct(share: number): string {
  return `${fmtDec(share * 100, 1)}%`;
}

export function fmtMoney(n: number): string {
  return `${fmtInt(n)}${NBSP}₸`;
}

export function fmtDateTime(ms: number): string {
  const p = plantParts(ms);
  return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function fmtDate(ms: number): string {
  const p = plantParts(ms);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

/** «2026-10-08» → «08.10.2026» */
export function fmtIsoDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtTime(ms: number): string {
  const p = plantParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Значение ячейки словами — для PDF, Word и итоговых цифр */
export function fmtCell(v: CellValue, type: ColType): string {
  if (v === null || v === '') return '—';
  if (typeof v === 'string') return v;
  switch (type) {
    case 'int':
      return fmtInt(v);
    case 'minutes':
      return fmtInt(v);
    case 'dec1':
      return fmtDec(v, 1);
    case 'pct':
      return fmtPct(v);
    case 'money':
      return fmtMoney(v);
    case 'datetime':
      return fmtDateTime(v);
    case 'date':
      return fmtDate(v);
    case 'time':
      return fmtTime(v);
    default:
      return String(v);
  }
}

/** CSV: числа без пробелов тысяч и с запятой — Excel на русской Windows читает их как числа */
export function csvCell(v: CellValue, type: ColType): string {
  if (v === null) return '';
  if (typeof v === 'string') return v;
  switch (type) {
    case 'int':
    case 'minutes':
    case 'money':
      return String(Math.round(v));
    case 'dec1':
      return v.toFixed(1).replace('.', ',');
    case 'pct':
      return (v * 100).toFixed(1).replace('.', ',');
    case 'datetime':
      return fmtDateTime(v);
    case 'date':
      return fmtDate(v);
    case 'time':
      return fmtTime(v);
    default:
      return String(v);
  }
}

/** «Окраска» → «Окраска», «Сборка и контроль» → «Сборка_и_контроль»: для имени файла */
export function fileWord(s: string): string {
  return s
    .replace(/[«»"'/\\:*?<>|]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}
