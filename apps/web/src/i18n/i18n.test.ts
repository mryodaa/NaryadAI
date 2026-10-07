import { describe, expect, it, beforeEach } from 'vitest';
import { ru } from './locales/ru';
import { kk } from './locales/kk';
import { en } from './locales/en';
import { setLanguage, getI18n } from './store';
import { translateDynamicText } from './translator';
import { plural, num, pct0, timeHM } from '../lib/format';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as unknown as Storage;
}

describe('i18n dictionary parity', () => {
  function compareKeys(objA: Record<string, unknown>, objB: Record<string, unknown>, path = '') {
    const keysA = Object.keys(objA).sort();
    const keysB = Object.keys(objB).sort();
    expect(keysB, `Key mismatch at ${path || 'root'}`).toEqual(keysA);

    for (const key of keysA) {
      const valA = objA[key];
      const valB = objB[key];
      const curPath = path ? `${path}.${key}` : key;
      expect(typeof valB, `Type mismatch at ${curPath}`).toBe(typeof valA);
      if (valA && typeof valA === 'object' && !Array.isArray(valA)) {
        compareKeys(valA as Record<string, unknown>, valB as Record<string, unknown>, curPath);
      }
    }
  }

  it('kazakh dictionary has 100% key and type parity with russian', () => {
    compareKeys(ru as unknown as Record<string, unknown>, kk as unknown as Record<string, unknown>);
  });

  it('english dictionary has 100% key and type parity with russian', () => {
    compareKeys(ru as unknown as Record<string, unknown>, en as unknown as Record<string, unknown>);
  });
});

describe('i18n store and language switching', () => {
  beforeEach(() => {
    localStorage.clear();
    setLanguage('ru');
  });

  it('defaults to ru and persists language in localStorage', () => {
    expect(getI18n().lang).toBe('ru');
    setLanguage('kk');
    expect(getI18n().lang).toBe('kk');
    expect(localStorage.getItem('allur-lang')).toBe('kk');
    expect(getI18n().t.nav.digitalTwin).toBe('Сандық егіз');

    setLanguage('en');
    expect(getI18n().lang).toBe('en');
    expect(localStorage.getItem('allur-lang')).toBe('en');
    expect(getI18n().t.nav.digitalTwin).toBe('Digital Twin');
  });
});

describe('plural formatting', () => {
  it('formats russian plurals correctly (1 / 2 / 5 forms)', () => {
    expect(plural(1, ['кузов', 'кузова', 'кузовов'], 'ru')).toBe('кузов');
    expect(plural(2, ['кузов', 'кузова', 'кузовов'], 'ru')).toBe('кузова');
    expect(plural(5, ['кузов', 'кузова', 'кузовов'], 'ru')).toBe('кузовов');
    expect(plural(21, ['кузов', 'кузова', 'кузовов'], 'ru')).toBe('кузов');
  });

  it('formats kazakh plurals with standard base form', () => {
    expect(plural(1, ['шанақ', 'шанақ', 'шанақ'], 'kk')).toBe('шанақ');
    expect(plural(5, ['шанақ', 'шанақ', 'шанақ'], 'kk')).toBe('шанақ');
    expect(plural(21, ['шанақ', 'шанақ', 'шанақ'], 'kk')).toBe('шанақ');
  });

  it('formats english plurals (1 vs many)', () => {
    expect(plural(1, ['car', 'cars', 'cars'], 'en')).toBe('car');
    expect(plural(2, ['car', 'cars', 'cars'], 'en')).toBe('cars');
    expect(plural(5, ['car', 'cars', 'cars'], 'en')).toBe('cars');
  });
});

describe('translateDynamicText', () => {
  it('translates common operational and PLC terms', () => {
    expect(translateDynamicText('Работает', 'kk')).toBe('Жұмыс істеп тұр');
    expect(translateDynamicText('Работает', 'en')).toBe('Running');
    expect(translateDynamicText('Авария', 'kk')).toBe('Апат');
    expect(translateDynamicText('Авария', 'en')).toBe('Fault');
    expect(translateDynamicText('Поломка', 'kk')).toBe('Бұзылу');
    expect(translateDynamicText('Поломка', 'en')).toBe('Breakdown');
  });

  it('gracefully returns original text if not found in dictionary', () => {
    expect(translateDynamicText('Custom Unknown Message', 'kk')).toBe('Custom Unknown Message');
  });
});

describe('number and time formatting', () => {
  it('formats numbers and percentages respecting locale', () => {
    expect(num(1234, 'ru')).toBe('1 234');
    expect(pct0(0.85, 'ru')).toBe('85%');
  });

  it('formats time string into HH:MM', () => {
    expect(timeHM('2026-10-07T14:30:00+05:00', 'ru')).toBe('14:30');
  });
});
