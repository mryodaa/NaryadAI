// Изменения состава цеха человеческим языком: «+1 камера окраски», «буфер окраска → сборка: 15 → 20».
// Для полосы изменений в редакторе, комментария к версии и расчёта влияния.
import type { EquipmentConfig, PlantConfig, StageConfig } from './plant-config';
import { CONNECTION_METHOD_DEF } from './equipment-catalog';
import { derivePlant, postsOfConfig, stationNoun } from './plant-model';
import { pluralRu } from './text-ru';
import { MODEL_BY_ID, type ModelId } from './plant';

const modelsText = (m: ModelId[] | null): string => (m && m.length ? m.map((id) => MODEL_BY_ID[id].short).join(', ') : 'любые');
const sameModels = (a: ModelId[] | null, b: ModelId[] | null) => modelsText(a) === modelsText(b);

const allEquipment = (s: StageConfig): EquipmentConfig[] => [...(s.inlet ?? []), ...s.stations.flatMap((st) => st.equipment), ...(s.outlet ?? [])];
const lower = (s: string) => (s.length > 1 && s[1] === s[1]!.toUpperCase() && /[A-ZА-ЯЁ]/.test(s[1]!) ? s : s[0]!.toLowerCase() + s.slice(1));

export function describePlantChanges(before: PlantConfig, after: PlantConfig): string[] {
  const out: string[] = [];
  const a = derivePlant(before);
  const b = derivePlant(after);
  const shortOf = (id: string) => b.stageById.get(id)?.short ?? a.stageById.get(id)?.short ?? id;

  for (const s of b.stages) if (!a.stageById.has(s.id)) out.push(`+ участок «${s.name}»`);
  for (const s of a.stages) if (!b.stageById.has(s.id)) out.push(`− участок «${s.name}»`);
  const orderA = a.stages.filter((s) => b.stageById.has(s.id)).map((s) => s.id).join('|');
  const orderB = b.stages.filter((s) => a.stageById.has(s.id)).map((s) => s.id).join('|');
  if (orderA !== orderB) out.push(`порядок участков: ${b.stages.map((s) => s.short).join(' → ')}`);

  const addedStations = new Set<string>();
  const removedStations = new Set<string>();
  for (const sb of b.stages) {
    const sa = a.stageById.get(sb.id);
    if (!sa) continue;
    if (sa.name !== sb.name) out.push(`участок «${sa.name}» → «${sb.name}»`);
    const diff = sb.stations.length - sa.stations.length;
    if (diff !== 0) {
      const noun = stationNoun(diff > 0 ? sb : sa);
      out.push(`${diff > 0 ? '+' : '−'}${Math.abs(diff)} ${pluralRu(Math.abs(diff), noun)}`);
    }
    const idsA = new Set(sa.stations.map((x) => x.id));
    const idsB = new Set(sb.stations.map((x) => x.id));
    for (const st of sb.stations) if (!idsA.has(st.id)) addedStations.add(st.id);
    for (const st of sa.stations) if (!idsB.has(st.id)) removedStations.add(st.id);
    if (!sameModels(sa.models, sb.models)) out.push(`участок «${sb.name}»: модели — ${modelsText(sb.models)}`);
    for (const st of sb.stations) {
      const was = sa.stations.find((x) => x.id === st.id);
      if (was && !sameModels(was.models, st.models) && sameModels(sa.models, sb.models)) out.push(`«${st.name}»: модели — ${modelsText(st.models)}`);
    }
    const capA = sa.config.bufferAfter?.capacity ?? null;
    const capB = sb.config.bufferAfter?.capacity ?? null;
    const next = sb.bufferAfter?.to ?? sa.bufferAfter?.to;
    if (capA !== capB && next) {
      const label = `буфер ${lower(sb.short)} → ${lower(shortOf(next))}`;
      out.push(capA === null ? `+ ${label}: ${capB}` : capB === null ? `− ${label}` : `${label}: ${capA} → ${capB}`);
    }
  }

  // Оборудование: новое и убранное (кроме того, что пришло или ушло вместе со станцией), изменённое
  const eqA = new Map(a.config.stages.flatMap((s) => allEquipment(s).map((e) => [e.id, e] as const)));
  const eqB = new Map(b.config.stages.flatMap((s) => allEquipment(s).map((e) => [e.id, e] as const)));
  for (const [id, e] of eqB) {
    const was = eqA.get(id);
    const st = b.equipmentById.get(id)?.stationId;
    if (!was) {
      if (!st || !addedStations.has(st)) out.push(`+ ${e.name}`);
      continue;
    }
    if (was.name !== e.name) out.push(`«${was.name}» → «${e.name}»`);
    if (was.critical !== e.critical) out.push(`«${e.name}»: ${e.critical ? 'критичное' : 'не критичное'}`);
    if ((was.cycleTimeSec ?? null) !== (e.cycleTimeSec ?? null)) {
      const ca = a.equipmentById.get(id)?.cycleSec;
      const cb = b.equipmentById.get(id)?.cycleSec;
      if (ca !== cb) out.push(`«${e.name}»: норма цикла ${ca ?? '—'} → ${cb ?? '—'} с`);
    }
    if (was.connection.method !== e.connection.method) out.push(`«${e.name}»: подключение — ${CONNECTION_METHOD_DEF[e.connection.method].label.toLowerCase()}`);
    const pa = postsOfConfig(was).length;
    const pb = postsOfConfig(e).length;
    if (pa !== pb) out.push(`«${e.name}»: постов ${pa} → ${pb}`);
  }
  for (const [id, e] of eqA) {
    if (eqB.has(id)) continue;
    const st = a.equipmentById.get(id)?.stationId;
    if (!st || !removedStations.has(st)) out.push(`− ${e.name}`);
  }
  return out;
}
