// Telegram message text: HTML escaping, the layout of SMS and call notices, and splitting text that
// is longer than one Telegram message. No database here, so the tests can load it directly.
import { findCode } from './shared/otp.js';

export { findCode };

// Telegram allows 4096 characters per message; leave room for the header and the part counter.
export const CHUNK = 3500;

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Split text into pieces of at most `max` UTF-16 units, at a line break or space when there is one
// near the end of the piece. Never cuts an emoji (surrogate pair) in half.
export function splitText(text, max = CHUNK) {
  text = String(text ?? '');
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = max;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--; // keep the pair together
    const window = rest.slice(0, cut);
    const nl = window.lastIndexOf('\n');
    const sp = window.lastIndexOf(' ');
    const at = nl > max * 0.6 ? nl + 1 : sp > max * 0.6 ? sp + 1 : cut;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest.length) out.push(rest);
  return out;
}

function when(ts, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}

// One or more Telegram messages for an incoming SMS. A long SMS arrives here already joined from its
// parts; only text longer than one Telegram message is split again, each piece numbered.
export function smsMessages({ from, text, line, parts = 1, note = null, smsTime = null, receivedAt = Date.now(), tz = 'UTC' }) {
  const pieces = splitText(text);
  // the operator's timestamp, only when the SMS came more than 5 minutes after it was sent
  const late = smsTime && receivedAt - smsTime > 5 * 60_000 ? `Sent ${when(smsTime, tz)}` : null;
  const info = [line, parts > 1 ? `${parts} SMS joined` : null, late].filter(Boolean).join(' · ');
  const code = findCode(text); // shown on its own line: <code> copies with one tap in Telegram
  return pieces.map((piece, i) => {
    const counter = pieces.length > 1 ? ` (${i + 1}/${pieces.length})` : '';
    const head = `📩 <b>${esc(from)}</b>${counter}\n<i>${esc(info)}</i>${i === 0 && code ? `\n🔑 <code>${code}</code>` : ''}`;
    const tail = i === pieces.length - 1 && note ? `\n\n⚠️ ${esc(note)}` : '';
    return `${head}\n\n${esc(piece)}${tail}`;
  });
}

export function callMessage({ number, line }) {
  return `📞 Missed call from <b>${esc(number)}</b>\n<i>${esc(line)}</i>`;
}

// ---------- /stats and alerts ----------

export const STATE_TEXT = {
  ready: 'ready', searching: 'searching for the network', starting: 'starting', no_sim: 'no SIM card',
  sim_locked: 'SIM PIN is on', denied: 'refused by the network', no_answer: 'the SIM800L is not answering',
  low_power: 'supply voltage too low', off: 'off',
};

export function quality(dbm) {
  if (dbm == null) return '';
  return dbm >= -73 ? 'excellent' : dbm >= -85 ? 'good' : dbm >= -99 ? 'fair' : 'weak';
}

export function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

// gateways: [{ name, online, lastSeen, fw, ssid, rssi, uptime, sims: [{ label, operator, state, dbm, mv, balance, balanceAt }] }]
export function statsMessage({ gateways, counts, now = Date.now() }) {
  const out = ['📊 <b>SMS gateway status</b>'];
  if (!gateways.length) out.push('', 'No gateway has checked in yet.');
  for (const g of gateways) {
    const state = g.online ? '🟢 online' : `🔴 offline for ${duration(now - g.lastSeen)}`;
    out.push('', `<b>${esc(g.name)}</b> · ${state}${g.fw ? ` · firmware ${esc(g.fw)}` : ''}`);
    const wifi = [g.ssid ? `Wi-Fi ${esc(g.ssid)}${g.rssi != null ? ` ${g.rssi} dBm` : ''}` : null,
      g.uptime ? `up ${duration(g.uptime * 1000)}` : null].filter(Boolean).join(' · ');
    if (wifi) out.push(wifi);
    for (const s of g.sims) {
      const parts = [s.operator ? esc(s.operator) : null, STATE_TEXT[s.state] || esc(s.state || 'not reported'),
        s.dbm != null ? `${s.dbm} dBm (${quality(s.dbm)})` : null, s.mv ? `${(s.mv / 1000).toFixed(2)} V` : null];
      out.push(`• ${esc(s.label)}: ${parts.filter(Boolean).join(', ')}`);
      if (s.balance) out.push(`   💰 ${esc(s.balance)}${s.balanceAt ? ` (${duration(now - s.balanceAt)} ago)` : ''}`);
    }
  }
  const c = counts;
  out.push('', `<b>Last 24 h</b>: ${c.received} received · ${c.sent} sent · ${c.failed} failed · ${c.calls} missed calls`
    + (c.pending ? ` · ${c.pending} waiting to send` : ''));
  return out.join('\n');
}

export function deviceAlert({ name, online, lastSeen, offlineFor, now = Date.now() }) {
  return online
    ? `🟢 <b>${esc(name)}</b> is back online\nIt was offline for ${duration(offlineFor)}.`
    : `🔴 <b>${esc(name)}</b> is offline\nNo check-in for ${duration(now - lastSeen)}. Check its power and Wi-Fi.`;
}

export function signalAlert({ label, gateway, lost, state, minutes, operator, dbm }) {
  return lost
    ? `📵 <b>${esc(label)}</b> has no network\n${esc(STATE_TEXT[state] || state)}, for ${minutes} min · ${esc(gateway)}`
    : `📶 <b>${esc(label)}</b> is back on the network\n${[operator ? esc(operator) : null, dbm != null ? `${dbm} dBm` : null].filter(Boolean).join(', ') || 'ready'} · ${esc(gateway)}`;
}

// Chat IDs as typed in the panel: "123, -100456 @mychannel" -> ['123', '-100456', '@mychannel'].
export const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
export function parseChatIds(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/);
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
}

// ---------- filters: what not to forward ----------

// "Promo, +1 555 000 1111\nAd" -> ['Promo', '+1 555 000 1111', 'Ad']
export const parseList = (v) =>
  [...new Set(String(v ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 100);

const squash = (s) => String(s).toLowerCase().replace(/[\s().-]/g, '');

// The same sender, written either way: "MyBank" = "mybank", "+15551234567" = "15551234567",
// "+447700900123" = "07700900123" (a local number matches the end of the international one).
export function sameSender(a, b) {
  const x = squash(a).replace(/^\+/, '');
  const y = squash(b).replace(/^\+/, '');
  if (x === y) return !!x;
  if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) return false;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  const tail = short.replace(/^0+/, '');
  return tail.length >= 7 && long.endsWith(tail);
}

// Why an SMS or a call is not forwarded, or null to forward it.
export function skipReason({ from, text = null, mode = 'all', senders = [], words = [] }) {
  if (senders.some((s) => sameSender(s, from))) return 'sender';
  if (text == null) return null; // a call
  const t = text.toLowerCase();
  if (words.some((w) => t.includes(w.toLowerCase()))) return 'word';
  if (mode === 'codes' && !findCode(text)) return 'no code';
  return null;
}
