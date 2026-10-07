// Панель повтора истории: пуск и пауза, ползунок времени, где машина была в этот момент.
// Часы повтора идут в сцене; панель читает их сама раз в кадр, без перерисовки интерфейса.
import { useEffect, useRef, useState } from 'react';
import { invalidate } from '@react-three/fiber';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import { MODEL_BY_ID } from '@allur/contracts/ref';
import { useEscLayer } from '../../components/overlay';
import { useI18n } from '../../i18n/store';
import { useLive } from '../../state/live';
import { replayClock, stopReplay } from '../../state/replay';
import { shortVin } from '../../state/cars';
import { timeHM } from '../../lib/format';
import { sampleReplay, type Replay } from './replay';

const STEPS = 1000;

export function ReplayBar({ bodyId, replay, loading, stageName }: { bodyId: string; replay: Replay | null; loading: boolean; stageName: (id: string) => string }) {
  const lang = useI18n((s) => s.lang);
  const car = useLive((s) => s.bodies.find((b) => b.bodyId === bodyId));
  const slider = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(replayClock.playing);
  useEscLayer(stopReplay);

  // ползунок и часы — вслед за часами повтора
  useEffect(() => {
    if (!replay) return;
    let raf = 0;
    let shown = '';
    const tick = () => {
      if (slider.current && document.activeElement !== slider.current) slider.current.value = String(Math.round(replayClock.pos * STEPS));
      const s = sampleReplay(replay, replayClock.pos);
      const text = `${timeHM(s.at)} · ${stageName(s.frame.stageId)}`;
      if (clock.current && text !== shown) {
        shown = text;
        clock.current.textContent = text;
      }
      setPlaying((p) => (p !== replayClock.playing ? replayClock.playing : p));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replay, stageName]);

  const toggle = () => {
    if (replayClock.pos >= 1) replayClock.pos = 0;
    replayClock.playing = !replayClock.playing;
    setPlaying(replayClock.playing);
    invalidate();
  };
  const L = {
    title: lang === 'kk' ? 'Жолды қайталау' : lang === 'en' ? 'Route replay' : 'Повтор пути',
    play: lang === 'kk' ? 'Ойнату' : lang === 'en' ? 'Play' : 'Воспроизвести',
    pause: lang === 'kk' ? 'Кідірту' : lang === 'en' ? 'Pause' : 'Пауза',
    again: lang === 'kk' ? 'Басынан' : lang === 'en' ? 'From start' : 'Сначала',
    close: lang === 'kk' ? 'Қайталауды жабу' : lang === 'en' ? 'Close replay' : 'Закрыть повтор',
    time: lang === 'kk' ? 'Тарих уақыты' : lang === 'en' ? 'History time' : 'Время истории',
    loading: lang === 'kk' ? 'Тарих жүктелуде…' : lang === 'en' ? 'Loading history…' : 'Загружаю историю…',
    empty: lang === 'kk' ? 'Қайталауға тарих жеткіліксіз' : lang === 'en' ? 'Not enough history to replay' : 'Для повтора мало истории',
  };

  return (
    <div role="group" aria-label={L.title} className="view-in pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl bg-ink py-1 pl-1 pr-1 text-[0.9375rem] text-white shadow-pop">
      <button
        type="button"
        onClick={toggle}
        disabled={!replay}
        aria-label={playing ? L.pause : L.play}
        title={playing ? L.pause : L.play}
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40"
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      </button>
      <span className="shrink-0 font-semibold">
        {L.title}
        {car ? ` · ${MODEL_BY_ID[car.model].short} ${shortVin(car)}` : ''}
      </span>
      {replay ? (
        <>
          <input
            ref={slider}
            type="range"
            min={0}
            max={STEPS}
            defaultValue={Math.round(replayClock.pos * STEPS)}
            aria-label={L.time}
            onInput={(e) => {
              replayClock.pos = Number(e.currentTarget.value) / STEPS;
              invalidate();
            }}
            className="w-44 accent-[#7ea2f0] 2xl:w-64"
          />
          <span ref={clock} className="num w-[11.5rem] shrink-0 truncate text-white/85" aria-live="off" />
          <button
            type="button"
            onClick={() => {
              replayClock.pos = 0;
              replayClock.playing = true;
              setPlaying(true);
              invalidate();
            }}
            aria-label={L.again}
            title={L.again}
            className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-white/15"
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </>
      ) : (
        <span className="text-white/75">{loading ? L.loading : L.empty}</span>
      )}
      <button type="button" onClick={stopReplay} aria-label={L.close} title={L.close} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-white/15">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
