// Gateway logic: device sync (status, events, jobs), outgoing SMS queue, maintenance.
import { createHash } from 'node:crypto';
import { db, tx, log, setting } from './db.js';
import { HttpError } from './http.js';
import { encodeSubmit, decodePdu, normalizeNumber } from './pdu.js';
import { analyzeText } from './shared/gsm.js';
import { emit } from './webhook.js';
import { updateOffer, newer } from './firmware.js';
import { ledForDevice } from './led.js';
import { forwardSms, forwardCall, alertDevice, lineState, checkSignalAlerts, notifyOutgoing, notifyBalance } from './telegram.js';
import { simConfig, allLines, lineOf, roamingGuard, simLabel, ROAMING_FW } from './lines.js';
import { parseCusd, oneLine, USSD_RE } from './ussd.js';

export const USSD_FW = '1.3.0'; // first firmware that runs USSD codes (balance checks)

export const ONLINE_MS = 30_000;
const JOB_TIMEOUT_MS = 240_000; // a network search (AT+COPS=?) can take 3 minutes
const MAX_ATTEMPTS = 3;
const SAMPLE_EVERY_MS = 60_000;
const SLOTS = [1, 2];

export const csqToDbm = (csq) => (csq == null || csq === 99 || csq < 0 ? null : -113 + 2 * Math.min(csq, 31));
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const str = (v, max = 200) => (v == null ? null : String(v).slice(0, max));
const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
// The gateway sends 0 when it has no reading (Wi-Fi not joined, SIM800L not answering): store nothing
const rssi = (v) => { const n = int(v); return n != null && n < 0 && n > -127 ? n : null; };
const millivolts = (v) => { const n = int(v); return n != null && n > 0 ? n : null; };
// CSQ 0..31; 99 = unknown. A SIM800L that has just started says 0 before it finds the network: that is
// "no reading yet", not -113 dBm, unless it is registered.
const signalCsq = (s) => {
  const c = int(s?.csq);
  if (c == null || c < 0 || c > 31) return null;
  return c === 0 && ![1, 5].includes(int(s.reg)) ? null : c;
};

export function callMode() {
  return setting('call_mode', 'reject');
}

// ---------- outgoing SMS ----------

// ---------- roaming mode ----------

// Roaming mode is on right now for this SIM of this gateway (calls ring, no SMS goes out).
export function guarded(device, slot, all = allLines()) {
  const sim = db.prepare('SELECT reg FROM sims WHERE device_id = ? AND slot = ?').get(device, slot);
  return roamingGuard(lineOf(device, slot, all), sim);
}

// An SMS asked for on this SIM slot cannot go out: on every gateway that could send it, the SIM is
// in roaming mode.
function roamingBlocks(slot, device = null) {
  const devices = device ? [device] : db.prepare('SELECT device_id FROM device_keys WHERE device_id IS NOT NULL').all().map((r) => r.device_id);
  const all = allLines();
  return devices.length > 0 && devices.every((d) => guarded(d, slot, all));
}

const roamingError = (slot, device) =>
  `${device ? simLabel(device, slot) : `SIM ${slot}`} is in roaming mode, so it sends no SMS. `
  + 'Send from the other SIM, or turn roaming mode off under Devices → SIM cards.';

// Firmware older than 1.4.0 knows only one call setting for both SIMs: while a SIM of the gateway is
// in roaming mode, let calls ring on both rather than hang up.
function callModeFor(device, fw) {
  if (!newer(ROAMING_FW, fw)) return callMode();
  return SLOTS.some((s) => guarded(device, s)) ? 'ignore' : callMode();
}

// device: only this gateway may send it (a reply from the SIM that got the SMS, a keep-alive SMS)
export function createOutgoing({ to, text, sim = 0, source = 'api', tgChat = null, device = null }) {
  const n = normalizeNumber(to);
  if (!n) throw new HttpError(400, 'Invalid phone number');
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Text is empty');
  if (SLOTS.includes(Number(sim)) && roamingBlocks(Number(sim), device)) throw new HttpError(409, roamingError(Number(sim), device));
  text = text.replace(/\r\n?/g, '\n');
  let parts;
  try {
    parts = encodeSubmit(n.display, text);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const slot = SLOTS.includes(Number(sim)) ? Number(sim) : 0;
  const info = analyzeText(text);
  const r = db
    .prepare(
      `INSERT INTO messages (direction, number, text, status, encoding, parts, pdus, source, want_slot, created_at, tg_chat, device_id)
       VALUES ('out', ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(n.display, text, info.encoding, parts.length, JSON.stringify(parts), source, slot, Date.now(), tgChat, device);
  return getMessage(Number(r.lastInsertRowid));
}

export function getMessage(id) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  return m ? publicMessage(m) : null;
}

export function publicMessage(m) {
  const { pdus, ukey, not_before, tg_chat, ...rest } = m;
  return rest;
}

export function retryMessage(id) {
  const m = db.prepare("SELECT * FROM messages WHERE id = ? AND direction = 'out'").get(id);
  if (!m) throw new HttpError(404, 'Message not found');
  if (m.status !== 'failed') throw new HttpError(409, 'Only failed messages can be retried');
  db.prepare("UPDATE messages SET status = 'queued', attempts = 0, error = NULL, not_before = NULL WHERE id = ?").run(id);
  return getMessage(id);
}

// ---------- device sync ----------

const lastSample = new Map();

export function handleSync(body, now = Date.now()) {
  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(id)) throw new HttpError(400, 'Bad device id');
  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  const sims = Array.isArray(body.sims) ? body.sims.filter((s) => SLOTS.includes(Number(s?.slot))) : [];

  return tx(() => {
    const dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    const boot = int(body.boot);
    const wifi = body.wifi || {};
    if (dev) {
      if (dev.boot !== boot) log(`Gateway restarted (${str(body.reset, 40) || 'unknown reason'})`, { device_id: id });
      if (dev.offline) {
        log(`Gateway back online after ${Math.round((now - dev.last_seen) / 60000)} min`, { device_id: id });
        emit('device.online', { device: id, name: dev.name });
        toTelegram(() => alertDevice({ device: id, online: true, offlineFor: now - dev.last_seen, now }), id, null);
      }
    }
    db.prepare(
      `INSERT INTO devices (id, name, fw, ip, ssid, wifi_rssi, heap, uptime, boot, reset_reason, first_seen, last_seen, offline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, fw = excluded.fw, ip = excluded.ip, ssid = excluded.ssid,
         wifi_rssi = excluded.wifi_rssi, heap = excluded.heap, uptime = excluded.uptime, boot = excluded.boot,
         reset_reason = excluded.reset_reason, last_seen = excluded.last_seen, offline = 0`
    ).run(
      id, str(body.name, 40) || 'SMS Gateway', str(body.fw, 20), str(wifi.ip, 40), str(wifi.ssid, 40),
      rssi(wifi.rssi), int(body.heap), int(body.uptime), boot, str(body.reset, 40), now, now
    );
    if (dev?.fw && body.fw && dev.fw !== str(body.fw, 20)) {
      log(`Firmware changed: ${dev.fw} -> ${body.fw}`, { device_id: id });
      db.prepare('UPDATE devices SET fw_result = ? WHERE id = ?').run(`running ${str(body.fw, 20)}`, id);
    }
    if (Array.isArray(wifi.saved)) { // firmware 1.5.0: the names of its saved Wi-Fi networks
      const names = wifi.saved.slice(0, 10).map((s) => str(s, 32)).filter(Boolean);
      db.prepare('UPDATE devices SET wifi_saved = ? WHERE id = ?').run(JSON.stringify(names), id);
    }

    const prevSims = new Map(db.prepare('SELECT * FROM sims WHERE device_id = ?').all(id).map((s) => [s.slot, s]));
    for (const s of sims) {
      const slot = Number(s.slot);
      const prev = prevSims.get(slot);
      const state = str(s.state, 20);
      if (prev && prev.state !== state) log(`SIM ${slot}: ${prev.state} -> ${state}`, { device_id: id, slot });
      db.prepare(
        `INSERT INTO sims (device_id, slot, state, sim, imei, iccid, operator, csq, reg, mv, queue, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id, slot) DO UPDATE SET state = excluded.state, sim = excluded.sim, imei = excluded.imei,
           iccid = excluded.iccid, operator = excluded.operator, csq = excluded.csq, reg = excluded.reg,
           mv = excluded.mv, queue = excluded.queue, updated_at = excluded.updated_at`
      ).run(
        id, slot, state, str(s.sim, 30), str(s.imei, 20), str(s.iccid, 24), str(s.op, 40),
        signalCsq(s), int(s.reg), millivolts(s.mv), int(s.queue), now
      );
      toTelegram(() => lineState({ device: id, slot, prev: prev?.state, state, operator: str(s.op, 40), csq: signalCsq(s), now }), id, slot);
    }
    toTelegram(() => checkSignalAlerts(now), id, null);

    if (now - (lastSample.get(id) || 0) >= SAMPLE_EVERY_MS) {
      lastSample.set(id, now);
      const by = Object.fromEntries(sims.map((s) => [Number(s.slot), s]));
      db.prepare(
        `INSERT INTO samples (device_id, ts, wifi_rssi, heap, s1_csq, s1_reg, s1_mv, s2_csq, s2_reg, s2_mv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, now, rssi(wifi.rssi), int(body.heap),
        signalCsq(by[1]), int(by[1]?.reg), millivolts(by[1]?.mv), signalCsq(by[2]), int(by[2]?.reg), millivolts(by[2]?.mv)
      );
    }

    let ack = 0;
    for (const ev of events) {
      const seq = int(ev?.seq) ?? 0;
      ack = Math.max(ack, seq);
      try {
        handleEvent(id, boot, ev, now);
      } catch (e) {
        log(`Could not process a ${ev?.t} event: ${e.message}`, { level: 'error', device_id: id });
      }
    }

    try {
      lineChores(id, str(body.fw, 20), now); // keep-alive SMS and balance checks that are due
    } catch (e) {
      log(`Keep-alive / balance check: ${e.message}`, { level: 'warn', device_id: id });
    }
    const jobs = dispatch(id, Math.min(5, Math.max(0, int(body.free) ?? 2)), now);
    const interval = Math.min(60, Math.max(2, int(setting('sync_interval', 5)) ?? 5));
    return {
      ack,
      jobs,
      config: { calls: callModeFor(id, str(body.fw, 20)), interval, led: ledForDevice(), sims: simConfig(id) },
      update: updateOffer(id, str(body.fw, 20), now),
      time: Math.floor(now / 1000),
    };
  });
}

function handleEvent(device, boot, ev, now) {
  const slot = SLOTS.includes(Number(ev.slot)) ? Number(ev.slot) : null;
  switch (ev.t) {
    case 'sms':
      return incomingPdu(device, slot, String(ev.pdu || ''), now);
    case 'call': {
      const number = str(ev.num, 40) || 'unknown';
      const r = db
        .prepare('INSERT OR IGNORE INTO calls (device_id, slot, number, action, ring_ms, ts, ukey) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(device, slot, number, ev.action === 'missed' ? 'missed' : 'rejected', int(ev.ring), now, `call:${device}:${boot}:${ev.seq}`);
      if (r.changes) {
        emit('call.missed', { id: Number(r.lastInsertRowid), device, sim: slot, number, action: ev.action, time: now });
        toTelegram(() => forwardCall({ device, slot, number, now }), device, slot);
      }
      return;
    }
    case 'job':
    case 'at':
      return jobResult(device, int(ev.job), !!ev.ok, ev);
    case 'fw': {
      // firmware update result: ok = installed and restarting, else why it failed
      const text = ev.ok ? `Firmware ${str(ev.version, 20)} installed, restarting` : `Firmware update to ${str(ev.version, 20)} failed: ${str(ev.msg, 200)}`;
      db.prepare('UPDATE devices SET fw_result = ? WHERE id = ?').run(ev.ok ? `installed ${str(ev.version, 20)}` : `failed: ${str(ev.msg, 200)}`, device);
      return log(text, { device_id: device, level: ev.ok ? 'info' : 'warn', ukey: `fw:${device}:${boot}:${ev.seq}` });
    }
    case 'log':
      return log(str(ev.msg, 500), {
        device_id: device,
        slot,
        level: ['warn', 'error'].includes(ev.level) ? ev.level : 'info',
        ukey: `log:${device}:${boot}:${ev.seq}`,
      });
  }
}

function incomingPdu(device, slot, pdu, now) {
  const ukey = 'p:' + sha1(`${device}|${slot}|${pdu.toUpperCase()}`);
  if (db.prepare('SELECT 1 FROM messages WHERE ukey = ? UNION SELECT 1 FROM sms_parts WHERE ukey = ?').get(ukey, ukey)) return;
  let m;
  try {
    m = decodePdu(pdu);
  } catch (e) {
    log(`SIM ${slot}: could not decode an SMS (${e.message}), stored as raw PDU`, { level: 'warn', device_id: device, slot });
    return saveIncoming({ device, slot, number: 'unknown', text: pdu, encoding: 'raw', parts: 1, time: null, ukey, now });
  }
  if (m.type === 'status') {
    log(`SIM ${slot}: delivery report for ${m.number}, status ${m.status}`, { device_id: device, slot });
    db.prepare('INSERT OR IGNORE INTO sms_parts (device_id, slot, number, received_at, message_id, ukey) VALUES (?, ?, ?, ?, -1, ?)').run(device, slot, m.number, now, ukey);
    return;
  }
  if (!m.concat) {
    return saveIncoming({ device, slot, number: m.number, text: m.text, encoding: m.encoding, parts: 1, time: m.time, ukey, now });
  }
  const { ref, total, seq } = m.concat;
  db.prepare(
    `INSERT INTO sms_parts (device_id, slot, number, ref, total, seq, text, sms_time, received_at, ukey)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(device, slot, m.number, ref, total, seq, m.text, m.time, now, ukey);
  const rows = db
    .prepare(
      `SELECT * FROM sms_parts WHERE device_id = ? AND slot = ? AND number = ? AND ref = ? AND total = ?
       AND message_id IS NULL ORDER BY seq, id`
    )
    .all(device, slot, m.number, ref, total);
  const bySeq = new Map(rows.map((r) => [r.seq, r]));
  if (bySeq.size === total) assemble(device, slot, m.number, total, rows, bySeq, m.encoding, now);
}

function assemble(device, slot, number, total, rows, bySeq, encoding, now) {
  let text = '';
  for (let s = 1; s <= total; s++) text += bySeq.has(s) ? bySeq.get(s).text : ' [...] ';
  const first = rows[0];
  const id = saveIncoming({
    device, slot, number, text, encoding, parts: total, time: first.sms_time, ukey: 'c:' + first.ukey, now,
    note: bySeq.size < total ? `${total - bySeq.size} of ${total} parts never arrived` : null,
  });
  const mark = db.prepare('UPDATE sms_parts SET message_id = ? WHERE id = ?');
  for (const r of rows) mark.run(id ?? -1, r.id);
}

function saveIncoming({ device, slot, number, text, encoding, parts, time, ukey, now, note = null }) {
  const r = db
    .prepare(
      `INSERT OR IGNORE INTO messages (direction, device_id, slot, number, text, status, encoding, parts, error, source, created_at, sms_time, ukey)
       VALUES ('in', ?, ?, ?, ?, 'received', ?, ?, ?, 'sim', ?, ?, ?)`
    )
    .run(device, slot, number, text, encoding, parts, note, now, time, ukey);
  if (!r.changes) return null;
  const id = Number(r.lastInsertRowid);
  emit('sms.received', { id, device, sim: slot, from: number, text, sms_time: time, received_at: now, parts });
  // a long SMS gets here once, joined from all its parts, so Telegram gets one message for it
  toTelegram(() => forwardSms({ device, slot, from: number, text, parts, note, smsTime: time, now }), device, slot);
  return id;
}

// A Telegram problem must never stop an SMS or call from being saved.
function toTelegram(fn, device, slot) {
  try {
    fn();
  } catch (e) {
    log(`Telegram: could not queue a message (${e.message})`, { level: 'warn', device_id: device, slot });
  }
}

function jobResult(device, jobId, ok, ev) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND device_id = ?').get(jobId, device);
  if (!job || !['sent', 'lost'].includes(job.status)) return; // unknown or already handled
  const now = Date.now();
  let result = ok ? str(ev.out ?? (Array.isArray(ev.ref) ? 'ref ' + ev.ref.join(',') : ev.ref), 4000) : str(ev.err || ev.out || 'error', 4000);
  if (job.type === 'ussd') return ussdResult(job, ok, result, now);
  db.prepare('UPDATE jobs SET status = ?, result = ?, done_at = ? WHERE id = ?').run(ok ? 'done' : 'failed', result, now, jobId);
  if (job.type === 'wifi') forgetWifiPasswords();
  if (job.type !== 'sms') return;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(job.message_id);
  if (!msg || msg.status === 'sent') return;
  if (ok) {
    db.prepare("UPDATE messages SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?").run(now, msg.id);
    emit('sms.sent', { id: msg.id, device, sim: job.slot, to: msg.number, text: msg.text, parts: msg.parts, sent_at: now });
    toTelegram(() => notifyOutgoing(msg, true), device, job.slot);
  } else {
    failOrRetry(msg, result, now);
  }
}

// The answer to a USSD code: the job keeps the readable text; the answer to the balance code of the
// line is kept as its balance. A check from Telegram (/balance) or an automatic one goes to Telegram.
function ussdResult(job, ok, raw, now) {
  const p = JSON.parse(job.payload || '{}');
  const a = ok ? parseCusd(raw) : { ok: false, error: raw };
  const text = a.ok ? a.text : a.error;
  db.prepare('UPDATE jobs SET status = ?, result = ?, done_at = ? WHERE id = ?').run(a.ok ? 'done' : 'failed', text, now, job.id);
  const balanceCode = lineOf(job.device_id, job.slot).ussd;
  if (a.ok && p.code === balanceCode) {
    db.prepare('UPDATE sims SET balance = ?, balance_at = ? WHERE device_id = ? AND slot = ?').run(text, now, job.device_id, job.slot);
  }
  log(a.ok ? `SIM ${job.slot}: ${p.code} answered: ${oneLine(text, 300)}` : `SIM ${job.slot}: ${p.code} failed: ${text}`,
    { device_id: job.device_id, slot: job.slot, level: a.ok ? 'info' : 'warn' });
  if (p.tg || p.auto) {
    toTelegram(() => notifyBalance({ device: job.device_id, slot: job.slot, ok: a.ok, text, chat: p.tg || null }), job.device_id, job.slot);
  }
}

function failOrRetry(msg, error, now) {
  if (msg.attempts < MAX_ATTEMPTS) {
    db.prepare("UPDATE messages SET status = 'queued', error = ?, not_before = ? WHERE id = ?").run(error, now + 30_000 * msg.attempts, msg.id);
    log(`SMS #${msg.id} to ${msg.number} failed (${error}), will retry`, { level: 'warn', device_id: msg.device_id, slot: msg.slot });
  } else {
    db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(error, msg.id);
    log(`SMS #${msg.id} to ${msg.number} failed: ${error}`, { level: 'error', device_id: msg.device_id, slot: msg.slot });
    emit('sms.failed', { id: msg.id, to: msg.number, text: msg.text, error });
    toTelegram(() => notifyOutgoing(msg, false, error), msg.device_id, msg.slot);
  }
}

const isReady = (s) => s && s.state === 'ready' && (s.reg === 1 || s.reg === 5);

function dispatch(device, free, now) {
  const out = [];
  if (free <= 0) return out;
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE device_id = ? AND status = 'queued' AND type != 'sms' ORDER BY id LIMIT ?")
    .all(device, free);
  for (const j of jobs) {
    db.prepare("UPDATE jobs SET status = 'sent', assigned_at = ? WHERE id = ?").run(now, j.id);
    const p = JSON.parse(j.payload || '{}');
    out.push({
      id: j.id, type: j.type, slot: j.slot || 0, ...(p.cmd ? { cmd: p.cmd } : {}), ...(p.code ? { code: p.code } : {}),
      ...(j.type === 'wifi' ? { op: p.op, ssid: p.ssid, ...(p.op === 'add' ? { pass: p.pass || '' } : {}) } : {}),
    });
  }
  free -= out.length;
  if (free <= 0) return out;

  // a SIM in roaming mode sends nothing: an SMS asked for on it fails at once, unless another
  // gateway can still send it
  const all = allLines();
  const roaming = new Set(SLOTS.filter((s) => guarded(device, s, all)));
  const ready = db.prepare('SELECT * FROM sims WHERE device_id = ?').all(device).filter(isReady).map((s) => s.slot)
    .filter((s) => !roaming.has(s));
  if (!ready.length && !roaming.size) return out;
  const load = new Map(ready.map((s) => [s, 0]));
  for (const r of db
    .prepare("SELECT slot, COUNT(*) n FROM messages WHERE direction = 'out' AND device_id = ? AND created_at > ? GROUP BY slot")
    .all(device, now - 86400_000)) {
    if (load.has(r.slot)) load.set(r.slot, r.n);
  }
  const queued = db
    .prepare(
      `SELECT * FROM messages WHERE direction = 'out' AND status = 'queued' AND (device_id IS NULL OR device_id = ?)
       AND (not_before IS NULL OR not_before <= ?) ORDER BY id LIMIT 20`
    )
    .all(device, now);
  for (const m of queued) {
    if (free <= 0) break;
    let slot = m.want_slot;
    if (slot) {
      if (roaming.has(slot) && roamingBlocks(slot, m.device_id)) {
        const error = roamingError(slot, m.device_id || device);
        db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(error, m.id);
        log(`SMS #${m.id} to ${m.number} not sent: SIM ${slot} is in roaming mode`, { level: 'warn', device_id: device, slot });
        emit('sms.failed', { id: m.id, to: m.number, text: m.text, error });
        toTelegram(() => notifyOutgoing(m, false, error), device, slot);
        continue;
      }
      if (!ready.includes(slot)) continue;
    } else {
      if (!ready.length) continue;
      slot = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
    }
    load.set(slot, load.get(slot) + 1);
    const j = db
      .prepare("INSERT INTO jobs (device_id, type, slot, status, message_id, created_at, assigned_at) VALUES (?, 'sms', ?, 'sent', ?, ?, ?)")
      .run(device, slot, m.id, now, now);
    db.prepare("UPDATE messages SET status = 'sending', device_id = ?, slot = ?, attempts = attempts + 1 WHERE id = ?").run(device, slot, m.id);
    out.push({ id: Number(j.lastInsertRowid), type: 'sms', slot, parts: JSON.parse(m.pdus) });
    free--;
  }
  return out;
}

// ---------- device commands from the panel ----------

const COMMANDS = ['at', 'reboot', 'modem_reset', 'setup', 'ussd', 'wifi'];
export const WIFI_FW = '1.5.0'; // first firmware with a list of saved Wi-Fi networks

// A Wi-Fi password is kept only until the gateway has it: then it is erased from the job.
export function forgetWifiPasswords() {
  db.prepare("UPDATE jobs SET payload = json_remove(payload, '$.pass') WHERE type = 'wifi' AND status NOT IN ('queued', 'sent') AND json_extract(payload, '$.pass') IS NOT NULL").run();
}

// ussd: code (default: the balance code of the line); tg = Telegram chat that asked, auto = scheduled
// wifi: op "add" (ssid, pass) or "remove" (ssid)
export function createJob(device, { type, slot, cmd, code, tg = null, auto = false, op, ssid, pass }) {
  if (!COMMANDS.includes(type)) throw new HttpError(400, 'Unknown command');
  const d = db.prepare('SELECT fw FROM devices WHERE id = ?').get(device);
  if (!d) throw new HttpError(404, 'Device not found');
  slot = SLOTS.includes(Number(slot)) ? Number(slot) : 0;
  if ((type === 'at' || type === 'modem_reset' || type === 'ussd') && !slot) throw new HttpError(400, 'Choose SIM 1 or 2');
  let payload = {};
  if (type === 'at') {
    cmd = String(cmd || '').trim();
    if (!/^AT/i.test(cmd) || cmd.length > 200 || /[\r\n\x1a\x1b]/.test(cmd)) throw new HttpError(400, 'Command must start with AT');
    payload = { cmd };
  }
  if (type === 'ussd') {
    code = String(code || lineOf(device, slot).ussd || '').replace(/\s+/g, '');
    if (!code) throw new HttpError(400, 'Set the balance code of this SIM first (like *123#)');
    if (!USSD_RE.test(code)) throw new HttpError(400, 'A USSD code looks like *123# (digits, * and #, ending in #)');
    if (newer(USSD_FW, d.fw)) throw new HttpError(409, `Balance checks need firmware ${USSD_FW} or newer on the gateway. Update it under Devices.`);
    payload = { code, ...(tg ? { tg: String(tg) } : {}), ...(auto ? { auto: true } : {}) };
  }
  if (type === 'wifi') {
    if (newer(WIFI_FW, d.fw)) throw new HttpError(409, `Saved Wi-Fi networks need firmware ${WIFI_FW} or newer on the gateway. Update it first.`);
    ssid = String(ssid ?? '').trim();
    pass = String(pass ?? '');
    if (!ssid || ssid.length > 32) throw new HttpError(400, 'A Wi-Fi name has 1 to 32 characters');
    if (op === 'add') {
      if (pass.length > 63 || (pass.length && pass.length < 8)) throw new HttpError(400, 'A Wi-Fi password has 8 to 63 characters (empty for an open network)');
      payload = { op, ssid, pass };
    } else if (op === 'remove') {
      payload = { op, ssid };
    } else {
      throw new HttpError(400, 'op is "add" or "remove"');
    }
  }
  const r = db
    .prepare("INSERT INTO jobs (device_id, type, slot, payload, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)")
    .run(device, type, slot, JSON.stringify(payload), Date.now());
  return getJob(Number(r.lastInsertRowid));
}

export function getJob(id) {
  const j = db.prepare('SELECT id, device_id, type, slot, payload, status, result, created_at, assigned_at, done_at FROM jobs WHERE id = ?').get(id);
  if (j?.type === 'wifi') { // never show a Wi-Fi password back
    const p = JSON.parse(j.payload || '{}');
    delete p.pass;
    j.payload = JSON.stringify(p);
  }
  return j || null;
}

// ---------- maintenance (every 30 s) ----------

let lastCleanup = 0;
const DAY = 86400_000;

// What each SIM line does by itself, checked at each check-in of its gateway while the SIM is on the
// network:
// - keep-alive: an SMS to the chosen number when the SIM sent nothing for the chosen number of days
//   (operators switch off prepaid SIMs that are not used; any SMS sent from the SIM counts).
// - balance: the balance code every few days. A failed check waits 6 hours before the next try.
function lineChores(device, fw, now) {
  const all = allLines();
  for (const slot of SLOTS) {
    const l = all[`${device}:${slot}`];
    if (!l || l.off || !(l.keep || (l.bal && l.ussd))) continue;
    const sim = db.prepare('SELECT * FROM sims WHERE device_id = ? AND slot = ?').get(device, slot);
    if (!isReady(sim) || roamingGuard(lineOf(device, slot, all), sim)) continue; // roaming mode: nothing that costs

    if (l.keep && l.keep_to) {
      const lastSent = db.prepare("SELECT MAX(sent_at) t FROM messages WHERE direction = 'out' AND status = 'sent' AND device_id = ? AND slot = ?").get(device, slot).t || 0;
      const waiting = db.prepare("SELECT 1 FROM messages WHERE source = 'keepalive' AND device_id = ? AND want_slot = ? AND status IN ('queued', 'sending')").get(device, slot);
      if (!waiting && now - Math.max(lastSent, sim.keep_at || 0) >= l.keep * DAY) {
        const line = lineOf(device, slot);
        createOutgoing({ to: line.keep_to, text: line.keep_text, sim: slot, source: 'keepalive', device });
        db.prepare('UPDATE sims SET keep_at = ? WHERE device_id = ? AND slot = ?').run(now, device, slot);
        log(`SIM ${slot}: keep-alive SMS to ${line.keep_to} (nothing sent for ${l.keep} days)`, { device_id: device, slot });
      }
    }

    if (l.bal && l.ussd && !newer(USSD_FW, fw)) {
      const busy = db.prepare("SELECT 1 FROM jobs WHERE type = 'ussd' AND device_id = ? AND slot = ? AND status IN ('queued', 'sent')").get(device, slot);
      if (!busy && now - (sim.balance_at || 0) >= l.bal * DAY && now - (sim.balance_try || 0) >= 6 * 3600_000) {
        db.prepare('UPDATE sims SET balance_try = ? WHERE device_id = ? AND slot = ?').run(now, device, slot);
        createJob(device, { type: 'ussd', slot, code: l.ussd, auto: true });
      }
    }
  }
}

export function maintenance(now = Date.now()) {
  tx(() => {
    for (const j of db.prepare("SELECT * FROM jobs WHERE status = 'sent' AND assigned_at < ?").all(now - JOB_TIMEOUT_MS)) {
      db.prepare("UPDATE jobs SET status = 'lost', result = 'No answer from the gateway', done_at = ? WHERE id = ?").run(now, j.id);
      if (j.type === 'sms') {
        const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND status = 'sending'").get(j.message_id);
        if (msg) failOrRetry(msg, 'No answer from the gateway', now);
      }
    }
    db.prepare("UPDATE jobs SET status = 'failed', result = 'Gateway was offline', done_at = ? WHERE status = 'queued' AND created_at < ?").run(now, now - 10 * 60_000);
    forgetWifiPasswords(); // of Wi-Fi jobs that were answered, lost or never picked up
    for (const m of db.prepare("SELECT * FROM messages WHERE direction = 'out' AND status = 'queued' AND created_at < ?").all(now - 86400_000)) {
      db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(m.error || 'Not sent within 24 h (no SIM ready)', m.id);
      emit('sms.failed', { id: m.id, to: m.number, text: m.text, error: 'Not sent within 24 h' });
      toTelegram(() => notifyOutgoing(m, false, 'not sent within 24 h (no SIM was ready)'), null, null);
    }

    // multipart SMS whose other parts never came: deliver what we have after 30 min
    const stale = db
      .prepare('SELECT DISTINCT device_id, slot, number, ref, total FROM sms_parts WHERE message_id IS NULL AND received_at < ?')
      .all(now - 30 * 60_000);
    for (const g of stale) {
      const rows = db
        .prepare('SELECT * FROM sms_parts WHERE device_id = ? AND slot = ? AND number = ? AND ref = ? AND total = ? AND message_id IS NULL ORDER BY seq, id')
        .all(g.device_id, g.slot, g.number, g.ref, g.total);
      if (rows.length) assemble(g.device_id, g.slot, g.number, g.total, rows, new Map(rows.map((r) => [r.seq, r])), null, now);
    }

    for (const d of db.prepare('SELECT * FROM devices WHERE offline = 0 AND last_seen < ?').all(now - 90_000)) {
      db.prepare('UPDATE devices SET offline = 1 WHERE id = ?').run(d.id);
      log(`Gateway offline (last seen ${new Date(d.last_seen).toISOString()})`, { level: 'warn', device_id: d.id });
      emit('device.offline', { device: d.id, name: d.name, last_seen: d.last_seen });
      toTelegram(() => alertDevice({ device: d.id, online: false, lastSeen: d.last_seen, now }), d.id, null);
    }
    toTelegram(() => checkSignalAlerts(now), null, null);
  });

  if (now - lastCleanup > 6 * 3600_000) {
    lastCleanup = now;
    const keep = now - 30 * 86400_000;
    db.prepare('DELETE FROM samples WHERE ts < ?').run(keep);
    db.prepare('DELETE FROM logs WHERE ts < ?').run(keep);
    db.prepare("DELETE FROM jobs WHERE type != 'sms' AND created_at < ?").run(keep);
    db.prepare('DELETE FROM sms_parts WHERE message_id IS NOT NULL AND received_at < ?').run(now - 7 * 86400_000);
  }
}
