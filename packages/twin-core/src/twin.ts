// Двойник: принимает события, по часам пересчитывает статусы, инциденты и прогноз,
// отдаёт снимок для интерфейса. Чистая логика — без сети, без знания об имитаторах.
// Состав цеха — конфигурация завода: setPlant перестраивает двойник без перезапуска.
import {
  KITS,
  SEED_PLANT,
  currentOrNextShift,
  derivePlant,
  inflect,
  plantMs,
  plantParts,
  shiftAt,
  toPlantIso,
  type AreaId,
  type AreaView,
  type AttentionItem,
  type BufferId,
  type CanonicalEvent,
  type LiveSnapshot,
  type PlantConfig,
  type PlantModel,
  type ScenarioId,
  type Stage,
  type TimelineMark,
  type TimelineSegment,
  type WorkOrder,
} from '@allur/contracts';
import { DEFAULT_CONFIG, type MoneyParams, type TwinConfig } from './config';
import { IncidentBook, robotCycles, type Incident } from './incidents';
import { monthForecast, NO_LEVERS, type Levers, type MonthForecast } from './forecast';
import { criticalDowntimeToday, shiftKpis, stopIntervals, unaccountedLosses } from './kpi';
import { paintFilterCause, qualityAlarm, qualityWindow } from './quality';
import { TwinState } from './state';
import { bufferAt, bufferCounts, evaluateArea, type AreaEval, type Signal } from './status';
import { filterBooths, qualityStages } from './plant';
import { plantCapacity } from './capacity';
import { num } from './text';
import { dataChecks } from './checks';
import { buildPassport } from './passport';
import { DEFECT_BY_ID, type CanonicalEvent as Ev } from '@allur/contracts';

export interface SnapshotMeta {
  runId: number;
  stage: Stage;
  speed: number;
  paused: boolean;
  scenario: ScenarioId;
}

export interface DecisionResult {
  ok: boolean;
  error?: string;
  workOrder?: WorkOrder;
  summary?: string;
  forecastBefore?: number;
  forecastAfter?: number;
}

export class Twin {
  cfg: TwinConfig;
  /** Состав цеха (конфигурация завода) */
  plant: PlantModel;
  state: TwinState;
  book = new IncidentBook();
  private evals: Record<string, AreaEval> = {};
  private bufferSamples: { t: number; counts: Record<BufferId, number> }[] = [];
  private lastIncidentUpdate = 0;
  private lastSample = 0;
  private forecastCache = new Map<string, MonthForecast>();

  constructor(cfg: Partial<TwinConfig> = {}, plant: PlantConfig = SEED_PLANT) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg, money: { ...DEFAULT_CONFIG.money, ...cfg.money } };
    this.plant = derivePlant(plant);
    this.state = new TwinState(this.plant);
  }

  /** Применена новая конфигурация завода: статусы, мощность, инциденты и прогноз — по новому составу */
  setPlant(config: PlantConfig) {
    this.plant = derivePlant(config);
    this.state.setPlant(this.plant);
    for (const id of Object.keys(this.evals)) if (!this.plant.stageById.has(id)) delete this.evals[id];
    this.lastIncidentUpdate = 0;
    this.forecastCache.clear();
  }

  setMoney(m: Partial<MoneyParams>) {
    this.cfg = { ...this.cfg, money: { ...this.cfg.money, ...m } };
    this.lastIncidentUpdate = 0;
  }

  reset(runStartMs: number) {
    this.state = new TwinState(this.plant);
    this.state.runStartMs = runStartMs;
    this.book.reset();
    this.evals = {};
    this.bufferSamples = [];
    this.lastIncidentUpdate = 0;
    this.lastSample = 0;
    this.forecastCache.clear();
  }

  ingest(e: CanonicalEvent) {
    this.state.ingest(e);
  }

  /** Есть ли с чем работать: история и план загружены */
  get ready(): boolean {
    return this.state.reports.size > 0 && this.state.plans.size > 0;
  }

  tick(now: number) {
    const st = this.state;
    // Качество: причина для статуса «Работает с браком»
    const qualityReasons: Partial<Record<AreaId, { text: string; equipmentId?: string; since: number; signals: Signal[] } | null>> = {};
    for (const stage of qualityStages(this.plant)) {
      const area = stage.id;
      const open = this.book.all().some((i) => i.key === `quality:${area}` && i.status !== 'resolved');
      const qa = qualityAlarm(st, area, now, this.cfg, open);
      const w = qa.window;
      if (qa.alarm) {
        let text = `Брак ${(w.share * 100).toFixed(1).replace('.', ',')}% за 2 часа`;
        let equipmentId: string | undefined;
        const signals: Signal[] = [
          {
            source: 'qls',
            ts: now,
            text: `1С:QLS: ${w.defects} из ${w.inspected} проверенных кузовов с дефектом за 2 часа${w.top[0] ? ` — чаще всего «${w.top[0].name.toLowerCase()}»` : ''}`,
          },
        ];
        if (stage.kind === 'painting') {
          const cause = paintFilterCause(st, now, this.cfg, undefined, area);
          if (cause) {
            text = `${cause.equipmentName}: фильтр забит${cause.dpNow ? ` (${num(cause.dpNow)} Па)` : ''}`;
            equipmentId = cause.equipmentId;
            signals.push({
              source: 'plc',
              ts: now,
              equipmentId: cause.equipmentId,
              text: `Контроллер ${inflect(cause.equipmentName, 'gen')}: перепад на фильтре ${num(cause.dpNow ?? 0)} Па (норма до ${this.cfg.filter.normPa})`,
            });
            signals.push({ source: 'mes', ts: now, text: `1С:MES + QLS по VIN: ${cause.sentence.toLowerCase()}` });
          }
        } else if (w.top[0]) text = `${w.top[0].name}: ${w.top[0].count} за 2 часа`;
        qualityReasons[area] = { text, equipmentId, since: w.firstDefectTs ?? now, signals };
      }
    }
    for (const stage of this.plant.production) this.evals[stage.id] = evaluateArea(st, stage.id, now, this.cfg, qualityReasons[stage.id] ?? null);

    if (now - this.lastSample >= 2 * 60_000 || now < this.lastSample) {
      this.lastSample = now;
      this.bufferSamples.push({ t: now, counts: bufferCounts(st) });
      this.bufferSamples = this.bufferSamples.filter((s) => now - s.t <= 90 * 60_000 && s.t <= now);
    }

    // Инциденты пересчитываем не чаще раза в 20 секунд времени двойника
    if (Math.abs(now - this.lastIncidentUpdate) >= 20_000) {
      this.lastIncidentUpdate = now;
      this.book.update({ state: st, now, cfg: this.cfg, evals: this.evals, bufferTrend: this.bufferTrend(now) });
      this.forecastCache.clear();
    }
  }

  /** Тренд буферов за последний час — по истории проходов VIN, кузовов в час */
  private bufferTrend(now: number): Record<BufferId, number> {
    const out: Record<BufferId, number> = Object.fromEntries(this.plant.buffers.map((b) => [b.id, 0]));
    const shift = shiftAt(now);
    const from = Math.max(now - 3600_000, shift?.startMs ?? now, this.state.runStartMs);
    const hours = (now - from) / 3600_000;
    if (hours < 0.4) return out;
    for (const id of Object.keys(out) as BufferId[]) out[id] = (bufferAt(this.state, id, now) - bufferAt(this.state, id, from)) / hours;
    return out;
  }

  forecast(now: number, levers: Levers = NO_LEVERS): MonthForecast {
    const key = `${Math.floor(now / 60_000)}|${levers.moveMaintenance}|${levers.filterBySchedule}|${levers.saturdayShifts}`;
    let f = this.forecastCache.get(key);
    if (!f) {
      f = monthForecast(this.state, now, this.cfg, { levers, incidentLoss: this.book.expectedLoss() });
      if (this.forecastCache.size > 50) this.forecastCache.clear();
      this.forecastCache.set(key, f);
    }
    return f;
  }

  incidents(): Incident[] {
    return this.book
      .all()
      .filter((i) => i.status !== 'resolved')
      .sort((a, b) => (a.status === b.status ? b.impactCars - a.impactCars : a.status === 'open' ? -1 : 1));
  }

  incident(id: string): Incident | undefined {
    return this.book.get(id);
  }

  decide(incidentId: string, optionId: string, decidedBy: string | undefined, now: number): DecisionResult {
    const before = this.forecast(now).p50;
    const r = this.book.decide(incidentId, optionId, decidedBy, now);
    if ('error' in r) return { ok: false, error: r.error };
    this.forecastCache.clear();
    const after = this.forecast(now).p50;
    return {
      ok: true,
      workOrder: r.workOrder ?? undefined,
      summary: `Принято: ${r.option.title}`,
      forecastBefore: before,
      forecastAfter: after,
    };
  }

  snapshot(now: number, meta: SnapshotMeta): LiveSnapshot {
    const st = this.state;
    const cfg = this.cfg;
    const shift = shiftAt(now);
    const kpis = shiftKpis(st, now, cfg, shift);
    const f = this.forecast(now);
    const counts = bufferCounts(st);

    const stock = KITS.map((k) => st.stock.get(k.id)).filter((s): s is NonNullable<typeof s> => !!s);
    const worst = stock.length ? stock.reduce((a, b) => (a.shiftsLeft < b.shiftsLeft ? a : b)) : null;
    const worstKit = worst ? KITS.find((k) => k.id === worst.kitId)! : null;
    const minShifts = stock.length ? Math.min(...stock.map((s) => s.shiftsLeft)) : 0;
    const avgShifts = stock.length ? stock.reduce((a, s) => a + s.shiftsLeft, 0) / stock.length : 0;

    const areas: AreaView[] = this.plant.stages.map((stage): AreaView => {
      if (stage.kind === 'warehouse_in') {
        return {
          id: stage.id,
          status: shift ? 'running' : 'idle',
          done: 0,
          planToNow: 0,
          reason: null,
          stockShifts: Math.round(avgShifts * 10) / 10,
          worstKit: worst && worstKit ? { name: `${worstKit.name.split(' ').pop()}: ${worstKit.id.endsWith('HARNESS') ? 'жгуты' : 'салон'}`, shiftsLeft: Math.round(worst.shiftsLeft * 10) / 10 } : null,
        };
      }
      if (stage.kind === 'warehouse_out') {
        return { id: stage.id, status: shift ? 'running' : 'idle', done: kpis.areaDone[stage.id] ?? 0, planToNow: kpis.planToNow, reason: null };
      }
      const ev = this.evals[stage.id];
      return {
        id: stage.id,
        status: ev?.status ?? (shift ? 'running' : 'idle'),
        done: kpis.areaDone[stage.id] ?? 0,
        planToNow: kpis.planToNow,
        reason: ev?.reason ?? null,
      };
    });
    void minShifts;

    const open = this.incidents();
    const attention: AttentionItem[] = open.slice(0, 3).map((i) => ({
      incidentId: i.id,
      tone: i.tone,
      title: i.title,
      impact: i.impactText,
      area: i.area,
      openedAt: toPlantIso(i.openedAt),
      fresh: i.status === 'open' && now - i.openedAt < 20 * 60_000,
    }));

    // Лента смены: остановки по участкам и моменты инцидентов
    const segments: TimelineSegment[] = [];
    const marks: TimelineMark[] = [];
    if (shift) {
      const plc = st.plcConnected(now);
      for (const stage of this.plant.production) {
        const area = stage.id;
        for (const i of stopIntervals(st, area, shift.startMs, Math.min(now, shift.endMs), cfg, plc)) {
          segments.push({
            area,
            from: toPlantIso(i.from),
            to: i.to >= now - 30_000 ? null : toPlantIso(i.to),
            tone: i.kind === 'maintenance' ? 'maintenance' : i.kind === 'waiting' ? 'waiting' : 'fault',
            label: i.partial ? `${i.label} (остальные станции работают)` : i.micro ? `${i.label} (микропростой)` : i.label,
            minor: i.partial ? true : i.micro,
          });
        }
      }
      for (const inc of this.book.all()) {
        if (inc.openedAt < shift.startMs || inc.openedAt > now) continue;
        if (inc.type === 'quality') {
          segments.push({ area: inc.area, from: toPlantIso(inc.openedAt), to: inc.resolvedAt ? toPlantIso(inc.resolvedAt) : null, tone: 'attention', label: inc.title });
        }
        if (this.plant.stageById.get(inc.area)?.producing) {
          marks.push({ area: inc.area, at: toPlantIso(inc.openedAt), tone: inc.status === 'resolved' ? 'neutral' : inc.tone === 'neutral' ? 'attention' : inc.tone, label: inc.title, incidentId: inc.id });
        }
      }
    }

    const next = shift ? null : currentOrNextShift(now);
    return {
      ready: this.ready,
      now: toPlantIso(now),
      runId: meta.runId,
      plantVersion: this.plant.version,
      stage: meta.stage,
      speed: meta.speed,
      paused: meta.paused,
      scenario: meta.scenario,
      shift: shift
        ? { key: shift.key, date: shift.date, index: shift.index, startsAt: toPlantIso(shift.startMs), endsAt: toPlantIso(shift.endMs), elapsedMin: Math.round(kpis.elapsedMin) }
        : null,
      nextShiftStartsAt: next ? toPlantIso(next.startMs) : null,
      kpi: {
        monthPlan: {
          month: f.month,
          target: f.target,
          produced: f.produced,
          forecast: f.p50,
          p10: f.p10,
          p90: f.p90,
          gap: f.gap,
          onTrack: f.onTrack,
          mainCause: f.onTrack ? null : f.mainCause,
          explain: f.explain,
        },
        shiftOutput: { done: kpis.done, plan: cfg.shiftPlan, planToNow: kpis.planToNow },
        oee: { value: kpis.oee.value, norm: cfg.oeeNorm, availability: kpis.oee.availability, performance: kpis.oee.performance, quality: kpis.oee.quality },
        defects: {
          pct: kpis.defects.pct,
          norm: cfg.defectNorm,
          defects: kpis.defects.defects,
          inspected: kpis.defects.inspected,
          worst: kpis.defects.worst ? { area: kpis.defects.worst.area, pct: kpis.defects.worst.share } : null,
        },
      },
      areas,
      buffers: this.plant.buffers.map((b) => ({ id: b.id, count: Math.min(counts[b.id] ?? 0, b.capacity), capacity: b.capacity })),
      attention,
      attentionTotal: open.length,
      timeline: { segments, marks },
      dataNote: st.plcConnected(now) ? null : 'Данные с контроллеров не подключены — двойник оценивает состояние по 1С:MES',
    };
  }

  /** Паспорт автомобиля по VIN (события кузова — из журнала шлюза) */
  /** Кузова в цехе для сцены и «Панели» */
  bodies(now: number) {
    return this.state.tracker.views(now);
  }

  /** Кузов по номеру или VIN: маршрут, история, флаги */
  body(idOrVin: string, now: number) {
    const b = this.state.tracker.find(idOrVin);
    return b ? this.state.tracker.detail(b, now) : null;
  }

  passport(vin: string, events: Ev[], now: number) {
    return buildPassport(this.state, vin, events, this.cfg, now);
  }

  /** Качество: брак по участкам за смену и неделю, топ дефектов, закономерности */
  qualityOverview(now: number) {
    const st = this.state;
    const shift = shiftAt(now);
    const kpis = shiftKpis(st, now, this.cfg, shift);
    const today = plantParts(now).date;
    const weekFrom = new Date(Date.parse(`${today}T12:00:00+05:00`) - 6 * 86_400_000).toISOString().slice(0, 10);
    const areas = qualityStages(this.plant).map((stage) => {
      const area = stage.id;
      let produced = 0;
      let defects = 0;
      for (const q of st.quality.values()) {
        if (q.area !== area || q.date < weekFrom || q.date > today) continue;
        produced += q.produced;
        defects += q.defects;
      }
      // текущая смена ещё не попала в итог QLS — добавляем живые данные
      const live = kpis.defects.byArea[area];
      if (live && shift) {
        produced += live.inspected;
        defects += live.defects;
      }
      return {
        area,
        name: stage.short,
        shiftPct: live && live.inspected > 0 ? live.defects / live.inspected : 0,
        weekPct: produced > 0 ? defects / produced : 0,
        shiftDefects: live?.defects ?? 0,
      };
    });
    const counts = new Map<string, { defect: string; name: string; area: AreaId; count: number }>();
    for (const n of st.nc) {
      if (n.ts < now - 24 * 3600_000 || n.ts > now) continue;
      const k = n.defect;
      const c = counts.get(k) ?? { defect: k, name: DEFECT_BY_ID[k]?.name ?? k, area: n.responsible, count: 0 };
      c.count += n.count;
      counts.set(k, c);
    }
    const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
    const cause = paintFilterCause(st, now, this.cfg, 16 * 60);
    const causeGen = cause ? inflect(cause.equipmentName, 'gen') : '';
    const causeAcc = cause ? inflect(cause.equipmentName, 'acc') : '';
    const recent = [...st.nc]
      .filter((n) => n.vin)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6)
      .map((n) => ({ vin: n.vin!, defect: DEFECT_BY_ID[n.defect]?.name ?? n.defect, at: toPlantIso(n.ts) }));
    const lastVins = [...st.passes]
      .filter((p) => st.isFinishPass(p))
      .slice(-3)
      .reverse()
      .map((p) => p.vin);
    return {
      norm: this.cfg.defectNorm,
      areas,
      top,
      pattern: cause
        ? {
            text: `Сорность растёт, когда перепад на фильтре ${causeGen} выше ${cause.threshold} Па`,
            sentence: cause.sentence,
            lift: cause.lift,
            rateAbove: cause.rateAbove,
            rateBelow: cause.rateBelow,
            explain: {
              rule: `Для каждого кузова с сорностью берём перепад на фильтре ${causeGen} в момент его прохода (VIN из 1С:MES, время и значение — из контроллера) и сравниваем долю брака выше и ниже порога.`,
              inputs: [
                { label: 'Кузова с сорностью', value: `${cause.defectsTotal}, из них выше порога — ${cause.defectsAbove}`, source: 'qls' as const },
                { label: `Кузова через ${causeAcc}`, value: `выше порога ${cause.bodiesAbove}, ниже — ${cause.bodiesBelow}`, source: 'mes' as const },
                { label: 'Перепад на фильтре', value: `порог ${cause.threshold} Па, норма до ${this.cfg.filter.normPa}`, source: 'plc' as const },
              ],
              sources: ['qls', 'mes', 'plc'] as ('qls' | 'mes' | 'plc')[],
              conclusion: cause.sentence,
              assumptions: ['Сила связи — отношение долей брака выше и ниже порога; на старте это правило и статистика, модели дообучаются на истории завода в ходе пилота.'],
            },
          }
        : null,
      plcConnected: st.plcConnected(now),
      recent,
      lastVins,
    };
  }

  /** Противоречия в данных (раздел 3.2) */
  checks() {
    return dataChecks(this.state, this.cfg);
  }

  /** Панель участка: что происходит, откуда знаем, оборудование, график, инциденты */
  areaDetail(area: AreaId, now: number) {
    const st = this.state;
    const cfg = this.cfg;
    const shift = shiftAt(now) ?? null;
    const ev = this.evals[area];
    const stage = this.plant.stageById.get(area);
    const equipment = (stage?.equipment ?? []).filter((e) => !e.passive).map((e) => {
      const s = st.eq[e.id]!;
      const interval = e.type.serviceIntervalCycles;
      const cyc = interval ? robotCycles(st, e.id, now) : null;
      const plc = st.plcConnected(now);
      // данных по этому оборудованию ещё не было (не подключено) — состояния не знаем
      const known = plc && s.lastPlcTs !== null;
      return {
        id: e.id,
        name: e.name,
        status: known ? (s.status ?? 'run') : null,
        code: known ? s.code : undefined,
        text: known ? s.text : undefined,
        resourceLeft: interval && cyc ? Math.max(0, 1 - cyc.cycles / interval) : null,
        cycles: cyc?.cycles ?? null,
        interval: interval ?? null,
        cyclesSource: cyc?.source ?? null,
        dp: e.type.fields.includes('filterDpPa') ? st.valueAt(e.id, 'filter_dp_pa', now) : null,
      };
    });
    // График за смену: окраска — брак по часам, остальные — выпуск по часам с нормой 15 в час
    const chart: { hour: string; value: number; norm: number }[] = [];
    let chartKind: 'defects' | 'output' = stage?.kind === 'painting' ? 'defects' : 'output';
    const counted = !!stage?.producing;
    if (shift) {
      for (let h = shift.startMs; h < Math.min(now, shift.endMs); h += 3600_000) {
        const to = Math.min(h + 3600_000, now);
        const label = `${String(plantParts(h).hour).padStart(2, '0')}:00`;
        if (chartKind === 'defects') {
          const w = qualityWindow(st, area, h, to);
          chart.push({ hour: label, value: Math.round(w.share * 1000) / 10, norm: cfg.defectNorm * 100 });
        } else {
          const n = counted ? st.passes.filter((p) => p.kind === 'exit' && p.area === area && p.ts >= h && p.ts < to).length : 0;
          chart.push({ hour: label, value: n, norm: Math.round((60 / cfg.taktMin) * ((to - h) / 3600_000)) });
        }
      }
    }
    if (!stage?.producing) chartKind = 'output';
    const incidents = this.book
      .all()
      .filter((i) => i.area === area)
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, 3)
      .map((i) => ({ id: i.id, title: i.title, status: i.status, openedAt: toPlantIso(i.openedAt), tone: i.tone }));
    const clip = [...st.camera].reverse().find((c) => c.area === area && c.clipUrl && now - c.ts < 8 * 3600_000);
    const stock =
      stage?.kind === 'warehouse_in'
        ? KITS.map((k) => {
            const s = st.stock.get(k.id);
            return { kitId: k.id, name: k.name, qty: s?.qty ?? null, shiftsLeft: s?.shiftsLeft ?? null };
          })
        : undefined;
    return {
      area,
      name: stage?.name ?? area,
      status: ev?.status ?? (shift ? 'running' : 'idle'),
      reason: ev?.reason ?? null,
      since: ev?.since ? toPlantIso(ev.since) : null,
      summary: summarize(stage?.short ?? area, ev),
      rule: ev?.rule ?? null,
      signals: (ev?.signals ?? []).map((s) => ({ ...s, ts: toPlantIso(s.ts) })),
      equipment,
      chartKind,
      chart,
      incidents,
      clip: clip ? { url: clip.clipUrl!, at: toPlantIso(clip.ts) } : null,
      plcConnected: st.plcConnected(now),
      stock,
      buffers: bufferCounts(st),
    };
  }

  /** Оборудование: ресурс до ТО, риск, лимит простоя критического оборудования */
  equipmentOverview(now: number) {
    const st = this.state;
    const dayStart = plantMs(plantParts(now).date, 0);
    const crit = criticalDowntimeToday(st, now, this.cfg, dayStart);
    const items = this.plant.equipment.filter((e) => e.critical && !e.passive).map((e) => {
      const interval = e.type.serviceIntervalCycles ?? null;
      const cyc = interval ? robotCycles(st, e.id, now) : null;
      const inc = this.book.all().find((i) => i.equipmentId === e.id && i.status !== 'resolved');
      const ratio = interval && cyc ? cyc.cycles / interval : null;
      const errors = st.autoStops.filter((a) => a.equipmentId === e.id && a.from > now - 24 * 3600_000 && a.status === 'fault').length;
      let risk: 'низкий' | 'средний' | 'высокий' = 'низкий';
      if (ratio !== null) risk = ratio >= 0.97 || errors >= 2 ? 'высокий' : ratio >= 0.9 ? 'средний' : 'низкий';
      if (e.type.fields.includes('filterDpPa')) {
        const dp = st.valueAt(e.id, 'filter_dp_pa', now);
        if (dp !== null) risk = dp >= 400 ? 'высокий' : dp >= 300 ? 'средний' : 'низкий';
      }
      if (inc?.type === 'early_warning') risk = 'высокий';
      return {
        id: e.id,
        name: e.name,
        area: e.stageId,
        resourceLeft: ratio !== null ? Math.max(0, 1 - ratio) : null,
        cycles: cyc?.cycles ?? null,
        interval,
        source: cyc?.source ?? null,
        risk,
        errors24h: st.plcConnected(now) ? errors : null,
        dp: e.type.fields.includes('filterDpPa') ? st.valueAt(e.id, 'filter_dp_pa', now) : null,
        recommendation: inc?.options.find((o) => o.recommended)?.title ?? null,
        incidentId: inc?.id ?? null,
      };
    });
    const order = { высокий: 0, средний: 1, низкий: 2 } as const;
    items.sort((a, b) => order[a.risk] - order[b.risk] || (a.resourceLeft ?? 1) - (b.resourceLeft ?? 1));
    return {
      items,
      criticalDowntime: { minutes: Math.round(crit.minutes), limit: this.cfg.criticalDowntimeLimitMin, items: crit.items.map((i) => ({ ...i, from: toPlantIso(i.from), to: toPlantIso(i.to) })) },
      plcConnected: st.plcConnected(now),
      unaccounted: unaccountedLosses(st, now, dayStart),
    };
  }
}

function lowerFirst(s: string | null | undefined): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : '';
}

function summarize(name: string, ev: AreaEval | undefined): string {
  if (!ev) return 'Нет данных';
  switch (ev.status) {
    case 'running':
      return `${name}: кузова идут в такт, отклонений нет.`;
    case 'reduced':
      return `${name} работает не в полную силу: ${lowerFirst(ev.reason) || 'встала часть станций'}.`;
    case 'idle':
      return 'Смена не идёт.';
    case 'starved':
      return `${name} ждёт кузов: ${(lowerFirst(ev.reason) || 'проблема выше по потоку')}.`;
    case 'blocked':
      return `${name} заблокирован: ${(lowerFirst(ev.reason) || 'проблема ниже по потоку')}.`;
    case 'fault':
      return `${name} стоит: ${(lowerFirst(ev.reason) || 'авария')}.`;
    case 'maintenance':
      return `${name}: обслуживание — ${(lowerFirst(ev.reason) || '')}.`;
    case 'degraded_quality':
      return `${name} работает, но с браком выше нормы: ${(lowerFirst(ev.reason) || '')}.`;
  }
}

/** Мощность участков по составу цеха (для сравнения вариантов состава) */
export { plantCapacity, filterBooths };
