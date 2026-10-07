// Данные для 3D — из тех же источников, что у «Панели»: снимок двойника (WebSocket), детали
// участков и список инцидентов (REST, общий кэш с боковой панелью). Своих показателей здесь нет.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AreaId, FeedItem, LiveSnapshot, Tone } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { AreaDetail, Incident } from '../../api/types';
import { useAreaDetail, usePaintDefect } from '../../api/queries';
import { areaRows, type AreaRowView } from '../../state/selectors';
import { useLive } from '../../state/live';
import { useIssuedOrders } from '../../state/decisions';
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

const DETAIL_AREAS = ['weld', 'paint', 'assembly', 'qc'] as const;

export function useSceneData(s: LiveSnapshot): SceneData {
  const paintDefect = usePaintDefect(s);
  const weld = useAreaDetail('weld').data;
  const paint = useAreaDetail('paint').data;
  const assembly = useAreaDetail('assembly').data;
  const qc = useAreaDetail('qc').data;
  const warehouse = useAreaDetail('warehouse').data;
  const incidents = useQuery({ queryKey: ['incidents'], queryFn: () => api<Incident[]>('/api/v1/incidents'), refetchInterval: 4000 }).data;
  // ток и вибрацию привода шлюз не отдаёт по REST — берём последние значения из ленты входящих сообщений
  const drive = useLive((x) => (s.stage >= 2 ? driveTelemetry(x.feed) : ''));
  const issued = useIssuedOrders();

  return useMemo(() => {
    const rows: SceneData['rows'] = {};
    for (const r of areaRows(s, paintDefect)) rows[r.id] = r;

    const details: Partial<Record<(typeof DETAIL_AREAS)[number], AreaDetail | undefined>> = { weld, paint, assembly, qc };
    const equipment: Record<string, EquipmentView> = {};
    for (const area of DETAIL_AREAS) {
      for (const e of details[area]?.equipment ?? []) {
        equipment[e.id] = { id: e.id, name: e.name, area, status: e.status, code: e.code, text: e.text, resourceLeft: e.resourceLeft, dp: e.dp };
      }
    }
    const plcConnected = DETAIL_AREAS.some((a) => details[a]?.plcConnected);

    const stock: Record<string, number | null> = {};
    for (const k of warehouse?.stock ?? []) stock[k.kitId] = k.shiftsLeft;

    const byId = new Map((incidents ?? []).map((i) => [i.id, i]));
    const plaques: Plaque[] = s.attention
      .filter((a) => a.tone !== 'neutral')
      .slice(0, 3)
      .map((a) => ({ incidentId: a.incidentId, tone: a.tone, title: a.title, impact: a.impact, area: a.area, equipmentId: byId.get(a.incidentId)?.equipmentId }));

    const nowMs = Date.parse(s.now);
    const decisions: DecisionPlaque[] = [];
    for (const inc of incidents ?? []) {
      if (!inc.decision || inc.status === 'resolved') continue;
      const wo = inc.options.find((o) => o.id === inc.decision!.optionId)?.workOrder;
      if (!wo) continue;
      const shown = decisionText(wo.action, issued[inc.id] ?? wo.scheduledAt, inc.equipmentId ? equipment[inc.equipmentId]?.status : null, nowMs);
      if (shown) decisions.push({ incidentId: inc.id, area: inc.area, equipmentId: inc.equipmentId, ...shown });
    }

    const sensors: SensorView[] = [];
    if (s.stage >= 2) {
      const [cur, vib] = drive.split('|');
      sensors.push({
        equipmentId: 'CONV-03',
        label: 'Датчики привода Конвейера-03',
        values: [
          { name: 'Ток', value: cur ? `${num1(Number(cur))} А` : 'нет данных' },
          { name: 'Вибрация', value: vib ? `${num1(Number(vib))} мм/с` : 'нет данных' },
        ],
      });
      for (const id of ['BOOTH-01', 'BOOTH-02']) {
        const e = equipment[id];
        if (e) sensors.push({ equipmentId: id, label: `Датчик фильтра ${e.name}`, values: [{ name: 'Перепад давления', value: e.dp === null ? 'нет данных' : `${num(e.dp)} Па · норма до 250` }] });
      }
    }

    return { rows, equipment, plcConnected, stock, plaques, decisions, sensors };
  }, [s, paintDefect, weld, paint, assembly, qc, warehouse, incidents, drive, issued]);
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

/** «ток|вибрация» последних значений по Конвейеру-03 (строки ленты: «telemetry CONV-03 motor_current_a=18.4») */
function driveTelemetry(feed: FeedItem[]): string {
  let cur = '';
  let vib = '';
  for (let i = feed.length - 1; i >= 0 && (!cur || !vib); i--) {
    const m = /^telemetry CONV-03 (\w+)=(-?[\d.]+)/.exec(feed[i]!.summary);
    if (!m) continue;
    if (m[1] === 'motor_current_a' && !cur) cur = m[2]!;
    if (m[1] === 'vibration_mm_s' && !vib) vib = m[2]!;
  }
  return `${cur}|${vib}`;
}
