// Документация точки входа: Swagger UI (/docs) из Zod-схем и AsyncAPI (/asyncapi) для MQTT.
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { parse as parseYaml } from 'yaml';
import { buildOpenApiDocument } from '@allur/contracts/openapi';
import { config } from './config';

export async function registerDocs(app: FastifyInstance) {
  await app.register(swagger, {
    mode: 'static',
    specification: { document: buildOpenApiDocument() as never },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true, defaultModelsExpandDepth: 0 },
  });

  const yamlText = readFileSync(config.asyncapiPath, 'utf8');
  const doc = parseYaml(yamlText) as AsyncApiDoc;
  const html = renderAsyncApi(doc);

  app.get('/asyncapi.yaml', async (_req, reply) => reply.type('text/yaml; charset=utf-8').send(yamlText));
  app.get('/asyncapi', async (_req, reply) => reply.type('text/html; charset=utf-8').send(html));
}

interface Schema {
  type?: string;
  enum?: unknown[];
  description?: string;
  format?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  $ref?: string;
}
interface AsyncApiDoc {
  info: { title: string; version: string; description?: string };
  servers?: Record<string, { host: string; pathname?: string; protocol: string; description?: string }>;
  channels: Record<string, { address: string; title?: string; description?: string; messages: Record<string, { $ref: string }> }>;
  components: { messages: Record<string, { title?: string; payload: Schema; examples?: { name?: string; payload: unknown }[] }> };
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function paragraphs(text = ''): string {
  const blocks = text.trim().split(/\n\s*\n/);
  return blocks
    .map((b) => {
      const lines = b.split('\n').map((l) => l.trim());
      if (lines.every((l) => l.startsWith('- ') || !l)) return `<ul>${lines.filter(Boolean).map((l) => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
      const items: string[] = [];
      let cur = '';
      for (const l of lines) {
        if (l.startsWith('- ')) {
          if (cur) items.push(`<p>${esc(cur)}</p>`);
          cur = '';
          items.push(`<ul><li>${esc(l.slice(2))}</li></ul>`);
        } else cur += (cur ? ' ' : '') + l;
      }
      if (cur) items.push(`<p>${esc(cur)}</p>`);
      return items.join('');
    })
    .join('');
}

function renderAsyncApi(doc: AsyncApiDoc): string {
  const servers = Object.entries(doc.servers ?? {})
    .map(([k, s]) => `<tr><td><code>${esc(s.protocol)}://${esc(s.host)}${esc(s.pathname ?? '')}</code></td><td>${esc(s.description)}</td><td class="muted">${esc(k)}</td></tr>`)
    .join('');
  const channels = Object.values(doc.channels)
    .map((ch) => {
      const msgs = Object.values(ch.messages)
        .map((m) => {
          const name = m.$ref.split('/').pop()!;
          const msg = doc.components.messages[name]!;
          const props = Object.entries(msg.payload.properties ?? {})
            .map(
              ([p, s]) =>
                `<tr><td><code>${esc(p)}</code>${msg.payload.required?.includes(p) ? ' <span class="req">обяз.</span>' : ''}</td><td>${esc(s.type)}${s.enum ? `<div class="muted">${s.enum.map(esc).join(' | ')}</div>` : ''}</td><td>${esc(s.description)}</td></tr>`,
            )
            .join('');
          const ex = msg.examples?.[0];
          return `<table><thead><tr><th>Поле</th><th>Тип</th><th>Описание</th></tr></thead><tbody>${props}</tbody></table>${
            ex ? `<div class="ex">Пример${ex.name ? ` — ${esc(ex.name)}` : ''}</div><pre>${esc(JSON.stringify(ex.payload, null, 2))}</pre>` : ''
          }`;
        })
        .join('');
      return `<section><h2>${esc(ch.title)}</h2><div class="addr"><code>${esc(ch.address)}</code></div><p>${esc(ch.description)}</p>${msgs}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Документация MQTT — цифровой двойник</title>
<style>
body{margin:0;background:#f3f4f6;color:#1b1f24;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:28px;margin:8px 0}h2{font-size:20px;margin:0 0 6px}
section,.card{background:#fff;border-radius:16px;padding:20px;margin:16px 0;box-shadow:0 1px 2px rgb(16 24 40/.05),0 2px 8px rgb(16 24 40/.06)}
code,pre{font-family:ui-monospace,Consolas,monospace;font-size:14px}
.addr code{background:#eef3fd;color:#1f4bb8;padding:4px 8px;border-radius:8px;font-size:15px}
table{width:100%;border-collapse:collapse;margin:12px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}
th{color:#4b5563;font-weight:600;font-size:14px}.muted{color:#636a75;font-size:14px}.req{color:#8a4a00;font-size:12px;font-weight:600}
pre{background:#f8f9fa;border:1px solid #e5e7eb;border-radius:12px;padding:12px;overflow:auto}.ex{color:#4b5563;font-size:14px;margin-top:8px}
a{color:#1f4bb8}
</style></head><body><main>
<a href="/sources">← Источники данных</a> · <a href="/docs">REST (Swagger)</a> · <a href="/asyncapi.yaml">asyncapi.yaml</a>
<h1>${esc(doc.info.title)}</h1><div class="muted">AsyncAPI, версия ${esc(doc.info.version)}</div>
<div class="card">${paragraphs(doc.info.description)}</div>
<div class="card"><h2>Подключение</h2><table><tbody>${servers}</tbody></table></div>
${channels}
</main></body></html>`;
}
