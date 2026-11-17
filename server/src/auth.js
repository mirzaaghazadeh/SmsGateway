// Secrets and authentication: admin login for the panel, gateway keys, API key.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, persistentSecret, setSetting, setting, log, tx } from './db.js';
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

// ---------- gateway keys ----------
// Each gateway makes its own key, e.g. K7Q2-M9XD-4TPA-W3HZ: 16 characters from an alphabet
// without 0/O and 1/I, so it can be read off a small screen and typed. The owner adds it in the panel.

const KEY_RE = /^[2-9A-HJ-NP-Z]{16}$/;
export const normalizeKey = (k) => String(k ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const hashKey = (k) => createHash('sha256').update(`gateway-key:${k}`).digest('hex');

export function addDeviceKey(rawKey, name) {
  const key = normalizeKey(rawKey);
  if (!KEY_RE.test(key)) {
    throw new HttpError(400, 'A device key has 16 letters and digits, like K7Q2-M9XD-4TPA-W3HZ. Copy it from the gateway setup page.');
  }
  const hash = hashKey(key);
  if (db.prepare('SELECT 1 FROM device_keys WHERE key_hash = ?').get(hash)) throw new HttpError(409, 'This gateway is already added');
  const r = db
    .prepare('INSERT INTO device_keys (key_hash, hint, name, added_at) VALUES (?, ?, ?, ?)')
    .run(hash, key.slice(-4), String(name || '').trim().slice(0, 40) || null, Date.now());
  waiting.delete(hash);
  log(`Gateway key …${key.slice(-4)} added${name ? ` as "${String(name).trim()}"` : ''}`);
  return Number(r.lastInsertRowid);
}

// Gateways that knocked with a key nobody added yet (kept in memory, shown on the Devices page).
const waiting = new Map(); // key hash -> { hint, device_id, ip, at }

export function waitingGateways(now = Date.now()) {
  for (const [h, w] of waiting) if (now - w.at > 30 * 60_000) waiting.delete(h);
  return [...waiting.values()].sort((a, b) => b.at - a.at).slice(0, 5);
}

// Checks the Bearer key of a gateway check-in. Returns its device_keys row; binds the key to this
// ESP32 on the first check-in, so a copied key cannot be used by a second board.
export function authenticateDevice(req, deviceId) {
  const key = normalizeKey(bearer(req));
  if (!KEY_RE.test(key)) throw new HttpError(401, 'Missing device key', 'bad_key');
  const hash = hashKey(key);
  const row = db.prepare('SELECT * FROM device_keys WHERE key_hash = ?').get(hash);
  const now = Date.now();
  if (!row) {
    const prev = waiting.get(hash);
    if (!prev || now - prev.at > 10 * 60_000) {
      log(`A gateway (ID ${deviceId}) with key …${key.slice(-4)} is trying to connect. Add its key under Devices.`, { level: 'warn' });
    }
    waiting.set(hash, { hint: key.slice(-4), device_id: deviceId, ip: clientIp(req), at: now });
    throw new HttpError(403, 'This gateway is not added yet: add its device key in the panel under Devices', 'not_added');
  }
  if (row.device_id === deviceId) return row;
  if (row.device_id) throw new HttpError(403, 'This device key already belongs to another gateway', 'key_in_use');
  return tx(() => {
    // the same board with a new key: the new key replaces the old one, keeping the name
    const old = db.prepare('SELECT * FROM device_keys WHERE device_id = ?').get(deviceId);
    if (old) {
      db.prepare('DELETE FROM device_keys WHERE id = ?').run(old.id);
      if (!row.name && old.name) db.prepare('UPDATE device_keys SET name = ? WHERE id = ?').run(old.name, row.id);
    }
    db.prepare('UPDATE device_keys SET device_id = ? WHERE id = ?').run(deviceId, row.id);
    log(`Gateway with key …${row.hint} checked in for the first time (ID ${deviceId})`, { device_id: deviceId });
    return db.prepare('SELECT * FROM device_keys WHERE id = ?').get(row.id);
  });
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
