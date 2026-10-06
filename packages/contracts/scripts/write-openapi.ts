// Пишет openapi.json рядом с пакетом — для репозитория и документации.
import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '../src/openapi';

const out = new URL('../openapi.json', import.meta.url);
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + '\n');
console.log('OpenAPI записан:', out.pathname);
