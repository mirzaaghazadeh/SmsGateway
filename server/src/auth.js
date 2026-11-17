// Secrets and authentication: admin login for the panel, device key, API key.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { persistentSecret, setSetting, setting, log } from './db.js';
import { HttpError, clientIp, isHttps, readJson } from './http.js';

export const SESSION_DAYS = 30;
const COOKIE = 'gw_session';

export function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const existing = setting('admin_password');
  if (existing) return existing;
  const pw = randomBytes(9).toString('base64url');
  setSetting('admin_password', pw);
  return pw;
}

export const deviceKey = () => process.env.DEVICE_KEY || persistentSecret('device_key', 18);
export const apiKey = () => process.env.API_KEY || persistentSecret('api_key', 24);
const sessionSecret = () => process.env.SESSION_SECRET || persistentSecret('session_secret', 32);

export function regenerateApiKey() {
  if (process.env.API_KEY) throw new HttpError(409, 'API_KEY is set in the server environment; change it there');
  setSetting('api_key', randomBytes(24).toString('base64url'));
  return apiKey();
}

export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a ?? '')).digest();
  const hb = createHash('sha256').update(String(b ?? '')).digest();
  return timingSafeEqual(ha, hb);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export function requireDevice(req) {
  if (!safeEqual(bearer(req), deviceKey())) throw new HttpError(401, 'Wrong device key');
}

export function requireApiKey(req) {
  const key = bearer(req) || req.headers['x-api-key'];
  if (!key || !safeEqual(key, apiKey())) throw new HttpError(401, 'Missing or wrong API key');
}

// ---------- panel session (signed cookie) ----------

const sign = (exp) => createHmac('sha256', sessionSecret()).update(`admin.${exp}`).digest('base64url');

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function isLoggedIn(req) {
  const c = readCookie(req, COOKIE);
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

export function requirePanel(req) {
  if (!isLoggedIn(req)) throw new HttpError(401, 'Please log in');
}

const attempts = new Map(); // ip -> { n, since }

export async function login(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, since: now };
  if (now - a.since > 15 * 60_000) Object.assign(a, { n: 0, since: now });
  if (a.n >= 10) throw new HttpError(429, 'Too many attempts, wait 15 minutes');
  const { password } = await readJson(req);
  if (!safeEqual(password, adminPassword())) {
    a.n++;
    attempts.set(ip, a);
    log(`Failed panel login from ${ip}`, { level: 'warn' });
    throw new HttpError(401, 'Wrong password');
  }
  attempts.delete(ip);
  const exp = now + SESSION_DAYS * 86400_000;
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; ${flags}`);
  return { ok: true };
}

export function logout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return { ok: true };
}
