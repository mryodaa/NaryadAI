// Служебные сообщения демонстрации и исходящие наряды двойника.
import { z } from 'zod';
import { AreaIdSchema, EquipmentId, Timestamp } from './events';
import { SCENARIO_IDS } from './scenarios';

export const StageSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]).meta({
  id: 'Stage',
  description: 'Ступень внедрения: 0 — только 1С, 1 — + контроллеры и камеры, 2 — + датчики на критичных узлах',
});

export const DemoClock = z
  .object({
    runId: z.number().int(),
    seed: z.number().int(),
    simTime: z.number().meta({ description: 'Время симуляции, мс от 1970-01-01 UTC' }),
    speed: z.number(),
    paused: z.boolean(),
    stage: StageSchema,
    scenario: z.enum(SCENARIO_IDS),
  })
  .meta({ id: 'DemoClock', description: 'Часы демонстрации (только для имитаторов, не часть контракта интеграции)' });

export type DemoClock = z.infer<typeof DemoClock>;

export const WorkOrderAction = z
  .enum(['replace_filter', 'maintenance', 'repair', 'resequence', 'expedite_parts', 'inspect', 'none'])
  .meta({ id: 'WorkOrderAction' });

export const WorkOrder = z
  .object({
    workOrderId: z.string(),
    incidentId: z.string(),
    action: WorkOrderAction,
    area: AreaIdSchema,
    equipmentId: EquipmentId.optional(),
    title: z.string(),
    scheduledAt: Timestamp.meta({ description: 'Когда выполнить' }),
    durationMin: z.number().min(0).optional(),
    issuedAt: Timestamp,
    issuedBy: z.string().optional(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .meta({ id: 'WorkOrder', description: 'Наряд от двойника в системы завода (в реальном внедрении — 1С:ТОиР или MES)' });

export type WorkOrder = z.infer<typeof WorkOrder>;
