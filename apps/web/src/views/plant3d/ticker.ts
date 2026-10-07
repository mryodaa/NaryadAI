// Кадры по требованию: сцена рисуется, только когда что-то меняется.
// Плавные переезды просят следующий кадр сразу, «фоновые» движения (роботы, пульсация) — не чаще ~30 раз в секунду.
let pending = 0;

export function requestAmbient(invalidate: () => void) {
  if (pending) return;
  pending = window.setTimeout(() => {
    pending = 0;
    invalidate();
  }, 33);
}

/** Плавное приближение к цели: одинаково выглядит и при 30, и при 60 кадрах */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.min(dt, 0.1)));
}
