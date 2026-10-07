// Проверка состава цеха: одни и те же правила в шлюзе и в интерфейсе, сообщения — по-русски.
// Форму (типы полей) проверяет Zod-схема в шлюзе; здесь — смысл: порядок участков, буферы,
// уникальность кодов, лимиты 3D, подходит ли оборудование участку, открытые инциденты.
import type { EquipmentConfig, PlantConfig, PlantIssue } from './plant-config';
import { CONNECTION_METHOD_DEF, EQUIPMENT_TYPES, STAGE_KIND_LABEL, isProductionKind } from './equipment-catalog';
import { MODEL_BY_ID, MODEL_IDS, type ModelId } from './plant';
import { derivePlant, isSideType, postsOfConfig, stageNominal, stationsFor } from './plant-model';
import { pluralRu } from './text-ru';

/** Лимиты, при которых 3D держит темп на обычном ноутбуке */
export const PLANT_LIMITS = { stages: 10, stationsPerStage: 12, equipmentPerStation: 6, sharedPerStage: 8 } as const;

export interface ValidateOptions {
  /** Открытые инциденты по оборудованию: код → { id, title } */
  openIncidents?: Map<string, { id: string; title: string }>;
  /** Применённая сейчас конфигурация — чтобы понять, что удаляется */
  current?: PlantConfig;
  /** План смены, машин: мощность участка ниже — предупреждение */
  shiftPlan?: number;
  /** Модели из плана: для каждой нужна хотя бы одна станция на каждом производственном участке */
  planModels?: readonly ModelId[];
}

export function validatePlant(config: PlantConfig, opts: ValidateOptions = {}): { ok: boolean; errors: PlantIssue[]; warnings: PlantIssue[] } {
  const errors: PlantIssue[] = [];
  const warnings: PlantIssue[] = [];
  const err = (path: string, message: string, ref: Partial<PlantIssue> = {}) => errors.push({ level: 'error', path, message, ...ref });
  const warn = (path: string, message: string, ref: Partial<PlantIssue> = {}) => warnings.push({ level: 'warning', path, message, ...ref });

  const stages = [...config.stages].sort((a, b) => a.order - b.order);
  if (stages.length > PLANT_LIMITS.stages) err('stages', `Участков ${stages.length} — больше ${PLANT_LIMITS.stages}: 3D не потянет такой цех. Объедините участки.`);

  // Склады — по краям потока
  const first = stages[0];
  const last = stages[stages.length - 1];
  if (!first || first.kind !== 'warehouse_in') err('stages', 'Первым по потоку должен идти склад комплектующих.');
  if (!last || last.kind !== 'warehouse_out') err('stages', 'Последним по потоку должен идти склад готовой продукции.');
  if (stages.filter((s) => s.kind === 'warehouse_in').length > 1) err('stages', 'Склад комплектующих может быть только один.');
  if (stages.filter((s) => s.kind === 'warehouse_out').length > 1) err('stages', 'Склад готовой продукции может быть только один.');
  if (!stages.some((s) => isProductionKind(s.kind))) err('stages', 'Нужен хотя бы один производственный участок между складами.');
  const orders = new Set<number>();
  for (const s of stages) {
    if (orders.has(s.order)) err(`stages.${s.id}.order`, `У двух участков одинаковый порядок (${s.order}).`, { stageId: s.id });
    orders.add(s.order);
  }

  // Уникальные коды
  const seen = { stage: new Map<string, string>(), station: new Map<string, string>(), equipment: new Map<string, string>(), post: new Map<string, string>() };
  const names = new Map<string, string>();
  const checkEquipment = (e: EquipmentConfig, stageId: string, stationId: string | undefined, path: string, kind: string, placeLabel: string) => {
    const type = EQUIPMENT_TYPES[e.type];
    const ref = { stageId, stationId, equipmentId: e.id };
    if (seen.equipment.has(e.id)) err(`${path}.id`, `Код оборудования ${e.id} уже занят («${seen.equipment.get(e.id)}»). Коды должны быть уникальны.`, ref);
    else seen.equipment.set(e.id, e.name);
    const n = e.name.trim().toLowerCase();
    if (names.has(n)) warn(`${path}.name`, `Два оборудования называются «${e.name}» — в журналах их легко спутать.`, ref);
    else names.set(n, e.id);
    if (kind !== 'custom' && !type.stages.includes(kind as never)) {
      err(`${path}.type`, `«${type.name}» не ставится на участок вида «${STAGE_KIND_LABEL[kind as keyof typeof STAGE_KIND_LABEL]}».`, ref);
    }
    if (kind === 'custom' && !type.stages.some(isProductionKind)) err(`${path}.type`, `«${type.name}» — складское оборудование, на производственный участок не ставится.`, ref);
    if (placeLabel !== 'station' && type.placement !== 'shared' && type.placement !== 'side') err(path, `«${type.name}» не может быть общим оборудованием участка — поставьте его в станцию.`, ref);
    if (e.cycleTimeSec !== undefined && (e.cycleTimeSec < 10 || e.cycleTimeSec > 3600)) err(`${path}.cycleTimeSec`, `Норма цикла «${e.name}» — ${e.cycleTimeSec} с: допустимо от 10 с до 1 часа.`, ref);
    for (const p of postsOfConfig(e)) {
      if (seen.post.has(p.id)) err(`${path}.posts`, `Пост 1С:MES ${p.id} уже есть у «${seen.post.get(p.id)}». Коды постов должны быть уникальны.`, ref);
      else seen.post.set(p.id, e.name);
    }
    if (!type.methods.includes(e.connection.method)) {
      err(`${path}.connection`, `«${type.name}» нельзя подключить способом «${CONNECTION_METHOD_DEF[e.connection.method].label}».`, ref);
    }
  };

  stages.forEach((s, i) => {
    const path = `stages.${s.id}`;
    if (seen.stage.has(s.id)) err(`${path}.id`, `Код участка ${s.id} повторяется.`, { stageId: s.id });
    seen.stage.set(s.id, s.name);
    const producing = isProductionKind(s.kind);
    const next = stages[i + 1];
    // Буферы: между производственными участками — обязательно, у складов и перед складом ГП — нет
    if (producing && next && isProductionKind(next.kind)) {
      if (!s.bufferAfter) err(`${path}.bufferAfter`, `Между «${s.name}» и «${next.name}» нужен буфер ёмкостью от 1 кузова.`, { stageId: s.id });
    } else if (s.bufferAfter) {
      err(`${path}.bufferAfter`, next ? `После «${s.name}» буфер не нужен: кузов сразу идёт на «${next.name}».` : `После «${s.name}» буфер не нужен.`, { stageId: s.id });
    }
    if (producing && s.stations.length === 0) err(`${path}.stations`, `У участка «${s.name}» нет ни одной станции — кузову негде пройти.`, { stageId: s.id });
    if (s.stations.length > PLANT_LIMITS.stationsPerStage) {
      err(`${path}.stations`, `У «${s.name}» ${s.stations.length} станций — больше ${PLANT_LIMITS.stationsPerStage}: 3D не потянет.`, { stageId: s.id });
    }
    const shared = [...(s.inlet ?? []), ...(s.outlet ?? [])].filter((e) => !isSideType(e));
    if (shared.length > PLANT_LIMITS.sharedPerStage) err(path, `У «${s.name}» слишком много общего оборудования: не больше ${PLANT_LIMITS.sharedPerStage}.`, { stageId: s.id });
    if (!producing && shared.length) err(path, `У склада не бывает общего оборудования на входе и выходе.`, { stageId: s.id });
    (s.inlet ?? []).forEach((e, k) => checkEquipment(e, s.id, undefined, `${path}.inlet.${k}`, s.kind, 'inlet'));
    s.stations.forEach((st, k) => {
      const spath = `${path}.stations.${st.id}`;
      if (seen.station.has(st.id)) err(`${spath}.id`, `Код станции ${st.id} повторяется.`, { stageId: s.id, stationId: st.id });
      seen.station.set(st.id, st.name);
      if (st.equipment.length === 0) err(spath, `Станция «${st.name}» пустая — добавьте оборудование или удалите станцию.`, { stageId: s.id, stationId: st.id });
      const inFlow = st.equipment.filter((e) => !isSideType(e));
      if (producing && st.equipment.length && !inFlow.length) {
        err(spath, `На станции «${st.name}» только оборудование в стороне от потока — кузову негде пройти станцию.`, { stageId: s.id, stationId: st.id });
      }
      if (st.equipment.length > PLANT_LIMITS.equipmentPerStation) {
        err(spath, `На станции «${st.name}» ${st.equipment.length} единиц оборудования — больше ${PLANT_LIMITS.equipmentPerStation}: 3D не потянет. Разделите станцию.`, {
          stageId: s.id,
          stationId: st.id,
        });
      }
      if (producing && st.equipment.length && !st.equipment.some((e) => postsOfConfig(e).length > 0)) {
        err(spath, `На станции «${st.name}» нет поста 1С:MES — двойник не увидит, что кузов её прошёл.`, { stageId: s.id, stationId: st.id });
      }
      if (producing && st.equipment.length && st.equipment.every((e) => EQUIPMENT_TYPES[e.type].cycleTimeSec === null && e.cycleTimeSec === undefined)) {
        warn(spath, `У станции «${st.name}» нет оборудования с тактом — её мощность не посчитать.`, { stageId: s.id, stationId: st.id });
      }
      st.equipment.forEach((e, n) => checkEquipment(e, s.id, st.id, `${spath}.equipment.${n}`, s.kind, 'station'));
      void k;
    });
    (s.outlet ?? []).forEach((e, k) => checkEquipment(e, s.id, undefined, `${path}.outlet.${k}`, s.kind, 'outlet'));
  });

  // Модели и оборудование в стороне от потока — по производной модели цеха
  if (!errors.length) {
    const model = derivePlant(config);
    const plan = opts.planModels ?? MODEL_IDS;
    for (const st of model.production) {
      const path = `stages.${st.id}`;
      for (const station of st.stations) {
        if (station.models && station.models.length === 0) {
          err(`${path}.stations.${station.id}.models`, `Станция «${station.name}» не принимает ни одной модели участка «${st.name}» — проверьте поле «Модели».`, {
            stageId: st.id,
            stationId: station.id,
          });
        }
      }
      for (const m of plan) {
        if (st.stations.length && !stationsFor(st, m).length) {
          err(`${path}.models`, `На участке «${st.name}» нет станции для ${MODEL_BY_ID[m].short} — кузова этой модели не пройдут.`, { stageId: st.id });
        }
      }
      for (const side of st.sides) {
        if (side.after === null) {
          err(`${path}.sides.${side.equipment.id}`, `«${side.equipment.name}» стоит в стороне от потока: поставьте его после оборудования, с которого кузов туда уходит.`, {
            stageId: st.id,
            equipmentId: side.equipment.id,
          });
        }
      }
    }
  }

  // Точки отметки кузова: коды уникальны и не совпадают с постами 1С:MES
  {
    const model = derivePlant(config);
    const used = new Set<string>();
    for (const p of model.points) {
      if (used.has(p.id) || seen.post.has(p.id)) err(`points.${p.id}`, `Код точки отметки ${p.id} уже занят — коды точек и постов должны быть уникальны.`, { stageId: p.stageId, equipmentId: p.equipmentId ?? undefined });
      used.add(p.id);
    }
  }

  // Удаление оборудования с открытым инцидентом
  if (opts.current && opts.openIncidents) {
    const still = new Set(seen.equipment.keys());
    for (const s of opts.current.stages) {
      for (const e of [...(s.inlet ?? []), ...s.stations.flatMap((st) => st.equipment), ...(s.outlet ?? [])]) {
        const inc = opts.openIncidents.get(e.id);
        if (!still.has(e.id) && inc) {
          err(`equipment.${e.id}`, `По «${e.name}» открыт инцидент «${inc.title}». Сначала примите по нему решение; когда двойник закроет инцидент, оборудование можно будет удалить.`, {
            stageId: s.id,
            equipmentId: e.id,
            incidentId: inc.id,
          });
        }
      }
    }
  }

  // Мощность ниже плана смены — не ошибка, но предупреждение
  if (!errors.length && opts.shiftPlan) {
    const model = derivePlant(config);
    for (const st of model.production) {
      const cap = stageNominal(st);
      if (cap && cap.perShift > 0 && cap.perShift < opts.shiftPlan * 0.98) {
        const n = Math.floor(cap.perShift);
        warn(`stages.${st.id}`, `Мощность «${st.name}» по норме цикла — ${n} ${pluralRu(n, ['кузов', 'кузова', 'кузовов'])} в смену, меньше плана смены ${opts.shiftPlan}.`, { stageId: st.id });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
