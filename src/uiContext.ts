import { createContext, useContext } from 'react';
import type { StationId } from './sim/types';

export type TabId = 'shop' | 'director' | 'mechanic' | 'journal';

export interface UiCtx {
  openWhatIf: (equipId: string) => void;
  toast: (title: string, text: string) => void;
  focusStation: (id: StationId, equipId?: string | null) => void;
  selectedStation: StationId | null;
  selectedEquip: string | null;
  setSelectedEquip: (id: string | null) => void;
  goto: (tab: TabId) => void;
}

export const Ui = createContext<UiCtx | null>(null);

export function useUi(): UiCtx {
  const c = useContext(Ui);
  if (!c) throw new Error('useUi outside provider');
  return c;
}
