// «Машины по стадиям»: колонка на стадию — машины на ней и в очереди перед ней; сначала проблемные
// (задерживаются, перекраска), затем дольше всех на стадии; в шапке — среднее время против нормы.
import type { BodyView, PlantModel } from '@allur/contracts/ref';
import { isProblem, stageNorm, workMs } from './cars';

export interface Row {
  b: BodyView;
  /** Рабочих минут на стадии (в очереди — в очереди) */
  min: number;
  normMin: number | null;
  queued: boolean;
  problem: boolean;
}

export interface Column {
  id: string;
  name: string;
  rows: Row[];
  avgMin: number | null;
  avgNorm: number | null;
}


export function columns(bodies: BodyView[], plant: PlantModel, now: number): Column[] {
  const byStage = new Map<string, Row[]>(plant.stages.map((s) => [s.id, []]));
  for (const b of bodies) {
    // в очереди — в колонке стадии, куда едет
    const queued = b.loc.kind === 'buffer';
    const stageId = queued && b.loc.bufferId ? plant.bufferById.get(b.loc.bufferId)?.to : b.loc.stageId;
    const list = stageId ? byStage.get(stageId) : undefined;
    if (!list) continue;
    const from = Date.parse(b.stageSince ?? b.since);
    const norm = !queued && b.loc.kind !== 'warehouse' && b.loc.kind !== 'finished' ? stageNorm(plant, b.model, b.loc.stageId) : 0;
    list.push({ b, min: Math.round(workMs(from, now) / 60_000), normMin: norm > 0 ? Math.max(1, Math.round(norm / 60)) : null, queued, problem: isProblem(b) });
  }
  return plant.stages.map((s) => {
    const rows = byStage.get(s.id)!;
    rows.sort((a, b) => Number(b.problem) - Number(a.problem) || Number(a.queued) - Number(b.queued) || b.min - a.min);
    const timed = rows.filter((r) => !r.queued && r.normMin !== null);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null);
    return { id: s.id, name: s.short, rows, avgMin: avg(timed.map((r) => r.min)), avgNorm: avg(timed.map((r) => r.normMin!)) };
  });
}
