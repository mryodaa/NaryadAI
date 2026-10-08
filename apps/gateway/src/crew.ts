// Рабочее место мастера: сигналы из инцидентов двойника, ответы мастера, журнал смены.
// Мастер ничего не обязан нажимать: неотвеченный сигнал остаётся «не проверено», а то, что
// разрешилось само (оборудование снова работает), закрывается само. Состояние — в памяти прогона:
// шлюз при старте и сбросе демо начинает смену заново.
import {
  CHECKPOINTS,
  DEFECT_BY_ID,
  NO_REASON_RU,
  shiftAt,
  toPlantIso,
  type CrewSignal,
  type CrewView,
  type LogEntry,
  type LogEntryRequest,
  type NoReason,
  type PastCase,
  type PlantModel,
  type ShiftClose,
  type ShiftSummary,
  type CrewShiftView,
  type StopReason,
  type SignalKind,
  type SourceId,
} from '@allur/contracts';
import type { Incident } from '@allur/twin-core';
import type { TwinService } from './twin';
import type { RequestDesk } from './requests';

const SOURCE_WORD: Partial<Record<SourceId, string>> = {
  plc: 'контроллер',
  mes: 'MES',
  camera: 'видеокамера',
  qls: 'QLS',
  wms: 'WMS',
  erp: 'ERP',
  master: 'мастер',
  import: 'файл',
};

/** Причина из записи 1С:MES → причина мастера в одно касание */
const MES_REASON: Partial<Record<string, StopReason>> = {
  breakdown: 'breakdown',
  setup: 'setup',
  no_parts: 'no_parts',
  quality: 'quality',
  other: 'other',
  waiting: 'other',
};

/** Решение 1С:QLS по кузову → решение мастера; «доработка» — решает мастер */
const QLS_DECISION: Partial<Record<string, LogEntry['decision']>> = {
  repaint: 'repaint',
  scrap: 'to_qc',
};

/** Одна и та же остановка из разных источников (контроллер, MES, сигнал) — одна запись */
const SAME_STOP_MS = 10 * 60_000;
/** Простои короче — микропростои, в журнал не идут */
const MIN_STOP_MS = 3 * 60_000;

export type AnswerResult = { ok: true; signal: CrewSignal; entry?: LogEntry } | { ok: false; status: number; message: string };

export class Crew {
  private signals = new Map<string, CrewSignal>();
  private log: LogEntry[] = [];
  private seq = 0;
  /** Записи, собранные из данных цеха: ключ источника → запись журнала */
  private autoKeys = new Map<string, string>();
  private lastJournal = 0;
  /** Сданные смены: мастером («Сдать смену») или сами по времени */
  private closes: ShiftClose[] = [];
  private lastShift: { key: string; startMs: number; endMs: number } | null = null;

  constructor(
    private twin: TwinService,
    private plant: () => PlantModel,
    readonly desk: RequestDesk,
  ) {}

  reset() {
    this.signals.clear();
    this.log = [];
    this.seq = 0;
    this.autoKeys.clear();
    this.lastJournal = 0;
    this.closes = [];
    this.lastShift = null;
    this.desk.reset();
  }

  /** Сигналы — из инцидентов двойника по остановкам и браку; разрешившиеся сами — закрываем */
  sync(now: number) {
    this.syncJournal(now);
    this.autoClose(now);
    for (const inc of this.twin.checkableIncidents()) {
      const sig = this.signals.get(inc.id);
      if (inc.status === 'resolved') {
        if (sig && (sig.status === 'open' || sig.status === 'later')) {
          sig.status = 'cleared';
          sig.closedAt = toPlantIso(inc.resolvedAt ?? now);
        }
        // запись журнала по сигналу получает время окончания
        for (const e of this.log) if (e.incidentId === inc.id && !e.to && e.kind === 'downtime') e.to = toPlantIso(inc.resolvedAt ?? now);
        continue;
      }
      if (!sig) {
        // простой записал сам мастер — проверять нечего
        if (inc.check === 'confirmed' && !inc.verdict) continue;
        if (inc.check === 'rejected') continue;
        const fresh: CrewSignal = { ...this.describe(inc, now), openedAt: toPlantIso(inc.openedAt), status: 'open' };
        // То же событие другими словами (запись MES о той же остановке пришла позже): мастер уже ответил —
        // второй раз не спрашиваем, ответ переносим
        const same = this.answeredTwin(fresh);
        if (same) {
          Object.assign(fresh, { status: same.status, noReason: same.noReason, answeredBy: same.answeredBy, closedAt: same.closedAt });
          if (same.status === 'yes' || same.status === 'no') {
            this.twin.setVerdict(inc.key, { verdict: same.status, reason: same.noReason, by: same.answeredBy, at: now });
          }
        }
        this.signals.set(inc.id, fresh);
      } else if (sig.status === 'open' || sig.status === 'later' || sig.status === 'yes') {
        Object.assign(sig, this.describe(inc, now));
      }
    }
  }

  /** Сигнал о том же: тот же участок и оборудование, начало в пределах 20 минут, мастер уже ответил */
  private answeredTwin(s: CrewSignal): CrewSignal | null {
    const t = Date.parse(s.since);
    for (const o of this.signals.values()) {
      if (o.status !== 'yes' && o.status !== 'no') continue;
      if (o.area !== s.area || o.kind !== s.kind || (o.equipmentId ?? '') !== (s.equipmentId ?? '')) continue;
      if (Math.abs(Date.parse(o.since) - t) <= 20 * 60_000) return o;
    }
    return null;
  }

  private describe(inc: Incident, now: number): Omit<CrewSignal, 'openedAt' | 'status'> {
    const model = this.plant();
    const since = inc.happened.at;
    const minutes = Math.max(0, Math.round((now - since) / 60_000));
    const kind: SignalKind = inc.type === 'quality' ? 'quality' : inc.tone === 'waiting' ? 'waiting' : inc.equipmentId ? 'stop' : 'no_flow';
    const sources = inc.checkSources ?? [];
    const eqName = inc.equipmentId ? (model.equipmentById.get(inc.equipmentId)?.name ?? inc.equipmentId) : '';
    const areaShort = model.stageById.get(inc.area)?.short ?? inc.area;
    const what =
      kind === 'stop'
        ? `${eqName} стоит с ${hm(since)}`
        : kind === 'no_flow'
          ? `нет кузовов через участок «${areaShort}» ${minutes} мин`
          : lowerFirst(inc.title);
    const words = sources.map((s) => SOURCE_WORD[s] ?? s);
    const who = words.length === 1 ? `только ${words[0]}` : words.length > 1 ? `${words.slice(0, -1).join(', ')} и ${words[words.length - 1]}` : '';
    return {
      signalId: inc.id,
      incidentId: inc.id,
      area: inc.area,
      equipmentId: inc.equipmentId,
      text: `Похоже, ${what}${who ? ` · ${who}` : ''}`,
      title: inc.title,
      kind,
      since: toPlantIso(since),
      minutes,
      sources,
      probable: sources.length >= 2,
    };
  }

  answer(signalId: string, action: 'yes' | 'no' | 'later', noReason: NoReason | undefined, by: string | undefined, now: number): AnswerResult {
    const sig = this.signals.get(signalId);
    if (!sig) return { ok: false, status: 404, message: 'Сигнал не найден' };
    if (sig.status !== 'open' && sig.status !== 'later') {
      return { ok: false, status: 409, message: sig.status === 'cleared' ? 'Ситуация уже разрешилась сама' : 'На этот сигнал уже ответили' };
    }
    const inc = this.twin.incident(sig.incidentId);
    const who = by ?? 'Мастер участка';
    if (action === 'later') {
      sig.status = 'later';
      sig.laterAt = toPlantIso(now);
      return { ok: true, signal: sig };
    }
    sig.answeredBy = who;
    if (action === 'no') {
      sig.status = 'no';
      sig.noReason = noReason ?? 'other';
      sig.closedAt = toPlantIso(now);
      if (inc) this.twin.setVerdict(inc.key, { verdict: 'no', reason: sig.noReason, by: who, at: now });
      // запись, собранная из данных контроллера или MES по этому сигналу, больше не простой
      const from = Date.parse(sig.since);
      this.log = this.log.filter(
        (e) =>
          !(
            (e.origin === 'plc' || e.origin === 'mes') &&
            e.kind === 'downtime' &&
            e.area === sig.area &&
            (e.equipmentId ?? '') === (sig.equipmentId ?? '') &&
            !!e.from &&
            Math.abs(Date.parse(e.from) - from) <= SAME_STOP_MS &&
            !e.comment &&
            !e.needHelp
          ),
      );
      return { ok: true, signal: sig };
    }
    sig.status = 'yes';
    if (inc) this.twin.setVerdict(inc.key, { verdict: 'yes', by: who, at: now });
    // брак — не простой: подтверждаем, записи простоя не открываем
    if (sig.kind === 'quality') return { ok: true, signal: sig };
    // запись об этой остановке уже собрана из данных контроллера или MES — открываем её же
    const same = this.findSameStop(sig.area, sig.equipmentId, Date.parse(sig.since));
    if (same) {
      same.signalId ??= sig.signalId;
      same.incidentId ??= sig.incidentId;
      same.code ??= inc?.signals.find((s) => s.code)?.code;
      return { ok: true, signal: sig, entry: same };
    }
    // «Да» сразу открывает запись журнала: что, где, с какого времени уже заполнено
    const entry = this.addEntry(
      {
        kind: 'downtime',
        area: sig.area,
        signalId: sig.signalId,
        incidentId: sig.incidentId,
        equipmentId: sig.equipmentId,
        from: sig.since,
        facts: inc ? factsOf(inc) : sig.text,
        code: inc?.signals.find((s) => s.code)?.code,
        needHelp: false,
        origin: 'signal',
        by: who,
      },
      now,
    );
    return { ok: true, signal: sig, entry };
  }

  private findSameStop(area: string, equipmentId: string | undefined, from: number): LogEntry | undefined {
    return this.log.find(
      (e) => e.kind === 'downtime' && e.area === area && (e.equipmentId ?? '') === (equipmentId ?? '') && !!e.from && Math.abs(Date.parse(e.from) - from) <= SAME_STOP_MS,
    );
  }

  /**
   * Журнал смены собирается сам: остановки по контроллеру и записи 1С:MES (от 3 минут, без планового ТО)
   * и брак по кузовам участка из 1С:QLS. Мастеру остаётся причина там, где её никто не записал.
   */
  private syncJournal(now: number) {
    if (Date.now() - this.lastJournal < 1000) return;
    this.lastJournal = Date.now();
    const shift = shiftAt(now);
    if (!shift) return;
    const model = this.plant();
    const production = new Set(model.production.map((s) => s.id));
    const st = this.twin.twin.state;
    const eqName = (id: string) => model.equipmentById.get(id)?.name ?? id;
    // сигнал, который мастер не подтвердил, простоем не считаем
    const rejected = [...this.signals.values()].filter((s) => s.status === 'no');
    const isRejected = (area: string, eq: string | undefined, from: number) =>
      rejected.some((s) => s.area === area && (s.equipmentId ?? '') === (eq ?? '') && Math.abs(Date.parse(s.since) - from) <= SAME_STOP_MS);

    const upsertStop = (key: string, area: string, equipmentId: string, from: number, to: number | null, data: Partial<LogEntry>, origin: LogEntry['origin']) => {
      if (!production.has(area) || from < shift.startMs || from > now) return;
      if ((to ?? now) - from < MIN_STOP_MS) return;
      if (isRejected(area, equipmentId, from)) return;
      const known = this.autoKeys.get(key);
      const entry = (known && this.log.find((e) => e.entryId === known)) || this.findSameStop(area, equipmentId, from);
      if (entry) {
        this.autoKeys.set(key, entry.entryId);
        if (to !== null && !entry.to) entry.to = toPlantIso(to);
        if (data.code && !entry.code) entry.code = data.code;
        // причина из MES — только если мастер ещё не выбрал свою
        if (data.reason && !entry.reason) entry.reason = data.reason;
        return;
      }
      const e = this.addEntry(
        { kind: 'downtime', area, equipmentId, from: toPlantIso(from), to: to !== null ? toPlantIso(to) : undefined, facts: data.facts ?? eqName(equipmentId), code: data.code, reason: data.reason, needHelp: false, origin, by: data.by ?? '' },
        now,
      );
      this.autoKeys.set(key, e.entryId);
    };

    for (const a of st.autoStops) {
      if (a.status !== 'fault') continue;
      upsertStop(`plc:${a.equipmentId}:${a.from}`, a.area, a.equipmentId, a.from, a.to, { facts: `${eqName(a.equipmentId)}: ${a.text ?? 'авария'}`, code: a.code, by: 'Контроллер' }, 'plc');
    }
    for (const d of st.downtimes.values()) {
      if (d.category === 'planned' || d.source === 'master') continue;
      upsertStop(`mes:${d.key}`, d.area, d.equipmentId, d.from, d.to, { facts: `${eqName(d.equipmentId)}: ${d.reason}`, reason: MES_REASON[d.category], by: d.registeredBy }, 'mes');
    }
    // брак по кузову — участку, который его допустил
    for (const n of st.nc) {
      // решения «полировка / перекраска / ОТК» — про окраску; брак сварки и сборки ведёт ОТК
      if (!n.vin || n.ts < shift.startMs || n.ts > now || model.stageById.get(n.responsible)?.kind !== 'painting') continue;
      const key = `qls:${n.vin}:${n.ts}`;
      if (this.autoKeys.has(key)) continue;
      const defect = DEFECT_BY_ID[n.defect]?.name ?? n.defect;
      const cp = CHECKPOINTS.find((c) => c.id === n.checkpoint)?.name ?? n.checkpoint;
      const e = this.addEntry(
        {
          kind: 'defect',
          area: n.responsible,
          vin: n.vin,
          defect: n.defect,
          checkpoint: n.checkpoint,
          from: toPlantIso(n.ts),
          facts: `Кузов …${n.vin.slice(-5)}: ${defect.toLowerCase()}, ${cp.toLowerCase()}`,
          decision: QLS_DECISION[n.decision],
          needHelp: false,
          origin: 'qls',
          by: '1С:QLS',
        },
        now,
      );
      this.autoKeys.set(key, e.entryId);
    }
  }

  /** «Как было раньше»: последние 3 случая с этим оборудованием — из журнала и из записей 1С:MES */
  pastCases(equipmentId: string, excludeEntryId: string | undefined, now: number): PastCase[] {
    const out: (PastCase & { ms: number })[] = [];
    for (const e of this.log) {
      if (e.kind !== 'downtime' || e.equipmentId !== equipmentId || e.entryId === excludeEntryId || !e.from || !e.reason) continue;
      const from = Date.parse(e.from);
      out.push({ ms: from, from: e.from, minutes: Math.round(((e.to ? Date.parse(e.to) : now) - from) / 60_000), reason: e.reason });
    }
    const excluded = excludeEntryId ? this.log.find((e) => e.entryId === excludeEntryId) : undefined;
    const excludedFrom = excluded?.from ? Date.parse(excluded.from) : null;
    for (const d of this.twin.twin.state.downtimes.values()) {
      if (d.equipmentId !== equipmentId || d.category === 'planned' || d.to === null || d.from > now) continue;
      if (excludedFrom !== null && Math.abs(d.from - excludedFrom) <= SAME_STOP_MS) continue;
      if (out.some((o) => Math.abs(o.ms - d.from) <= SAME_STOP_MS)) continue;
      out.push({ ms: d.from, from: toPlantIso(d.from), minutes: Math.round((d.to - d.from) / 60_000), text: d.reason });
    }
    return out
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3)
      .map(({ ms: _ms, ...c }) => c);
  }

  /** Смена кончилась, а мастер не сдал её — закрывается сама, сводка без заметки */
  private autoClose(now: number) {
    const s = shiftAt(now);
    const prev = this.lastShift;
    if (prev && (!s || s.key !== prev.key)) {
      for (const st of this.plant().production) {
        if (this.closes.some((c) => c.area === st.id && c.shift === prev.key)) continue;
        this.closes.push({ area: st.id, shift: prev.key, summary: this.summary(st.id, prev, prev.endMs), auto: true, at: toPlantIso(prev.endMs) });
      }
    }
    this.lastShift = s ? { key: s.key, startMs: s.startMs, endMs: s.endMs } : null;
  }

  /** Сводка смены участка — собирается сама */
  private summary(area: string, shift: { key: string; startMs: number; endMs: number }, now: number): ShiftSummary {
    const end = Math.min(now, shift.endMs);
    const entries = this.log.filter((e) => e.area === area && e.shift === shift.key);
    let downtime = 0;
    for (const e of entries) {
      if (e.kind !== 'downtime' || !e.from) continue;
      const from = Math.max(Date.parse(e.from), shift.startMs);
      const to = Math.min(e.to ? Date.parse(e.to) : end, end);
      if (to > from) downtime += to - from;
    }
    const cfg = this.twin.twin.cfg;
    return {
      done: this.twin.twin.state.stageDone(shift.key, area),
      plan: cfg.shiftPlan,
      downtimeMin: Math.round(downtime / 60_000),
      withoutReason: entries.filter((e) => (e.kind === 'downtime' ? !e.reason : !e.decision)).length,
      openRequests: this.desk.list(now).filter((r) => r.area === area && r.status !== 'done' && r.status !== 'cant').length,
    };
  }

  /** Вкладка «Смена»: выпуск по часам (план и факт), простои, записи без причины, сдача смены */
  shiftView(area: string, now: number): CrewShiftView {
    const s = shiftAt(now);
    const prevClose = [...this.closes].reverse().find((c) => c.area === area && c.note && (!s || c.shift !== s.key));
    const prevNote = prevClose?.note ? { note: prevClose.note, by: prevClose.closedBy, at: prevClose.at } : null;
    if (!s) {
      return { area, shift: null, startsAt: null, endsAt: null, summary: { done: 0, plan: 0, downtimeMin: 0, withoutReason: 0, openRequests: 0 }, hours: [], close: null, prevNote };
    }
    const shift = { key: s.key, startMs: s.startMs, endMs: s.endMs };
    return {
      area,
      shift: s.key,
      startsAt: toPlantIso(s.startMs),
      endsAt: toPlantIso(s.endMs),
      summary: this.summary(area, shift, now),
      hours: this.hours(area, shift, now),
      close: this.closes.find((c) => c.area === area && c.shift === s.key) ?? null,
      prevNote,
    };
  }

  /** Выпуск по часам: план по такту и факт выхода с участка */
  private hours(area: string, s: { startMs: number; endMs: number }, now: number): CrewShiftView['hours'] {
    const takt = this.twin.twin.cfg.taktMin;
    const passes = this.twin.twin.state.passes;
    const hours: CrewShiftView['hours'] = [];
    for (let h = s.startMs; h < Math.min(now, s.endMs); h += 3600_000) {
      const to = Math.min(h + 3600_000, now, s.endMs);
      const fact = passes.filter((p) => p.kind === 'exit' && p.area === area && p.ts >= h && p.ts < to).length;
      hours.push({ hour: toPlantIso(h).slice(11, 16), plan: Math.floor((to - h) / 60_000 / takt), fact });
    }
    return hours;
  }

  /**
   * Для отчётов: смена участка целиком — сводка и выпуск по часам (те же расчёты, что на вкладке «Смена»),
   * записи журнала, сдача смены и заметка прошлой смены. Журнал — в памяти прогона.
   */
  shiftRecord(area: string, shift: { key: string; startMs: number; endMs: number }, now: number) {
    const prev = [...this.closes].reverse().find((c) => c.area === area && c.note && Date.parse(c.at) <= shift.startMs + 60_000 && c.shift !== shift.key);
    return {
      summary: this.summary(area, shift, now),
      hours: this.hours(area, shift, now),
      entries: this.log.filter((e) => e.area === area && e.shift === shift.key),
      close: this.closes.find((c) => c.area === area && c.shift === shift.key) ?? null,
      prevNote: prev?.note ? { note: prev.note, by: prev.closedBy, at: prev.at } : null,
    };
  }

  /** Для отчётов: весь журнал прогона и все сигналы с ответами мастера */
  journal(): readonly LogEntry[] {
    return this.log;
  }

  allSignals(): CrewSignal[] {
    return [...this.signals.values()];
  }

  /** «Сдать смену»: сводка собирается сама, мастер по желанию дописывает одну заметку следующей смене */
  closeShift(area: string, note: string | undefined, by: string | undefined, now: number): { ok: true; close: ShiftClose } | { ok: false; status: number; message: string } {
    const s = shiftAt(now);
    if (!s) return { ok: false, status: 409, message: 'Смена не идёт' };
    if (this.closes.some((c) => c.area === area && c.shift === s.key)) return { ok: false, status: 409, message: 'Смена уже сдана' };
    const close: ShiftClose = {
      area,
      shift: s.key,
      summary: this.summary(area, { key: s.key, startMs: s.startMs, endMs: s.endMs }, now),
      note: note?.trim() || undefined,
      closedBy: by ?? 'Мастер участка',
      auto: false,
      at: toPlantIso(now),
    };
    this.closes.push(close);
    return { ok: true, close };
  }

  /** Руководитель увидел просьбу мастера о помощи */
  ackHelp(entryId: string, now: number): { ok: true; entry: LogEntry } | { ok: false; status: number; message: string } {
    const entry = this.log.find((e) => e.entryId === entryId);
    if (!entry || !entry.needHelp) return { ok: false, status: 404, message: 'Просьба не найдена' };
    entry.helpAckAt = toPlantIso(now);
    return { ok: true, entry };
  }

  private addEntry(e: Omit<LogEntry, 'entryId' | 'shift' | 'at'>, now: number): LogEntry {
    const entry: LogEntry = { ...e, entryId: `log-${++this.seq}`, shift: shiftAt(now)?.key ?? '', at: toPlantIso(now) };
    this.log.push(entry);
    return entry;
  }

  /** Запись журнала: новая («+») или правка — причина в одно касание, остальное по желанию */
  saveEntry(req: LogEntryRequest, now: number): { ok: true; entry: LogEntry } | { ok: false; status: number; message: string } {
    if (req.entryId) {
      const entry = this.log.find((e) => e.entryId === req.entryId);
      if (!entry) return { ok: false, status: 404, message: 'Запись не найдена' };
      if (req.reason) entry.reason = req.reason;
      if (req.decision) entry.decision = req.decision;
      if (req.comment !== undefined) entry.comment = req.comment.trim() || undefined;
      if (req.needHelp !== undefined && req.needHelp !== entry.needHelp) {
        entry.needHelp = req.needHelp;
        entry.helpAt = req.needHelp ? toPlantIso(now) : undefined;
        entry.helpAckAt = undefined;
      }
      if (req.equipmentId) entry.equipmentId = req.equipmentId;
      if (req.from) entry.from = req.from;
      if (req.to) entry.to = req.to;
      entry.at = toPlantIso(now);
      if (req.by) entry.by = req.by;
      return { ok: true, entry };
    }
    const model = this.plant();
    const eqName = req.equipmentId ? (model.equipmentById.get(req.equipmentId)?.name ?? req.equipmentId) : '';
    const entry = this.addEntry(
      {
        kind: req.decision ? 'defect' : 'downtime',
        area: req.area,
        equipmentId: req.equipmentId,
        from: req.from ?? toPlantIso(now),
        to: req.to,
        facts: req.facts ?? (eqName ? `${eqName}: простой` : 'Простой'),
        reason: req.reason,
        decision: req.decision,
        comment: req.comment?.trim() || undefined,
        needHelp: req.needHelp ?? false,
        helpAt: req.needHelp ? toPlantIso(now) : undefined,
        origin: 'master',
        by: req.by ?? 'Мастер участка',
      },
      now,
    );
    return { ok: true, entry };
  }

  view(now: number): CrewView {
    const shift = shiftAt(now);
    const unconfirmed: Partial<Record<SourceId, number>> = {};
    if (shift) {
      for (const s of this.signals.values()) {
        if (s.status !== 'no' || !s.closedAt || Date.parse(s.closedAt) < shift.startMs) continue;
        for (const src of s.sources) unconfirmed[src] = (unconfirmed[src] ?? 0) + 1;
      }
    }
    // закрытые давно — не держим на экране мастера
    const recent = [...this.signals.values()].filter((s) => !s.closedAt || now - Date.parse(s.closedAt) < 60 * 60_000);
    return {
      at: toPlantIso(now),
      signals: recent,
      log: shift ? this.log.filter((e) => e.shift === shift.key) : this.log.slice(-50),
      requests: this.desk.list(now),
      shiftCloses: this.closes.filter((c) => now - Date.parse(c.at) < 24 * 3600_000),
      unconfirmedBySource: unconfirmed,
    };
  }
}

/** Что уже известно о простое: оборудование, причина по контроллеру, код */
function factsOf(inc: Incident): string {
  return inc.happened.text;
}

export function noReasonText(r: NoReason): string {
  return NO_REASON_RU[r];
}

function hm(ms: number): string {
  return toPlantIso(ms).slice(11, 16);
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}
