import type { SimState } from './types';

/** mulberry32: состояние хранится в SimState, поэтому копию симуляции можно прогнать детерминированно */
export function rand(s: SimState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
