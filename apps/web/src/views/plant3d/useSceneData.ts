// Данные для 3D — из тех же источников, что у «Панели»: снимок двойника (WebSocket), детали
// участков и список инцидентов (REST, общий кэш с боковой панелью). Своих показателей здесь нет.
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { inflect, type AreaId, type AttentionItem, type FeedItem, type LiveSnapshot, type Tone } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { AreaDetail, Incident } from '../../api/types';
import { usePaintDefect } from '../../api/queries';
import { areaRows, type AreaRowView } from '../../state/selectors';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { useIssuedOrders } from '../../state/decisions';
import { useTranslation } from '../../i18n/store';
import { num, num1, timeHM } from '../../lib/format';

export type EqStatus = AreaDetail['equipment'][number]['status'];

export interface EquipmentView {
  id: string;
  name: string;
  area: AreaId;
  status: EqStatus;
  code?: string;
  text?: string;
  resourceLeft: number | null;
  dp: number | null;
}

/** Плашка проблемы — тот же инцидент и те же слова, что в «Требует внимания» */
export interface Plaque {
  incidentId: string;
  tone: Tone;
  title: string;
  impact: string;
  area: AreaId;
  equipmentId?: string;
  /** Непроверенный сигнал — пунктир */
  check?: AttentionItem['check'];
}

/** Плашка принятого решения: наряд, который видно в цехе */
export interface DecisionPlaque {
  incidentId: string;
  area: AreaId;
  equipmentId?: string;
  text: string;
  tone: Tone;
}

export interface SensorView {
  equipmentId: string;
  label: string;
  values: { name: string; value: string }[];
}

export interface SceneData {
  rows: Partial<Record<AreaId, AreaRowView>>;
  equipment: Record<string, EquipmentView>;
  /** Есть ли данные контроллеров: без них оборудование «серое», состояние — по проходу VIN */
  plcConnected: boolean;
  stock: Record<string, number | null>;
  plaques: Plaque[];
  decisions: DecisionPlaque[];
  sensors: SensorView[];
}

export function useSceneData(s: LiveSnapshot): SceneData {
  const paintDefect = usePaintDefect(s);
  const model = usePlantModel();
  // детали производственных участков и склада — тот же кэш, что у боковой панели участка
  const detailAreas = useMemo(() => [...model.production.map((st) => st.id), ...(model.warehouseIn ? [model.warehouseIn.id] : [])], [model]);
  const detailQueries = useQueries({
    queries: detailAreas.map((area) => ({ queryKey: ['area', area], queryFn: () => api<AreaDetail>(`/api/v1/areas/${area}`), refetchInterval: 3000 })),
  });
  const detailsKey = detailQueries.map((q) => q.dataUpdatedAt).join('|');
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api<Incident[]>('/api/v1/incidents'), refetchInterval: 4000 }).data;
  const drives = useMemo(() => model.equipment.filter((e) => e.type.fields.includes('motorCurrentA') && e.type.fields.includes('vibrationMmS')), [model]);
  // ток и вибрацию привода шлюз не отдаёт по REST — берём последние значения из ленты входящих сообщений
  const drive = useLive((x) => (s.stage >= 2 ? drives.map((d) => `${d.id}=${driveTelemetry(x.feed, d.id)}`).join(';') : ''));
  const issued = useIssuedOrders();
  // запросы мастерам: пока мастер не принял, над оборудованием — статус запроса, после — наряд, как раньше
  const requests = useLive((x) => x.crew?.requests);
  const { t } = useTranslation();

  return useMemo(() => {
    const rows: SceneData['rows'] = {};
    for (const r of areaRows(s, paintDefect, model)) rows[r.id] = r;

    const details = new Map(detailAreas.map((area, i) => [area, detailQueries[i]?.data as AreaDetail | undefined]));
    const production = model.production.map((st) => st.id);
    const equipment: Record<string, EquipmentView> = {};
    for (const area of production) {
      for (const e of details.get(area)?.equipment ?? []) {
        equipment[e.id] = { id: e.id, name: e.name, area, status: e.status, code: e.code, text: e.text, resourceLeft: e.resourceLeft, dp: e.dp };
      }
    }
    const plcConnected = production.some((a) => details.get(a)?.plcConnected);

    const stock: Record<string, number | null> = {};
    const warehouse = model.warehouseIn ? details.get(model.warehouseIn.id) : undefined;
    for (const k of warehouse?.stock ?? []) stock[k.kitId] = k.shiftsLeft;

    const byId = new Map((incidents ?? []).map((i) => [i.id, i]));
    const plaques: Plaque[] = s.attention
      .filter((a) => a.tone !== 'neutral')
      .slice(0, 3)
      .map((a) => ({ incidentId: a.incidentId, tone: a.tone, title: a.title, impact: a.impact, area: a.area, equipmentId: byId.get(a.incidentId)?.equipmentId, check: a.check }));

    const nowMs = Date.parse(s.now);
    const decisions: DecisionPlaque[] = [];
    for (const inc of incidents ?? []) {
      if (!inc.decision || inc.status === 'resolved') continue;
      const req = requests?.find((r) => r.incidentId === inc.id);
      if (req && (req.status === 'sent' || req.status === 'viewed' || req.status === 'counter' || req.status === 'cant')) {
        const text =
          req.status === 'sent'
            ? t.crew.plaqueSent
            : req.status === 'viewed'
              ? t.crew.plaqueViewed
              : req.status === 'counter'
                ? t.crew.plaqueCounter(timeHM(req.counter?.at ?? req.dueAt))
                : t.crew.plaqueCant;
        decisions.push({ incidentId: inc.id, area: inc.area, equipmentId: inc.equipmentId, text, tone: req.status === 'cant' ? 'attention' : 'neutral' });
        continue;
      }
      const wo = inc.options.find((o) => o.id === inc.decision!.optionId)?.workOrder;
      if (!wo) continue;
      const shown = decisionText(wo.action, req?.workOrderAt ?? issued[inc.id] ?? wo.scheduledAt, inc.equipmentId ? equipment[inc.equipmentId]?.status : null, nowMs);
      if (shown) decisions.push({ incidentId: inc.id, area: inc.area, equipmentId: inc.equipmentId, ...shown });
    }

    const sensors: SensorView[] = [];
    if (s.stage >= 2) {
      const values = new Map(drive.split(';').map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
      for (const d of drives) {
        const [cur, vib] = (values.get(d.id) ?? '|').split('|');
        sensors.push({
          equipmentId: d.id,
          label: `Датчики привода ${inflect(d.name, 'gen')}`,
          values: [
            { name: 'Ток', value: cur ? `${num1(Number(cur))} А` : 'нет данных' },
            { name: 'Вибрация', value: vib ? `${num1(Number(vib))} мм/с` : 'нет данных' },
          ],
        });
      }
      for (const b of model.equipment.filter((e) => e.type.fields.includes('filterDpPa'))) {
        const e = equipment[b.id];
        if (e) sensors.push({ equipmentId: b.id, label: `Датчик фильтра ${e.name}`, values: [{ name: 'Перепад давления', value: e.dp === null ? 'нет данных' : `${num(e.dp)} Па · норма до 250` }] });
      }
    }

    return { rows, equipment, plcConnected, stock, plaques, decisions, sensors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, paintDefect, model, detailsKey, incidents, drive, drives, issued, requests, t]);
}

/** Текст плашки наряда: до назначенного времени — «запланировано», во время работ — «идёт» */
function decisionText(action: string, scheduledAt: string, eqStatus: EqStatus | undefined, nowMs: number): { text: string; tone: Tone } | null {
  const at = Date.parse(scheduledAt);
  const hm = timeHM(scheduledAt);
  const before = nowMs < at;
  const working = eqStatus === 'maintenance';
  switch (action) {
    case 'replace_filter':
      return before ? { text: `Запланирована замена фильтра ${hm}`, tone: 'neutral' } : working ? { text: 'Идёт замена фильтра', tone: 'maintenance' } : { text: `Замена фильтра в ${hm}`, tone: 'neutral' };
    case 'maintenance':
      return before ? { text: `Запланировано ТО ${hm}`, tone: 'neutral' } : working ? { text: 'Идёт плановое ТО', tone: 'maintenance' } : { text: `ТО в ${hm}`, tone: 'neutral' };
    case 'inspect':
      return before ? { text: `Запланирован осмотр ${hm}`, tone: 'neutral' } : working ? { text: 'Идёт осмотр', tone: 'maintenance' } : { text: `Осмотр в ${hm}`, tone: 'neutral' };
    case 'repair':
      return working ? { text: 'Идёт ремонт', tone: 'maintenance' } : { text: `Ремонт по наряду, ${hm}`, tone: 'neutral' };
    case 'expedite_parts':
      return { text: `Срочная доставка к ${hm}`, tone: 'neutral' };
    case 'resequence':
      return { text: 'Очередь моделей переставлена', tone: 'neutral' };
    default:
      return null;
  }
}

/** «ток|вибрация» последних значений по приводу (строки ленты: «telemetry CONV-03 motor_current_a=18.4») */
function driveTelemetry(feed: FeedItem[], equipmentId: string): string {
  let cur = '';
  let vib = '';
  const prefix = `telemetry ${equipmentId} `;
  for (let i = feed.length - 1; i >= 0 && (!cur || !vib); i--) {
    const line = feed[i]!.summary;
    if (!line.startsWith(prefix)) continue;
    const m = /^(\w+)=(-?[\d.]+)/.exec(line.slice(prefix.length));
    if (!m) continue;
    if (m[1] === 'motor_current_a' && !cur) cur = m[2]!;
    if (m[1] === 'vibration_mm_s' && !vib) vib = m[2]!;
  }
  return `${cur}|${vib}`;
}
