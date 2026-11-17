import { db, setting, setSetting, tx, log } from './db.js';
import { Router, HttpError, readJson, intParam } from './http.js';
import * as auth from './auth.js';
import {
  handleSync, createOutgoing, getMessage, publicMessage, retryMessage, createJob, getJob, csqToDbm, ONLINE_MS,
} from './gateway.js';
import { webhookSecret, testWebhook, EVENTS } from './webhook.js';
import { checkReleases, firmwareView, cachedFirmware, readFirmware, newer, maybeCheckReleases } from './firmware.js';
import { ledSettings, setLedSettings, LED_STATES, LED_MODES } from './led.js';

export const router = new Router();

// ---------- device ----------

router.post('/api/device/sync', async (req) => {
  const body = await readJson(req, 512 * 1024);
  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(id)) throw new HttpError(400, 'Bad device id');
  auth.authenticateDevice(req, id);
  const answer = handleSync(body);
  maybeCheckReleases();
  return answer;
});

// Firmware image for an update the server offered (GET with the gateway's key).
router.get('/api/device/firmware', async (req, res) => {
  const id = String(req.query.id || '');
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(id)) throw new HttpError(400, 'Bad device id');
  auth.authenticateDevice(req, id);
  const bin = readFirmware(String(req.query.v || ''));
  if (!bin) throw new HttpError(404, 'This firmware version is not on the server');
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bin.length, 'Cache-Control': 'no-store' });
  res.end(bin);
});

// ---------- panel auth ----------

router.post('/api/auth/login', (req, res) => auth.login(req, res));
router.post('/api/auth/logout', (req, res) => auth.logout(req, res));
router.get('/api/auth/me', (req) => ({ loggedIn: auth.isLoggedIn(req) }));

// ---------- shared queries ----------

// Every gateway added in the panel, with its live status once it has checked in.
function gatewayList(now = Date.now()) {
  const sims = db.prepare('SELECT * FROM sims ORDER BY slot').all();
  const devices = new Map(db.prepare('SELECT * FROM devices').all().map((d) => [d.id, d]));
  return db
    .prepare('SELECT * FROM device_keys ORDER BY added_at')
    .all()
    .map((k) => {
      const d = k.device_id ? devices.get(k.device_id) : null;
      return {
        ...(d || {}),
        id: d ? d.id : null,
        key_id: k.id,
        hint: k.hint,
        added_at: k.added_at,
        name: k.name || d?.name || 'SMS Gateway',
        connected: !!d,
        online: !!d && now - d.last_seen < ONLINE_MS,
        sims: !d ? [] : sims
          .filter((s) => s.device_id === d.id)
          .map((s) => ({ ...s, dbm: csqToDbm(s.csq), ready: s.state === 'ready' && (s.reg === 1 || s.reg === 5) })),
      };
    });
}

const devicesWithSims = (now = Date.now()) => gatewayList(now).filter((g) => g.connected);

function listMessages(q, { asc = false } = {}) {
  const where = [];
  const args = [];
  if (q.direction === 'in' || q.direction === 'out') where.push('direction = ?'), args.push(q.direction);
  if (q.status) where.push('status = ?'), args.push(String(q.status));
  if (q.sim) where.push('slot = ?'), args.push(Number(q.sim));
  if (q.q) where.push('(number LIKE ? OR text LIKE ?)'), args.push(`%${q.q}%`, `%${q.q}%`);
  if (q.before) where.push('id < ?'), args.push(Number(q.before));
  if (q.since_id) where.push('id > ?'), args.push(Number(q.since_id));
  const limit = intParam(q.limit, 50, 1, 200);
  const rows = db
    .prepare(`SELECT * FROM messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ${asc ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...args, limit + 1);
  return { items: rows.slice(0, limit).map(publicMessage), more: rows.length > limit };
}

function listCalls(q, { asc = false } = {}) {
  const where = [];
  const args = [];
  if (q.q) where.push('number LIKE ?'), args.push(`%${q.q}%`);
  if (q.before) where.push('id < ?'), args.push(Number(q.before));
  if (q.since_id) where.push('id > ?'), args.push(Number(q.since_id));
  const limit = intParam(q.limit, 50, 1, 200);
  const rows = db
    .prepare(`SELECT id, device_id, slot, number, action, ring_ms, ts FROM calls ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ${asc ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...args, limit + 1);
  return { items: rows.slice(0, limit), more: rows.length > limit };
}

// ---------- panel ----------

const panel = (handler) => async (req, res) => {
  auth.requirePanel(req);
  return handler(req, res);
};

router.get('/api/overview', panel(() => {
  const now = Date.now();
  const since = now - 86400_000;
  const c = db
    .prepare(
      `SELECT
         SUM(direction = 'in') received,
         SUM(direction = 'out' AND status = 'sent') sent,
         SUM(direction = 'out' AND status = 'failed') failed
       FROM messages WHERE created_at > ?`
    )
    .get(since);
  const pending = db.prepare("SELECT COUNT(*) n FROM messages WHERE direction = 'out' AND status IN ('queued', 'sending')").get().n;
  const calls = db.prepare('SELECT COUNT(*) n FROM calls WHERE ts > ?').get(since).n;
  const gateways = gatewayList(now);
  return {
    now,
    devices: gateways.filter((g) => g.connected),
    waiting: gateways.filter((g) => !g.connected).map((g) => ({ key_id: g.key_id, hint: g.hint, name: g.name, added_at: g.added_at })),
    knocking: auth.waitingGateways(now),
    last24h: { received: c.received || 0, sent: c.sent || 0, failed: c.failed || 0, calls, pending },
    messages: listMessages({ limit: 6 }).items,
    calls: listCalls({ limit: 5 }).items,
    logs: db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 8').all(),
  };
}));

router.get('/api/messages', panel((req) => listMessages(req.query)));
router.post('/api/messages', panel(async (req) => {
  const b = await readJson(req);
  return createOutgoing({ to: b.to, text: b.text, sim: b.sim, source: 'panel' });
}));
router.get('/api/messages/:id', panel((req) => getMessage(Number(req.params.id)) ?? notFound()));
router.post('/api/messages/:id/retry', panel((req) => retryMessage(Number(req.params.id))));

router.get('/api/calls', panel((req) => listCalls(req.query)));

router.get('/api/signals', panel((req) => {
  const hours = intParam(req.query.hours, 24, 1, 24 * 30);
  const since = Date.now() - hours * 3600_000;
  const bucket = Math.max(60_000, Math.round((hours * 3600_000) / 360)); // <= ~360 points per line
  const devices = db
    .prepare('SELECT d.id, COALESCE(k.name, d.name) name FROM devices d JOIN device_keys k ON k.device_id = d.id ORDER BY d.first_seen')
    .all();
  const device = req.query.device || devices[0]?.id;
  const rows = db
    .prepare(
      `SELECT (ts / ?) * ? AS t, AVG(wifi_rssi) wifi, AVG(NULLIF(s1_csq, 99)) s1, AVG(NULLIF(s2_csq, 99)) s2,
              AVG(s1_mv) s1mv, AVG(s2_mv) s2mv, MIN(heap) heap
       FROM samples WHERE device_id = ? AND ts > ? GROUP BY t ORDER BY t`
    )
    .all(bucket, bucket, device ?? '', since);
  const r1 = (v) => (v == null ? null : Math.round(v));
  return {
    device,
    devices,
    bucket,
    points: rows.map((r) => ({
      t: r.t,
      wifi: r1(r.wifi),
      s1: r.s1 == null ? null : csqToDbm(Math.round(r.s1)),
      s2: r.s2 == null ? null : csqToDbm(Math.round(r.s2)),
      s1mv: r1(r.s1mv),
      s2mv: r1(r.s2mv),
      heap: r.heap,
    })),
  };
}));

router.get('/api/stats', panel((req) => {
  const days = intParam(req.query.days, 30, 1, 365);
  let tz = String(req.query.tz || 'UTC');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const now = Date.now();
  const since = now - days * 86400_000;
  const day = (ts) => fmt.format(new Date(ts));
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) buckets.set(day(now - i * 86400_000), { date: day(now - i * 86400_000), received: 0, sent: 0, failed: 0, calls: 0 });
  const bySim = { 1: { received: 0, sent: 0, failed: 0, calls: 0 }, 2: { received: 0, sent: 0, failed: 0, calls: 0 } };
  const senders = new Map();
  const add = (ts, key, slot) => {
    const b = buckets.get(day(ts));
    if (b) b[key]++;
    if (bySim[slot]) bySim[slot][key]++;
  };
  for (const m of db.prepare('SELECT direction, status, slot, number, created_at FROM messages WHERE created_at > ?').all(since)) {
    if (m.direction === 'in') {
      add(m.created_at, 'received', m.slot);
      senders.set(m.number, (senders.get(m.number) || 0) + 1);
    } else if (m.status === 'sent') add(m.created_at, 'sent', m.slot);
    else if (m.status === 'failed') add(m.created_at, 'failed', m.slot);
  }
  const callers = new Map();
  for (const c of db.prepare('SELECT slot, number, ts FROM calls WHERE ts > ?').all(since)) {
    add(c.ts, 'calls', c.slot);
    callers.set(c.number, (callers.get(c.number) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([number, count]) => ({ number, count }));
  const daily = [...buckets.values()];
  const totals = daily.reduce((t, d) => ({
    received: t.received + d.received, sent: t.sent + d.sent, failed: t.failed + d.failed, calls: t.calls + d.calls,
  }), { received: 0, sent: 0, failed: 0, calls: 0 });
  return { days, tz, daily, totals, bySim, topSenders: top(senders), topCallers: top(callers) };
}));

router.get('/api/logs', panel((req) => {
  const limit = intParam(req.query.limit, 100, 1, 500);
  const before = req.query.before ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
  const rows = db.prepare('SELECT * FROM logs WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit + 1);
  return { items: rows.slice(0, limit), more: rows.length > limit };
}));

router.get('/api/devices', panel(() => ({
  gateways: gatewayList(),
  waiting: auth.waitingGateways(),
  firmware: cachedFirmware()?.version || null,
})));
router.post('/api/devices/:id/update', panel((req) => {
  const d = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!d) notFound();
  const c = cachedFirmware();
  if (!c) throw new HttpError(409, 'No firmware release on the server yet. Check for updates in Settings.');
  if (!newer(c.version, d.fw)) throw new HttpError(409, `Already up to date (${d.fw})`);
  db.prepare('UPDATE devices SET fw_requested = 1, fw_offered = NULL, fw_result = ? WHERE id = ?').run(`waiting to install ${c.version}`, d.id);
  log(`Update to ${c.version} requested from the panel`, { device_id: d.id });
  return { ok: true, version: c.version };
}));
router.get('/api/firmware', panel(() => firmwareView()));
router.post('/api/firmware/check', panel(() => checkReleases()));
router.put('/api/firmware', panel(async (req) => {
  const b = await readJson(req);
  if (b.auto !== undefined) setSetting('fw_auto', b.auto ? 'on' : 'off');
  if (b.hour !== undefined) {
    const h = Number(b.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new HttpError(400, 'Hour goes from 0 to 23');
    setSetting('fw_hour', h);
  }
  if (b.tz !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: String(b.tz) });
    } catch {
      throw new HttpError(400, 'Unknown time zone');
    }
    setSetting('fw_tz', String(b.tz));
  }
  return firmwareView();
}));
router.post('/api/devices', panel(async (req) => {
  const b = await readJson(req);
  const keyId = auth.addDeviceKey(b.key, b.name);
  return gatewayList().find((g) => g.key_id === keyId);
}));
router.post('/api/devices/:id/jobs', panel(async (req) => createJob(req.params.id, await readJson(req))));
// Remove a gateway: its key stops working at once. Messages and calls stay.
router.delete('/api/devices/key/:kid', panel((req) => {
  const k = db.prepare('SELECT * FROM device_keys WHERE id = ?').get(Number(req.params.kid));
  if (!k) notFound();
  tx(() => {
    db.prepare('DELETE FROM device_keys WHERE id = ?').run(k.id);
    if (k.device_id) {
      for (const t of ['sims', 'samples']) db.prepare(`DELETE FROM ${t} WHERE device_id = ?`).run(k.device_id);
      db.prepare('DELETE FROM devices WHERE id = ?').run(k.device_id);
      db.prepare("UPDATE jobs SET status = 'failed', result = 'Gateway removed' WHERE device_id = ? AND status IN ('queued', 'sent')").run(k.device_id);
    }
  });
  log(`Gateway with key …${k.hint} removed`);
  return { ok: true };
}));
router.get('/api/jobs/:id', panel((req) => getJob(Number(req.params.id)) ?? notFound()));

function settingsView(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return {
    call_mode: setting('call_mode', 'reject'),
    webhook_url: setting('webhook_url', ''),
    webhook_secret: webhookSecret(),
    webhook_events: EVENTS,
    led: ledSettings(),
    led_states: LED_STATES,
    led_modes: LED_MODES,
    api_key: auth.apiKey(),
    api_key_from_env: !!process.env.API_KEY,
    server_url: `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`,
  };
}

router.get('/api/settings', panel((req) => settingsView(req)));
router.put('/api/settings', panel(async (req) => {
  const b = await readJson(req);
  if (b.call_mode !== undefined) {
    if (!['reject', 'ignore'].includes(b.call_mode)) throw new HttpError(400, 'call_mode must be reject or ignore');
    setSetting('call_mode', b.call_mode);
  }
  if (b.webhook_url !== undefined) {
    const u = String(b.webhook_url || '').trim();
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw new HttpError(400, 'Webhook URL must start with http:// or https://');
    setSetting('webhook_url', u);
  }
  if (b.led !== undefined) setLedSettings(b.led);
  return settingsView(req);
}));
router.post('/api/settings/api-key', panel((req) => (auth.regenerateApiKey(), settingsView(req))));
router.post('/api/settings/webhook-test', panel(() => testWebhook()));

// ---------- public API (API key) ----------

const api = (handler) => async (req, res) => {
  auth.requireApiKey(req);
  return handler(req, res);
};

router.post('/api/v1/sms', api(async (req, res) => {
  const b = await readJson(req);
  res.statusCode = 201;
  return createOutgoing({ to: b.to, text: b.text, sim: b.sim, source: 'api' });
}));
router.get('/api/v1/sms/:id', api((req) => getMessage(Number(req.params.id)) ?? notFound()));
router.get('/api/v1/messages', api((req) => listMessages(req.query, { asc: !!req.query.since_id })));
router.get('/api/v1/calls', api((req) => listCalls(req.query, { asc: !!req.query.since_id })));
router.get('/api/v1/status', api(() =>
  devicesWithSims().map((d) => ({
    id: d.id, name: d.name, online: d.online, last_seen: d.last_seen,
    sims: d.sims.map((s) => ({ sim: s.slot, ready: s.ready, operator: s.operator, signal_dbm: s.dbm, state: s.state })),
  }))
));

function notFound() {
  throw new HttpError(404, 'Not found');
}
