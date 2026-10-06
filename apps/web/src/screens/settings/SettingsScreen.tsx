// «Допущения и параметры»: условные деньги (настраиваются) и допущения модели.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { api } from '../../api/client';
import type { SettingsResponse } from '../../api/types';
import { Button, Card } from '../../components/ui';
import { money } from '../../lib/format';

export function SettingsScreen() {
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
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Допущения и параметры</h1>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-4">
        <Card className="p-4">
          <h2 className="text-[1.125rem] font-semibold">Деньги</h2>
          <p className="mb-3 text-base text-st-attention-ink">Условно, уточняется с заводом. По этим значениям двойник считает потери и сравнивает варианты решений.</p>
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
                  <span className="leading-snug">{d.labels[k]}</span>
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
                <Button variant="primary">{save.isPending ? 'Сохраняю…' : 'Сохранить'}</Button>
                <button
                  type="button"
                  onClick={() => setDraft(Object.fromEntries(Object.entries(d.defaults).map(([k, v]) => [k, String(v)])))}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-bg"
                >
                  <RotateCcw className="size-4" /> Значения по умолчанию
                </button>
                {save.isSuccess && <span className="text-ink-2">Сохранено — прогнозы пересчитаны</span>}
                {save.isError && <span className="font-medium text-st-fault-ink">{(save.error as Error).message}</span>}
              </div>
              <p className="mt-1 text-sm text-ink-3">Например, недовыпуск одной машины сейчас стоит {money(d.money.carMargin ?? 0)} упущенной маржи.</p>
            </form>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-[1.125rem] font-semibold">Допущения модели</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-base leading-snug">
            {(d?.assumptions ?? []).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-3">
            В интерфейсе не используются внутренние настройки систем Allur: типичная интеграция с 1С:MES/QLS/WMS, конкретная выгрузка настраивается со специалистами завода. Найденные
            противоречия в данных — на экране «Источники данных».
          </p>
        </Card>
      </div>
    </main>
  );
}
