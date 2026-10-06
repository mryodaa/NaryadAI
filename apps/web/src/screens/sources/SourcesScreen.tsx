// «Источники данных» — единственный технический экран: откуда двойник берёт данные и всё ли подключено.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { BookOpen, CircleCheck, CircleSlash, FileUp, Radio, TriangleAlert } from 'lucide-react';
import { SOURCES, STAGES, type SourceStatus, type Stage } from '@allur/contracts/ref';
import { api } from '../../api/client';
import type { ImportResponse, SourcesResponse } from '../../api/types';
import { Card } from '../../components/ui';
import { SourceBadge } from '../../components/SourceBadge';
import { useLive } from '../../state/live';
import { cx } from '../../lib/tones';
import { num, timeHM } from '../../lib/format';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function ago(iso: string | null, now: number): string {
  if (!iso) return 'сообщений ещё не было';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  return `${Math.round(m / 60)} ч назад`;
}

export function SourcesScreen() {
  const stage = useLive((s) => s.snapshot?.stage ?? 1);
  const statuses = useLive((s) => s.sources);
  const q = useQuery({ queryKey: ['sources'], queryFn: () => api<SourcesResponse>('/api/v1/sources'), refetchInterval: 5000 });
  const now = useNow();

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3 xl:gap-4 xl:px-6">
      <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">Откуда двойник берёт данные и всё ли подключено</h1>

      <StageSwitch stage={stage} />

      <div className="grid grid-cols-4 gap-3 xl:gap-4">
        {SOURCES.filter((s) => s.id !== 'import').map((def) => (
          <SourceCard key={def.id} id={def.id} status={statuses.find((x) => x.id === def.id)} now={now} lan={q.data?.lan ?? []} />
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-3 xl:gap-4">
        <Feed />
        <div className="flex flex-col gap-3 xl:gap-4">
          <Contradictions items={q.data?.contradictions ?? []} />
          <Unaccounted u={q.data?.unaccounted ?? null} stage={stage} />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 xl:gap-4">
        <Links />
        <Errors items={q.data?.validationErrors ?? []} />
      </div>
    </main>
  );
}

function StageSwitch({ stage }: { stage: Stage }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (s: Stage) => api('/api/v1/demo/stage', { method: 'POST', json: { stage: s } }),
    onSuccess: () => void qc.invalidateQueries(),
  });
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[1.125rem] font-semibold">Ступень внедрения</h2>
        <span className="text-base text-ink-3">Переключите — остальные экраны честно покажут, что видно на этой ступени</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => m.mutate(s.id)}
            className={cx(
              'flex flex-col gap-1 rounded-xl border-2 p-3 text-left transition-colors',
              stage === s.id ? 'border-accent bg-accent-bg' : 'border-line bg-surface hover:border-line-strong',
            )}
          >
            <span className="flex items-center gap-2 text-lg font-semibold">
              <span className={cx('grid size-7 place-items-center rounded-full text-base', stage === s.id ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2')}>{s.id}</span>
              {s.id === 0 ? 'Только 1С' : s.name.replace(/^\+ /, '+ ')}
            </span>
            <span className="text-base leading-snug text-ink-2">{s.description}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function SourceCard({ id, status, now, lan }: { id: SourceStatus['id']; status: SourceStatus | undefined; now: number; lan: string[] }) {
  const def = SOURCES.find((s) => s.id === id)!;
  const manual = id === 'master' || id === 'erp' || id === 'qls';
  const ok = status?.connected;
  const state: { label: string; tone: 'neutral' | 'attention' | 'waiting'; icon: typeof CircleCheck } = ok
    ? { label: 'Подключено', tone: 'neutral', icon: CircleCheck }
    : status?.expected
      ? { label: 'Нет данных', tone: 'attention', icon: TriangleAlert }
      : manual
        ? { label: id === 'erp' ? 'Ждёт плана' : id === 'qls' ? 'Ждёт несоответствий' : 'Ждёт ввода', tone: 'neutral', icon: Radio }
        : { label: 'Не подключено на этой ступени', tone: 'waiting', icon: CircleSlash };
  const Icon = state.icon;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[1.125rem] font-semibold leading-tight">
            <SourceBadge source={id} compact />
            {def.name}
          </div>
          <div className="mt-0.5 text-sm text-ink-3">{def.protocol}</div>
        </div>
      </div>
      <span
        className={cx(
          'inline-flex items-center gap-1.5 self-start text-base font-semibold',
          state.tone === 'attention' ? 'rounded-lg bg-st-attention-bg px-2 py-0.5 text-st-attention-ink' : state.tone === 'waiting' ? 'rounded-lg bg-st-waiting-bg px-2 py-0.5 text-st-waiting-ink' : 'text-st-neutral-ink',
        )}
      >
        <Icon className="size-[1.05em]" /> {state.label}
      </span>
      <p className="text-sm leading-snug text-ink-2">{def.about}</p>
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
        <dt className="text-ink-3">последнее</dt>
        <dd className="num text-right">{ago(status?.lastMessageAt ?? null, now)}</dd>
        <dt className="text-ink-3">в минуту</dt>
        <dd className="num text-right">{status ? num(status.perMinute) : '—'}</dd>
        <dt className="text-ink-3">ошибок за час</dt>
        <dd className={cx('num text-right', (status?.errorsLastHour ?? 0) > 0 && 'font-semibold text-st-attention-ink')}>{status?.errorsLastHour ?? 0}</dd>
      </dl>
      {id === 'master' && <MasterQr lan={lan} />}
    </Card>
  );
}

function MasterQr({ lan }: { lan: string[] }) {
  const [src, setSrc] = useState<string | null>(null);
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const host = local && lan[0] ? `${lan[0]}${location.port ? `:${location.port}` : ''}` : location.host;
  const url = `${location.protocol}//${host}/master`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#1b1f24', light: '#ffffff' } }).then(setSrc, () => setSrc(null));
  }, [url]);
  return (
    <div className="mt-1 flex items-center gap-3 rounded-xl bg-surface-2 p-2">
      {src && <img src={src} alt="QR-код экрана мастера" className="size-24 rounded-md" />}
      <div className="text-sm leading-snug text-ink-2">
        Наведите камеру телефона — откроется экран мастера. Простой отсюда сразу появится у руководителя.
        <div className="mt-1 break-all font-mono text-xs text-ink-3">{url}</div>
      </div>
    </div>
  );
}

function Feed() {
  const feed = useLive((s) => s.feed);
  const items = feed.slice(-24).reverse();
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-[1.125rem] font-semibold">Входящие сообщения — живой поток</h2>
      <ul className="h-[22rem] overflow-hidden rounded-xl bg-[#14181d] p-3 font-mono text-[0.8125rem] leading-relaxed text-[#d7dde4]">
        {items.map((f) => (
          <li key={f.id} className={cx('truncate', !f.ok && 'text-[#ffb4b4]', f.duplicate && 'text-[#9aa5b1]')}>
            <span className="text-[#8a94a0]">{f.receivedAt.slice(11, 19)}</span> <span className="text-[#9cc3ff]">{f.channel}</span> {f.summary}
          </li>
        ))}
        {items.length === 0 && <li className="text-[#8a94a0]">Ждём сообщений…</li>}
      </ul>
    </Card>
  );
}

function Contradictions({ items }: { items: SourcesResponse['contradictions'] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-[1.125rem] font-semibold">Найденные противоречия в данных</h2>
      {items.length === 0 ? (
        <p className="text-ink-2">Противоречий не найдено. Загрузите выданные таблицы — двойник их проверит.</p>
      ) : (
        <ul className="flex max-h-[18rem] flex-col gap-2 overflow-y-auto pr-1">
          {items.map((c) => (
            <li key={c.id} className={cx('rounded-xl border-l-4 px-3 py-2', c.severity === 'contradiction' ? 'border-st-attention bg-st-attention-bg' : 'border-st-waiting bg-st-waiting-bg')}>
              <div className="font-semibold leading-snug">{c.title}</div>
              <div className="text-sm leading-snug text-ink-2">{c.detail}</div>
              <div className="mt-0.5 text-xs text-ink-3">{c.source}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Unaccounted({ u, stage }: { u: SourcesResponse['unaccounted']; stage: Stage }) {
  return (
    <Card className="p-4">
      <h2 className="mb-1 text-[1.125rem] font-semibold">Неучтённые потери сегодня</h2>
      {stage === 0 || !u ? (
        <p className="text-ink-2">Видны со ступени 1: нужны контроллеры, чтобы сравнить фактические остановки с записями мастеров в 1С:MES.</p>
      ) : (
        <>
          <div className="text-[1.75rem] font-semibold leading-tight">
            <span className="num">{num(u.unaccountedMin)}</span> <span className="text-lg">мин</span>
          </div>
          <p className="text-base text-ink-2">
            Контроллеры зафиксировали <span className="num">{num(u.autoMin)}</span> мин остановок, в 1С:MES записано <span className="num">{num(u.mesMin)}</span> мин. Микропростоев: {u.microCount} — мастер их обычно не записывает.
          </p>
        </>
      )}
    </Card>
  );
}

function Links() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const r = await api<ImportResponse>('/api/v1/import/csv', { method: 'POST', body: text, headers: { 'content-type': 'text/csv' } });
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['sources'] });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-[1.125rem] font-semibold">Подключение и документация</h2>
      <div className="flex flex-wrap gap-2">
        <a href="/docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-accent-bg px-3 py-2 font-semibold text-accent-ink hover:bg-[#dfe8fb]">
          <BookOpen className="size-4" /> Документация API (Swagger)
        </a>
        <a href="/asyncapi" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-accent-bg px-3 py-2 font-semibold text-accent-ink hover:bg-[#dfe8fb]">
          <Radio className="size-4" /> Документация MQTT (AsyncAPI)
        </a>
        <button type="button" onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 font-semibold text-white hover:bg-accent-ink">
          <FileUp className="size-4" /> Загрузить CSV
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className="text-sm text-ink-3">Выданные таблицы лежат в репозитории: data/organizers/*.csv. Разделитель «;» или «,», десятичная запятая допустима.</p>
      {error && <p className="font-medium text-st-fault-ink">{error}</p>}
      {result && (
        <div className="rounded-xl bg-surface-2 p-3 text-base">
          <div className="font-semibold">{result.kindLabel}</div>
          <div className="text-ink-2">
            строк: {result.rows} · принято: {result.accepted} · уже были: {result.duplicates}
            {result.issues.length > 0 && ` · с ошибками: ${result.issues.length}`}
          </div>
          {result.issues.slice(0, 3).map((i, k) => (
            <div key={k} className="text-sm text-st-fault-ink">
              строка {i.row}: {i.path} — {i.message}
            </div>
          ))}
          <div className="mt-1 text-sm text-ink-3">Противоречий в данных: {result.contradictions.length} — список справа вверху.</div>
        </div>
      )}
    </Card>
  );
}

function Errors({ items }: { items: SourcesResponse['validationErrors'] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 text-[1.125rem] font-semibold">Отклонённые сообщения</h2>
      {items.length === 0 ? (
        <p className="text-ink-2">Ошибок проверки нет: все сообщения прошли схему.</p>
      ) : (
        <ul className="flex max-h-[14rem] flex-col gap-1.5 overflow-y-auto">
          {items.slice(0, 8).map((e) => (
            <li key={e.id} className="rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
              <span className="num text-ink-3">{timeHM(e.receivedAt)}</span> <span className="font-mono text-ink-2">{e.channel}</span>
              <div className="font-medium text-st-fault-ink">
                {e.issues[0]?.path}: {e.issues[0]?.message}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
