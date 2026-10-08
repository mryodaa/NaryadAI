// «Качество за период»: брак по участкам и дням против нормы (итоги 1С:QLS и живая текущая смена — как на
// экране «Качество»), топ дефектов, перекраски и смены цвета на окраске (по кузовам текущего прогона).
import { DEFECT_BY_ID, addDays, plantDate, shiftAt } from '@allur/contracts';
import { qualityStages, shiftKpis } from '@allur/twin-core';
import { fileWord, fmtIsoDate, fmtPct } from './format';
import { MONEY_NOTE, type ReportDoc, type ReportFormat, type Row } from './model';
import { areaName, baseMeta, type ReportParams, type ReportSource } from './source';
import { areaFilter, resolvePeriod } from './downtimes';

export function buildQualityReport(src: ReportSource, p: ReportParams, format: ReportFormat): ReportDoc {
  const per = resolvePeriod(src, p);
  const area = areaFilter(src, p);
  const st = src.twin.state;
  const cfg = src.twin.cfg;
  const now = src.now;
  const stages = qualityStages(src.twin.plant).filter((s) => !area || s.id === area);
  const shift = shiftAt(now);
  const live = shift ? shiftKpis(st, now, cfg, shift).defects.byArea : {};
  const today = plantDate(now);

  // ---- По участкам и дням
  const days: (Row & { produced: number; defects: number })[] = [];
  for (let d = per.from; d <= per.to; d = addDays(d, 1)) {
    for (const stage of stages) {
      let produced = 0;
      let defects = 0;
      for (const q of st.quality.values()) {
        if (q.area !== stage.id || q.date !== d) continue;
        produced += q.produced;
        defects += q.defects;
      }
      // текущая смена ещё не попала в итог 1С:QLS — добавляем живые данные, как экран «Качество»
      const l = live[stage.id];
      if (d === today && l && shift) {
        produced += l.inspected;
        defects += l.defects;
      }
      if (produced === 0 && defects === 0) continue;
      const share = produced > 0 ? defects / produced : 0;
      days.push({ date: Date.parse(`${d}T12:00:00+05:00`), area: stage.short, produced, defects, share, norm: cfg.defectNorm, over: share > cfg.defectNorm ? 'да' : 'нет' });
    }
  }
  const total = days.reduce((a, r) => ({ produced: a.produced + r.produced, defects: a.defects + r.defects }), { produced: 0, defects: 0 });

  // ---- Несоответствия с VIN: есть у двойника за текущий прогон (история 1С:QLS — только итоги)
  const fromMs = per.fromMs;
  const nc = st.nc.filter((n) => n.ts >= fromMs && n.ts < per.toMs && (!area || n.responsible === area));
  const top = new Map<string, { defect: string; area: string; count: number }>();
  for (const n of nc) {
    const k = `${n.defect}|${n.responsible}`;
    const c = top.get(k) ?? { defect: DEFECT_BY_ID[n.defect]?.name ?? n.defect, area: areaName(src, n.responsible, true), count: 0 };
    c.count += n.count;
    top.set(k, c);
  }
  const topRows = [...top.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  const repaints = nc.filter((n) => n.decision === 'repaint').reduce((a, n) => a + n.count, 0);

  // ---- Смены цвета на окраске: соседние кузова на входе окраски разного цвета
  const paint = src.twin.plant.stages.filter((s) => s.kind === 'painting').map((s) => s.id);
  let changes = 0;
  let prevColor: string | null = null;
  for (const ps of st.passes) {
    if (ps.kind !== 'entry' || !paint.includes(ps.area) || ps.ts < fromMs || ps.ts >= per.toMs) continue;
    const color = st.tracker.find(ps.vin)?.colorCode ?? null;
    if (color && prevColor && color !== prevColor) changes++;
    if (color) prevColor = color;
  }
  const repaintCost = src.twin.cfg.money.repaintCost;
  const areaText = area ? areaName(src, area) : 'все участки с контролем качества';
  const periodText = `${fmtIsoDate(per.from)} — ${fmtIsoDate(per.to)}`;

  return {
    title: 'Качество за период',
    subtitle: `${areaText} · ${periodText}`,
    fileBase: `Качество_${area ? fileWord(areaName(src, area, true)) : 'все_участки'}_${per.from}_${per.to}`,
    summarySheet: 'Итог',
    meta: baseMeta(src, p, [
      ['Участок', areaText],
      ['Период', periodText],
      ['Норма брака', `до ${fmtPct(cfg.defectNorm)}`],
    ]),
    sections: [
      {
        kind: 'kpis',
        title: 'Итог за период',
        items: [
          { label: 'Проверено кузовов', value: total.produced, type: 'int', note: 'итоги 1С:QLS по сменам и живая текущая смена' },
          { label: 'Брак', value: total.defects, type: 'int' },
          { label: 'Доля брака', value: total.produced ? total.defects / total.produced : 0, type: 'pct', bad: total.produced > 0 && total.defects / total.produced > cfg.defectNorm, note: `норма до ${fmtPct(cfg.defectNorm)}` },
          { label: 'Перекрасок (по VIN, текущий прогон)', value: repaints, type: 'int' },
          { label: 'Потери на перекраски, условно', value: repaints * repaintCost, type: 'money', note: 'условно: перекрасок × стоимость перекраски из настроек' },
          { label: 'Смен цвета на окраске (текущий прогон)', value: changes, type: 'int', note: 'потери на смены цвета в прототипе не оцениваются: нет нормы времени и расхода на смену цвета' },
        ],
      },
      {
        kind: 'table',
        table: {
          sheet: 'По дням',
          title: 'Брак по участкам и дням',
          columns: [
            { key: 'date', title: 'Дата', type: 'date', weight: 1 },
            { key: 'area', title: 'Участок', type: 'text', weight: 1.2 },
            { key: 'produced', title: 'Проверено', type: 'int', weight: 1 },
            { key: 'defects', title: 'Брак', type: 'int', weight: 0.8 },
            { key: 'share', title: 'Доля брака', type: 'pct', weight: 1 },
            { key: 'norm', title: 'Норма', type: 'pct', weight: 0.8 },
            { key: 'over', title: 'Выше нормы', type: 'text', weight: 0.9 },
          ],
          rows: format === 'pdf' && days.length > 60 ? days.slice(-60) : days,
          sumColumns: ['produced', 'defects'],
          highlight: (r) => r.over === 'да',
          empty: 'За период нет итогов контроля качества',
          note: 'Источник — итоги 1С:QLS по сменам; за сегодня добавлена идущая смена (как на экране «Качество»).',
        },
      },
      {
        kind: 'table',
        table: {
          sheet: 'Топ дефектов',
          title: 'Топ дефектов',
          columns: [
            { key: 'defect', title: 'Дефект', type: 'text', weight: 3 },
            { key: 'area', title: 'Участок', type: 'text', weight: 1.3 },
            { key: 'count', title: 'Случаев', type: 'int', weight: 1 },
          ],
          rows: topRows,
          sumColumns: ['count'],
          empty: 'Несоответствий с VIN за период нет',
          note: 'По несоответствиям с VIN из 1С:QLS текущего прогона: из истории в двойник приходят только итоги.',
        },
      },
      { kind: 'text', title: 'Пояснения', lines: [MONEY_NOTE] },
    ],
  };
}
