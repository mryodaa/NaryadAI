// Состав цеха глазами ядра: какие участки отвечают за качество, по какому участку считается
// выпуск, где проверяют кузова, какие камеры с фильтром, где датчики привода. Всё — из конфигурации.
import { stageOfKind, type PlantEquipment, type PlantModel, type PlantStage } from '@allur/contracts';

/** Участки, за брак которых отвечают по несоответствиям 1С:QLS */
const QUALITY_KINDS = new Set(['welding', 'painting', 'assembly']);

export function qualityStages(plant: PlantModel): PlantStage[] {
  return plant.production.filter((s) => QUALITY_KINDS.has(s.kind));
}

/** Участок, по которому считается выпуск завода и OEE линии: сборка задаёт ритм */
export function outputStage(plant: PlantModel): PlantStage | undefined {
  return stageOfKind(plant, 'assembly') ?? plant.production[plant.production.length - 1];
}

export function nextProduction(plant: PlantModel, stage: PlantStage): PlantStage | undefined {
  const i = plant.production.indexOf(stage);
  return i >= 0 ? plant.production[i + 1] : undefined;
}

/** Где проверяют кузова участка: выход участка = одна проверка. Сборку проверяет ОТК на входе */
export function inspectionPass(plant: PlantModel, stage: PlantStage | undefined): { area: string; kind: 'entry' | 'exit' } | null {
  if (!stage) return null;
  if (stage.kind === 'assembly') {
    const next = nextProduction(plant, stage);
    if (next?.kind === 'inspection') return { area: next.id, kind: 'entry' };
  }
  return { area: stage.id, kind: 'exit' };
}

/** Камеры окраски с фильтром (по участку или по всему цеху) */
export function filterBooths(plant: PlantModel, stageId?: string): PlantEquipment[] {
  return plant.equipment.filter((e) => e.type.fields.includes('filterDpPa') && (!stageId || e.stageId === stageId));
}

/** Оборудование с датчиками тока и вибрации привода (конвейеры) */
export function driveEquipment(plant: PlantModel): PlantEquipment[] {
  return plant.equipment.filter((e) => e.type.fields.includes('motorCurrentA') && e.type.fields.includes('vibrationMmS'));
}

export function stageShort(plant: PlantModel, id: string): string {
  return plant.stageById.get(id)?.short ?? id;
}

export function equipmentName(plant: PlantModel, id: string): string {
  return plant.equipmentById.get(id)?.name ?? id;
}

export function serviceInterval(plant: PlantModel, id: string): number | undefined {
  return plant.equipmentById.get(id)?.type.serviceIntervalCycles;
}

/** Встал ли участок целиком: встало общее оборудование на входе или выходе, или встали все станции */
export function stageStopped(stage: PlantStage, down: Set<string>): boolean {
  if ([...stage.inlet, ...stage.outlet].some((e) => down.has(e.id))) return true;
  return workingStations(stage, down) === 0;
}

/** Сколько станций участка работает: станция стоит, если встало хоть что-то из её оборудования */
export function workingStations(stage: PlantStage, down: Set<string>): number {
  return stage.stations.filter((st) => !st.equipment.some((e) => down.has(e.id))).length;
}
