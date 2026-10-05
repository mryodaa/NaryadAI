import { MARGIN_PER_CAR, REJECT_NORM, SHIFT_PLAN, STATIONS } from './config';
import { kitsCoverage, kpis, riskItems, type LineAnalysis } from './analytics';
import type { Forecast } from './forecast';
import type { SimState } from './types';
import { clock, dur, money, pct } from '../lib/format';

/**
 * Эмулятор LLM-ассистента. В продукте здесь будет запрос к языковой модели
 * с инструментами (tool use) поверх API двойника. В демо ответы собираются
 * из тех же данных по шаблонам — чтобы показать формат и пользу.
 */

export interface BriefLine {
  tone: 'neutral' | 'good' | 'warning' | 'critical';
  text: string;
}

export function briefing(s: SimState, fc: Forecast, la: LineAnalysis): BriefLine[] {
  const k = kpis(s);
  const lines: BriefLine[] = [];
  const diff = s.shift.shipped - k.plan;
  lines.push({
    tone: diff >= -3 ? 'good' : 'warning',
    text: `Смена ${s.shift.index + 1}, ${clock(s.t)}. Выпущено ${Math.round(s.shift.shipped)} авто при плане на этот час ${Math.round(k.plan)} (${diff >= 0 ? '+' : '−'}${Math.abs(Math.round(diff))}). OEE ${pct(k.oee)}.`,
  });
  const gap = SHIFT_PLAN - fc.endShipped;
  if (gap > 3) {
    const why = fc.failures.length
      ? ` Главная причина — прогнозируемый отказ: ${fc.failures.map((f) => `${s.equipment.find((e) => e.id === f.equipId)!.name} около ${clock(f.t)}`).join(', ')}.`
      : '';
    lines.push({
      tone: 'critical',
      text: `Прогноз на конец смены: ${Math.round(fc.endShipped)} из ${SHIFT_PLAN}. Недовыпуск ${Math.round(gap)} авто ≈ ${money(gap * MARGIN_PER_CAR)}.${why}`,
    });
  } else {
    lines.push({ tone: 'good', text: `Прогноз на конец смены: ${Math.round(fc.endShipped)} из ${SHIFT_PLAN} — план выполняется.` });
  }
  const items = riskItems(s, la);
  if (items.length) {
    const top = items[0];
    lines.push({
      tone: 'warning',
      text: `Главный риск — ${top.title}: ${top.detail}${top.ttf ? `, отказ ожидается через ~${dur(top.ttf)}` : ''}. Под угрозой ≈ ${money(top.rub)}.`,
    });
  }
  lines.push({
    tone: 'neutral',
    text: `Узкое место — ${STATIONS[la.bottleneck].short} (${Math.round(la.lineRate * 60)} авто/ч). Час его простоя стоит ${money(la.costPerHour[la.bottleneck])}.`,
  });
  if (k.rejectRate > REJECT_NORM) {
    lines.push({ tone: 'warning', text: `Брак на ОТК ${pct(k.rejectRate, 1)} — выше нормы ${pct(REJECT_NORM)}.` });
  }
  const newOrders = s.orders.filter((o) => o.status === 'new').length;
  const supplyNeeded = items.some((i) => i.kind === 'supply') && !s.kits.expedited;
  const asks = [
    newOrders ? `назначить ${newOrders} ${newOrders === 1 ? 'наряд' : 'наряда'}` : '',
    supplyNeeded ? 'решить вопрос с экстренной поставкой комплектующих' : '',
  ].filter(Boolean);
  lines.push({
    tone: asks.length ? 'warning' : 'good',
    text: asks.length ? `Нужны ваши решения: ${asks.join('; ')}. Рекомендации — в блоке «Решения».` : 'Решений от вас сейчас не требуется.',
  });
  return lines;
}

export const QUESTIONS = [
  { id: 'plan', q: 'Выполним ли план смены?' },
  { id: 'oee', q: 'Почему мы теряем OEE?' },
  { id: 'risk', q: 'Что под угрозой в ближайшие 4 часа?' },
  { id: 'bottleneck', q: 'Где узкое место и сколько стоит простой?' },
] as const;

export type QuestionId = (typeof QUESTIONS)[number]['id'];

export function answer(id: QuestionId, s: SimState, fc: Forecast, la: LineAnalysis): string {
  const k = kpis(s);
  if (id === 'plan') {
    const gap = SHIFT_PLAN - fc.endShipped;
    let t = `По прогнозу двойника к концу смены (${clock(fc.shiftEnd)}) будет выпущено ${Math.round(fc.endShipped)} авто из ${SHIFT_PLAN}. `;
    if (gap <= 3) t += 'План выполняется с учётом текущего темпа и средних микропростоев.';
    else {
      t += `Недовыпуск ≈ ${Math.round(gap)} авто (${money(gap * MARGIN_PER_CAR)}). `;
      if (fc.failures.length)
        t += `Основная причина — ожидаемый отказ ${fc.failures.map((f) => s.equipment.find((e) => e.id === f.equipId)!.name).join(', ')}. Плановое ТО сейчас позволит избежать большей части потерь — откройте «Сравнить решения».`;
      else if (kitsCoverage(s) < 60) t += 'Причина — нехватка комплектующих на сборке. Рекомендую запросить экстренную поставку.';
      else t += `Темп линии ограничивает участок «${STATIONS[la.bottleneck].short}».`;
    }
    return t;
  }
  if (id === 'oee') {
    const losses = Object.entries(s.shift.lossMin)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    let t = `OEE смены — ${pct(k.oee)}: доступность ${pct(k.A)}, производительность ${pct(k.P)}, качество ${pct(k.Q)}. `;
    const weakest = [
      ['доступность', k.A],
      ['производительность', k.P],
      ['качество', k.Q],
    ].sort((a, b) => (a[1] as number) - (b[1] as number))[0][0];
    t += `Слабее всего — ${weakest}. `;
    if (losses.length) t += `Крупнейшие потери времени: ${losses.map(([c, v]) => `${c.toLowerCase()} — ${dur(v)}`).join(', ')}.`;
    return t;
  }
  if (id === 'risk') {
    const items = riskItems(s, la).filter((i) => i.kind !== 'equipment' || (i.ttf != null && i.ttf < 240) || (i.p ?? 0) > 0.5);
    if (!items.length) return 'В ближайшие 4 часа значимых рисков не видно: оборудование в норме, комплектующих достаточно, брак в пределах нормы.';
    return (
      'Ближайшие риски, по убыванию денег под угрозой:\n' +
      items
        .slice(0, 4)
        .map((i, n) => `${n + 1}. ${i.title} — ${i.detail}${i.ttf ? `, отказ через ~${dur(i.ttf)}` : ''}. ≈ ${money(i.rub)}`)
        .join('\n')
    );
  }
  const b = la.bottleneck;
  const others = STATIONS.map((d, i) => ({ d, i }))
    .filter((x) => x.i !== b)
    .map((x) => `${x.d.short} — буфер защищает ${dur(la.protect[x.i])}, час простоя ${money(la.costPerHour[x.i])}`);
  return `Сейчас темп линии задаёт «${STATIONS[b].name}»: ${Math.round(la.lineRate * 60)} авто/ч. Каждый час его простоя — ${money(la.costPerHour[b])} потерянной маржи, без защиты буферами.\nОстальные участки:\n${others.join('\n')}`;
}
