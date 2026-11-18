// USSD answers (balance checks and the like). Firmware 1.3.0 sends the raw line from the SIM800L:
//   +CUSD: 0,"Your balance is 12.50 TL",15
// The text can run over several lines. With a UCS-2 answer (Persian, Turkish, Russian: dcs 72) the
// SIM800L gives the text as hex, which is decoded here.

export const USSD_RE = /^[*#][0-9*#]{1,28}#$/; // *123#, *100*1#, #123#

const STATUS = {
  0: null, // done
  1: null, // the network shows a menu (the gateway closes it)
  2: 'the network ended the session',
  3: 'another program is using USSD',
  4: 'this code is not supported by the network',
  5: 'the network did not answer in time',
};

function ucs2Hex(hex) {
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return s;
}

// -> { ok, text, status, error }
export function parseCusd(raw) {
  const m = /\+CUSD:\s*(\d)(?:\s*,\s*"([\s\S]*)"(?:\s*,\s*(\d+))?)?/.exec(String(raw ?? ''));
  if (!m) return { ok: false, text: '', status: null, error: 'no USSD answer' };
  const status = Number(m[1]);
  let text = m[2] ?? '';
  const dcs = m[3] == null ? 15 : Number(m[3]);
  const ucs2 = (dcs & 0xcc) === 0x48 || dcs === 0x11; // 72 and its variants, or UCS-2 with a language
  if (/^(?:[0-9A-F]{4})+$/i.test(text)) {
    const decoded = ucs2Hex(text);
    // digits are hex too ("12345678"): without the UCS-2 flag, decode only if it gives readable text
    const readable = /^[\n -ɏЀ-ӿ؀-ۿ‌‏]+$/.test(decoded);
    if (ucs2 || (text.length >= 8 && readable)) text = decoded;
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
  const error = STATUS[status] ?? (status > 5 ? `unknown answer ${status}` : null);
  return { ok: !error && !!text, text, status, error: error || (text ? null : 'empty answer') };
}

// One line for lists and Telegram: "Balance 12.50 TL · valid until 01.12.2026"
export const oneLine = (text, max = 160) => {
  const s = String(text ?? '').replace(/\s*\n+\s*/g, ' · ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
