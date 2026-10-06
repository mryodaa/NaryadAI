// Сеть имитаторов: HTTP-пакеты в REST шлюза (как 1С) и MQTT (как шлюз контроллеров и видеоаналитика).
import mqtt, { type MqttClient } from 'mqtt';
import type { CanonicalEvent } from '@allur/contracts';

const log = (msg: string) => console.log(`[имитаторы] ${msg}`);

/** Пакетная отправка событий 1С: не чаще раза в 250 мс, до 500 событий в пакете, с повтором при сбое */
export class HttpSender {
  private queue: CanonicalEvent[] = [];
  private sending = false;
  private failures = 0;
  private timer: NodeJS.Timeout;

  constructor(private baseUrl: string) {
    this.timer = setInterval(() => void this.flush(), 250);
  }

  push(e: CanonicalEvent) {
    this.queue.push(e);
    if (this.queue.length > 50_000) this.queue.splice(0, this.queue.length - 50_000);
  }

  get pending() {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.slice(0, 500);
        const r = await fetch(`${this.baseUrl}/api/v1/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-source-system': 'simulators' },
          body: JSON.stringify(batch),
        });
        if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
        if (!r.ok) {
          const body = await r.text();
          log(`шлюз отклонил пакет (${r.status}): ${body.slice(0, 300)}`);
        } else {
          const res = (await r.json()) as { rejected: { index: number; issues: { path: string; message: string }[] }[] };
          if (res.rejected.length) log(`отклонено ${res.rejected.length}: ${JSON.stringify(res.rejected[0])}`);
        }
        this.queue.splice(0, batch.length);
        this.failures = 0;
      }
    } catch (err) {
      this.failures++;
      if (this.failures === 1 || this.failures % 20 === 0) log(`шлюз недоступен (${(err as Error).message}), повторю`);
    } finally {
      this.sending = false;
    }
  }

  /** Дождаться отправки всего, что накоплено */
  async drain(timeoutMs = 30_000) {
    const until = Date.now() + timeoutMs;
    while ((this.queue.length || this.sending) && Date.now() < until) {
      await this.flush();
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}

/** MQTT-клиент источника, который можно включать и выключать (ступень внедрения) */
export class MqttSource {
  private client: MqttClient | null = null;

  constructor(
    private url: string,
    private clientId: string,
  ) {}

  get connected() {
    return !!this.client?.connected;
  }

  enable(on: boolean) {
    if (on && !this.client) {
      this.client = mqtt.connect(this.url, { clientId: this.clientId, reconnectPeriod: 2000, connectTimeout: 5000 });
      this.client.on('connect', () => log(`${this.clientId}: подключён к MQTT`));
      this.client.on('error', (e) => log(`${this.clientId}: ${e.message}`));
    } else if (!on && this.client) {
      this.client.end(true);
      this.client = null;
      log(`${this.clientId}: отключён (ступень внедрения)`);
    }
  }

  publish(topic: string, payload: object, qos: 0 | 1 = 0) {
    if (!this.client) return;
    this.client.publish(topic, JSON.stringify(payload), { qos });
  }
}
