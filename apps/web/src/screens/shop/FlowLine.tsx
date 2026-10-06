// Поток производства слева направо: 6 участков, между ними буферы силуэтами кузовов.
import { ArrowRight } from 'lucide-react';
import { AREA_BY_ID, type AreaId, type AreaView, type BufferView } from '@allur/contracts/ref';
import { StatusChip } from '../../components/ui';
import { AREA_STATUS, TONE_CLASS, cx } from '../../lib/tones';
import { num1 } from '../../lib/format';

const MAX_SHELLS = 10;

/** Подзаголовки помогают связать названия оборудования из 1С с участком */
const SUBTITLE: Record<AreaId, string> = {
  warehouse: 'комплек­тующих',
  weld: 'роботы ABB-01…04',
  paint: 'Камеры-01, 02',
  assembly: 'Конвейер-03',
  qc: 'контроль качества',
  finished: 'готовой продук­ции',
};

export function FlowLine({
  areas,
  buffers,
  onArea,
}: {
  areas: AreaView[];
  buffers: BufferView[];
  onArea?: (id: AreaId) => void;
}) {
  const byId = Object.fromEntries(areas.map((a) => [a.id, a])) as Record<AreaId, AreaView>;
  const buf = Object.fromEntries(buffers.map((b) => [b.id, b])) as Record<string, BufferView>;

  return (
    <div
      className="grid items-stretch [--arr:1.25rem] [--buf:3.25rem] 2xl:[--arr:1.75rem] 2xl:[--buf:4.75rem]"
      style={{
        gridTemplateColumns:
          'minmax(0,0.92fr) var(--arr) minmax(0,1fr) var(--buf) minmax(0,1fr) var(--buf) minmax(0,1fr) var(--buf) minmax(0,1fr) var(--arr) minmax(0,0.92fr)',
      }}
    >
      <WarehouseCard area={byId.warehouse} onClick={onArea} />
      <Arrow />
      <AreaCard area={byId.weld} onClick={onArea} />
      <Buffer b={buf['weld-paint']} />
      <AreaCard area={byId.paint} onClick={onArea} />
      <Buffer b={buf['paint-assembly']} />
      <AreaCard area={byId.assembly} onClick={onArea} />
      <Buffer b={buf['assembly-qc']} />
      <AreaCard area={byId.qc} onClick={onArea} />
      <Arrow />
      <FinishedCard area={byId.finished} onClick={onArea} />
    </div>
  );
}

function CardShell({
  id,
  tone,
  onClick,
  children,
}: {
  id: AreaId;
  tone: keyof typeof TONE_CLASS;
  onClick?: (id: AreaId) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(id)}
      className={cx(
        'flex min-w-0 flex-col items-start gap-1.5 rounded-2xl border-2 bg-surface p-3 text-left 2xl:gap-2 shadow-card transition-shadow hover:shadow-pop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        tone === 'neutral' ? 'border-transparent' : TONE_CLASS[tone].border,
      )}
    >
      {children}
    </button>
  );
}

/** Склады и ОТК без подзаголовка непонятны — его показываем всегда; остальным — только на широком экране */
const ALWAYS_SUBTITLE: AreaId[] = ['warehouse', 'qc', 'finished'];

function Title({ id, title }: { id: AreaId; title?: string }) {
  return (
    <div className="min-w-0 leading-tight">
      <div className="text-[1.125rem] font-semibold">{title ?? AREA_BY_ID[id].short}</div>
      <div className={cx('text-sm text-ink-3', !ALWAYS_SUBTITLE.includes(id) && 'hidden 2xl:block')}>{SUBTITLE[id]}</div>
    </div>
  );
}

function Count({ label, value, of }: { label: string; value: string | number; of?: string }) {
  return (
    <div className="mt-auto leading-tight">
      <div className="text-sm text-ink-3">{label}</div>
      <div className="whitespace-nowrap font-semibold">
        <span className="num text-[1.75rem] leading-none">{value}</span>
        {of && <span className="text-lg text-ink-2"> {of}</span>}
      </div>
    </div>
  );
}

function AreaCard({ area, onClick }: { area: AreaView; onClick?: (id: AreaId) => void }) {
  const meta = AREA_STATUS[area.status];
  return (
    <CardShell id={area.id} tone={meta.tone} onClick={onClick}>
      <Title id={area.id} />
      <StatusChip tone={meta.tone} label={meta.label} icon={meta.icon} />
      <Count label="за смену" value={area.done} of={`из ${area.planToNow}`} />
      {area.reason && <div className={cx('text-base font-medium leading-snug', TONE_CLASS[meta.tone].ink)}>{area.reason}</div>}
    </CardShell>
  );
}

function WarehouseCard({ area, onClick }: { area: AreaView; onClick?: (id: AreaId) => void }) {
  const low = !!area.worstKit && area.worstKit.shiftsLeft < 2;
  const tone = low ? 'attention' : 'neutral';
  return (
    <CardShell id={area.id} tone={tone} onClick={onClick}>
      <Title id={area.id} title="Склад" />
      <StatusChip tone={tone} label={low ? 'Есть дефицит' : 'Запас в норме'} />
      <Count label="запас, смен" value={num1(area.stockShifts ?? 0)} />
      {area.worstKit && (
        <div className={cx('text-base font-medium leading-snug', low ? 'text-st-attention-ink' : 'text-ink-2')}>
          {area.worstKit.name} на {num1(area.worstKit.shiftsLeft)} смены
        </div>
      )}
    </CardShell>
  );
}

function FinishedCard({ area, onClick }: { area: AreaView; onClick?: (id: AreaId) => void }) {
  return (
    <CardShell id={area.id} tone="neutral" onClick={onClick}>
      <Title id={area.id} title="Склад" />
      <StatusChip tone="neutral" label="Принимает" />
      <Count label="принято за смену" value={area.done} />
    </CardShell>
  );
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-ink-3" aria-hidden>
      <ArrowRight className="size-5" strokeWidth={2.25} />
    </div>
  );
}

/** Буфер: до 10 силуэтов кузовов, дальше «+N». Подпись — «11 из 12». */
function Buffer({ b }: { b: BufferView | undefined }) {
  if (!b) return <Arrow />;
  const shown = Math.min(b.count, MAX_SHELLS);
  const extra = b.count - shown;
  const full = b.count >= b.capacity;
  const empty = b.count === 0;
  return (
    <div className="relative flex flex-col items-center justify-center gap-1" title={`Буфер: ${b.count} из ${b.capacity} кузовов`}>
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line-strong" aria-hidden />
      <ArrowRight className="absolute right-[-0.35rem] top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={2.5} aria-hidden />
      <div className="relative grid grid-cols-2 gap-x-1 gap-y-[3px] rounded-lg bg-page px-1 py-1.5">
        {Array.from({ length: MAX_SHELLS }, (_, i) => (
          <BodyShell key={i} filled={i < shown} />
        ))}
        {extra > 0 && <span className="col-span-2 text-center text-xs font-semibold leading-none text-ink-2">+{extra}</span>}
      </div>
      <div className="relative rounded-md bg-page px-1 text-center leading-none">
        <div className={cx('num text-base font-semibold', full || empty ? 'text-st-waiting-ink' : 'text-ink-2')}>
          {b.count}
        </div>
        <div className="num text-xs text-ink-3">из {b.capacity}</div>
      </div>
    </div>
  );
}

function BodyShell({ filled }: { filled: boolean }) {
  if (!filled) return <span className="block h-[0.7rem] w-[1.35rem] 2xl:h-[0.85rem] 2xl:w-[1.65rem]" aria-hidden />;
  return (
    <svg viewBox="0 0 24 12" className="body-in h-[0.7rem] w-[1.35rem] 2xl:h-[0.85rem] 2xl:w-[1.65rem]" aria-hidden>
      <path
        d="M1.5 9V7.4c0-.5.4-.9.9-1l4-.8 2.8-2.3c.4-.3.9-.5 1.4-.5h4.8c.6 0 1.1.2 1.5.6l2.4 2.2 2.7.6c.5.1.9.6.9 1.1V9h-2.9a2.1 2.1 0 0 0-4.1 0H8.6a2.1 2.1 0 0 0-4.1 0Z"
        fill="var(--body-shell)"
      />
    </svg>
  );
}
