// Конфигурация завода в шлюзе: версии, применение, проверка, откат, исходный состав для демо.
import { describe, expect, it } from 'vitest';
import { SEED_PLANT, type PlantConfig } from '@allur/contracts';
import { Db } from '../src/db';
import { PlantStore } from '../src/plant';

const clone = (c: PlantConfig): PlantConfig => JSON.parse(JSON.stringify(c)) as PlantConfig;

describe('версии конфигурации завода', () => {
  it('при первом запуске — исходный состав версией 1', () => {
    const store = new PlantStore(new Db(':memory:'));
    expect(store.config.version).toBe(1);
    expect(store.versions()).toMatchObject([{ version: 1, source: 'seed', current: true, stages: 6, stations: 8 }]);
  });

  it('применение создаёт новую версию со списком изменений и оповещает подписчиков', () => {
    const store = new PlantStore(new Db(':memory:'));
    const seen: number[] = [];
    store.onChange((c) => seen.push(c.version));
    const next = clone(store.config);
    next.stages.find((s) => s.id === 'paint')!.bufferAfter = { capacity: 20 };
    const r = store.apply(next, { source: 'apply' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.version).toBe(2);
    expect(r.changes).toEqual(['буфер окраска → сборка: 15 → 20']);
    expect(store.versions()[0]).toMatchObject({ version: 2, comment: 'буфер окраска → сборка: 15 → 20', current: true });
    expect(seen).toEqual([2]);
  });

  it('некорректный состав не применяется: ошибки по-русски, версия не меняется', () => {
    const store = new PlantStore(new Db(':memory:'));
    const bad = clone(store.config);
    bad.stages.find((s) => s.id === 'weld')!.bufferAfter = null;
    const r = store.apply(bad, { source: 'apply' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.validation.errors[0]!.message).toBe('Между «Сварка» и «Окраска» нужен буфер ёмкостью от 1 кузова.');
    expect(store.config.version).toBe(1);
    // форма тоже проверяется: код участка — латиницей
    const wrong = { ...clone(store.config), stages: [{ ...store.config.stages[0], id: 'Склад' }, ...store.config.stages.slice(1)] };
    const r2 = store.validate(wrong);
    expect(r2.validation.ok).toBe(false);
    expect(r2.validation.errors[0]!.message).toMatch(/Код участка/);
  });

  it('откат возвращает всё как было новой версией, история линейная', () => {
    const store = new PlantStore(new Db(':memory:'));
    const next = clone(store.config);
    next.stages.find((s) => s.id === 'assembly')!.bufferAfter = { capacity: 4 };
    store.apply(next, { source: 'apply' });
    const r = store.rollback(1, 'тест');
    expect(r?.ok).toBe(true);
    expect(store.config.version).toBe(3);
    expect(store.config.stages.find((s) => s.id === 'assembly')!.bufferAfter).toEqual({ capacity: 8 });
    expect(store.versions().map((v) => [v.version, v.source])).toEqual([
      [3, 'rollback'],
      [2, 'apply'],
      [1, 'seed'],
    ]);
  });

  it('демо: сценарий начинается с исходного состава', () => {
    const store = new PlantStore(new Db(':memory:'));
    expect(store.ensureBase(SEED_PLANT, 'Демо')).toBe(false);
    const next = clone(store.config);
    next.stages.find((s) => s.id === 'paint')!.bufferAfter = { capacity: 30 };
    store.apply(next, { source: 'apply' });
    expect(store.ensureBase(SEED_PLANT, 'Демо: исходный состав цеха')).toBe(true);
    expect(store.config.stages.find((s) => s.id === 'paint')!.bufferAfter).toEqual({ capacity: 15 });
    expect(store.versions()[0]).toMatchObject({ source: 'demo', comment: 'Демо: исходный состав цеха' });
  });
});
