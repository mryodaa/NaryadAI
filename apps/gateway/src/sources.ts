// Учёт источников: последнее сообщение, поток в минуту, ошибки за час, MQTT-клиенты.
// Считается по реальному времени — это про связь, а не про симуляцию.
import { SOURCES, SOURCE_IDS, type SourceId, type SourceStatus, type Stage } from '@allur/contracts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface Stat {
  last: number | null;
  recent: number[];
  errors: number[];
  clients: Set<string>;
}

export class SourceRegistry {
  private stats = new Map<SourceId, Stat>(
    SOURCE_IDS.map((id) => [id, { last: null, recent: [], errors: [], clients: new Set<string>() }]),
  );

  message(source: SourceId, at = Date.now()) {
    const s = this.stats.get(source)!;
    s.last = at;
    s.recent.push(at);
    if (s.recent.length > 5000) s.recent.splice(0, s.recent.length - 5000);
  }

  error(source: SourceId | null, at = Date.now()) {
    if (!source) return;
    const s = this.stats.get(source);
    if (!s) return;
    s.errors.push(at);
  }

  clientConnected(source: SourceId, clientId: string) {
    this.stats.get(source)?.clients.add(clientId);
  }

  clientDisconnected(clientId: string) {
    for (const s of this.stats.values()) s.clients.delete(clientId);
  }

  status(stage: Stage, at = Date.now()): SourceStatus[] {
    return SOURCES.map((def) => {
      const s = this.stats.get(def.id)!;
      s.recent = s.recent.filter((t) => at - t < MINUTE);
      s.errors = s.errors.filter((t) => at - t < HOUR);
      const fresh = s.last !== null && at - s.last < 2 * MINUTE;
      // Постоянный поток — только у MES (проход кузовов), WMS (раз в час), контроллеров и камер.
      // QLS пишет при браке, ERP — план раз в месяц, мастер и импорт — по событию: для них «тишина» — норма
      const continuous = def.id === 'mes' || def.id === 'wms' || def.id === 'plc' || def.id === 'camera';
      return {
        id: def.id,
        connected: s.clients.size > 0 || (fresh && continuous) || (!continuous && s.last !== null),
        expected: continuous && def.stage <= stage,
        lastMessageAt: s.last ? new Date(s.last).toISOString() : null,
        perMinute: s.recent.length,
        errorsLastHour: s.errors.length,
        clients: s.clients.size,
      };
    });
  }
}

/** MQTT clientId вида «plc-…», «camera-…» → источник */
export function sourceFromClientId(clientId: string): SourceId | null {
  const prefix = clientId.split(/[-_:]/)[0]?.toLowerCase();
  return (SOURCE_IDS as readonly string[]).includes(prefix ?? '') ? (prefix as SourceId) : null;
}
