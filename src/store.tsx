import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createState, step } from './sim/engine';
import { frameOf, lineAnalysis, type LineAnalysis } from './sim/analytics';
import { buildForecast, type Forecast } from './sim/forecast';
import type { MapFrame, SimState } from './sim/types';

const PREWARM_MIN = 150;
const HISTORY_MAX = 600;

function boot() {
  const s = createState();
  const frames: MapFrame[] = [frameOf(s)];
  for (let i = 0; i < PREWARM_MIN; i++) {
    step(s);
    frames.push(frameOf(s));
  }
  return { s, frames };
}

interface SimCtx {
  s: SimState;
  la: LineAnalysis;
  frames: MapFrame[];
  forecast: Forecast;
  version: number;
  speed: number;
  setSpeed: (v: number) => void;
  /** Машина времени: 0 — live, <0 — история, >0 — прогноз (минуты) */
  offset: number;
  setOffset: (v: number) => void;
  dispatch: (fn: (s: SimState) => void) => void;
  reset: () => void;
}

const Ctx = createContext<SimCtx | null>(null);

export function SimProvider({ children }: { children: ReactNode }) {
  const ref = useRef<{ s: SimState; frames: MapFrame[] } | null>(null);
  if (!ref.current) ref.current = boot();
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [speed, setSpeed] = useState(5);
  const [offset, setOffset] = useState(0);
  const live = useRef({ speed, offset });
  live.current = { speed, offset };

  useEffect(() => {
    let acc = 0;
    const id = setInterval(() => {
      const { speed: sp, offset: off } = live.current;
      if (sp === 0 || off !== 0) return;
      acc += sp / 10;
      let n = 0;
      const box = ref.current!;
      while (acc >= 1) {
        step(box.s);
        box.frames.push(frameOf(box.s));
        acc -= 1;
        n++;
      }
      if (box.frames.length > HISTORY_MAX) box.frames.splice(0, box.frames.length - HISTORY_MAX);
      if (n) bump();
    }, 100);
    return () => clearInterval(id);
  }, []);

  const dispatch = useCallback((fn: (s: SimState) => void) => {
    fn(ref.current!.s);
    const box = ref.current!;
    box.frames[box.frames.length - 1] = frameOf(box.s);
    bump();
  }, []);

  const reset = useCallback(() => {
    ref.current = boot();
    setOffset(0);
    bump();
  }, []);

  const { s, frames } = ref.current;
  // s мутируется на месте, поэтому пересчёт привязан к version
  const forecast = useMemo(() => buildForecast(s), [version, s]);
  const la = useMemo(() => lineAnalysis(s), [version, s]);

  const value: SimCtx = { s, la, frames, forecast, version, speed, setSpeed, offset, setOffset, dispatch, reset };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSim(): SimCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSim outside SimProvider');
  return c;
}

/** Кадр для схемы с учётом положения «машины времени» */
export function useViewFrame(): { frame: MapFrame; mode: 'live' | 'past' | 'future' } {
  const { frames, forecast, offset } = useSim();
  if (offset < 0) {
    const i = Math.max(0, frames.length - 1 + offset);
    return { frame: frames[i], mode: 'past' };
  }
  if (offset > 0) return { frame: forecast.frames[Math.min(offset, forecast.frames.length) - 1], mode: 'future' };
  return { frame: frames[frames.length - 1], mode: 'live' };
}
