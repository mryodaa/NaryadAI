// Ширина окна для разметки, которую не выразить классами (что показывать на телефоне, а что — на большом экране)
import { useEffect, useState } from 'react';

export function useMinWidth(px: number): boolean {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => typeof matchMedia === 'undefined' || matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const h = () => setOk(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [q]);
  return ok;
}
