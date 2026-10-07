import { Bot, Camera, Cpu, FileSpreadsheet, HardHat } from 'lucide-react';
import type { SourceId } from '@allur/contracts/ref';
import { cx } from '../lib/tones';
import { useTranslation } from '../i18n/store';
import { translateSource } from '../i18n/translator';

const ONE_C: Partial<Record<SourceId, string>> = { mes: '1С:MES', qls: '1С:QLS', wms: '1С:WMS', erp: '1С:ERP' };

export function SourceBadge({ source, compact }: { source: SourceId | 'twin' | undefined; compact?: boolean }) {
  const { lang } = useTranslation();
  if (!source) return null;
  const label = ONE_C[source as SourceId] ?? translateSource(source, lang);
  const icon =
    source in ONE_C ? (
      <span className="grid h-[1.15em] min-w-[1.6em] place-items-center rounded-[4px] bg-ink px-[3px] text-[0.7em] font-bold leading-none text-white">1С</span>
    ) : source === 'plc' ? (
      <Cpu className="size-[1.1em]" aria-hidden />
    ) : source === 'camera' ? (
      <Camera className="size-[1.1em]" aria-hidden />
    ) : source === 'master' ? (
      <HardHat className="size-[1.1em]" aria-hidden />
    ) : source === 'import' ? (
      <FileSpreadsheet className="size-[1.1em]" aria-hidden />
    ) : (
      <Bot className="size-[1.1em]" aria-hidden />
    );
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-sm font-medium text-ink-2', compact && 'px-1')} title={label}>
      {icon}
      {!compact && <span>{label}</span>}
    </span>
  );
}
