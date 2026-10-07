// Цвета сцены из тех же токенов, что и интерфейс: статус в 3D и в «Панели» — один и тот же цвет.
// Всё остальное — спокойные серые: цвет в сцене только для статусов.
import { Color } from 'three';
import type { Tone } from '@allur/contracts/ref';

function token(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

export interface Palette {
  background: Color;
  floor: Color;
  grid: Color;
  gridSection: Color;
  aisle: Color;
  platform: Color;
  pad: Color;
  wall: Color;
  edge: Color;
  equipment: Color;
  equipmentDark: Color;
  glass: Color;
  opening: Color;
  body: Color;
  ghost: Color;
  tone: Record<Tone, Color>;
}

export function readPalette(): Palette {
  return {
    background: new Color(token('--page', '#f3f4f6')),
    floor: new Color('#f8f9fa'),
    grid: new Color('#e9ebef'),
    gridSection: new Color('#dde1e6'),
    aisle: new Color('#ffffff'),
    platform: new Color('#eef0f3'),
    pad: new Color('#e7eaee'),
    wall: new Color('#cfd4db'),
    edge: new Color(token('--line-strong', '#d1d5db')),
    equipment: new Color('#c9d0d9'),
    equipmentDark: new Color('#8a94a1'),
    glass: new Color('#dbe2ea'),
    opening: new Color('#7d8692'),
    body: new Color('#8f98a3'),
    ghost: new Color('#d9dde3'),
    tone: {
      neutral: new Color(token('--st-neutral', '#6b7280')),
      waiting: new Color(token('--st-waiting', '#5b7a99')),
      attention: new Color(token('--st-attention', '#d97706')),
      fault: new Color(token('--st-fault', '#d0263f')),
      maintenance: new Color(token('--st-maintenance', '#7c3aed')),
    },
  };
}
