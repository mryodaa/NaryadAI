// «План и прогноз месяца»: по дням накопленный план и факт, коридор P10/P50/P90; по моделям — план, выпуск
// и прогноз; потери по причинам. Тот же расчёт, что на экране «План» (GET /api/v1/forecast без рычагов).
import { fmtInt } from './format';
import type { ReportDoc, Row } from './model';
import { ReportError, baseMeta, type ReportParams, type ReportSource } from './source';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export function buildPlanReport(src: ReportSource, p: ReportParams): ReportDoc {
  const f = src.forecast();
  if (!f) throw new ReportError(503, 'Прогноз появится, когда двойник получит историю');
  const [y, m] = f.month.split('-').map(Number);
  const monthText = `${MONTHS[m! - 1]} ${y}`;
  let prevPlan = 0;
  let prevFact = 0;
  const days: Row[] = f.days.map((d) => {
    const row: Row = {
      date: Date.parse(`${d.date}T12:00:00+05:00`),
      planDay: d.plan - prevPlan,
      plan: d.plan,
      factDay: d.fact !== null ? d.fact - prevFact : null,
      fact: d.fact,
      p10: d.p10,
      p50: d.p50,
      p90: d.p90,
    };
    prevPlan = d.plan;
    if (d.fact !== null) prevFact = d.fact;
    return row;
  });
  return {
    title: 'План и прогноз месяца',
    subtitle: `${monthText} · план ${fmtInt(f.target)} машин`,
    fileBase: `План_и_прогноз_${f.month}`,
    summarySheet: 'Итог',
    meta: baseMeta(src, p, [
      ['Месяц', monthText],
      ['Источник плана', '1С:ERP (план на месяц по моделям)'],
    ]),
    sections: [
      {
        kind: 'kpis',
        title: 'Итог',
        items: [
          { label: 'План месяца', value: f.target, type: 'int' },
          { label: 'Выпущено', value: f.produced, type: 'int' },
          { label: 'Прогноз P50', value: f.p50, type: 'int', bad: !f.onTrack, note: `коридор P10–P90: ${fmtInt(f.p10)}–${fmtInt(f.p90)}` },
          { label: 'Отставание от плана по прогнозу', value: f.gap, type: 'int', bad: f.gap > 0 },
          { label: 'Темп, машин в смену', value: f.paceShifts, type: 'dec1' },
          { label: 'Осталось смен', value: f.remainingShifts, type: 'int' },
          { label: 'Узкое место', value: f.bottleneck ? `${f.bottleneck.label}: ${f.bottleneck.reason}` : 'нет', type: 'text' },
        ],
      },
      {
        kind: 'table',
        table: {
          sheet: 'По дням',
          title: 'План и факт по дням, прогноз',
          columns: [
            { key: 'date', title: 'Дата', type: 'date' },
            { key: 'planDay', title: 'План дня', type: 'int' },
            { key: 'plan', title: 'План накопл.', type: 'int' },
            { key: 'factDay', title: 'Факт дня', type: 'int' },
            { key: 'fact', title: 'Факт накопл.', type: 'int' },
            { key: 'p10', title: 'P10', type: 'int' },
            { key: 'p50', title: 'P50', type: 'int' },
            { key: 'p90', title: 'P90', type: 'int' },
          ],
          rows: days,
          sumColumns: ['planDay', 'factDay'],
          empty: 'Нет дней',
          note: 'P10/P50/P90 — коридор прогноза накопленного выпуска: с вероятностью 80% выпуск будет между P10 и P90.',
        },
      },
      {
        kind: 'table',
        table: {
          sheet: 'По моделям',
          title: 'По моделям',
          columns: [
            { key: 'name', title: 'Модель', type: 'text' },
            { key: 'plan', title: 'План', type: 'int' },
            { key: 'produced', title: 'Выпущено', type: 'int' },
            { key: 'forecast', title: 'Прогноз', type: 'int' },
            { key: 'stock', title: 'Комплектов, смен', type: 'dec1' },
            { key: 'risk', title: 'Риск по комплектам', type: 'text' },
          ],
          rows: f.models.map((x) => ({ name: x.name, plan: x.plan, produced: x.produced, forecast: x.forecast, stock: x.stockShifts, risk: x.stockRisk })),
          sumColumns: ['plan', 'produced', 'forecast'],
          empty: 'Нет моделей',
          note: 'Выпуск по моделям по дням в двойник не приходит (1С:MES даёт сменный итог), поэтому по моделям — итог месяца.',
        },
      },
      {
        kind: 'table',
        table: {
          sheet: 'Потери',
          title: 'Потери по причинам',
          columns: [
            { key: 'label', title: 'Причина', type: 'text', weight: 4 },
            { key: 'cars', title: 'Машин', type: 'int', weight: 1 },
          ],
          rows: f.losses.map((l) => ({ label: l.label, cars: l.cars })),
          sumColumns: ['cars'],
          empty: 'Потерь нет',
        },
      },
    ],
  };
}
