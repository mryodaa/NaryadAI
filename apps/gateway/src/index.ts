// Шлюз двойника: REST и Swagger, MQTT-брокер, WebSocket для интерфейса, SQLite, ядро двойника.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { SEED_PLANT, topics, type ServerMessage } from '@allur/contracts';
import { config } from './config';
import { Db } from './db';
import { DemoClock } from './clock';
import { SourceRegistry } from './sources';
import { Hub } from './hub';
import { FrontHub } from './front';
import { TwinService } from './twin';
import { startMqtt, type MqttBroker } from './mqtt';
import { registerDocs } from './docs';
import { ingestRoutes } from './routes/ingest';
import { twinRoutes } from './routes/twin';
import { demoRoutes } from './routes/demo';
import { viewRoutes } from './routes/views';
import { plantRoutes, withRuntime } from './routes/plant';
import { PlantStore } from './plant';
import { ConnectionMonitor } from './connections';
import type { Ctx } from './context';

const log = (msg: string) => console.log(`[шлюз] ${msg}`);

const db = new Db(config.dbPath);
// Исходный состав цеха поменялся в коде: история и версии конфигурации собраны на старом —
// очищаем, имитатор заново сгенерирует 30 дней истории по новому составу
const seedHash = createHash('sha1').update(JSON.stringify(SEED_PLANT)).digest('hex').slice(0, 12);
if (db.getSetting<string>('seedHash') !== seedHash) {
  db.resetForNewSeed();
  db.setSetting('seedHash', seedHash);
  log('исходный состав цеха изменился — история и версии конфигурации будут собраны заново');
}
const clock = new DemoClock({ speed: config.startSpeed, seed: config.seed, stage: config.startStage });
const sources = new SourceRegistry();
const plant = new PlantStore(db);
const connections = new ConnectionMonitor();
const hub = new Hub(db, clock, sources, () => plant.model, connections);
const front = new FrontHub();
// Старт демо всегда с начала сценария: живые события прошлого запуска не нужны
db.clearLive();
clock.start((process.env.START_SCENARIO as import('@allur/contracts').ScenarioId) ?? 'live_day');
const twin = new TwinService(db, clock, plant.config);
hub.addSink(twin);

let broker: MqttBroker | null = null;

const ctx: Ctx = {
  db,
  clock,
  hub,
  sources,
  twin,
  front,
  plant,
  connections,
  mqtt: () => broker,
  resetRun(scenario) {
    // демо всегда стартует с исходного состава цеха; правки редактора остаются в истории версий
    plant.ensureBase(SEED_PLANT, 'Демо: исходный состав цеха');
    clock.reset({ scenario });
    db.clearLive();
    twin.reset(clock.runStartMs);
    publishClock();
    log(`сброс: прогон ${clock.runId}, сценарий ${clock.scenario}`);
  },
};

// plant_config_changed: ядро перестраивается, интерфейс и имитаторы получают новую версию
plant.onChange((cfg, changes) => {
  twin.setPlant(cfg);
  front.broadcast({ t: 'plant', config: withRuntime(ctx, cfg) });
  publishPlant();
  log(`конфигурация завода: версия ${cfg.version}${changes.length ? ` (${changes.slice(0, 3).join('; ')})` : ''}`);
});

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10 * 1024 * 1024 });

app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string', bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) => done(null, body));

app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status === 400 || status === 415) {
    const message = err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' ? 'Пустое тело запроса' : status === 415 ? 'Неподдерживаемый тип содержимого' : 'Тело запроса — не корректный JSON';
    hub.reject(`${req.method} ${req.url}`, null, [{ path: '(тело)', message }], err.message);
    return reply.code(400).send({ error: 'validation_failed', message, issues: [{ path: '(тело)', message }] });
  }
  if (status === 413) return reply.code(413).send({ error: 'too_large', message: 'Слишком большой запрос (максимум 10 МБ)' });
  req.log.error(err);
  return reply.code(500).send({ error: 'internal', message: 'Внутренняя ошибка шлюза' });
});

await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

app.get('/ws', { websocket: true }, (socket) => {
  const initial: ServerMessage[] = [];
  const snap = twin.snapshot(clock.now());
  initial.push(snap ? { t: 'snapshot', data: snap } : { t: 'booting', message: 'Запускаем двойник…' });
  initial.push({ t: 'feed', items: hub.recentFeed(60) });
  initial.push({ t: 'sources', items: sources.status(clock.stage) });
  initial.push({ t: 'plant', config: withRuntime(ctx, plant.config) });
  initial.push({ t: 'connections', items: connections.status(plant.model, clock.stage, clock.simulateAll) });
  initial.push({ t: 'bodies', at: new Date(clock.now()).toISOString(), items: twin.bodies(clock.now()) });
  front.add(socket, initial);
});

app.get('/mqtt', { websocket: true }, (socket, req) => {
  if (!broker) return socket.close(1013, 'MQTT ещё не запущен');
  broker.handleWebSocket(socket, req.raw);
});

app.get('/api/v1/health', async () => ({ ok: true, runId: clock.runId, events: db.countEvents() }));

await registerDocs(app);
ingestRoutes(app, ctx);
twinRoutes(app, ctx);
demoRoutes(app, ctx);
viewRoutes(app, ctx);
plantRoutes(app, ctx);

// Видео с постов: настоящий ролик — файл data/media/clips/<имя>.mp4; пока его нет — честная заглушка
app.get<{ Params: { name: string } }>('/media/clips/:name', async (req, reply) => {
  const name = req.params.name.replace(/[^a-z0-9._-]/gi, '');
  const file = join(config.mediaDir, 'clips', name);
  if (name.endsWith('.mp4') && existsSync(file)) return reply.type('video/mp4').send(createReadStream(file));
  return reply
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Видео с поста</title></head><body style="margin:0;background:#14181d;color:#e7ebf0;font:18px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center"><div style="max-width:560px;padding:24px"><div style="font-size:48px">▶</div><h1 style="font-size:24px;margin:12px 0">Здесь будет фрагмент записи с камеры поста</h1><p style="color:#9aa5b1">Видеоаналитика (ступень 1) отметила событие и прислала ссылку на 30-секундный фрагмент. В прототипе ролика нет — положите файл <code>data/media/clips/${name}</code>, и он откроется здесь.</p></div></body></html>`,
    );
});

// Собранный интерфейс; маршруты SPA (/plan, /master…) отдают index.html
const hasWeb = existsSync(join(config.webDist, 'index.html'));
if (hasWeb) {
  await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && (req.headers.accept ?? '').includes('text/html')) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Адрес не найден' });
  });
} else {
  app.get('/', async (_req, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(
        '<meta charset="utf-8"><body style="font:18px system-ui;padding:32px">Шлюз двойника работает. Интерфейс не собран: в разработке он открывается на <a href="http://localhost:5173">localhost:5173</a> (<code>pnpm dev</code>), для показа соберите <code>pnpm build</code>. Документация API — <a href="/docs">/docs</a>.</body>',
      ),
  );
}

await app.listen({ port: config.port, host: config.host });
broker = await startMqtt({ port: config.mqttPort, hub, clock, sources, connections, log });
publishPlant();
log(`HTTP :${config.port} (REST /api/v1, Swagger /docs, WebSocket /ws, MQTT поверх WS /mqtt)`);
log(`MQTT TCP: ${broker.tcpListening ? `:${config.mqttPort}` : 'нет'}; база: ${config.dbPath}`);
log(`часы: старт ${new Date(clock.now()).toISOString()}, ×${clock.speed}, ступень ${clock.stage}`);

if (config.simulators) {
  const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
  const cli = new URL('../../../packages/simulators/src/cli.ts', import.meta.url);
  const child = spawn(process.execPath, [tsxCli, fileURLToPath(cli)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      GATEWAY_URL: `http://127.0.0.1:${config.port}`,
      MQTT_URL: broker.tcpListening ? `mqtt://127.0.0.1:${config.mqttPort}` : `ws://127.0.0.1:${config.port}/mqtt`,
    },
  });
  child.on('exit', (code) => log(`имитаторы завершились (код ${code})`));
  process.on('exit', () => child.kill());
  log('имитаторы запущены отдельным процессом (SIMULATORS=on), подключаются к шлюзу по сети');
}

function publishClock() {
  broker?.publish(topics.demoClock, clock.message(), { retain: true });
}

/** Имитаторам и интеграторам: применена версия конфигурации завода (за подробностями — GET /api/v1/plant/config) */
function publishPlant() {
  broker?.publish(topics.plantConfig, { version: plant.config.version, updatedAt: plant.config.updatedAt }, { retain: true, qos: 1 });
}

// Основной цикл: часы → ядро → рассылка интерфейсу и имитаторам
let lastSources = 0;
const loop = setInterval(() => {
  clock.tick();
  const now = clock.now();
  twin.tick(now);
  publishClock();
  if (front.size > 0) {
    const snap = twin.snapshot(now);
    front.broadcast(snap ? { t: 'snapshot', data: snap } : { t: 'booting', message: 'Запускаем двойник…' });
    const items = hub.drainFeed();
    if (items.length) front.broadcast({ t: 'feed', items });
    if (Date.now() - lastSources > 1000) {
      lastSources = Date.now();
      front.broadcast({ t: 'sources', items: sources.status(clock.stage) });
      front.broadcast({ t: 'connections', items: connections.status(plant.model, clock.stage, clock.simulateAll) });
      front.broadcast({ t: 'bodies', at: new Date(now).toISOString(), items: twin.bodies(now) });
    }
  } else {
    hub.drainFeed();
  }
}, 250);

clock.onChange((_c, reason) => {
  if (reason !== 'skip') publishClock();
});

async function shutdown() {
  clearInterval(loop);
  await broker?.close();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
