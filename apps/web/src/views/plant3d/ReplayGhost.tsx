// Полупрозрачная копия машины, которая проезжает её реальный маршрут ускоренно: вид кузова меняется
// по этапам, над ней — стадия, время на заводских часах и вид. Живая сцена при этом работает как обычно.
import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { MeshStandardMaterial, type Group, type Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { replayClock } from '../../state/replay';
import { timeHM } from '../../lib/format';
import { BODY, FLOOR_Y } from './layout';
import { REPLAY_SECONDS, sampleReplay, type Replay } from './replay';

export function ReplayGhost({ replay, stageName, portal }: { replay: Replay; stageName: (id: string) => string; portal: RefObject<HTMLElement | null> }) {
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const label = useRef<HTMLSpanElement>(null);
  const rot = useRef(0);
  const last = useRef(0);
  const text = useRef('');
  const geometry = useMemo(() => new RoundedBoxGeometry(BODY.length, BODY.height, BODY.width, 2, 0.42), []);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.4, emissive: '#2b5fd9', emissiveIntensity: 0.15 }), []);

  useFrame((state) => {
    const now = performance.now();
    const dt = last.current ? Math.min(0.1, (now - last.current) / 1000) : 0;
    last.current = now;
    if (replayClock.playing) {
      replayClock.pos = Math.min(1, replayClock.pos + dt / REPLAY_SECONDS);
      if (replayClock.pos >= 1) replayClock.playing = false;
      state.invalidate();
    }
    const s = sampleReplay(replay, replayClock.pos, rot.current);
    rot.current = s.rot;
    const g = group.current;
    const m = body.current;
    if (!g || !m) return;
    g.position.set(s.x, FLOOR_Y, s.z);
    g.rotation.y = s.rot;
    const kit = s.frame.look.kind === 'kit';
    m.scale.set(kit ? 0.62 : 1, kit ? 0.4 : 1, kit ? 0.75 : 1);
    m.position.y = (kit ? 0.55 : BODY.height) / 2;
    material.color.set(s.frame.look.color);
    const t = `${stageName(s.frame.stageId)} · ${timeHM(s.at)} · ${s.frame.look.label}`;
    if (t !== text.current && label.current) {
      text.current = t;
      label.current.textContent = t;
    }
  });

  return (
    <group ref={group}>
      <mesh ref={body} geometry={geometry} material={material} raycast={() => null} renderOrder={7} />
      <Html portal={portal as never} position={[0, 3.4, 0]} center zIndexRange={[45, 30]} pointerEvents="none">
        <span ref={label} className="select-none whitespace-nowrap rounded-lg bg-ink/90 px-2 py-0.5 text-sm font-semibold text-white shadow-card" />
      </Html>
    </group>
  );
}
