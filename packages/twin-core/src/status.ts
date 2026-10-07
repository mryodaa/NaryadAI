// Статус участка (раздел 9.1). Сначала — что говорит оборудование (если контроллеры подключены),
// затем записи мастера в 1С:MES, затем вывод по проходу VIN и буферам, затем качество.
// Участки, буферы, оборудование и посты — из конфигурации завода. Если встала одна из параллельных
// станций, участок не стоит — он работает с меньшей мощностью («Снижена мощность»).
import { CAMERAS, shiftAt, stationNoun, type AreaId, type AreaStatus, type BufferId, type PlantStage, type SourceId } from '@allur/contracts';
import type { TwinConfig } from './config';
import type { DowntimeRec, TwinState } from './state';
import { equipmentName, stageShort, stageStopped, workingStations } from './plant';
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
  /** Встала часть параллельных станций: сколько работает из скольких */
  stations?: { working: number; total: number };
}

export function bufferCapacity(state: TwinState, id: BufferId): number {
  return state.plant.bufferById.get(id)?.capacity ?? 0;
}

/** Кузова в буфере — по трекеру: кузов вышел с участка и ещё не вошёл на следующий */
export function bufferCounts(state: TwinState): Record<BufferId, number> {
  const plant = state.plant;
  const counts: Record<BufferId, number> = Object.fromEntries(plant.buffers.map((b) => [b.id, 0]));
  for (const b of state.tracker.bodies.values()) {
    const id = b.loc.kind === 'buffer' ? b.loc.bufferId : undefined;
    if (id && id in counts) counts[id] = counts[id]! + 1;
  }
  return counts;
}

/** Кузова в буфере на момент t — по времени выхода с участка и входа на следующий (для тренда буфера) */
export function bufferAt(state: TwinState, id: BufferId, t: number): number {
  const buf = state.plant.bufferById.get(id);
  if (!buf) return 0;
  let n = 0;
  for (const b of state.tracker.bodies.values()) {
    if (b.lastTs < t - 12 * 3600_000) continue;
    const out = b.stageTimes[buf.from]?.out;
    const inn = b.stageTimes[buf.to]?.in;
    if (out !== undefined && out <= t && (inn === undefined || inn > t || inn < out)) n++;
  }
  return n;
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

/** Сколько станций работает, если встало это оборудование (null — встал весь участок) */
function partialStop(stage: PlantStage | undefined, down: Set<string>): { working: number; total: number } | null {
  if (!stage || stage.stations.length < 2 || stageStopped(stage, down)) return null;
  return { working: workingStations(stage, down), total: stage.stations.length };
}

function partialText(stage: PlantStage, p: { working: number; total: number }): string {
  // «из 2 камер окраски» — после «из» родительный падеж множественного числа (станций не больше 12)
  const noun = stationNoun(stage);
  return `работает ${p.working} из ${p.total} ${noun[2]}`;
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

  const plant = state.plant;
  const stage = plant.stageById.get(area);
  const plc = state.plcConnected(now);
  // то, что в стороне от потока (лаборатория, полигон), участок не останавливает
  const eqs = (stage?.equipment ?? []).filter((e) => !e.passive && e.place !== 'side');
  const name = (id: string) => equipmentName(plant, id);

  // 1. Контроллеры: авария или обслуживание
  if (plc) {
    // Микропростои (до 3 минут) не превращаем в «Аварию» — они видны в ленте смены и в неучтённых потерях
    const bad = eqs
      .map((e) => state.eq[e.id])
      .filter((s): s is NonNullable<typeof s> => !!s)
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
      const what = `${name(s.id)}: ${lower(s.text ?? (s.status === 'fault' ? 'авария' : 'обслуживание'))}`;
      const partial = partialStop(stage, new Set(bad.map((x) => x.id)));
      if (stage && partial) {
        return {
          area,
          status: 'reduced',
          reason: `${what} · ${partialText(stage, partial)}`,
          since: s.since,
          signals,
          rule: 'Встала одна из параллельных станций: участок работает, но мощность ниже',
          causeEquipment: s.id,
          stations: partial,
        };
      }
      return {
        area,
        status: s.status === 'fault' ? 'fault' : 'maintenance',
        reason: what,
        since: s.since,
        signals,
        rule: 'Контроллер оборудования сообщил о состоянии — самый точный источник',
        causeEquipment: s.id,
      };
    }
  }

  // 2. Запись о простое в 1С:MES или от мастера
  const opens = openDowntimes(state, area, now);
  const open = opens[0];
  if (open) {
    addMaster(state, area, now, signals);
    addCamera(state, area, open.from, signals);
    addMesGap(state, area, now, cfg, signals);
    // нет деталей у линии под модель — стоит только эта линия; иначе нехватка деталей — участок ждёт
    const station = stage?.stations.find((st) => st.equipment.some((e) => e.id === open.equipmentId));
    const lineOnly = open.category === 'no_parts' && !!station?.models;
    const partial =
      open.category === 'no_parts' && !lineOnly ? null : partialStop(stage, new Set(opens.filter((d) => d.category !== 'no_parts' || lineOnly).map((d) => d.equipmentId)));
    if (stage && partial) {
      return {
        area,
        status: 'reduced',
        reason: `${lineOnly ? station!.name : name(open.equipmentId)}: ${lower(open.reason)} · ${partialText(stage, partial)}`,
        since: open.from,
        signals,
        rule: open.source === 'master' ? 'Мастер зарегистрировал простой одной из параллельных станций' : 'В 1С:MES простой одной из параллельных станций',
        causeEquipment: open.equipmentId,
        stations: partial,
      };
    }
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
    const before = stage?.bufferBefore?.id;
    const after = stage?.bufferAfter?.id;
    signals.push({ source: 'mes', ts: now, text: `1С:MES: ${minutes(gapMin)} нет прохода кузовов (норма — каждые ${cfg.taktMin} мин)` });
    addCamera(state, area, lastPass, signals);
    const since = lastPass + cfg.taktMin * 60_000;
    // Полный буфер после участка — главное ограничение: выпускать некуда
    if (after && (counts[after] ?? 0) >= bufferCapacity(state, after)) {
      signals.push({ source: 'mes', ts: now, text: `1С:MES: буфер после участка полон — ${counts[after]} из ${bufferCapacity(state, after)}` });
      return { area, status: 'blocked', reason: 'Буфер после участка полон', since, signals, rule: 'Нет прохода VIN дольше 3 тактов и буфер после участка полон — проблема ниже по потоку' };
    }
    if (before && (counts[before] ?? 0) === 0) {
      signals.push({ source: 'mes', ts: now, text: `1С:MES: в буфере перед участком 0 кузовов из ${bufferCapacity(state, before)}` });
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

export function areaName(state: TwinState, area: AreaId): string {
  return stageShort(state.plant, area);
}
