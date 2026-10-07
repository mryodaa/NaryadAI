// Запуск имитаторов: pnpm sim. Ходят в шлюз теми же путями, что пойдут настоящие системы:
// 1С — HTTP POST /api/v1/events, контроллеры и камеры — MQTT. twin-core не импортируют.
// Состав цеха берут из конфигурации завода (GET /api/v1/plant/config) и перестраивают цех
// на лету, когда двойник применяет новую версию (MQTT allur/kst/twin/plant-config).
import mqtt from 'mqtt';
import {
  DemoClock,
  PlantConfigSchema,
  SEED_MODEL,
  SimProbeRequest,
  WorkOrder,
  derivePlant,
  shiftsBetweenDates,
  topics,
  type PlantModel,
  type SimProbeReply,
  type Stage,
} from '@allur/contracts';
import { Adapters, type Outbox } from './adapters';
import { HISTORY_FROM, HISTORY_TO, generateHistory } from './history';
import { HttpSender, MqttSource } from './transport';
import { RUN_START_MS, setupScenario } from './scenarios';
import { World } from './world';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const STEP_MS = 10_000;
/** Пульс связи подключённого оборудования, реальное время */
const HEARTBEAT_MS = 10_000;

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
let plant: PlantModel = SEED_MODEL;
let plantVersion = 0;
let plantLoading: Promise<void> | null = null;

const control = mqtt.connect(MQTT_URL, { clientId: `sim-control-${process.pid}`, reconnectPeriod: 2000 });
control.on('connect', () => {
  log(`подключился к брокеру ${MQTT_URL}, жду часы шлюза`);
  control.subscribe([topics.demoClock, topics.workOrders, topics.plantConfig, topics.simProbe], { qos: 1 });
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
  } else if (topic === topics.plantConfig) {
    const v = (json as { version?: unknown })?.version;
    if (typeof v === 'number' && v !== plantVersion) void loadPlant();
  } else if (topic === topics.simProbe) {
    const r = SimProbeRequest.safeParse(json);
    if (r.success) answerProbe(r.data.requestId, r.data.equipmentId);
  }
});

/** Конфигурация завода из шлюза; новый состав — перестраиваем цех без остановки смены */
function loadPlant(): Promise<void> {
  plantLoading ??= (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(`${GATEWAY}/api/v1/plant/config`);
        if (r.ok) {
          const cfg = PlantConfigSchema.parse(await r.json());
          if (cfg.version !== plantVersion) {
            const first = plantVersion === 0;
            plant = derivePlant(cfg);
            plantVersion = cfg.version;
            if (run && !first) {
              run.world.reconfigure(cfg);
              // новое и заново подключённое оборудование сразу присылает состояние
              if ((stage ?? 0) >= 1) run.adapters.plcSnapshot(run.world, run.world.t);
            }
            log(`конфигурация завода, версия ${cfg.version}: ${plant.production.map((s) => `${s.short} ×${s.stations.length}`).join(', ')}`);
          }
          return;
        }
      } catch {
        // шлюз ещё не поднялся
      }
      if (attempt === 0) log('жду конфигурацию завода от шлюза…');
      await new Promise((res) => setTimeout(res, 1500));
    }
  })().finally(() => {
    plantLoading = null;
  });
  return plantLoading;
}

function onClock(msg: DemoClock) {
  clock = { msg, receivedAt: Date.now() };
  if (historyState === 'unknown') {
    historyState = 'loading';
    void Promise.all([ensureHistory(msg.seed), loadPlant()]).then(() => {
      historyState = 'ready';
      if (clock) onClock(clock.msg);
    });
    return;
  }
  if (historyState !== 'ready') return;
  setStage(msg.stage);
  if (!run || run.runId !== msg.runId) {
    // новый прогон начинается с той конфигурации, которую шлюз только что применил
    if (plantLoading) {
      void plantLoading.then(() => clock && onClock(clock.msg));
      return;
    }
    startRun(msg);
  }
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
  const world = new World(setup.preset, plant.config);
  const adapters = new Adapters(
    msg.runId,
    msg.seed,
    outbox,
    () => stage ?? 0,
    () => plant,
    () => clock?.msg.simulateAll ?? false,
  );
  run = { runId: msg.runId, world, adapters };
  log(`прогон ${msg.runId}: сценарий «${msg.scenario}», прокручиваю утро до ${new Date(msg.simTime).toISOString().slice(11, 16)} UTC`);
  adapters.wip(world, RUN_START_MS);
  adapters.stockSnapshot(world, RUN_START_MS);
  for (const p of setup.preStart) adapters.serviceRecord(p.equipmentId, plant.equipmentById.get(p.equipmentId)?.stageId ?? 'weld', p.from, p.to);
  if ((stage ?? 0) >= 1) adapters.plcSnapshot(world, RUN_START_MS);
}

/** Проверка подключения: шлюз спрашивает, что сейчас показывает оборудование */
function answerProbe(requestId: string, equipmentId: string) {
  const reply = (r: Omit<SimProbeReply, 'requestId'>) => control.publish(topics.simProbeReply(requestId), JSON.stringify({ requestId, ...r }), { qos: 1 });
  const e = plant.equipmentById.get(equipmentId);
  const st = run?.world.equipmentState(equipmentId);
  if (!e || !st) {
    reply({ ok: false, message: e ? 'Оборудования ещё нет в модели цеха имитатора — примените состав цеха' : 'Такого оборудования нет в конфигурации завода' });
    return;
  }
  const t = run!.world.t;
  const values: Record<string, string | number> = {};
  for (const f of e.type.fields) {
    if (f === 'state') values[f] = st.status;
    else if (f === 'errorCode') values[f] = st.code ?? '—';
    else if (f === 'cycleCounter') values[f] = st.cycles;
    else if (f === 'filterDpPa' && st.dp !== null) values[f] = Math.round(st.dp);
    else if (f === 'motorCurrentA' && st.current !== null) values[f] = Math.round(st.current * 10) / 10;
    else if (f === 'vibrationMmS' && st.vibration !== null) values[f] = Math.round(st.vibration * 10) / 10;
    else if (f === 'temperatureC') values[f] = Math.round(e.type.id === 'oven' ? 180 + 3 * Math.sin(t / 600_000) : 52 + 2 * Math.sin(t / 900_000));
    else if (f === 'pressureBar') values[f] = Math.round((3.2 + 0.1 * Math.sin(t / 300_000)) * 10) / 10;
    else if (f === 'torqueNm') values[f] = Math.round(45 + 2 * Math.sin(t / 120_000));
  }
  reply({ ok: true, values });
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

// Пульс связи: шлюз видит, что по подключённому оборудованию данные идут, даже если состояние не меняется
setInterval(() => {
  if (run && (stage ?? 0) >= 1) run.adapters.heartbeat(run.world, run.world.t);
}, HEARTBEAT_MS);

async function shutdown() {
  log('останавливаюсь');
  await http.drain(2000);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
