// Как выглядит кузов по выполненным операциям: цвет экземпляра в сцене. Цвет — только цвет машины,
// статусы кузова показываются отдельными метками, а не окраской кузова.
import type { BodyView } from '@allur/contracts/ref';
import type { Color } from 'three';

/** Голый металл, катафорез, грунт; без цвета в заказе — нейтральный светлый */
export const BODY_LOOK = {
  kit: '#a8875f',
  metal: '#a9b1ba',
  ecoat: '#4b5058',
  primer: '#c9ccce',
  noColor: '#dfe2e5',
} as const;

export function bodyTint(v: BodyView, out: Color): Color {
  if (v.loc.kind === 'warehouse') return out.set(BODY_LOOK.kit);
  const has = (e: string) => v.visual.includes(e as never);
  if (has('color') || has('gloss')) return out.set(v.color?.hex ?? BODY_LOOK.noColor);
  if (has('primer')) return out.set(BODY_LOOK.primer);
  if (has('ecoat')) return out.set(BODY_LOOK.ecoat);
  return out.set(BODY_LOOK.metal);
}
