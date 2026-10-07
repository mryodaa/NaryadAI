// Конфигурация завода: исходный состав, проверка, мощность по норме цикла, изменения словами, падежи.
import { describe, expect, it } from 'vitest';
import {
  PlantConfigSchema,
  SEED_MODEL,
  SEED_PLANT,
  derivePlant,
  dedicatedStation,
  describePlantChanges,
  modelRoute,
  equipmentFromNameIn,
  inflect,
  stageFromLineName,
  stageNominal,
  validatePlant,
  type EquipmentConfig,
  type PlantConfig,
} from '../src/index';

const clone = (c: PlantConfig): PlantConfig => JSON.parse(JSON.stringify(c)) as PlantConfig;
const stage = (c: PlantConfig, id: string) => c.stages.find((s) => s.id === id)!;
const booth = (n: number, cycle = 468): EquipmentConfig => ({
  id: `BOOTH-0${n}`,
  type: 'paint_booth',
  name: `Камера-0${n}`,
  critical: true,
  cycleTimeSec: cycle,
  posts: [{ id: `PAINT-B${n}`, name: `Камера-0${n}` }],
  connection: { method: 'simulator', status: 'not_connected' },
});

/** Окраска с параллельными камерами: каждая — своя станция */
function parallelPaint(booths: number): PlantConfig {
  const c = clone(SEED_PLANT);
  const p = stage(c, 'paint');
  p.stations = Array.from({ length: booths }, (_, i) => ({ id: `paint-${i + 1}`, name: `Камера окраски ${i + 1}`, equipment: [booth(i + 1)] }));
  for (const e of [...p.inlet!, ...p.outlet!]) if (e.type !== 'polishing') e.cycleTimeSec = 156;
  return c;
}

describe('исходная конфигурация — цех по открытым данным Allur', () => {
  it('проходит схему и проверку без ошибок и предупреждений', () => {
    expect(PlantConfigSchema.safeParse(SEED_PLANT).success).toBe(true);
    expect(validatePlant(SEED_PLANT, { shiftPlan: 120 })).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('участки и буферы — те же коды, что в истории и таблицах; камеры и Конвейер-03 на месте', () => {
    const m = SEED_MODEL;
    expect(m.stages.map((s) => s.id)).toEqual(['warehouse', 'weld', 'paint', 'assembly', 'qc', 'finished']);
    expect(m.buffers.map((b) => [b.id, b.capacity])).toEqual([
      ['weld-paint', 12],
      ['paint-assembly', 15],
      ['assembly-qc', 8],
    ]);
    for (const id of ['BOOTH-01', 'BOOTH-02', 'CONV-03', 'ABB-04', 'PRETREAT', 'OVEN', 'QC-LINE', 'QC-RAIN', 'QC-TRACK']) expect(m.equipmentById.has(id)).toBe(true);
    const io = Object.fromEntries(m.production.map((s) => [s.id, [s.entryPosts.join(), s.exitPosts.join()]]));
    expect(io).toEqual({ weld: ['WELD-1,WELD-5,WELD-9', 'WELD-FIN'], paint: ['PAINT-PRE', 'PAINT-QC'], assembly: ['ASM-1', 'ASM-11'], qc: ['QC-4', 'QC-1'] });
    expect(m.stageById.get('assembly')!.posts).toHaveLength(11);
    expect(m.warehouseOut?.posts).toEqual(['FG-IN']);
  });

  it('три сварочные линии под модели сходятся в общую окраску и сборку', () => {
    const weld = SEED_MODEL.stageById.get('weld')!;
    expect(weld.stations.map((s) => [s.name, s.models])).toEqual([
      ['Линия Onix', ['onix']],
      ['Линия Cobalt', ['cobalt']],
      ['Линия J7', ['j7']],
    ]);
    expect(dedicatedStation(weld, 'j7')?.id).toBe('weld-j7');
    expect(weld.stations[0]!.equipment.map((e) => e.id)).toEqual(['ABB-01', 'ABB-02', 'LASER-01', 'ABB-03']);
    const route = modelRoute(SEED_MODEL, 'cobalt').map((r) => [r.stage.id, r.stations.map((s) => s.id).join()]);
    expect(route).toEqual([
      ['weld', 'weld-cobalt'],
      ['paint', 'paint-1'],
      ['assembly', 'assembly-1'],
      ['qc', 'qc-1'],
    ]);
  });

  it('лаборатория, полировка и полигон — в стороне от потока, после своего поста', () => {
    const sides = SEED_MODEL.production.flatMap((s) => s.sides.map((x) => [x.equipment.id, x.after, x.inPost, x.returnPost, x.atExit]));
    expect(sides).toEqual([
      ['GEO-LAB', 'WELD-FIN', 'GEO-IN', 'GEO-OUT', true],
      ['POLISH', 'PAINT-QC', 'POLISH-IN', 'POLISH-OUT', true],
      ['QC-TRACK', 'QC-3', 'QC-2', null, false],
    ]);
    // в поток они не входят: ни в посты участка, ни в станцию
    expect(SEED_MODEL.stageById.get('qc')!.posts).toEqual(['QC-4', 'QC-5', 'QC-6', 'QC-3', 'QC-1']);
    expect(SEED_MODEL.stageById.get('weld')!.returnPosts).toEqual(['GEO-OUT']);
  });

  it('названия из таблиц завода находят участок и оборудование', () => {
    expect(stageFromLineName(SEED_MODEL, 'Сборка-1')?.id).toBe('assembly');
    expect(equipmentFromNameIn(SEED_MODEL, 'Камера 2')?.id).toBe('BOOTH-02');
    expect(equipmentFromNameIn(SEED_MODEL, 'ABB01')?.id).toBe('ABB-01');
    expect(equipmentFromNameIn(SEED_MODEL, 'Конвейер-03')?.id).toBe('CONV-03');
  });
});

describe('проверка состава цеха — ошибки по-русски', () => {
  const errorsOf = (c: PlantConfig) => validatePlant(c).errors.map((e) => e.message);

  it('склады — первым и последним по потоку', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'warehouse').order = 9;
    expect(errorsOf(c).join(' ')).toMatch(/Первым по потоку должен идти склад комплектующих/);
  });

  it('между производственными участками нужен буфер от 1 кузова', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'weld').bufferAfter = null;
    expect(errorsOf(c)).toContain('Между «Сварка» и «Окраска» нужен буфер ёмкостью от 1 кузова.');
  });

  it('у производственного участка минимум одна станция', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'assembly').stations = [];
    expect(errorsOf(c).join(' ')).toMatch(/У участка «Сборка» нет ни одной станции/);
  });

  it('коды оборудования уникальны', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'paint').stations[0]!.equipment[1]!.id = 'BOOTH-01';
    expect(errorsOf(c).join(' ')).toMatch(/Код оборудования BOOTH-01 уже занят/);
  });

  it('лимиты 3D: 12 станций на участок, 6 единиц на станцию', () => {
    const many = parallelPaint(13);
    expect(errorsOf(many).join(' ')).toMatch(/13 станций — больше 12/);
    const c = clone(SEED_PLANT);
    const st = stage(c, 'weld').stations[0]!;
    for (let i = 5; i <= 7; i++) st.equipment.push({ ...st.equipment[0]!, id: `ABB-0${i}`, name: `Робот ABB-0${i}`, posts: [{ id: `WELD-${i}`, name: `Сварка, пост ${i}` }], aliases: [] });
    expect(errorsOf(c).join(' ')).toMatch(/7 единиц оборудования — больше 6/);
  });

  it('оборудование должно подходить участку', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'weld').stations[0]!.equipment.push({ ...booth(3), posts: [{ id: 'PAINT-B3', name: 'Камера-03' }] });
    expect(errorsOf(c).join(' ')).toMatch(/«Камера окраски» не ставится на участок вида «Сварка»/);
  });

  it('нельзя удалить оборудование с открытым инцидентом', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'paint').stations[0]!.equipment.splice(1, 1);
    const r = validatePlant(c, { current: SEED_PLANT, openIncidents: new Map([['BOOTH-02', { id: 'inc-1', title: 'Окраска: брак 10,0%' }]]) });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ equipmentId: 'BOOTH-02', incidentId: 'inc-1' });
    expect(r.errors[0]!.message).toMatch(/открыт инцидент «Окраска: брак 10,0%»/);
  });
});

describe('мощность участка по норме цикла', () => {
  it('исходный цех: сварка 144 (доводка), окраска 123, сборка 120 (задаёт ритм), ОТК 141 кузов в смену', () => {
    const cap = Object.fromEntries(SEED_MODEL.production.map((s) => [s.id, Math.round(stageNominal(s)!.perShift)]));
    expect(cap).toEqual({ weld: 144, paint: 123, assembly: 120, qc: 141 });
    expect(stageNominal(SEED_MODEL.stageById.get('weld')!)!.limitedBy).toBe('FINISH-01');
  });

  it('линии под модели: мощность при плановом составе моделей', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'weld').outlet![0]!.cycleTimeSec = 60;
    const weld = derivePlant(c).stageById.get('weld')!;
    // каждая линия — 126 кузовов в смену; Onix — 52% плана: 126,3 / 0,52 ≈ 243
    const cap = stageNominal(weld)!;
    expect(Math.round(cap.perShift)).toBe(243);
    expect(cap.limitedByModel).toBe('onix');
    // только Onix — все 126
    expect(Math.round(stageNominal(weld, 480, { onix: 1 })!.perShift)).toBe(126);
  });

  it('параллельные камеры складываются, общее оборудование ограничивает сверху', () => {
    const one = stageNominal(derivePlant(parallelPaint(1)).stageById.get('paint')!)!;
    const two = stageNominal(derivePlant(parallelPaint(2)).stageById.get('paint')!)!;
    const four = stageNominal(derivePlant(parallelPaint(4)).stageById.get('paint')!)!;
    expect(Math.round(one.perShift)).toBe(62);
    expect(Math.round(two.perShift)).toBe(123);
    // 4 камеры дали бы 246, но общее оборудование на входе и выходе — 185 в смену
    expect(Math.round(four.perShift)).toBe(185);
    expect(four.limitedBy).toBe('PRETREAT');
  });
});

describe('модели и оборудование в стороне — проверка', () => {
  const errorsOf = (c: PlantConfig) => validatePlant(c).errors.map((e) => e.message);

  it('у каждой модели плана — станция на каждом участке', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'weld').stations.pop();
    expect(errorsOf(c)).toContain('На участке «Сварка» нет станции для J7 — кузова этой модели не пройдут.');
    expect(validatePlant(c, { planModels: ['onix', 'cobalt'] }).ok).toBe(true);
  });

  it('станция с моделью, которую не принимает участок', () => {
    const c = clone(SEED_PLANT);
    stage(c, 'weld').models = ['onix', 'cobalt'];
    expect(errorsOf(c).join(' ')).toMatch(/Станция «Линия J7» не принимает ни одной модели участка «Сварка»/);
  });

  it('оборудованию в стороне нужен пост перед ним', () => {
    const c = clone(SEED_PLANT);
    const qc = stage(c, 'qc').stations[0]!;
    qc.equipment.unshift(qc.equipment.splice(2, 1)[0]!);
    expect(errorsOf(c).join(' ')).toMatch(/«Полигон» стоит в стороне от потока/);
  });
});

describe('изменения человеческим языком', () => {
  it('станции, буфер, новое оборудование', () => {
    const a = parallelPaint(2);
    const b = clone(a);
    stage(b, 'paint').stations.push({ id: 'paint-3', name: 'Камера окраски 3', equipment: [booth(3)] });
    stage(b, 'paint').bufferAfter = { capacity: 20 };
    const r = clone(b);
    stage(r, 'weld').stations[0]!.equipment[0]!.name = 'Робот ABB-01 (новый)';
    expect(describePlantChanges(a, b)).toEqual(['+1 камера окраски', 'буфер окраска → сборка: 15 → 20']);
    expect(describePlantChanges(b, r)).toEqual(['«Робот ABB-01» → «Робот ABB-01 (новый)»']);
    expect(describePlantChanges(b, a)).toEqual(['−1 камера окраски', 'буфер окраска → сборка: 20 → 15']);
  });
});

describe('падежи в текстах', () => {
  it('склоняет названия оборудования и участков', () => {
    expect(inflect('Камера-02', 'gen')).toBe('Камеры-02');
    expect(inflect('Камера-02', 'acc')).toBe('Камеру-02');
    expect(inflect('Конвейер-03', 'gen')).toBe('Конвейера-03');
    expect(inflect('Сушильная печь', 'gen')).toBe('Сушильной печи');
    expect(inflect('Окраска', 'ins')).toBe('Окраской');
    expect(inflect('ОТК', 'ins')).toBe('ОТК');
  });
});
