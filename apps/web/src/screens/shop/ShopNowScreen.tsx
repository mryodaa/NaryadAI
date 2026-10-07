// «Цех сейчас» — главный экран. Вопрос: что происходит в цехе и что требует внимания прямо сейчас?
// 3D: сцена во весь экран, показатели и «Требует внимания» — плавающие окна по краям, их можно свернуть.
// «Панель»: строгий список участков по потоку. Данные, сущности и действия в обоих режимах одни и те же.
import { useState } from 'react';
import type { LiveSnapshot } from '@allur/contracts/ref';
import { KpiStrip } from './KpiStrip';
import { FlowLine } from './FlowLine';
import { AttentionColumn } from './AttentionColumn';
import { ShiftTimeline } from './ShiftTimeline';
import { AreaPanel } from './AreaPanel';
import { IncidentModal } from './IncidentModal';
import { IncidentList } from './IncidentList';
import { ShopCenter } from './ShopCenter';
import { Scene3DLayer } from './Scene3DLayer';
import { FloatingAttention, FloatingKpi } from './Floating';
import { useViewControls } from './useViewControls';
import { Modal } from '../../components/overlay';
import { ExplainView } from '../../components/ExplainView';
import { ViewSwitch } from '../../components/ViewSwitch';
import { ENABLE_3D } from '../../lib/features';
import { closeAreaPanel, closeIncident, openAreaPanel, openIncident, useView } from '../../state/view';
import { cx } from '../../lib/tones';
import { timeHM } from '../../lib/format';

export function ShopNowScreen({ snapshot }: { snapshot: LiveSnapshot }) {
  const s = snapshot;
  const panelArea = useView((v) => (v.areaPanel ? v.area : null));
  const equipment = useView((v) => v.equipment);
  const incident = useView((v) => v.incident);
  const is3d = useView((v) => ENABLE_3D && v.mode === '3d');
  const [whyPlan, setWhyPlan] = useState(false);
  const [all, setAll] = useState(false);
  useViewControls();

  const showIncident = (id: string) => {
    setAll(false);
    openIncident(id);
  };
  const noShift = !s.shift && s.nextShiftStartsAt ? `Смена не идёт · следующая в ${timeHM(s.nextShiftStartsAt)}` : null;

  return (
    <main className={cx('relative', is3d ? 'h-[calc(100dvh-3.5rem)] overflow-hidden' : 'flex flex-col gap-3 px-4 pb-4 pt-3 xl:gap-4 xl:px-6')}>
      {/* слой 3D всегда в одном месте дерева: при переключении режима сцена не пересоздаётся */}
      {ENABLE_3D && <Scene3DLayer />}

      {is3d ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 px-4 pb-16 pt-3 xl:gap-4 xl:px-6">
          <div data-occluder="top" className="pointer-events-auto flex items-center gap-4 self-start rounded-2xl bg-page/85 py-1 pl-1 pr-3 backdrop-blur">
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Что происходит в цехе сейчас</h1>
            <ViewSwitch />
            {noShift && <p className="text-base text-ink-2">{noShift}</p>}
          </div>
          <div data-occluder="top" className="pointer-events-auto">
            <FloatingKpi kpi={s.kpi} now={s.now} onWhyPlan={() => setWhyPlan(true)} />
          </div>
          <div className="flex min-h-0 flex-1 justify-end">
            <div
              data-occluder="right"
              className={cx('pointer-events-auto flex max-h-full min-h-0 flex-col gap-3 self-start', panelArea ? 'w-[27rem] 2xl:w-[30rem]' : 'w-[19.5rem] 2xl:w-[22rem]')}
            >
              <FloatingAttention items={s.attention} total={s.attentionTotal} onOpen={showIncident} onMore={() => setAll(true)} compact={!!panelArea} />
              <AreaPanel area={panelArea} floating highlight={equipment} onClose={closeAreaPanel} onIncident={showIncident} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className={cx('flex justify-between gap-4', ENABLE_3D ? 'items-center' : 'items-baseline')}>
            <div className="flex min-w-0 items-center gap-4">
              <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Что происходит в цехе сейчас</h1>
              {ENABLE_3D && <ViewSwitch />}
            </div>
            {s.dataNote ? <p className="text-base text-ink-2">{s.dataNote}</p> : noShift && <p className="text-base text-ink-2">{noShift}</p>}
          </div>

          <KpiStrip kpi={s.kpi} now={s.now} onWhyPlan={() => setWhyPlan(true)} />

          <div className="grid grid-cols-[minmax(0,1fr)_19.5rem] items-start gap-3 xl:gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-3 xl:gap-4">
              {ENABLE_3D ? (
                <ShopCenter snapshot={s} onIncident={showIncident} />
              ) : (
                <>
                  <FlowLine areas={s.areas} buffers={s.buffers} onArea={openAreaPanel} />
                  {s.shift && <ShiftTimeline shift={s.shift} now={s.now} timeline={s.timeline} onIncident={showIncident} />}
                </>
              )}
            </div>
            <div className="self-start">
              <AttentionColumn items={s.attention} total={s.attentionTotal} onOpen={showIncident} onMore={() => setAll(true)} />
            </div>
          </div>

          <AreaPanel area={panelArea} onClose={closeAreaPanel} onIncident={showIncident} />
        </>
      )}

      <IncidentModal id={incident} onClose={closeIncident} />
      <IncidentList open={all} onClose={() => setAll(false)} onOpen={showIncident} />
      <Modal open={whyPlan} onClose={() => setWhyPlan(false)} title={<h2 className="text-[1.375rem] font-semibold">Почему такой прогноз плана месяца</h2>}>
        {s.kpi.monthPlan.explain && <ExplainView explain={s.kpi.monthPlan.explain} />}
      </Modal>
    </main>
  );
}
