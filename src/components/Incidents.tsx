import { useSim } from '../store';
import { useUi } from '../uiContext';
import { expediteSupply } from '../sim/engine';
import type { Severity } from '../sim/types';
import { clock } from '../lib/format';
import { Card, Icon, SEV_META, SevPill } from './ui';

const SEV_ORDER: Record<Severity, number> = { critical: 0, serious: 1, warning: 2, info: 3 };

export function IncidentFeed({ limit = 12 }: { limit?: number }) {
  const { s, dispatch } = useSim();
  const ui = useUi();
  const active = s.incidents.filter((i) => i.resolvedAt === null).sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || b.t - a.t);
  const recent = s.incidents.filter((i) => i.resolvedAt !== null).slice(0, Math.max(0, limit - active.length));

  return (
    <Card
      title={`Инциденты и отклонения${active.length ? ` · ${active.length}` : ''}`}
      hint="Двойник сам фиксирует аварии, прогнозы ИИ, дефицит комплектующих, рост брака и смещение узкого места."
    >
      <div className="list" style={{ maxHeight: 430 }}>
        {active.length + recent.length === 0 && <div className="empty">Отклонений нет — линия работает штатно</div>}
        {[...active, ...recent].map((i) => (
          <div
            key={i.id}
            className={`item sev-bar${i.resolvedAt !== null ? ' resolved' : ''}`}
            style={{ ['--sev' as string]: SEV_META[i.sev].color }}
          >
            <div className="item-head">
              <SevPill sev={i.sev} />
              <span className="item-meta tnum">
                {clock(i.t)}
                {i.resolvedAt !== null && i.sev !== 'info' && (
                  <>
                    <Icon name="check" size={12} /> {clock(i.resolvedAt)}
                  </>
                )}
              </span>
            </div>
            <div className="item-title">{i.title}</div>
            <div className="item-text">{i.text}</div>
            {i.resolvedAt === null && (
              <div className="item-actions">
                {i.action === 'whatif' && i.equipId && (
                  <button className="btn sm primary" onClick={() => ui.openWhatIf(i.equipId!)}>
                    <Icon name="scale" size={13} /> Сравнить решения
                  </button>
                )}
                {i.action === 'expedite' && (
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      dispatch(expediteSupply);
                      ui.toast('Экстренная поставка запрошена', 'Двойник пересчитал покрытие склада: фура прибудет через 30 минут.');
                    }}
                  >
                    <Icon name="truck" size={13} /> Запросить экстренную поставку
                  </button>
                )}
                {i.stationId && (
                  <button className="btn sm ghost" onClick={() => ui.focusStation(i.stationId!, i.equipId)}>
                    Показать на схеме
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
