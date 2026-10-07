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

export function translateArea(areaId: string, lang?: Lang, format: 'name' | 'short' = 'name'): string {
  const l = currentLang(lang);
  const dict = LOCALES[l].domain.areas[areaId];
  if (dict) return format === 'short' ? dict.short : dict.name;
  return areaId;
}

export function translateStatus(status: string, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.statuses[status] ?? status;
}

export function translateEquipmentStatus(status: string, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.equipmentStatuses[status] ?? status;
}

export function translateRisk(risk: string, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.risks[risk] ?? risk;
}

export function translateDowntimeCategory(category: string, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.downtimeCategories[category] ?? category;
}

export function translateDefect(defectId: string, lang?: Lang): string {
  const l = currentLang(lang);
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

/**
 * Перевод динамических строк, генерируемых ядром двойника (заголовки инцидентов, опции решений, рекомендации).
 */
export function translateDynamicText(text: string, lang?: Lang): string {
  const l = currentLang(lang);
  if (!text || l === 'ru') return text;

  // Domain lookup (statuses, equipmentStatuses, risks, downtimeCategories, defects)
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

  // Опции решений
  if (text.startsWith('Заменить фильтр в пересменку')) {
    const timeMatch = text.match(/(\d{1,2}:\d{2})/);
    const timeStr = timeMatch ? timeMatch[1] : '';
    return l === 'kk'
      ? `Сүзгіні ауысым ауысқанда ауыстыру${timeStr ? ` (${timeStr})` : ''}`
      : `Replace filter during shift handover${timeStr ? ` (${timeStr})` : ''}`;
  }
  if (text === 'Заменить фильтр сейчас' || text.startsWith('Заменить фильтр')) {
    return l === 'kk' ? 'Сүзгіні қазір ауыстыру' : 'Replace filter now';
  }
  if (text === 'Ничего не делать') {
    return l === 'kk' ? 'Ештеңе істемеу' : 'Do nothing';
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

  // Заголовки инцидентов
  if (text.includes('растёт ток привода')) {
    return l === 'kk' ? 'Конвейер жетегінің тогы өсуде' : 'Conveyor drive current rising';
  }
  if (text.includes('ресурс до ТО')) {
    const m = text.match(/(\d+)\s*%/);
    const pct = m ? ` ${m[1]}%` : '';
    return l === 'kk' ? `ТҚК дейінгі ресурс${pct}` : `PM resource left${pct}`;
  }
  if (text.includes('брак') && text.includes('растёт')) {
    return l === 'kk' ? 'Ақау үлесі нормадан жоғары және өсуде' : 'Defect rate above norm and rising';
  }
  if (text.includes('стоит:')) {
    return l === 'kk' ? 'Учаске тоқтап тұр' : 'Area stopped';
  }
  if (text.includes('снижена мощность')) {
    return l === 'kk' ? 'Учаске қуаты төмендеген' : 'Area running at reduced rate';
  }

  // Общие фразы рекомендаций
  if (text === 'Рекомендуем') return l === 'kk' ? 'Ұсынамыз' : 'Recommended';
  if (text === 'Принять') return l === 'kk' ? 'Қабылдау' : 'Accept';
  if (text === 'Отправляю…') return l === 'kk' ? 'Жіберілуде…' : 'Sending…';

  return text;
}

export function translateAreaName(name: string, _lang?: Lang): string {
  return name;
}

export function translateEquipmentName(name: string, _lang?: Lang): string {
  return name;
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

export function translateRiskLevel(level: string, lang?: Lang): string {
  const l = currentLang(lang);
  return LOCALES[l].domain.risks[level] ?? level;
}
