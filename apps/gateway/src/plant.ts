// Конфигурация завода в шлюзе: версии в SQLite, проверка, применение, откат.
// Каждое применение — новая версия; откат тоже новая версия (копия старой) — история линейная.
// После применения подписчики (ядро, интерфейс, имитаторы) перестраиваются без перезапуска.
import {
  PlantConfigInput,
  SEED_PLANT,
  derivePlant,
  describePlantChanges,
  toPlantIso,
  validatePlant,
  zodIssues,
  type PlantConfig,
  type PlantIssue,
  type PlantModel,
  type PlantValidation,
  type PlantVersionInfo,
} from '@allur/contracts';
import type { Db, PlantVersionRow } from './db';

export type PlantSource = PlantVersionRow['source'];

export interface ApplyOptions {
  by?: string;
  comment?: string;
  source: PlantSource;
  /** Открытые инциденты по оборудованию — удалять такое оборудование нельзя */
  openIncidents?: Map<string, { id: string; title: string }>;
}

export type ApplyResult = { ok: true; config: PlantConfig; changes: string[] } | { ok: false; validation: PlantValidation };

/** Поля связи — живое состояние, в версиях не храним */
function normalize(config: PlantConfig): PlantConfig {
  const eq = (e: PlantConfig['stages'][number]['stations'][number]['equipment'][number]) => ({
    ...e,
    connection: { method: e.connection.method, endpoint: e.connection.endpoint, params: e.connection.params, tagMap: e.connection.tagMap, status: 'not_connected' as const },
  });
  return {
    ...config,
    stages: config.stages.map((s) => ({
      ...s,
      ...(s.inlet ? { inlet: s.inlet.map(eq) } : {}),
      stations: s.stations.map((st) => ({ ...st, equipment: st.equipment.map(eq) })),
      ...(s.outlet ? { outlet: s.outlet.map(eq) } : {}),
    })),
  };
}

/** Сравнение составов без версии, времени и автора */
function sameContent(a: PlantConfig, b: PlantConfig): boolean {
  const strip = (c: PlantConfig) => JSON.stringify({ ...normalize(c), version: 0, updatedAt: '', updatedBy: '', comment: '' });
  return strip(a) === strip(b);
}

export class PlantStore {
  private current: PlantConfig;
  private listeners = new Set<(config: PlantConfig, changes: string[]) => void>();

  constructor(
    private db: Db,
    private now: () => number = Date.now,
  ) {
    const latest = db.latestPlantVersion();
    const seed = normalize(SEED_PLANT);
    if (!latest) {
      db.addPlantVersion({ version: 1, created_at: this.now(), created_by: seed.updatedBy, comment: seed.comment ?? 'Исходный состав цеха', source: 'seed', body: JSON.stringify(seed) });
      this.current = seed;
    } else {
      let cfg = JSON.parse(latest.body) as PlantConfig;
      // исходный состав поменялся в коде, а правок не было — берём новый
      if (latest.version === 1 && latest.source === 'seed' && !sameContent(cfg, seed)) {
        db.replacePlantVersion(1, JSON.stringify(seed));
        cfg = seed;
      }
      this.current = cfg;
    }
  }

  get config(): PlantConfig {
    return this.current;
  }

  get model(): PlantModel {
    return derivePlant(this.current);
  }

  onChange(fn: (config: PlantConfig, changes: string[]) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  versions(): PlantVersionInfo[] {
    const cur = this.current.version;
    return this.db.plantVersions().map((r) => {
      const c = JSON.parse(r.body) as PlantConfig;
      return {
        version: r.version,
        createdAt: toPlantIso(r.created_at),
        createdBy: r.created_by,
        comment: r.comment,
        source: r.source,
        stages: c.stages.length,
        stations: c.stages.reduce((n, s) => n + s.stations.length, 0),
        equipment: c.stages.reduce((n, s) => n + (s.inlet?.length ?? 0) + (s.outlet?.length ?? 0) + s.stations.reduce((m, st) => m + st.equipment.length, 0), 0),
        current: r.version === cur,
      };
    });
  }

  version(v: number): PlantConfig | null {
    const r = this.db.plantVersion(v);
    return r ? (JSON.parse(r.body) as PlantConfig) : null;
  }

  /** Проверка без применения: форма (Zod) и смысл (порядок участков, буферы, лимиты, инциденты) */
  validate(input: unknown, openIncidents?: Map<string, { id: string; title: string }>): { validation: PlantValidation; config: PlantConfig | null } {
    const r = PlantConfigInput.safeParse(input);
    if (!r.success) {
      const errors: PlantIssue[] = zodIssues(r.error).map((i) => ({ level: 'error', path: i.path, message: i.message }));
      return { validation: { ok: false, errors, warnings: [] }, config: null };
    }
    const config: PlantConfig = {
      ...r.data,
      version: this.current.version + 1,
      updatedAt: toPlantIso(this.now()),
      updatedBy: r.data.updatedBy ?? 'Начальник производства',
    };
    const v = validatePlant(config, { current: this.current, openIncidents, shiftPlan: 120 });
    return { validation: v, config };
  }

  apply(input: unknown, opts: ApplyOptions): ApplyResult {
    const { validation, config } = this.validate(input, opts.openIncidents);
    if (!validation.ok || !config) return { ok: false, validation };
    const latest = this.db.latestPlantVersion();
    const version = (latest?.version ?? 0) + 1;
    const changes = describePlantChanges(this.current, config);
    const comment = opts.comment ?? (changes.length ? changes.slice(0, 6).join('; ') : 'Без изменений состава');
    const next = normalize({ ...config, version, updatedAt: toPlantIso(this.now()), updatedBy: opts.by ?? config.updatedBy, comment });
    this.db.addPlantVersion({ version, created_at: this.now(), created_by: next.updatedBy, comment, source: opts.source, body: JSON.stringify(next) });
    this.current = next;
    for (const fn of this.listeners) fn(next, changes);
    return { ok: true, config: next, changes };
  }

  rollback(v: number, by: string, openIncidents?: Map<string, { id: string; title: string }>): ApplyResult | null {
    const old = this.version(v);
    if (!old) return null;
    return this.apply({ ...old, comment: undefined }, { by, comment: `Откат к версии ${v}`, source: 'rollback', openIncidents });
  }

  /** Демо: сценарий начинается с исходного состава цеха (новой версией, если сейчас другой) */
  ensureBase(base: PlantConfig, comment: string): boolean {
    if (sameContent(this.current, base)) return false;
    const r = this.apply({ ...base, comment: undefined }, { by: 'Пульт демонстрации', comment, source: 'demo' });
    return r.ok;
  }
}
