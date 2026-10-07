// Простой цех для тестов ядра: одна линия сварки из 4 роботов, окраска с двумя камерами подряд,
// сборка на одном конвейере, ОТК из трёх постов. Ядро от состава цеха не зависит — проверяем его
// правила на коротком и понятном составе (исходный состав завода проверяется в сквозных тестах).
import type { ConnectionConfig, EquipmentConfig, PlantConfig } from '@allur/contracts';

const SIM: ConnectionConfig = { method: 'simulator', status: 'not_connected' };
const NONE: ConnectionConfig = { method: 'none', status: 'not_connected' };

const robot = (n: number): EquipmentConfig => ({
  id: `ABB-0${n}`,
  type: 'spot_robot',
  name: `Робот ABB-0${n}`,
  critical: true,
  posts: [{ id: `WELD-${n}`, name: `Сварка, пост ${n}` }],
  aliases: [`ABB-0${n}`, `ABB0${n}`],
  connection: SIM,
});

const ASM_POSTS = ['1–10', '11–20', '21–30', '31–40', '41–50', '51–59'].map((range, i) => ({ id: `ASM-${i + 1}`, name: `Сборка, посты ${range}` }));

export const LEGACY_PLANT: PlantConfig = {
  id: 'allur-kst',
  name: 'Цех для тестов ядра',
  version: 1,
  updatedAt: '2026-10-01T08:00:00+05:00',
  updatedBy: 'Тест',
  stages: [
    {
      id: 'warehouse',
      name: 'Склад комплектующих',
      short: 'Склад',
      kind: 'warehouse_in',
      order: 0,
      bufferAfter: null,
      stations: [{ id: 'warehouse-1', name: 'Зона хранения', equipment: [{ id: 'WH-RACK', type: 'rack', name: 'Стеллаж комплектов', critical: false, connection: NONE }] }],
    },
    {
      id: 'weld',
      name: 'Сварка',
      short: 'Сварка',
      kind: 'welding',
      order: 1,
      bufferAfter: { capacity: 12 },
      stations: [{ id: 'weld-1', name: 'Линия сварки', equipment: [robot(1), robot(2), robot(3), robot(4)] }],
    },
    {
      id: 'paint',
      name: 'Окраска',
      short: 'Окраска',
      kind: 'painting',
      order: 2,
      bufferAfter: { capacity: 15 },
      inlet: [{ id: 'PRETREAT', type: 'pretreatment', name: 'Подготовка поверхности (13 ванн)', critical: true, posts: [{ id: 'PAINT-PRE', name: 'Подготовка поверхности' }], connection: SIM }],
      stations: [
        {
          id: 'paint-1',
          name: 'Камеры окраски',
          equipment: [
            { id: 'BOOTH-01', type: 'paint_booth', name: 'Камера-01', critical: true, posts: [{ id: 'PAINT-B1', name: 'Камера-01' }], aliases: ['Камера-01'], connection: SIM },
            { id: 'BOOTH-02', type: 'paint_booth', name: 'Камера-02', critical: true, posts: [{ id: 'PAINT-B2', name: 'Камера-02' }], aliases: ['Камера-02'], connection: SIM },
          ],
        },
      ],
      outlet: [{ id: 'OVEN', type: 'oven', name: 'Сушка', critical: true, posts: [{ id: 'PAINT-OVEN', name: 'Сушка' }], connection: SIM }],
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
          name: 'Главный конвейер',
          equipment: [{ id: 'CONV-03', type: 'conveyor', name: 'Конвейер-03', critical: true, posts: ASM_POSTS, aliases: ['Конвейер-03'], connection: SIM }],
        },
      ],
    },
    {
      id: 'qc',
      name: 'Контроль качества (ОТК)',
      short: 'ОТК',
      kind: 'inspection',
      order: 4,
      bufferAfter: null,
      stations: [
        {
          id: 'qc-1',
          name: 'Линия контроля',
          equipment: [
            { id: 'QC-LINE', type: 'inspection_post', name: 'Линия контроля', critical: false, posts: [{ id: 'QC-1', name: 'Контроль' }], connection: SIM },
            { id: 'QC-TEST', type: 'test_line', name: 'Испытательная линия', critical: false, posts: [{ id: 'QC-2', name: 'Испытательная линия' }], connection: SIM },
            { id: 'QC-RAIN', type: 'rain_test', name: 'Камера герметичности', critical: false, posts: [{ id: 'QC-3', name: 'Камера герметичности' }], connection: SIM },
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
          equipment: [{ id: 'FG-PARK', type: 'parking', name: 'Площадка готовых машин', critical: false, posts: [{ id: 'FG-IN', name: 'Приёмка' }], connection: NONE }],
        },
      ],
    },
  ],
};
