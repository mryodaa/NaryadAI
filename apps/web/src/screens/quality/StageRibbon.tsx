import { useState } from 'react';
import { ChevronDown, CircleCheck, CircleDot, CircleX, Circle, CornerDownRight, Hourglass, RotateCcw, TriangleAlert } from 'lucide-react';
import type { RibbonStage } from '../../state/stages';
import { TONE_CLASS, cx } from '../../lib/tones';
import { timeHM } from '../../lib/format';
import { useI18n } from '../../i18n/store';
import { translateDynamicText } from '../../i18n/translator';

export function StageRibbon({ stages }: { stages: RibbonStage[] }) {
  const { t, lang } = useI18n();
  const initial = stages.find((s) => s.mark === 'now' || s.mark === 'queue')?.id ?? [...stages].reverse().find((s) => s.mark === 'done')?.id ?? null;
  const [open, setOpen] = useState<string | null>(initial);
  const sel = stages.find((s) => s.id === open) ?? null;
  const markText: Record<RibbonStage['mark'], string> = { done: t.quality.ribbonDone, now: t.quality.ribbonNow, queue: t.quality.ribbonQueue, ahead: t.quality.ribbonAhead };

  return (
    <section aria-label={t.quality.stageRibbonTitle}>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((s) => (
          <li key={s.id} className="flex min-w-0 flex-col gap-1.5">
            <StageCard s={s} markText={markText} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} />
            {s.branches.map((b, i) => (
              <div
                key={i}
                className={cx(
                  'flex items-start gap-1 rounded-lg px-2 py-1 text-sm leading-tight',
                  b.kind === 'loop' ? cx(TONE_CLASS.attention.bg, TONE_CLASS.attention.ink) : 'bg-surface-2 text-ink-2',
                )}
              >
                {b.kind === 'loop' ? <RotateCcw className="mt-px size-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : <CornerDownRight className="mt-px size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />}
                <span className="min-w-0">
                  <span className="font-semibold">{b.title}</span>
                  {b.from && (
                    <span className="num block">
                      {timeHM(b.from, lang)}
                      {b.to ? `–${timeHM(b.to, lang)}` : ''}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ol>
      {sel && <StageDetails s={sel} />}
    </section>
  );
}

function StageCard({ s, markText, open, onToggle }: { s: RibbonStage; markText: Record<RibbonStage['mark'], string>; open: boolean; onToggle: () => void }) {
  const { t, lang } = useI18n();
  const future = s.mark === 'ahead' || s.mark === 'queue';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${s.name}${s.line ? `, ${s.line}` : ''}: ${markText[s.mark]}`}
      className={cx(
        'flex min-h-[8.5rem] flex-col gap-1 rounded-xl px-2.5 py-2 text-left shadow-card ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        s.mark === 'now' ? 'bg-accent-bg ring-accent' : future ? 'bg-page text-ink-3 ring-line' : 'bg-surface ring-line hover:bg-surface-2',
        open && 'ring-2',
      )}
    >
      <span className="flex items-center gap-1.5">
        <BodyLookIcon look={s.look} faded={future} />
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate font-semibold', future ? 'text-ink-3' : 'text-ink')}>{s.name}</span>
          {s.line && <span className="block truncate text-xs text-ink-3">{s.line}</span>}
        </span>
        <ChevronDown className={cx('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </span>
      <span className="flex items-center gap-1 text-sm font-semibold">
        <MarkIcon mark={s.mark} />
        <span className={s.mark === 'now' ? 'text-accent-ink' : future ? 'text-ink-3' : 'text-ink-2'}>{markText[s.mark]}</span>
      </span>
      <span className="num text-sm leading-snug">
        {s.assumed ? (
          <span className="text-ink-3">{t.quality.ribbonAssumed}</span>
        ) : s.in && s.out === s.in ? (
          <span className="text-ink-2">{t.quality.ribbonAcceptedAt(timeHM(s.in, lang))}</span>
        ) : s.in ? (
          <span className="text-ink-2">
            {timeHM(s.in, lang)} → {s.out ? timeHM(s.out, lang) : s.forecast ? <span className="text-ink-3">≈ {timeHM(s.forecast.out, lang)}</span> : '…'}
          </span>
        ) : s.forecast ? (
          <span className="text-ink-3">
            ≈ {timeHM(s.forecast.in ?? s.forecast.out, lang)}
            {s.forecast.in !== null && s.forecast.in !== s.forecast.out ? ` → ${timeHM(s.forecast.out, lang)}` : ''}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </span>
      {s.minutes !== null && (
        <span className={cx('num text-sm', s.late ? cx('font-semibold', TONE_CLASS.attention.ink) : 'text-ink-2')}>
          {s.minutes} {t.carCard.minuteUnit}{s.normMin ? ` · ${t.quality.ribbonNorm(s.normMin)}` : ''}
        </span>
      )}
      {s.minutes === null && future && s.normMin && <span className="num text-sm text-ink-3">{t.quality.ribbonNorm(s.normMin)}</span>}
      {s.restored.length > 0 && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-3">
          <TriangleAlert className="size-3.5" aria-hidden /> {t.carCard.restoredMark}
        </span>
      )}
    </button>
  );
}

function MarkIcon({ mark }: { mark: RibbonStage['mark'] }) {
  if (mark === 'done') return <CircleCheck className="size-4 text-st-neutral" strokeWidth={2.5} aria-hidden />;
  if (mark === 'now') return <CircleDot className="size-4 text-accent" strokeWidth={2.75} aria-hidden />;
  if (mark === 'queue') return <Hourglass className="size-4 text-st-waiting" strokeWidth={2.5} aria-hidden />;
  return <Circle className="size-4 text-line-strong" strokeWidth={2} aria-hidden />;
}

/** Силуэт кузова цветом его вида: металл, катафорез, грунт, цвет, сборка; на стенде — с роликами */
function BodyLookIcon({ look, faded }: { look: RibbonStage['look']; faded: boolean }) {
  return (
    <span title={look.label} className={cx('grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2', faded && 'opacity-50')}>
      <svg viewBox="0 0 32 20" className="h-5 w-8" aria-label={look.label} role="img">
        {look.kind === 'kit' ? (
          <rect x="5" y="6" width="22" height="10" rx="1.5" fill={look.color} stroke="#6b5537" strokeWidth="1" />
        ) : (
          <>
            <path d="M3 13.5 L5 9 Q6 8 8 8 L11 8 L14 4.5 Q15 4 16.5 4 L22 4 Q23.5 4 24.5 5 L27 8.5 Q29 9 29 11 L29 13.5 Z" fill={look.color} stroke="#3d4652" strokeWidth="0.8" />
            {(look.kind === 'assembled' || look.kind === 'stand' || look.kind === 'parked') && (
              <>
                <circle cx="9" cy="14" r="2.6" fill="#2b2f36" />
                <circle cx="23" cy="14" r="2.6" fill="#2b2f36" />
              </>
            )}
            {look.kind === 'stand' && <rect x="3" y="17" width="26" height="1.6" rx="0.8" fill="#6b7280" />}
          </>
        )}
      </svg>
    </span>
  );
}

function StageDetails({ s }: { s: RibbonStage }) {
  const { t, lang } = useI18n();
  const loops = [...new Set(s.ops.map((o) => o.loop))];
  const result: Record<string, { text: string; icon: typeof CircleCheck; cls: string }> = {
    done: { text: t.quality.resDone, icon: CircleCheck, cls: 'text-st-neutral' },
    failed: { text: t.quality.resFailed, icon: CircleX, cls: TONE_CLASS.attention.ink },
    in_progress: { text: t.quality.resInProgress, icon: CircleDot, cls: 'text-accent' },
    waiting: { text: t.quality.resWaiting, icon: Circle, cls: 'text-line-strong' },
    skipped: { text: t.quality.resSkipped, icon: Circle, cls: 'text-line-strong' },
  };

  const sourceMap: Record<string, string> = {
    mes: '1С:MES',
    erp: '1С:ERP',
    qls: '1С:QLS',
    wms: '1С:WMS',
    plc: t.quality.srcPlc,
    master: t.quality.srcMaster,
    camera: t.quality.srcCamera,
  };

  return (
    <div className="mt-3 rounded-xl bg-surface p-3 shadow-card ring-1 ring-line">
      <h3 className="mb-1.5 font-semibold">
        {s.name}
        {s.line ? ` · ${s.line}` : ''}: {t.quality.stageOperations}
      </h3>
      {loops.map((loop) => (
        <div key={loop} className={cx(loop > 0 && 'mt-2 border-l-4 border-st-attention pl-2.5')}>
          {loop > 0 && <div className={cx('mb-1 text-sm font-semibold', TONE_CLASS.attention.ink)}>{t.quality.repeatPassLoop(loop + 1)}</div>}
          <table className="w-full text-[0.9375rem]">
            <tbody>
              {s.ops
                .filter((o) => o.loop === loop)
                .map((o, i) => {
                  const r = result[o.status] ?? result.waiting!;
                  const Icon = r.icon;
                  return (
                    <tr key={i} className="border-t border-line first:border-t-0">
                      <td className="py-1 pr-3">
                        {translateDynamicText(o.name, lang)}
                        {o.optional && <span className="text-ink-3"> · {t.carCard.optionalOp}</span>}
                      </td>
                      <td className="num w-14 py-1 pr-3 text-ink-2">{o.at ? timeHM(o.at, lang) : '—'}</td>
                      <td className="py-1 pr-3 text-sm text-ink-2">
                        {o.how ? translateDynamicText(o.how, lang) : ''}
                        {o.source && sourceMap[o.source] ? ` · ${sourceMap[o.source]}` : ''}
                      </td>
                      <td className="w-36 py-1">
                        <span className={cx('inline-flex items-center gap-1 text-sm font-semibold', r.cls)}>
                          <Icon className="size-4" strokeWidth={2.5} aria-hidden />
                          <span className={o.status === 'failed' ? '' : 'text-ink-2'}>{r.text}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ))}
      {s.restored.length > 0 && (
        <div className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm text-ink-2">
          <div className="font-semibold text-ink">{t.quality.restoredMarksTitle}</div>
          {s.restored.map((h, i) => (
            <div key={i} className="num">
              {timeHM(h.at, lang)} · {translateDynamicText(h.text, lang)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
