// Экран мастера на телефоне: «Что случилось на моём участке?» — регистрация за 2 касания, в перчатках.
// Отправка идёт в тот же REST шлюза, что и у 1С.
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Cog, PackageX, Settings2, Hourglass, CircleHelp, Wrench, TriangleAlert } from 'lucide-react';
import type { AreaId, StageKind } from '@allur/contracts/ref';
import { api } from '../../api/client';
import { useLive } from '../../state/live';
import { usePlant, usePlantModel } from '../../state/plant';
import { cx } from '../../lib/tones';

const REASONS = [
  { id: 'breakdown', label: 'Поломка', icon: Wrench },
  { id: 'no_parts', label: 'Нет деталей', icon: PackageX },
  { id: 'setup', label: 'Наладка', icon: Settings2 },
  { id: 'waiting', label: 'Ждём решения', icon: Hourglass },
  { id: 'other', label: 'Другое', icon: CircleHelp },
] as const;

/** Дефекты, которые мастер отмечает на участке — по виду участка */
const DEFECTS: Partial<Record<StageKind, { id: string; label: string }[]>> = {
  welding: [
    { id: 'weld_geometry', label: 'Геометрия кузова' },
    { id: 'weld_spot', label: 'Непровар точки' },
  ],
  painting: [
    { id: 'paint_dirt', label: 'Сорность' },
    { id: 'paint_run', label: 'Потёки' },
    { id: 'paint_thin', label: 'Непрокрас' },
  ],
  assembly: [
    { id: 'asm_gap', label: 'Зазоры' },
    { id: 'asm_torque', label: 'Не дотянуто' },
    { id: 'asm_electric', label: 'Электрика' },
  ],
  inspection: [
    { id: 'asm_leak', label: 'Протечка' },
    { id: 'asm_gap', label: 'Зазоры' },
    { id: 'asm_electric', label: 'Электрика' },
  ],
};

type Step = 'home' | 'downtime' | 'defect' | 'sent';

function loadArea(): AreaId {
  const production = usePlant.getState().model.production;
  try {
    const v = localStorage.getItem('master-area');
    if (v && production.some((a) => a.id === v)) return v as AreaId;
  } catch {
    /* хранилище недоступно — участок по умолчанию */
  }
  return production.find((a) => a.kind === 'assembly')?.id ?? production[0]?.id ?? 'assembly';
}

export function MasterScreen() {
  const model = usePlantModel();
  // участки мастера — производственные участки из конфигурации завода
  const AREAS = model.production.map((s) => ({ id: s.id, name: s.short, kind: s.kind }));
  const [area, setArea] = useState<AreaId>(loadArea);
  const [step, setStep] = useState<Step>('home');
  const [eq, setEq] = useState<string>('');
  const [sent, setSent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const stage = model.stageById.get(area);
  const kind = stage?.kind ?? 'custom';
  const equipment = (stage?.equipment ?? []).filter((e) => !e.passive);

  useEffect(() => {
    try {
      localStorage.setItem('master-area', area);
    } catch {
      /* не страшно */
    }
    setEq(equipment.find((e) => e.critical)?.id ?? equipment[0]?.id ?? '');
  }, [area]);

  useEffect(() => {
    if (step !== 'sent') return;
    const t = setTimeout(() => setStep('home'), 3500);
    return () => clearTimeout(t);
  }, [step]);

  const sendDowntime = async (reasonId: (typeof REASONS)[number]['id'], label: string) => {
    setError(null);
    try {
      await api('/api/v1/downtimes', {
        method: 'POST',
        json: { source: 'master', area, equipmentId: eq, reason: label, category: reasonId, registeredBy: `Мастер участка «${AREAS.find((a) => a.id === area)!.name}»` },
      });
      setSent(`Простой: ${label.toLowerCase()} · ${model.equipmentById.get(eq)?.name ?? ''}`);
      setStep('sent');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sendDefect = async (defect: string, label: string) => {
    setError(null);
    try {
      // время — по часам двойника (в демо оно идёт с ускорением)
      const now = useLive.getState().snapshot?.now ?? new Date(Date.now() + 5 * 3600_000).toISOString().replace(/\.\d+Z$/, '+05:00');
      await api('/api/v1/events', {
        method: 'POST',
        json: [
          {
            eventId: `master-nc-${crypto.randomUUID()}`,
            source: 'master',
            ts: now,
            area,
            type: 'nonconformity',
            payload: {
              checkpoint: kind === 'welding' ? 'CP-WELD' : kind === 'painting' ? 'CP-PAINT' : 'CP-FINAL',
              defect,
              decision: kind === 'painting' ? 'repaint' : 'rework',
              // брак, найденный на контроле, — на совести сборки
              responsibleArea: kind === 'inspection' ? (model.production.find((s) => s.kind === 'assembly')?.id ?? area) : area,
              count: 1,
            },
          },
        ],
      });
      setSent(`Брак: ${label.toLowerCase()}`);
      setStep('sent');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[30rem] flex-col bg-page px-4 pb-6 pt-4">
      <header className="mb-4 flex items-center gap-3">
        {step !== 'home' && step !== 'sent' ? (
          <button type="button" onClick={() => setStep('home')} className="grid size-14 place-items-center rounded-2xl bg-surface shadow-card" aria-label="Назад">
            <ArrowLeft className="size-7" />
          </button>
        ) : (
          <img src="/favicon.svg" alt="" className="size-10" />
        )}
        <div className="leading-tight">
          <div className="text-xl font-semibold">Что случилось на участке?</div>
          <div className="text-base text-ink-2">Мастер участка</div>
        </div>
      </header>

      {step === 'home' && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Участок">
            {AREAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={area === a.id}
                onClick={() => setArea(a.id)}
                className={cx('min-h-14 rounded-2xl px-1 text-lg font-semibold', area === a.id ? 'bg-ink text-white' : 'bg-surface text-ink shadow-card')}
              >
                {a.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setStep('downtime')}
            className="mb-3 flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-3xl bg-st-fault text-white shadow-pop active:scale-[0.99]"
          >
            <Cog className="size-12" />
            <span className="text-[2rem] font-bold">Простой</span>
          </button>
          <button
            type="button"
            onClick={() => setStep('defect')}
            className="flex min-h-[9rem] flex-col items-center justify-center gap-2 rounded-3xl bg-st-attention text-white shadow-pop active:scale-[0.99]"
          >
            <TriangleAlert className="size-12" />
            <span className="text-[2rem] font-bold">Брак</span>
          </button>
          <p className="mt-4 text-center text-base text-ink-3">Участок запоминается. Сообщение сразу видит руководитель.</p>
        </>
      )}

      {step === 'downtime' && (
        <>
          {equipment.length > 1 && (
            <div className="mb-3">
              <div className="mb-1.5 text-base text-ink-2">Оборудование</div>
              <div className="flex flex-wrap gap-2">
                {equipment.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setEq(e.id)}
                    className={cx('min-h-12 rounded-xl px-3 text-base font-semibold', eq === e.id ? 'bg-ink text-white' : 'bg-surface shadow-card')}
                  >
                    {e.name.replace('Робот ', '')}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mb-1.5 text-base text-ink-2">Причина — нажмите, и простой отправится</div>
          <div className="grid grid-cols-2 gap-3">
            {REASONS.map((r) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void sendDowntime(r.id, r.label)}
                  className={cx('flex min-h-[7rem] flex-col items-center justify-center gap-2 rounded-2xl bg-surface text-xl font-semibold shadow-card active:bg-surface-2', r.id === 'other' && 'col-span-2')}
                >
                  <Icon className="size-9 text-ink-2" />
                  {r.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {step === 'defect' && (
        <>
          <div className="mb-1.5 text-base text-ink-2">Что за брак — нажмите, и сообщение отправится</div>
          <div className="grid grid-cols-2 gap-3">
            {[...(DEFECTS[kind] ?? []), { id: 'other', label: 'Другое' }].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => void sendDefect(d.id === 'other' ? 'Другое (со слов мастера)' : d.id, d.label)}
                className="flex min-h-[7rem] items-center justify-center rounded-2xl bg-surface px-2 text-center text-xl font-semibold shadow-card active:bg-surface-2"
              >
                {d.label}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 'sent' && (
        <button type="button" onClick={() => setStep('home')} className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <span className="grid size-36 place-items-center rounded-full bg-ink text-white">
            <Check className="size-24" strokeWidth={3} />
          </span>
          <span className="text-[2rem] font-bold">Отправлено</span>
          <span className="text-lg text-ink-2">{sent}</span>
          <span className="text-base text-ink-3">Руководитель уже видит это на экране «Цех сейчас»</span>
        </button>
      )}

      {error && <p className="mt-4 rounded-xl bg-st-fault-bg p-3 text-lg font-medium text-st-fault-ink">Не отправилось: {error}</p>}
    </div>
  );
}
