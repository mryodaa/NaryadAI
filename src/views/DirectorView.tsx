import { useEffect, useState } from 'react';
import { useSim } from '../store';
import { useUi } from '../uiContext';
import { MARGIN_PER_CAR, SHIFT_PLAN } from '../sim/config';
import { kpis, riskItems } from '../sim/analytics';
import { QUESTIONS, answer, briefing, type BriefLine, type QuestionId } from '../sim/assistant';
import { expediteSupply } from '../sim/engine';
import { clock, dur, money, num, pct } from '../lib/format';
import { CostByStation, OutputChart, ParetoChart } from '../components/Production';
import { Card, Icon, Kpi, riskColor, type IconName } from '../components/ui';

const TONE: Record<BriefLine['tone'], { color: string; icon: IconName }> = {
  neutral: { color: 'var(--text-muted)', icon: 'info' },
  good: { color: 'var(--good)', icon: 'check' },
  warning: { color: 'var(--warning)', icon: 'alert' },
  critical: { color: 'var(--critical)', icon: 'alert' },
};

function Briefing() {
  const { s, la, forecast } = useSim();
  const [snap, setSnap] = useState(() => ({ t: s.t, lines: briefing(s, forecast, la) }));
  return (
    <Card
      title="Брифинг от ИИ"
      idea="30 секунд вместо отчёта"
      hint="Короткая сводка для руководителя: что происходит, что под угрозой и какие решения нужны. В продукте текст пишет LLM по данным двойника."
      actions={
        <button className="btn sm" onClick={() => setSnap({ t: s.t, lines: briefing(s, forecast, la) })}>
          Обновить · {clock(snap.t)}
        </button>
      }
    >
      <div className="brief">
        {snap.lines.map((l, i) => (
          <div key={i} className="brief-line">
            <span style={{ color: TONE[l.tone].color, paddingTop: 2 }}>
              <Icon name={TONE[l.tone].icon} size={16} />
            </span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Assistant() {
  const { s, la, forecast } = useSim();
  const [q, setQ] = useState<QuestionId | null>(null);
  const [full, setFull] = useState('');
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= full.length) return;
    const id = setTimeout(() => setShown((n) => Math.min(full.length, n + 4)), 16);
    return () => clearTimeout(id);
  }, [shown, full]);

  const ask = (id: QuestionId) => {
    setQ(id);
    setFull(answer(id, s, forecast, la));
    setShown(0);
  };

  return (
    <Card title="ИИ-ассистент" hint="Вопросы на естественном языке. В продукте — LLM с доступом к API двойника (tool use); в демо ответы собираются из тех же данных.">
      <div className="chips">
        {QUESTIONS.map((x) => (
          <button key={x.id} className={`chip-btn${q === x.id ? ' on' : ''}`} onClick={() => ask(x.id)}>
            {x.q}
          </button>
        ))}
      </div>
      <div className="answer">
        {q ? (
          <>
            {full.slice(0, shown)}
            {shown < full.length && <span className="caret" />}
          </>
        ) : (
          <span className="muted">Выберите вопрос выше.</span>
        )}
      </div>
    </Card>
  );
}

function Decisions() {
  const { s, la, dispatch } = useSim();
  const ui = useUi();
  const items = riskItems(s, la);
  const newOrders = s.orders.filter((o) => o.status === 'new');
  return (
    <Card title="Решения, требующие внимания" idea="деньги, а не проценты" hint="Риски отсортированы по деньгам под угрозой. Для каждого — сравнение вариантов на модели двойника.">
      <div className="list">
        {items.length === 0 && <div className="empty">Значимых рисков нет</div>}
        {items.map((r) => (
          <div key={r.key} className="item sev-bar" style={{ ['--sev' as string]: r.p != null ? riskColor(r.p) : 'var(--serious)' }}>
            <div className="item-head">
              <span className="item-title">{r.title}</span>
              <b>{money(r.rub)}</b>
            </div>
            <div className="item-text">
              {r.detail}
              {r.ttf != null && <> · критично через ~{dur(r.ttf)}</>}
            </div>
            <div className="item-actions">
              {r.kind === 'equipment' && r.equipId && (
                <button className="btn sm primary" onClick={() => ui.openWhatIf(r.equipId!)}>
                  <Icon name="scale" size={13} /> Сравнить варианты
                </button>
              )}
              {r.kind === 'supply' && !s.kits.expedited && (
                <button
                  className="btn sm primary"
                  onClick={() => {
                    dispatch(expediteSupply);
                    ui.toast('Экстренная поставка запрошена', 'Фура прибудет через 30 минут.');
                  }}
                >
                  <Icon name="truck" size={13} /> Экстренная поставка
                </button>
              )}
              {r.kind === 'quality' && (
                <button className="btn sm" onClick={() => ui.goto('mechanic')}>
                  Наряд на проверку камеры
                </button>
              )}
            </div>
          </div>
        ))}
        {newOrders.length > 0 && (
          <div className="item-meta" style={{ marginTop: 4 }}>
            Неназначенных нарядов: {newOrders.length} ·{' '}
            <button className="btn sm ghost" onClick={() => ui.goto('shop')}>
              открыть в цехе
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

export function DirectorView() {
  const { s, la, forecast } = useSim();
  const k = kpis(s);
  const gap = SHIFT_PLAN - forecast.endShipped;
  const atRisk = riskItems(s, la).reduce((a, r) => a + r.rub, 0);
  const precision = s.ai.confirmed + s.ai.falseAlarm ? s.ai.confirmed / (s.ai.confirmed + s.ai.falseAlarm) : null;

  return (
    <>
      <div className="hero">
        <Kpi
          icon="sparkle"
          label="Прогноз выполнения плана смены"
          value={pct(forecast.endShipped / SHIFT_PLAN)}
          sub={
            gap > 3 ? (
              <span className="delta-down">
                {num(forecast.endShipped)} из {SHIFT_PLAN} · −{money(gap * MARGIN_PER_CAR)}
              </span>
            ) : (
              <span className="delta-up">
                {num(forecast.endShipped)} из {SHIFT_PLAN} авто
              </span>
            )
          }
        />
        <Kpi icon="chart" label="OEE смены" value={pct(k.oee)} sub={`доступность ${pct(k.A)} · качество ${pct(k.Q)}`} />
        <Kpi icon="alert" label="Деньги под риском" value={money(atRisk)} sub="ожидаемые потери по открытым рискам" />
        <Kpi
          icon="check"
          label="Предотвращено благодаря ИИ"
          value={money(s.ai.avoidedRub)}
          sub={precision === null ? 'по подтверждённым нарядам' : `точность прогнозов ${pct(precision)} (${s.ai.confirmed + s.ai.falseAlarm} нарядов)`}
        />
      </div>
      <div className="row two-one">
        <Briefing />
        <Assistant />
      </div>
      <div className="row two">
        <Decisions />
        <OutputChart />
      </div>
      <div className="row two">
        <CostByStation />
        <ParetoChart />
      </div>
    </>
  );
}
