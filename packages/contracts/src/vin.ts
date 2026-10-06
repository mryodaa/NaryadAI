// VIN по ISO 3779: 17 символов, без I, O, Q, девятая позиция — контрольная цифра.
// Структура в прототипе: KZA (условный код изготовителя) + код модели + кузов +
// двигатель + контрольная + год (T = 2026) + завод (K) + сквозной номер.
import { MODEL_BY_ID, type ModelId } from './plant';

export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function charValue(c: string): number {
  if (c >= '0' && c <= '9') return Number(c);
  return TRANSLIT[c] ?? 0;
}

export function vinCheckDigit(vin17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += charValue(vin17[i]!) * WEIGHTS[i]!;
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

const BODY: Record<ModelId, string> = { onix: 'S', cobalt: 'S', j7: 'L' };
const ENGINE: Record<ModelId, string> = { onix: '1', cobalt: '5', j7: '5' };

export function makeVin(model: ModelId, serial: number): string {
  const draft = `KZA${MODEL_BY_ID[model].vinCode}${BODY[model]}${ENGINE[model]}0TK${String(serial).padStart(6, '0')}`;
  return draft.slice(0, 8) + vinCheckDigit(draft) + draft.slice(9);
}

export function isValidVin(vin: string): boolean {
  return VIN_RE.test(vin) && vinCheckDigit(vin) === vin[8];
}

export function modelFromVin(vin: string): ModelId | undefined {
  const code = vin.slice(3, 6);
  return (Object.keys(MODEL_BY_ID) as ModelId[]).find((m) => MODEL_BY_ID[m].vinCode === code);
}
