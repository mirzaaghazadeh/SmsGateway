// SIM lines: one SIM slot of one gateway. The owner can give each a name, turn an empty slot off
// (the gateway stops trying that SIM800L and the panel hides it), choose its mobile network
// (automatic, or one network by its code, like 28601), set the USSD code that shows the balance
// (checked every few days if wanted) and a keep-alive SMS, so a prepaid SIM that is rarely used
// is not switched off by the operator, and a roaming mode that saves money abroad (calls are not hung
// up, no SMS goes out). Stored as one setting:
// { "<device>:<slot>": { name, off, net, ussd, bal, keep, keep_to, keep_text, roam } }, only what
// differs from the default.
import { setting, setSetting, log } from './db.js';
import { HttpError } from './http.js';
import { normalizeNumber } from './pdu.js';
import { analyzeText } from './shared/gsm.js';
import { USSD_RE } from './ussd.js';

export const KEEP_TEXT = 'Keep-alive from my SMS gateway';

export const SLOTS = [1, 2];

export function allLines() {
  try {
    return JSON.parse(setting('lines', '{}')) || {};
  } catch {
    return {};
  }
}

export function lineOf(device, slot, all = allLines()) {
  const l = all[`${device}:${slot}`] || {};
  return {
    name: l.name || '', enabled: !l.off, network: l.net || 'auto',
    ussd: l.ussd || '', balance_days: l.bal || 0,                                    // balance check
    keep_days: l.keep || 0, keep_to: l.keep_to || '', keep_text: l.keep_text || KEEP_TEXT, // keep-alive SMS
    roaming: l.roam || 'off',                                                         // off, auto, on
  };
}

export const ROAMING = ['off', 'auto', 'on'];
export const ROAMING_FW = '1.4.0'; // first firmware that keeps calls ringing per SIM

// Roaming mode is on for this SIM right now: "on", or "auto" while the SIM is roaming (CREG 5).
// Then calls ring instead of being hung up and the SIM sends no SMS.
export const roamingGuard = (line, sim) => line.enabled && (line.roaming === 'on' || (line.roaming === 'auto' && sim?.reg === 5));

const dayCount = (v, max, what) => {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `${what}: a number of days from 0 (off) to ${max}`);
  return n;
};

export const linesFor = (device, all = allLines()) => Object.fromEntries(SLOTS.map((s) => [s, lineOf(device, s, all)]));

// What the gateway gets in its config (firmware 1.2.0 and newer; older ones ignore it).
export function simConfig(device) {
  const all = allLines();
  return Object.fromEntries(SLOTS.map((s) => {
    const l = lineOf(device, s, all);
    return [String(s), { on: l.enabled, net: l.network, roam: l.roaming }];
  }));
}

// "Work (SIM 1)" or "SIM 1"
export function simLabel(device, slot) {
  const { name } = lineOf(device, slot);
  return name ? `${name} (SIM ${slot})` : `SIM ${slot}`;
}

export function updateLine(device, slot, b) {
  slot = Number(slot);
  if (!SLOTS.includes(slot)) throw new HttpError(400, 'SIM must be 1 or 2');
  const all = allLines();
  const key = `${device}:${slot}`;
  const cur = { ...(all[key] || {}) };
  const said = [];
  if (b.name !== undefined) {
    const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (name) cur.name = name;
    else delete cur.name;
    said.push(name ? `named "${name}"` : 'name removed');
  }
  if (b.enabled !== undefined) {
    if (b.enabled) delete cur.off;
    else cur.off = true;
    said.push(b.enabled ? 'turned on' : 'turned off');
  }
  if (b.network !== undefined) {
    const net = String(b.network ?? '').trim();
    if (!net || net === 'auto') delete cur.net;
    else if (/^\d{5,6}$/.test(net)) cur.net = net;
    else throw new HttpError(400, 'The network code has 5 or 6 digits (country + operator), like 28601');
    said.push(cur.net ? `network ${cur.net} chosen` : 'network automatic');
  }
  if (b.ussd !== undefined) {
    const code = String(b.ussd ?? '').replace(/\s+/g, '');
    if (code && !USSD_RE.test(code)) throw new HttpError(400, 'A balance code looks like *123# (digits, * and #, ending in #)');
    if (code) cur.ussd = code;
    else delete cur.ussd;
    said.push(code ? `balance code ${code}` : 'balance code removed');
  }
  if (b.balance_days !== undefined) {
    const d = dayCount(b.balance_days, 60, 'Balance check');
    if (d) cur.bal = d;
    else delete cur.bal;
    said.push(d ? `balance checked every ${d} days` : 'no automatic balance check');
  }
  if (b.keep_to !== undefined) {
    const raw = String(b.keep_to ?? '').trim();
    const n = raw ? normalizeNumber(raw) : null;
    if (raw && !n) throw new HttpError(400, 'The keep-alive SMS needs a phone number, like +15551234567');
    if (n) cur.keep_to = n.display;
    else delete cur.keep_to;
  }
  if (b.keep_text !== undefined) {
    const t = String(b.keep_text ?? '').replace(/\s+/g, ' ').trim();
    if (t && analyzeText(t).parts > 1) throw new HttpError(400, 'The keep-alive text must fit in one SMS');
    if (t && t !== KEEP_TEXT) cur.keep_text = t;
    else delete cur.keep_text;
  }
  if (b.keep_days !== undefined) {
    const d = dayCount(b.keep_days, 365, 'Keep-alive');
    if (d) cur.keep = d;
    else delete cur.keep;
    said.push(d ? `keep-alive SMS every ${d} days` : 'keep-alive off');
  }
  if (b.roaming !== undefined) {
    if (!ROAMING.includes(b.roaming)) throw new HttpError(400, 'Roaming mode is "off", "auto" or "on"');
    if (b.roaming === 'off') delete cur.roam;
    else cur.roam = b.roaming;
    said.push({ off: 'roaming mode off', auto: 'roaming mode on while roaming', on: 'roaming mode always on' }[b.roaming]);
  }
  if (cur.keep && !cur.keep_to) throw new HttpError(400, 'Enter the number the keep-alive SMS goes to');
  if (Object.keys(cur).length) all[key] = cur;
  else delete all[key];
  setSetting('lines', JSON.stringify(all));
  if (said.length) log(`SIM ${slot}: ${said.join(', ')}`, { device_id: device, slot });
  return lineOf(device, slot, all);
}
