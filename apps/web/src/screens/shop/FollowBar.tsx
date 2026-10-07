// Плашка слежения: за какой машиной и где она сейчас; «Остановить», «Вернуться к машине», ссылка коллеге.
// Когда машина приехала на склад готовой продукции — сообщение и паспорт.
import { useState } from 'react';
import { Check, Crosshair, FileText, Link2, X } from 'lucide-react';
import { MODEL_BY_ID } from '@allur/contracts/ref';
import { useEscLayer } from '../../components/overlay';
import { useLive } from '../../state/live';
import { usePlantModel } from '../../state/plant';
import { dismissFollowEnded, openPassport, resumeFollow, stopFollow, useView } from '../../state/view';
import { carWhere, shortVin } from '../../state/cars';
import { cx } from '../../lib/tones';
import { useTranslation } from '../../i18n/store';

export function FollowBar({ className }: { className?: string }) {
  const { t, lang } = useTranslation();
  const follow = useView((v) => v.follow);
  const ended = useView((v) => v.followEnded);
  const mode = useView((v) => v.mode);
  const car = useLive((s) => (follow ? s.bodies.find((b) => b.bodyId === follow.bodyId) : undefined));
  const nowIso = useLive((s) => s.snapshot?.now);
  const plant = usePlantModel();
  const [copied, setCopied] = useState(false);
  // Esc выходит из слежения (слой поверх карточки, если слежение включили после её открытия)
  useEscLayer(stopFollow, !!follow);

  if (follow) {
    const name = car ? `${MODEL_BY_ID[car.model].short} ${shortVin(car)}` : follow.bodyId;
    const where = car ? carWhere(car, plant, nowIso ? Date.parse(nowIso) : Date.now(), lang).title : '';
    const copy = () => {
      const url = `${location.origin}/?car=${encodeURIComponent(car?.vin ?? follow.bodyId)}`;
      void navigator.clipboard?.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    };
    return (
      <div role="status" className={cx('view-in pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-xl bg-accent-bg py-1 pl-3 pr-1 text-[0.9375rem] text-accent-ink shadow-card ring-1 ring-accent', className)}>
        <Crosshair className="size-4 shrink-0" strokeWidth={2.25} aria-hidden />
        <span className="min-w-0 truncate">
          <b>{t.shop.followingBar}: {name}</b>
          {where && <span> · {where}</span>}
          {mode === 'panel' && <span className="text-accent-ink/80"> · {t.shop.areaHighlighted}</span>}
        </span>
        {follow.paused && mode === '3d' && (
          <button type="button" onClick={resumeFollow} className="shrink-0 rounded-lg bg-accent px-2.5 py-1 font-semibold text-white hover:bg-accent-ink">
            {t.shop.returnToCar}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          title={t.shop.copyCarLink}
          aria-label={t.shop.copyCarLink}
          className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-surface"
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
        </button>
        <button type="button" onClick={stopFollow} className="shrink-0 rounded-lg px-2 py-1 font-semibold hover:bg-surface">
          {t.shop.stopFollow}
        </button>
      </div>
    );
  }
  if (ended) {
    return (
      <div role="status" className={cx('view-in pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-xl bg-surface py-1 pl-3 pr-1 text-[0.9375rem] text-ink shadow-card ring-1 ring-line', className)}>
        <Check className="size-4 shrink-0 text-st-neutral" strokeWidth={2.5} aria-hidden />
        <span className="font-semibold">{t.shop.carReadyInWarehouse}</span>
        {ended.vin && (
          <button
            type="button"
            onClick={() => openPassport(ended.vin!)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent-bg px-2.5 py-1 font-semibold text-accent-ink hover:bg-[#dfe8fb]"
          >
            <FileText className="size-4" aria-hidden />
            {t.carCard.openPassport}
          </button>
        )}
        <button type="button" onClick={dismissFollowEnded} aria-label={t.common.close} className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-surface-2">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return null;
}
