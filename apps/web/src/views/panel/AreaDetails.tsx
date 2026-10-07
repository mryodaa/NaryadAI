// Раскрытая строка участка: оборудование строгим списком, одна линия тренда и «Подробнее».
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { MODEL_BY_ID, type AreaId, type PlantModel } from '@allur/contracts/ref';
import type { AreaDetail } from '../../api/types';
import { useAreaDetail } from '../../api/queries';
import { Button } from '../../components/ui';
import { SourceBadge } from '../../components/SourceBadge';
import { openAreaPanel } from '../../state/view';
import { usePlantModel } from '../../state/plant';
import { EQUIPMENT_STATUS, TONE_CLASS, cx } from '../../lib/tones';
import { num, num1, pct0, timeHM } from '../../lib/format';
import { StatusMark } from './StatusMark';
import { Trend } from './Trend';

const ROW_TEXT = 'text-[0.9375rem] 2xl:text-base';

export function AreaDetails({ area, shiftRunning }: { area: AreaId; shiftRunning: boolean }) {
  const q = useAreaDetail(area);
  const d = q.data;
  return (
    // колонка графика — в пикселях: при печати шрифт мельче, а SVG графика нарисован под экранную ширину
    <div className="grid grid-cols-[minmax(0,1fr)_240px] items-start gap-x-5 gap-y-3 border-t border-line bg-surface px-3.5 pb-3 pt-2.5 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        {!d ? (
          <p className="py-2 text-ink-2">{q.isError ? 'Не удалось загрузить данные участка' : 'Загружаю…'}</p>
        ) : d.stock ? (
          <StockTable stock={d.stock} />
        ) : (
          <>
            <EquipmentTable d={d} />
            {!d.plcConnected && <p className="mt-1.5 text-sm text-ink-3">Контроллеры не подключены — состояние оборудования двойник оценивает по проходу VIN (1С:MES).</p>}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2.5">
        {d && !d.stock && d.chart.length > 0 && <Trend kind={d.chartKind} points={d.chart} shiftRunning={shiftRunning} />}
        <Button onClick={() => openAreaPanel(area)} className="self-start print:hidden">
          Подробнее
          <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

const TH = 'py-1 pr-3 text-sm font-semibold text-ink-3';
const TD = 'py-1.5 pr-3 align-top';

type EquipmentRow = AreaDetail['equipment'][number];

/**
 * Оборудование по устройству участка: общее на входе, линии (станции), общее на выходе, в стороне
 * от потока. Участок в одну линию без ответвлений — простым списком, без заголовков.
 */
function groupEquipment(model: PlantModel, area: AreaId, list: EquipmentRow[]): { title: string | null; note?: string; items: EquipmentRow[] }[] {
  const stage = model.stageById.get(area);
  if (!stage || (stage.stations.length < 2 && !stage.sides.length)) return [{ title: null, items: list }];
  const byId = new Map(list.map((e) => [e.id, e]));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((e): e is EquipmentRow => !!e);
  const groups: { title: string | null; note?: string; items: EquipmentRow[] }[] = [];
  if (stage.inlet.length) groups.push({ title: 'Общее на входе', items: pick(stage.inlet.map((e) => e.id)) });
  for (const st of stage.stations) {
    const models = st.models?.map((m) => MODEL_BY_ID[m].short).join(', ');
    groups.push({ title: models && !st.name.includes(models) ? `${st.name} · ${models}` : st.name, items: pick(st.equipment.filter((e) => !e.passive).map((e) => e.id)) });
  }
  if (stage.outlet.length) groups.push({ title: stage.stations.length > 1 ? 'Общее после линий' : 'Общее на выходе', items: pick(stage.outlet.map((e) => e.id)) });
  for (const side of stage.sides) {
    groups.push({ title: `В стороне от потока: ${side.equipment.name.toLowerCase()}`, note: side.equipment.type.side?.about, items: pick([side.equipment.id]) });
  }
  // то, чего нет в устройстве участка (на всякий случай), — в конце
  const shown = new Set(groups.flatMap((g) => g.items.map((e) => e.id)));
  const rest = list.filter((e) => !shown.has(e.id));
  if (rest.length) groups.push({ title: 'Прочее', items: rest });
  return groups.filter((g) => g.items.length);
}

function EquipmentTable({ d }: { d: AreaDetail }) {
  const model = usePlantModel();
  const groups = groupEquipment(model, d.area, d.equipment);
  return (
    <table className={cx('w-full table-fixed border-collapse text-left', ROW_TEXT)}>
      <thead>
        <tr>
          <th className={cx(TH, 'w-[25%]')}>Оборудование</th>
          <th className={cx(TH, 'w-[23%]')}>Статус</th>
          <th className={cx(TH, 'w-[18%]')}>Ресурс до ТО</th>
          <th className={TH}>Последнее событие</th>
        </tr>
      </thead>
      <tbody>
        {groups.flatMap((g) => [
          g.title ? (
            <tr key={`g-${g.title}`} className="border-t border-line">
              <td colSpan={4} className="pb-0.5 pt-2.5 text-sm font-semibold text-ink-2">
                {g.title}
                {g.note && <span className="font-normal text-ink-3"> — {g.note}</span>}
              </td>
            </tr>
          ) : null,
          ...g.items.map((e) => <EquipmentLine key={e.id} d={d} e={e} />),
        ])}
      </tbody>
    </table>
  );
}

function EquipmentLine({ d, e }: { d: AreaDetail; e: EquipmentRow }) {
  const st = e.status ? EQUIPMENT_STATUS[e.status] : null;
  const ev = lastEvent(d, e);
  return (
    <tr className="border-t border-line">
      <td className={cx(TD, 'font-medium')}>{e.name}</td>
      <td className={TD}>{st ? <StatusMark status={st} extra={e.code ? `код ${e.code}` : undefined} wrap /> : <span className="text-ink-3">нет данных контроллера</span>}</td>
      <td className={cx(TD, 'num whitespace-nowrap')}>
        <Resource e={e} />
      </td>
      <td className={cx(TD, 'text-ink-2')} title={ev?.full}>
        {ev ? (
          <span className="flex min-w-0 items-center gap-1.5">
            {ev.source && <SourceBadge source={ev.source} compact />}
            <span className="num shrink-0 text-ink-3">{ev.at}</span>
            <span className="truncate">{ev.text}</span>
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
    </tr>
  );
}

function Resource({ e }: { e: AreaDetail['equipment'][number] }) {
  if (e.resourceLeft !== null) {
    return <span className={cx(e.resourceLeft < 0.1 && cx('font-semibold', TONE_CLASS.maintenance.ink))}>{pct0(e.resourceLeft)}</span>;
  }
  if (e.dp !== null) {
    return <span className={cx(e.dp > 300 && cx('font-semibold', TONE_CLASS.attention.ink))}>фильтр {num(e.dp)} Па</span>;
  }
  return <span className="text-ink-3">—</span>;
}

/**
 * Последний сигнал по этому оборудованию (контроллер, мастер, 1С); если сигнала нет — код контроллера.
 * Имя оборудования уже стоит в строке, поэтому «Контроллер Камеры-02:» из текста убираем — источник показывает значок.
 */
function lastEvent(d: AreaDetail, e: AreaDetail['equipment'][number]): { source: AreaDetail['signals'][number]['source'] | null; at: string; text: string; full: string } | null {
  const s = d.signals.filter((x) => x.equipmentId === e.id).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
  if (s) {
    const text = s.text.replace(/^Контроллер [^:]+:\s*/, '');
    return { source: s.source, at: timeHM(s.ts), text: text.charAt(0).toUpperCase() + text.slice(1), full: s.text };
  }
  if (e.code) {
    const text = `код ${e.code}${e.text ? ` — ${e.text}` : ''}`;
    return { source: 'plc', at: '', text, full: text };
  }
  return null;
}

function StockTable({ stock }: { stock: NonNullable<AreaDetail['stock']> }) {
  return (
    <table className={cx('w-full table-fixed border-collapse text-left', ROW_TEXT)}>
      <thead>
        <tr>
          <th className={cx(TH, 'w-[50%]')}>Комплект (1С:WMS)</th>
          <th className={cx(TH, 'w-[20%]')}>Остаток</th>
          <th className={TH}>Хватит на</th>
        </tr>
      </thead>
      <tbody>
        {stock.map((s) => {
          const low = s.shiftsLeft !== null && s.shiftsLeft < 2;
          return (
            <tr key={s.kitId} className="border-t border-line">
              <td className={TD}>{s.name}</td>
              <td className={cx(TD, 'num')}>{s.qty === null ? '—' : `${num(s.qty)} шт.`}</td>
              <td className={cx(TD, 'num', low && cx('font-semibold', TONE_CLASS.attention.ink))}>
                {s.shiftsLeft === null ? (
                  '—'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {low && <TriangleAlert className="size-[1.05em] shrink-0" strokeWidth={2.25} aria-hidden />}
                    {num1(s.shiftsLeft)} смены
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
