// Примеры сообщений из /packages/contracts/examples — для тестов и документации (только Node).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const EXAMPLES_DIR = fileURLToPath(new URL('../examples/', import.meta.url));

function loadDir<T>(sub: string): Record<string, T> {
  const dir = join(EXAMPLES_DIR, sub);
  const out: Record<string, T> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;
  }
  return out;
}

export interface MqttExample {
  topic: string;
  payload: unknown;
}

export function loadExamples() {
  return {
    events: loadDir<unknown>('events'),
    rest: loadDir<unknown>('rest'),
    mqtt: loadDir<MqttExample>('mqtt'),
  };
}
