// Слой 3D-сцены во весь экран. Стоит в одном и том же месте дерева в обоих режимах:
// после первого показа сцена остаётся в памяти без отрисовки — переключение туда-обратно мгновенное.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { fallbackToPanel, useView } from '../../state/view';
import { loadPlant3D } from '../../views/plant3d/load';
import { cx } from '../../lib/tones';
import { useTranslation } from '../../i18n/store';

const Plant3DView = lazy(loadPlant3D);

/** Повторный сбой в течение этого времени — 3D на этом компьютере не держится */
const RETRY_WINDOW_MS = 60_000;

export function Scene3DLayer() {
  const mode = useView((v) => v.mode);
  const [mounted, setMounted] = useState(mode === '3d');
  const [generation, setGeneration] = useState(0);
  const lastFailure = useRef(0);
  useEffect(() => {
    if (mode === '3d') setMounted(true);
  }, [mode]);

  // Первый сбой (потерян контекст WebGL, ошибка сцены) — тихо поднимаем сцену заново с новым контекстом:
  // разовая заминка видеодрайвера не должна выкидывать показ из 3D. Повторный сбой — «Панель» и пояснение.
  const fail = () => {
    const now = Date.now();
    if (now - lastFailure.current > RETRY_WINDOW_MS) {
      lastFailure.current = now;
      setGeneration((g) => g + 1);
      return;
    }
    setMounted(false);
    fallbackToPanel();
  };

  if (!mounted) return null;
  return (
    <div className={cx('view-in absolute inset-0 print:hidden', mode !== '3d' && 'hidden')}>
      <ErrorBoundary key={generation} onError={fail}>
        <Suspense fallback={<SceneLoading />}>
          <Plant3DView key={generation} active={mode === '3d'} onLost={fail} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}


function SceneLoading() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 grid place-items-center bg-page">
      <div className="flex items-center gap-2 text-lg text-ink-2">
        <LoaderCircle className="size-6 animate-spin text-accent" aria-hidden />
        {t.views.loading3d}
      </div>
    </div>
  );
}
