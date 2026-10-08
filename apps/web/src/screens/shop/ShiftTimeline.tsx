import type { LiveSnapshot, ShiftView } from '@allur/contracts/ref';
import { Card } from '../../components/ui';
import { usePlantModel } from '../../state/plant';
import { TONE_CLASS, cx } from '../../lib/tones';
import { timeHM } from '../../lib/format';
import { useTranslation } from '../../i18n/store';
import { translateArea, translateDynamicText } from '../../i18n/translator';

const HOUR = 3_600_000;

export function ShiftTimeline({
  shift,
  now,
  timeline,
  onIncident,
}: {
  shift: ShiftView;
  now: string;
  timeline: LiveSnapshot['timeline'];
  onIncident?: (id: string) => void;
}) {
  const { t, lang } = useTranslation();
  // строки ленты — производственные участки по потоку
  const rows = usePlantModel().production;
  const start = Date.parse(shift.startsAt);
  const end = Date.parse(shift.endsAt);
  const nowMs = Math.min(end, Math.max(start, Date.parse(now)));
  const pos = (ms: number) => `${((Math.min(end, Math.max(start, ms)) - start) / (end - start)) * 100}%`;
  const hours = Array.from({ length: Math.round((end - start) / HOUR) + 1 }, (_, i) => start + i * HOUR);

  return (
    <Card className="px-4 pb-3 pt-3">
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 max-sm:grid-cols-[4.5rem_minmax(0,1fr)]">
        <div className="text-base font-semibold leading-tight">{t.shop.timelineTitle}</div>
        <div className="relative h-5 text-sm text-ink-3">
          {hours.map((h, i) => (
            <span
              key={h}
              className={cx(
                'num absolute top-0',
                i === 0 ? '' : i === hours.length - 1 ? '-translate-x-full' : '-translate-x-1/2',
                // на узком экране подписи не помещаются каждый час: на планшете — через час, на телефоне — через три
                i !== hours.length - 1 && i % 2 !== 0 && 'max-lg:hidden',
                i !== hours.length - 1 && i % 4 !== 0 && 'max-sm:hidden',
              )}
              style={{ left: pos(h) }}
            >
              {timeHM(h)}
            </span>
          ))}
        </div>

        {rows.map(({ id: area, short }) => (
          <Row key={area} label={translateArea(area, lang, 'short') || short}>
            <div className="absolute inset-0 rounded bg-surface-2" />
            <div className="absolute inset-y-0 right-0 rounded-r bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--line)_6px_7px)]" style={{ left: pos(nowMs) }} />
            {timeline.segments
              .filter((s) => s.area === area)
              .map((s, i) => {
                const from = Date.parse(s.from);
                const to = s.to ? Date.parse(s.to) : nowMs;
                const translatedLabel = translateDynamicText(s.label, lang);
                const nowLabel = lang === 'kk' ? 'қазір' : lang === 'en' ? 'now' : 'сейчас';
                return (
                  <div
                    key={i}
                    title={`${translatedLabel} (${timeHM(from)}–${s.to ? timeHM(to) : nowLabel})`}
                    className={cx(
                      'absolute min-w-[3px] rounded-[4px]',
                      TONE_CLASS[s.tone].solid,
                      s.minor ? 'inset-y-[6px] opacity-45' : 'inset-y-[3px]',
                      !s.to && !s.minor && 'opacity-80',
                    )}
                    style={{ left: pos(from), width: `calc(${pos(to)} - ${pos(from)})` }}
                  />
                );
              })}
            {timeline.marks
              .filter((m) => m.area === area)
              .map((m, i) => (
                <button
                  key={i}
                  type="button"
                  title={`${translateDynamicText(m.label, lang)}, ${timeHM(m.at)}`}
                  onClick={() => m.incidentId && onIncident?.(m.incidentId)}
                  className={cx('absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface', TONE_CLASS[m.tone].solid)}
                  style={{ left: pos(Date.parse(m.at)) }}
                />
              ))}
            <div className="pointer-events-none absolute -inset-y-[3px] w-0.5 -translate-x-1/2 bg-ink" style={{ left: pos(nowMs) }} />
          </Row>
        ))}

        <div />
        <div className="relative h-5">
          <span
            className="num absolute top-0 -translate-x-1/2 rounded bg-ink px-1.5 text-sm font-semibold leading-5 text-white"
            style={{ left: pos(nowMs) }}
          >
            {t.shop.timelineNow(timeHM(nowMs))}
          </span>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="text-[0.9375rem] leading-5 text-ink-2">{label}</div>
      <div className="relative h-5">{children}</div>
    </>
  );
}
