// Связь с оборудованием: статус считается по реальному потоку данных (реальное время, не время демо).
// online — данные приходили за последние 60 секунд; stale — приходили, но давно; на ступени внедрения,
// где такие подключения ещё не активны, — «не подключено». Плюс проверка подключения (мастер, шаг 3).
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  CANONICAL_FIELD_DEF,
  CONNECTION_METHOD_DEF,
  EQUIPMENT_STATUSES,
  topics,
  type CanonicalField,
  type ConnectionInput,
  type ConnectionRuntime,
  type ConnectionTestResult,
  type PlantModel,
  type SimProbeReply,
  type Stage,
} from '@allur/contracts';
import type { MqttBroker } from './mqtt';

const STALE_MS = 60_000;
const CONNECTING_MS = 30_000;
const PROBE_TIMEOUT_MS = 3000;
const TCP_TIMEOUT_MS = 3000;

const STATUS_RU: Record<(typeof EQUIPMENT_STATUSES)[number], string> = { run: 'работает', idle: 'ожидает', fault: 'авария', maintenance: 'обслуживание' };

export class ConnectionMonitor {
  private lastSeen = new Map<string, number>();
  /** Когда подключение сохранили или когда стартовал шлюз — первые 30 с «подключается» */
  private since = new Map<string, number>();
  private errors = new Map<string, string>();
  private pending = new Map<string, (r: SimProbeReply) => void>();
  private startedAt = Date.now();

  /** По оборудованию пришли данные (состояние, счётчик, датчик или пульс связи) */
  seen(equipmentId: string, at = Date.now()) {
    this.lastSeen.set(equipmentId, at);
    this.errors.delete(equipmentId);
  }

  saved(equipmentId: string) {
    this.since.set(equipmentId, Date.now());
    this.errors.delete(equipmentId);
  }

  status(plant: PlantModel, stage: Stage, simulateAll: boolean, now = Date.now()): ConnectionRuntime[] {
    const out: ConnectionRuntime[] = [];
    for (const e of plant.equipment) {
      if (e.passive) continue;
      const m = e.connection.method;
      const def = CONNECTION_METHOD_DEF[m];
      const seen = this.lastSeen.get(e.id) ?? null;
      const base = { equipmentId: e.id, lastSeenAt: seen ? new Date(seen).toISOString() : null, error: null as string | null, note: null as string | null };
      if (m === 'none') {
        out.push({ ...base, status: 'not_connected', note: 'Двойник знает, что оборудование есть, но не видит его состояние' });
        continue;
      }
      if (m === 'manual') {
        out.push({ ...base, status: 'not_connected', note: 'Ручной ввод: состояние — по записям мастера' });
        continue;
      }
      // в демо данные таких подключений даёт имитатор — по ступени внедрения
      const simulated = m === 'simulator' || simulateAll;
      if (simulated && def.stage !== null && stage < def.stage) {
        out.push({ ...base, status: 'not_connected', note: stage === 0 ? 'Ступень 0: работаем только с 1С, контроллеры не подключены' : 'Внешние датчики подключаются на ступени 2' });
        continue;
      }
      if (seen !== null && now - seen <= STALE_MS) {
        out.push({ ...base, status: 'online' });
        continue;
      }
      const err = this.errors.get(e.id);
      if (err) {
        out.push({ ...base, status: 'error', error: err });
        continue;
      }
      const since = Math.max(this.since.get(e.id) ?? 0, this.startedAt);
      if (now - since <= CONNECTING_MS && seen === null) {
        out.push({ ...base, status: 'connecting' });
        continue;
      }
      if (seen !== null) out.push({ ...base, status: 'stale', note: 'Данные не приходят больше минуты' });
      else out.push({ ...base, status: simulated ? 'stale' : 'error', error: simulated ? null : 'Данные не приходят: проверьте адрес и шлюз OPC UA → MQTT', note: simulated ? 'Имитатор не прислал данных' : null });
    }
    return out;
  }

  onProbeReply(reply: SimProbeReply) {
    this.pending.get(reply.requestId)?.(reply);
  }

  private probe(broker: MqttBroker | null, equipmentId: string): Promise<SimProbeReply | null> {
    if (!broker) return Promise.resolve(null);
    const requestId = randomUUID().slice(0, 12);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, PROBE_TIMEOUT_MS);
      this.pending.set(requestId, (r) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(r);
      });
      broker.publish(topics.simProbe, { requestId, equipmentId }, { qos: 1 });
    });
  }

  /** Проверка подключения: имитатор опрашиваем по-настоящему, к адресам завода пробуем подключиться честно */
  async test(plant: PlantModel, equipmentId: string, conn: ConnectionInput, broker: MqttBroker | null, stage: Stage): Promise<ConnectionTestResult> {
    const e = plant.equipmentById.get(equipmentId)!;
    const tag = (f: CanonicalField) => conn.tagMap?.[f] ?? e.type.tags[f]?.replace('{id}', e.id) ?? null;
    switch (conn.method) {
      case 'simulator': {
        const r = await this.probe(broker, equipmentId);
        if (!r) return { ok: false, message: 'Имитатор не ответил за 3 секунды', hint: 'Имитатор запускается вместе со шлюзом (pnpm dev или SIMULATORS=on). Проверьте, что он работает.' };
        if (!r.ok) return { ok: false, message: r.message ?? 'Имитатор не знает это оборудование' };
        const values = e.type.fields
          .filter((f) => r.values?.[f] !== undefined)
          .slice(0, 5)
          .map((f) => ({ field: f, label: CANONICAL_FIELD_DEF[f].label, tag: tag(f), value: formatValue(f, r.values![f]!) }));
        return {
          ok: true,
          message: 'Подключено: имитатор отдаёт данные оборудования',
          values,
          hint: stage === 0 ? 'Сейчас ступень 0 — данные контроллеров в двойник не идут. На ступени 1 оборудование оживёт.' : undefined,
        };
      }
      case 'opcua':
      case 'scada': {
        const addr = parseEndpoint(conn.endpoint, conn.method === 'opcua' ? 4840 : 4840, conn.method === 'opcua' ? /^opc\.tcp:\/\//i : /^(opc\.tcp|https?):\/\//i);
        if (!addr) {
          return {
            ok: false,
            message: conn.method === 'opcua' ? 'Адрес OPC UA — вида opc.tcp://10.20.1.15:4840' : 'Адрес SCADA — вида opc.tcp://10.20.3.5:4840 или https://scada.local',
            hint: 'Эти данные даёт служба КИПиА завода',
          };
        }
        return tcpResult(addr.host, addr.port, CONNECTION_METHOD_DEF[conn.method].label);
      }
      case 'modbus_tcp':
      case 's7': {
        const host = (conn.endpoint ?? '').trim();
        if (!/^[a-z0-9.-]{3,253}$/i.test(host)) return { ok: false, message: 'Укажите IP-адрес контроллера, например 10.20.1.30', hint: 'Эти данные даёт служба КИПиА завода' };
        const port = conn.method === 's7' ? 102 : Number(conn.params?.port ?? 502);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: 'Порт — число от 1 до 65535 (Modbus обычно 502)' };
        if (conn.method === 'modbus_tcp') {
          const unit = Number(conn.params?.unitId ?? 1);
          if (!Number.isInteger(unit) || unit < 0 || unit > 255) return { ok: false, message: 'Unit ID — число от 0 до 255' };
        }
        return tcpResult(host, port, CONNECTION_METHOD_DEF[conn.method].label);
      }
      case 'retrofit_sensor': {
        const id = (conn.endpoint ?? '').trim();
        if (!id) return { ok: false, message: 'Укажите идентификатор датчика, например IOT-CONV03-01' };
        const seen = this.lastSeen.get(equipmentId);
        if (seen && Date.now() - seen <= STALE_MS) return { ok: true, message: `Датчик ${id} на связи: данные приходят` };
        return {
          ok: false,
          message: `Датчик ${id} не прислал данных в демо-среде`,
          hint: `Датчик публикует показания через IoT-шлюз в MQTT двойника: allur/kst/${e.stageId}/${e.id}/telemetry`,
        };
      }
      case 'manual':
        return { ok: true, message: 'Ручной ввод: мастер отмечает состояние и простои с телефона (экран /master). Проверять связь не нужно.' };
      case 'none':
        return { ok: true, message: 'Оборудование будет показано как неподключённое' };
    }
  }
}

function formatValue(f: CanonicalField, v: string | number): string {
  if (f === 'state') return STATUS_RU[v as keyof typeof STATUS_RU] ?? String(v);
  const unit = CANONICAL_FIELD_DEF[f].unit;
  if (typeof v === 'number') return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v)}${unit ? ` ${unit}` : ''}`;
  return v;
}

function parseEndpoint(endpoint: string | undefined, defPort: number, scheme: RegExp): { host: string; port: number } | null {
  const e = (endpoint ?? '').trim();
  if (!scheme.test(e)) return null;
  try {
    const u = new URL(e.replace(/^opc\.tcp:/i, 'http:'));
    const port = u.port ? Number(u.port) : /^https:/i.test(e) ? 443 : /^http:/i.test(e) ? 80 : defPort;
    if (!u.hostname) return null;
    return { host: u.hostname, port };
  } catch {
    return null;
  }
}

/** Честная попытка: TCP-подключение с таймаутом. Протоколы завода двойник напрямую не читает */
async function tcpResult(host: string, port: number, label: string): Promise<ConnectionTestResult> {
  const open = await new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(TCP_TIMEOUT_MS, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
  if (!open) {
    return {
      ok: false,
      message: `Не удалось подключиться: адрес ${host}:${port} недоступен из демо-среды`,
      hint: 'Проверьте адрес и порт со службой КИПиА. В прототипе оборудования завода нет — для показа выберите «Имитатор (демо)».',
    };
  }
  return {
    ok: false,
    message: `Порт ${host}:${port} открыт, но двойник в прототипе не читает ${label} напрямую`,
    hint: 'Подключите оборудование через шлюз в MQTT двойника (Kepware, Node-RED): он будет публиковать состояние в allur/kst/…',
  };
}
