import { fileURLToPath } from 'node:url';

function num(name: string, def: number): number {
  const v = process.env[name];
  return v ? Number(v) : def;
}

export const config = {
  port: num('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  mqttPort: num('MQTT_PORT', 1883),
  dbPath: process.env.DB_PATH ?? fileURLToPath(new URL('../../../data/twin.db', import.meta.url)),
  webDist: process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  mediaDir: process.env.MEDIA_DIR ?? fileURLToPath(new URL('../../../data/media/', import.meta.url)),
  asyncapiPath: fileURLToPath(new URL('../../../packages/contracts/asyncapi.yaml', import.meta.url)),
  /** on — шлюз сам запускает имитаторы отдельным процессом (для облачного демо) */
  simulators: process.env.SIMULATORS === 'on',
  /** Скорость времени при старте (облако: ×60) */
  startSpeed: num('START_SPEED', 60),
  seed: num('SEED', 20261007),
  /** Ступень внедрения при старте */
  startStage: (num('START_STAGE', 1) as 0 | 1 | 2),
};
