// Что под указателем в 3D: отдельный маленький стор, чтобы движение мыши перерисовывало только
// подсказку, курсор и подсветку машины, а не всю сцену.
import { create } from 'zustand';
import type { HoverTarget } from './equipment';

export const useHover = create<{ target: HoverTarget | null }>(() => ({ target: null }));

/** Новое значение — только если указатель перешёл на другой объект */
export function setHover(t: HoverTarget | null) {
  const cur = useHover.getState().target;
  if (cur === t || (cur && t && cur.kind === t.kind && cur.id === t.id)) return;
  useHover.setState({ target: t });
}

/** Указатель над тем, что можно выбрать кликом */
export function hoverPickable(t: HoverTarget | null): boolean {
  return !!t && (t.kind === 'zone' || t.kind === 'equipment' || t.kind === 'body');
}
