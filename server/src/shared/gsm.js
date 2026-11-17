// GSM 03.38 text helpers. Used by the server (PDU encoding) and by the web panel (character counter).

// Default 7-bit alphabet, index = septet value. 0x1B is the escape to the extension table.
export const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅå' +
  'Δ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ' +
  ' !"#¤%&\'()*+,-./' +
  '0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNO' +
  'PQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmno' +
  'pqrstuvwxyzäöñüà';

// Extension table: ESC + septet.
export const GSM7_EXT = { 0x0a: '\f', 0x14: '^', 0x28: '{', 0x29: '}', 0x2f: '\\', 0x3c: '[', 0x3d: '~', 0x3e: ']', 0x40: '|', 0x65: '€' };

const toSeptet = new Map();
for (let i = 0; i < GSM7.length; i++) if (i !== 0x1b) toSeptet.set(GSM7[i], i);
const toExt = new Map(Object.entries(GSM7_EXT).map(([k, v]) => [v, Number(k)]));

// Text -> septet values, or null when the text needs UCS-2 (Persian, Turkish ş/ğ/ı, emoji, ...).
export function gsm7Encode(text) {
  const out = [];
  for (const ch of text) {
    if (toSeptet.has(ch)) out.push(toSeptet.get(ch));
    else if (toExt.has(ch)) out.push(0x1b, toExt.get(ch));
    else return null;
  }
  return out;
}

export function gsm7Decode(septets) {
  let s = '';
  for (let i = 0; i < septets.length; i++) {
    const v = septets[i];
    if (v === 0x1b && i + 1 < septets.length) {
      const e = septets[++i];
      s += GSM7_EXT[e] ?? GSM7[e];
    } else s += GSM7[v] ?? '?';
  }
  return s;
}

export const MAX_PARTS = 10;

// How a text will be sent: encoding, length in units (septets or UTF-16 units) and number of SMS.
export function analyzeText(text) {
  const septets = gsm7Encode(text);
  if (septets) {
    const units = septets.length;
    const parts = units <= 160 ? 1 : Math.ceil(units / 153);
    const per = parts === 1 ? 160 : 153;
    return { encoding: 'GSM-7', units, parts, perPart: per, left: parts * per - units };
  }
  const units = text.length; // UTF-16 code units, what UCS-2 counts
  const parts = units <= 70 ? 1 : Math.ceil(units / 67);
  const per = parts === 1 ? 70 : 67;
  return { encoding: 'UCS-2', units, parts, perPart: per, left: parts * per - units };
}
