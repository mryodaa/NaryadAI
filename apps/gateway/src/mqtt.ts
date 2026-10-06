// Встроенный MQTT-брокер (Aedes): TCP для контроллеров и MQTT поверх WebSocket (/mqtt) для облака.
// Сообщения в allur/kst/… приводятся к каноническим событиям и идут в общий приём.
import { createServer, type Server } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { Aedes } from 'aedes';
import { createWebSocketStream, type WebSocket } from 'ws';
import { mqttToEvent, parseTopic, TOPIC_ROOT, type SourceId } from '@allur/contracts';
import type { Hub } from './hub';
import type { DemoClock } from './clock';
import { sourceFromClientId, type SourceRegistry } from './sources';

/** Эти топики публикует только сам шлюз */
const GATEWAY_ONLY = [`${TOPIC_ROOT}/demo/`, `${TOPIC_ROOT}/twin/`];

export interface MqttBroker {
  publish(topic: string, payload: unknown, opts?: { retain?: boolean; qos?: 0 | 1 }): void;
  handleWebSocket(socket: WebSocket, req: IncomingMessage): void;
  tcpListening: boolean;
  close(): Promise<void>;
}

export async function startMqtt(opts: {
  port: number;
  hub: Hub;
  clock: DemoClock;
  sources: SourceRegistry;
  log: (msg: string) => void;
}): Promise<MqttBroker> {
  const { hub, clock, sources, log } = opts;
  const aedes = await Aedes.createBroker({ drainTimeout: 30_000 });

  aedes.authorizePublish = (client, packet, cb) => {
    if (client && GATEWAY_ONLY.some((p) => packet.topic.startsWith(p))) {
      cb(new Error('Этот топик публикует только шлюз двойника'));
      return;
    }
    cb(null);
  };

  aedes.on('client', (client) => {
    const src = sourceFromClientId(client.id);
    if (src) sources.clientConnected(src, client.id);
  });
  aedes.on('clientDisconnect', (client) => sources.clientDisconnected(client.id));

  aedes.on('publish', (packet, client) => {
    if (!client) return;
    const topic = packet.topic;
    if (!topic.startsWith(`${TOPIC_ROOT}/`) || GATEWAY_ONLY.some((p) => topic.startsWith(p))) return;
    const raw = typeof packet.payload === 'string' ? packet.payload : packet.payload.toString('utf8');
    const channel = `MQTT ${topic}`;
    const r = mqttToEvent(topic, raw, clock.now());
    if (r.ok) hub.ingest([r.event], channel);
    else hub.reject(channel, sourceFromClientId(client.id) ?? sourceFromTopic(topic), r.issues, raw);
  });

  const tcp: Server = createServer((socket) => aedes.handle(fullRead(socket)));
  let tcpListening = false;
  await new Promise<void>((resolve) => {
    tcp.once('error', (err: NodeJS.ErrnoException) => {
      log(`MQTT TCP :${opts.port} недоступен (${err.code}). Работает только MQTT поверх WebSocket /mqtt`);
      resolve();
    });
    tcp.listen(opts.port, () => {
      tcpListening = true;
      resolve();
    });
  });

  return {
    get tcpListening() {
      return tcpListening;
    },
    publish(topic, payload, o = {}) {
      aedes.publish(
        {
          cmd: 'publish',
          topic,
          payload: Buffer.from(JSON.stringify(payload)),
          qos: o.qos ?? 0,
          retain: o.retain ?? false,
          dup: false,
        },
        () => {},
      );
    },
    handleWebSocket(socket, req) {
      aedes.handle(fullRead(createWebSocketStream(socket)), req);
    },
    close: () =>
      new Promise<void>((resolve) => {
        tcp.close();
        aedes.close(() => resolve());
      }),
  };
}

/**
 * Aedes читает поток через read() без размера и ждёт, что получит весь буфер.
 * В новых версиях Node read() без размера может вернуть только первый кусок —
 * тогда пакет, пришедший несколькими кадрами WebSocket, застревает. Отдаём буфер целиком.
 */
function fullRead<T extends Readable>(stream: T): T {
  const orig = stream.read.bind(stream);
  stream.read = ((n?: number | null) =>
    (n === undefined || n === null) && stream.readableLength > 0 ? orig(stream.readableLength) : orig(n ?? undefined)) as T['read'];
  return stream;
}

function sourceFromTopic(topic: string): SourceId | null {
  const p = parseTopic(topic);
  if (!p) return null;
  return p.kind === 'detection' ? 'camera' : 'plc';
}
