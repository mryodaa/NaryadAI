// Статус всегда словом + цветом + иконкой (проектор искажает цвета).
import {
  CircleCheck,
  CircleSlash,
  Hourglass,
  Moon,
  OctagonX,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AreaStatus, Tone } from '@allur/contracts/ref';

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export const AREA_STATUS: Record<AreaStatus, StatusMeta> = {
  running: { label: 'Работает', tone: 'neutral', icon: CircleCheck },
  starved: { label: 'Ждёт кузов', tone: 'waiting', icon: Hourglass },
  blocked: { label: 'Заблокирован', tone: 'waiting', icon: CircleSlash },
  fault: { label: 'Авария', tone: 'fault', icon: OctagonX },
  degraded_quality: { label: 'Работает с браком', tone: 'attention', icon: TriangleAlert },
  maintenance: { label: 'Обслуживание', tone: 'maintenance', icon: Wrench },
  idle: { label: 'Смена не идёт', tone: 'neutral', icon: Moon },
};

/** Состояние оборудования по контроллеру (ступень 1+) */
export const EQUIPMENT_STATUS: Record<'run' | 'idle' | 'fault' | 'maintenance', StatusMeta> = {
  run: { label: 'Работает', tone: 'neutral', icon: CircleCheck },
  idle: { label: 'Ожидает', tone: 'waiting', icon: Hourglass },
  fault: { label: 'Авария', tone: 'fault', icon: OctagonX },
  maintenance: { label: 'Обслуживание', tone: 'maintenance', icon: Wrench },
};

export const TONE_ICON: Record<Tone, LucideIcon> = {
  neutral: CircleCheck,
  waiting: Hourglass,
  attention: TriangleAlert,
  fault: OctagonX,
  maintenance: Wrench,
};

/** Классы Tailwind перечислены статически, чтобы попасть в сборку */
export const TONE_CLASS: Record<Tone, { ink: string; bg: string; border: string; solid: string; ring: string }> = {
  neutral: {
    ink: 'text-st-neutral-ink',
    bg: 'bg-st-neutral-bg',
    border: 'border-line',
    solid: 'bg-st-neutral',
    ring: 'ring-line',
  },
  waiting: {
    ink: 'text-st-waiting-ink',
    bg: 'bg-st-waiting-bg',
    border: 'border-st-waiting',
    solid: 'bg-st-waiting',
    ring: 'ring-st-waiting',
  },
  attention: {
    ink: 'text-st-attention-ink',
    bg: 'bg-st-attention-bg',
    border: 'border-st-attention',
    solid: 'bg-st-attention',
    ring: 'ring-st-attention',
  },
  fault: {
    ink: 'text-st-fault-ink',
    bg: 'bg-st-fault-bg',
    border: 'border-st-fault',
    solid: 'bg-st-fault',
    ring: 'ring-st-fault',
  },
  maintenance: {
    ink: 'text-st-maintenance-ink',
    bg: 'bg-st-maintenance-bg',
    border: 'border-st-maintenance',
    solid: 'bg-st-maintenance',
    ring: 'ring-st-maintenance',
  },
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
