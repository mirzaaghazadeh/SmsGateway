// Tiny HTTP toolkit: router, JSON body, errors, static files. No dependencies.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error {
  // `code` is a short machine-readable reason (the gateway firmware reads it), sent next to `error`.
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, path, handler) {
    const keys = [];
    const re = new RegExp(
      '^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$'
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export async function readJson(req, limit = 256 * 1024) {
  if (req._body !== undefined) return req._body;
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Send JSON (Content-Type: application/json)');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  try {
    req._body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  if (typeof req._body !== 'object' || req._body === null) throw new HttpError(400, 'JSON object expected');
  return req._body;
}

export function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

// Serve a file from `root`; returns false if it does not exist.
export async function serveStatic(req, res, root, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = join(root, rel);
  if (!file.startsWith(root + sep) && file !== root) return false;
  let st;
  try {
    st = await stat(file);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    ETag: etag,
    // fonts never change; everything else is revalidated with the ETag so a redeploy shows at once
    'Cache-Control': extname(file) === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  return true;
}

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (typeof xf === 'string' && xf.split(',')[0].trim()) || req.socket.remoteAddress || '?';
}

export function isHttps(req) {
  return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').startsWith('https');
}

export function intParam(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
