import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { router } from './routes.js';
import { HttpError, sendJson, serveStatic } from './http.js';
import { adminPassword } from './auth.js';
import { maintenance } from './gateway.js';
import { checkReleases } from './firmware.js';
import { telegramTick } from './telegram.js';
import { log } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const SHARED = join(here, 'shared');
const PORT = Number(process.env.PORT || 3000);

// The panel loads its scripts and styles from /v/<version>/..., where the version is a hash of the
// files. A deploy changes it, so browsers never run old panel code, even behind a proxy that keeps
// .js and .css for hours on its own (Cloudflare does). The page itself is never cached.
function filesVersion() {
  const h = createHash('sha1');
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(e.name).update(readFileSync(p));
    }
  };
  walk(PUBLIC);
  walk(SHARED);
  return h.digest('hex').slice(0, 12);
}
const VERSION = filesVersion();
let INDEX = null;
try {
  INDEX = readFileSync(join(PUBLIC, 'index.html'), 'utf8')
    .replace('href="/app.css"', `href="/v/${VERSION}/app.css"`)
    .replace('src="/js/app.js"', `src="/v/${VERSION}/js/app.js"`);
} catch {
  // no panel files: the API still works
}
// while developing, files change without a restart: do not let the browser keep them
const KEEP_VERSIONED = process.env.NODE_ENV === 'production';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://local');
  req.query = Object.fromEntries(url.searchParams);
  let path = url.pathname;
  let immutable = false;
  const versioned = /^\/v\/([0-9a-f]{6,40})(\/.+)$/.exec(path);
  if (versioned) {
    path = versioned[2];
    immutable = KEEP_VERSIONED && versioned[1] === VERSION; // an old version is served, not kept
  }
  try {
    if (path === '/health') return sendJson(res, 200, { ok: true });
    if (path.startsWith('/api/')) {
      const m = router.match(req.method, path);
      if (!m) throw new HttpError(404, 'Not found');
      if (m.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
      req.params = m.params;
      const result = await m.handler(req, res);
      if (res.headersSent) return; // the handler sent a file itself
      return sendJson(res, res.statusCode || 200, result ?? { ok: true });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (path === '/js/gsm.js' && (await serveStatic(req, res, SHARED, 'gsm.js', { immutable }))) return;
    if (path !== '/' && path !== '/index.html' && (await serveStatic(req, res, PUBLIC, path, { immutable }))) return;
    if (!INDEX || versioned) throw new HttpError(404, 'Not found');
    // single page app: every other path gets the page, with the versioned file links
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : INDEX);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) {
      sendJson(res, status, { error: status === 500 ? 'Server error' : e.message, ...(e.code && status !== 500 ? { code: e.code } : {}) });
    }
    else res.end();
  }
});

server.keepAliveTimeout = 65_000; // the ESP32 keeps its HTTPS connection open between syncs
server.headersTimeout = 70_000;

server.listen(PORT, () => {
  console.log(`SMS gateway server on port ${server.address().port}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`ADMIN_PASSWORD is not set. Panel password: ${adminPassword()}  (set ADMIN_PASSWORD to choose your own)`);
  }
  log('Server started');
});

setInterval(() => {
  try {
    maintenance();
  } catch (e) {
    console.error('maintenance', e);
  }
}, 30_000).unref();

// send Telegram messages that are waiting (new ones go out at once; this picks up retries)
setInterval(() => telegramTick().catch((e) => console.error('telegram', e)), 5_000).unref();

// look for new firmware releases on GitHub: shortly after start, then every 6 hours
setTimeout(() => checkReleases(), 5_000).unref();
setInterval(() => checkReleases(), 6 * 3600_000).unref();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
