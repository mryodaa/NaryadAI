// Повтор истории машины в 3D: какая машина повторяется и часы повтора.
// Часы меняются каждый кадр — это не стор, а общий объект: сцена двигает копию машины, панель
// с ползунком читает его сама, интерфейс от этого не перерисовывается.
import { create } from 'zustand';
import { showCarPath, stopFollow, useView } from './view';

export const useReplay = create<{ bodyId: string | null }>(() => ({ bodyId: null }));

export const replayClock = { pos: 0, playing: false };

/** «Повторить путь»: 3D, путь машины на полу и полупрозрачная копия, которая проезжает её историю */
export function startReplay(bodyId: string) {
  showCarPath(bodyId);
  if (useView.getState().mode !== '3d') return;
  // камера нужна пользователю для обзора, а не для слежения за живой машиной
  stopFollow();
  replayClock.pos = 0;
  replayClock.playing = true;
  useReplay.setState({ bodyId });
}

export function stopReplay() {
  replayClock.playing = false;
  useReplay.setState({ bodyId: null });
}
