import type { Lang } from './types';
import { ru } from './locales/ru';
import { kk } from './locales/kk';
import { en } from './locales/en';
import { useI18n } from './store';

const LOCALES = { ru, kk, en };

function currentLang(lang?: Lang): Lang {
  if (lang) return lang;
  try {
    return useI18n.getState().lang;
  } catch {
    return 'ru';
  }
}

const AREA_ID_ALIASES: Record<string, 'warehouse' | 'weld' | 'paint' | 'assembly' | 'qc' | 'finished'> = {
  warehouse: 'warehouse',
  warehouse_in: 'warehouse',
  'warehouse-1': 'warehouse',
  weld: 'weld',
  welding: 'weld',
  'weld-onix': 'weld',
  'weld-cobalt': 'weld',
  'weld-j7': 'weld',
  paint: 'paint',
  painting: 'paint',
  'paint-1': 'paint',
  cataphoresis: 'paint',
  assembly: 'assembly',
  'assembly-1': 'assembly',
  qc: 'qc',
  inspection: 'qc',
  'qc-1': 'qc',
  finished: 'finished',
  warehouse_out: 'finished',
  'finished-1': 'finished',
};

export function translateArea(areaId: string, lang?: Lang, format: 'name' | 'short' = 'name'): string {
  const l = currentLang(lang);
  const canonical = AREA_ID_ALIASES[areaId] ?? areaId;
  const dict = LOCALES[l].domain.areas[canonical];
  if (dict) return format === 'short' ? dict.short : dict.name;
  return translateAreaName(areaId, l);
}

const AREA_NAME_MAP: Record<Lang, Record<string, string>> = {
  ru: {},
  kk: {
    'Склад машинокомплектов': 'Машина жиынтықтары қоймасы',
    'Склад комплектующих': 'Бөлшектер қоймасы',
    'Склад деталей': 'Бөлшектер қоймасы',
    'Склад': 'Қойма',
    'Сварка': 'Дәнекерлеу',
    'Сварка кузовов': 'Шанақ дәнекерлеу',
    'Окраска': 'Бояу',
    'Окраска кузовов': 'Шанақтарды бояу',
    'Катафорез': 'Катафорез',
    'Катафорез и грунт': 'Катафорез және праймер',
    'Сборка': 'Құрастыру',
    'Сборка и шасси': 'Құрастыру және шасси',
    'ОТК': 'ТББ',
    'Испытания и ОТК': 'Сынақтар және ТББ',
    'Контроль качества (ОТК)': 'Сапа бақылау (ТББ)',
    'Склад готовой продукции': 'Дайын өнім қоймасы',
    'Склад ГП': 'Дайын өнім',
    'Дайын өнім': 'Дайын өнім',
    'Линия Onix': 'Onix желісі',
    'Линия Cobalt': 'Cobalt желісі',
    'Линия J7': 'J7 желісі',
    'Хранение машинокомплектов': 'Машина жиынтықтарын сақтау',
    'Лазерная ячейка крыши': 'Төбені лазерлік дәнекерлеу ұяшығы',
    'Рихтовка и доводка': 'Түзету және әрлеу',
    'Лаборатория геометрии': 'Геометрия зертханасы',
    'Подготовка и катафорез (13 ванн)': 'Дайындау және катафорез (13 ванна)',
    'Печь катафореза': 'Катафорез пеші',
    'Герметизация швов': 'Жіктерді тығыздау',
    'Камера грунта': 'Праймер камерасы',
    'Камеры окраски: база и лак': 'Бояу камералары: негіз және лак',
    'Камера-01': '01-камера',
    'Камера-02': '02-камера',
    'Сушка': 'Кептіру пеші',
    'Контроль покрытия': 'Жабынды тексеру',
    'Полировка': 'Жылтырату',
    'Главный конвейер: салон, шасси, финальная': 'Бас конвейер: салон, шасси, соңғы жинақтау',
    'Линия испытаний и контроля': 'Сынақ және бақылау желісі',
    'Роликовый стенд': 'Роликті стенд',
    'Развал-схождение': 'Дөңгелек түйісуін реттеу',
    'Настройка фар': 'Фараларды реттеу',
    'Водяная камера': 'Су өткізбейтін камера',
    'Полигон': 'Сынақ полигоны',
    'Финальный осмотр': 'Соңғы тексеру',
    'Приёмка готовых машин': 'Дайын көліктерді қабылдау',
  },
  en: {
    'Склад машинокомплектов': 'CKD Parts Warehouse',
    'Склад комплектующих': 'Parts Warehouse',
    'Склад деталей': 'Parts Warehouse',
    'Склад': 'Warehouse',
    'Сварка': 'Body Welding',
    'Сварка кузовов': 'Body Welding',
    'Окраска': 'Body Painting',
    'Окраска кузовов': 'Body Painting',
    'Катафорез': 'Cataphoresis',
    'Катафорез и грунт': 'Cataphoresis & Primer',
    'Сборка': 'Assembly',
    'Сборка и шасси': 'Assembly & Chassis',
    'ОТК': 'QC',
    'Испытания и ОТК': 'Testing & QC',
    'Контроль качества (ОТК)': 'Quality Control (QC)',
    'Склад готовой продукции': 'Finished Goods Yard',
    'Склад ГП': 'Finished',
    'Дайын өнім': 'Finished',
    'Линия Onix': 'Onix Line',
    'Линия Cobalt': 'Cobalt Line',
    'Линия J7': 'J7 Line',
    'Хранение машинокомплектов': 'Parts Storage',
    'Лазерная ячейка крыши': 'Roof Laser Cell',
    'Рихтовка и доводка': 'Body Finishing',
    'Лаборатория геометрии': 'Geometry Lab',
    'Подготовка и катафорез (13 ванн)': 'Pretreatment & Cataphoresis (13 baths)',
    'Печь катафореза': 'Cataphoresis Oven',
    'Герметизация швов': 'Seam Sealing',
    'Камера грунта': 'Primer Booth',
    'Камеры окраски: база и лак': 'Paint Booths: Base & Clearcoat',
    'Камера-01': 'Booth-01',
    'Камера-02': 'Booth-02',
    'Сушка': 'Curing Oven',
    'Контроль покрытия': 'Coating Inspection',
    'Полировка': 'Polishing',
    'Главный конвейер: салон, шасси, финальная': 'Main Conveyor: Trim, Chassis, Final',
    'Линия испытаний и контроля': 'Test & Inspection Line',
    'Роликовый стенд': 'Roller Test Bench',
    'Развал-схождение': 'Wheel Alignment',
    'Настройка фар': 'Headlight Aiming',
    'Водяная камера': 'Water Test Booth',
    'Полигон': 'Test Track',
    'Финальный осмотр': 'Final Inspection',
    'Приёмка готовых машин': 'Finished Vehicle Receiving',
  },
};

export function translateAreaName(name: string, lang?: Lang): string {
  const l = currentLang(lang);
  if (!name || l === 'ru') return name;

  if (AREA_NAME_MAP[l]?.[name]) return AREA_NAME_MAP[l][name];

  for (const item of Object.values(LOCALES.ru.domain.areas)) {
    if (name === item.name) {
      const matchKey = Object.keys(LOCALES.ru.domain.areas).find((k) => LOCALES.ru.domain.areas[k as keyof typeof LOCALES.ru.domain.areas].name === name);
      if (matchKey) return LOCALES[l].domain.areas[matchKey as keyof typeof LOCALES.ru.domain.areas]?.name ?? name;
    }
    if (name === item.short) {
      const matchKey = Object.keys(LOCALES.ru.domain.areas).find((k) => LOCALES.ru.domain.areas[k as keyof typeof LOCALES.ru.domain.areas].short === name);
      if (matchKey) return LOCALES[l].domain.areas[matchKey as keyof typeof LOCALES.ru.domain.areas]?.short ?? name;
    }
  }

  return translateDynamicText(name, l);
}

const EQUIPMENT_NAME_MAP: Record<Lang, Record<string, string>> = {
  ru: {},
  kk: {
    'Стеллажи адресного хранения': 'Мекенжайлық сақтау сөрелері',
    'Контейнерная площадка': 'Контейнер алаңы',
    'Лазерная ячейка крыши': 'Төбені лазерлік дәнекерлеу ұяшығы',
    'Рихтовка и доводка': 'Түзету және әрлеу',
    'Лаборатория геометрии': 'Геометрия зертханасы',
    'Подготовка и катафорез (13 ванн)': 'Дайындау және катафорез (13 ванна)',
    'Печь катафореза': 'Катафорез пеші',
    'Герметизация швов': 'Жіктерді тығыздау',
    'Камера грунта': 'Праймер камерасы',
    'Сушка': 'Кептіру пеші',
    'Контроль покрытия': 'Жабынды бақылау',
    'Полировка': 'Жылтырату',
    'Испытательная линия': 'Сынақ желісі',
    'Роликовый стенд': 'Роликті стенд',
    'Развал-схождение': 'Дөңгелек түйісуін реттеу',
    'Настройка фар': 'Фараларды реттеу',
    'Водяная камера': 'Су өткізбейтін камера',
    'Полигон': 'Сынақ полигоны',
    'Финальный осмотр': 'Соңғы тексеру',
    'Площадка готовых машин': 'Дайын көліктер алаңы',
    'Стеллаж склада ГП': 'ДӨҚ қойма сөресі',
  },
  en: {
    'Стеллажи адресного хранения': 'Addressed Storage Racks',
    'Контейнерная площадка': 'Container Yard',
    'Лазерная ячейка крыши': 'Roof Laser Cell',
    'Рихтовка и доводка': 'Body Finishing',
    'Лаборатория геометрии': 'Geometry Lab',
    'Подготовка и катафорез (13 ванн)': 'Pretreatment & Cataphoresis (13 baths)',
    'Печь катафореза': 'Cataphoresis Oven',
    'Герметизация швов': 'Seam Sealing',
    'Камера грунта': 'Primer Booth',
    'Сушка': 'Curing Oven',
    'Контроль покрытия': 'Coating Inspection',
    'Полировка': 'Polishing',
    'Испытательная линия': 'Test Line',
    'Роликовый стенд': 'Roller Test Bench',
    'Развал-схождение': 'Wheel Alignment',
    'Настройка фар': 'Headlight Aiming',
    'Водяная камера': 'Water Test Booth',
    'Полигон': 'Test Track',
    'Финальный осмотр': 'Final Inspection',
    'Площадка готовых машин': 'Finished Vehicle Yard',
    'Стеллаж склада ГП': 'Finished Goods Rack',
  },
};

export function translateEquipmentName(name: string, lang?: Lang): string {
  const l = currentLang(lang);
  if (!name || l === 'ru') return name;

  if (EQUIPMENT_NAME_MAP[l]?.[name]) return EQUIPMENT_NAME_MAP[l][name];

  if (name.startsWith('Робот ')) {
    return l === 'kk' ? name.replace(/^Робот\s+/, '') + ' роботы' : name.replace(/^Робот\s+/, 'Robot ');
  }
  if (name.startsWith('Конвейер-') || name.startsWith('Конвейер ')) {
    return l === 'kk' ? name : name.replace(/^Конвейер([ -])/, 'Conveyor$1');
  }
  if (name.startsWith('Камера-') || name.startsWith('Камера ')) {
    return l === 'kk' ? name.replace(/^Камера([ -])/, '$1-камера') : name.replace(/^Камера([ -])/, 'Booth$1');
  }
  if (name.startsWith('Привод ')) {
    return l === 'kk' ? name.replace(/^Привод\s+/, '') + ' жетегі' : name.replace(/^Привод\s+/, 'Drive ');
  }
  if (name.startsWith('Линия ')) {
    return l === 'kk' ? name.replace(/^Линия\s+/, '') + ' желісі' : name.replace(/^Линия\s+/, '') + ' Line';
  }

  return translateDynamicText(name, l);
}

export function translateStatus(status: string, lang?: Lang): string {
  const l = currentLang(lang);
  if (status === 'Есть дефицит' || status === 'deficit') return l === 'kk' ? 'Тапшылық бар' : l === 'en' ? 'Deficit exists' : 'Есть дефицит';
  if (status === 'Запас в норме' || status === 'stock_ok') return l === 'kk' ? 'Қор қалыпты' : l === 'en' ? 'Stock normal' : 'Запас в норме';
  if (status === 'Принимает' || status === 'accepting') return l === 'kk' ? 'Қабылдауда' : l === 'en' ? 'Accepting' : 'Принимает';

  for (const [key, val] of Object.entries(LOCALES.ru.domain.statuses)) {
    if (status === val || status === key) return LOCALES[l].domain.statuses[key] ?? status;
  }
  return LOCALES[l].domain.statuses[status] ?? status;
}

export function translateEquipmentStatus(status: string, lang?: Lang): string {
  const l = currentLang(lang);
  for (const [key, val] of Object.entries(LOCALES.ru.domain.equipmentStatuses)) {
    if (status === val || status === key) return LOCALES[l].domain.equipmentStatuses[key] ?? status;
  }
  return LOCALES[l].domain.equipmentStatuses[status] ?? status;
}

export function translateRisk(risk: string, lang?: Lang): string {
  const l = currentLang(lang);
  if (risk === 'high') return LOCALES[l].domain.risks.высокий ?? 'high';
  if (risk === 'medium') return LOCALES[l].domain.risks.средний ?? 'medium';
  if (risk === 'low') return LOCALES[l].domain.risks.низкий ?? 'low';
  return LOCALES[l].domain.risks[risk] ?? risk;
}

export function translateRiskLevel(level: string, lang?: Lang): string {
  return translateRisk(level, lang);
}

export function translateDowntimeCategory(category: string, lang?: Lang): string {
  const l = currentLang(lang);
  for (const [key, val] of Object.entries(LOCALES.ru.domain.downtimeCategories)) {
    if (category === val || category === key) return LOCALES[l].domain.downtimeCategories[key] ?? category;
  }
  return LOCALES[l].domain.downtimeCategories[category] ?? category;
}

export function translateDefect(defectId: string, lang?: Lang): string {
  const l = currentLang(lang);
  for (const [key, val] of Object.entries(LOCALES.ru.domain.defects)) {
    if (defectId === val || defectId === key) return LOCALES[l].domain.defects[key] ?? defectId;
  }
  return LOCALES[l].domain.defects[defectId] ?? defectId;
}

export function translateSource(sourceId: string, lang?: Lang): string {
  const l = currentLang(lang);
  if (sourceId === 'mes') return '1С:MES';
  if (sourceId === 'qls') return '1С:QLS';
  if (sourceId === 'wms') return '1С:WMS';
  if (sourceId === 'erp') return '1С:ERP';
  if (sourceId === 'plc') return l === 'en' ? 'PLC' : 'Контроллер';
  if (sourceId === 'camera') return l === 'kk' ? 'Бейнекамера' : l === 'en' ? 'Camera' : 'Камера';
  if (sourceId === 'master') return l === 'kk' ? 'Шебер' : l === 'en' ? 'Shop Master' : 'Мастер';
  if (sourceId === 'import') return l === 'kk' ? 'Импорт' : l === 'en' ? 'Import' : 'Импорт';
  if (sourceId === 'twin') return l === 'kk' ? 'Сандық егіз' : l === 'en' ? 'Digital Twin' : 'Двойник';
  if (sourceId === 'scanner') return l === 'kk' ? 'Сканер' : l === 'en' ? 'Scanner' : 'Сканер';
  if (sourceId === 'rfid') return 'RFID';
  if (sourceId === 'tool') return l === 'kk' ? 'Құрал' : l === 'en' ? 'Smart Tool' : 'Инструмент';
  return sourceId;
}

export function translateScenarioName(id: string, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.scenarios[id]?.name ?? id;
}

export function translateScenarioDesc(id: string, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.scenarios[id]?.description ?? '';
}

export function translateStageName(stage: number, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.stages[stage]?.name ?? `Stage ${stage}`;
}

export function translateStageDesc(stage: number, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.stages[stage]?.description ?? '';
}

export function translateCarFlag(flag: string, lang?: Lang): string {
  const l = currentLang(lang);
  const flags = LOCALES[l].cars;
  if (flag === 'delayed') return flags.flagDelayed;
  if (flag === 'nonconformity') return flags.flagNonconformity;
  if (flag === 'rework') return flags.flagRework;
  if (flag === 'restored_checkpoint' || flag === 'restored') return flags.flagRestored;
  if (flag === 'unknown_color') return flags.flagUnknownColor;
  return flag;
}

export function translateCarAppearance(kind: string, lang?: Lang): string {
  const l = currentLang(lang);
  const map: Record<Lang, Record<string, string>> = {
    ru: {
      kit: 'машинокомплект',
      parked: 'готовая машина',
      stand: 'на стенде',
      assembled: 'сборка',
      paint: 'в цвете',
      primer: 'грунт',
      ecoat: 'катафорез',
      metal: 'металл',
    },
    kk: {
      kit: 'машина жиынтығы',
      parked: 'дайын көлік',
      stand: 'стендте',
      assembled: 'құрастыру',
      paint: 'боялған',
      primer: 'праймер',
      ecoat: 'катафорез',
      metal: 'металл',
    },
    en: {
      kit: 'vehicle kit',
      parked: 'finished car',
      stand: 'on test stand',
      assembled: 'assembled',
      paint: 'painted',
      primer: 'primer',
      ecoat: 'cataphoresis',
      metal: 'bare metal',
    },
  };
  return map[l]?.[kind] ?? kind;
}

/**
 * Перевод динамических строк, генерируемых ядром двойника (заголовки инцидентов, опции решений, рекомендации, метрики).
 */
export function translateDynamicText(text: string, lang?: Lang): string {
  const l = currentLang(lang);
  if (!text || l === 'ru') return text;

  // Direct domain lookups
  for (const [key, val] of Object.entries(LOCALES.ru.domain.statuses)) {
    if (text === val || text === key) return LOCALES[l].domain.statuses[key] ?? text;
  }
  for (const [key, val] of Object.entries(LOCALES.ru.domain.equipmentStatuses)) {
    if (text === val || text === key) return LOCALES[l].domain.equipmentStatuses[key] ?? text;
  }
  for (const [key, val] of Object.entries(LOCALES.ru.domain.risks)) {
    if (text === val || text === key) return LOCALES[l].domain.risks[key] ?? text;
  }
  for (const [key, val] of Object.entries(LOCALES.ru.domain.downtimeCategories)) {
    if (text === val || text === key) return LOCALES[l].domain.downtimeCategories[key] ?? text;
  }
  for (const [key, val] of Object.entries(LOCALES.ru.domain.defects)) {
    if (text === val || text === key) return LOCALES[l].domain.defects[key] ?? text;
  }

  // Common UI words
  if (text === 'Рекомендуем') return l === 'kk' ? 'Ұсынамыз' : 'Recommended';
  if (text === 'Принять') return l === 'kk' ? 'Қабылдау' : 'Accept';
  if (text === 'Отправляю…') return l === 'kk' ? 'Жіберілуде…' : 'Sending…';
  if (text === 'Ничего не делать') return l === 'kk' ? 'Ештеңе істемеу' : 'Do nothing';
  if (text === 'Потерь нет') return l === 'kk' ? 'Шығын жоқ' : 'No losses';
  if (text === 'нет данных') return l === 'kk' ? 'деректер жоқ' : 'no data';
  if (text === 'Ток') return l === 'kk' ? 'Ток' : 'Current';
  if (text === 'Вибрация') return l === 'kk' ? 'Діріл' : 'Vibration';
  if (text === 'Перепад давления') return l === 'kk' ? 'Қысым айырмасы' : 'Pressure drop';

  // Appearance / Route markers
  if (text === 'машинокомплект') return l === 'kk' ? 'машина жиынтығы' : 'vehicle kit';
  if (text === 'готовая машина') return l === 'kk' ? 'дайын көлік' : 'finished car';
  if (text === 'на стенде') return l === 'kk' ? 'стендте' : 'on test stand';
  if (text === 'сборка') return l === 'kk' ? 'құрастыру' : 'assembled';
  if (text === 'в цвете') return l === 'kk' ? 'боялған' : 'painted';
  if (text === 'грунт') return l === 'kk' ? 'праймер' : 'primer';
  if (text === 'катафорез') return l === 'kk' ? 'катафорез' : 'cataphoresis';
  if (text === 'металл') return l === 'kk' ? 'металл' : 'bare metal';
  if (text === 'результат операции') return l === 'kk' ? 'операция нәтижесі' : 'operation result';
  if (text === 'выход со станции') return l === 'kk' ? 'бекеттен шығу' : 'station exit';
  if (text === 'выход участка') return l === 'kk' ? 'учаскеден шығу' : 'area exit';
  if (text === 'до начала отслеживания') return l === 'kk' ? 'қадағалау басталғанға дейін' : 'before tracking started';
  if (text.startsWith('Перекраска, ') || text.startsWith('Повторный проход, ')) {
    const loopMatch = text.match(/(\d+)-й проход/);
    const loopNum = loopMatch ? loopMatch[1] : '2';
    return l === 'kk' ? `Қайта бояу, ${loopNum}-өту` : `Rework pass ${loopNum}`;
  }
  if (text.startsWith('Выборочно: ')) {
    const sub = text.replace('Выборочно: ', '');
    return l === 'kk' ? `Таңдамалы: ${translateDynamicText(sub, l)}` : `Sample: ${translateDynamicText(sub, l)}`;
  }

  // Telemetry in 2D Panel View: «загрузка 88%», «брак 8.5% · норма 4%», «запас на 1.5 смены · J7»
  const loadMatch = text.match(/^загрузка\s+([\d,.]+)%$/i);
  if (loadMatch) {
    return l === 'kk' ? `жүктеме ${loadMatch[1]}%` : `load ${loadMatch[1]}%`;
  }
  const defectMetricMatch = text.match(/^брак\s+([\d,.]+)%\s*·\s*норма\s+([\d,.]+)%$/i);
  if (defectMetricMatch) {
    return l === 'kk' ? `ақау ${defectMetricMatch[1]}% · норма ${defectMetricMatch[2]}%` : `defects ${defectMetricMatch[1]}% · target ${defectMetricMatch[2]}%`;
  }
  const stockMetricMatch = text.match(/^запас на\s+([\d,.]+)\s+смен[ыа]?\s*·\s*(.+)$/i);
  if (stockMetricMatch) {
    const kitTranslated = translateDynamicText(stockMetricMatch[2]!, l);
    return l === 'kk' ? `${stockMetricMatch[1]} ауысымға қор · ${kitTranslated}` : `stock for ${stockMetricMatch[1]} shifts · ${kitTranslated}`;
  }

  // Kits
  if (text.includes('Жгуты проводов')) return text.replace('Жгуты проводов', l === 'kk' ? 'сымдар шоғы' : 'wire harnesses');
  if (text.includes('Сиденья')) return text.replace('Сиденья', l === 'kk' ? 'орындықтары' : 'seats');
  if (text.includes('Штамповка кузова')) return text.replace('Штамповка кузова', l === 'kk' ? 'шанақ штамптамасы' : 'body stampings');
  if (text.includes('Двигатель и КПП')) return text.replace('Двигатель и КПП', l === 'kk' ? 'қозғалтқыш және БҚ' : 'powertrain');

  // Colors
  const colors: Record<string, { kk: string; en: string }> = {
    'Белый': { kk: 'Ақ', en: 'White' },
    'Чёрный': { kk: 'Қара', en: 'Black' },
    'Серый': { kk: 'Сұр', en: 'Gray' },
    'Серебристый': { kk: 'Күміс түсті', en: 'Silver' },
    'Красный': { kk: 'Қызыл', en: 'Red' },
    'Синий': { kk: 'Көк', en: 'Blue' },
    'Коричневый': { kk: 'Қоңыр', en: 'Brown' },
    'Мокрый асфальт': { kk: 'Ылғал асфальт', en: 'Wet asphalt' },
  };
  if (colors[text]) return colors[text][l];

  // Levers & Bottlenecks in PlanScreen
  if (text === 'Плановое ТО в рабочее время') return l === 'kk' ? 'Жұмыс уақытындағы жоспарлы ТҚК' : 'Scheduled maintenance during working hours';
  if (text === 'Нехватка комплектующих') return l === 'kk' ? 'Бөлшектер жетіспеушілігі' : 'Parts shortage';
  if (text === 'Микропростои и прочее') return l === 'kk' ? 'Қысқа тоқтаулар және басқалар' : 'Micro-stoppages and other';
  if (text === 'Перенести ТО на нерабочее время') return l === 'kk' ? 'ТҚК-ны жұмыстан тыс уақытқа ауыстыру' : 'Reschedule maintenance to off-shift hours';
  if (text === 'Менять фильтр окраски по графику, а не по аварии') return l === 'kk' ? 'Бояу сүзгісін апат бойынша емес, кесте бойынша ауыстыру' : 'Replace paint filter by schedule, not on failure';
  if (text === 'Добавить смену в субботу') return l === 'kk' ? 'Сенбі күніне ауысым қосу' : 'Add Saturday shift';
  if (text.endsWith(': простои и перекраска')) {
    const pfx = text.replace(': простои и перекраска', '');
    return l === 'kk' ? `${translateAreaName(pfx, l)}: тоқтаулар мен қайта бояу` : `${translateAreaName(pfx, l)}: downtime & repaints`;
  }
  if (text.endsWith(': простои')) {
    const pfx = text.replace(': простои', '');
    return l === 'kk' ? `${translateAreaName(pfx, l)}: тоқтаулар` : `${translateAreaName(pfx, l)}: downtime`;
  }

  // Reasons & Failures
  if (text.includes('обрыв цепи')) return text.replace('обрыв цепи', l === 'kk' ? 'тізбек үзілуі' : 'conveyor chain break');
  if (text.includes('засор фильтра')) return text.replace('засор фильтра', l === 'kk' ? 'сүзгі бітелуі' : 'filter clogging');
  if (text.includes('выработка ресурса')) return text.replace('выработка ресурса', l === 'kk' ? 'ресурстың таусылуы' : 'resource depletion');
  if (text === 'поломка') return l === 'kk' ? 'бұзылу' : 'breakdown';
  if (text === 'нет деталей') return l === 'kk' ? 'бөлшектер жоқ' : 'parts shortage';
  if (text === 'наладка') return l === 'kk' ? 'баптау' : 'setup';
  if (text === 'ждём решения') return l === 'kk' ? 'шешім күтілуде' : 'waiting for decision';

  // Sensor reading notes
  if (text.includes('Па · норма до 250')) {
    return text.replace('Па · норма до 250', l === 'kk' ? 'Па · 250 дейін норма' : 'Pa · target up to 250');
  }

  // Decision & WorkOrder Action Texts (3D Plaques & Incident options)
  if (text.startsWith('Запланирована замена фильтра')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `Сүзгіні ауыстыру жоспарланды${tMatch ? ` ${tMatch[1]}` : ''}` : `Filter replacement scheduled${tMatch ? ` ${tMatch[1]}` : ''}`;
  }
  if (text === 'Идёт замена фильтра') return l === 'kk' ? 'Сүзгі ауыстырылуда' : 'Filter replacement in progress';
  if (text.startsWith('Замена фильтра в')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `Сүзгіні ауыстыру${tMatch ? ` ${tMatch[1]}` : ''}` : `Filter replacement at${tMatch ? ` ${tMatch[1]}` : ''}`;
  }
  if (text.startsWith('Запланировано ТО')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `ТҚК жоспарланды${tMatch ? ` ${tMatch[1]}` : ''}` : `PM service scheduled${tMatch ? ` ${tMatch[1]}` : ''}`;
  }
  if (text === 'Идёт плановое ТО') return l === 'kk' ? 'Жоспарлы ТҚК жүруде' : 'Scheduled PM in progress';
  if (text.startsWith('ТО в')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `ТҚК${tMatch ? ` ${tMatch[1]}` : ''}` : `PM service at${tMatch ? ` ${tMatch[1]}` : ''}`;
  }
  if (text.startsWith('Запланирован осмотр')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `Тексеру жоспарланды${tMatch ? ` ${tMatch[1]}` : ''}` : `Inspection scheduled${tMatch ? ` ${tMatch[1]}` : ''}`;
  }
  if (text === 'Идёт осмотр') return l === 'kk' ? 'Тексеру жүруде' : 'Inspection in progress';
  if (text.startsWith('Осмотр в')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `Тексеру${tMatch ? ` ${tMatch[1]}` : ''}` : `Inspection at${tMatch ? ` ${tMatch[1]}` : ''}`;
  }
  if (text === 'Идёт ремонт') return l === 'kk' ? 'Жөндеу жүруде' : 'Repair in progress';
  if (text.startsWith('Ремонт по наряду')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `Наряд бойынша жөндеу${tMatch ? `, ${tMatch[1]}` : ''}` : `Work order repair${tMatch ? `, ${tMatch[1]}` : ''}`;
  }
  if (text.startsWith('Срочная доставка к')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `${tMatch ? `${tMatch[1]} қарай ` : ''}шұғыл жеткізу` : `Expedited delivery${tMatch ? ` by ${tMatch[1]}` : ''}`;
  }
  if (text === 'Очередь моделей переставлена') return l === 'kk' ? 'Үлгілер кезегі қайта реттелді' : 'Model queue resequenced';

  // Option Action Labels
  if (text.startsWith('Заменить фильтр в пересменку')) {
    const timeMatch = text.match(/(\d{1,2}:\d{2})/);
    const timeStr = timeMatch ? ` (${timeMatch[1]})` : '';
    return l === 'kk' ? `Сүзгіні ауысым ауысқанда ауыстыру${timeStr}` : `Replace filter during shift handover${timeStr}`;
  }
  if (text.startsWith('Заменить фильтр')) {
    return l === 'kk' ? 'Сүзгіні қазір ауыстыру' : 'Replace filter now';
  }
  if (text === 'Отложить до следующего планового окна') {
    return l === 'kk' ? 'Келесі жоспарлы терезеге дейін шегеру' : 'Postpone until next planned window';
  }
  if (text.startsWith('ТО сейчас')) {
    return l === 'kk' ? 'ТҚК қазір жүргізу, 30 минут' : 'Service now, 30 minutes';
  }
  if (text.startsWith('ТО в ночь на')) {
    const timeMatch = text.match(/(\d{1,2}\.\d{2}.*)/);
    const t = timeMatch ? timeMatch[1] : '';
    return l === 'kk' ? `ТҚК түнгі уақытта: ${t}` : `PM service at night: ${t}`;
  }
  if (text.startsWith('Срочный ремонт')) {
    return l === 'kk' ? 'Кезекші бригадамен шұғыл жөндеу' : 'Emergency repair by standby crew';
  }
  if (text.startsWith('Усилить контроль')) {
    return l === 'kk' ? 'Бақылауды күшейту: әр шанақты бекетте тексеру' : 'Tighten inspection: inspect every body at post';
  }
  if (text.startsWith('Остановить на осмотр цепи')) {
    return l === 'kk' ? 'Тізбекті тексеру үшін тоқтату, 20 минут' : 'Stop for chain inspection, 20 minutes';
  }
  if (text.startsWith('Срочная доставка')) {
    return l === 'kk' ? 'Жиынтықтарды шұғыл жеткізу' : 'Expedited parts delivery';
  }
  if (text.startsWith('Переставить очередь')) {
    return l === 'kk' ? 'Кезек ретін ауыстыру: жеткізілімнен кейін' : 'Resequence queue: after kit delivery';
  }
  if (text.startsWith('Проверить оборудование')) {
    return l === 'kk' ? 'Ауысым ауысқанда учаске жабдығын тексеру' : 'Inspect area equipment at shift handover';
  }
  if (text.startsWith('Ремонт и час сверхурочно')) {
    return l === 'kk' ? 'Жөндеу және ауысымнан кейін 1 сағат үстеме жұмыс' : 'Repair and 1h overtime after shift';
  }

  // Option Details
  if (text.startsWith('Замена по графику')) {
    return l === 'kk'
      ? 'Кесте бойынша ауыстыру ~20 мин, бригада мен сүзгі алдын ала дайындалады.'
      : 'Scheduled replacement ~20 min, crew and filter prepared in advance.';
  }
  if (text.startsWith('Остановить ') && text.includes('через 10 минут')) {
    return l === 'kk'
      ? '10 минуттан кейін тоқтату. Ақау бірден тоқтайды.'
      : 'Stop in 10 minutes. Defects will stop immediately.';
  }
  if (text.startsWith('Фильтр выйдет на предел')) {
    return l === 'kk'
      ? 'Сүзгі шекті мәнге жетеді, камера мәжбүрлі түрде ауыстыруға тоқтайды.'
      : 'Filter will reach the limit, booth will stop for forced replacement.';
  }
  if (text.startsWith('Наладчик проверяет посты')) {
    return l === 'kk'
      ? 'Баптаушы бекеттер мен жабдықты 20 минут тексереді.'
      : 'Technician inspects posts and tooling for 20 min.';
  }
  if (text.startsWith('Без остановки линии')) {
    return l === 'kk'
      ? 'Желіні тоқтатпай, бірақ қосымша бақылаушы қажет.'
      : 'Without stopping the line, but extra inspector required.';
  }
  if (text.startsWith('Брак остаётся на текущем уровне')) {
    return l === 'kk' ? 'Ақау ағымдағы деңгейде қалады.' : 'Defects remain at current level.';
  }
  if (text.startsWith('Отрабатываем потерю в конце смены')) {
    return l === 'kk'
      ? 'Шығынды ауысым соңында үстеме жұмыспен өтейміз.'
      : 'Recover loss through end-of-shift overtime.';
  }
  if (text.startsWith('Ночью линия не работает')) {
    return l === 'kk'
      ? 'Түнде желі жұмыс істемейді — өнім жоғалмайды.'
      : 'Line does not run at night — no production lost.';
  }
  if (text.startsWith('Риск снимается сразу, но')) {
    return l === 'kk'
      ? 'Қауіп бірден алынады, бірақ бекет ауысым ортасында тоқтайды.'
      : 'Risk removed immediately, but station stops mid-shift.';
  }
  if (text.startsWith('Вероятность отказа в смену')) {
    return l === 'kk'
      ? 'Ауысымдағы істен шығу ықтималдығы жоғары.'
      : 'Failure probability during shift is significant.';
  }
  if (text.startsWith('Заказать срочную поставку')) {
    return l === 'kk' ? 'Жеткізушіден шұғыл жеткізілімге тапсырыс беру.' : 'Order expedited delivery from supplier.';
  }
  if (text.startsWith('Подтянуть или заменить звенья')) {
    return l === 'kk'
      ? 'Тізбек үзілмей тұрып буындарды тарту немесе ауыстыру авариялық жөндеуге қарағанда тезірек әрі арзанырақ.'
      : 'Tightening or replacing links before a break is faster and cheaper than breakdown repair.';
  }
  if (text.startsWith('Ждать: возможно, ток стабилизируется')) {
    return l === 'kk' ? 'Күту: ток тұрақтануы мүмкін.' : 'Wait: current may stabilize.';
  }

  // Incident Titles
  if (text.includes('стоит:')) {
    const [areaRaw, reasonRaw] = text.split('стоит:');
    const area = translateAreaName(areaRaw!.trim(), l);
    const reason = translateDynamicText(reasonRaw!.trim(), l);
    return l === 'kk' ? `${area} тоқтап тұр: ${reason}` : `${area} stopped: ${reason}`;
  }
  if (text.includes('снижена мощность —')) {
    const [areaRaw, reasonRaw] = text.split('снижена мощность —');
    const area = translateAreaName(areaRaw!.trim().replace(/:$/, ''), l);
    const reason = translateDynamicText(reasonRaw!.trim(), l);
    return l === 'kk' ? `${area}: қуаты төмендеген — ${reason}` : `${area}: reduced capacity — ${reason}`;
  }
  if (text.includes('растёт ток привода')) {
    const m = text.match(/^(.*?):\s*растёт ток привода$/);
    const prefix = m ? translateEquipmentName(m[1]!, l) : '';
    return l === 'kk' ? `${prefix ? `${prefix}: ` : ''}жетек тогы өсуде` : `${prefix ? `${prefix}: ` : ''}drive motor current rising`;
  }
  if (text.includes('ресурс до ТО')) {
    const m = text.match(/^(.*?):\s*ресурс до ТО\s*(\d+)%$/);
    if (m) {
      const eq = translateEquipmentName(m[1]!, l);
      return l === 'kk' ? `${eq}: ТҚК дейінгі ресурс ${m[2]}%` : `${eq}: PM resource ${m[2]}%`;
    }
  }
  if (text.includes('брак') && text.includes('растёт')) {
    const m = text.match(/^(.*?):\s*брак\s*([\d,.]+)%\s*и растёт$/);
    if (m) {
      const area = translateAreaName(m[1]!, l);
      return l === 'kk' ? `${area}: ақау ${m[2]}% және өсуде` : `${area}: defect rate ${m[2]}% and rising`;
    }
  }

  // Impact Texts
  if (text.startsWith('Риск остановки за 24 ч —')) {
    const r = text.replace('Риск остановки за 24 ч —', '').trim();
    return l === 'kk' ? `24 сағатта тоқтау қаупі — ${translateRisk(r, l)}` : `24h downtime risk — ${translateRisk(r, l)}`;
  }
  if (text.includes('к концу смены')) {
    const m = text.match(/^[−-](\d+)\s+машин[ыа]?\s+к концу смены$/);
    if (m) {
      return l === 'kk' ? `ауысым соңына қарай −${m[1]} көлік` : `−${m[1]} cars by shift end`;
    }
  }
  if (text === 'буфер пока перекрывает остановку') {
    return l === 'kk' ? 'буфер әзірге тоқтауды өтейді' : 'buffer currently absorbs the stop';
  }
  if (text === 'остальные станции и буфер пока перекрывают потерю') {
    return l === 'kk' ? 'қалған бекеттер мен буфер шығынды өтеп тұр' : 'remaining stations and buffer currently absorb the loss';
  }
  if (text.includes('риск обрыва цепи — около')) {
    const m = text.match(/риск обрыва цепи — около\s+(\d+)\s+машин/);
    if (m) {
      return l === 'kk' ? `тізбек үзілу қаупі — шамамен ${m[1]} көлік` : `chain break risk — about ${m[1]} cars`;
    }
  }
  if (text.includes('сегодня, если не переставить очередь')) {
    const m = text.match(/^[−-](\d+)\s+машин\s+сегодня/);
    if (m) {
      return l === 'kk' ? `кезек реті ауыстырылмаса, бүгін −${m[1]} көлік` : `−${m[1]} cars today unless queue resequenced`;
    }
  }
  if (text.startsWith('закончатся ')) {
    const when = text.replace('закончатся ', '');
    return l === 'kk' ? `${when} бітеді` : `will run out ${when}`;
  }

  // Decisions in Quality Checks
  if (text === 'доработка') return l === 'kk' ? 'пысықтау' : 'rework';
  if (text === 'повторная окраска') return l === 'kk' ? 'қайта бояу' : 'repaint';
  if (text === 'списание') return l === 'kk' ? 'есептен шығару' : 'scrap';

  // Checkpoints
  const checkpoints: Record<string, { kk: string; en: string }> = {
    'Контроль кузова после доводки': { kk: 'Өңдеуден кейінгі шанақты бақылау', en: 'Body inspection after finishing' },
    'Лаборатория геометрии (выборочно)': { kk: 'Геометрия зертханасы (таңдамалы)', en: 'Geometry lab (sample)' },
    'Контроль покрытия': { kk: 'Жабынды тексеру', en: 'Coating inspection' },
    'Испытательная линия': { kk: 'Сынақ желісі', en: 'Test line' },
    'Водяная камера': { kk: 'Су өткізбейтін камера', en: 'Water test booth' },
    'Полигон (выборочно)': { kk: 'Сынақ полигоны (таңдамалы)', en: 'Test track (sample)' },
    'Финальный осмотр': { kk: 'Соңғы тексеру', en: 'Final inspection' },
  };
  if (checkpoints[text]) return checkpoints[text][l];

  // Quality Passport Conditions
  if (text === 'Перепад на фильтре') return l === 'kk' ? 'Сүзгідегі қысым айырмасы' : 'Filter pressure drop';
  if (text === 'Наработка робота') return l === 'kk' ? 'Роботтың өңдеген уақыты' : 'Robot cycle count';
  const filterNormMatch = text.match(/^(\d+)\s+Па\s*\(норма до\s+(\d+)\)$/);
  if (filterNormMatch) {
    return l === 'kk' ? `${filterNormMatch[1]} Па (${filterNormMatch[2]} дейін қалыпты)` : `${filterNormMatch[1]} Pa (target up to ${filterNormMatch[2]})`;
  }
  const cyclesMatch = text.match(/^(\d+)\s+из\s+(\d+)\s+циклов$/);
  if (cyclesMatch) {
    return l === 'kk' ? `${cyclesMatch[2]} циклдің ${cyclesMatch[1]}` : `${cyclesMatch[1]} of ${cyclesMatch[2]} cycles`;
  }
  if (text.includes('незадолго до прохода')) {
    const isFault = text.startsWith('авария');
    const codeMatch = text.match(/код\s+([A-Za-z0-9_-]+)/);
    const codeStr = codeMatch ? (l === 'kk' ? `, ${codeMatch[1]} коды` : `, code ${codeMatch[1]}`) : '';
    if (isFault) {
      return l === 'kk' ? `өтер алдындағы апат${codeStr}` : `breakdown shortly before pass${codeStr}`;
    } else {
      return l === 'kk' ? `өтер алдындағы ТҚК${codeStr}` : `maintenance shortly before pass${codeStr}`;
    }
  }

  // Passport & Route Post names
  if (text.startsWith('Вход на участок ')) {
    const area = translateAreaName(text.replace('Вход на участок ', '').trim(), l);
    return l === 'kk' ? `${area} учаскесіне кіру` : `Entrance to ${area}`;
  }
  if (text.startsWith('Выход с участка ')) {
    const area = translateAreaName(text.replace('Выход с участка ', '').trim(), l);
    return l === 'kk' ? `${area} учаскесінен шығу` : `Exit from ${area}`;
  }
  if (text.startsWith('Вход: ')) {
    const area = translateAreaName(text.replace('Вход: ', '').trim(), l);
    return l === 'kk' ? `Кіру: ${area}` : `Entrance: ${area}`;
  }
  if (text.startsWith('Выход: ')) {
    const area = translateAreaName(text.replace('Выход: ', '').trim(), l);
    return l === 'kk' ? `Шығу: ${area}` : `Exit: ${area}`;
  }

  // Explain / Twin Rules & Calculations
  if (text.startsWith('Прогноз = выпущено')) {
    return l === 'kk'
      ? 'Болжам = шығарылған + ағымдағы ауысым қалдығы + қалған ауысымдар × соңғы 10 ауысым қарқыны − ашық инциденттердің күтілетін шығындары + таңдалған шаралар әсері. Дәліз — 200 рет есептеу: әр қалған ауысым кездейсоқ соңғы 20 нақты ауысымнан алынады.'
      : 'Forecast = produced + remainder of current shift + remaining shifts × pace of last 10 shifts − expected open incident losses + effect of selected levers. Corridor — 200 runs: each remaining shift is randomly sampled from last 20 actual shifts.';
  }
  if (text.startsWith('Наработка в циклах')) {
    return l === 'kk'
      ? 'Соңғы ТҚК-дан бергі циклдер бойынша өңделген уақыт, қызмет аралық интервалға қатысты, сондай-ақ тәулік ішіндегі бақылаушы қателік кодтары (егер қосылған болса). Нәтиже: төмен / орташа / жоғары.'
      : 'Operating cycles since last service vs maintenance interval, plus controller fault codes for the day (if connected). Result: low / medium / high.';
  }
  if (text.startsWith('Остаток комплектов из 1С:WMS')) {
    return l === 'kk'
      ? '1С:WMS жиынтықтарының қалдығын ауысымдық жоспарлы шығынға бөлеміз (үлгінің жоспардағы үлесі × 120). Екі ауысымнан аз — инцидент. Машина жиынтығы дәнекерлеуге толық беріледі: кез келген позициясыз желі жаңа шанақты бастамайды.'
      : 'Kit balance from 1C:WMS divided by planned consumption per shift (model share in plan × 120). Less than two shifts — incident. Kits are issued to welding completely: without any part, the model line cannot start a new body.';
  }
  if (text.startsWith('Средний ток привода за 10 минут')) {
    return l === 'kk'
      ? 'Жетектің 10 минуттағы орташа тогы әдеттегіден 1,8 А-ден астам жоғары немесе діріл 3,3 мм/с-тан жоғары — конвейер тізбегінің жақын арада үзілу белгісі.'
      : 'Average drive current over 10 min exceeds normal by >1.8 A or vibration >3.3 mm/s — sign of imminent conveyor chain break.';
  }
  if (text === 'Нерабочее время по производственному календарю') {
    return l === 'kk' ? 'Өндірістік күнтізбе бойынша жұмыс емес уақыт' : 'Non-working hours per production calendar';
  }
  if (text === 'Встала одна из параллельных станций: участок работает, но мощность ниже') {
    return l === 'kk' ? 'Параллель бекеттердің бірі тоқтады: учаске жұмыс істейді, бірақ қуаты төмен' : 'One of parallel stations stopped: area operating, but at reduced rate';
  }
  if (text === 'Контроллер оборудования сообщил о состоянии — самый точный источник') {
    return l === 'kk' ? 'Жабдық контроллері күй туралы хабарлады — ең нақты дереккөз' : 'Equipment controller reported status — most accurate source';
  }
  if (text === 'Мастер зарегистрировал простой одной из параллельных станций') {
    return l === 'kk' ? 'Шебер параллель бекеттердің бірінің тоқтап қалуын тіркеді' : 'Foreman logged downtime for one of parallel stations';
  }
  if (text === 'В 1С:MES простой одной из параллельных станций') {
    return l === 'kk' ? '1C:MES жүйесінде параллель бекеттердің бірі тоқтап тұр' : '1C:MES reports downtime for one of parallel stations';
  }
  if (text === 'Мастер зарегистрировал простой с телефона') {
    return l === 'kk' ? 'Шебер телефоннан тоқтауды тіркеді' : 'Foreman logged downtime from mobile';
  }
  if (text === 'Простой зарегистрирован в 1С:MES') {
    return l === 'kk' ? 'Тоқтау 1C:MES жүйесінде тіркелді' : 'Downtime logged in 1C:MES';
  }
  if (text.startsWith('Нет прохода VIN дольше 3 тактов и буфер после участка полон')) {
    return l === 'kk' ? 'VIN 3 такттан ұзақ өтпеді және учаскеден кейінгі буфер толы — ағын бойынша төменде мәселе' : 'No VIN progression for >3 tacts and downstream buffer full — issue downstream';
  }
  if (text.startsWith('Нет прохода VIN дольше 3 тактов и буфер перед участком пуст')) {
    return l === 'kk' ? 'VIN 3 такттан ұзақ өтпеді және учаске алдындағы буфер бос — ағын бойынша жоғарыда мәселе' : 'No VIN progression for >3 tacts and upstream buffer empty — issue upstream';
  }
  if (text.startsWith('Нет прохода VIN дольше 3 тактов, буфер перед участком не пуст')) {
    return l === 'kk' ? 'VIN 3 такттан ұзақ өтпеді, буфер бос емес әрі толық емес: учаскенің өзі тоқтап тұр' : 'No VIN progression for >3 tacts, buffers neither starved nor blocked: area stopped on its own';
  }
  if (text === 'Кузова проходят посты в такт, отклонений нет') {
    return l === 'kk' ? 'Шанақтар бекеттерден такт бойынша өтуде, ауытқулар жоқ' : 'Bodies moving through stations on tact, no deviations';
  }
  if (text === 'Мастер на месте не подтвердил сигнал об остановке — участок считаем работающим') {
    return l === 'kk' ? 'Шебер орнында тоқтау сигналын растамады — учаске жұмыс істеп тұр деп саналады' : 'Foreman on site dismissed stop signal — area considered running';
  }
  if (text.startsWith('Для каждого кузова с сорностью')) {
    return l === 'kk'
      ? 'Әр сорланған шанақ үшін өту кезіндегі сүзгі қысым айырмасын аламыз (1C:MES-тен VIN, контроллерден уақыт пен мән) және шектен жоғары және төмен ақау үлесін салыстырамыз.'
      : 'For each body with inclusions, we evaluate filter pressure drop during transit (VIN from 1C:MES, time and value from PLC) and compare scrap rate above vs below threshold.';
  }

  // Explain Conclusions & Assumptions
  const expConcl1 = text.match(/^Ожидаем\s+([\d,.]+)\s+—\s+план выполняется с запасом\s+([\d,.]+)$/);
  if (expConcl1) {
    return l === 'kk' ? `Күтілуде ${expConcl1[1]} — жоспар ${expConcl1[2]} көлік қорымен орындалуда` : `Expecting ${expConcl1[1]} — on track with ${expConcl1[2]} car reserve`;
  }
  const expConcl2 = text.match(/^Ожидаем\s+([\d,.]+)\s+—\s+не хватает\s+([\d,.]+)\s+машин[ыа]?$/);
  if (expConcl2) {
    return l === 'kk' ? `Күтілуде ${expConcl2[1]} — ${expConcl2[2]} көлік жетпейді` : `Expecting ${expConcl2[1]} — short by ${expConcl2[2]} cars`;
  }
  if (text === 'Риск обрыва цепи в ближайший час — высокий') {
    return l === 'kk' ? 'Алдағы бір сағатта тізбек үзілу қаупі — жоғары' : 'Conveyor chain break risk in next hour — high';
  }
  const shiftsLeftMatch = text.match(/^Хватит на\s+([\d,.]+)\s+смен[ыа]?$/);
  if (shiftsLeftMatch) {
    return l === 'kk' ? `${shiftsLeftMatch[1]} ауысымға жетеді` : `Sufficient for ${shiftsLeftMatch[1]} shifts`;
  }
  if (text === 'Выпуск на сейчас') return l === 'kk' ? 'Қазіргі шығарылым' : 'Produced so far';
  if (text === 'План на месяц') return l === 'kk' ? 'Айлық жоспар' : 'Monthly target';
  if (text === 'Осталось смен') return l === 'kk' ? 'Қалған ауысымдар' : 'Remaining shifts';
  if (text === 'Темп последних 10 смен') return l === 'kk' ? 'Соңғы 10 ауысым қарқыны' : 'Pace of last 10 shifts';
  if (text === 'Потери открытых инцидентов') return l === 'kk' ? 'Ашық инциденттер шығыны' : 'Open incident losses';
  if (text === 'Эффект мер What-If') return l === 'kk' ? 'What-If шараларының әсері' : 'What-If levers effect';
  if (text === 'Темп не упадёт ниже исторического минимума') return l === 'kk' ? 'Қарқын тарихи минимумнан төмен түспейді' : 'Pace will not drop below historical minimum';
  if (text === 'Новых аварий длительностью более 2 часов не произойдёт') return l === 'kk' ? '2 сағаттан ұзақ жаңа апаттар болмайды' : 'No new breakdowns longer than 2 hours will occur';

  // 3D Notice
  if (text === '3D недоступно на этом компьютере') {
    return l === 'kk' ? 'Бұл компьютерде 3D қолжетімсіз' : '3D is not available on this computer';
  }

  // Watch notifications
  if (text.endsWith(' готова и принята на склад') || text.endsWith(' готово и принято на склад')) {
    const car = text.replace(/ готов[оа] и принят[оа] на склад$/, '');
    return l === 'kk' ? `${car} дайын және қоймаға қабылданды` : `${car} finished and accepted to warehouse`;
  }
  if (text.includes(' перешла в ') || text.includes(' перешёл в ')) {
    const parts = text.split(/ переш[лё]л?а? в /);
    const car = parts[0]!;
    const dest = parts[1]!;
    const translatedDest = translateAreaName(dest.replace(/ку$/, 'ка').replace(/у$/, ''), l);
    return l === 'kk' ? `${car} «${translatedDest}» учаскесіне өтті` : `${car} moved to ${translatedDest}`;
  }

  // Sensor labels in 3D
  if (text.startsWith('Датчики привода ')) {
    const driveName = text.replace('Датчики привода ', '');
    return l === 'kk' ? `${translateEquipmentName(driveName, l)} жетек датчиктері` : `${translateEquipmentName(driveName, l)} drive sensors`;
  }
  if (text.startsWith('Датчик фильтра ')) {
    const boothName = text.replace('Датчик фильтра ', '');
    return l === 'kk' ? `${translateEquipmentName(boothName, l)} сүзгі датчигі` : `${translateEquipmentName(boothName, l)} filter sensor`;
  }

  // Area Metrics & Stock
  const stockMatch = text.match(/^запас на\s+([\d,.]+)\s+смен[ыа]?\s*·\s*(.*)$/);
  if (stockMatch) {
    const shifts = stockMatch[1];
    const kitName = stockMatch[2];
    return l === 'kk' ? `${kitName} · ${shifts} ауысымдық қор` : `${kitName} · stock for ${shifts} shifts`;
  }
  const defectMatch = text.match(/^брак\s+([\d,.]+%)\s*·\s*норма\s+([\d,.]+%?)$/);
  if (defectMatch) {
    return l === 'kk' ? `ақау ${defectMatch[1]} · норма ${defectMatch[2]}` : `scrap ${defectMatch[1]} · target ${defectMatch[2]}`;
  }
  const panelLoadMatch = text.match(/^загрузка\s+([\d,.]+%?)$/);
  if (panelLoadMatch) {
    return l === 'kk' ? `жүктеме ${panelLoadMatch[1]}` : `utilization ${panelLoadMatch[1]}`;
  }

  // Sensor Names & Values
  if (text === 'Ток') return l === 'kk' ? 'Ток' : 'Current';
  if (text === 'Вибрация') return l === 'kk' ? 'Діріл' : 'Vibration';
  if (text === 'Перепад давления') return l === 'kk' ? 'Қысым айырмасы' : 'Pressure drop';
  if (text === 'нет данных') return l === 'kk' ? 'деректер жоқ' : 'no data';
  const filterLimitMatch = text.match(/^([\d,.]+)\s+Па\s*·\s*норма до\s+(\d+)$/);
  if (filterLimitMatch) {
    return l === 'kk' ? `${filterLimitMatch[1]} Па · норма ${filterLimitMatch[2]} дейін` : `${filterLimitMatch[1]} Pa · target up to ${filterLimitMatch[2]}`;
  }

  // Work order decisions in 3D
  if (text.startsWith('Запланирована замена фильтра')) {
    const tMatch = text.match(/(\d{1,2}:\d{2})/);
    return l === 'kk' ? `Сүзгіні ауыстыру жоспарланды${tMatch ? ` ${tMatch[1]}` : ''}` : `Filter replacement scheduled${tMatch ? ` ${tMatch[1]}` : ''}`;
  }

  // Route step & operation details
  if (text === 'результат операции') return l === 'kk' ? 'операция нәтижесі' : 'operation result';
  if (text === 'выход со станции') return l === 'kk' ? 'бекеттен шығу' : 'station exit';
  if (text === 'выход участка') return l === 'kk' ? 'учаскеден шығу' : 'area exit';
  if (text === 'до начала отслеживания') return l === 'kk' ? 'қадағалау басталғанға дейін' : 'prior to tracking';

  // Loop & Side branch titles
  const loopBranchMatch = text.match(/^(Перекраска|Повторный проход),\s*(\d+)-й проход$/);
  if (loopBranchMatch) {
    const isPaint = loopBranchMatch[1] === 'Перекраска';
    const num = loopBranchMatch[2];
    if (l === 'kk') return `${isPaint ? 'Қайта бояу' : 'Қайта өткізу'}, ${num}-ші өту`;
    return `${isPaint ? 'Repaint' : 'Repeat pass'}, pass ${num}`;
  }
  if (text.startsWith('Выборочно: ')) {
    const sideName = text.replace('Выборочно: ', '').trim();
    return l === 'kk' ? `Таңдамалы: ${translateDynamicText(sideName, l)}` : `Sample: ${translateDynamicText(sideName, l)}`;
  }

  // Event & method labels
  if (text === 'Сканер 1С:MES') return l === 'kk' ? '1С:MES сканері' : '1C:MES Scanner';
  if (text === 'RFID тележки') return l === 'kk' ? 'Арбаның RFID' : 'Cart RFID';
  if (text === 'Инструмент поста') return l === 'kk' ? 'Бекет құралы' : 'Post tool';
  if (text === 'Контроллер') return l === 'kk' ? 'Контроллер' : 'PLC';
  if (text === 'Мастер') return l === 'kk' ? 'Шебер' : 'Shop master';
  if (text === 'Двойник') return l === 'kk' ? 'Сандық егіз' : 'Digital twin';

  // Body Appearance Labels
  if (text === 'машинокомплект') return l === 'kk' ? 'машина жиынтығы' : 'assembly kit';
  if (text === 'готовая машина') return l === 'kk' ? 'дайын көлік' : 'finished vehicle';
  if (text === 'на стенде') return l === 'kk' ? 'стендте' : 'on test bench';
  if (text === 'сборка') return l === 'kk' ? 'құрастыру' : 'assembly';
  if (text === 'в цвете') return l === 'kk' ? 'түсті' : 'painted';
  if (text === 'грунт') return l === 'kk' ? 'топырақ (грунт)' : 'primer';
  if (text === 'катафорез') return l === 'kk' ? 'катафорез' : 'e-coat';
  if (text === 'металл') return l === 'kk' ? 'металл' : 'bare metal';

  return text;
}
