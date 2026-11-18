// Telegram bot: the server forwards incoming SMS and missed calls of each line (one SIM slot of one
// gateway) to the Telegram chats chosen for that line. Messages wait in a table until Telegram takes
// them, so a restart or a Telegram outage does not lose them.
import { db, setting, setSetting, log } from './db.js';
import { HttpError } from './http.js';
import { smsMessages, callMessage, parseChatIds, CHAT_RE, statsMessage, deviceAlert, signalAlert, esc, parseList, skipReason } from './tgformat.js';
import { simLabel, allLines, lineOf, roamingGuard } from './lines.js';
import { createOutgoing, createJob } from './gateway.js';
import { oneLine } from './ussd.js';

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
  return [k?.kname || k?.dname || 'SMS Gateway', simLabel(device, slot), sim?.operator].filter(Boolean).join(' · ');
}

const chatsFor = (device, slot) => routes()[`${device}:${slot}`] || [];

// filters: per line "all" or "codes" (only SMS with a one-time code); senders and words to skip
const modes = () => json('telegram_modes', {});
const filterFor = (device, slot) => ({
  mode: modes()[`${device}:${slot}`] || 'all',
  senders: parseList(setting('telegram_skip_senders', '')),
  words: parseList(setting('telegram_skip_words', '')),
});

function gatewayName(device) {
  const k = db.prepare('SELECT k.name kname, d.name dname FROM devices d LEFT JOIN device_keys k ON k.device_id = d.id WHERE d.id = ?').get(device);
  return k?.kname || k?.dname || 'SMS Gateway';
}

// every chat of the lines of a gateway that are on
function deviceChats(device) {
  const all = allLines();
  const r = routes();
  return [...new Set([1, 2].filter((s) => lineOf(device, s, all).enabled).flatMap((s) => r[`${device}:${s}`] || []))];
}

const dbmOf = (csq) => (csq == null || csq === 99 || csq < 0 ? null : -113 + 2 * Math.min(csq, 31));

// ---------- forwarding (called by gateway.js inside its transaction) ----------

// ref: the SMS a notice is about ({device, slot, number}), so a reply to it in Telegram goes back
function enqueue(chats, texts, now, ref = null) {
  const add = db.prepare('INSERT INTO telegram_outbox (chat_id, text, next_at, created_at, ref) VALUES (?, ?, ?, ?, ?)');
  for (const chat of chats) for (const t of texts) add.run(chat, t, now, now, ref ? JSON.stringify(ref) : null);
  setImmediate(() => telegramTick().catch(() => {}));
}

export function forwardSms({ device, slot, from, text, parts, note, smsTime, now = Date.now() }) {
  if (!token() || !enabled('telegram_sms') || !slot) return;
  const chats = chatsFor(device, slot);
  if (!chats.length || skipReason({ from, text, ...filterFor(device, slot) })) return;
  const tz = setting('fw_tz', 'UTC');
  enqueue(chats, smsMessages({ from, text, line: lineLabel(device, slot), parts, note, smsTime, receivedAt: now, tz }), now,
    { device, slot, number: from });
}

// An SMS sent from Telegram (a reply or /send) went out or failed: tell the chat that asked.
export function notifyOutgoing(msg, ok, error = '') {
  if (!msg?.tg_chat || !token()) return;
  enqueue([msg.tg_chat], [ok ? `✅ SMS sent to <b>${esc(msg.number)}</b>` : `❌ SMS to <b>${esc(msg.number)}</b> not sent: ${esc(error)}`], Date.now());
}

// The answer to a balance check: to the chat that asked (/balance), or, for an automatic check, to
// every chat of the line.
export function notifyBalance({ device, slot, ok, text, chat = null, now = Date.now() }) {
  if (!token()) return;
  const chats = chat ? [chat] : chatsFor(device, slot);
  const label = `${esc(simLabel(device, slot))} · ${esc(gatewayName(device))}`;
  const body = ok ? `💰 <b>Balance</b> · ${label}\n${esc(text)}` : `❌ <b>Balance check failed</b> · ${label}\n${esc(text)}`;
  if (chats.length) enqueue(chats, [body], now);
}

export function forwardCall({ device, slot, number, now = Date.now() }) {
  if (!token() || !enabled('telegram_calls') || !slot) return;
  const chats = chatsFor(device, slot);
  if (!chats.length || skipReason({ from: number, senders: filterFor(device, slot).senders })) return;
  enqueue(chats, [callMessage({ number, line: lineLabel(device, slot) })], now);
}

// ---------- alerts ----------

const alertMinutes = () => Math.min(120, Math.max(0, Math.round(Number(setting('telegram_alert_minutes', '3'))) || 0));

// The gateway went offline (no check-in for 90 s) or came back.
export function alertDevice({ device, online, lastSeen, offlineFor, now = Date.now() }) {
  if (!token() || !enabled('telegram_alert_device')) return;
  const chats = deviceChats(device);
  if (chats.length) enqueue(chats, [deviceAlert({ name: gatewayName(device), online, lastSeen, offlineFor, now })], now);
}

// A SIM that was ready and lost the network: an alert once it stays that way for the set minutes,
// and another one when it is back. Brief drops send nothing.
const watch = new Map(); // "<device>:<slot>" -> { since, state, alerted }

export function lineState({ device, slot, prev, state, operator, csq, now = Date.now() }) {
  const key = `${device}:${slot}`;
  const w = watch.get(key);
  if (state === 'ready') {
    watch.delete(key);
    if (w?.alerted) signalNotice(device, slot, { lost: false, operator, dbm: dbmOf(csq) }, now);
    return;
  }
  if (state === 'off' || !lineOf(device, slot).enabled) {
    watch.delete(key);
    return;
  }
  if (w) w.state = state;
  else if (prev === 'ready') watch.set(key, { since: now, state, alerted: false });
}

export function checkSignalAlerts(now = Date.now()) {
  const wait = alertMinutes() * 60_000;
  for (const [key, w] of watch) {
    if (w.alerted || now - w.since < wait) continue;
    const [device, slot] = key.split(':');
    const d = db.prepare('SELECT last_seen FROM devices WHERE id = ?').get(device);
    if (!d || now - d.last_seen > 90_000) continue; // the gateway itself is offline: that alert says it
    w.alerted = true;
    signalNotice(device, Number(slot), { lost: true, state: w.state, minutes: Math.round((now - w.since) / 60_000) }, now);
  }
}

function signalNotice(device, slot, info, now) {
  if (!token() || !enabled('telegram_alert_signal')) return;
  const chats = chatsFor(device, slot);
  if (chats.length) enqueue(chats, [signalAlert({ label: simLabel(device, slot), gateway: gatewayName(device), ...info })], now);
}

// ---------- commands: /stats ----------

const POLL_S = Number(process.env.TELEGRAM_POLL_SECONDS || 25);
const HELP = 'This bot sends the SMS and missed calls of your SMS gateway here.\n\n'
  + '/stats: the gateways, their SIM cards, signal and the last 24 hours\n'
  + '/balance: the balance of the SIM cards that send their messages here\n'
  + '/send +15551234567 text: send an SMS (/send 2 +15551234567 text: from SIM 2)\n'
  + 'Reply to a forwarded SMS: your reply goes to the sender, from the same SIM.';
const SEND_USAGE = 'Send like this: <code>/send +15551234567 Your text</code>\n'
  + 'From SIM 2: <code>/send 2 +15551234567 Your text</code>';
let polling = false;
let pollError = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function statsData(now) {
  const all = allLines();
  const sims = db.prepare('SELECT * FROM sims').all();
  const gateways = db
    .prepare('SELECT d.*, k.name kname FROM devices d JOIN device_keys k ON k.device_id = d.id ORDER BY k.added_at')
    .all()
    .map((d) => ({
      name: d.kname || d.name || 'SMS Gateway', online: now - d.last_seen < 30_000, lastSeen: d.last_seen,
      fw: d.fw, ssid: d.ssid, rssi: d.wifi_rssi, uptime: d.uptime,
      sims: [1, 2].filter((slot) => lineOf(d.id, slot, all).enabled).map((slot) => {
        const s = sims.find((x) => x.device_id === d.id && x.slot === slot);
        return {
          label: simLabel(d.id, slot), operator: s?.operator, state: s?.state, dbm: dbmOf(s?.csq), mv: s?.mv,
          balance: s?.balance ? oneLine(s.balance, 120) : null, balanceAt: s?.balance_at,
          roaming: roamingGuard(lineOf(d.id, slot, all), s),
        };
      }),
    }));
  const since = now - 86400_000;
  const c = db.prepare(
    `SELECT SUM(direction = 'in') received, SUM(direction = 'out' AND status = 'sent') sent,
            SUM(direction = 'out' AND status = 'failed') failed FROM messages WHERE created_at > ?`
  ).get(since);
  return {
    gateways, now,
    counts: {
      received: c.received || 0, sent: c.sent || 0, failed: c.failed || 0,
      calls: db.prepare('SELECT COUNT(*) n FROM calls WHERE ts > ?').get(since).n,
      pending: db.prepare("SELECT COUNT(*) n FROM messages WHERE direction = 'out' AND status IN ('queued', 'sending')").get().n,
    },
  };
}

function rememberChat(c) {
  const id = String(c.id);
  const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || id;
  const list = json('telegram_seen', []).filter((x) => x.id !== id);
  list.unshift({ id, name, type: c.type, username: c.username || null });
  setSetting('telegram_seen', JSON.stringify(list.slice(0, 30)));
}

async function handleUpdate(tok, u) {
  const msg = u.message || u.channel_post;
  const chat = (msg || u.my_chat_member)?.chat;
  if (!chat) return;
  rememberChat(chat);
  const text = String(msg?.text || '').trim();
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@\w+$/, '');
  const isCmd = cmd.startsWith('/');
  if (!text || (!isCmd && !msg.reply_to_message)) return;
  if (msg.date && Date.now() / 1000 - msg.date > 600) return; // sent while the server was down: too old to answer
  const id = String(chat.id);
  const known = new Set(Object.values(routes()).flat());
  // only chats the owner added to a SIM line get answers; others learn their chat ID
  if (!known.has(id) && !(chat.username && known.has(`@${chat.username}`))) {
    return send(tok, id, `This chat is not set up on the gateway. Its chat ID is <code>${id}</code>: add it in the panel under Settings → Telegram.`);
  }
  if (!isCmd) { // a reply: to the sender of the SMS it answers, from the same SIM
    const ref = db.prepare('SELECT * FROM telegram_sent WHERE chat_id = ? AND message_id = ?').get(id, msg.reply_to_message.message_id);
    if (!ref) return send(tok, id, `Reply to a forwarded SMS to answer it.\n${SEND_USAGE}`);
    return queueSms(tok, id, { to: ref.number, text, sim: ref.slot, device: ref.device_id });
  }
  if (cmd === '/stats' || cmd === '/status') return send(tok, id, statsMessage(statsData(Date.now())));
  if (cmd === '/balance') return checkBalances(tok, id, chat);
  if (cmd === '/send') {
    const m = /^\/send(?:@\w+)?\s+(?:([12])\s+)?(\+?\d[\d-]{4,19})\s+([\s\S]+)$/i.exec(text);
    if (!m) return send(tok, id, SEND_USAGE);
    return queueSms(tok, id, { to: m[2], text: m[3].trim(), sim: m[1] ? Number(m[1]) : 0 });
  }
  return send(tok, id, HELP);
}

// /balance: the balance code of every line this chat gets messages from; the answers come one by
// one (notifyBalance), as each SIM hears back from its network.
function checkBalances(tok, id, chat) {
  const all = allLines();
  const mine = Object.entries(routes())
    .filter(([, chats]) => chats.includes(id) || (chat.username && chats.includes(`@${chat.username}`)))
    .map(([key]) => key.split(':'))
    .filter(([device, slot]) => lineOf(device, Number(slot), all).enabled);
  const asked = [];
  const problems = [];
  for (const [device, s] of mine) {
    const slot = Number(s);
    const line = lineOf(device, slot, all);
    const label = esc(simLabel(device, slot));
    if (!line.ussd) {
      problems.push(`${label}: no balance code set (Devices → SIM cards in the panel)`);
      continue;
    }
    try {
      createJob(device, { type: 'ussd', slot, tg: id });
      asked.push(label);
    } catch (e) {
      problems.push(`${label}: ${esc(e.message)}`);
    }
  }
  const lines = [];
  if (asked.length) lines.push(`⏳ Checking the balance of ${asked.join(', ')}…`);
  lines.push(...problems);
  return send(tok, id, lines.join('\n') || 'No SIM card sends its messages to this chat.');
}

// Queue an SMS asked for in Telegram; the chat hears when it is sent or failed (notifyOutgoing).
function queueSms(tok, chat, { to, text, sim = 0, device = null }) {
  if (!enabled('telegram_send')) return send(tok, chat, 'Sending SMS from Telegram is turned off in the panel (Settings → Telegram).');
  try {
    const m = createOutgoing({ to, text, sim, source: 'telegram', tgChat: chat, device });
    const from = sim ? ` from ${esc(device ? simLabel(device, sim) : `SIM ${sim}`)}` : '';
    return send(tok, chat, `📤 Sending to <b>${esc(m.number)}</b>${from}…`);
  } catch (e) {
    const why = /phone number/i.test(e.message) ? `${esc(to)} cannot get an SMS (not a phone number)` : esc(e.message);
    return send(tok, chat, `❌ Not sent: ${why}`);
  }
}

// Reads what people send to the bot (long polling: works without a public address or webhook).
export function startTelegramPolling() {
  if (polling) return;
  polling = true;
  (async () => {
    let backoff = 0;
    while (polling) {
      const tok = token();
      if (!tok) {
        await sleep(2000);
        continue;
      }
      const offset = Number(setting('telegram_offset', '0')) || 0;
      const r = await callApi(tok, 'getUpdates',
        { offset, timeout: POLL_S, allowed_updates: ['message', 'channel_post', 'my_chat_member'] }, (POLL_S + 10) * 1000);
      if (tok !== token()) continue; // the token changed meanwhile
      if (!r.ok) {
        pollError = r.status === 409
          ? 'Another program reads this bot (a webhook or a second server), so /stats and Find chats do not work here.'
          : r.description;
        backoff = Math.min(60_000, backoff ? backoff * 2 : 5_000);
        await sleep(backoff);
        continue;
      }
      pollError = null;
      backoff = 0;
      let next = offset;
      for (const u of r.result || []) {
        next = Math.max(next, u.update_id + 1);
        try {
          await handleUpdate(tok, u);
        } catch (e) {
          console.error('telegram update', e);
        }
      }
      if (next !== offset) setSetting('telegram_offset', String(next));
    }
  })();
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
      db.prepare('DELETE FROM telegram_sent WHERE created_at < ?').run(now - 30 * 86400_000);
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
  if (r.ok) {
    if (row.ref && r.result?.message_id) { // remember it, so a reply to this message answers the SMS
      const ref = JSON.parse(row.ref);
      db.prepare('INSERT OR REPLACE INTO telegram_sent (chat_id, message_id, device_id, slot, number, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.chat_id, r.result.message_id, ref.device, ref.slot, ref.number, now);
    }
    return db.prepare('DELETE FROM telegram_outbox WHERE id = ?').run(row.id);
  }

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
  db.prepare('DELETE FROM telegram_sent WHERE chat_id = ?').run(from); // message IDs start again in the new group
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
    send: enabled('telegram_send'),
    lines: lines.map((l) => ({ ...l, chats: r[`${l.device}:${l.slot}`] || [], mode: modes()[`${l.device}:${l.slot}`] || 'all' })),
    skip_senders: setting('telegram_skip_senders', ''),
    skip_words: setting('telegram_skip_words', ''),
    waiting: db.prepare('SELECT COUNT(*) n FROM telegram_outbox').get().n,
    alert_device: enabled('telegram_alert_device'),
    alert_signal: enabled('telegram_alert_signal'),
    alert_minutes: alertMinutes(),
    problem: tok ? pollError : null,
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
      if (t !== token()) { // another bot: start reading its messages from the beginning
        setSetting('telegram_offset', '0');
        setSetting('telegram_seen', '[]');
      }
      setSetting('telegram_token', t);
      setSetting('telegram_bot', JSON.stringify({ id: me.result.id, username: me.result.username, name: me.result.first_name }));
      // the command menu in Telegram
      await callApi(t, 'setMyCommands', { commands: [
        { command: 'stats', description: 'Gateways, SIM cards, signal and the last 24 hours' },
        { command: 'balance', description: 'Balance of the SIM cards' },
        { command: 'send', description: 'Send an SMS: /send +number text' },
        { command: 'help', description: 'What this bot does' },
      ] });
      log(`Telegram bot @${me.result.username} connected`);
    }
  }
  if (b.sms !== undefined) setSetting('telegram_sms', b.sms ? 'on' : 'off');
  if (b.calls !== undefined) setSetting('telegram_calls', b.calls ? 'on' : 'off');
  if (b.send !== undefined) setSetting('telegram_send', b.send ? 'on' : 'off');
  if (b.alert_device !== undefined) setSetting('telegram_alert_device', b.alert_device ? 'on' : 'off');
  if (b.alert_signal !== undefined) setSetting('telegram_alert_signal', b.alert_signal ? 'on' : 'off');
  if (b.alert_minutes !== undefined) {
    const m = Number(b.alert_minutes);
    if (!Number.isInteger(m) || m < 0 || m > 120) throw new HttpError(400, 'Minutes go from 0 to 120');
    setSetting('telegram_alert_minutes', m);
  }
  if (b.routes !== undefined) setSetting('telegram_routes', JSON.stringify(cleanRoutes(b.routes)));
  if (b.modes !== undefined) {
    if (!b.modes || typeof b.modes !== 'object' || Array.isArray(b.modes)) throw new HttpError(400, 'modes must be an object');
    const out = {};
    for (const [line, mode] of Object.entries(b.modes)) {
      if (!LINE_RE.test(line)) throw new HttpError(400, `Unknown line ${line}`);
      if (mode !== 'all' && mode !== 'codes') throw new HttpError(400, 'A line forwards "all" SMS or only "codes"');
      if (mode === 'codes') out[line] = mode;
    }
    setSetting('telegram_modes', JSON.stringify(out));
  }
  for (const k of ['skip_senders', 'skip_words']) {
    if (b[k] === undefined) continue;
    const v = parseList(b[k]).join(', ');
    if (v.length > 2000) throw new HttpError(400, 'The list is too long');
    setSetting(`telegram_${k}`, v);
  }
}

function needToken() {
  const tok = token();
  if (!tok) throw new HttpError(409, 'Add a bot token first');
  return tok;
}

// Chats that wrote to the bot, newest first (the reader of the bot's messages notes them), to find
// their IDs.
export async function recentChats() {
  needToken();
  if (pollError) throw new HttpError(409, pollError);
  return { chats: json('telegram_seen', []) };
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
