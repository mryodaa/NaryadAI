// 30 дней истории: та же физическая модель, прокрученная быстро с 7 сентября по 6 октября.
// В 1С уходят только агрегаты — сменные отчёты, итоги качества, журнал простоев и ТО, планы.
// За 1 и 2 октября первая смена — ровно таблицы организаторов (с их противоречиями).
import {
  SEED_MODEL,
  SEED_PLANT,
  addDays,
  plantMs,
  shiftsBetweenDates,
  toPlantIso,
  type AreaId,
  type CanonicalEvent,
  type WorkOrder,
} from '@allur/contracts';
import { CAL, MIN } from './calibration';
import { Rng, hashSeed } from './rng';
import { masterOf, reportLines } from './adapters';
import { World, type DowntimeInfo } from './world';

export const HISTORY_FROM = '2026-09-07';
export const HISTORY_TO = '2026-10-06';

// История — это прошлое: цех работал в исходном составе, что бы ни было применено сейчас
const PLANT = SEED_MODEL;
const LINE_OF: Record<string, string> = Object.fromEntries(reportLines(PLANT).map((r) => [r.area, r.line]));
const MASTER_OF = (area: AreaId) => masterOf(PLANT, area);

/** Таблицы организаторов (считаем, что строка — первая смена) */
const GIVEN = {
  reports: [
    { date: '2026-10-01', area: 'weld', fact: 118, hours: 7.8, load: 98 },
    { date: '2026-10-01', area: 'paint', fact: 115, hours: 7.5, load: 94 },
    { date: '2026-10-01', area: 'assembly', fact: 121, hours: 8.0, load: 100 },
    { date: '2026-10-02', area: 'weld', fact: 111, hours: 7.2, load: 91 },
    { date: '2026-10-02', area: 'paint', fact: 116, hours: 7.7, load: 96 },
    { date: '2026-10-02', area: 'assembly', fact: 119, hours: 7.9, load: 99 },
  ] as const,
  quality: [
    { date: '2026-10-01', area: 'weld', produced: 118, defects: 2, pct: 1.7 },
    { date: '2026-10-01', area: 'paint', produced: 115, defects: 4, pct: 3.5 },
    { date: '2026-10-01', area: 'assembly', produced: 121, defects: 1, pct: 0.8 },
    { date: '2026-10-02', area: 'weld', produced: 111, defects: 3, pct: 2.7 },
    { date: '2026-10-02', area: 'paint', produced: 116, defects: 6, pct: 5.2 },
    { date: '2026-10-02', area: 'assembly', produced: 119, defects: 2, pct: 1.7 },
  ] as const,
  downtimes: [
    { date: '2026-10-01', area: 'weld', equipmentId: 'ABB-01', reason: 'Ошибка датчика', category: 'breakdown', from: '09:40', minutes: 25 },
    { date: '2026-10-01', area: 'paint', equipmentId: 'BOOTH-02', reason: 'Замена фильтра', category: 'breakdown', from: '13:10', minutes: 40 },
    { date: '2026-10-02', area: 'assembly', equipmentId: 'CONV-03', reason: 'Обрыв цепи', category: 'breakdown', from: '10:20', minutes: 55 },
    { date: '2026-10-02', area: 'weld', equipmentId: 'ABB-04', reason: 'Плановое ТО', category: 'planned', from: '14:00', minutes: 30 },
  ] as const,
};

const GIVEN_SHIFTS = new Set(['2026-10-01#1', '2026-10-02#1']);

export function generateHistory(seed: number, presetCycles: Record<string, number>): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];
  const rng = new Rng(hashSeed(seed, 'history-policy'));
  const shifts = shiftsBetweenDates(HISTORY_FROM, HISTORY_TO);
  const expectedOutput = shifts.length * 115;
  const interval = CAL.robotIntervalCycles;

  // Счётчики роботов на начало истории подобраны так, чтобы к 7 октября получились значения пресета
  const histCycles: Record<string, number> = {};
  const serviceBeforeWindow: { equipmentId: string; daysBefore: number }[] = [];
  // робот линии под модель видит только кузова своей модели
  const mixTotal = CAL.mix.onix + CAL.mix.cobalt + CAL.mix.j7;
  const shareOf = (id: string) => {
    const e = PLANT.equipmentById.get(id);
    const st = e?.stationId ? PLANT.stageById.get(e.stageId)?.stations.find((x) => x.id === e.stationId) : undefined;
    return st?.models ? st.models.reduce((a, m) => a + CAL.mix[m], 0) / mixTotal : 1;
  };
  for (const [id, c] of Object.entries(presetCycles)) {
    const share = shareOf(id);
    const start = c - Math.round(expectedOutput * share);
    if (start >= 0) {
      histCycles[id] = start;
      serviceBeforeWindow.push({ equipmentId: id, daysBefore: Math.max(1, Math.round(start / (230 * share))) });
    } else {
      const every = PLANT.equipmentById.get(id)?.type.serviceIntervalCycles ?? interval;
      histCycles[id] = ((start % every) + every) % every;
    }
  }

  const world = new World(
    {
      startMs: plantMs(HISTORY_FROM, 7 * 60 + 59),
      seed: hashSeed(seed, 'history'),
      randomFailures: true,
      microStops: true,
      filterBodies: { 'BOOTH-02': 70, 'BOOTH-01': 100 },
      robotCycles: histCycles,
      buffers: { ...CAL.initialBuffers },
      kitShifts: {},
      delayedDeliveries: [],
      serial: CAL.firstSerial - 5200,
    },
    SEED_PLANT,
  );

  const endMs = plantMs(addDays(HISTORY_TO, 1), 0);
  const dt = 30_000;
  const serviceScheduled = new Set<string>();
  let woSeq = 0;

  const dateOf = (ms: number) => toPlantIso(ms).slice(0, 10);
  const shiftKeyOf = (ms: number) => {
    const d = dateOf(ms);
    const hour = Number(toPlantIso(ms).slice(11, 13));
    return `${d}#${hour < 16 ? 1 : 2}`;
  };

  while (world.t < endMs) {
    world.step(dt);
    // Политика ТО роботов: 70% — ночью, 30% — в смену (так и появляются плановые простои в смене)
    for (const e of world.equipmentSnapshot()) {
      const every = PLANT.equipmentById.get(e.id)?.type.serviceIntervalCycles;
      if (!every || e.cycles < every || serviceScheduled.has(e.id)) continue;
      serviceScheduled.add(e.id);
      const date = dateOf(world.t);
      const atNight = rng.chance(0.7);
      const at = atNight ? plantMs(addDays(date, 1), 30) : world.t + rng.range(30, 300) * MIN;
      const wo: WorkOrder = {
        workOrderId: `hist-wo-${++woSeq}`,
        incidentId: 'history',
        action: 'maintenance',
        area: e.area,
        equipmentId: e.id,
        title: 'Плановое ТО',
        scheduledAt: toPlantIso(at),
        durationMin: 30,
        issuedAt: toPlantIso(world.t),
      };
      world.applyWorkOrder(wo);
    }
    for (const ev of world.drain()) {
      if (ev.kind === 'downtime_end') {
        if (PLANT.equipmentById.get(ev.info.equipmentId)?.type.serviceIntervalCycles && ev.info.category === 'planned') serviceScheduled.delete(ev.info.equipmentId);
        if (ev.info.micro) continue;
        if (GIVEN_SHIFTS.has(shiftKeyOf(ev.info.from))) continue;
        events.push(downtimeEvent(ev.info, ev.to));
      }
      if (ev.kind === 'shift_end') {
        const s = ev.stats;
        if (GIVEN_SHIFTS.has(s.shift.key)) continue;
        const ts = toPlantIso(s.shift.endMs + 3 * MIN);
        for (const { area, line } of reportLines(PLANT)) {
          const hours = Math.max(0, (480 - (s.stoppedMin[area] ?? 0)) / 60);
          const produced = s.output[area] ?? 0;
          const defects = s.defects[area] ?? 0;
          events.push({
            eventId: `hist:mes:report:${s.shift.key}:${area}`,
            source: 'mes',
            ts,
            area,
            type: 'shift_report',
            payload: { date: s.shift.date, shift: s.shift.index, line, plan: 120, fact: produced, hours: round1(hours), load: Math.round((hours / 8) * 100) },
          });
          events.push({
            eventId: `hist:qls:quality:${s.shift.key}:${area}`,
            source: 'qls',
            ts,
            area,
            type: 'quality_summary',
            payload: { date: s.shift.date, shift: s.shift.index, produced, defects, pct: produced ? round1((defects / produced) * 100) : 0 },
          });
        }
      }
    }
  }

  // Данные организаторов за 1 и 2 октября (первая смена)
  for (const r of GIVEN.reports) {
    events.push({
      eventId: `hist:mes:report:${r.date}#1:${r.area}`,
      source: 'mes',
      ts: toPlantIso(plantMs(r.date, 16 * 60 + 3)),
      area: r.area,
      type: 'shift_report',
      payload: { date: r.date, shift: 1, line: LINE_OF[r.area]!, plan: 120, fact: r.fact, hours: r.hours, load: r.load },
    });
  }
  for (const q of GIVEN.quality) {
    events.push({
      eventId: `hist:qls:quality:${q.date}#1:${q.area}`,
      source: 'qls',
      ts: toPlantIso(plantMs(q.date, 16 * 60 + 3)),
      area: q.area,
      type: 'quality_summary',
      payload: { date: q.date, shift: 1, produced: q.produced, defects: q.defects, pct: q.pct },
    });
  }
  for (const d of GIVEN.downtimes) {
    const [h, m] = d.from.split(':').map(Number);
    const from = plantMs(d.date, h! * 60 + m!);
    events.push({
      eventId: `hist:mes:dt:${d.equipmentId}:${toPlantIso(from)}`,
      source: 'mes',
      ts: toPlantIso(from + (d.minutes + 10) * MIN),
      area: d.area,
      equipmentId: d.equipmentId,
      type: 'downtime_registered',
      payload: { reason: d.reason, category: d.category, from: toPlantIso(from), to: toPlantIso(from + d.minutes * MIN), registeredBy: MASTER_OF(d.area) },
    });
  }

  // Последнее ТО роботов, которое было до окна истории (журнал ТО грузится целиком)
  for (const s of serviceBeforeWindow) {
    const date = addDays(HISTORY_FROM, -s.daysBefore);
    const from = plantMs(date, 30);
    events.push({
      eventId: `hist:mes:service:${s.equipmentId}:${date}`,
      source: 'mes',
      ts: toPlantIso(from + 40 * MIN),
      area: PLANT.equipmentById.get(s.equipmentId)!.stageId,
      equipmentId: s.equipmentId,
      type: 'downtime_registered',
      payload: { reason: 'Плановое ТО', category: 'planned', from: toPlantIso(from), to: toPlantIso(from + 30 * MIN), registeredBy: 'Служба ТО' },
    });
  }

  // Планы из 1С:ERP
  events.push({
    eventId: 'hist:erp:plan:2026-09',
    source: 'erp',
    ts: '2026-09-01T07:30:00+05:00',
    area: 'finished',
    type: 'plan_set',
    payload: { month: '2026-09', target: 5300, models: [{ model: 'onix', qty: 2760 }, { model: 'cobalt', qty: 1990 }, { model: 'j7', qty: 550 }] },
  });
  events.push({
    eventId: 'hist:erp:plan:2026-10',
    source: 'erp',
    ts: '2026-10-01T07:30:00+05:00',
    area: 'finished',
    type: 'plan_set',
    payload: { month: '2026-10', target: 5500, models: [{ model: 'onix', qty: 2500 }, { model: 'cobalt', qty: 1800 }, { model: 'j7', qty: 500 }] },
  });

  return events;
}

function downtimeEvent(info: DowntimeInfo, to: number): CanonicalEvent {
  const from = roundTo5(info.from);
  return {
    eventId: `hist:mes:dt:${info.equipmentId}:${toPlantIso(from)}`,
    source: 'mes',
    ts: toPlantIso(to + 10 * MIN),
    area: info.area,
    equipmentId: info.equipmentId,
    type: 'downtime_registered',
    payload: {
      reason: info.reason,
      category: info.category,
      from: toPlantIso(from),
      to: toPlantIso(Math.max(from + 5 * MIN, roundTo5(to))),
      registeredBy: info.category === 'planned' ? 'Служба ТО' : MASTER_OF(info.area),
    },
  };
}

function roundTo5(ms: number) {
  return Math.round(ms / (5 * MIN)) * 5 * MIN;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
