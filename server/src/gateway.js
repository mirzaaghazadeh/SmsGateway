// Gateway logic: device sync (status, events, jobs), outgoing SMS queue, maintenance.
import { createHash } from 'node:crypto';
import { db, tx, log, setting } from './db.js';
import { HttpError } from './http.js';
import { encodeSubmit, decodePdu, normalizeNumber } from './pdu.js';
import { analyzeText } from './shared/gsm.js';
import { emit } from './webhook.js';

export const ONLINE_MS = 30_000;
const JOB_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;
const SAMPLE_EVERY_MS = 60_000;
const SLOTS = [1, 2];

export const csqToDbm = (csq) => (csq == null || csq === 99 || csq < 0 ? null : -113 + 2 * Math.min(csq, 31));
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const str = (v, max = 200) => (v == null ? null : String(v).slice(0, max));
const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);

export function callMode() {
  return setting('call_mode', 'reject');
}

// ---------- outgoing SMS ----------

export function createOutgoing({ to, text, sim = 0, source = 'api' }) {
  const n = normalizeNumber(to);
  if (!n) throw new HttpError(400, 'Invalid phone number');
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Text is empty');
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
      `INSERT INTO messages (direction, number, text, status, encoding, parts, pdus, source, want_slot, created_at)
       VALUES ('out', ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`
    )
    .run(n.display, text, info.encoding, parts.length, JSON.stringify(parts), source, slot, Date.now());
  return getMessage(Number(r.lastInsertRowid));
}

export function getMessage(id) {
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  return m ? publicMessage(m) : null;
}

export function publicMessage(m) {
  const { pdus, ukey, not_before, ...rest } = m;
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
      int(wifi.rssi), int(body.heap), int(body.uptime), boot, str(body.reset, 40), now, now
    );

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
        int(s.csq), int(s.reg), int(s.mv), int(s.queue), now
      );
    }

    if (now - (lastSample.get(id) || 0) >= SAMPLE_EVERY_MS) {
      lastSample.set(id, now);
      const by = Object.fromEntries(sims.map((s) => [Number(s.slot), s]));
      db.prepare(
        `INSERT INTO samples (device_id, ts, wifi_rssi, heap, s1_csq, s1_reg, s1_mv, s2_csq, s2_reg, s2_mv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, now, int(wifi.rssi), int(body.heap),
        int(by[1]?.csq), int(by[1]?.reg), int(by[1]?.mv), int(by[2]?.csq), int(by[2]?.reg), int(by[2]?.mv)
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

    const jobs = dispatch(id, Math.min(5, Math.max(0, int(body.free) ?? 2)), now);
    const interval = Math.min(60, Math.max(2, int(setting('sync_interval', 5)) ?? 5));
    return { ack, jobs, config: { calls: callMode(), interval }, time: Math.floor(now / 1000) };
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
      if (r.changes) emit('call.missed', { id: Number(r.lastInsertRowid), device, sim: slot, number, action: ev.action, time: now });
      return;
    }
    case 'job':
    case 'at':
      return jobResult(device, int(ev.job), !!ev.ok, ev);
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
  return id;
}

function jobResult(device, jobId, ok, ev) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND device_id = ?').get(jobId, device);
  if (!job || !['sent', 'lost'].includes(job.status)) return; // unknown or already handled
  const now = Date.now();
  const result = ok ? str(ev.out ?? (Array.isArray(ev.ref) ? 'ref ' + ev.ref.join(',') : ev.ref), 4000) : str(ev.err || ev.out || 'error', 4000);
  db.prepare('UPDATE jobs SET status = ?, result = ?, done_at = ? WHERE id = ?').run(ok ? 'done' : 'failed', result, now, jobId);
  if (job.type !== 'sms') return;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(job.message_id);
  if (!msg || msg.status === 'sent') return;
  if (ok) {
    db.prepare("UPDATE messages SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?").run(now, msg.id);
    emit('sms.sent', { id: msg.id, device, sim: job.slot, to: msg.number, text: msg.text, parts: msg.parts, sent_at: now });
  } else {
    failOrRetry(msg, result, now);
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
    out.push({ id: j.id, type: j.type, slot: j.slot || 0, ...(p.cmd ? { cmd: p.cmd } : {}) });
  }
  free -= out.length;
  if (free <= 0) return out;

  const ready = db.prepare('SELECT * FROM sims WHERE device_id = ?').all(device).filter(isReady).map((s) => s.slot);
  if (!ready.length) return out;
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
      if (!ready.includes(slot)) continue;
    } else {
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

const COMMANDS = ['at', 'reboot', 'modem_reset', 'setup'];

export function createJob(device, { type, slot, cmd }) {
  if (!COMMANDS.includes(type)) throw new HttpError(400, 'Unknown command');
  if (!db.prepare('SELECT 1 FROM devices WHERE id = ?').get(device)) throw new HttpError(404, 'Device not found');
  slot = SLOTS.includes(Number(slot)) ? Number(slot) : 0;
  if ((type === 'at' || type === 'modem_reset') && !slot) throw new HttpError(400, 'Choose SIM 1 or 2');
  let payload = {};
  if (type === 'at') {
    cmd = String(cmd || '').trim();
    if (!/^AT/i.test(cmd) || cmd.length > 200 || /[\r\n\x1a\x1b]/.test(cmd)) throw new HttpError(400, 'Command must start with AT');
    payload = { cmd };
  }
  const r = db
    .prepare("INSERT INTO jobs (device_id, type, slot, payload, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)")
    .run(device, type, slot, JSON.stringify(payload), Date.now());
  return getJob(Number(r.lastInsertRowid));
}

export function getJob(id) {
  return db.prepare('SELECT id, device_id, type, slot, payload, status, result, created_at, assigned_at, done_at FROM jobs WHERE id = ?').get(id) || null;
}

// ---------- maintenance (every 30 s) ----------

let lastCleanup = 0;

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
    for (const m of db.prepare("SELECT * FROM messages WHERE direction = 'out' AND status = 'queued' AND created_at < ?").all(now - 86400_000)) {
      db.prepare("UPDATE messages SET status = 'failed', error = ? WHERE id = ?").run(m.error || 'Not sent within 24 h (no SIM ready)', m.id);
      emit('sms.failed', { id: m.id, to: m.number, text: m.text, error: 'Not sent within 24 h' });
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
    }
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
