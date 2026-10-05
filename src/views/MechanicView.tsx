import { useState } from 'react';
import { useSim } from '../store';
import { useUi } from '../uiContext';
import { assignOrder, feedbackOrder, startOrder } from '../sim/engine';
import type { OrderStatus, WorkOrder } from '../sim/types';
import { clock, money, pct } from '../lib/format';
import { OrderProgress } from '../components/Orders';
import { Card, Icon, OrderChip } from '../components/ui';

const STEPS: { status: OrderStatus; title: string; text: string }[] = [
  { status: 'new', title: 'ИИ создал наряд', text: 'Аномалия → прогноз отказа → цена риска → наряд с причинами и запчастями' },
  { status: 'assigned', title: 'Назначен исполнитель', text: 'Свободный механик нужной квалификации получает наряд на телефон' },
  { status: 'in_progress', title: 'Работа на участке', text: 'Двойник переводит участок в ТО и пересчитывает буферы и план' },
  { status: 'review', title: 'Обратная связь', text: 'Механик подтверждает или опровергает неисправность' },
  { status: 'closed', title: 'Модель дообучается', text: 'Ответ механика становится разметкой: прогнозы точнее с каждым нарядом' },
];

function PhoneOrder({ o, mechId }: { o: WorkOrder; mechId: string }) {
  const { dispatch } = useSim();
  const ui = useUi();
  const [open, setOpen] = useState(o.status !== 'closed');
  return (
    <div className="item" style={{ background: 'var(--surface-1)' }}>
      <button onClick={() => setOpen(!open)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="item-head">
          <span className="item-meta">
            <b className="secondary">{o.id}</b>
            {o.kind === 'emergency' && <span style={{ color: 'var(--critical)' }}>· авария</span>}
          </span>
          <OrderChip status={o.status} />
        </div>
        <div className="item-title">{o.title}</div>
        <div className="item-meta">
          срок {clock(o.deadline)} · {o.durationMin} мин
        </div>
      </button>
      {open && (
        <>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            <div className="stat-label">Что сделать</div>
            {o.action}
          </div>
          <div style={{ fontSize: 12.5 }}>
            <div className="stat-label">Почему (ИИ)</div>
            <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-secondary)' }}>
              {o.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div style={{ fontSize: 12.5 }}>
            <div className="stat-label">Запчасти (зарезервированы на складе)</div>
            <span className="secondary">{o.parts.join(', ')}</span>
          </div>
          <OrderProgress o={o} />
          <div className="item-actions">
            {o.status === 'new' && (
              <button className="btn sm primary" onClick={() => dispatch((x) => assignOrder(x, o.id, mechId))}>
                Взять в работу
              </button>
            )}
            {o.status === 'assigned' && (
              <button
                className="btn sm primary"
                onClick={() => {
                  let ok = false;
                  dispatch((x) => {
                    ok = startOrder(x, o.id);
                  });
                  if (!ok) ui.toast('Нельзя начать', 'Участок в аварийной остановке или уже на обслуживании.');
                }}
              >
                <Icon name="wrench" size={13} /> Начать работу
              </button>
            )}
            {o.status === 'review' && o.kind !== 'emergency' && (
              <>
                <button
                  className="btn sm primary"
                  onClick={() => {
                    dispatch((x) => feedbackOrder(x, o.id, true));
                    ui.toast('Спасибо! Неисправность подтверждена', `Предотвращено потерь: ${money(o.avoidedRub)}. Пример добавлен в обучающую выборку.`);
                  }}
                >
                  <Icon name="check" size={13} /> Неисправность подтвердилась
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    dispatch((x) => feedbackOrder(x, o.id, false));
                    ui.toast('Ложная тревога учтена', 'Модель снизит вес похожих сигналов при дообучении.');
                  }}
                >
                  Ложная тревога
                </button>
              </>
            )}
            {o.status === 'review' && o.kind === 'emergency' && (
              <button className="btn sm primary" onClick={() => dispatch((x) => feedbackOrder(x, o.id, true))}>
                <Icon name="check" size={13} /> Закрыть наряд
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function MechanicView() {
  const { s } = useSim();
  const [mechId, setMechId] = useState(s.mechanics[0].id);
  const mech = s.mechanics.find((m) => m.id === mechId)!;
  const mine = s.orders.filter((o) => o.assignee === mech.name && o.status !== 'closed');
  const free = s.orders.filter((o) => o.status === 'new');
  const done = s.orders.filter((o) => o.assignee === mech.name && o.status === 'closed').slice(0, 3);
  const counts = STEPS.map((st) => s.orders.filter((o) => o.status === st.status).length);
  const total = s.ai.confirmed + s.ai.falseAlarm;

  return (
    <div className="row three" style={{ alignItems: 'start' }}>
      <Card title="Замкнутый цикл «сигнал → наряд»" idea="суть NaryadAI" hint="Обычные системы останавливаются на алерте. Здесь сигнал доходит до исполнителя и возвращается в модель.">
        <div className="steps">
          {STEPS.map((st, i) => (
            <div key={st.status} className="stepx">
              <span className="n">{i + 1}</span>
              <span>
                <b>{st.title}</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  {st.text}
                </div>
              </span>
              <span className="chip tnum">{counts[i]}</span>
            </div>
          ))}
        </div>
        <div className="card-hint">
          Попробуйте: запустите сценарий «Износ пресса П-2», дождитесь наряда, возьмите его здесь в работу и подтвердите результат.
        </div>
      </Card>

      <div className="phone" aria-label="Мобильное приложение механика">
        <div className="phone-status">
          <span className="tnum">{clock(s.t)}</span>
          <span>NaryadAI · Механик</span>
        </div>
        <div className="phone-head">
          <div style={{ fontWeight: 650, fontSize: 16 }}>Мои наряды</div>
          <select value={mechId} onChange={(e) => setMechId(e.target.value)} aria-label="Сотрудник">
            {s.mechanics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.role}
                {m.orderId ? ' (занят)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="phone-body">
          {mine.length === 0 && <div className="empty">Назначенных нарядов нет</div>}
          {mine.map((o) => (
            <PhoneOrder key={o.id} o={o} mechId={mechId} />
          ))}
          {free.length > 0 && (
            <>
              <div className="stat-label" style={{ marginTop: 6 }}>
                Свободные наряды
              </div>
              {free.map((o) => (
                <PhoneOrder key={o.id} o={o} mechId={mechId} />
              ))}
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="stat-label" style={{ marginTop: 6 }}>
                Выполнено
              </div>
              {done.map((o) => (
                <PhoneOrder key={o.id} o={o} mechId={mechId} />
              ))}
            </>
          )}
        </div>
      </div>

      <Card title="Обучение на обратной связи" hint="Каждый закрытый наряд — размеченный пример для модели прогноза отказов.">
        <div className="stats">
          <div>
            <div className="stat-label">Подтверждено</div>
            <div className="stat-value">{s.ai.confirmed}</div>
          </div>
          <div>
            <div className="stat-label">Ложных тревог</div>
            <div className="stat-value">{s.ai.falseAlarm}</div>
          </div>
          <div>
            <div className="stat-label">Точность прогнозов</div>
            <div className="stat-value">{total ? pct(s.ai.confirmed / total) : '—'}</div>
          </div>
          <div>
            <div className="stat-label">Предотвращено потерь</div>
            <div className="stat-value">{money(s.ai.avoidedRub)}</div>
          </div>
        </div>
        <div className="card-hint">
          «Предотвращено» = ожидаемые потери при бездействии − (недовыпуск во время ТО + стоимость ТО). Считается в момент начала работ по модели двойника.
        </div>
        <div className="card-hint">
          В продукте наряд приходит механику в мобильное приложение или мессенджер. На защите можно показать QR-код, чтобы жюри получило наряд на свой телефон: для этого нужен бэкенд с WebSocket.
        </div>
      </Card>
    </div>
  );
}
