// «Допущения и параметры»: скорость времени двойника, условные деньги (настраиваются) и допущения модели.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { SPEEDS } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { SettingsResponse } from '../../api/types';
import { Button, Card } from '../../components/ui';
import { useLive } from '../../state/live';
import { cx } from '../../lib/tones';
import { money, speedLabel } from '../../lib/format';
import { useI18n } from '../../i18n/store';
import { translateDynamicText } from '../../i18n/translator';

/** Шлюз принимает ускорение до ×600 */
const SPEED_MAX = 600;

export function SettingsScreen() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/api/v1/settings') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(Object.entries(q.data.money).map(([k, v]) => [k, String(v)])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (m: Record<string, number>) => api('/api/v1/settings', { method: 'PUT', json: { money: m } }),
    onSuccess: () => void qc.invalidateQueries(),
  });
  const d = q.data;
  return (
    <main className="flex flex-col gap-4 px-4 pb-6 pt-3 xl:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{t.settings.title}</h1>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-4">
        <div className="flex flex-col gap-4">
          <SpeedCard />
          <Card className="p-4">
            <h2 className="text-[1.125rem] font-semibold">{t.settings.moneyTitle}</h2>
            <p className="mb-3 text-base text-st-attention-ink">{t.settings.moneyDesc}</p>
            {d && (
              <form
                className="flex flex-col gap-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, Number(v.replace(/\s/g, ''))])));
                }}
              >
                {Object.keys(d.money).map((k) => (
                  <label key={k} className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-3">
                    <span className="leading-snug">{translateDynamicText(d.labels[k], lang)}</span>
                    <span className="flex items-center gap-1.5">
                      <input
                        inputMode="numeric"
                        value={draft[k] ?? ''}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                        className="num h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-right text-base focus-visible:outline-2 focus-visible:outline-accent"
                      />
                      <span className="text-ink-2">₸</span>
                    </span>
                  </label>
                ))}
                <div className="mt-2 flex items-center gap-2">
                  <Button type="submit" variant="primary">
                    {save.isPending ? t.settings.savingButton : t.settings.saveButton}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setDraft(Object.fromEntries(Object.entries(d.defaults).map(([k, v]) => [k, String(v)])))}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-bg"
                  >
                    <RotateCcw className="size-4" /> {t.settings.defaultsButton}
                  </button>
                  {save.isSuccess && <span className="text-ink-2">{t.settings.savedNote}</span>}
                  {save.isError && <span className="font-medium text-st-fault-ink">{(save.error as Error).message}</span>}
                </div>
                <p className="mt-1 text-sm text-ink-3">{t.settings.carMarginExample(money(d.money.carMargin ?? 0, lang))}</p>
              </form>
            )}
          </Card>
        </div>
        <Card className="p-4">
          <h2 className="mb-2 text-[1.125rem] font-semibold">{t.settings.assumptionsTitle}</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-base leading-snug">
            {(d?.assumptions ?? []).map((a, i) => (
              <li key={i}>{translateDynamicText(a, lang)}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-3">
            {t.settings.integrationNote}
          </p>
        </Card>
      </div>
    </main>
  );
}

/** Во сколько раз время двойника идёт быстрее настоящего — для показа сценариев за минуты */
function SpeedCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const speed = useLive((s) => s.snapshot?.speed ?? null);
  const paused = useLive((s) => s.snapshot?.paused ?? false);
  const [draft, setDraft] = useState('');
  const apply = useMutation({
    mutationFn: (v: number) => api('/api/v1/demo/clock', { method: 'POST', json: { speed: v, paused: false } }),
    onSuccess: (d) => {
      qc.setQueryData(['demo'], d);
      setDraft('');
    },
  });
  const value = Number(draft.trim().replace(',', '.'));
  const filled = draft.trim() !== '';
  const valid = filled && Number.isInteger(value) && value >= 1 && value <= SPEED_MAX;

  return (
    <Card className="p-4">
      <h2 className="text-[1.125rem] font-semibold">{t.settings.speedTitle}</h2>
      <p className="mb-3 text-base text-ink-2">
        {t.settings.speedDesc}
      </p>
      <div className="mb-3 text-base">
        {t.settings.speedCurrent(speed === null ? '—' : speedLabel(speed))}
        {paused && <span className="text-ink-2"> · {t.settings.onPause}</span>}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) apply.mutate(value);
        }}
      >
        <label className="flex items-center gap-1.5">
          <span className="text-lg font-semibold text-ink-2" aria-hidden>
            ×
          </span>
          <input
            inputMode="numeric"
            aria-label="Ускорение времени, раз"
            placeholder={speed === null ? '60' : String(speed)}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="num h-10 w-24 rounded-xl border border-line-strong bg-surface px-3 text-right text-base focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <Button type="submit" variant="primary">
          {apply.isPending ? t.settings.applyingButton : t.settings.applyButton}
        </Button>
        <span className="ml-1 flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => apply.mutate(s)}
              className={cx('num rounded-lg px-2.5 py-1 font-semibold', speed === s ? 'bg-accent-bg text-accent-ink' : 'text-ink-2 hover:bg-surface-2')}
            >
              {speedLabel(s)}
            </button>
          ))}
        </span>
      </form>
      {filled && !valid && <p className="mt-2 text-base font-medium text-st-fault-ink">{t.settings.speedValidation(SPEED_MAX)}</p>}
      {apply.isError && <p className="mt-2 text-base font-medium text-st-fault-ink">{(apply.error as Error).message}</p>}
      <p className="mt-2 text-sm text-ink-3">{t.settings.speedNote}</p>
    </Card>
  );
}
