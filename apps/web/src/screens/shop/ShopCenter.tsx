// Центр «Цех сейчас» в режиме «Панель»: строгий список участков. 3D — отдельным слоем во весь экран (Scene3DLayer).
import { useEffect, useState } from 'react';
import { Info, TriangleAlert, X } from 'lucide-react';
import type { LiveSnapshot } from '@allur/contracts/ref';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Button } from '../../components/ui';
import { dismissNotice, useView } from '../../state/view';
import { PanelView } from '../../views/panel/PanelView';

export function ShopCenter({ snapshot: s, onIncident }: { snapshot: LiveSnapshot; onIncident: (id: string) => void }) {
  const notice = useView((v) => v.notice);
  // ошибка в центре не должна гасить весь экран: показатели и «Требует внимания» продолжают работать
  const [panelTry, setPanelTry] = useState(0);
  return (
    <>
      {notice && <Notice text={notice} />}
      <ErrorBoundary key={panelTry} fallback={<CenterError onRetry={() => setPanelTry((n) => n + 1)} />}>
        <PanelView snapshot={s} onIncident={onIncident} />
      </ErrorBoundary>
    </>
  );
}

function CenterError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-5 shadow-card">
      <TriangleAlert className="size-6 shrink-0 text-st-attention" strokeWidth={2.25} aria-hidden />
      <span className="flex-1 text-lg leading-snug">Не получилось показать список участков. Показатели и «Требует внимания» работают.</span>
      <Button onClick={onRetry}>Показать снова</Button>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  useEffect(() => {
    const t = setTimeout(dismissNotice, 10_000);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div role="status" className="flex items-center gap-2 rounded-xl bg-st-waiting-bg px-3 py-2 text-base font-medium text-st-waiting-ink print:hidden">
      <Info className="size-5 shrink-0" strokeWidth={2.25} aria-hidden />
      <span className="flex-1">{text} — показываем «Панель»</span>
      <button type="button" onClick={dismissNotice} aria-label="Скрыть сообщение" className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-surface">
        <X className="size-4" />
      </button>
    </div>
  );
}
