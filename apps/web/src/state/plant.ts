// Конфигурация завода в интерфейсе: состав цеха приходит по WebSocket (сообщение plant — и при
// подключении, и при каждой новой версии), состояние связи с оборудованием — раз в секунду.
// До первого сообщения — исходный состав, чтобы экраны не мигали.
import { create } from 'zustand';
import { SEED_PLANT, derivePlant, type ConnectionRuntime, type PlantConfig, type PlantModel } from '@allur/contracts/ref';

interface PlantState {
  config: PlantConfig;
  model: PlantModel;
  /** Конфигурация уже пришла от шлюза */
  loaded: boolean;
  /** Связь с оборудованием по коду */
  connections: Record<string, ConnectionRuntime>;
}

export const usePlant = create<PlantState>(() => ({
  config: SEED_PLANT,
  model: derivePlant(SEED_PLANT),
  loaded: false,
  connections: {},
}));

export function setPlantConfig(config: PlantConfig) {
  const cur = usePlant.getState().config;
  // одна и та же версия приходит при каждом переподключении — модель не пересобираем
  if (cur.version === config.version && usePlant.getState().loaded) return;
  usePlant.setState({ config, model: derivePlant(config), loaded: true });
}

export function setConnections(items: ConnectionRuntime[]) {
  usePlant.setState({ connections: Object.fromEntries(items.map((i) => [i.equipmentId, i])) });
}

/** Состав цеха для компонентов */
export function usePlantModel(): PlantModel {
  return usePlant((s) => s.model);
}

/** Короткое имя участка: «ОТК», «Склад ГП» */
export function stageShort(model: PlantModel, id: string): string {
  return model.stageById.get(id)?.short ?? id;
}
