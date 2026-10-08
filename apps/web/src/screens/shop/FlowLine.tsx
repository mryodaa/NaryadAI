import { ArrowRight } from 'lucide-react';
import { inflect, type AreaId, type AreaView, type BufferView, type PlantStage } from '@allur/contracts/ref';
import { StatusChip } from '../../components/ui';
import { usePlantModel } from '../../state/plant';
import { AREA_STATUS, TONE_CLASS, cx } from '../../lib/tones';
import { num1 } from '../../lib/format';
import { useTranslation } from '../../i18n/store';
import { translateArea, translateDynamicText, translateEquipmentName, translateStatus } from '../../i18n/translator';
import type { Translations, Lang } from '../../i18n/types';

const MAX_SHELLS = 10;

/** «ABB-01…04», «Камеры-01, 02», «Конвейер-03» — подзаголовок связывает названия из 1С с участком */
function subtitle(stage: PlantStage, t: Translations, lang: Lang): string {
  switch (stage.kind) {
    case 'warehouse_in':
      return t.shop.flowSubtitleWarehouseIn;
    case 'warehouse_out':
      return t.shop.flowSubtitleWarehouseOut;
    case 'inspection':
      return t.shop.flowSubtitleInspection;
    default: {
      const eq = stage.equipment.filter((e) => !e.passive);
      const robots = eq.filter((e) => e.type.id === 'spot_robot');
      if (robots.length > 1) return t.shop.robotsLabel(compactIds(robots.map((e) => e.id)));
      const booths = eq.filter((e) => e.type.id === 'paint_booth');
      if (booths.length) return compactNames(booths.map((e) => e.name), lang);
      const conveyors = eq.filter((e) => e.type.id === 'conveyor');
      if (conveyors.length) return conveyors.map((e) => translateEquipmentName(e.name, lang)).join(', ');
      return eq.map((e) => translateEquipmentName(e.name, lang)).slice(0, 2).join(', ');
    }
  }
}

/** ABB-01, ABB-02, ABB-04 → ABB-01…04 */
function compactIds(ids: string[]): string {
  const m = ids.map((id) => /^(.*?)(\d+)$/.exec(id));
  if (m.some((x) => !x) || new Set(m.map((x) => x![1])).size > 1) return ids.join(', ');
  return `${ids[0]}…${m[m.length - 1]![2]}`;
}

/** Камера-01, Камера-02 → Камеры-01, 02 */
function compactNames(names: string[], lang: Lang): string {
  if (names.length === 1) return translateEquipmentName(names[0]!, lang);
  const m = names.map((n) => /^(.*?)-(\d+)$/.exec(n));
  if (m.some((x) => !x) || new Set(m.map((x) => x![1])).size > 1) return names.map((n) => translateEquipmentName(n, lang)).join(', ');
  const base = m[0]![1]!;
  const nums = m.map((x) => x![2]).join(', ');
  if (lang === 'kk') return `${nums}-камералар`;
  if (lang === 'en') return `Booths-${nums}`;
  return `${inflect(base, 'gen')}-${nums}`;
}

export function FlowLine({
  areas,
  buffers,
  onArea,
}: {
  areas: AreaView[];
  buffers: BufferView[];
  onArea?: (id: AreaId) => void;
}) {
  const model = usePlantModel();
  const byId = new Map(areas.map((a) => [a.id, a]));
  const buf = new Map(buffers.map((b) => [b.id, b]));
  const stages = model.stages.filter((s) => byId.has(s.id));
  // колонки: участок, между участками — буфер или стрелка
  const columns = stages
    .flatMap((s, i) => [s.producing ? 'minmax(0,1fr)' : 'minmax(0,0.92fr)', i < stages.length - 1 ? (s.bufferAfter ? 'var(--buf)' : 'var(--arr)') : null])
    .filter(Boolean)
    .join(' ');

  return (
    <div className="grid items-stretch [--arr:1.25rem] [--buf:3.25rem] 2xl:[--arr:1.75rem] 2xl:[--buf:4.75rem]" style={{ gridTemplateColumns: columns }}>
      {stages.map((s, i) => {
        const a = byId.get(s.id)!;
        const card =
          s.kind === 'warehouse_in' ? (
            <WarehouseCard key={s.id} area={a} stage={s} onClick={onArea} />
          ) : s.kind === 'warehouse_out' ? (
            <FinishedCard key={s.id} area={a} stage={s} onClick={onArea} />
          ) : (
            <AreaCard key={s.id} area={a} stage={s} onClick={onArea} />
          );
        if (i === stages.length - 1) return card;
        const b = s.bufferAfter ? buf.get(s.bufferAfter.id) : undefined;
        return [card, b ? <Buffer key={`${s.id}-buf`} b={b} /> : <Arrow key={`${s.id}-arr`} />];
      })}
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

function Title({ stage, title }: { stage: PlantStage; title?: string }) {
  const { t, lang } = useTranslation();
  // склады и ОТК без подзаголовка непонятны — его показываем всегда; остальным — только на широком экране
  const always = !stage.producing || stage.kind === 'inspection';
  const stageName = translateArea(stage.id, lang, 'short') || stage.short;
  return (
    <div className="min-w-0 leading-tight">
      <div className="text-[1.125rem] font-semibold">{title ?? stageName}</div>
      <div className={cx('text-sm text-ink-3', !always && 'hidden 2xl:block')}>{subtitle(stage, t, lang)}</div>
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

function AreaCard({ area, stage, onClick }: { area: AreaView; stage: PlantStage; onClick?: (id: AreaId) => void }) {
  const { t, lang } = useTranslation();
  const meta = AREA_STATUS[area.status];
  return (
    <CardShell id={area.id} tone={meta.tone} onClick={onClick}>
      <Title stage={stage} />
      <StatusChip tone={meta.tone} label={translateStatus(area.status, lang)} icon={meta.icon} />
      <Count label={t.shop.perShift} value={area.done} of={t.shop.ofPlan(area.planToNow)} />
      {area.reason && <div className={cx('text-base font-medium leading-snug', TONE_CLASS[meta.tone].ink)}>{translateDynamicText(area.reason, lang)}</div>}
    </CardShell>
  );
}

function WarehouseCard({ area, stage, onClick }: { area: AreaView; stage: PlantStage; onClick?: (id: AreaId) => void }) {
  const { t, lang } = useTranslation();
  const low = !!area.worstKit && area.worstKit.shiftsLeft < 2;
  const tone = low ? 'attention' : 'neutral';
  return (
    <CardShell id={area.id} tone={tone} onClick={onClick}>
      <Title stage={stage} title={t.shop.warehouseTitle} />
      <StatusChip tone={tone} label={low ? t.shop.shortageDetected : t.shop.stockNormal} />
      <Count label={t.shop.stockShiftsLabel} value={num1(area.stockShifts ?? 0)} />
      {area.worstKit && (
        <div className={cx('text-base font-medium leading-snug', low ? 'text-st-attention-ink' : 'text-ink-2')}>
          {t.shop.shiftsForKit(translateDynamicText(area.worstKit.name, lang), num1(area.worstKit.shiftsLeft))}
        </div>
      )}
    </CardShell>
  );
}

function FinishedCard({ area, stage, onClick }: { area: AreaView; stage: PlantStage; onClick?: (id: AreaId) => void }) {
  const { t } = useTranslation();
  return (
    <CardShell id={area.id} tone="neutral" onClick={onClick}>
      <Title stage={stage} title={t.domain.areas.finished.name} />
      <StatusChip tone="neutral" label={t.shop.warehouseAccepting} />
      <Count label={t.shop.acceptedPerShift} value={area.done} />
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
function Buffer({ b }: { b: BufferView }) {
  const { t } = useTranslation();
  const shown = Math.min(b.count, MAX_SHELLS);
  const extra = b.count - shown;
  const full = b.count >= b.capacity;
  const empty = b.count === 0;
  return (
    <div className="relative flex flex-col items-center justify-center gap-1" title={t.shop.bufferTooltip(b.count, b.capacity)}>
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-line-strong" aria-hidden />
      <ArrowRight className="absolute right-[-0.35rem] top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={2.5} aria-hidden />
      <div className="relative grid grid-cols-2 gap-x-1 gap-y-[3px] rounded-lg bg-page px-1 py-1.5">
        {Array.from({ length: MAX_SHELLS }, (_, i) => (
          <BodyShell key={i} filled={i < shown} />
        ))}
        {extra > 0 && <span className="col-span-2 text-center text-xs font-semibold leading-none text-ink-2">+{extra}</span>}
      </div>
      <div className="relative rounded-md bg-page px-1 text-center leading-none">
        <div className={cx('num text-base font-semibold', full || empty ? 'text-st-waiting-ink' : 'text-ink-2')}>{b.count}</div>
        <div className="num text-xs text-ink-3">{t.shop.ofCapacity(b.capacity)}</div>
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
