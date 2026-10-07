// Общие запросы к REST шлюза: один ключ — один кэш для всех экранов и режимов.
import { useQuery } from '@tanstack/react-query';
import type { AreaId, LiveSnapshot } from '@allur/contracts/ref';
import { api } from './client';
import type { AreaDetail, QualityOverview } from './types';
import { paintDefectLive } from '../state/selectors';

/** Детали участка: оборудование, сигналы, график по часам (тот же кэш, что у боковой панели) */
export function useAreaDetail(area: AreaId | null) {
  return useQuery({
    queryKey: ['area', area],
    queryFn: () => api<AreaDetail>(`/api/v1/areas/${area}`),
    enabled: !!area,
    refetchInterval: 3000,
  });
}

/** Брак окраски за смену: из снимка, если окраска худшая, иначе из обзора качества */
export function usePaintDefect(s: LiveSnapshot): number | null {
  const live = paintDefectLive(s);
  const q = useQuery({
    queryKey: ['quality'],
    queryFn: () => api<QualityOverview>('/api/v1/quality'),
    refetchInterval: 5000,
    enabled: live === null,
  });
  if (live !== null) return live;
  return q.data?.areas.find((a) => a.area === 'paint')?.shiftPct ?? null;
}
