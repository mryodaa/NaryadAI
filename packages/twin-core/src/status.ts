// Статус участка (раздел 9.1). Сначала — что говорит оборудование (если контроллеры подключены),
// затем записи мастера в 1С:MES, затем вывод по проходу VIN и буферам, затем качество.
import {
  AREA_BY_ID,
  BUFFERS,
  CAMERAS,
  EQUIPMENT,
  EQUIPMENT_BY_ID,
  shiftAt,
  type AreaId,
  type AreaStatus,
  type BufferId,
  type SourceId,
} from '@allur/contracts';
import type { TwinConfig } from './config';
import type { DowntimeRec, TwinState } from './state';
import { hm, minutes } from './text';

export interface Signal {
  source: SourceId | 'twin';
  ts: number;
  text: string;
  equipmentId?: string;
  code?: string;
  clipUrl?: string;
}

export interface AreaEval {
  area: AreaId;
  status: AreaStatus;
  reason: string | null;
  /** С какого момента длится текущее отклонение */
  since: number | null;
  signals: Signal[];
  /** Какое правило сработало — для «Почему?» */
  rule: string;
  causeEquipment?: string;
}

export const PRODUCING: readonly ('weld' | 'paint' | 'assembly' | 'qc')[] = ['weld', 'paint', 'assembly', 'qc'];
export const LAST_POST: Record<'weld' | 'paint' | 'assembly' | 'qc', string> = { weld: 'WELD-4', paint: 'PAINT-OVEN', assembly: 'ASM-6', qc: 'QC-3' };
export const BUFFER_BEFORE: Partial<Record<AreaId, BufferId>> = { paint: 'weld-paint', assembly: 'paint-assembly', qc: 'assembly-qc' };
export const BUFFER_AFTER: Partial<Record<AreaId, BufferId>> = { weld: 'weld-paint', paint: 'paint-assembly', assembly: 'assembly-qc' };
const BUFFER_UPSTREAM_POST: Record<BufferId, string> = { 'weld-paint': 'WELD-4', 'paint-assembly': 'PAINT-OVEN', 'assembly-qc': 'ASM-6' };

export function bufferCapacity(id: BufferId): number {
  return BUFFERS.find((b) => b.id === id)!.capacity;
}

/** Кузова в буфере — по последнему пройденному посту в 1С:MES */
export function bufferCounts(state: TwinState): Record<BufferId, number> {
  const counts: Record<BufferId, number> = { 'weld-paint': 0, 'paint-assembly': 0, 'assembly-qc': 0 };
  for (const b of state.active.values()) {
    for (const id of Object.keys(BUFFER_UPSTREAM_POST) as BufferId[]) {
      if (b.lastPost === BUFFER_UPSTREAM_POST[id]) {
        if (id === 'paint-assembly' && state.repaintPending.has(b.vin)) break;
        counts[id]++;
        break;
      }
    }
  }
  return counts;
}

const BUFFER_DOWNSTREAM_POST: Record<BufferId, string> = { 'weld-paint': 'PAINT-PRE', 'paint-assembly': 'ASM-1', 'assembly-qc': 'QC-1' };

/** Кузова в буфере на момент t — по истории проходов (для тренда буфера) */
export function bufferAt(state: TwinState, id: BufferId, t: number): number {
  const up = BUFFER_UPSTREAM_POST[id];
  const down = BUFFER_DOWNSTREAM_POST[id];
  let n = 0;
  for (const b of state.bodies.values()) {
    if (b.lastTs < t - 12 * 3600_000) continue;
    let upTs = -1;
    let downTs = -1;
    for (const p of b.passes) {
      if (p.ts > t) continue;
      if (p.post === up && p.ts > upTs) upTs = p.ts;
      if (p.post === down && p.ts > downTs) downTs = p.ts;
    }
    if (upTs >= 0 && downTs < upTs) n++;
  }
  return n;
}

function areaEquipment(area: AreaId) {
  return EQUIPMENT.filter((e) => e.area === area);
}

/** Открытые записи о простое (1С:MES или мастер), относящиеся к участку */
export function openDowntimes(state: TwinState, area: AreaId, now: number): DowntimeRec[] {
  const lastPass = state.lastPassByArea[area] ?? 0;
  const out: DowntimeRec[] = [];
  for (const d of state.downtimes.values()) {
    if (d.area !== area || d.from > now || now - d.from > 12 * 3600_000) continue;
    if (d.to !== null && d.to <= now) continue;
    // мастер забыл закрыть запись, а кузова уже идут — запись устарела
    if (d.to === null && lastPass > d.from + 15 * 60_000 && d.category !== 'no_parts') continue;
    out.push(d);
  }
  return out.sort((a, b) => b.from - a.from);
}

export function evaluateArea(
  state: TwinState,
  area: AreaId,
  now: number,
  cfg: TwinConfig,
  qualityReason?: { text: string; equipmentId?: string; since: number; signals?: Signal[] } | null,
): AreaEval {
  const signals: Signal[] = [];
  const shift = shiftAt(now);
  if (!shift) return { area, status: 'idle', reason: null, since: null, signals, rule: 'Нерабочее время по производственному календарю' };

  const plc = state.plcConnected(now);
  const eqs = areaEquipment(area);
  const name = (id: string) => EQUIPMENT_BY_ID[id]?.name ?? id;

  // 1. Контроллеры: авария или обслуживание
  if (plc) {
    // Микропростои (до 3 минут) не превращаем в «Аварию» — они видны в ленте смены и в неучтённых потерях
    const bad = eqs
      .map((e) => state.eq[e.id]!)
      .filter((s) => (s.status === 'fault' || s.status === 'maintenance') && (s.status === 'maintenance' || now - s.since >= 3 * 60_000))
      .sort((a, b) => (a.status === 'fault' ? -1 : 1) - (b.status === 'fault' ? -1 : 1));
    const s = bad[0];
    if (s) {
      signals.push({
        source: 'plc',
        ts: s.since,
        equipmentId: s.id,
        code: s.code,
        text: `Контроллер ${name(s.id)}: ${s.status === 'fault' ? 'авария' : 'обслуживание'}${s.code ? `, код ${s.code}` : ''}${s.text ? ` — «${s.text}»` : ''}`,
      });
      addCamera(state, area, s.since, signals);
      addMaster(state, area, now, signals);
      addMesGap(state, area, now, cfg, signals);
      return {
        area,
        status: s.status === 'fault' ? 'fault' : 'maintenance',
        reason: `${name(s.id)}: ${lower(s.text ?? (s.status === 'fault' ? 'авария' : 'обслуживание'))}`,
        since: s.since,
        signals,
        rule: 'Контроллер оборудования сообщил о состоянии — самый точный источник',
        causeEquipment: s.id,
      };
    }
  }

  // 2. Запись о простое в 1С:MES или от мастера
  const open = openDowntimes(state, area, now)[0];
  if (open) {
    addMaster(state, area, now, signals);
    addCamera(state, area, open.from, signals);
    addMesGap(state, area, now, cfg, signals);
    const status: AreaStatus = open.category === 'planned' ? 'maintenance' : open.category === 'no_parts' ? 'starved' : 'fault';
    return {
      area,
      status,
      reason: open.category === 'no_parts' ? open.reason : `${name(open.equipmentId)}: ${lower(open.reason)}`,
      since: open.from,
      signals,
      rule: open.source === 'master' ? 'Мастер зарегистрировал простой с телефона' : 'Простой зарегистрирован в 1С:MES',
      causeEquipment: open.equipmentId,
    };
  }

  // 3. Вывод по проходу VIN (1С:MES): нет прохода дольше 3 тактов
  const lastPass = Math.max(state.lastPassByArea[area] ?? 0, shift.startMs, state.runStartMs);
  const gapMin = (now - lastPass) / 60_000;
  const limit = cfg.stopTakts * cfg.taktMin;
  if (gapMin > limit && (now - shift.startMs) / 60_000 > limit) {
    const counts = bufferCounts(state);
    const before = BUFFER_BEFORE[area];
    const after = BUFFER_AFTER[area];
    signals.push({ source: 'mes', ts: now, text: `1С:MES: ${minutes(gapMin)} нет прохода кузовов (норма — каждые ${cfg.taktMin} мин)` });
    addCamera(state, area, lastPass, signals);
    const since = lastPass + cfg.taktMin * 60_000;
    // Полный буфер после участка — главное ограничение: выпускать некуда
    if (after && counts[after] >= bufferCapacity(after)) {
      signals.push({ source: 'mes', ts: now, text: `1С:MES: буфер после участка полон — ${counts[after]} из ${bufferCapacity(after)}` });
      return { area, status: 'blocked', reason: 'Буфер после участка полон', since, signals, rule: 'Нет прохода VIN дольше 3 тактов и буфер после участка полон — проблема ниже по потоку' };
    }
    if (before && counts[before] === 0) {
      signals.push({ source: 'mes', ts: now, text: `1С:MES: в буфере перед участком 0 кузовов из ${bufferCapacity(before)}` });
      return { area, status: 'starved', reason: 'Буфер перед участком пуст', since, signals, rule: 'Нет прохода VIN дольше 3 тактов и буфер перед участком пуст — проблема выше по потоку' };
    }
    return {
      area,
      status: 'fault',
      reason: `Нет прохода кузовов ${minutes(gapMin)}`,
      since,
      signals,
      rule: 'Нет прохода VIN дольше 3 тактов, буфер перед участком не пуст, после — не полон: участок стоит сам',
    };
  }

  // 4. Качество: доля несоответствий за 2 часа выше нормы
  if (qualityReason) {
    return {
      area,
      status: 'degraded_quality',
      reason: qualityReason.text,
      since: qualityReason.since,
      signals: qualityReason.signals ?? signals,
      rule: `Доля несоответствий 1С:QLS по кузовам за 2 часа выше нормы ${Math.round(cfg.defectNorm * 100)}%`,
      causeEquipment: qualityReason.equipmentId,
    };
  }

  return { area, status: 'running', reason: null, since: null, signals, rule: 'Кузова проходят посты в такт, отклонений нет' };
}

function addCamera(state: TwinState, area: AreaId, since: number, signals: Signal[]) {
  const cam = [...state.camera].reverse().find((c) => c.area === area && c.kind === 'line_stopped' && c.ts >= since - 60_000);
  if (cam) {
    const camName = CAMERAS.find((c) => c.id === cam.cameraId)?.name ?? 'Камера';
    signals.push({ source: 'camera', ts: cam.ts, text: `${camName}: линия стоит`, clipUrl: cam.clipUrl });
  }
}

function addMaster(state: TwinState, area: AreaId, now: number, signals: Signal[]) {
  const d = openDowntimes(state, area, now)[0];
  if (!d) return;
  const who = d.source === 'master' ? `Мастер (${d.registeredBy})` : `1С:MES, ${d.registeredBy}`;
  signals.push({ source: d.source, ts: d.registeredAt, equipmentId: d.equipmentId, text: `${who}: «${d.reason}», с ${hm(d.from)}, записано в ${hm(d.registeredAt)}` });
}

function addMesGap(state: TwinState, area: AreaId, now: number, cfg: TwinConfig, signals: Signal[]) {
  const last = state.lastPassByArea[area];
  if (!last) return;
  const gap = (now - last) / 60_000;
  if (gap > cfg.taktMin * 2) signals.push({ source: 'mes', ts: now, text: `1С:MES: ${minutes(gap)} нет прохода кузовов` });
}

function lower(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

export function areaName(area: AreaId): string {
  return AREA_BY_ID[area].short;
}
