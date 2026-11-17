// The gateway's RGB status light: one color and pattern per state, set in the panel.
import { setting, setSetting } from './db.js';
import { HttpError } from './http.js';

export const LED_STATES = [
  ['ok', 'Everything works'],
  ['activity', 'An SMS or call comes in or goes out (short flash)'],
  ['sim', 'Online, but no SIM card is ready'],
  ['server', 'Wi-Fi works, but the server does not let it in'],
  ['wifi', 'Looking for the Wi-Fi'],
  ['setup', 'The setup Wi-Fi is open'],
  ['update', 'Installing a firmware update'],
];
export const LED_MODES = ['solid', 'pulse', 'slow', 'blink', 'fast', 'flash', 'off'];

export const LED_DEFAULT = {
  brightness: 15,
  states: {
    ok: { color: '#00ff40', mode: 'solid' },
    activity: { color: '#ffffff', mode: 'flash' },
    sim: { color: '#ff8000', mode: 'slow' },
    server: { color: '#ff0000', mode: 'slow' },
    wifi: { color: '#ffc000', mode: 'blink' },
    setup: { color: '#0060ff', mode: 'blink' },
    update: { color: '#a000ff', mode: 'fast' },
  },
};

export function ledSettings() {
  let saved = {};
  try {
    saved = JSON.parse(setting('led') || '{}');
  } catch {}
  const states = {};
  for (const [k] of LED_STATES) states[k] = { ...LED_DEFAULT.states[k], ...(saved.states?.[k] || {}) };
  return { brightness: saved.brightness ?? LED_DEFAULT.brightness, states };
}

export function setLedSettings(input) {
  if (input === 'default') {
    setSetting('led', '');
    return ledSettings();
  }
  const cur = ledSettings();
  if (input.brightness !== undefined) {
    const b = Number(input.brightness);
    if (!Number.isFinite(b) || b < 0 || b > 100) throw new HttpError(400, 'Brightness goes from 0 to 100');
    cur.brightness = Math.round(b);
  }
  for (const [k, v] of Object.entries(input.states || {})) {
    if (!cur.states[k]) throw new HttpError(400, `Unknown light state ${k}`);
    if (v.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(v.color)) throw new HttpError(400, 'Colors look like #00ff40');
      cur.states[k].color = v.color.toLowerCase();
    }
    if (v.mode !== undefined) {
      if (!LED_MODES.includes(v.mode)) throw new HttpError(400, `Pattern must be one of ${LED_MODES.join(', ')}`);
      cur.states[k].mode = v.mode;
    }
  }
  setSetting('led', JSON.stringify(cur));
  return cur;
}

// Compact form sent to the gateway on every check-in: {"b":15,"s":{"ok":"00ff40:solid",...}}
export function ledForDevice() {
  const l = ledSettings();
  return { b: l.brightness, s: Object.fromEntries(Object.entries(l.states).map(([k, v]) => [k, `${v.color.slice(1)}:${v.mode}`])) };
}
