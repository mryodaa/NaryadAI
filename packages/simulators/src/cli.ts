// Запуск имитаторов: pnpm sim. Ходят в шлюз теми же путями, что пойдут настоящие системы:
// 1С — HTTP POST /api/v1/events, контроллеры и камеры — MQTT. twin-core не импортируют.
import mqtt from 'mqtt';
import { DemoClock, WorkOrder, shiftsBetweenDates, topics, type Stage } from '@allur/contracts';
import { Adapters, type Outbox } from './adapters';
import { HISTORY_FROM, HISTORY_TO, generateHistory } from './history';
import { HttpSender, MqttSource } from './transport';
import { RUN_START_MS, setupScenario } from './scenarios';
import { World } from './world';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const STEP_MS = 10_000;

const log = (msg: string) => console.log(`[имитаторы] ${msg}`);

const http = new HttpSender(GATEWAY);
const plc = new MqttSource(MQTT_URL, 'plc-opcua-bridge');
const camera = new MqttSource(MQTT_URL, 'camera-analytics');
const outbox: Outbox = {
  http: (e) => http.push(e),
  mqtt: (source, topic, payload, qos) => (source === 'plc' ? plc : camera).publish(topic, payload, qos),
};

let clock: { msg: DemoClock; receivedAt: number } | null = null;
let run: { runId: number; world: World; adapters: Adapters } | null = null;
let stage: Stage | null = null;
let historyState: 'unknown' | 'loading' | 'ready' = 'unknown';

const control = mqtt.connect(MQTT_URL, { clientId: `sim-control-${process.pid}`, reconnectPeriod: 2000 });
control.on('connect', () => {
  log(`подключился к брокеру ${MQTT_URL}, жду часы шлюза`);
  control.subscribe([topics.demoClock, topics.workOrders], { qos: 1 });
});
control.on('error', (e) => log(`MQTT: ${e.message}`));
control.on('message', (topic, payload) => {
  let json: unknown;
  try {
    json = JSON.parse(payload.toString('utf8'));
  } catch {
    return;
  }
  if (topic === topics.demoClock) {
    const r = DemoClock.safeParse(json);
    if (r.success) onClock(r.data);
  } else if (topic === topics.workOrders) {
    const r = WorkOrder.safeParse(json);
    if (r.success && run) {
      log(`наряд: ${r.data.title} (${r.data.scheduledAt.slice(11, 16)})`);
      run.world.applyWorkOrder(r.data);
    }
  }
});

function onClock(msg: DemoClock) {
  clock = { msg, receivedAt: Date.now() };
  if (historyState === 'unknown') {
    historyState = 'loading';
    void ensureHistory(msg.seed).then(() => {
      historyState = 'ready';
      if (clock) onClock(clock.msg);
    });
    return;
  }
  if (historyState !== 'ready') return;
  setStage(msg.stage);
  if (!run || run.runId !== msg.runId) startRun(msg);
}

function simNow(): number {
  if (!clock) return 0;
  const { msg, receivedAt } = clock;
  return msg.paused ? msg.simTime : msg.simTime + (Date.now() - receivedAt) * msg.speed;
}

async function ensureHistory(seed: number) {
  const expected = shiftsBetweenDates(HISTORY_FROM, HISTORY_TO).length * 3;
  for (;;) {
    try {
      const r = (await fetch(`${GATEWAY}/api/v1/demo/history`).then((x) => x.json())) as { shiftReports: number };
      if (r.shiftReports >= expected) {
        log(`история уже в двойнике (${r.shiftReports} сменных отчётов)`);
        return;
      }
      break;
    } catch {
      log('шлюз ещё не отвечает, жду…');
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  const t0 = Date.now();
  const preset = setupScenario('live_day', seed).preset;
  const events = generateHistory(seed, preset.robotCycles);
  log(`сгенерировал историю ${HISTORY_FROM} — ${HISTORY_TO}: ${events.length} записей за ${Date.now() - t0} мс, отправляю в 1С-вход шлюза`);
  for (const e of events) http.push(e);
  await http.drain(60_000);
}

function setStage(s: Stage) {
  if (s === stage) return;
  const prev = stage;
  stage = s;
  plc.enable(s >= 1);
  camera.enable(s >= 1);
  log(`ступень внедрения ${s}`);
  if (run && s >= 1 && (prev === null || prev < 1)) run.adapters.plcSnapshot(run.world, run.world.t);
}

function startRun(msg: DemoClock) {
  const setup = setupScenario(msg.scenario, msg.seed);
  const world = new World(setup.preset);
  const adapters = new Adapters(msg.runId, msg.seed, outbox, () => stage ?? 0);
  run = { runId: msg.runId, world, adapters };
  log(`прогон ${msg.runId}: сценарий «${msg.scenario}», прокручиваю утро до ${new Date(msg.simTime).toISOString().slice(11, 16)} UTC`);
  adapters.wip(world, RUN_START_MS);
  adapters.stockSnapshot(world, RUN_START_MS);
  for (const p of setup.preStart) adapters.serviceRecord(p.equipmentId, 'weld', p.from, p.to);
  if ((stage ?? 0) >= 1) adapters.plcSnapshot(world, RUN_START_MS);
}

setInterval(() => {
  if (!run || !clock || historyState !== 'ready') return;
  const target = simNow();
  let steps = 0;
  while (run.world.t + STEP_MS <= target && steps < 6000) {
    run.world.step(STEP_MS);
    for (const e of run.world.drain()) run.adapters.handle(e);
    run.adapters.flushDue(run.world.t);
    steps++;
  }
}, 100);

async function shutdown() {
  log('останавливаюсь');
  await http.drain(2000);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
