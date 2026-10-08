// «Сводка смены» участка: итог (план, факт, OEE, брак, простой критического оборудования), выпуск по часам,
// простои с причинами мастера, брак и решения по кузовам, запросы руководителя, сдача смены.
// Расчёты — те же, что на вкладке «Смена» у мастера (Crew.shiftView) и на полосе показателей руководителя.
import { CHECKPOINTS, DEFECT_BY_ID, SHIFTS, isWorkingDay, plantDate, shiftAt, shiftRef, addDays, type LogEntry, type ShiftRef } from '@allur/contracts';
import { outputStage, qualityStages, shiftKpis, stopIntervals } from '@allur/twin-core';
import { fileWord, fmtDateTime, fmtInt, fmtIsoDate, fmtPct, fmtTime } from './format';
import type { ReportDoc, Row } from './model';
import { DECISION_RU, REQUEST_STATUS_RU, ReportError, SOURCE_RU, areaName, baseMeta, eqName, requestTrail, stopReasonRu, type ReportParams, type ReportSource } from './source';

const MASTER_BY_KIND: Record<string, string> = {
  welding: 'Мастер сварки',
  painting: 'Мастер окраски',
  assembly: 'Мастер сборки',
  inspection: 'Мастер ОТК',
};

/** Смена отчёта: из параметров (date + shift=1|2), иначе идущая, иначе последняя закончившаяся */
export function resolveShift(src: ReportSource, p: ReportParams): ShiftRef {
  if (p.date || p.shift) {
    const date = p.date ?? plantDate(src.now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ReportError(400, 'Дата — в виде ГГГГ-ММ-ДД, например 2026-10-08');
    const idx = Number(p.shift ?? (shiftAt(src.now)?.index ?? 1));
    if (idx !== 1 && idx !== 2) throw new ReportError(400, 'Смена — 1 или 2');
    if (!isWorkingDay(date)) throw new ReportError(404, `${fmtIsoDate(date)} — нерабочий день, смены не было`);
    return shiftRef(date, idx);
  }
  const cur = shiftAt(src.now);
  if (cur) return cur;
  let date = plantDate(src.now);
  for (let i = 0; i < 10; i++, date = addDays(date, -1)) {
    if (!isWorkingDay(date)) continue;
    for (const idx of [2, 1] as const) {
      const s = shiftRef(date, idx);
      if (s.endMs <= src.now) return s;
    }
  }
  throw new ReportError(404, 'Не нашли последнюю смену');
}

export function requireArea(src: ReportSource, p: ReportParams): string {
  if (!p.area) throw new ReportError(400, 'Укажите участок: area=paint, weld, assembly…');
  if (!src.twin.plant.production.some((s) => s.id === p.area)) throw new ReportError(404, `Участок «${p.area}» не найден среди производственных участков`);
  return p.area;
}

/** Причину записал: мастер с телефона или мастер в 1С:MES */
function reasonBy(e: LogEntry): string {
  if (!e.reason) return '—';
  return e.origin === 'mes' ? '1С:MES (запись мастера)' : 'Мастер (журнал смены)';
}

export function buildShiftReport(src: ReportSource, p: ReportParams): ReportDoc {
  const area = requireArea(src, p);
  const s = resolveShift(src, p);
  const now = src.now;
  if (s.startMs > now) throw new ReportError(400, 'Эта смена ещё не началась');
  if (s.endMs <= src.runStartMs) {
    throw new ReportError(
      404,
      `Сводка смены собирается из журнала мастера, а он ведётся с начала текущего прогона демонстрации (${fmtDateTime(src.runStartMs)}). За ${fmtIsoDate(s.date)}, ${SHIFTS[s.index - 1]!.name}, есть только сменный отчёт 1С:MES.`,
    );
  }
  const st = src.twin.state;
  const cfg = src.twin.cfg;
  const plant = src.twin.plant;
  const stage = plant.stageById.get(area)!;
  const end = Math.min(now, s.endMs);
  const going = now < s.endMs;
  const rec = src.crew.shiftRecord(area, s, now);
  const kpis = shiftKpis(st, now, cfg, s);
  const shiftName = SHIFTS[s.index - 1]!.name;
  const signals = src.crew.allSignals();

  // ---- Итог
  const planToNow = rec.hours.reduce((a, h) => a + h.plan, 0);
  const q = qualityStages(plant).some((x) => x.id === area) ? kpis.defects.byArea[area] : undefined;
  const plc = st.plcConnected(now);
  const crit = stopIntervals(st, area, s.startMs, end, cfg, plc).filter(
    (i) => !(i.kind === 'maintenance' && /план|наряд/i.test(i.label)) && !!i.equipmentId && !!plant.equipmentById.get(i.equipmentId)?.critical,
  );
  const critMin = crit.reduce((a, i) => a + (i.to - i.from) / 60_000, 0);
  const out = outputStage(plant);
  const handover = rec.close
    ? rec.close.auto
      ? `Смена закрылась сама по времени (${fmtDateTime(Date.parse(rec.close.at))}), мастер её не сдавал`
      : `Сдал: ${rec.close.closedBy ?? 'мастер участка'}, ${fmtDateTime(Date.parse(rec.close.at))}`
    : going
      ? 'Смена идёт, ещё не сдана'
      : 'Смена не сдана';

  // ---- Простои: записи журнала (контроллер, 1С:MES, сигнал, мастер), минуты — в пределах смены
  const downtimes = rec.entries
    .filter((e) => e.kind === 'downtime' && e.from)
    .map((e) => {
      const from = Math.max(Date.parse(e.from!), s.startMs);
      const to = Math.min(e.to ? Date.parse(e.to) : end, end);
      const sig = e.signalId ? signals.find((x) => x.signalId === e.signalId) : undefined;
      return {
        e,
        row: {
          from: Date.parse(e.from!),
          to: e.to ? Date.parse(e.to) : 'идёт',
          eq: eqName(src, e.equipmentId),
          // точные минуты: сумма в Excel совпадает с «простой за смену» на экране
          minutes: Math.max(0, to - from) / 60_000,
          reason: stopReasonRu(e.reason) ?? 'не записана',
          reasonBy: reasonBy(e),
          comment: e.comment ?? '',
          source: sig ? `Сигнал: ${sig.sources.map(SOURCE_RU).join(' + ')} → подтвердил мастер` : SOURCE_RU(e.origin),
          help: e.needHelp ? (e.helpAckAt ? 'просил, руководитель видел' : 'просил помощи') : 'нет',
          facts: e.facts,
        } satisfies Row,
      };
    })
    .sort((a, b) => (a.row.from as number) - (b.row.from as number));

  // ---- По часам: причина отклонения — причины мастера по простоям, пересекающим этот час
  const hourRows: Row[] = rec.hours.map((h) => {
    const hs = Date.parse(`${s.date}T${h.hour}:00+05:00`);
    const he = hs + 3600_000;
    const reasons = [
      ...new Set(
        downtimes
          .filter(({ e }) => Date.parse(e.from!) < he && (e.to ? Date.parse(e.to) : end) > hs)
          .map(({ e }) => (e.reason ? `${stopReasonRu(e.reason)} (${eqName(src, e.equipmentId)})` : `простой ${eqName(src, e.equipmentId)}, причина не записана`)),
      ),
    ];
    return { hour: h.hour, plan: h.plan, fact: h.fact, diff: h.fact - h.plan, reason: reasons.join('; ') || (h.fact < h.plan - 1 ? 'причина не записана' : '') };
  });

  // ---- Брак по кузовам участка (1С:QLS) и решения мастера
  const decisions = new Map(rec.entries.filter((e) => e.kind === 'defect' && e.vin).map((e) => [`${e.vin}|${e.from}`, e]));
  const defects: Row[] = st.nc
    .filter((n) => n.responsible === area && n.ts >= s.startMs && n.ts <= end)
    .sort((a, b) => a.ts - b.ts)
    .map((n) => {
      const entry = n.vin ? [...decisions.values()].find((e) => e.vin === n.vin && Math.abs(Date.parse(e.from ?? '') - n.ts) < 60_000) : undefined;
      return {
        at: n.ts,
        vin: n.vin ? `…${n.vin.slice(-6)}` : '—',
        defect: DEFECT_BY_ID[n.defect]?.name ?? n.defect,
        checkpoint: CHECKPOINTS.find((c) => c.id === n.checkpoint)?.name ?? n.checkpoint,
        count: n.count,
        qls: DECISION_RU[n.decision as keyof typeof DECISION_RU] ?? n.decision,
        // решение 1С:QLS подставляется в журнал заранее; мастерское — если мастер его подтвердил или поменял
        master: entry?.decision && entry.by !== '1С:QLS' ? `${DECISION_RU[entry.decision]} (записано мастером)` : entry ? 'мастер не менял' : '—',
      };
    });
  // брак, который мастер записал сам (без записи 1С:QLS)
  for (const e of rec.entries) {
    if (e.kind !== 'defect' || e.origin === 'qls') continue;
    defects.push({
      at: Date.parse(e.from ?? e.at),
      vin: e.vin ? `…${e.vin.slice(-6)}` : '—',
      defect: e.facts,
      checkpoint: '—',
      count: 1,
      qls: '—',
      master: e.decision ? `${DECISION_RU[e.decision]} (записано мастером)` : '—',
    });
  }

  // ---- Запросы руководителя за смену
  const requests: Row[] = src.crew.desk
    .all()
    .filter((r) => r.area === area && Date.parse(r.at) >= s.startMs && Date.parse(r.at) < s.endMs)
    .map((r) => ({
      at: Date.parse(r.at),
      text: r.text,
      why: r.why,
      due: Date.parse(r.dueAt),
      status: REQUEST_STATUS_RU[r.status],
      trail: requestTrail(r),
      by: r.by,
    }));

  const noReason = downtimes.filter(({ e }) => !e.reason);
  const diff = rec.summary.done - planToNow;
  const master = rec.close?.closedBy && !rec.close.auto ? rec.close.closedBy : (MASTER_BY_KIND[stage.kind] ?? `Мастер участка «${stage.short}»`);
  const periodText = `${fmtIsoDate(s.date)}, ${shiftName} (${fmtTime(s.startMs)}–${fmtTime(s.endMs)})${going ? `, данные на ${fmtTime(now)}` : ''}`;

  return {
    title: 'Сводка смены',
    subtitle: `${stage.name} · ${periodText}`,
    fileBase: `Сводка_смены_${fileWord(stage.short)}_${s.date}_смена-${s.index}`,
    summarySheet: 'Итог',
    meta: baseMeta(src, p, [
      ['Участок', stage.name],
      ['Смена', periodText],
      ['Мастер', master],
      ['Сдача смены', handover],
      ['Принял смену', 'В системе не отмечается'],
    ]),
    sections: [
      {
        kind: 'kpis',
        title: 'Итог смены',
        items: [
          { label: 'План на смену', value: rec.summary.plan, type: 'int', note: `такт ${cfg.taktMin} мин` },
          { label: going ? `План к ${fmtTime(now)}` : 'План за смену по такту', value: planToNow, type: 'int', note: 'сумма плана по часам' },
          { label: 'Факт: вышло с участка', value: rec.summary.done, type: 'int', note: '1С:MES, проход VIN' },
          { label: 'Отклонение от плана', value: diff, type: 'int', bad: diff < -1 },
          {
            label: 'OEE линии',
            value: kpis.oee.value,
            type: 'pct',
            note: `по участку «${out?.short ?? 'Сборка'}», задающему ритм: доступность ${fmtPct(kpis.oee.availability)} × производительность ${fmtPct(kpis.oee.performance)} × качество ${fmtPct(kpis.oee.quality)}`,
          },
          q
            ? { label: 'Брак участка', value: q.inspected > 0 ? q.defects / q.inspected : 0, type: 'pct', bad: q.inspected > 0 && q.defects / q.inspected > cfg.defectNorm, note: `${fmtInt(q.defects)} из ${fmtInt(q.inspected)} проверенных, норма до ${fmtPct(cfg.defectNorm)} (1С:QLS)` }
            : { label: 'Брак участка', value: 'не проверяется', type: 'text', note: 'на участке нет контрольной точки качества' },
          { label: 'Простой за смену (журнал)', value: rec.summary.downtimeMin, type: 'minutes', note: 'мин; контроллер, 1С:MES и мастер, без микропростоев до 3 мин' },
          {
            label: 'Простой критического оборудования',
            value: Math.round(critMin),
            type: 'minutes',
            bad: critMin > cfg.criticalDowntimeLimitMin,
            note: `мин за смену на участке; лимит ${cfg.criticalDowntimeLimitMin} мин в сутки${plc ? '' : '; без контроллеров — по записям 1С:MES'}`,
          },
          { label: 'Записей без причины', value: rec.summary.withoutReason, type: 'int', bad: rec.summary.withoutReason > 0 },
          { label: 'Открытых запросов руководителя', value: rec.summary.openRequests, type: 'int' },
        ],
      },
      {
        kind: 'table',
        table: {
          sheet: 'По часам',
          title: 'Выпуск по часам',
          columns: [
            { key: 'hour', title: 'Час', type: 'text', weight: 0.8 },
            { key: 'plan', title: 'План', type: 'int', weight: 0.8 },
            { key: 'fact', title: 'Факт', type: 'int', weight: 0.8 },
            { key: 'diff', title: 'Отклонение', type: 'int', weight: 1 },
            { key: 'reason', title: 'Причина отклонения (из журнала мастера)', type: 'text', weight: 5 },
          ],
          rows: hourRows,
          sumColumns: ['plan', 'fact', 'diff'],
          highlight: (r) => (r.diff as number) < -1,
          empty: 'Смена ещё не началась',
          note: 'План часа — по такту; факт — выход кузовов с участка (1С:MES). Причина — то, что записал мастер о простоях в этот час.',
        },
      },
      {
        kind: 'table',
        table: {
          sheet: 'Простои',
          title: 'Простои',
          columns: [
            { key: 'from', title: 'Начало', type: 'time', weight: 0.8 },
            { key: 'to', title: 'Конец', type: 'time', weight: 0.8 },
            { key: 'eq', title: 'Оборудование', type: 'text', weight: 1.6 },
            { key: 'minutes', title: 'Минут', type: 'minutes', weight: 0.7 },
            { key: 'reason', title: 'Причина', type: 'text', weight: 1.2 },
            { key: 'reasonBy', title: 'Кто записал причину', type: 'text', weight: 1.6 },
            { key: 'comment', title: 'Комментарий мастера', type: 'text', weight: 2 },
            { key: 'source', title: 'Источник сигнала', type: 'text', weight: 1.8 },
            { key: 'help', title: 'Помощь', type: 'text', weight: 1.1 },
          ],
          rows: downtimes.map((d) => d.row),
          sumColumns: ['minutes'],
          highlight: (r) => r.reason === 'не записана',
          empty: 'Простоев за смену нет',
          note: 'Минуты — в пределах смены. Выделены простои без причины. Сигнал, который мастер не подтвердил, простоем не считается.',
        },
      },
      {
        kind: 'table',
        table: {
          title: 'Простои без причины',
          skipXlsx: true,
          columns: [
            { key: 'from', title: 'Начало', type: 'time', weight: 0.8 },
            { key: 'eq', title: 'Оборудование', type: 'text', weight: 1.6 },
            { key: 'minutes', title: 'Минут', type: 'minutes', weight: 0.7 },
            { key: 'facts', title: 'Что известно', type: 'text', weight: 4 },
          ],
          rows: noReason.map((d) => d.row),
          empty: 'Все простои с причиной',
        },
      },
      {
        kind: 'table',
        table: {
          sheet: 'Брак',
          title: 'Брак и решения по кузовам',
          columns: [
            { key: 'at', title: 'Время', type: 'time', weight: 0.7 },
            { key: 'vin', title: 'VIN', type: 'text', weight: 0.9 },
            { key: 'defect', title: 'Дефект', type: 'text', weight: 1.8 },
            { key: 'checkpoint', title: 'Где обнаружен', type: 'text', weight: 1.6 },
            { key: 'count', title: 'Шт.', type: 'int', weight: 0.5 },
            { key: 'qls', title: 'Решение 1С:QLS', type: 'text', weight: 1.3 },
            { key: 'master', title: 'Решение мастера', type: 'text', weight: 1.8 },
          ],
          rows: defects,
          sumColumns: ['count'],
          empty: 'Брака за смену нет',
          note: 'Брак — по участку, который его допустил. VIN — последние 6 знаков.',
        },
      },
      {
        kind: 'table',
        table: {
          sheet: 'Запросы',
          title: 'Запросы руководителя',
          columns: [
            { key: 'at', title: 'Когда', type: 'time', weight: 0.7 },
            { key: 'text', title: 'Что сделать', type: 'text', weight: 2 },
            { key: 'why', title: 'Почему', type: 'text', weight: 2 },
            { key: 'due', title: 'Срок', type: 'datetime', weight: 1.2 },
            { key: 'status', title: 'Статус', type: 'text', weight: 1.3 },
            { key: 'trail', title: 'Встречное предложение и ответ', type: 'text', weight: 2.4 },
          ],
          rows: requests,
          empty: 'Запросов за смену не было',
        },
      },
      {
        kind: 'text',
        title: 'Передача смены',
        lines: [
          `Заметка следующей смене: ${rec.close?.note ? `«${rec.close.note}»` : 'нет'}`,
          `Заметка, полученная от прошлой смены: ${rec.prevNote ? `«${rec.prevNote.note}» (${rec.prevNote.by ?? 'мастер'}, ${fmtDateTime(Date.parse(rec.prevNote.at))})` : 'нет'}`,
          handover,
        ],
      },
    ],
  };
}
