// Часы двойника. В демо время симуляции идёт с ускорением и пропускает нерабочую ночь;
// в реальном внедрении часы двойника — обычное время.
import {
  DEMO_START_MS,
  currentOrNextShift,
  scenarioStartMs,
  shiftAt,
  type DemoClock as DemoClockMsg,
  type ScenarioId,
  type Stage,
} from '@allur/contracts';

export class DemoClock {
  /** Номер прогона уникален для каждого запуска шлюза — имитаторы сразу видят новый прогон */
  runId = Math.floor(Date.now() / 1000) % 1_000_000;
  seed: number;
  scenario: ScenarioId = 'live_day';
  stage: Stage;
  speed: number;
  paused = false;
  /** Имитировать всё оборудование с выбранным способом подключения, как будто шлюз завода работает */
  simulateAll = false;
  /** Начало текущего прогона (всё, что раньше, — история) */
  runStartMs = DEMO_START_MS;

  private anchorSim = DEMO_START_MS;
  private anchorReal = Date.now();
  private listeners = new Set<(c: DemoClock, reason: string) => void>();

  constructor(opts: { speed: number; seed: number; stage: Stage }) {
    this.speed = opts.speed;
    this.seed = opts.seed;
    this.stage = opts.stage;
  }

  now(): number {
    if (this.paused) return this.anchorSim;
    return this.anchorSim + (Date.now() - this.anchorReal) * this.speed;
  }

  private reanchor(simMs = this.now()) {
    this.anchorSim = simMs;
    this.anchorReal = Date.now();
  }

  setSpeed(speed: number) {
    this.reanchor();
    this.speed = Math.max(0.1, Math.min(600, speed));
    this.emit('speed');
  }

  setPaused(paused: boolean) {
    this.reanchor();
    this.paused = paused;
    this.emit('pause');
  }

  setStage(stage: Stage) {
    this.stage = stage;
    this.emit('stage');
  }

  setSimulateAll(on: boolean) {
    this.simulateAll = on;
    this.emit('simulate-all');
  }

  /**
   * Новый прогон: другой runId, то же зерно — сценарий повторяется одинаково.
   * Смена всегда начинается в 08:00; часы ставятся на момент сценария, а имитаторы
   * быстро прокручивают утро до него.
   */
  reset(opts: { scenario?: ScenarioId } = {}) {
    if (opts.scenario) this.scenario = opts.scenario;
    this.runId += 1;
    this.runStartMs = DEMO_START_MS;
    this.reanchor(scenarioStartMs(this.scenario));
    this.emit('reset');
  }

  /** Первый запуск шлюза: как сброс, но без смены runId */
  start(scenario: ScenarioId) {
    this.scenario = scenario;
    this.reanchor(scenarioStartMs(scenario));
  }

  /** Вызывается по таймеру: перескакиваем ночь и выходные, чтобы не ждать их в демо */
  tick() {
    const now = this.now();
    if (!this.paused && !shiftAt(now)) {
      const next = currentOrNextShift(now);
      this.reanchor(next.startMs);
      this.emit('skip');
    }
  }

  message(): DemoClockMsg {
    return {
      runId: this.runId,
      seed: this.seed,
      simTime: this.now(),
      speed: this.speed,
      paused: this.paused,
      stage: this.stage,
      scenario: this.scenario,
      simulateAll: this.simulateAll,
    };
  }

  onChange(fn: (c: DemoClock, reason: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: string) {
    for (const fn of this.listeners) fn(this, reason);
  }
}
