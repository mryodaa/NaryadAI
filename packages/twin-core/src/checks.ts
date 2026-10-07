// Проверка данных на противоречия — часть ценности двойника, а не баг.
// Показывается на экране «Источники данных» и в ответе на импорт CSV.
import { monthShifts, plantParts, stageOfKind, type AreaId } from '@allur/contracts';
import type { TwinConfig } from './config';
import type { TwinState } from './state';
import { ddmm, num, num1, plural } from './text';

export interface DataCheck {
  id: string;
  severity: 'contradiction' | 'norm';
  title: string;
  detail: string;
  source: string;
}

export function dataChecks(state: TwinState, cfg: TwinConfig, month = '2026-10'): DataCheck[] {
  const out: DataCheck[] = [];
  // Проверки выданных таблиц: в них три линии — сварка, окраска, сборка
  const kindOf = (area: AreaId) => state.plant.stageById.get(area)?.kind;
  const areaRu = (area: AreaId) => (['welding', 'painting', 'assembly'].includes(kindOf(area) ?? '') ? state.plant.stageById.get(area)?.short : undefined);
  const paintId = stageOfKind(state.plant, 'painting')?.id;
  const asmId = stageOfKind(state.plant, 'assembly')?.id;

  // 1. План по моделям против целевого плана
  const plan = state.plans.get(month);
  if (plan) {
    const sum = plan.models.reduce((a, m) => a + m.qty, 0);
    const target = plan.target ?? cfg.monthTargetDefault;
    if (sum !== target) {
      out.push({
        id: 'plan-models-vs-target',
        severity: 'contradiction',
        title: `Сумма плана по моделям — ${num(sum)}, а целевой план — ${num(target)}`,
        detail: `Onix ${num(plan.models.find((m) => m.model === 'onix')?.qty ?? 0)} + Cobalt ${num(plan.models.find((m) => m.model === 'cobalt')?.qty ?? 0)} + J7 ${num(plan.models.find((m) => m.model === 'j7')?.qty ?? 0)} = ${num(sum)}. Двойник считает от ${num(target)} и делит по моделям пропорционально.`,
        source: '1С:ERP, план месяца',
      });
    }
    // 2. План не помещается в рабочие смены
    const shifts = monthShifts(month);
    const weekday = shifts.filter((s) => plantParts(s.startMs).weekday <= 5).length;
    if (weekday * cfg.shiftPlan < target) {
      out.push({
        id: 'plan-vs-capacity',
        severity: 'contradiction',
        title: `План ${num(target)} не помещается в будни месяца`,
        detail: `${weekday / 2} ${plural(weekday / 2, ['рабочий день', 'рабочих дня', 'рабочих дней'])} × 2 смены × ${cfg.shiftPlan} машин = ${num(weekday * cfg.shiftPlan)} даже без единой минуты простоя. Допущение: в плане учтены рабочие субботы (сейчас смен в месяце — ${shifts.length}, мощность ${num(shifts.length * cfg.shiftPlan)}).`,
        source: 'производственный календарь и такт',
      });
    }
  }

  // 3. Сборка выпустила больше, чем ей передала окраска (без буфера невозможно)
  const byKey = new Map<string, { weld?: number; paint?: number; assembly?: number; hours: Partial<Record<AreaId, number>> }>();
  for (const r of state.reports.values()) {
    const k = `${r.date}#${r.shift}`;
    const v = byKey.get(k) ?? { hours: {} };
    const kind = kindOf(r.area);
    if (kind === 'welding') v.weld = r.fact;
    else if (r.area === paintId) v.paint = r.fact;
    else if (r.area === asmId) v.assembly = r.fact;
    v.hours[r.area] = r.hours;
    byKey.set(k, v);
  }
  const imported = (date: string) => date === '2026-10-01' || date === '2026-10-02';
  for (const [k, v] of byKey) {
    const [date] = k.split('#');
    if (!imported(date!)) continue;
    if (v.assembly !== undefined && v.paint !== undefined && v.assembly > v.paint) {
      out.push({
        id: `assembly-gt-paint-${k}`,
        severity: 'contradiction',
        title: `${ddmmFromDate(date!)}: сборка выпустила ${v.assembly}, а окраска передала ${v.paint}`,
        detail: 'Без запаса кузовов в буфере перед сборкой так не бывает. Нужно уточнить остаток буфера на начало смены или время отчёта.',
        source: '1С:MES, сменный отчёт',
      });
    }
    const asmHours = asmId ? v.hours[asmId] : undefined;
    if (v.assembly !== undefined && v.assembly > cfg.shiftPlan && (asmHours ?? 8) <= 8) {
      out.push({
        id: `over-takt-${k}`,
        severity: 'contradiction',
        title: `${ddmmFromDate(date!)}: сборка — ${v.assembly} машин за ${num1(asmHours ?? 8)} ч`,
        detail: `При такте ${cfg.taktMin} мин за 8 часов помещается не больше ${cfg.shiftPlan} машин.`,
        source: '1С:MES, сменный отчёт',
      });
    }
  }

  // 4. Время работы около 8 часов в сутки при норме 2 смены
  const dates = new Set<string>();
  for (const r of state.reports.values()) if (imported(r.date) && r.hours > 0) dates.add(r.date);
  for (const date of dates) {
    const second = [...state.reports.values()].some((r) => r.date === date && r.shift === 2 && r.source === 'import');
    const first = [...state.reports.values()].filter((r) => r.date === date && r.source === 'import');
    if (first.length && !second) {
      out.push({
        id: `hours-${date}`,
        severity: 'contradiction',
        title: `${ddmmFromDate(date)}: время работы линий ~8 ч в сутки при норме 2 смены по 8 ч`,
        detail: 'В таблице одна строка на линию в сутки. Допущение: строка — первая смена, вторая смена берётся из 1С:MES.',
        source: 'выданная таблица «Работа линий»',
      });
      break;
    }
  }

  // Одна и та же запись простоя может прийти из истории 1С и из импорта таблицы — берём один раз
  const uniq = new Map<string, (typeof state.downtimes extends Map<string, infer V> ? V : never)>();
  for (const d of state.downtimes.values()) {
    const k = `${plantParts(d.from).date}|${d.equipmentId}|${d.reason.toLowerCase()}`;
    if (!uniq.has(k)) uniq.set(k, d);
  }
  // 5. Простой не сходится со временем работы линии
  for (const d of uniq.values()) {
    const date = plantParts(d.from).date;
    if (!imported(date) || d.to === null) continue;
    const mins = (d.to - d.from) / 60_000;
    const rep = state.reports.get(`${date}#1|${d.area}`);
    if (!rep || d.category === 'planned') continue;
    const lostMin = Math.max(0, 480 - rep.hours * 60);
    if (mins - lostMin > 30) {
      out.push({
        id: `downtime-vs-hours-${d.key}`,
        severity: 'contradiction',
        title: `${ddmmFromDate(date)}: простой ${num(mins)} мин (${d.reason.toLowerCase()}), а ${areaRu(d.area)?.toLowerCase() ?? 'участок'} отработала ${num1(rep.hours)} ч`,
        detail: `По сменному отчёту потеряно только ${num(lostMin)} мин и выпущено ${rep.fact} из ${rep.plan}. Либо простой был во второй смене, либо время в отчёте неточное.`,
        source: '1С:MES: журнал простоев и сменный отчёт',
      });
    }
  }

  // 6. Лимит простоя критического оборудования (норма 60 мин в сутки)
  const perDay = new Map<string, number>();
  for (const d of uniq.values()) {
    if (d.category === 'planned' || d.to === null) continue;
    const date = plantParts(d.from).date;
    if (!imported(date)) continue;
    perDay.set(date, (perDay.get(date) ?? 0) + (d.to - d.from) / 60_000);
  }
  for (const [date, mins] of perDay) {
    if (mins > cfg.criticalDowntimeLimitMin) {
      out.push({
        id: `limit-${date}`,
        severity: 'norm',
        title: `${ddmmFromDate(date)}: простой критического оборудования ${num(mins)} мин при лимите ${cfg.criticalDowntimeLimitMin}`,
        detail: 'Сумма внеплановых простоев за сутки по журналу.',
        source: '1С:MES, журнал простоев',
      });
    }
  }
  // 7. Отметки кузовов не по порядку: трекер не применил их (последние 10)
  const tr = state.tracker;
  for (const c of tr.contradictions.slice(-10).reverse()) {
    out.push({
      id: `body-order-${c.bodyId}-${c.ts}`,
      severity: 'contradiction',
      title: `Кузов ${c.vin ?? c.bodyId}: отметка не по порядку`,
      detail: c.text,
      source: '1С:MES и контроллеры: отметки кузова',
    });
  }
  // 8. Пропущенные и повторные отметки: восстановлены по маршруту и отброшены
  let restored = 0;
  for (const b of tr.bodies.values()) restored += b.history.filter((h) => h.restored).length;
  if (restored > 0 || tr.duplicates > 0) {
    out.push({
      id: 'body-marks',
      severity: 'contradiction',
      title: `Отметки кузовов: ${restored} пропущено и восстановлено по маршруту, ${tr.duplicates} повторов не учтено`,
      detail: 'Пропущенную отметку двойник достраивает по маршруту и помечает в паспорте как восстановленную; повтор той же отметки в течение минуты не учитывается.',
      source: '1С:MES и контроллеры: отметки кузова',
    });
  }
  return out.filter((x, i) => out.findIndex((y) => y.title === x.title) === i);
}

function ddmmFromDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

export { ddmm };
