// Вид экрана «Цех сейчас»: объёмная модель или строгая панель. Режим — только способ показа:
// выбранный участок, оборудование и открытый инцидент общие для обоих режимов и переживают переключение.
import { create } from 'zustand';
import type { AreaId } from '@allur/contracts/ref';
import { ENABLE_3D } from '../lib/features';
import { webglSupport } from '../lib/webgl';

export type ViewMode = '3d' | 'panel';

export const NO_3D_MESSAGE = '3D недоступно на этом компьютере';

const STORAGE_KEY = 'shop-view';

export function parseViewMode(v: string | null | undefined): ViewMode | null {
  return v === '3d' || v === 'panel' ? v : null;
}

function readSaved(): ViewMode | null {
  try {
    return parseViewMode(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function save(mode: ViewMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // без памяти браузера выбор просто не запомнится
  }
}

interface ViewState {
  mode: ViewMode;
  /** Выбранный участок: раскрытая строка в панели, участок в фокусе камеры в 3D */
  area: AreaId | null;
  /** Оборудование в фокусе (клик в 3D): камера ближе, строка подсвечена в панели участка */
  equipment: string | null;
  /** Открыта ли панель выбранного участка */
  areaPanel: boolean;
  /** Открытый инцидент (история из четырёх блоков) */
  incident: string | null;
  /** Пояснение над центром экрана, например почему 3D не показано */
  notice: string | null;
  /** Автопоказ для демонстрации: камера сама облетает цех (только 3D) */
  tour: boolean;
  /** Путь кузова по VIN, показанный в 3D из паспорта автомобиля */
  vinPath: { vin: string; posts: string[] } | null;
}

/** Ссылка (?view=) важнее запомненного выбора; без выбора — 3D, если компьютер его потянет */
function initial(): Pick<ViewState, 'mode' | 'notice'> {
  if (!ENABLE_3D) return { mode: 'panel', notice: null };
  const asked = parseViewMode(new URLSearchParams(location.search).get('view')) ?? readSaved();
  const gl = webglSupport();
  if (gl === 'none') return { mode: 'panel', notice: asked === 'panel' ? null : NO_3D_MESSAGE };
  if (asked) return { mode: asked, notice: null };
  return { mode: gl === 'ok' ? '3d' : 'panel', notice: null };
}

export const useView = create<ViewState>(() => ({
  ...initial(),
  area: null,
  equipment: null,
  areaPanel: false,
  incident: null,
  tour: false,
  vinPath: null,
}));

export function setViewMode(mode: ViewMode) {
  if (!ENABLE_3D) return;
  if (mode === '3d' && webglSupport() === 'none') {
    useView.setState({ mode: 'panel', notice: NO_3D_MESSAGE, tour: false });
    return;
  }
  save(mode);
  useView.setState((v) => ({ mode, notice: null, tour: mode === '3d' && v.tour }));
}

export function toggleViewMode() {
  setViewMode(useView.getState().mode === '3d' ? 'panel' : '3d');
}

/** 3D упало (потерян контекст WebGL, ошибка сцены): показываем панель и говорим почему */
export function fallbackToPanel() {
  useView.setState({ mode: 'panel', notice: NO_3D_MESSAGE, tour: false });
}

export function dismissNotice() {
  useView.setState({ notice: null });
}

/** Выбрать участок (null — весь цех) */
export function selectArea(area: AreaId | null) {
  useView.setState({ area, equipment: null });
}

/** Открыть панель участка; участок (и оборудование, если кликнули по нему) становится выбранным */
export function openAreaPanel(area: AreaId, equipment: string | null = null) {
  useView.setState({ area, equipment, areaPanel: true });
}

/** Закрыть панель; участок остаётся выбранным */
export function closeAreaPanel() {
  useView.setState({ areaPanel: false });
}

/** «Вернуться к цеху»: снять выбор и показать весь цех */
export function backToPlant() {
  useView.setState({ area: null, equipment: null, areaPanel: false });
}

export function openIncident(id: string) {
  useView.setState({ incident: id });
}

export function closeIncident() {
  useView.setState({ incident: null });
}

/** Путь кузова по VIN в 3D (кнопка в паспорте автомобиля) */
export function showVinPath(vin: string, posts: string[]) {
  setViewMode('3d');
  if (useView.getState().mode !== '3d') return;
  useView.setState({ vinPath: { vin, posts }, area: null, equipment: null, areaPanel: false });
}

export function clearVinPath() {
  useView.setState({ vinPath: null });
}

export function setTour(on: boolean) {
  useView.setState((v) => ({ tour: on && v.mode === '3d' }));
}
