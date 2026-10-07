// Список наблюдения (до 5 машин) и всё, что следит за машинами с каждым сообщением трекера:
// переходы стадий у машин в наблюдении (событие и ненавязчивый тост), конец слежения на складе
// готовой продукции, глубокая ссылка ?car=<VIN или номер кузова>.
import { create } from 'zustand';
import { MODEL_BY_ID, inflect, type BodyView } from '@allur/contracts/ref';
import { api } from '../api/client';
import { useLive } from './live';
import { usePlant } from './plant';
import { endFollow, focusCar, setViewMode, startFollow, useView } from './view';
import { shortVin } from './cars';

export const WATCH_LIMIT = 5;
const STORAGE_KEY = 'watch-cars';

export interface WatchEvent {
  id: number;
  at: string;
  bodyId: string;
  text: string;
}

interface WatchState {
  ids: string[];
  /** Переходы стадий, новые сверху */
  events: WatchEvent[];
  /** Тост внизу экрана: не больше одного, новый заменяет старый */
  toast: WatchEvent | null;
}

function readIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, WATCH_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // без памяти браузера список живёт до перезагрузки страницы
  }
}

export const useWatch = create<WatchState>(() => ({ ids: readIds(), events: [], toast: null }));

/** Звёздочка в карточке: добавить или убрать; больше пяти — нельзя */
export function toggleWatch(bodyId: string): boolean {
  const ids = useWatch.getState().ids;
  if (ids.includes(bodyId)) {
    const next = ids.filter((x) => x !== bodyId);
    useWatch.setState({ ids: next });
    saveIds(next);
    return true;
  }
  if (ids.length >= WATCH_LIMIT) return false;
  const next = [...ids, bodyId];
  useWatch.setState({ ids: next });
  saveIds(next);
  return true;
}

export function dismissToast() {
  useWatch.setState({ toast: null });
}

// ---------------------------------------------------------------------------

/** Стадия для событий: очередь между участками — ещё не переход */
function stageKey(v: BodyView): string | null {
  if (v.loc.kind === 'finished') return 'finished';
  if (v.loc.kind === 'buffer') return null;
  return v.loc.stageId;
}

let seq = 0;
const lastStage = new Map<string, string>();
let pendingCar: string | null = null;
let started = false;

/** Каждое сообщение трекера (экспорт — для тестов) */
export function onBodies(bodies: BodyView[], at: string) {
  const plant = usePlant.getState().model;
  const byId = new Map(bodies.map((b) => [b.bodyId, b]));

  // переходы стадий у машин в наблюдении
  const { ids } = useWatch.getState();
  const fresh: WatchEvent[] = [];
  for (const id of ids) {
    const b = byId.get(id);
    if (!b) continue;
    const key = stageKey(b);
    if (!key) continue;
    const prev = lastStage.get(id);
    lastStage.set(id, key);
    if (prev === undefined || prev === key) continue;
    const name = `${MODEL_BY_ID[b.model].short} ${shortVin(b)}`;
    const stage = plant.stageById.get(b.loc.stageId);
    const text = key === 'finished' ? `${name} готова и принята на склад` : `${name} перешла в ${inflect(stage?.short ?? b.loc.stageId, 'acc')}`;
    fresh.push({ id: ++seq, at, bodyId: id, text });
  }
  if (fresh.length) {
    const s = useWatch.getState();
    useWatch.setState({ events: [...fresh.reverse(), ...s.events].slice(0, 20), toast: fresh[0]! });
  }

  // слежение: машина уехала на склад готовой продукции — слежение закончено
  const f = useView.getState().follow;
  if (f) {
    const b = byId.get(f.bodyId);
    if (b?.loc.kind === 'finished') endFollow(b.vin);
  }

  // глубокая ссылка: ждём первых данных трекера
  if (pendingCar) resolveCar(pendingCar, bodies);
}

function resolveCar(q: string, bodies: BodyView[]) {
  pendingCar = null;
  const up = q.toUpperCase();
  const b = bodies.find((x) => x.vin === up || x.bodyId.toUpperCase() === up);
  const show = (v: BodyView) => {
    const stageId = v.loc.kind === 'buffer' && v.loc.bufferId ? usePlant.getState().model.bufferById.get(v.loc.bufferId)?.to : v.loc.stageId;
    focusCar(v.bodyId, stageId);
    if (v.loc.kind !== 'finished') startFollow(v.bodyId);
  };
  if (b) {
    show(b);
    return;
  }
  // нет среди машин в цехе — спросим двойник (машина могла уже уйти на склад)
  api<BodyView>(`/api/v1/bodies/${encodeURIComponent(up)}`)
    .then(show)
    .catch(() => undefined);
}

/** Один раз при старте приложения */
export function startCarTracking() {
  if (started) return;
  started = true;
  const car = new URLSearchParams(location.search).get('car');
  if (car) {
    pendingCar = car.trim();
    // ссылка на машину — для показа: сразу 3D, если не просили «Панель»
    if (!new URLSearchParams(location.search).get('view')) setViewMode('3d');
  }
  let last: BodyView[] | null = null;
  useLive.subscribe((s) => {
    if (s.bodies === last) return;
    last = s.bodies;
    if (s.bodies.length) onBodies(s.bodies, s.snapshot?.now ?? new Date().toISOString());
  });
}
