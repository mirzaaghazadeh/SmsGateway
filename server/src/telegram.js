// Telegram bot: the server forwards incoming SMS and missed calls of each line (one SIM slot of one
// gateway) to the Telegram chats chosen for that line. Messages wait in a table until Telegram takes
// them, so a restart or a Telegram outage does not lose them.
import { db, setting, setSetting, log } from './db.js';
import { HttpError } from './http.js';
import { smsMessages, callMessage, parseChatIds, CHAT_RE } from './tgformat.js';

const API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
const LINE_RE = /^[A-Za-z0-9_-]{4,32}:[12]$/;
const MAX_CHATS = 10;
const RETRY_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];
const KEEP_MS = 24 * 3600_000;

const json = (key, fallback) => {
  try {
    return JSON.parse(setting(key, '')) ?? fallback;
  } catch {
    return fallback;
  }
};

const token = () => setting('telegram_token');
const routes = () => json('telegram_routes', {});
const enabled = (key) => setting(key, 'on') !== 'off';

// ---------- Telegram Bot API ----------

async function callApi(tok, method, body, timeout = 15_000) {
  let r;
  try {
    r = await fetch(`${API}/bot${tok}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    return { ok: false, network: true, description: e.name === 'TimeoutError' ? 'Telegram did not answer' : `Cannot reach Telegram (${e.message})` };
  }
  const data = await r.json().catch(() => ({}));
  if (data.ok) return data;
  return { ok: false, status: r.status, description: data.description || `HTTP ${r.status}`, parameters: data.parameters || {} };
}

const send = (tok, chat, text) =>
  callApi(tok, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });

// ---------- lines ----------

function lineLabel(device, slot) {
  const k = db.prepare('SELECT k.name kname, d.name dname FROM devices d LEFT JOIN device_keys k ON k.device_id = d.id WHERE d.id = ?').get(device);
  const sim = db.prepare('SELECT operator FROM sims WHERE device_id = ? AND slot = ?').get(device, slot);
  return [k?.kname || k?.dname || 'SMS Gateway', `SIM ${slot}`, sim?.operator].filter(Boolean).join(' · ');
}

const chatsFor = (device, slot) => routes()[`${device}:${slot}`] || [];

// ---------- forwarding (called by gateway.js inside its transaction) ----------

function enqueue(chats, texts, now) {
  const add = db.prepare('INSERT INTO telegram_outbox (chat_id, text, next_at, created_at) VALUES (?, ?, ?, ?)');
  for (const chat of chats) for (const t of texts) add.run(chat, t, now, now);
  setImmediate(() => telegramTick().catch(() => {}));
}

export function forwardSms({ device, slot, from, text, parts, note, smsTime, now = Date.now() }) {
  if (!token() || !enabled('telegram_sms') || !slot) return;
  const chats = chatsFor(device, slot);
  if (!chats.length) return;
  const tz = setting('fw_tz', 'UTC');
  enqueue(chats, smsMessages({ from, text, line: lineLabel(device, slot), parts, note, smsTime, receivedAt: now, tz }), now);
}

export function forwardCall({ device, slot, number, now = Date.now() }) {
  if (!token() || !enabled('telegram_calls') || !slot) return;
  const chats = chatsFor(device, slot);
  if (chats.length) enqueue(chats, [callMessage({ number, line: lineLabel(device, slot) })], now);
}

// ---------- delivery ----------

let draining = false;
const warned = new Map(); // chat -> last time a "cannot send" warning was logged

function warnOnce(chat, text, now) {
  if (now - (warned.get(chat) || 0) < 3600_000) return;
  warned.set(chat, now);
  log(text, { level: 'warn' });
}

// Send what is due, oldest first, one chat after another in order. Called after new messages are
// queued and every few seconds by the server.
export async function telegramTick() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const tok = token();
      const now = Date.now();
      if (!tok) {
        db.prepare('DELETE FROM telegram_outbox').run();
        return;
      }
      db.prepare('DELETE FROM telegram_outbox WHERE created_at < ?').run(now - KEEP_MS);
      const heads = db
        .prepare(
          `SELECT o.* FROM telegram_outbox o
           JOIN (SELECT chat_id, MIN(id) id FROM telegram_outbox GROUP BY chat_id) f ON f.id = o.id
           WHERE o.next_at <= ? ORDER BY o.id LIMIT 20`
        )
        .all(now);
      if (!heads.length) return;
      for (const row of heads) await deliver(tok, row);
    }
  } finally {
    draining = false;
  }
}

async function deliver(tok, row) {
  const r = await send(tok, row.chat_id, row.text);
  const now = Date.now();
  if (r.ok) return db.prepare('DELETE FROM telegram_outbox WHERE id = ?').run(row.id);

  const p = r.parameters || {};
  if (p.migrate_to_chat_id) { // a group became a supergroup: it has a new ID
    moveChat(row.chat_id, String(p.migrate_to_chat_id));
    return;
  }
  if (r.status === 429) {
    db.prepare('UPDATE telegram_outbox SET next_at = ? WHERE id = ?').run(now + (Number(p.retry_after) || 5) * 1000, row.id);
    return;
  }
  const lasting = r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404;
  if (!lasting && row.attempts < RETRY_MS.length) {
    db.prepare('UPDATE telegram_outbox SET attempts = attempts + 1, next_at = ? WHERE id = ?').run(now + RETRY_MS[row.attempts], row.id);
    return;
  }
  // this chat cannot get messages: drop what waits for it
  db.prepare('DELETE FROM telegram_outbox WHERE chat_id = ?').run(row.chat_id);
  warnOnce(row.chat_id, `Telegram: could not send to chat ${row.chat_id}: ${r.description}`, now);
}

function moveChat(from, to) {
  const all = routes();
  for (const k of Object.keys(all)) all[k] = [...new Set(all[k].map((c) => (c === from ? to : c)))];
  setSetting('telegram_routes', JSON.stringify(all));
  db.prepare('UPDATE telegram_outbox SET chat_id = ? WHERE chat_id = ?').run(to, from);
  log(`Telegram: group ${from} became supergroup ${to}; the chat ID was updated`);
}

// ---------- panel ----------

export function telegramView(lines) {
  const tok = token();
  const r = routes();
  return {
    token_set: !!tok,
    token_hint: tok ? tok.slice(-4) : null,
    bot: json('telegram_bot', null),
    sms: enabled('telegram_sms'),
    calls: enabled('telegram_calls'),
    lines: lines.map((l) => ({ ...l, chats: r[`${l.device}:${l.slot}`] || [] })),
    waiting: db.prepare('SELECT COUNT(*) n FROM telegram_outbox').get().n,
  };
}

function cleanRoutes(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'routes must be an object');
  const out = {};
  for (const [line, value] of Object.entries(input)) {
    if (!LINE_RE.test(line)) throw new HttpError(400, `Unknown line ${line}`);
    const chats = parseChatIds(value);
    const bad = chats.find((c) => !CHAT_RE.test(c));
    if (bad) throw new HttpError(400, `"${bad}" is not a chat ID. Chat IDs are numbers like 123456789 or -1001234567890.`);
    if (chats.length > MAX_CHATS) throw new HttpError(400, `At most ${MAX_CHATS} chats per line`);
    if (chats.length) out[line] = chats;
  }
  return out;
}

export async function setTelegram(b) {
  if (b.token !== undefined) {
    const t = String(b.token ?? '').trim();
    if (!t) {
      setSetting('telegram_token', '');
      setSetting('telegram_bot', '');
      log('Telegram bot removed');
    } else {
      if (!TOKEN_RE.test(t)) throw new HttpError(400, 'This does not look like a bot token. It looks like 123456789:AAE… and comes from @BotFather.');
      const me = await callApi(t, 'getMe');
      if (!me.ok) throw new HttpError(400, me.network ? me.description : `Telegram did not accept the token: ${me.description}`);
      setSetting('telegram_token', t);
      setSetting('telegram_bot', JSON.stringify({ id: me.result.id, username: me.result.username, name: me.result.first_name }));
      log(`Telegram bot @${me.result.username} connected`);
    }
  }
  if (b.sms !== undefined) setSetting('telegram_sms', b.sms ? 'on' : 'off');
  if (b.calls !== undefined) setSetting('telegram_calls', b.calls ? 'on' : 'off');
  if (b.routes !== undefined) setSetting('telegram_routes', JSON.stringify(cleanRoutes(b.routes)));
}

function needToken() {
  const tok = token();
  if (!tok) throw new HttpError(409, 'Add a bot token first');
  return tok;
}

// Chats that wrote to the bot recently (Telegram keeps them for 24 hours), to find their IDs.
export async function recentChats() {
  const r = await callApi(needToken(), 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
  if (!r.ok) {
    if (r.status === 409) throw new HttpError(409, 'This bot is connected to another program (a webhook), so the server cannot read its chats. Find the chat ID another way.');
    throw new HttpError(502, `Telegram: ${r.description}`);
  }
  const chats = new Map();
  for (const u of r.result || []) {
    const c = (u.message || u.channel_post || u.my_chat_member)?.chat;
    if (!c) continue;
    const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id);
    chats.set(String(c.id), { id: String(c.id), name, type: c.type, username: c.username || null });
  }
  return { chats: [...chats.values()].reverse() };
}

export async function testChats(value, label = 'test') {
  const tok = needToken();
  const chats = parseChatIds(value);
  if (!chats.length) throw new HttpError(400, 'Enter at least one chat ID');
  const bad = chats.find((c) => !CHAT_RE.test(c));
  if (bad) throw new HttpError(400, `"${bad}" is not a chat ID`);
  const text = `✅ Test from your SMS gateway\n<i>${label.replace(/[<>&]/g, '')}</i>\n\nMessages for this line will arrive here.`;
  const results = [];
  for (const chat of chats.slice(0, MAX_CHATS)) {
    const r = await send(tok, chat, text);
    results.push({ chat, ok: !!r.ok, error: r.ok ? null : r.description });
  }
  return { results };
}

export { lineLabel };
