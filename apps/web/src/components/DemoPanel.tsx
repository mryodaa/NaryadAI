// Пульт демонстрации: клавиша D (и кнопка в углу в режиме ?demo). Скорость, пауза, сброс, сценарии, ступень.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Pause, Play, RotateCcw, X } from 'lucide-react';
import { SCENARIOS, SPEEDS, STAGES, type ScenarioId, type Stage } from '@allur/contracts/ref';
import { api } from '../api/client';
import { useLive } from '../state/live';
import { cx } from '../lib/tones';
import { timeHM } from '../lib/format';

interface DemoState {
  speed: number;
  paused: boolean;
  stage: Stage;
  scenario: ScenarioId;
}

export function DemoPanel() {
  const [open, setOpen] = useState(false);
  const demoMode = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
  const qc = useQueryClient();
  const snap = useLive((s) => s.snapshot);
  const q = useQuery({ queryKey: ['demo'], queryFn: () => api<DemoState>('/api/v1/demo'), enabled: open, refetchInterval: open ? 2000 : false });
  const post = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api<DemoState>(`/api/v1/demo/${path}`, { method: 'POST', json: body }),
    onSuccess: (d) => qc.setQueryData(['demo'], d),
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') setOpen((v) => !v);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const d = q.data;
  return (
    <>
      {demoMode && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-30 grid size-11 place-items-center rounded-full bg-ink text-white shadow-pop"
          title="Пульт демонстрации (D)"
        >
          <Gauge className="size-5" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-4 right-4 z-50 w-[23rem] rounded-2xl bg-ink p-4 text-white shadow-pop">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="font-semibold">Пульт демонстрации</div>
              <div className="num text-sm text-white/60">
                {snap ? `${timeHM(snap.now)} · ` : ''}клавиша D
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg hover:bg-white/10" aria-label="Закрыть пульт">
              <X className="size-5" />
            </button>
          </div>

          <div className="mb-3 flex items-center gap-1.5">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => post.mutate({ path: 'clock', body: { speed: s, paused: false } })}
                className={cx('num flex-1 rounded-lg py-1.5 font-semibold', d?.speed === s && !d.paused ? 'bg-white text-ink' : 'bg-white/10 hover:bg-white/20')}
              >
                ×{s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => post.mutate({ path: 'clock', body: { paused: !d?.paused } })}
              className="grid size-9 place-items-center rounded-lg bg-white/10 hover:bg-white/20"
              title={d?.paused ? 'Продолжить' : 'Пауза'}
            >
              {d?.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </button>
            <button type="button" onClick={() => post.mutate({ path: 'reset', body: {} })} className="grid size-9 place-items-center rounded-lg bg-white/10 hover:bg-white/20" title="Сброс к началу сценария">
              <RotateCcw className="size-4" />
            </button>
          </div>

          <div className="mb-1 text-sm text-white/60">Сценарий</div>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.description}
                onClick={() => post.mutate({ path: 'scenario', body: { scenario: s.id } })}
                className={cx('rounded-lg px-2 py-1.5 text-left text-sm font-medium leading-tight', d?.scenario === s.id ? 'bg-white text-ink' : 'bg-white/10 hover:bg-white/20')}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div className="mb-1 text-sm text-white/60">Ступень внедрения</div>
          <div className="flex gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.description}
                onClick={() => post.mutate({ path: 'stage', body: { stage: s.id } })}
                className={cx('flex-1 rounded-lg px-1.5 py-1.5 text-sm font-medium leading-tight', d?.stage === s.id ? 'bg-white text-ink' : 'bg-white/10 hover:bg-white/20')}
              >
                {s.id}: {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
