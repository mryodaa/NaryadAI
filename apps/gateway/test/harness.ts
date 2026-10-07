// Демо без сети: имитатор цеха кормит ядро двойника теми же событиями, что идут через шлюз
// (1С — как REST-события, контроллеры и камеры — через приведение MQTT-сообщений). Для сквозных тестов.
import { CanonicalEvent, SEED_PLANT, mqttToEvent, plantMs, scenarioStartMs, type PlantConfig, type ScenarioId, type Stage } from '@allur/contracts';
import { Twin } from '@allur/twin-core';
import { World } from '../../../packages/simulators/src/world';
import { Adapters, type Outbox } from '../../../packages/simulators/src/adapters';
import { RUN_START_MS, setupScenario } from '../../../packages/simulators/src/scenarios';
import { generateHistory } from '../../../packages/simulators/src/history';

export const SEED = 20261007;
const RUN_ID = 7;

export const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return plantMs('2026-10-07', h! * 60 + m!);
};

let history: CanonicalEvent[] | null = null;

export interface DemoRun {
  twin: Twin;
  world: World;
  now: () => number;
  /** Дойти до момента: имитатор шагает по 10 с, двойник пересчитывается после каждого шага */
  until: (hhmm: string) => void;
  meta: { runId: number; stage: Stage; speed: number; paused: boolean; scenario: ScenarioId };
}

export function startDemo(scenario: ScenarioId, stage: Stage, plant: PlantConfig = SEED_PLANT): DemoRun {
  history ??= generateHistory(SEED, setupScenario('live_day', SEED).preset.robotCycles);
  const twin = new Twin({}, plant);
  twin.reset(RUN_START_MS);
  for (const e of history) twin.ingest(CanonicalEvent.parse(e));
  const setup = setupScenario(scenario, SEED);
  const world = new World(setup.preset, plant);
  let now = RUN_START_MS;
  const accept = (e: unknown) => twin.ingest(CanonicalEvent.parse(e));
  const outbox: Outbox = {
    http: accept,
    mqtt: (_src, topic, payload) => {
      const r = mqttToEvent(topic, JSON.stringify(payload), now);
      if (r.ok) accept(r.event);
    },
  };
  const adapters = new Adapters(RUN_ID, SEED, outbox, () => stage);
  adapters.wip(world, RUN_START_MS);
  adapters.stockSnapshot(world, RUN_START_MS);
  for (const p of setup.preStart) adapters.serviceRecord(p.equipmentId, 'weld', p.from, p.to);
  if (stage >= 1) adapters.plcSnapshot(world, RUN_START_MS);
  const step = () => {
    world.step(10_000);
    for (const e of world.drain()) adapters.handle(e);
    adapters.flushDue(world.t);
    now = world.t;
  };
  const start = scenarioStartMs(scenario);
  while (world.t + 10_000 <= start) step();
  twin.tick(now);
  return {
    twin,
    world,
    now: () => now,
    until(hhmm) {
      while (world.t + 10_000 <= at(hhmm)) {
        step();
        twin.tick(now);
      }
    },
    meta: { runId: RUN_ID, stage, speed: 30, paused: false, scenario },
  };
}
