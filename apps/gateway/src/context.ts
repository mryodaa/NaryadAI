import type { Db } from './db';
import type { DemoClock } from './clock';
import type { Hub } from './hub';
import type { SourceRegistry } from './sources';
import type { TwinService } from './twin';
import type { MqttBroker } from './mqtt';
import type { FrontHub } from './front';
import type { PlantStore } from './plant';
import type { ConnectionMonitor } from './connections';
import type { Crew } from './crew';

/** Всё, что нужно маршрутам: собирается в index.ts */
export interface Ctx {
  db: Db;
  clock: DemoClock;
  hub: Hub;
  sources: SourceRegistry;
  twin: TwinService;
  front: FrontHub;
  plant: PlantStore;
  connections: ConnectionMonitor;
  /** Рабочее место мастера */
  crew: Crew;
  /** Мастер или руководитель что-то сделали — разослать экранам сразу */
  crewChanged: () => void;
  mqtt: () => MqttBroker | null;
  /** Сброс демонстрации к началу сценария */
  resetRun: (scenario?: import('@allur/contracts').ScenarioId) => void;
}
