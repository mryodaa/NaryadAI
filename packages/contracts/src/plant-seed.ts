// Исходная конфигурация (версия 1) — цех по открытым данным о заводе Allur (docs/ALLUR_PROCESS.md):
// три сварочные линии под модели сходятся в общую окраску и сборку. Числа укрупнены, допущения —
// в docs/ASSUMPTIONS.md. Коды участков, буферов, камер окраски и Конвейера-03 — те же, что в
// истории, таблицах организаторов, сценариях и примерах.
import type { ConnectionConfig, EquipmentConfig, IdPointConfig, PlantConfig } from './plant-config';
import { DEFAULT_COLORS } from './identification';

/** В демо данные оборудования даёт имитатор; ступень внедрения решает, какие подключения активны */
const SIM: ConnectionConfig = { method: 'simulator', status: 'not_connected' };
const NONE: ConnectionConfig = { method: 'none', status: 'not_connected' };

const robot = (n: number, post: number, line: string, op: string): EquipmentConfig => ({
  id: `ABB-${String(n).padStart(2, '0')}`,
  type: 'spot_robot',
  name: `Робот ABB-${String(n).padStart(2, '0')}`,
  critical: true,
  posts: [{ id: `WELD-${post}`, name: `${line}: ${op}` }],
  aliases: [`ABB-${String(n).padStart(2, '0')}`, `ABB${String(n).padStart(2, '0')}`],
  connection: SIM,
});

/** Сварочная линия модели: основание, боковины, крыша, навеска и VIN */
const line = (model: 'onix' | 'cobalt' | 'j7', short: string, robots: number[], posts: number[], roof?: EquipmentConfig) => ({
  id: `weld-${model}`,
  name: `Линия ${short}`,
  models: [model],
  equipment: [
    robot(robots[0]!, posts[0]!, `Линия ${short}`, 'основание'),
    robot(robots[1]!, posts[1]!, `Линия ${short}`, 'боковины'),
    roof ?? robot(robots[2]!, posts[2]!, `Линия ${short}`, 'крыша'),
    robot(robots[3]!, posts[3]!, `Линия ${short}`, 'навеска дверей и капота, VIN'),
  ],
});

// 59 постов сборки укрупнены в 11 групп по трём этапам из открытых данных
const ASM_GROUPS: { conv: number; name: string }[] = [
  { conv: 1, name: 'Салон: проводка, посты 1–5' },
  { conv: 1, name: 'Салон: панель приборов, посты 6–10' },
  { conv: 1, name: 'Салон: обивка, посты 11–15' },
  { conv: 1, name: 'Салон: сиденья, посты 16–20' },
  { conv: 2, name: 'Шасси: «свадьба» кузова и шасси, посты 21–27' },
  { conv: 2, name: 'Шасси: подвеска и выпуск, посты 28–34' },
  { conv: 2, name: 'Шасси: колёса, посты 35–40' },
  { conv: 3, name: 'Финальная: стёкла, посты 41–45' },
  { conv: 3, name: 'Финальная: двери, посты 46–50' },
  { conv: 3, name: 'Финальная: программирование блоков, посты 51–55' },
  { conv: 3, name: 'Финальная: заправка жидкостей, посты 56–59' },
];
const asmPosts = (conv: number) => ASM_GROUPS.map((g, i) => ({ ...g, id: `ASM-${i + 1}` })).filter((g) => g.conv === conv).map((g) => ({ id: g.id, name: g.name }));

const conveyor = (n: number, phase: string): EquipmentConfig => ({
  id: `CONV-0${n}`,
  type: 'conveyor',
  name: `Конвейер-0${n}`,
  critical: true,
  posts: asmPosts(n),
  aliases: [`Конвейер-0${n}`, `Конвейер 0${n}`, `Конвейер-${n}`, phase],
  connection: SIM,
});

/** Точки отметки на входе и выходе участков — сканер 1С:MES (ступень 0) */
const STAGE_POINTS: Record<string, { entry?: [string, string]; exit?: [string, string] }> = {
  warehouse: { exit: ['WH-OUT', 'Выдача машинокомплекта на сварку'] },
  weld: { entry: ['WELD-IN', 'Вход сварки: номер кузова'], exit: ['WELD-OUT', 'Выход сварки'] },
  paint: { entry: ['PAINT-IN', 'Вход окраски'], exit: ['PAINT-OUT', 'Выход окраски'] },
  assembly: { entry: ['ASM-IN', 'Вход сборки'], exit: ['ASM-OUT', 'Выход сборки'] },
  qc: { entry: ['QC-IN', 'Вход ОТК'], exit: ['QC-OUT', 'Выход ОТК'] },
  finished: { entry: ['FG-ACCEPT', 'Приёмка на склад готовой продукции'] },
};

const scan = ([id, name]: [string, string]): IdPointConfig => ({ id, name, method: 'mes_scan' });

/**
 * Точки отметки исходного цеха: на входе и выходе участков — сканер 1С:MES; у оборудования сварки
 * и окраски — RFID тележек, у конвейера сборки — трекинг ПЛК (ступень 1); выборочные операции
 * (лаборатория, полировка, полигон) — приём и выдача сканером 1С:MES.
 */
function withPoints(plant: PlantConfig): PlantConfig {
  const eq = (e: EquipmentConfig, kind: string): EquipmentConfig => {
    if (e.type === 'geometry_lab' || e.type === 'polishing' || e.type === 'test_track') return { ...e, idPoint: { id: `${e.id}-SCAN`, name: `${e.name}: приём и выдача`, method: 'mes_scan' } };
    if (e.type === 'conveyor') return { ...e, idPoint: { id: `PLC-${e.id}`, name: `Трекинг ПЛК ${e.name}`, method: 'plc_tracking', connection: SIM } };
    if ((kind === 'welding' || kind === 'painting') && e.type !== 'rack') return { ...e, idPoint: { id: `RFID-${e.id}`, name: `RFID: ${e.name}`, method: 'rfid', connection: SIM } };
    return e;
  };
  return {
    ...plant,
    colors: DEFAULT_COLORS,
    stages: plant.stages.map((st) => {
      const pts = STAGE_POINTS[st.id];
      return {
        ...st,
        ...(pts ? { idPoints: { ...(pts.entry ? { entry: scan(pts.entry) } : {}), ...(pts.exit ? { exit: scan(pts.exit) } : {}) } } : {}),
        ...(st.inlet ? { inlet: st.inlet.map((e) => eq(e, st.kind)) } : {}),
        stations: st.stations.map((x) => ({ ...x, equipment: x.equipment.map((e) => eq(e, st.kind)) })),
        ...(st.outlet ? { outlet: st.outlet.map((e) => eq(e, st.kind)) } : {}),
      };
    }),
  };
}

export const SEED_PLANT: PlantConfig = withPoints({
  id: 'allur-kst',
  name: 'Allur Костанай, линия легковых',
  version: 1,
  updatedAt: '2026-10-01T08:00:00+05:00',
  updatedBy: 'Исходная конфигурация',
  comment: 'Исходный состав цеха по открытым данным',
  stages: [
    {
      id: 'warehouse',
      name: 'Склад машинокомплектов',
      short: 'Склад',
      kind: 'warehouse_in',
      order: 0,
      bufferAfter: null,
      stations: [
        {
          id: 'warehouse-1',
          name: 'Хранение машинокомплектов',
          equipment: [
            { id: 'WH-RACK', type: 'rack', name: 'Стеллажи адресного хранения', critical: false, connection: NONE },
            { id: 'WH-KITS', type: 'container_zone', name: 'Контейнерная площадка', critical: false, connection: NONE },
          ],
        },
      ],
    },
    {
      id: 'weld',
      name: 'Сварка',
      short: 'Сварка',
      kind: 'welding',
      order: 1,
      bufferAfter: { capacity: 12 },
      stations: [
        line('onix', 'Onix', [1, 2, 0, 3], [1, 2, 3, 4], {
          id: 'LASER-01',
          type: 'laser_cell',
          name: 'Лазерная ячейка крыши',
          critical: true,
          posts: [{ id: 'WELD-3', name: 'Линия Onix: крыша, лазерная сварка (8 роботов)' }],
          aliases: ['Лазерная ячейка', 'Лазерная сварка', 'LASER01'],
          connection: SIM,
        }),
        line('cobalt', 'Cobalt', [4, 5, 6, 7], [5, 6, 7, 8]),
        line('j7', 'J7', [8, 9, 10, 11], [9, 10, 11, 12]),
      ],
      outlet: [
        {
          id: 'FINISH-01',
          type: 'weld_finish',
          name: 'Рихтовка и доводка',
          critical: true,
          posts: [{ id: 'WELD-FIN', name: 'Рихтовка и доводка кузова' }],
          aliases: ['Доводка', 'Рихтовка'],
          connection: SIM,
        },
        {
          id: 'GEO-LAB',
          type: 'geometry_lab',
          name: 'Лаборатория геометрии',
          critical: false,
          posts: [
            { id: 'GEO-IN', name: 'Лаборатория геометрии: приём кузова' },
            { id: 'GEO-OUT', name: 'Лаборатория геометрии: возврат в поток' },
          ],
          aliases: ['Лаборатория', 'Геометрия'],
          connection: NONE,
        },
      ],
    },
    {
      id: 'paint',
      name: 'Окраска',
      short: 'Окраска',
      kind: 'painting',
      order: 2,
      bufferAfter: { capacity: 15 },
      inlet: [
        {
          id: 'PRETREAT',
          type: 'pretreatment',
          name: 'Подготовка и катафорез (13 ванн)',
          critical: true,
          posts: [{ id: 'PAINT-PRE', name: 'Подготовка поверхности и катафорез' }],
          aliases: ['Подготовка', 'Подготовка поверхности', 'Катафорез'],
          connection: SIM,
        },
        {
          id: 'OVEN-ED',
          type: 'oven',
          name: 'Печь катафореза',
          critical: true,
          posts: [{ id: 'PAINT-EDO', name: 'Печь катафореза' }],
          aliases: ['Печь КТЛ'],
          connection: SIM,
        },
        {
          id: 'SEALER',
          type: 'sealer',
          name: 'Герметизация швов',
          critical: true,
          posts: [{ id: 'PAINT-SEAL', name: 'Герметизация швов' }],
          aliases: ['Герметизация', 'Мастика'],
          connection: SIM,
        },
        {
          id: 'PRIMER',
          type: 'primer_booth',
          name: 'Камера грунта',
          critical: true,
          posts: [{ id: 'PAINT-PRM', name: 'Вторичный грунт (роботы)' }],
          aliases: ['Грунт', 'Камера грунта'],
          connection: SIM,
        },
      ],
      stations: [
        {
          id: 'paint-1',
          name: 'Камеры окраски: база и лак',
          equipment: [
            {
              id: 'BOOTH-01',
              type: 'paint_booth',
              name: 'Камера-01',
              critical: true,
              posts: [{ id: 'PAINT-B1', name: 'Камера-01: базовая эмаль' }],
              aliases: ['Камера-01', 'Камера 01', 'Камера-1'],
              connection: SIM,
            },
            {
              id: 'BOOTH-02',
              type: 'paint_booth',
              name: 'Камера-02',
              critical: true,
              posts: [{ id: 'PAINT-B2', name: 'Камера-02: лак' }],
              aliases: ['Камера-02', 'Камера 02', 'Камера-2'],
              connection: SIM,
            },
          ],
        },
      ],
      outlet: [
        {
          id: 'OVEN',
          type: 'oven',
          name: 'Сушка',
          critical: true,
          posts: [{ id: 'PAINT-OVEN', name: 'Сушка' }],
          aliases: ['Сушка', 'Печь сушки'],
          connection: SIM,
        },
        {
          id: 'PAINT-INSP',
          type: 'paint_inspection',
          name: 'Контроль покрытия',
          critical: false,
          posts: [{ id: 'PAINT-QC', name: 'Контроль покрытия' }],
          aliases: ['Контроль окраски'],
          connection: SIM,
        },
        {
          id: 'POLISH',
          type: 'polishing',
          name: 'Полировка',
          critical: false,
          posts: [
            { id: 'POLISH-IN', name: 'Полировка: приём кузова' },
            { id: 'POLISH-OUT', name: 'Полировка: возврат в поток' },
          ],
          aliases: ['Полировка'],
          connection: NONE,
        },
      ],
    },
    {
      id: 'assembly',
      name: 'Сборка',
      short: 'Сборка',
      kind: 'assembly',
      order: 3,
      bufferAfter: { capacity: 8 },
      stations: [
        {
          id: 'assembly-1',
          name: 'Главный конвейер: салон, шасси, финальная',
          equipment: [conveyor(1, 'Конвейер салона'), conveyor(2, 'Конвейер шасси'), conveyor(3, 'Конвейер финальной сборки')],
        },
      ],
    },
    {
      id: 'qc',
      name: 'Испытания и ОТК',
      short: 'ОТК',
      kind: 'inspection',
      order: 4,
      bufferAfter: null,
      stations: [
        {
          id: 'qc-1',
          name: 'Линия испытаний и контроля',
          equipment: [
            {
              id: 'QC-TEST',
              type: 'test_line',
              name: 'Испытательная линия',
              critical: false,
              posts: [
                { id: 'QC-4', name: 'Роликовый стенд' },
                { id: 'QC-5', name: 'Развал-схождение' },
                { id: 'QC-6', name: 'Настройка фар' },
              ],
              aliases: ['Испытательная линия', 'Роликовый стенд'],
              connection: SIM,
            },
            {
              id: 'QC-RAIN',
              type: 'rain_test',
              name: 'Водяная камера',
              critical: false,
              posts: [{ id: 'QC-3', name: 'Водяная камера' }],
              aliases: ['Камера герметичности', 'Водяная камера'],
              connection: SIM,
            },
            { id: 'QC-TRACK', type: 'test_track', name: 'Полигон', critical: false, posts: [{ id: 'QC-2', name: 'Полигон' }], aliases: ['Полигон'], connection: SIM },
            {
              id: 'QC-LINE',
              type: 'inspection_post',
              name: 'Финальный осмотр',
              critical: false,
              posts: [{ id: 'QC-1', name: 'Финальный осмотр' }],
              aliases: ['Контроль', 'Линия контроля', 'Финальный осмотр'],
              connection: SIM,
            },
          ],
        },
      ],
    },
    {
      id: 'finished',
      name: 'Склад готовой продукции',
      short: 'Склад ГП',
      kind: 'warehouse_out',
      order: 5,
      bufferAfter: null,
      stations: [
        {
          id: 'finished-1',
          name: 'Приёмка готовых машин',
          equipment: [
            { id: 'FG-PARK', type: 'parking', name: 'Площадка готовых машин', critical: false, posts: [{ id: 'FG-IN', name: 'Приёмка на склад готовой продукции' }], connection: NONE },
            { id: 'FG-RACK', type: 'rack', name: 'Стеллаж склада ГП', critical: false, connection: NONE },
          ],
        },
      ],
    },
  ],
});
