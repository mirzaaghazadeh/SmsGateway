import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { router } from './routes.js';
import { HttpError, sendJson, serveStatic } from './http.js';
import { adminPassword } from './auth.js';
import { maintenance } from './gateway.js';
import { log } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, '..', 'public');
const SHARED = join(here, 'shared');
const PORT = Number(process.env.PORT || 3000);

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
  const path = url.pathname;
  try {
    if (path === '/health') return sendJson(res, 200, { ok: true });
    if (path.startsWith('/api/')) {
      const m = router.match(req.method, path);
      if (!m) throw new HttpError(404, 'Not found');
      if (m.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
      req.params = m.params;
      const result = await m.handler(req, res);
      return sendJson(res, res.statusCode || 200, result ?? { ok: true });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (path === '/js/gsm.js' && (await serveStatic(req, res, SHARED, 'gsm.js'))) return;
    if (path !== '/' && (await serveStatic(req, res, PUBLIC, path))) return;
    if (!(await serveStatic(req, res, PUBLIC, 'index.html'))) throw new HttpError(404, 'Not found'); // single page app
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Server error' : e.message });
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

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
