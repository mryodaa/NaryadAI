import { useSim } from '../store';
import { useUi } from '../uiContext';
import { assignOrder, startOrder } from '../sim/engine';
import type { WorkOrder } from '../sim/types';
import { clock, dur, money } from '../lib/format';
import { Card, Icon, OrderChip } from './ui';

const KIND_LABEL: Record<WorkOrder['kind'], string> = {
  predictive: 'Предиктивный (ИИ)',
  emergency: 'Аварийный',
  quality: 'Качество (ИИ)',
};

export function OrderProgress({ o }: { o: WorkOrder }) {
  const { s } = useSim();
  if (o.status !== 'in_progress' || o.startedAt === null) return null;
  const st = s.stations.find((x) => x.id === o.stationId)!;
  const total = Math.max(1, st.downUntil - o.startedAt);
  const left = Math.max(0, st.downUntil - s.t);
  return (
    <div>
      <div className="progress">
        <div style={{ width: `${(1 - left / total) * 100}%` }} />
      </div>
      <div className="item-meta" style={{ marginTop: 4 }}>
        осталось {dur(left)} · {o.assignee}
      </div>
    </div>
  );
}

export function OrdersPanel() {
  const { s, dispatch } = useSim();
  const ui = useUi();
  const open = s.orders.filter((o) => o.status !== 'closed').sort((a, b) => b.priorityRub - a.priorityRub);
  const closed = s.orders.filter((o) => o.status === 'closed').slice(0, 3);

  return (
    <Card
      title="Наряды"
      idea="сигнал → наряд"
      hint="ИИ формирует наряд сам: что сделать, почему, какие запчасти. Сортировка — по деньгам под риском."
    >
      <div className="list" style={{ maxHeight: 420 }}>
        {open.length + closed.length === 0 && <div className="empty">Открытых нарядов нет</div>}
        {[...open, ...closed].map((o) => (
          <div key={o.id} className={`item${o.status === 'closed' ? ' resolved' : ''}`}>
            <div className="item-head">
              <span className="item-meta">
                <b className="secondary">{o.id}</b> · {KIND_LABEL[o.kind]}
              </span>
              <OrderChip status={o.status} />
            </div>
            <div className="item-title">{o.title}</div>
            <div className="item-meta">
              {o.status !== 'closed' && o.kind !== 'emergency' && <span>под риском: <b className="secondary">{money(o.priorityRub)}</b></span>}
              <span>срок: {clock(o.deadline)}</span>
              {o.assignee && <span>· {o.assignee}</span>}
            </div>
            <OrderProgress o={o} />
            {o.status === 'review' && <div className="item-text">Механик должен подтвердить результат — это обучает модель.</div>}
            {o.status === 'closed' && o.feedback && (
              <div className="item-text">{o.feedback === 'confirmed' ? `Неисправность подтверждена · предотвращено ${money(o.avoidedRub)}` : 'Ложная тревога — модель учтёт'}</div>
            )}
            {(o.status === 'new' || o.status === 'assigned') && (
              <div className="item-actions">
                {o.status === 'new' && (
                  <button className="btn sm" onClick={() => dispatch((x) => assignOrder(x, o.id))}>
                    <Icon name="user" size={13} /> Назначить
                  </button>
                )}
                <button
                  className="btn sm primary"
                  onClick={() => {
                    let ok = false;
                    dispatch((x) => {
                      ok = startOrder(x, o.id);
                    });
                    if (!ok) ui.toast('Нельзя начать ТО', 'Участок сейчас в аварийной остановке или уже на обслуживании.');
                  }}
                >
                  <Icon name="wrench" size={13} /> Начать ТО
                </button>
                {o.kind === 'predictive' && (
                  <button className="btn sm ghost" onClick={() => ui.openWhatIf(o.equipId)}>
                    Сравнить решения
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
