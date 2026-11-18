// DOM helpers, icons, formatting, API client. All text from SMS / devices goes in as text nodes, never HTML.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
  append(el, children);
  return el;
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------- icons (authored, 24px grid, 1.7 stroke) ----------

const ICONS = {
  overview: '<path d="M4 4h7v9H4zM13 11h7v9h-7zM13 4h7v5h-7zM4 15h7v5H4z"/>',
  messages: '<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.3-4.6A7.5 7.5 0 1 1 20 11.5z"/><path d="M8.5 11.5h7"/>',
  calls: '<path d="M5.2 4h3l1.8 4.6-2.3 1.4a10.5 10.5 0 0 0 6.3 6.3l1.4-2.3 4.6 1.8v3a2 2 0 0 1-2.2 2A16 16 0 0 1 3.2 6.2 2 2 0 0 1 5.2 4z"/><path d="M15.5 3.5l5 5m0-5l-5 5"/>',
  signal: '<path d="M5 20v-3M10 20v-7M15 20V9M20 20V5"/>',
  analytics: '<path d="M4 4v16h16"/><path d="M8 15l3.5-4.5 3 2.5L19 7"/>',
  device: '<path d="M7 7h10v10H7z"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 16l4-4-4-4M19 12H9"/>',
  copy: '<path d="M9 9h11v11H9z"/><path d="M5 15H4V4h11v1"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  in: '<path d="M17 7L7 17M7 9v8h8"/>',
  out: '<path d="M7 17L17 7M9 7h8v8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a4.8 4.8 0 0 1 6.4 0"/><path d="M12 19.5h.01"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  power: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  terminal: '<path d="M4 5h16v14H4z"/><path d="M8 10l3 2-3 2M13 14h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  hotspot: '<circle cx="12" cy="12" r="1.5"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  sim: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h6v6H9zM12 11v6"/>',
  inbox: '<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
};

export function icon(name, cls = '') {
  const el = document.createElementNS(SVGNS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('class', `icon ${cls}`.trim());
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] || ''; // static markup from this file only
  return el;
}

// ---------- formatting ----------

const dtf = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dtfFull = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const tf = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fullTime = (ts) => (ts ? dtfFull.format(new Date(ts)) : '');
export const clock = (ts) => tf.format(new Date(ts));
// hours and minutes in the viewer's own style: "15:00" or "03:00 PM"
const hmf = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export const hm = (ts) => hmf.format(new Date(ts));
export const shortTime = (ts) => dtf.format(new Date(ts));

export function ago(ts, now = Date.now()) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return shortTime(ts);
}

export function timeEl(ts) {
  return h('time', { datetime: new Date(ts).toISOString(), title: fullTime(ts) }, ago(ts));
}

export function duration(sec) {
  if (sec == null) return '–';
  const d = Math.floor(sec / 86400);
  const hh = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} d ${hh} h`;
  if (hh) return `${hh} h ${m} min`;
  return `${m} min`;
}

export function signal(dbm) {
  if (dbm == null) return { bars: 0, label: 'No signal' };
  if (dbm >= -73) return { bars: 4, label: 'Excellent' };
  if (dbm >= -85) return { bars: 3, label: 'Good' };
  if (dbm >= -99) return { bars: 2, label: 'Fair' };
  return { bars: 1, label: 'Weak' };
}

export function wifiQuality(rssi) {
  if (rssi == null) return '–';
  if (rssi >= -60) return 'strong';
  if (rssi >= -72) return 'good';
  if (rssi >= -82) return 'weak';
  return 'very weak';
}

const SIM_STATES = {
  ready: ['ok', 'Ready'],
  searching: ['warn', 'Searching for network'],
  starting: ['warn', 'Starting'],
  no_sim: ['bad', 'No SIM card'],
  sim_locked: ['bad', 'SIM PIN locked'],
  denied: ['bad', 'Network refused the SIM'],
  no_answer: ['bad', 'Module not answering'],
  low_power: ['bad', 'Supply voltage too low'],
  off: ['', 'Off'],
};
export const simState = (st) => SIM_STATES[st] || ['', st || 'Unknown'];

export const REG = { 0: 'Not searching', 1: 'Home network', 2: 'Searching', 3: 'Refused', 4: 'Unknown', 5: 'Roaming' };

// SIM lines ("<device>:<slot>" -> { name, enabled, network }), refreshed with the sidebar status.
let LINES = {};
export const setLines = (lines) => (LINES = lines || {});
function lineOf(slot, device) {
  if (device && LINES[`${device}:${slot}`]) return LINES[`${device}:${slot}`];
  return Object.entries(LINES).find(([k]) => k.endsWith(`:${slot}`))?.[1] || null;
}
// "Work" or "SIM 1"
export const simName = (slot, device) => lineOf(slot, device)?.name || `SIM ${slot}`;
// "Work (SIM 1)" or "SIM 1"
export const simTag = (slot, device) => (lineOf(slot, device)?.name ? `${lineOf(slot, device).name} (SIM ${slot})` : `SIM ${slot}`);
// false only when the owner turned the slot off
export const simOn = (slot, device) => lineOf(slot, device)?.enabled !== false;

const MSG_STATUS = {
  received: ['plain', 'Received'],
  queued: ['warn', 'Waiting'],
  sending: ['warn', 'Sending'],
  sent: ['ok', 'Sent'],
  failed: ['bad', 'Failed'],
};
export function statusBadge(st) {
  const [cls, label] = MSG_STATUS[st] || ['', st];
  return h('span', { class: `badge ${cls}` }, label);
}

export const volts = (mv) => (mv ? `${(mv / 1000).toFixed(2)} V` : '–');
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// ---------- API ----------

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
  if (!r.ok) throw new ApiError(r.status, data.error || `Request failed (${r.status})`);
  return data;
}

// ---------- feedback ----------

let toastBox;
export function toast(text, kind = '') {
  if (!toastBox) document.body.append((toastBox = h('div', { class: 'toasts', role: 'status' })));
  const t = h('div', { class: `toast ${kind}` }, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 3200);
}

export async function busy(btn, fn) {
  btn.classList.add('busy');
  btn.setAttribute('aria-busy', 'true');
  try {
    return await fn();
  } finally {
    btn.classList.remove('busy');
    btn.removeAttribute('aria-busy');
  }
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Copy failed: select the text and copy it by hand', 'bad');
  }
}

export function segmented(options, value, onChange, label) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const render = (v) => {
    clear(
      wrap,
      options.map(([val, text]) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(val === v),
          onclick: () => {
            render(val);
            onChange(val);
          },
        }, text)
      )
    );
  };
  render(value);
  return wrap;
}

export function emptyState(iconName, title, text) {
  return h('div', { class: 'empty' }, icon(iconName), h('b', {}, title), text ? h('p', { class: 'small' }, text) : null);
}

export function panel(title, aside, ...body) {
  return h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, title), aside || null),
    ...body
  );
}

// Run fn now and every `ms` while the page is shown; returns a stop function.
export function poll(fn, ms) {
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    if (!document.hidden) {
      try {
        await fn();
      } catch (e) {
        if (e.status !== 401) console.warn(e);
      }
    }
    if (!stopped) timer = setTimeout(tick, ms);
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
