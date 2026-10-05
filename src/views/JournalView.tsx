import { useEffect, useState } from 'react';
import { useSim } from '../store';
import { useUi } from '../uiContext';
import { STATIONS, stationIndex, DAY_START } from '../sim/config';
import { addJournalLoss } from '../sim/engine';
import { parseJournal, SAMPLE_JOURNAL, type ParsedEntry } from '../sim/journal';
import { dur, pct } from '../lib/format';
import { Card, Icon } from '../components/ui';

function Highlighted({ e }: { e: ParsedEntry }) {
  const out = [];
  let pos = 0;
  e.spans.forEach((sp, i) => {
    if (sp.start > pos) out.push(<span key={`t${i}`}>{e.raw.slice(pos, sp.start)}</span>);
    out.push(
      <span key={`h${i}`} className={`hl hl-${sp.kind}`}>
        {e.raw.slice(sp.start, sp.end)}
      </span>,
    );
    pos = sp.end;
  });
  if (pos < e.raw.length) out.push(<span key="end">{e.raw.slice(pos)}</span>);
  return <>{out}</>;
}

const LEGEND = [
  ['time', 'время'],
  ['station', 'участок'],
  ['equipment', 'оборудование'],
  ['cause', 'причина'],
  ['duration', 'длительность'],
] as const;

export function JournalView() {
  const { s, dispatch } = useSim();
  const ui = useUi();
  const [text, setText] = useState(SAMPLE_JOURNAL);
  const [parsed, setParsed] = useState<ParsedEntry[] | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [imported, setImported] = useState(false);

  useEffect(() => {
    if (!parsed || revealed >= parsed.length) return;
    const id = setTimeout(() => setRevealed((n) => n + 1), 350);
    return () => clearTimeout(id);
  }, [parsed, revealed]);

  const run = () => {
    setParsed(parseJournal(text));
    setRevealed(0);
    setImported(false);
  };

  const importAll = () => {
    if (!parsed) return;
    const ok = parsed.filter((p) => p.stationId && p.cat && p.minutes);
    dispatch((x) => {
      for (const p of ok) {
        const [hh, mm] = (p.time ?? '08:00').split(':').map(Number);
        addJournalLoss(x, p.stationId!, `Журнал: ${p.cause}`, p.cat!, p.minutes!, hh * 60 + mm - DAY_START);
      }
    });
    setImported(true);
    ui.toast('Записи добавлены в статистику', `${ok.length} простоев из журнала теперь учитываются в Парето потерь и OEE-анализе.`);
  };

  const done = parsed !== null && revealed >= parsed.length;
  const totalMin = parsed?.reduce((a, p) => a + (p.minutes ?? 0), 0) ?? 0;

  return (
    <div className="row two" style={{ alignItems: 'start' }}>
      <Card
        title="Журнал смены (свободный текст)"
        idea="старт без датчиков"
        hint="На заводах причины простоев пишут как попало, и эти данные никто не анализирует. ИИ превращает их в структуру за секунды, поэтому двойник можно запустить на уже существующих данных."
      >
        <textarea className="journal" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Текст журнала" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={run}>
            <Icon name="sparkle" size={14} /> Разобрать с помощью ИИ
          </button>
          <button className="btn ghost" onClick={() => setText(SAMPLE_JOURNAL)}>
            Вернуть пример
          </button>
        </div>
        <div className="card-hint">Можно дописать свои строки, например: «14:30 сварка, робот 7 ошибка привода, стояли 25 мин».</div>
      </Card>

      <Card
        title="Результат разбора"
        hint="В продукте это LLM со строгой JSON-схемой ответа. В демо работает эмулятор на правилах, но формат результата тот же."
        actions={
          done ? (
            <button className="btn primary" onClick={importAll} disabled={imported}>
              {imported ? (
                <>
                  <Icon name="check" size={14} /> Добавлено
                </>
              ) : (
                'Добавить в статистику простоев'
              )}
            </button>
          ) : undefined
        }
      >
        {!parsed && <div className="empty">Нажмите «Разобрать с помощью ИИ»</div>}
        {parsed && (
          <>
            <div className="map-legend">
              {LEGEND.map(([k, l]) => (
                <span key={k}>
                  <span className={`hl hl-${k}`}>{l}</span>
                </span>
              ))}
            </div>
            <div className="list">
              {parsed.slice(0, revealed).map((p, i) => (
                <div key={i} className="item">
                  <div style={{ fontSize: 13 }}>
                    <Highlighted e={p} />
                  </div>
                </div>
              ))}
              {!done && (
                <div className="item-meta">
                  <span className="caret" /> разбираю строку {revealed + 1} из {parsed.length}…
                </div>
              )}
            </div>
            {done && (
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Время</th>
                      <th>Участок</th>
                      <th>Оборудование</th>
                      <th>Категория</th>
                      <th style={{ textAlign: 'right' }}>Мин</th>
                      <th style={{ textAlign: 'right' }}>Уверенность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((p, i) => (
                      <tr key={i}>
                        <td className="tnum">{p.time ?? '—'}</td>
                        <td>{p.stationId ? STATIONS[stationIndex(p.stationId)].short : '—'}</td>
                        <td>{p.equipment ?? <span className="muted">не указано</span>}</td>
                        <td>{p.cat ?? <span className="muted">?</span>}</td>
                        <td className="num">{p.minutes ?? '—'}</td>
                        <td className="num">{pct(p.confidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="card-hint" style={{ marginTop: 8 }}>
                  Итого распознано {parsed.length} записей, {dur(totalMin)} простоев. Записи с низкой уверенностью в продукте уходят мастеру на подтверждение. Текущее время двойника — смена {s.shift.index + 1}.
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
