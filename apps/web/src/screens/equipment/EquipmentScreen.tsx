// «Оборудование»: что скоро сломается и когда это обслужить?
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, OctagonX, TriangleAlert, Wrench } from 'lucide-react';
import { stageShort, usePlantModel } from '../../state/plant';
import { api } from '../../api/client';
import type { EquipmentOverview } from '../../api/types';
import { Card } from '../../components/ui';
import { Booting } from '../../components/Booting';
import { IncidentModal } from '../shop/IncidentModal';
import { cx } from '../../lib/tones';
import { num, pct0 } from '../../lib/format';
import { useI18n } from '../../i18n/store';
import { translateArea, translateDynamicText, translateEquipmentName } from '../../i18n/translator';

const RISK = {
  высокий: { icon: OctagonX, cls: 'bg-st-fault-bg text-st-fault-ink' },
  средний: { icon: TriangleAlert, cls: 'bg-st-attention-bg text-st-attention-ink' },
  низкий: { icon: CircleCheck, cls: 'text-st-neutral-ink' },
} as const;

export function EquipmentScreen() {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['equipment'], queryFn: () => api<EquipmentOverview>('/api/v1/equipment'), refetchInterval: 5000 });
  const model = usePlantModel();
  const [incident, setIncident] = useState<string | null>(null);
  const d = q.data;
  if (!d) return <Booting />;
  const used = d.criticalDowntime.minutes;
  const limit = d.criticalDowntime.limit;
  const over = used > limit;

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3 xl:gap-4 xl:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{t.equipment.title}</h1>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 xl:gap-4">
        <Card className="p-4">
          <div className="text-base text-ink-2">{t.equipment.criticalDowntimeTitle}</div>
          <div className={cx('mt-1 flex items-baseline gap-2 font-semibold leading-none', over ? 'text-st-attention-ink' : 'text-ink')}>
            <span className="num text-[2.75rem]">{num(used, lang)}</span>
            <span className="text-xl">{t.equipment.outOfMinutes(limit)}</span>
          </div>
          <div className="mt-3 h-2.5 rounded-full bg-line">
            <div className={cx('h-2.5 rounded-full', over ? 'bg-st-attention' : 'bg-st-neutral')} style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
          </div>
          <p className="mt-2 text-sm text-ink-3">{t.equipment.criticalDowntimeNote(limit)}</p>
        </Card>
        <Card className="p-4">
          <div className="mb-1 font-semibold">{t.equipment.resourceAssessmentTitle}</div>
          <p className="text-base leading-snug text-ink-2">
            {t.equipment.resourceAssessmentDesc}
          </p>
          {!d.plcConnected && <p className="mt-2 text-sm text-ink-3">{t.equipment.noPlcWarning}</p>}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full border-collapse text-left text-base">
          <thead>
            <tr className="border-b border-line text-sm text-ink-3">
              <th className="px-4 py-2.5 font-semibold">{t.equipment.tableEquipment}</th>
              <th className="px-4 py-2.5 font-semibold">{t.equipment.tableResourceLeft}</th>
              <th className="px-4 py-2.5 font-semibold">{t.equipment.tableRisk24h}</th>
              <th className="px-4 py-2.5 font-semibold">{t.equipment.tableRecommendation}</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((e) => {
              const R = RISK[e.risk];
              const Icon = R.icon;
              return (
                <tr key={e.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold">{translateEquipmentName(e.name, lang)}</div>
                    <div className="text-sm text-ink-3">{translateArea(e.area, lang, 'short') || stageShort(model, e.area)}</div>
                  </td>
                  <td className="w-[22rem] px-4 py-3 align-top">
                    {e.resourceLeft !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 flex-1 rounded-full bg-line">
                          <div className={cx('h-2.5 rounded-full', e.resourceLeft < 0.1 ? 'bg-st-maintenance' : 'bg-st-neutral')} style={{ width: `${Math.max(2, e.resourceLeft * 100)}%` }} />
                        </div>
                        <span className="num w-12 text-right font-semibold">{pct0(e.resourceLeft, lang)}</span>
                      </div>
                    ) : e.dp !== null ? (
                      <span className={cx('num', e.dp > 300 && 'font-semibold text-st-attention-ink')}>{t.equipment.filterPressure(num(e.dp, lang), 450)}</span>
                    ) : (
                      <span className="text-ink-3">{t.equipment.resourceBySchedule}</span>
                    )}
                    {e.cycles !== null && e.interval !== null && (
                      <div className="num mt-0.5 text-sm text-ink-3">
                        {t.equipment.cyclesOfInterval(num(e.cycles, lang), num(e.interval, lang), e.source === 'plc' ? t.quality.srcPlc : '1С:MES')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={cx('inline-flex items-center gap-1.5 rounded-lg font-semibold', e.risk !== 'низкий' && 'px-2 py-0.5', R.cls)}>
                      <Icon className="size-[1.05em]" /> {t.domain.risks[e.risk] ?? e.risk}
                    </span>
                    {e.errors24h !== null && e.errors24h > 0 && <div className="mt-0.5 text-sm text-ink-3">{t.equipment.controllerErrors24h(e.errors24h)}</div>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {e.recommendation ? (
                      <button type="button" onClick={() => e.incidentId && setIncident(e.incidentId)} className="inline-flex items-start gap-1.5 text-left font-semibold text-accent-ink hover:underline">
                        <Wrench className="mt-0.5 size-4 shrink-0" /> {translateDynamicText(e.recommendation, lang)}
                      </button>
                    ) : (
                      <span className="text-ink-3">{t.equipment.asPlanned}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <IncidentModal id={incident} onClose={() => setIncident(null)} />
    </main>
  );
}
