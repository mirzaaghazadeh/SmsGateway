// SIM lines: one SIM slot of one gateway. The owner can give each a name, turn an empty slot off
// (the gateway stops trying that SIM800L and the panel hides it) and choose its mobile network
// (automatic, or one network by its code, like 28601). Stored as one setting:
// { "<device>:<slot>": { name, off, net } }, only what differs from the default.
import { setting, setSetting, log } from './db.js';
import { HttpError } from './http.js';

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
  return { name: l.name || '', enabled: !l.off, network: l.net || 'auto' };
}

export const linesFor = (device, all = allLines()) => Object.fromEntries(SLOTS.map((s) => [s, lineOf(device, s, all)]));

// What the gateway gets in its config (firmware 1.2.0 and newer; older ones ignore it).
export function simConfig(device) {
  const all = allLines();
  return Object.fromEntries(SLOTS.map((s) => {
    const l = lineOf(device, s, all);
    return [String(s), { on: l.enabled, net: l.network }];
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
  if (Object.keys(cur).length) all[key] = cur;
  else delete all[key];
  setSetting('lines', JSON.stringify(all));
  if (said.length) log(`SIM ${slot}: ${said.join(', ')}`, { device_id: device, slot });
  return lineOf(device, slot, all);
}
