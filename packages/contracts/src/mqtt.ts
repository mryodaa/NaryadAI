// MQTT: пространство топиков контроллеров и видеоаналитики (описано в asyncapi.yaml)
// и приведение сообщений к каноническим событиям.
import { z } from 'zod';
import { AREA_IDS, type AreaId } from './plant';
import {
  CameraDetectionKind,
  EquipmentStatus,
  MetricIdSchema,
  Timestamp,
  zodIssues,
  type CanonicalEvent,
  type ValidationIssue,
} from './events';
import { toPlantIso } from './time';

export const TOPIC_ROOT = 'allur/kst';

export const topics = {
  state: (area: AreaId, equipmentId: string) => `${TOPIC_ROOT}/${area}/${equipmentId}/state`,
  counter: (area: AreaId, equipmentId: string) => `${TOPIC_ROOT}/${area}/${equipmentId}/counter`,
  telemetry: (area: AreaId, equipmentId: string) => `${TOPIC_ROOT}/${area}/${equipmentId}/telemetry`,
  detection: (area: AreaId, cameraId: string) => `${TOPIC_ROOT}/${area}/camera/${cameraId}/detection`,
  /** Служебный топик демо: часы симуляции (не часть контракта интеграции) */
  demoClock: `${TOPIC_ROOT}/demo/clock`,
  /** Наряды от двойника в системы завода */
  workOrders: `${TOPIC_ROOT}/twin/work-orders`,
} as const;

export const PlcStatePayload = z
  .object({ status: EquipmentStatus, code: z.string().max(32).optional(), text: z.string().max(200).optional(), ts: Timestamp.optional() })
  .meta({ id: 'PlcStatePayload', description: 'Состояние оборудования' });

export const PlcCounterPayload = z
  .object({ cycles: z.number().int().min(0), total: z.number().int().min(0), ts: Timestamp.optional() })
  .meta({ id: 'PlcCounterPayload', description: 'Счётчик циклов: с последнего ТО и за весь срок' });

export const PlcTelemetryPayload = z
  .object({ metric: MetricIdSchema, value: z.number(), ts: Timestamp.optional() })
  .meta({ id: 'PlcTelemetryPayload', description: 'Значение датчика' });

export const CameraDetectionPayload = z
  .object({ kind: CameraDetectionKind, value: z.number().optional(), clipUrl: z.string().max(500).optional(), ts: Timestamp.optional() })
  .meta({ id: 'CameraDetectionPayload', description: 'Детекция видеоаналитики' });

export type ParsedTopic =
  | { kind: 'state' | 'counter' | 'telemetry'; area: AreaId; equipmentId: string }
  | { kind: 'detection'; area: AreaId; cameraId: string };

export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');
  if (parts[0] !== 'allur' || parts[1] !== 'kst') return null;
  const area = parts[2] as AreaId;
  if (!(AREA_IDS as readonly string[]).includes(area)) return null;
  if (parts.length === 6 && parts[3] === 'camera' && parts[5] === 'detection' && parts[4]) {
    return { kind: 'detection', area, cameraId: parts[4] };
  }
  if (parts.length === 5 && parts[3] && (parts[4] === 'state' || parts[4] === 'counter' || parts[4] === 'telemetry')) {
    return { kind: parts[4], area, equipmentId: parts[3] };
  }
  return null;
}

export type MqttNormalizeResult =
  | { ok: true; event: CanonicalEvent }
  | { ok: false; issues: ValidationIssue[] };

/** Сообщение MQTT → каноническое событие. receivedAt — время приёма (двойника), если в сообщении нет ts */
export function mqttToEvent(topic: string, raw: string, receivedAt: number): MqttNormalizeResult {
  const parsed = parseTopic(topic);
  if (!parsed) return { ok: false, issues: [{ path: 'topic', message: `Неизвестный топик: ${topic}` }] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, issues: [{ path: 'payload', message: 'Сообщение не является JSON' }] };
  }
  const fallbackTs = toPlantIso(receivedAt);

  if (parsed.kind === 'detection') {
    const r = CameraDetectionPayload.safeParse(json);
    if (!r.success) return { ok: false, issues: zodIssues(r.error) };
    const ts = r.data.ts ?? fallbackTs;
    return {
      ok: true,
      event: {
        eventId: `camera:${parsed.cameraId}:${r.data.kind}:${ts}`,
        source: 'camera',
        ts,
        area: parsed.area,
        type: 'camera_detection',
        payload: { cameraId: parsed.cameraId, kind: r.data.kind, value: r.data.value, clipUrl: r.data.clipUrl },
      },
    };
  }

  if (parsed.kind === 'state') {
    const r = PlcStatePayload.safeParse(json);
    if (!r.success) return { ok: false, issues: zodIssues(r.error) };
    const ts = r.data.ts ?? fallbackTs;
    return {
      ok: true,
      event: {
        eventId: `plc:${parsed.equipmentId}:state:${ts}`,
        source: 'plc',
        ts,
        area: parsed.area,
        equipmentId: parsed.equipmentId,
        type: 'equipment_state',
        payload: { status: r.data.status, code: r.data.code, text: r.data.text },
      },
    };
  }

  if (parsed.kind === 'counter') {
    const r = PlcCounterPayload.safeParse(json);
    if (!r.success) return { ok: false, issues: zodIssues(r.error) };
    const ts = r.data.ts ?? fallbackTs;
    return {
      ok: true,
      event: {
        eventId: `plc:${parsed.equipmentId}:counter:${ts}`,
        source: 'plc',
        ts,
        area: parsed.area,
        equipmentId: parsed.equipmentId,
        type: 'equipment_counter',
        payload: { cycles: r.data.cycles, total: r.data.total },
      },
    };
  }

  const r = PlcTelemetryPayload.safeParse(json);
  if (!r.success) return { ok: false, issues: zodIssues(r.error) };
  const ts = r.data.ts ?? fallbackTs;
  return {
    ok: true,
    event: {
      eventId: `plc:${parsed.equipmentId}:${r.data.metric}:${ts}`,
      source: 'plc',
      ts,
      area: parsed.area,
      equipmentId: parsed.equipmentId,
      type: 'telemetry',
      payload: { metric: r.data.metric, value: r.data.value },
    },
  };
}
