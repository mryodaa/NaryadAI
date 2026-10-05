import { DAY_START } from '../sim/config';

export function clock(t: number): string {
  const m = (((DAY_START + Math.round(t)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function money(rub: number): string {
  const a = Math.abs(rub);
  if (a >= 1e6) return `${(rub / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace('.', ',')} млн ₽`;
  if (a >= 1e3) return `${Math.round(rub / 1e3)} тыс ₽`;
  return `${Math.round(rub)} ₽`;
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits).replace('.', ',')}%`;
}

export function dur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}

// toLocaleString создаёт форматтер на каждый вызов — это медленно в горячем цикле прогноза
const NF = new Map<number, Intl.NumberFormat>();

export function num(x: number, digits = 0): string {
  let f = NF.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });
    NF.set(digits, f);
  }
  return f.format(x);
}
