import { describe, expect, it } from 'vitest';
import {
  CanonicalEvent,
  DecisionRequest,
  DowntimeRequest,
  EventBatch,
  PlanRequest,
  QualityRequest,
  ShiftReportRequest,
  WorkOrder,
  isValidVin,
  makeVin,
  monthShifts,
  mqttToEvent,
  parseTopic,
  qualityRowsToEvents,
  shiftAt,
  shiftReportRowsToEvents,
  toPlantIso,
  DEMO_START_MS,
  plantParts,
  normalizeDate,
} from '../src/index';
import { loadExamples } from '../src/examples';
import { buildOpenApiDocument } from '../src/openapi';

const ex = loadExamples();

describe('примеры сообщений соответствуют схемам', () => {
  for (const [name, value] of Object.entries(ex.events)) {
    it(`событие ${name}`, () => {
      const r = CanonicalEvent.safeParse(value);
      expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
      expect((value as { type: string }).type).toBe(name);
    });
  }
  it('REST: пакет событий', () => expect(EventBatch.safeParse(ex.rest.events_batch).success).toBe(true));
  it('REST: простой', () => expect(DowntimeRequest.safeParse(ex.rest.downtime).success).toBe(true));
  it('REST: план', () => expect(PlanRequest.safeParse(ex.rest.plan).success).toBe(true));
  it('REST: сменный отчёт', () => expect(ShiftReportRequest.safeParse(ex.rest.shift_reports).success).toBe(true));
  it('REST: качество', () => expect(QualityRequest.safeParse(ex.rest.quality).success).toBe(true));
  it('REST: решение', () => expect(DecisionRequest.safeParse(ex.rest.decision).success).toBe(true));
  it('MQTT: наряд', () => expect(WorkOrder.safeParse(ex.mqtt.work_order!.payload).success).toBe(true));
  for (const name of ['plc_state', 'plc_counter', 'plc_telemetry', 'camera_detection']) {
    it(`MQTT: ${name} приводится к событию`, () => {
      const m = ex.mqtt[name]!;
      const r = mqttToEvent(m.topic, JSON.stringify(m.payload), DEMO_START_MS);
      expect(r.ok).toBe(true);
      if (r.ok) expect(CanonicalEvent.safeParse(r.event).success).toBe(true);
    });
  }
});

describe('валидация', () => {
  it('ошибки по-русски и с путём поля', () => {
    const r = CanonicalEvent.safeParse({ ...(ex.events.post_passed as object), vin: 'abc' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toMatch(/VIN/);
  });
  it('MQTT: неизвестный топик и не-JSON отклоняются', () => {
    expect(mqttToEvent('allur/kst/moon/X/state', '{}', 0).ok).toBe(false);
    expect(mqttToEvent('allur/kst/paint/BOOTH-02/state', 'not json', 0).ok).toBe(false);
    expect(parseTopic('allur/kst/assembly/camera/CAM-ASM/detection')).toEqual({ kind: 'detection', area: 'assembly', cameraId: 'CAM-ASM' });
  });
});

describe('VIN', () => {
  it('генерируется 17 символов с верной контрольной цифрой', () => {
    for (let i = 1; i < 500; i += 37) {
      const v = makeVin(i % 2 ? 'onix' : 'j7', 4000 + i);
      expect(v).toHaveLength(17);
      expect(isValidVin(v)).toBe(true);
    }
    expect(isValidVin('KZACN1S10TK004815')).toBe(false);
  });
});

describe('календарь и время завода', () => {
  it('старт демо — среда 07.10.2026 08:00 по Костанаю', () => {
    const p = plantParts(DEMO_START_MS);
    expect([p.date, p.hour, p.weekday]).toEqual(['2026-10-07', 8, 3]);
    expect(toPlantIso(DEMO_START_MS)).toBe('2026-10-07T08:00:00+05:00');
  });
  it('в октябре 2026: 21 будний день + 2 субботы = 46 смен = 5520 машин мощности', () => {
    const shifts = monthShifts('2026-10');
    expect(shifts).toHaveLength(46);
    expect(shifts.length * 120).toBe(5520);
    expect(shifts.some((s) => s.date === '2026-10-26')).toBe(false);
    expect(shifts.some((s) => s.date === '2026-10-17')).toBe(true);
  });
  it('ночь и выходные — нерабочее время', () => {
    expect(shiftAt(Date.parse('2026-10-07T13:40:00+05:00'))?.index).toBe(1);
    expect(shiftAt(Date.parse('2026-10-07T17:00:00+05:00'))?.index).toBe(2);
    expect(shiftAt(Date.parse('2026-10-08T02:00:00+05:00'))).toBeNull();
    expect(shiftAt(Date.parse('2026-10-10T10:00:00+05:00'))).toBeNull();
  });
  it('даты организаторов разбираются', () => {
    expect(normalizeDate('01.10.2026')).toBe('2026-10-01');
    expect(normalizeDate('2026-10-02')).toBe('2026-10-02');
    expect(normalizeDate('32/10/2026')).toBeNull();
  });
});

describe('таблицы организаторов → события', () => {
  it('сменный отчёт', () => {
    const r = shiftReportRowsToEvents(ShiftReportRequest.parse(ex.rest.shift_reports), 'import', DEMO_START_MS);
    expect(r.issues).toEqual([]);
    expect(r.events.map((e) => e.area)).toEqual(['weld', 'paint', 'assembly', 'weld', 'paint', 'assembly']);
  });
  it('качество: участок «Сборка» → assembly, процент считается, если не дан', () => {
    const r = qualityRowsToEvents([{ date: '01.10.2026', area: 'Сборка', produced: 121, defects: 1 }], 'import', DEMO_START_MS);
    expect(r.events[0]).toMatchObject({ area: 'assembly', payload: { pct: 0.8 } });
  });
});

describe('OpenAPI', () => {
  it('собирается из Zod-схем', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toContain('/api/v1/downtimes');
    expect(doc.components.schemas).toHaveProperty('CanonicalEvent');
    expect(doc.components.schemas).toHaveProperty('DowntimeRequest');
    expect(JSON.stringify(doc)).not.toContain('"$id"');
  });
});
