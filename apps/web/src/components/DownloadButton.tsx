// Скачать отчёт: файл собирает шлюз (GET /api/v1/reports/:type), интерфейс только забирает его.
// Основная часть кнопки скачивает первый формат (у мастера — PDF), стрелка открывает остальные.
// Пока шлюз собирает файл — «Готовлю файл…», при ошибке — текст шлюза и «Повторить».
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, LoaderCircle, Sheet, type LucideIcon } from 'lucide-react';
import { useTranslation } from '../i18n/store';
import { cx } from '../lib/tones';
import { useEscLayer } from './overlay';

export type ReportFormat = 'pdf' | 'docx' | 'xlsx' | 'csv';

const ICON: Record<ReportFormat, LucideIcon> = { pdf: FileText, docx: FileText, xlsx: FileSpreadsheet, csv: Sheet };

/** Имя файла из Content-Disposition: filename*=UTF-8''… (кириллица), иначе filename="…" */
function fileNameOf(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* ниже — запасное имя */
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback;
}

export async function downloadReport(type: string, format: ReportFormat, params: Record<string, string | undefined>): Promise<void> {
  const qs = new URLSearchParams({ format });
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const r = await fetch(`/api/v1/reports/${encodeURIComponent(type)}?${qs.toString()}`);
  if (!r.ok) {
    let message = `HTTP ${r.status}`;
    try {
      message = ((await r.json()) as { message?: string }).message ?? message;
    } catch {
      /* тело не JSON */
    }
    throw new Error(message);
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileNameOf(r.headers.get('content-disposition'), `${type}.${format}`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function DownloadButton({
  type,
  formats,
  params,
  label,
  large,
  className,
}: {
  type: string;
  /** Первый — основной (одно нажатие); остальные — в меню */
  formats: ReportFormat[];
  params: Record<string, string | undefined>;
  label: string;
  /** Крупная кнопка на телефоне мастера */
  large?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<{ format: ReportFormat; message: string } | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEscLayer(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const run = async (format: ReportFormat) => {
    setOpen(false);
    setBusy(format);
    setError(null);
    try {
      await downloadReport(type, format, params);
    } catch (e) {
      setError({ format, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const main = formats[0]!;
  const rest = formats.length > 1;
  const MainIcon = busy ? LoaderCircle : Download;
  const size = large ? 'min-h-14 px-5 text-lg' : 'min-h-9 px-3 text-base';

  return (
    <div ref={box} className={cx('relative inline-flex flex-col items-stretch gap-1 print:hidden', large && 'w-full', className)}>
      <div className={cx('inline-flex rounded-xl', large ? 'bg-accent text-white' : 'bg-accent-bg text-accent-ink')}>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run(main)}
          className={cx(
            'inline-flex flex-1 items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait',
            rest && 'rounded-r-none',
            large ? 'hover:bg-accent-ink' : 'hover:bg-[#dfe8fb] dark:hover:bg-accent-bg',
            size,
          )}
        >
          <MainIcon className={cx('size-[1.15em] shrink-0', busy && 'animate-spin')} strokeWidth={2.25} aria-hidden />
          <span>{busy ? t.reports.preparing : `${label} · ${t.reports.formats[main]}`}</span>
        </button>
        {rest && (
          <button
            type="button"
            disabled={busy !== null}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t.reports.otherFormats}
            onClick={() => setOpen((v) => !v)}
            className={cx(
              'inline-flex items-center justify-center rounded-r-xl border-l transition-colors focus-visible:outline-2 focus-visible:outline-accent',
              large ? 'min-w-14 border-white/30 hover:bg-accent-ink' : 'min-w-9 border-accent/20 hover:bg-[#dfe8fb] dark:hover:bg-accent-bg',
            )}
          >
            <ChevronDown className={cx('size-[1.15em] transition-transform', open && 'rotate-180')} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <div role="menu" className={cx('absolute right-0 z-50 min-w-full', large ? 'bottom-full mb-1' : 'top-full mt-1', 'overflow-hidden rounded-xl bg-surface py-1 shadow-card ring-1 ring-line')}>
          {formats.map((f) => {
            const Icon = ICON[f];
            return (
              <button
                key={f}
                type="button"
                role="menuitem"
                onClick={() => void run(f)}
                className={cx('flex w-full items-center gap-2.5 whitespace-nowrap px-3.5 text-left text-ink hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none', large ? 'min-h-14 text-lg' : 'min-h-10 text-base')}
              >
                <Icon className="size-[1.15em] shrink-0 text-ink-2" strokeWidth={2} aria-hidden />
                <span className="font-semibold">{t.reports.formats[f]}</span>
                <span className="text-sm text-ink-3">{t.reports.formatHints[f]}</span>
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <div role="alert" className={cx('flex flex-wrap items-center gap-2 rounded-lg bg-st-fault-bg px-2.5 py-1.5 text-st-fault-ink', large ? 'text-lg' : 'text-sm')}>
          <span className="min-w-0 flex-1">{t.reports.failed(error.message)}</span>
          <button type="button" onClick={() => void run(error.format)} className="rounded-md px-2 py-0.5 font-semibold underline-offset-2 hover:underline">
            {t.reports.retry}
          </button>
        </div>
      )}
    </div>
  );
}
