// «Отчёт по инциденту»: что случилось, сигналы и их источники, проверка на месте (кто и когда подтвердил),
// варианты с расчётом двойника, выбранный вариант, переписка «руководитель — мастер», результат.
import type { CrewRequest } from '@allur/contracts';
import type { Incident } from '@allur/twin-core';
import { fileWord, fmtDateTime, fmtInt } from './format';
import { MONEY_NOTE, type ReportDoc, type Row } from './model';
import { REQUEST_STATUS_RU, ReportError, SOURCE_RU, areaName, baseMeta, eqName, type ReportParams, type ReportSource } from './source';

const STATUS_RU: Record<Incident['status'], string> = { open: 'Открыт', decided: 'Решение принято', resolved: 'Закрыт' };
const CHECK_RU: Record<string, string> = {
  signal: 'Сигнал, не подтверждён: заметил один источник',
  probable: 'Сигнал, не подтверждён: совпали два источника',
  confirmed: 'Подтверждён человеком на месте',
  rejected: 'Мастер не подтвердил',
};
const TYPE_RU: Record<Incident['type'], string> = {
  quality: 'Брак',
  stop: 'Остановка',
  equipment: 'Оборудование',
  stock: 'Комплектующие',
  early_warning: 'Раннее предупреждение',
};
const NO_RU: Record<string, string> = { sensor_wrong: 'датчик ошибся', mes_missing: 'нет отметки в MES', planned_stop: 'плановая остановка', other: 'другое' };
const CANT_RU: Record<string, string> = { no_people: 'нет людей', no_parts: 'нет запчастей', no_window: 'нет окна в работе' };

/** Переписка по запросу: из отметок времени запроса */
function trail(r: CrewRequest): Row[] {
  const rows: Row[] = [{ at: Date.parse(r.at), who: r.by || 'Руководитель', what: `Запрос мастеру: ${r.text}. Срок ${fmtDateTime(Date.parse(r.dueAt))}` }];
  if (r.viewedAt) rows.push({ at: Date.parse(r.viewedAt), who: r.recipient, what: 'Просмотрел запрос' });
  if (r.answeredAt) {
    const what =
      r.status === 'cant' || r.cantReason
        ? `Не могу: ${CANT_RU[r.cantReason ?? ''] ?? r.cantReason ?? ''}${r.cantText ? ` («${r.cantText}»)` : ''}`
        : r.counter
          ? `Предложил иначе: ${r.counter.at ? fmtDateTime(Date.parse(r.counter.at)) : 'другое время'}${r.counter.text ? ` («${r.counter.text}»)` : ''}`
          : 'Принял';
    rows.push({ at: Date.parse(r.answeredAt), who: r.recipient, what });
  }
  if (r.managerAnswer) rows.push({ at: null, who: r.by || 'Руководитель', what: r.managerAnswer === 'agree' ? 'Согласен с предложением мастера' : 'Оставить как было' });
  if (r.workOrderAt) rows.push({ at: null, who: 'Двойник', what: `Наряд ушёл в цех на ${fmtDateTime(Date.parse(r.workOrderAt))}` });
  if (r.doneAt) rows.push({ at: Date.parse(r.doneAt), who: r.recipient, what: 'Сделано' });
  return rows;
}

export function buildIncidentReport(src: ReportSource, p: ReportParams): ReportDoc {
  if (!p.incidentId) throw new ReportError(400, 'Укажите инцидент: incidentId=…');
  const inc = src.twin.incident(p.incidentId) as Incident | undefined;
  if (!inc) throw new ReportError(404, 'Инцидент не найден');
  const requests = src.crew.desk.all().filter((r) => r.incidentId === inc.id);
  const crewSignal = src.crew.allSignals().find((s) => s.incidentId === inc.id);
  const v = inc.verdict;
  const checkLines: string[] = [];
  if (inc.check) checkLines.push(`Статус: ${CHECK_RU[inc.check] ?? inc.check}`);
  if (inc.checkSources?.length) checkLines.push(`Кто заметил: ${inc.checkSources.map(SOURCE_RU).join(', ')}`);
  if (v) checkLines.push(`${v.verdict === 'yes' ? 'Подтвердил' : 'Не подтвердил'}: ${v.by ?? 'мастер'}, ${fmtDateTime(v.at)}${v.reason ? ` — ${NO_RU[v.reason] ?? v.reason}` : ''}`);
  else if (crewSignal?.answeredBy) checkLines.push(`Ответ мастера: ${crewSignal.answeredBy}`);
  if (!checkLines.length) checkLines.push('Проверка на месте для этого вида инцидента не требуется (данные систем завода)');

  const result =
    inc.status === 'resolved'
      ? `Закрыт ${inc.resolvedAt ? fmtDateTime(inc.resolvedAt) : ''}: ситуация разрешилась${inc.decision ? ` после решения «${inc.decision.title}»` : ''}`
      : inc.status === 'decided'
        ? `Решение принято, ждём результата${requests.length ? `; запрос мастеру — ${REQUEST_STATUS_RU[requests[requests.length - 1]!.status].toLowerCase()}` : ''}`
        : 'Открыт, решение не принято';

  return {
    title: 'Отчёт по инциденту',
    subtitle: inc.title,
    fileBase: `Инцидент_${fileWord(areaName(src, inc.area, true))}_${fileWord(inc.id)}`,
    meta: baseMeta(src, p, [
      ['Инцидент', `${inc.id} · ${TYPE_RU[inc.type] ?? inc.type}`],
      ['Участок', areaName(src, inc.area)],
      ['Оборудование', eqName(src, inc.equipmentId)],
      ['Открыт', fmtDateTime(inc.openedAt)],
      ['Статус', STATUS_RU[inc.status]],
    ]),
    sections: [
      {
        kind: 'text',
        title: 'Что случилось и почему',
        lines: [
          `${fmtDateTime(inc.happened.at)} — ${inc.happened.text}`,
          `Почему: ${inc.why.text}`,
          ...inc.why.chain.map((c) => `• ${c.label}: ${c.value}${c.source ? ` (${SOURCE_RU(c.source)})` : ''}`),
          `Чем грозит: ${inc.threat.text}`,
        ],
      },
      {
        kind: 'kpis',
        title: 'Угроза по расчёту двойника',
        items: [
          { label: 'Недовыпуск машин', value: inc.threat.carsLost, type: 'int' },
          { label: 'Перекрасок', value: inc.threat.repaints, type: 'int' },
          { label: 'Потери, условно', value: inc.threat.money, type: 'money', note: 'условно' },
        ],
      },
      {
        kind: 'table',
        table: {
          title: 'Сигналы и источники',
          columns: [
            { key: 'at', title: 'Время', type: 'datetime', weight: 1.3 },
            { key: 'source', title: 'Источник', type: 'text', weight: 1.2 },
            { key: 'text', title: 'Что', type: 'text', weight: 4 },
            { key: 'code', title: 'Код', type: 'text', weight: 0.8 },
          ],
          rows: inc.signals.map((s) => ({ at: s.ts, source: SOURCE_RU(s.source), text: s.text, code: s.code ?? '' })),
          empty: 'Сигналов нет',
          note: inc.check === 'signal' || inc.check === 'probable' ? 'Сигнал, не подтверждён: на месте его ещё никто не проверил.' : undefined,
        },
      },
      { kind: 'text', title: 'Проверка на месте', lines: checkLines },
      {
        kind: 'table',
        table: {
          title: 'Варианты решения (расчёт двойника)',
          columns: [
            { key: 'title', title: 'Вариант', type: 'text', weight: 2.6 },
            { key: 'cars', title: 'Недовыпуск, машин', type: 'int', weight: 0.9 },
            { key: 'repaints', title: 'Перекрасок', type: 'int', weight: 0.8 },
            { key: 'direct', title: 'Прямые затраты, условно', type: 'money', weight: 1.2 },
            { key: 'total', title: 'Итого потери, условно', type: 'money', weight: 1.2 },
            { key: 'risk', title: 'Риск', type: 'text', weight: 0.8 },
            { key: 'chosen', title: 'Выбран', type: 'text', weight: 0.7 },
          ],
          rows: inc.options.map((o) => ({
            title: `${o.title}${o.recommended ? ' (рекомендация двойника)' : ''}`,
            cars: o.carsLost,
            repaints: o.repaints,
            direct: o.directCost,
            total: o.totalCost,
            risk: o.risk,
            chosen: inc.decision?.optionId === o.id ? 'да' : '',
          })),
          highlight: (r) => r.chosen === 'да',
          empty: 'Вариантов нет',
          note: MONEY_NOTE,
        },
      },
      {
        kind: 'text',
        title: 'Выбранный вариант',
        lines: inc.decision
          ? [`${inc.decision.title}`, `Кто и когда: ${inc.decision.decidedBy ?? 'руководитель'}, ${fmtDateTime(inc.decision.decidedAt)}`, `Наряд: ${inc.decision.workOrderId}`]
          : ['Решение не принято'],
      },
      {
        kind: 'table',
        table: {
          title: 'Переписка «руководитель — мастер»',
          columns: [
            { key: 'at', title: 'Когда', type: 'datetime', weight: 1.3 },
            { key: 'who', title: 'Кто', type: 'text', weight: 1.4 },
            { key: 'what', title: 'Что', type: 'text', weight: 4.5 },
          ],
          rows: requests.flatMap(trail),
          empty: 'Запросов мастеру по этому инциденту не было',
        },
      },
      { kind: 'text', title: 'Результат', lines: [result, `Ожидаемые потери без решения: ${fmtInt(inc.threat.carsLost)} машин (расчёт двойника).`] },
    ],
  };
}
