import {
  BUFFER_CAPS,
  BUFFER_INIT,
  EQUIPMENT,
  KITS,
  LOSS_CATS,
  MAINT_COST,
  MAINT_MIN,
  MAJOR_REPAIR_MIN,
  MECHANICS,
  REJECT_NORM,
  REWORK_COST,
  SHIFT_LEN,
  STATIONS,
  VIB_CRIT,
  stationIndex,
} from './config';
import { rand } from './rng';
import { assessRisk, topReasons, type Risk } from './model';
import { kitsCoverage, lineAnalysis, lossFor, moneyAtRisk, type LineAnalysis } from './analytics';
import { dur, money, pct } from '../lib/format';
import type {
  Equipment,
  Forced,
  Incident,
  LossCategory,
  Severity,
  SimState,
  Station,
  StationId,
  StopKind,
  WorkOrder,
} from './types';

const emptyLoss = () => Object.fromEntries(LOSS_CATS.map((c) => [c, 0])) as Record<LossCategory, number>;
const emptyRejects = (): Record<StationId, number> => ({ press: 0, weld: 0, paint: 0, assembly: 0, qc: 0 });
const emptyShift = () => ({ run: 0, starved: 0, blocked: 0, down: 0, maint: 0, produced: 0 });

export function createState(seed = 20261005): SimState {
  return {
    t: 0,
    rng: seed,
    seq: 140,
    incSeq: 1,
    stations: STATIONS.map((d) => ({
      id: d.id,
      status: 'run',
      progress: 0,
      downUntil: 0,
      downCause: '',
      downCat: 'Механика',
      downEquip: null,
      downKind: null,
      shift: emptyShift(),
      recent: [],
    })),
    buffers: [...BUFFER_INIT],
    kits: { level: KITS.init, nextAt: KITS.firstAt, nextQty: KITS.qty, expedited: false },
    equipment: EQUIPMENT.map((d) => {
      const vib = d.vib0 ?? d.vibBase;
      return {
        id: d.id,
        name: d.name,
        stationId: d.stationId,
        failCat: d.failCat,
        parts: d.parts,
        action: d.action,
        vib,
        vibBase: d.vibBase,
        drift: d.drift ?? 0,
        temp: d.tempBase,
        tempBase: d.tempBase,
        hours: d.hours,
        maintIntervalH: d.maintIntervalH,
        vibHist: Array(60).fill(vib),
        failed: false,
      };
    }),
    shift: { index: 0, shipped: 0, rejected: 0, lossMin: emptyLoss() },
    rejectsBy: emptyRejects(),
    totalShipped: 0,
    qcRecent: [],
    paintExtra: 0,
    paintDrift: false,
    downtime: [],
    incidents: [],
    orders: [],
    mechanics: MECHANICS.map((m) => ({ ...m, orderId: null })),
    ai: { confirmed: 0, falseAlarm: 0, avoidedRub: 0 },
    bottleneck: 3,
    forecast: false,
    forecastAvail: STATIONS.map(() => 1),
    forecastEvents: [],
    forced: [],
  };
}

export const equip = (s: SimState, id: string) => s.equipment.find((e) => e.id === id)!;
export const stationOf = (s: SimState, id: StationId) => s.stations[stationIndex(id)];

/* ------------------------------------------------------------------ шаг симуляции (1 минута) */

export function step(s: SimState) {
  s.t++;
  if (s.t % SHIFT_LEN === 0) newShift(s);
  for (const f of s.forced) if (f.t === s.t) applyForced(s, f);

  if (s.t >= s.kits.nextAt) {
    s.kits.level = Math.min(KITS.cap, s.kits.level + s.kits.nextQty);
    s.kits.nextAt = s.t + KITS.interval;
    s.kits.nextQty = KITS.qty;
    s.kits.expedited = false;
  }
  if (s.paintDrift) s.paintExtra = Math.min(0.12, s.paintExtra + 0.0025);

  updateEquipment(s);
  updateStations(s);
  produce(s);
  for (const st of s.stations) {
    st.recent.push(st.status);
    if (st.recent.length > 120) st.recent.shift();
  }
  if (!s.forecast) detect(s);
}

function newShift(s: SimState) {
  s.shift = { index: s.shift.index + 1, shipped: 0, rejected: 0, lossMin: emptyLoss() };
  s.rejectsBy = emptyRejects();
  for (const st of s.stations) st.shift = emptyShift();
}

function applyForced(s: SimState, f: Forced) {
  const e = equip(s, f.equipId);
  const st = stationOf(s, e.stationId);
  if (f.kind === 'fail') {
    if (st.status !== 'down') fail(s, e, f.dur);
  } else if (st.status !== 'down' && st.status !== 'maint') {
    startStop(s, st, 'maint', f.dur, `ТО: ${e.name}`, 'Плановое ТО', e.id);
  }
}

function updateEquipment(s: SimState) {
  for (const e of s.equipment) {
    e.hours += 1 / 60;
    const n1 = s.forecast ? 0 : (rand(s) - 0.5) * 0.18;
    if (e.drift > 0) e.vib += e.drift + n1;
    else e.vib += (e.vibBase - e.vib) * 0.03 + n1;
    e.vib = Math.max(0.5, e.vib);
    const n2 = s.forecast ? 0 : (rand(s) - 0.5) * 0.8;
    e.temp = e.tempBase + Math.max(0, e.vib - e.vibBase) * 2.4 + n2;
    e.vibHist.push(e.vib);
    if (e.vibHist.length > 180) e.vibHist.shift();

    const st = stationOf(s, e.stationId);
    if (st.status === 'down' || st.status === 'maint') continue;
    if (e.vib >= VIB_CRIT) {
      if (s.forecast || rand(s) < 0.08) fail(s, e, MAJOR_REPAIR_MIN);
    } else if (!s.forecast && rand(s) < 1 / 12000) {
      fail(s, e, 40 + Math.floor(rand(s) * 40));
    }
  }
}

function updateStations(s: SimState) {
  s.stations.forEach((st, i) => {
    if (st.status === 'down' || st.status === 'maint') {
      if (s.t >= st.downUntil) finishStop(s, st);
      return;
    }
    if (s.forecast) return;
    const d = STATIONS[i];
    if (rand(s) < d.microP) {
      const m = d.micro[Math.floor(rand(s) * d.micro.length)];
      startStop(s, st, 'micro', 3 + Math.floor(rand(s) * 10), m.cause, m.cat, null);
    }
  });
}

function produce(s: SimState) {
  const n = s.stations.length;
  // идём от конца линии к началу, чтобы освободившееся место в буфере было видно в ту же минуту
  for (let i = n - 1; i >= 0; i--) {
    const st = s.stations[i];
    const d = STATIONS[i];
    if (st.status === 'down' || st.status === 'maint') {
      st.shift[st.status]++;
      s.shift.lossMin[st.downCat]++;
      continue;
    }
    const isAsm = d.id === 'assembly';
    const hasInput = () => i === 0 || (s.buffers[i - 1] > 0 && (!isAsm || s.kits.level > 0));
    const hasSpace = () => i === n - 1 || s.buffers[i] < BUFFER_CAPS[i];
    if (!hasInput()) {
      st.status = 'starved';
      st.shift.starved++;
      if (isAsm && s.kits.level <= 0 && s.buffers[i - 1] > 0) s.shift.lossMin['Нет комплектующих']++;
      continue;
    }
    if (!hasSpace()) {
      st.status = 'blocked';
      st.shift.blocked++;
      continue;
    }
    st.status = 'run';
    st.shift.run++;
    st.progress += (s.forecast ? s.forecastAvail[i] : 1) / d.cycle;
    while (st.progress >= 1 && hasInput() && hasSpace()) {
      st.progress -= 1;
      if (i > 0) s.buffers[i - 1]--;
      if (isAsm) s.kits.level--;
      if (i < n - 1) s.buffers[i]++;
      else qcOut(s);
      st.shift.produced++;
    }
    st.progress = Math.min(st.progress, 1.5);
  }
}

function qcOut(s: SimState) {
  const rates = STATIONS.map((d) => d.defectRate + (d.id === 'paint' ? s.paintExtra : 0));
  const p = rates.reduce((a, b) => a + b, 0);
  if (s.forecast) {
    s.shift.shipped += 1 - p;
    s.shift.rejected += p;
    s.totalShipped += 1 - p;
    return;
  }
  if (rand(s) < p) {
    s.shift.rejected++;
    s.qcRecent.push(1);
    let r = rand(s) * p;
    for (let i = 0; i < rates.length; i++) {
      r -= rates[i];
      if (r <= 0) {
        s.rejectsBy[STATIONS[i].id]++;
        break;
      }
    }
  } else {
    s.shift.shipped++;
    s.totalShipped++;
    s.qcRecent.push(0);
  }
  if (s.qcRecent.length > 60) s.qcRecent.shift();
}

/* ------------------------------------------------------------------ остановки */

function startStop(s: SimState, st: Station, kind: StopKind, d: number, cause: string, cat: LossCategory, equipId: string | null) {
  st.status = kind === 'maint' ? 'maint' : 'down';
  st.downUntil = s.t + d;
  st.downKind = kind;
  st.downCause = cause;
  st.downCat = cat;
  st.downEquip = equipId;
  if (s.forecast) return;
  s.downtime.push({ id: s.incSeq++, stationId: st.id, equipId, cause, cat, start: s.t, end: null, source: 'sensor' });
  if (s.downtime.length > 300) s.downtime.shift();
}

function closeDowntime(s: SimState, st: Station) {
  for (let i = s.downtime.length - 1; i >= 0; i--) {
    const ev = s.downtime[i];
    if (ev.stationId === st.id && ev.end === null && ev.source === 'sensor') {
      ev.end = s.t;
      return;
    }
  }
}

function finishStop(s: SimState, st: Station) {
  const kind = st.downKind;
  closeDowntime(s, st);
  if (st.downEquip && (kind === 'maint' || kind === 'failure')) {
    const e = equip(s, st.downEquip);
    e.vib = e.vibBase;
    e.temp = e.tempBase;
    e.drift = 0;
    e.hours = 0;
    e.failed = false;
    if (e.id === 'K-1') {
      s.paintDrift = false;
      s.paintExtra = 0;
    }
    if (!s.forecast) {
      resolveIncident(s, `fail:${e.id}`);
      const o = s.orders.find((x) => x.equipId === e.id && x.status === 'in_progress');
      if (o) {
        o.status = 'review';
        freeMechanic(s, o);
      }
    }
  }
  st.status = 'run';
  st.downKind = null;
  st.downEquip = null;
  st.downCause = '';
}

function fail(s: SimState, e: Equipment, d: number) {
  e.failed = true;
  const st = stationOf(s, e.stationId);
  if (st.status === 'down' || st.status === 'maint') closeDowntime(s, st);
  startStop(s, st, 'failure', d, `Отказ: ${e.name}`, e.failCat, e.id);
  if (s.forecast) {
    s.forecastEvents.push({ t: s.t, equipId: e.id });
    return;
  }
  const la = lineAnalysis(s);
  const idx = stationIndex(e.stationId);
  openIncident(s, {
    key: `fail:${e.id}`,
    sev: 'critical',
    title: `Авария: ${e.name}`,
    text: `${STATIONS[idx].short} остановлена, ремонт ~${dur(d)}. ${
      la.protect[idx] < 1 ? 'Участок — узкое место: каждая минута простоя теряет выпуск' : `Буферы удержат выпуск ${dur(la.protect[idx])}`
    }, ожидаемые потери ≈ ${money(lossFor(la, idx, d))}.`,
    stationId: e.stationId,
    equipId: e.id,
  });
  resolveIncident(s, `risk:${e.id}`);

  let o = openOrderFor(s, e.id);
  if (o && o.status === 'in_progress') return;
  if (!o) {
    o = newOrder(s, {
      kind: 'emergency',
      equipId: e.id,
      stationId: e.stationId,
      title: '',
      action: e.action,
      reasons: ['Аварийная остановка оборудования'],
      parts: e.parts,
      durationMin: d,
      priorityRub: lossFor(la, idx, d),
      deadline: s.t + d,
    });
  } else {
    o.reasons = ['Отказ произошёл до выполнения предиктивного ТО', ...o.reasons];
  }
  o.kind = 'emergency';
  o.title = `Аварийный ремонт: ${e.name}`;
  o.durationMin = d;
  o.status = 'in_progress';
  o.startedAt = s.t;
  if (!o.assignee) pickMechanic(s, o);
}

/* ------------------------------------------------------------------ инциденты и наряды */

function openIncident(s: SimState, x: Pick<Incident, 'key' | 'sev' | 'title' | 'text'> & Partial<Incident>) {
  s.incidents.unshift({
    id: s.incSeq++,
    t: s.t,
    stationId: null,
    equipId: null,
    action: null,
    ...x,
    resolvedAt: x.sev === 'info' ? s.t : null,
  });
  if (s.incidents.length > 60) {
    const i = s.incidents.findLastIndex((z) => z.resolvedAt !== null);
    if (i >= 0) s.incidents.splice(i, 1);
  }
}

const activeIncident = (s: SimState, key: string) => s.incidents.find((i) => i.key === key && i.resolvedAt === null);

function upsertIncident(s: SimState, x: Pick<Incident, 'key' | 'sev' | 'title' | 'text'> & Partial<Incident>) {
  const inc = activeIncident(s, x.key);
  if (inc) {
    inc.sev = x.sev;
    inc.title = x.title;
    inc.text = x.text;
  } else openIncident(s, x);
}

function resolveIncident(s: SimState, key: string) {
  const inc = activeIncident(s, key);
  if (inc) inc.resolvedAt = s.t;
}

export const openOrderFor = (s: SimState, equipId: string) =>
  s.orders.find((o) => o.equipId === equipId && (o.status === 'new' || o.status === 'assigned' || o.status === 'in_progress'));

function newOrder(
  s: SimState,
  x: Pick<WorkOrder, 'kind' | 'equipId' | 'stationId' | 'title' | 'action' | 'reasons' | 'parts' | 'durationMin' | 'priorityRub' | 'deadline'>,
): WorkOrder {
  const o: WorkOrder = {
    ...x,
    id: `НР-${++s.seq}`,
    createdAt: s.t,
    status: 'new',
    assignee: null,
    startedAt: null,
    avoidedRub: 0,
    feedback: null,
  };
  s.orders.unshift(o);
  if (s.orders.length > 40) {
    const i = s.orders.findLastIndex((z) => z.status === 'closed');
    if (i >= 0) s.orders.splice(i, 1);
  }
  return o;
}

function predictiveOrder(s: SimState, e: Equipment, r: Risk, la: LineAnalysis) {
  return newOrder(s, {
    kind: 'predictive',
    equipId: e.id,
    stationId: e.stationId,
    title: `Предиктивное ТО: ${e.name}`,
    action: e.action,
    reasons: topReasons(r),
    parts: e.parts,
    durationMin: MAINT_MIN,
    priorityRub: moneyAtRisk(la, e, r),
    deadline: s.t + (r.ttf != null ? Math.max(30, Math.round(r.ttf * 0.6)) : 240),
  });
}

/** Создать предиктивный наряд вручную (например, из окна «Сравнить решения») */
export function ensureOrder(s: SimState, equipId: string): WorkOrder {
  const existing = openOrderFor(s, equipId);
  if (existing) return existing;
  const e = equip(s, equipId);
  return predictiveOrder(s, e, assessRisk(e), lineAnalysis(s));
}

function pickMechanic(s: SimState, o: WorkOrder, mechId?: string) {
  const role = equip(s, o.equipId).failCat === 'Электрика' ? 'Электрик' : 'Механик';
  const m = mechId
    ? s.mechanics.find((x) => x.id === mechId)
    : (s.mechanics.find((x) => !x.orderId && x.role === role) ?? s.mechanics.find((x) => !x.orderId));
  if (m) {
    m.orderId = o.id;
    o.assignee = m.name;
  } else o.assignee = 'Дежурная бригада';
}

function freeMechanic(s: SimState, o: WorkOrder) {
  for (const m of s.mechanics) if (m.orderId === o.id) m.orderId = null;
}

function detect(s: SimState) {
  const la = lineAnalysis(s);

  for (const e of s.equipment) {
    const key = `risk:${e.id}`;
    const st = stationOf(s, e.stationId);
    if (e.failed || (st.status === 'maint' && st.downEquip === e.id)) continue;
    const r = assessRisk(e);
    if (r.p >= 0.5) {
      const ttfTxt = r.ttf != null ? ` Отказ ожидается через ~${dur(r.ttf)}.` : '';
      upsertIncident(s, {
        key,
        sev: r.p >= 0.8 ? 'serious' : 'warning',
        title: `ИИ-прогноз: риск отказа ${e.name} — ${pct(r.p)}`,
        text: `${topReasons(r, 2).join('; ')}.${ttfTxt}`,
        stationId: e.stationId,
        equipId: e.id,
        action: 'whatif',
      });
      const o = openOrderFor(s, e.id);
      if (!o) predictiveOrder(s, e, r, la);
      else if (o.status === 'new' || o.status === 'assigned') {
        o.priorityRub = moneyAtRisk(la, e, r);
        o.reasons = topReasons(r);
      }
    } else if (r.p < 0.3) resolveIncident(s, key);
  }

  const cover = kitsCoverage(s);
  const toDelivery = s.kits.nextAt - s.t;
  if (cover < 60 && toDelivery > cover) {
    const gap = toDelivery - cover;
    upsertIncident(s, {
      key: 'supply',
      sev: 'serious',
      title: `Дефицит комплектующих: запаса на ${Math.round(cover)} мин`,
      text: s.kits.expedited
        ? `Экстренная поставка запрошена, прибудет через ${dur(toDelivery)}.`
        : `Следующая поставка через ${dur(toDelivery)}. Без действий сборка простоит ~${dur(gap)} (≈ ${money(lossFor(la, 3, gap))}).`,
      stationId: 'assembly',
      action: s.kits.expedited ? null : 'expedite',
    });
  } else resolveIncident(s, 'supply');

  if (s.qcRecent.length >= 40) {
    const rate = s.qcRecent.reduce((a, b) => a + b, 0) / s.qcRecent.length;
    if (rate > REJECT_NORM + 0.01) {
      const ids = Object.keys(s.rejectsBy) as StationId[];
      const top = ids.reduce((a, b) => (s.rejectsBy[b] > s.rejectsBy[a] ? b : a));
      const totalRej = ids.reduce((a, b) => a + s.rejectsBy[b], 0) || 1;
      upsertIncident(s, {
        key: 'quality',
        sev: 'warning',
        title: `Рост брака: ${pct(rate, 1)} на последних ${s.qcRecent.length} авто`,
        text: `Основной источник — ${STATIONS[stationIndex(top)].short} (${pct(s.rejectsBy[top] / totalRej)} дефектов за смену). Норма ≤ ${pct(REJECT_NORM)}.`,
        stationId: top,
      });
      if (s.paintExtra > 0.02 && !openOrderFor(s, 'K-1')) {
        const e = equip(s, 'K-1');
        newOrder(s, {
          kind: 'quality',
          equipId: 'K-1',
          stationId: 'paint',
          title: 'Проверка камеры окраски K-1',
          action: e.action,
          reasons: [
            `Брак ЛКП вырос до ${pct(rate, 1)} (норма ≤ ${pct(REJECT_NORM)})`,
            'Тип дефектов — кратеры и включения: характерно для повышенной влажности',
            'Корреляция с влажностью в камере: +18% за 40 мин',
          ],
          parts: e.parts,
          durationMin: 25,
          priorityRub: s.paintExtra * la.lineRate * 240 * REWORK_COST,
          deadline: s.t + 60,
        });
      }
    } else if (rate < REJECT_NORM - 0.005) resolveIncident(s, 'quality');
  }

  if (la.bottleneck !== s.bottleneck) {
    if (s.t > 5)
      openIncident(s, {
        key: `bn:${s.t}`,
        sev: 'info',
        title: `Узкое место сместилось: ${STATIONS[s.bottleneck].short} → ${STATIONS[la.bottleneck].short}`,
        text: `Темп линии теперь задаёт «${STATIONS[la.bottleneck].name}» — ${Math.round(la.lineRate * 60)} авто/ч.`,
        stationId: STATIONS[la.bottleneck].id,
      });
    s.bottleneck = la.bottleneck;
  }
}

/* ------------------------------------------------------------------ действия пользователя */

export function assignOrder(s: SimState, id: string, mechId?: string) {
  const o = s.orders.find((x) => x.id === id);
  if (!o || o.status !== 'new') return;
  pickMechanic(s, o, mechId);
  o.status = 'assigned';
}

/** Запуск ТО: участок останавливается, деградация оборудования сбрасывается по завершении */
export function startOrder(s: SimState, id: string): boolean {
  const o = s.orders.find((x) => x.id === id);
  if (!o || (o.status !== 'new' && o.status !== 'assigned')) return false;
  const e = equip(s, o.equipId);
  const st = stationOf(s, e.stationId);
  if (st.status === 'maint' || (st.status === 'down' && st.downKind === 'failure')) return false;
  if (o.status === 'new') assignOrder(s, id);
  if (st.status === 'down') closeDowntime(s, st);

  const la = lineAnalysis(s);
  const idx = stationIndex(e.stationId);
  const doNothing = o.kind === 'quality' ? o.priorityRub : moneyAtRisk(la, e, assessRisk(e));
  const doNow = lossFor(la, idx, o.durationMin) + MAINT_COST;
  o.avoidedRub = Math.max(0, doNothing - doNow);
  o.status = 'in_progress';
  o.startedAt = s.t;
  startStop(s, st, 'maint', o.durationMin, `ТО: ${e.name} (${o.id})`, 'Плановое ТО', e.id);
  return true;
}

export function feedbackOrder(s: SimState, id: string, confirmed: boolean) {
  const o = s.orders.find((x) => x.id === id);
  if (!o || o.status !== 'review') return;
  o.status = 'closed';
  freeMechanic(s, o);
  if (o.kind === 'emergency') return;
  o.feedback = confirmed ? 'confirmed' : 'false';
  if (confirmed) {
    s.ai.confirmed++;
    s.ai.avoidedRub += o.avoidedRub;
  } else s.ai.falseAlarm++;
}

export function expediteSupply(s: SimState) {
  if (s.kits.nextAt - s.t > 30) s.kits.nextAt = s.t + 30;
  s.kits.nextQty = Math.max(s.kits.nextQty, 80);
  s.kits.expedited = true;
  const inc = activeIncident(s, 'supply');
  if (inc) {
    inc.action = null;
    inc.text = 'Экстренная поставка запрошена, прибудет через 30 мин.';
  }
}

export function addJournalLoss(s: SimState, stationId: StationId, cause: string, cat: LossCategory, minutes: number, start: number) {
  s.shift.lossMin[cat] += minutes;
  s.downtime.push({ id: s.incSeq++, stationId, equipId: null, cause, cat, start, end: start + minutes, source: 'journal' });
}

export type ScenarioId = 'press' | 'supply' | 'paint' | 'failure';

export function applyScenario(s: SimState, id: ScenarioId) {
  if (id === 'press') {
    const e = equip(s, 'P-2');
    e.drift = 0.035;
    e.hours = Math.max(e.hours, 1150);
  }
  if (id === 'supply') {
    s.kits.level = Math.min(s.kits.level, 55);
    s.kits.nextAt = s.t + 160;
    s.kits.nextQty = KITS.qty;
    s.kits.expedited = false;
    openIncident(s, {
      key: `log:${s.t}`,
      sev: 'info',
      title: 'Логистика: поставщик сообщил о задержке фуры (~2,5 ч)',
      text: 'Данные из системы поставщика (ETA). Двойник пересчитал покрытие склада.',
      stationId: 'assembly',
    });
  }
  if (id === 'paint') s.paintDrift = true;
  if (id === 'failure') {
    const e = equip(s, 'R-14');
    if (!e.failed) fail(s, e, 55);
  }
}
