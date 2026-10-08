// Вид экрана «Цех сейчас»: объёмная модель или строгая панель. Режим — только способ показа:
// выбранный участок, оборудование и открытый инцидент общие для обоих режимов и переживают переключение.
import { create } from 'zustand';
import type { AreaId, ModelId } from '@allur/contracts/ref';
import { NO_FILTERS, type CarFilters } from './search';
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
  /** Путь машины по цеху в 3D (номер кузова): из карточки или паспорта */
  carPath: string | null;
  /** Выбранная машина (номер кузова): подсвечена в 3D, открыта её карточка — в обоих режимах */
  car: string | null;
  /** Открытый паспорт автомобиля (VIN) — поверх любого экрана */
  passport: string | null;
  /** Камера, лети к машине (из поиска, клавиша F): номер запроса меняется при каждом новом */
  flyCar: { bodyId: string; n: number } | null;
  /** Быстрые фильтры 3D: подходящие машины подсвечены, остальные приглушены */
  filters: CarFilters;
  /**
   * Слежение за машиной: в 3D камера ведёт её по цеху, в «Панели» подсвечен участок, где она сейчас.
   * paused — пользователь сам переместил камеру: плашка предлагает вернуться к машине.
   */
  follow: { bodyId: string; paused: boolean } | null;
  /** Слежение закончилось: машина принята на склад готовой продукции */
  followEnded: { bodyId: string; vin: string | null } | null;
}

/** Ссылка (?view=) важнее запомненного выбора; без выбора — 3D, если компьютер его потянет */
function initial(): Pick<ViewState, 'mode' | 'notice'> {
  if (!ENABLE_3D) return { mode: 'panel', notice: null };
  const asked = parseViewMode(new URLSearchParams(location.search).get('view')) ?? readSaved();
  const gl = webglSupport();
  if (gl === 'none') return { mode: 'panel', notice: asked === 'panel' ? null : NO_3D_MESSAGE };
  if (asked) return { mode: asked, notice: null };
  // на телефоне и узком планшете по умолчанию «Панель»: плавающие окна 3D закрыли бы сцену; 3D — по переключателю
  const roomy = typeof matchMedia === 'undefined' || matchMedia('(min-width: 1024px)').matches;
  return { mode: gl === 'ok' && roomy ? '3d' : 'panel', notice: null };
}

export const useView = create<ViewState>(() => ({
  ...initial(),
  area: null,
  equipment: null,
  areaPanel: false,
  incident: null,
  tour: false,
  carPath: null,
  car: null,
  passport: null,
  flyCar: null,
  filters: NO_FILTERS,
  follow: null,
  followEnded: null,
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
  useView.setState({ area, equipment, areaPanel: true, car: null });
}

/** Выбрать машину: карточка на месте панели участка; камера сама не перелетает */
export function selectCar(bodyId: string) {
  useView.setState({ car: bodyId, areaPanel: false });
}

/** Снять выбор машины (Esc, крестик карточки) */
export function closeCar() {
  useView.setState({ car: null });
}

/** Найти машину: выбрать, открыть карточку; в 3D — камера подлетает, в «Панели» — раскрыт её участок */
export function focusCar(bodyId: string, stageId?: string) {
  const v = useView.getState();
  useView.setState({
    car: bodyId,
    areaPanel: false,
    flyCar: { bodyId, n: (v.flyCar?.n ?? 0) + 1 },
    ...(v.mode === 'panel' && stageId ? { area: stageId as AreaId, equipment: null } : {}),
  });
}

/** Следить за машиной: она выбрана, камера подлетает и дальше ведёт её (автопоказ выключается) */
export function startFollow(bodyId: string) {
  useView.setState({ car: bodyId, areaPanel: false, follow: { bodyId, paused: false }, followEnded: null, tour: false });
}

export function stopFollow() {
  useView.setState({ follow: null });
}

/** Пользователь сам переместил камеру — слежение на паузе, можно вернуться к машине */
export function pauseFollow() {
  const f = useView.getState().follow;
  if (f && !f.paused) useView.setState({ follow: { ...f, paused: true } });
}

export function resumeFollow() {
  const f = useView.getState().follow;
  if (f) useView.setState({ follow: { ...f, paused: false } });
}

/** Машина доехала до склада готовой продукции: слежение закончено, плашка с паспортом */
export function endFollow(vin: string | null) {
  const f = useView.getState().follow;
  if (f) useView.setState({ follow: null, followEnded: { bodyId: f.bodyId, vin } });
}

export function dismissFollowEnded() {
  useView.setState({ followEnded: null });
}

export function toggleFlagFilter(flag: 'delayed' | 'rework') {
  useView.setState((v) => ({ filters: { ...v.filters, [flag]: !v.filters[flag] } }));
}

export function toggleModelFilter(model: ModelId) {
  useView.setState((v) => {
    const has = v.filters.models.includes(model);
    return { filters: { ...v.filters, models: has ? v.filters.models.filter((m) => m !== model) : [...v.filters.models, model] } };
  });
}

export function resetFilters() {
  useView.setState({ filters: NO_FILTERS });
}

export function openPassport(vin: string) {
  useView.setState({ passport: vin });
}

export function closePassport() {
  useView.setState({ passport: null });
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

/** «Показать путь в цеху»: линия маршрута машины в 3D; машина выбрана (карточка открыта) */
export function showCarPath(bodyId: string) {
  setViewMode('3d');
  if (useView.getState().mode !== '3d') return;
  useView.setState({ carPath: bodyId, car: bodyId, areaPanel: false });
}

/** Повторный клик скрывает путь */
export function toggleCarPath(bodyId: string) {
  if (useView.getState().carPath === bodyId) clearCarPath();
  else showCarPath(bodyId);
}

export function clearCarPath() {
  useView.setState({ carPath: null });
}

export function setTour(on: boolean) {
  useView.setState((v) => ({ tour: on && v.mode === '3d' }));
}
