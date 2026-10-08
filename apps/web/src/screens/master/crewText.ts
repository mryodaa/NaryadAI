// Слова рабочего места мастера: текст сигнала собираем из полей на языке интерфейса.
// Сигнал — не факт: всегда «Похоже, …» и кто заметил.
import type { CrewRequest, CrewSignal, PlantModel } from '@allur/contracts/ref';
import type { Lang, Translations } from '../../i18n/types';
import { translateDynamicText, translateEquipmentName } from '../../i18n/translator';
import { timeHM } from '../../lib/format';

export function areaShort(model: PlantModel, t: Translations, id: string): string {
  return t.domain.areas[id]?.short ?? model.stageById.get(id)?.short ?? id;
}

export function equipmentName(model: PlantModel, id: string | undefined, lang: Lang): string {
  if (!id) return '';
  return translateEquipmentName(model.equipmentById.get(id)?.name ?? id, lang);
}

export function signalText(sig: CrewSignal, model: PlantModel, t: Translations, lang: Lang): string {
  switch (sig.kind) {
    case 'stop':
      return t.crew.seemsEqStopped(equipmentName(model, sig.equipmentId, lang), timeHM(sig.since));
    case 'no_flow':
      return t.crew.seemsNoFlow(areaShort(model, t, sig.area), sig.minutes);
    default:
      // участок и так в шапке: «Окраска: брак 10,7% и растёт» → «Похоже: брак 10,7% и растёт»
      return t.crew.seems(lowerFirst(translateDynamicText(sig.title, lang).replace(/^[^:]{1,40}:\s+/, '')));
  }
}

/** Что сделать по запросу: «Замена фильтра: Камера-02»; без наряда — вариант решения как есть */
export function requestText(req: CrewRequest, model: PlantModel, t: Translations, lang: Lang): string {
  const job = req.action ? t.crew.jobs[req.action] : undefined;
  if (!job) return translateDynamicText(req.text, lang);
  const where = req.equipmentId ? equipmentName(model, req.equipmentId, lang) : areaShort(model, t, req.area);
  return job(where);
}

/** «только MES», «контроллер и MES» */
export function sourcesText(sources: string[], t: Translations): string {
  const words = sources.map((s) => t.crew.sources[s] ?? s);
  if (words.length === 0) return '';
  if (words.length === 1) return t.crew.onlySource(words[0]!);
  return `${words.slice(0, -1).join(', ')}${t.crew.and}${words[words.length - 1]}`;
}

export function minutesBetween(from?: string, to?: string, nowIso?: string): number | null {
  if (!from) return null;
  const end = to ?? nowIso;
  if (!end) return null;
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(from)) / 60_000));
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}
