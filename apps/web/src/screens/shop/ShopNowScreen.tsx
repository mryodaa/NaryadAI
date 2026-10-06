// «Цех сейчас» — главный экран. Вопрос: что происходит в цехе и что требует внимания прямо сейчас?
import { useState } from 'react';
import type { AreaId, LiveSnapshot } from '@allur/contracts/ref';
import { KpiStrip } from './KpiStrip';
import { FlowLine } from './FlowLine';
import { AttentionColumn } from './AttentionColumn';
import { ShiftTimeline } from './ShiftTimeline';
import { AreaPanel } from './AreaPanel';
import { IncidentModal } from './IncidentModal';
import { IncidentList } from './IncidentList';
import { Modal } from '../../components/overlay';
import { ExplainView } from '../../components/ExplainView';
import { timeHM } from '../../lib/format';

export function ShopNowScreen({ snapshot }: { snapshot: LiveSnapshot }) {
  const s = snapshot;
  const [area, setArea] = useState<AreaId | null>(null);
  const [incident, setIncident] = useState<string | null>(null);
  const [whyPlan, setWhyPlan] = useState(false);
  const [all, setAll] = useState(false);

  const openIncident = (id: string) => {
    setAll(false);
    setIncident(id);
  };

  return (
    <main className="flex flex-col gap-3 px-4 pb-4 pt-3 xl:gap-4 xl:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Что происходит в цехе сейчас</h1>
        {s.dataNote ? (
          <p className="text-base text-ink-2">{s.dataNote}</p>
        ) : (
          !s.shift && s.nextShiftStartsAt && <p className="text-base text-ink-2">Смена не идёт · следующая в {timeHM(s.nextShiftStartsAt)}</p>
        )}
      </div>

      <KpiStrip kpi={s.kpi} now={s.now} onWhyPlan={() => setWhyPlan(true)} />

      <div className="grid grid-cols-[minmax(0,1fr)_19.5rem] items-start gap-3 xl:gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-3 xl:gap-4">
          <FlowLine areas={s.areas} buffers={s.buffers} onArea={setArea} />
          {s.shift && <ShiftTimeline shift={s.shift} now={s.now} timeline={s.timeline} onIncident={openIncident} />}
        </div>
        <AttentionColumn items={s.attention} total={s.attentionTotal} onOpen={openIncident} onMore={() => setAll(true)} />
      </div>

      <AreaPanel area={area} onClose={() => setArea(null)} onIncident={openIncident} />
      <IncidentModal id={incident} onClose={() => setIncident(null)} />
      <IncidentList open={all} onClose={() => setAll(false)} onOpen={openIncident} />
      <Modal open={whyPlan} onClose={() => setWhyPlan(false)} title={<h2 className="text-[1.375rem] font-semibold">Почему такой прогноз плана месяца</h2>}>
        {s.kpi.monthPlan.explain && <ExplainView explain={s.kpi.monthPlan.explain} />}
      </Modal>
    </main>
  );
}
