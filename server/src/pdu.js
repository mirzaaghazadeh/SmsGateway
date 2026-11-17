// SMS PDU encoding (SMS-SUBMIT, for sending) and decoding (SMS-DELIVER from the SIM800L,
// plus SUBMIT and STATUS-REPORT). The ESP32 only moves hex strings; all SMS logic lives here.
import { gsm7Encode, gsm7Decode, MAX_PARTS } from './shared/gsm.js';

const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
const toHex = (bytes) => bytes.map(hex2).join('');

function fromHex(hex) {
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error('PDU is not hex');
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// Pack septets LSB first. `fill` zero bits go first (after a user data header).
export function pack7(septets, fill = 0) {
  const out = [];
  let acc = 0;
  let bits = fill;
  for (const s of septets) {
    acc |= (s & 0x7f) << bits;
    bits += 7;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  }
  if (bits > 0) out.push(acc & 0xff);
  return out;
}

export function unpack7(bytes, fill, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const pos = fill + 7 * k;
    const i = pos >> 3;
    const shift = pos & 7;
    const v = ((bytes[i] ?? 0) >> shift) | ((bytes[i + 1] ?? 0) << (8 - shift));
    out.push(v & 0x7f);
  }
  return out;
}

// "+90 555 123-45-67" -> { digits: "905551234567", international: true }
export function normalizeNumber(raw) {
  let s = String(raw ?? '').trim().replace(/[\s\-().]/g, '');
  let international = false;
  if (s.startsWith('+')) {
    international = true;
    s = s.slice(1);
  } else if (s.startsWith('00')) {
    international = true;
    s = s.slice(2);
  }
  if (!/^\d{3,20}$/.test(s)) return null;
  return { digits: s, international, display: (international ? '+' : '') + s };
}

function encodeAddress(raw) {
  const n = normalizeNumber(raw);
  if (!n) throw new Error('Invalid phone number');
  let d = n.digits.length % 2 ? n.digits + 'F' : n.digits;
  let sw = '';
  for (let i = 0; i < d.length; i += 2) sw += d[i + 1] + d[i];
  return hex2(n.digits.length) + (n.international ? '91' : '81') + sw;
}

function splitSeptets(septets) {
  if (septets.length <= 160) return [septets];
  const parts = [];
  let i = 0;
  while (i < septets.length) {
    let end = Math.min(i + 153, septets.length);
    if (end < septets.length && septets[end - 1] === 0x1b) end--; // never split an escape pair
    parts.push(septets.slice(i, end));
    i = end;
  }
  return parts;
}

function splitUnits(text) {
  if (text.length <= 70) return [text];
  const parts = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + 67, text.length);
    const c = text.charCodeAt(end - 1);
    if (end < text.length && c >= 0xd800 && c <= 0xdbff) end--; // keep surrogate pairs together
    parts.push(text.slice(i, end));
    i = end;
  }
  return parts;
}

function ucs2Bytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out.push(c >> 8, c & 0xff);
  }
  return out;
}

// Returns [{ len, pdu }] ready for AT+CMGS=<len> (PDU mode). Several parts = concatenated SMS.
export function encodeSubmit(number, text, { ref = Math.floor(Math.random() * 256), validity = 0xaa } = {}) {
  if (typeof text !== 'string' || text.length === 0) throw new Error('Text is empty');
  const addr = encodeAddress(number);
  const septets = gsm7Encode(text);
  const chunks = septets ? splitSeptets(septets) : splitUnits(text);
  if (chunks.length > MAX_PARTS) throw new Error(`Text too long (${chunks.length} SMS, max ${MAX_PARTS})`);
  const multi = chunks.length > 1;
  return chunks.map((chunk, i) => {
    const fo = 0x11 | (multi ? 0x40 : 0); // SMS-SUBMIT, relative validity, UDHI if multipart
    const udh = multi ? [0x05, 0x00, 0x03, ref & 0xff, chunks.length, i + 1] : [];
    let ud, udl;
    if (septets) {
      ud = [...udh, ...pack7(chunk, multi ? 1 : 0)];
      udl = (multi ? 7 : 0) + chunk.length;
    } else {
      ud = [...udh, ...ucs2Bytes(chunk)];
      udl = ud.length;
    }
    const pdu = '00' + hex2(fo) + '00' + addr + '00' + (septets ? '00' : '08') + hex2(validity) + hex2(udl) + toHex(ud);
    return { len: pdu.length / 2 - 1, pdu };
  });
}

// ---------- decoding ----------

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.i = 0;
  }
  u8() {
    if (this.i >= this.b.length) throw new Error('PDU too short');
    return this.b[this.i++];
  }
  take(n) {
    if (this.i + n > this.b.length) throw new Error('PDU too short');
    const s = this.b.slice(this.i, this.i + n);
    this.i += n;
    return s;
  }
}

function semi(bytes) {
  let s = '';
  for (const b of bytes) s += (b & 0x0f).toString(16) + (b >> 4).toString(16);
  return s.toUpperCase();
}

function readAddress(r) {
  const len = r.u8();
  const type = r.u8();
  const bytes = r.take(Math.ceil(len / 2));
  if ((type & 0x70) === 0x50) {
    // alphanumeric sender, e.g. "Turkcell"
    return { number: gsm7Decode(unpack7(bytes, 0, Math.floor((len * 4) / 7))), type: 'alphanumeric' };
  }
  let digits = semi(bytes).slice(0, len).replace(/F/g, '');
  digits = digits.replace(/A/g, '*').replace(/B/g, '#');
  const international = (type & 0x70) === 0x10;
  return { number: (international ? '+' : '') + digits, type: international ? 'international' : 'national' };
}

function readTimestamp(r) {
  const b = r.take(7);
  const d = b.slice(0, 6).map((x) => (x & 0x0f) * 10 + (x >> 4));
  const tzOct = b[6];
  const quarters = (tzOct & 0x07) * 10 + (tzOct >> 4);
  const offset = (tzOct & 0x08 ? -1 : 1) * quarters * 15;
  const utc = Date.UTC((d[0] >= 90 ? 1900 : 2000) + d[0], d[1] - 1, d[2], d[3], d[4], d[5]) - offset * 60000;
  return Number.isFinite(utc) ? utc : null;
}

function encodingOf(dcs) {
  const group = dcs & 0xf0;
  if ((dcs & 0xc0) === 0x00) return ['gsm7', '8bit', 'ucs2', 'gsm7'][(dcs >> 2) & 3];
  if (group === 0xf0) return dcs & 0x04 ? '8bit' : 'gsm7';
  if (group === 0xe0) return 'ucs2';
  return 'gsm7';
}

function readUserData(r, udl, enc, udhi) {
  const rest = r.b.slice(r.i);
  let hdrLen = 0;
  let concat = null;
  if (udhi && rest.length) {
    const udhl = rest[0];
    hdrLen = udhl + 1;
    let j = 1;
    while (j < hdrLen) {
      const iei = rest[j];
      const l = rest[j + 1];
      const d = rest.slice(j + 2, j + 2 + l);
      if (iei === 0x00 && l === 3) concat = { ref: d[0], total: d[1], seq: d[2] };
      if (iei === 0x08 && l === 4) concat = { ref: (d[0] << 8) | d[1], total: d[2], seq: d[3] };
      j += 2 + l;
    }
  }
  let text;
  if (enc === 'gsm7') {
    const hdrSeptets = Math.ceil((hdrLen * 8) / 7);
    const fill = hdrSeptets * 7 - hdrLen * 8;
    text = gsm7Decode(unpack7(rest.slice(hdrLen), fill, Math.max(0, udl - hdrSeptets)));
  } else if (enc === 'ucs2') {
    const b = rest.slice(hdrLen, udl);
    text = '';
    for (let k = 0; k + 1 < b.length; k += 2) text += String.fromCharCode((b[k] << 8) | b[k + 1]);
  } else {
    text = toHex(rest.slice(hdrLen, udl));
  }
  if (concat && (concat.total < 2 || concat.seq < 1 || concat.seq > concat.total)) concat = null;
  return { text, concat };
}

export function decodePdu(hex) {
  const r = new Reader(fromHex(String(hex).trim()));
  const scaLen = r.u8();
  const sca = scaLen ? readAddressRaw(r, scaLen) : null;
  const fo = r.u8();
  const mti = fo & 0x03;
  const udhi = !!(fo & 0x40);

  if (mti === 0x00) {
    const oa = readAddress(r);
    r.u8(); // PID
    const dcs = r.u8();
    const time = readTimestamp(r);
    const udl = r.u8();
    const enc = encodingOf(dcs);
    const { text, concat } = readUserData(r, udl, enc, udhi);
    return { type: 'deliver', smsc: sca, number: oa.number, numberType: oa.type, time, encoding: enc, text, concat };
  }
  if (mti === 0x01) {
    const mr = r.u8();
    const da = readAddress(r);
    r.u8(); // PID
    const dcs = r.u8();
    const vpf = (fo >> 3) & 3;
    if (vpf === 2) r.u8();
    else if (vpf) r.take(7);
    const udl = r.u8();
    const enc = encodingOf(dcs);
    const { text, concat } = readUserData(r, udl, enc, udhi);
    return { type: 'submit', mr, number: da.number, numberType: da.type, encoding: enc, text, concat };
  }
  if (mti === 0x02) {
    const mr = r.u8();
    const ra = readAddress(r);
    const time = readTimestamp(r);
    const done = readTimestamp(r);
    const status = r.u8();
    return { type: 'status', mr, number: ra.number, time, done, status };
  }
  throw new Error('Unknown PDU type');
}

// SMSC address: the length counts octets (type + digits), not digits.
function readAddressRaw(r, octets) {
  const type = r.u8();
  const digits = semi(r.take(octets - 1)).replace(/F/g, '');
  return ((type & 0x70) === 0x10 ? '+' : '') + digits;
}
