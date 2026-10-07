// «Цех сейчас»: клавиша V переключает вид, вид отражается в адресе (?view=3d|panel) —
// так можно дать прямую ссылку на нужный режим. Ссылку читает стор при загрузке страницы.
import { useEffect } from 'react';
import { ENABLE_3D } from '../../lib/features';
import { toggleViewMode, useView, type ViewMode } from '../../state/view';

/** Меняем только view, остальные параметры (например ?demo) оставляем как были */
function searchWithView(search: string, mode: ViewMode): string {
  const rest = search
    .replace(/^\?/, '')
    .split('&')
    .filter((p) => p && !p.startsWith('view='));
  return `?${[...rest, `view=${mode}`].join('&')}`;
}

export function useViewControls() {
  const mode = useView((v) => v.mode);

  // Адрес — отражение стора, а не второй источник правды: replaceState без новой записи в истории
  // и без перерисовки маршрутизатора (его переходы идут в transition и опаздывают за клавишей V).
  useEffect(() => {
    if (!ENABLE_3D) return;
    const search = searchWithView(location.search, mode);
    if (search !== location.search) history.replaceState(history.state, '', location.pathname + search + location.hash);
  }, [mode]);

  useEffect(() => {
    if (!ENABLE_3D) return;
    const h = (e: KeyboardEvent) => {
      // KeyV — та же клавиша в русской раскладке («м»); с Ctrl — это вставка, не трогаем
      if (e.code !== 'KeyV' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement;
      if (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      toggleViewMode();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}
