// Telegram message text: HTML escaping, the layout of SMS and call notices, and splitting text that
// is longer than one Telegram message. No database here, so the tests can load it directly.

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
  return pieces.map((piece, i) => {
    const counter = pieces.length > 1 ? ` (${i + 1}/${pieces.length})` : '';
    const head = `📩 <b>${esc(from)}</b>${counter}\n<i>${esc(info)}</i>`;
    const tail = i === pieces.length - 1 && note ? `\n\n⚠️ ${esc(note)}` : '';
    return `${head}\n\n${esc(piece)}${tail}`;
  });
}

export function callMessage({ number, line }) {
  return `📞 Missed call from <b>${esc(number)}</b>\n<i>${esc(line)}</i>`;
}

// Chat IDs as typed in the panel: "123, -100456 @mychannel" -> ['123', '-100456', '@mychannel'].
export const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
export function parseChatIds(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/);
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
}
