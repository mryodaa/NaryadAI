// Пароль на вход: прототип видят только участники команды. Закрыто всё, что раскрывает идеи и данные:
// интерфейс (и его файлы), REST, WebSocket, Swagger и AsyncAPI, MQTT поверх WebSocket.
//
// В репозитории — не пароль, а его стойкий хеш (scrypt, ~150 мс на проверку): перебрать его по коду долго.
// Сессия — cookie с токеном, выведенным из пароля; проверенные токены кэшируются, перезапуск шлюза
// (бесплатный хостинг засыпает) не выкидывает вошедших.
//
// Без пароля пускаем только запросы изнутри контейнера (127.0.0.1 без прокси): имитаторы систем завода.
// ACCESS_PASSWORD — задать другой пароль; ACCESS_GATE=off — выключить вход (например, для локальных проверок).
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const COOKIE = 'twin_access';
const MAX_AGE_S = 30 * 24 * 3600;
const SCRYPT = { N: 2 ** 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
/** Хеш пароля команды (сам пароль в репозитории не хранится) */
const DEFAULT = { salt: 'a12608c0f9a2efdd20f566806caf0cf4', hash: '0a0569d50ed13c76b6fa5da69f81931ff60d474a46373418455963a049aa00c5' };
/** Не больше стольких неверных попыток с одного адреса за окно */
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 10 * 60_000;

/** Токен сессии из пароля: его кладём в cookie */
export function sessionToken(password: string): string {
  return createHash('sha256').update(`allur-twin-session:${password}`).digest('hex');
}

export interface Gate {
  enabled: boolean;
  /** Подходит ли токен (из cookie или из введённого пароля) */
  check: (token: string) => boolean;
}

export function createGate(env: NodeJS.ProcessEnv = process.env): Gate {
  if ((env.ACCESS_GATE ?? '').toLowerCase() === 'off') return { enabled: false, check: () => true };
  const salt = env.ACCESS_PASSWORD ? 'env' : DEFAULT.salt;
  const expected = Buffer.from(env.ACCESS_PASSWORD ? scryptSync(sessionToken(env.ACCESS_PASSWORD), salt, 32, SCRYPT).toString('hex') : DEFAULT.hash, 'hex');
  const ok = new Set<string>();
  return {
    enabled: true,
    check(token) {
      if (!/^[0-9a-f]{64}$/.test(token)) return false;
      if (ok.has(token)) return true;
      const got = scryptSync(token, salt, 32, SCRYPT);
      const good = got.length === expected.length && timingSafeEqual(got, expected);
      if (good) ok.add(token);
      return good;
    },
  };
}

/** Запрос изнутри контейнера: имитаторы ходят на 127.0.0.1 напрямую, а всё снаружи — через прокси хостинга */
export function isInternal(remote: string | undefined, headers: Record<string, unknown>): boolean {
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return local && headers['x-forwarded-for'] === undefined && headers['x-forwarded-host'] === undefined;
}

function cookieOf(req: FastifyRequest): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Открыто всегда: вход и проверка живости */
const OPEN = ['/api/v1/auth/', '/api/v1/health'];

export function registerAuth(app: FastifyInstance, gate: Gate = createGate()) {
  const fails = new Map<string, number[]>();
  const authed = (req: FastifyRequest) => !gate.enabled || isInternal(req.socket.remoteAddress, req.headers) || gate.check(cookieOf(req) ?? '');

  app.addHook('onRequest', async (req, reply) => {
    if (authed(req) || OPEN.some((p) => req.url.startsWith(p))) return;
    const html = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html') && !req.url.startsWith('/api/');
    if (html) return reply.code(401).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(LOGIN_PAGE);
    return reply.code(401).send({ error: 'auth_required', message: 'Нужен пароль команды' });
  });

  // вошёл ли этот браузер: только по cookie (в разработке браузер ходит через прокси Vite с 127.0.0.1 —
  // это не имитатор, ему тоже нужен пароль)
  app.get('/api/v1/auth/status', async (req) => ({ ok: !gate.enabled || gate.check(cookieOf(req) ?? ''), gate: gate.enabled }));

  app.post<{ Body: { password?: unknown } }>('/api/v1/auth/login', async (req, reply) => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip;
    const now = Date.now();
    const recent = (fails.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
    if (recent.length >= MAX_FAILS) {
      return reply.code(429).send({ error: 'too_many_attempts', message: 'Слишком много попыток. Попробуйте через 10 минут' });
    }
    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const token = sessionToken(password);
    if (!password || !gate.check(token)) {
      recent.push(now);
      fails.set(ip, recent);
      return reply.code(401).send({ error: 'wrong_password', message: 'Неверный пароль' });
    }
    fails.delete(ip);
    const secure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    reply.header('set-cookie', `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
    return { ok: true };
  });

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    return { ok: true };
  });
}

/** Страница входа, когда сам интерфейс ещё закрыт: без внешних файлов */
export const LOGIN_PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Цифровой двойник — вход</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f5f8;font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1f24}
form{width:min(360px,calc(100vw - 32px));background:#fff;border-radius:20px;padding:28px;box-shadow:0 10px 30px rgba(27,31,36,.08),0 0 0 1px #e3e7ec}
h1{font-size:22px;margin:0 0 4px}p{margin:0 0 20px;color:#5b6573}label{display:block;font-weight:600;margin-bottom:6px}
input{width:100%;font:inherit;font-size:20px;letter-spacing:.2em;padding:10px 12px;border:1px solid #c9d0d8;border-radius:12px;outline:none}input:focus{border-color:#2b5fd9;box-shadow:0 0 0 3px rgba(43,95,217,.2)}
button{margin-top:14px;width:100%;font:inherit;font-weight:600;padding:11px;border:0;border-radius:12px;background:#2b5fd9;color:#fff;cursor:pointer}button:hover{background:#1f4bb8}
.err{color:#b42318;min-height:1.4em;margin-top:10px;font-size:15px}
</style></head><body>
<form id="f"><h1>Цифровой двойник Allur</h1><p>Прототип команды. Введите пароль · Құпиясөзді енгізіңіз · Enter the password</p>
<label for="p">Пароль</label><input id="p" name="password" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
<button type="submit">Войти</button><div class="err" id="e" role="alert"></div></form>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const e = document.getElementById('e'); e.textContent = '';
  try {
    const r = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('p').value }) });
    if (r.ok) return location.reload();
    const j = await r.json().catch(() => ({}));
    e.textContent = j.message || 'Неверный пароль';
  } catch { e.textContent = 'Нет связи с сервером'; }
});
</script></body></html>`;
