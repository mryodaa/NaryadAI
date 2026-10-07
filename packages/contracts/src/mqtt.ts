// MQTT: пространство топиков контроллеров и видеоаналитики (описано в asyncapi.yaml)
// и приведение сообщений к каноническим событиям.
import { z } from 'zod';
import type { AreaId } from './plant';
import {
  CameraDetectionKind,
  EquipmentStatus,
  BodyId,
  MetricIdSchema,
  Timestamp,
  Vin,
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
  /** Пульс связи шлюза контроллеров: оборудование на связи (событием двойника не становится) */
  heartbeat: (area: AreaId, equipmentId: string) => `${TOPIC_ROOT}/${area}/${equipmentId}/heartbeat`,
  detection: (area: AreaId, cameraId: string) => `${TOPIC_ROOT}/${area}/camera/${cameraId}/detection`,
  /** Отметка кузова в точке (RFID, трекинг ПЛК) */
  checkpoint: (area: AreaId, checkpointId: string) => `${TOPIC_ROOT}/${area}/${checkpointId}/checkpoint`,
  /** Результат операции над кузовом от робота или инструмента поста */
  operation: (area: AreaId, equipmentId: string) => `${TOPIC_ROOT}/${area}/${equipmentId}/operation`,
  /** Служебный топик демо: часы симуляции (не часть контракта интеграции) */
  demoClock: `${TOPIC_ROOT}/demo/clock`,
  /** Служебный топик демо: шлюз опрашивает имитатор при проверке подключения */
  simProbe: `${TOPIC_ROOT}/demo/sim-probe`,
  /** Ответ имитатора на опрос (публикует имитатор) */
  simProbeReply: (requestId: string) => `${TOPIC_ROOT}/sim/probe-reply/${requestId}`,
  /** Наряды от двойника в системы завода */
  workOrders: `${TOPIC_ROOT}/twin/work-orders`,
  /** Двойник применил новую версию конфигурации завода (plant_config_changed) */
  plantConfig: `${TOPIC_ROOT}/twin/plant-config`,
} as const;

/** Служебные топики имитатора — не данные цеха */
export const SIM_TOPIC_PREFIX = `${TOPIC_ROOT}/sim/`;

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

export const CheckpointPayload = z
  .object({
    bodyId: BodyId.optional(),
    vin: Vin.optional(),
    direction: z.enum(['in', 'out']),
    postId: z.string().max(64).optional(),
    ts: Timestamp.optional(),
  })
  .meta({ id: 'CheckpointPayload', description: 'Отметка кузова: номер кузова или VIN, направление, позиция на конвейере' });

export const OperationPayload = z
  .object({
    bodyId: BodyId.optional(),
    vin: Vin.optional(),
    operation: z.string().min(1).max(64),
    result: z.enum(['ok', 'nok']),
    details: z.string().max(300).optional(),
    ts: Timestamp.optional(),
  })
  .meta({ id: 'OperationPayload', description: 'Результат операции над кузовом' });

export type ParsedTopic =
  | { kind: 'state' | 'counter' | 'telemetry' | 'heartbeat' | 'checkpoint' | 'operation'; area: AreaId; equipmentId: string }
  | { kind: 'detection'; area: AreaId; cameraId: string };

export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');
  if (parts[0] !== 'allur' || parts[1] !== 'kst') return null;
  // Есть ли такой участок и оборудование в конфигурации завода, проверяет шлюз
  const area = parts[2] as AreaId;
  if (!area || !/^[a-z][a-z0-9-]{0,31}$/.test(area)) return null;
  if (parts.length === 6 && parts[3] === 'camera' && parts[5] === 'detection' && parts[4]) {
    return { kind: 'detection', area, cameraId: parts[4] };
  }
  if (
    parts.length === 5 &&
    parts[3] &&
    (parts[4] === 'state' || parts[4] === 'counter' || parts[4] === 'telemetry' || parts[4] === 'heartbeat' || parts[4] === 'checkpoint' || parts[4] === 'operation')
  ) {
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
  if (parsed.kind === 'heartbeat') return { ok: false, issues: [{ path: 'topic', message: 'Пульс связи — не событие цеха' }] };

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

  if (parsed.kind === 'checkpoint') {
    const r = CheckpointPayload.safeParse(json);
    if (!r.success) return { ok: false, issues: zodIssues(r.error) };
    if (!r.data.bodyId && !r.data.vin) return { ok: false, issues: [{ path: 'bodyId', message: 'Нужен номер кузова (bodyId) или VIN' }] };
    const ts = r.data.ts ?? fallbackTs;
    return {
      ok: true,
      event: {
        eventId: `plc:${parsed.equipmentId}:cp:${r.data.bodyId ?? r.data.vin}:${r.data.direction}:${r.data.postId ?? ''}:${ts}`,
        source: 'plc',
        ts,
        area: parsed.area,
        vin: r.data.vin,
        type: 'body_checkpoint',
        payload: { bodyId: r.data.bodyId, checkpointId: parsed.equipmentId, direction: r.data.direction, postId: r.data.postId },
      },
    };
  }

  if (parsed.kind === 'operation') {
    const r = OperationPayload.safeParse(json);
    if (!r.success) return { ok: false, issues: zodIssues(r.error) };
    if (!r.data.bodyId && !r.data.vin) return { ok: false, issues: [{ path: 'bodyId', message: 'Нужен номер кузова (bodyId) или VIN' }] };
    const ts = r.data.ts ?? fallbackTs;
    return {
      ok: true,
      event: {
        eventId: `plc:${parsed.equipmentId}:op:${r.data.bodyId ?? r.data.vin}:${r.data.operation}:${ts}`,
        source: 'plc',
        ts,
        area: parsed.area,
        equipmentId: parsed.equipmentId,
        vin: r.data.vin,
        type: 'operation_result',
        payload: { bodyId: r.data.bodyId, operation: r.data.operation, result: r.data.result, details: r.data.details },
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
