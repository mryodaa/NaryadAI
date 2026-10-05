import { useEffect, useMemo } from 'react';
import { useSim } from '../store';
import { assignOrder, ensureOrder, startOrder } from '../sim/engine';
import { whatIf } from '../sim/forecast';
import { dur, money, num, pct } from '../lib/format';
import { Icon } from './ui';

export function WhatIfModal({ equipId, onClose, onDone }: { equipId: string; onClose: () => void; onDone: (title: string, text: string) => void }) {
  const { s, dispatch, setSpeed, speed } = useSim();
  // считаем один раз на момент открытия и ставим симуляцию на паузу, чтобы цифры не «плыли»
  const res = useMemo(() => whatIf(s, equipId), [equipId]);
  const e = s.equipment.find((x) => x.id === equipId)!;
  useEffect(() => {
    const prev = speed;
    setSpeed(0);
    return () => setSpeed(prev || 5);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const maxCost = Math.max(...res.options.map((o) => o.costRub), 1);

  const approve = (id: 'now' | 'planned' | 'none') => {
    if (id === 'none') {
      onDone('Решение: продолжать работу', `${e.name} остаётся под наблюдением ИИ. Риск и деньги под угрозой продолжают пересчитываться.`);
      onClose();
      return;
    }
    let orderId = '';
    let ok = true;
    dispatch((x) => {
      const o = ensureOrder(x, equipId);
      orderId = o.id;
      if (id === 'now') ok = startOrder(x, o.id);
      else {
        assignOrder(x, o.id);
        o.deadline = res.plannedAt;
      }
    });
    if (id === 'now' && ok) onDone(`Наряд ${orderId}: ТО начато`, `${e.name} остановлен на плановое ТО. Ход работ — на вкладке «Механик».`);
    else if (id === 'now') onDone('Нельзя начать ТО сейчас', 'Участок в аварийной остановке или уже на обслуживании.');
    else onDone(`Наряд ${orderId} запланирован`, `ТО ${e.name} назначено на пересменку. Механик получил наряд.`);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label="Сравнение решений">
        <div className="card-head">
          <div>
            <h2 className="card-title" style={{ fontSize: 18 }}>
              Что делать с «{e.name}»?
              <span className="idea-tag">
                <Icon name="sparkle" size={11} /> what-if
              </span>
            </h2>
            <div className="card-hint">
              Риск отказа {pct(res.risk.p)}
              {res.risk.ttf != null && <> · критическая вибрация через ~{dur(res.risk.ttf)}</>}. Каждый вариант — отдельный прогон двойника на{' '}
              {Math.round(res.horizon / 60)} ч вперёд: буферы, узкое место и план учитываются автоматически. Симуляция на паузе.
            </div>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="options">
          {res.options.map((o) => (
            <div key={o.id} className={`option${o.recommended ? ' best' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <b>{o.title}</b>
                {o.recommended && (
                  <span className="pill" style={{ fontSize: 11.5 }}>
                    <span className="dot" style={{ background: 'var(--good)' }}>
                      <Icon name="check" size={10} strokeWidth={3} />
                    </span>
                    Рекомендация ИИ
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {o.subtitle}
              </div>
              <div>
                <div className="stat-label">Ожидаемые потери</div>
                <div className="option-cost">{money(o.costRub)}</div>
              </div>
              <div className="hbar-track" style={{ height: 8 }}>
                <div className="hbar-fill" style={{ width: `${(o.costRub / maxCost) * 100}%`, background: o.recommended ? 'var(--series-1)' : 'var(--text-muted)' }} />
              </div>
              <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <div className="stat-label">Недовыпуск</div>
                  <div className="stat-value">{num(o.lostCars)} авто</div>
                </div>
                <div>
                  <div className="stat-label">Вероятность аварии</div>
                  <div className="stat-value">{pct(o.pFail)}</div>
                </div>
              </div>
              <ul>
                {o.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <button className={`btn${o.recommended ? ' primary' : ''}`} style={{ marginTop: 'auto', justifyContent: 'center' }} onClick={() => approve(o.id)}>
                {o.id === 'none' ? 'Оставить как есть' : 'Утвердить и выписать наряд'}
              </button>
            </div>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Ожидаемые потери = вероятность × (недовыпуск × маржа 180 тыс ₽/авто + стоимость ремонта). Плановое ТО — 45 тыс ₽, аварийный ремонт — 650 тыс ₽.
        </div>
      </div>
    </div>
  );
}
