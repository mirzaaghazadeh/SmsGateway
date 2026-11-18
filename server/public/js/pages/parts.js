// Pieces shared by several pages: SIM cards, message and call rows.
import { h, icon, signal, simState, REG, volts, statusBadge, timeEl, fullTime, ago, simName, simTag, copy, lineList } from '../ui.js';
import { findCode } from '../otp.js';

export function simCard(sim, slot, online = true, device = null) {
  const cls = slot === 2 ? 's2' : '';
  const tag = simTag(slot, device);
  if (!sim) {
    return h('div', { class: 'simw' }, h('article', { class: `sim ${cls} off` },
      h('div', { class: 'sim-head' }, h('span', { class: 'sim-chip' }, `${slot}`),
        h('div', {}, h('div', { class: 'op' }, tag), h('div', { class: 'state' }, 'Not reported by the gateway yet'))),
      h('div', { class: 'sim-signal' }, bars(0))
    ));
  }
  const live = online && sim.state !== 'off';
  const sig = signal(live ? sim.dbm : null);
  const [stCls, stLabel] = online ? simState(sim.state) : ['', 'Gateway offline'];
  const lowV = sim.mv && sim.mv < 3500;
  return h('div', { class: 'simw' }, h('article', { class: `sim ${cls} ${live && sim.dbm != null ? '' : 'off'}`, 'aria-label': `SIM ${slot}` },
    h('div', { class: 'sim-head' },
      h('span', { class: 'sim-chip', 'aria-hidden': 'true' }, `${slot}`),
      h('div', { class: 'grow' },
        h('div', { class: 'op' }, sim.operator || tag),
        h('div', { class: 'state' }, sim.operator ? tag : REG[sim.reg] || '')
      ),
      h('span', { class: `badge ${stCls}` }, stLabel)
    ),
    h('div', { class: 'sim-signal' },
      bars(sig.bars),
      h('div', {},
        h('div', { class: 'dbm' }, live && sim.dbm != null ? sim.dbm : '–', h('small', {}, 'dBm')),
        h('div', { class: 'quality' }, sig.label)
      )
    ),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Network'), h('dd', {}, REG[sim.reg] ?? '–'),
      h('dt', {}, 'Supply'), h('dd', { class: lowV ? 'error-text' : '' }, volts(sim.mv), lowV ? ' · too low' : ''),
      h('dt', {}, 'SIM ID'), h('dd', { class: 'mono' }, sim.iccid || '–'),
      h('dt', {}, 'IMEI'), h('dd', { class: 'mono' }, sim.imei || '–'),
      sim.balance ? [h('dt', {}, 'Balance'), h('dd', { title: `${sim.balance}\n${fullTime(sim.balance_at)}` },
        sim.balance.replace(/\s*\n+\s*/g, ' · '))] : null,
      sim.queue ? [h('dt', {}, 'Sending'), h('dd', {}, `${sim.queue} in queue`)] : null
    )
  ));
}

export function bars(n) {
  return h('div', { class: 'bars', role: 'img', 'aria-label': `${n} of 4 signal bars` },
    [1, 2, 3, 4].map((i) => h('i', { class: i <= n ? 'on' : '' }))
  );
}

export function messageRow(m, { onRetry, open = false, onToggle } = {}) {
  const incoming = m.direction === 'in';
  const failed = m.status === 'failed';
  const code = incoming ? findCode(m.text) : null;
  const li = h('li');
  const draw = (isOpen) => {
    const btn = h('button', {
      type: 'button',
      class: `item ${isOpen ? 'open' : ''}`,
      'aria-expanded': String(isOpen),
      onclick: () => {
        onToggle?.(m.id, !isOpen);
        li.replaceChildren(...draw(!isOpen));
      },
    },
      h('span', { class: `ico ${incoming ? 'in' : failed ? 'bad' : ''}` }, icon(incoming ? 'in' : 'out')),
      h('span', { class: 'grow' },
        h('span', { class: 'who' }, m.number),
        h('span', { class: 'text', dir: 'auto' }, m.text)
      ),
      h('span', { class: 'meta' }, timeEl(m.created_at),
        code ? h('span', { class: 'otp', title: 'Code in this SMS' }, '🔑 ', code) : null,
        incoming ? (m.slot ? simName(m.slot, m.device_id) : '') : statusBadge(m.status))
    );
    const out = [btn];
    if (isOpen) {
      const facts = [
        incoming ? `Received ${fullTime(m.created_at)}` : `Created ${fullTime(m.created_at)}`,
        m.sms_time ? `Sent by network ${fullTime(m.sms_time)}` : null,
        m.sent_at ? `Sent ${fullTime(m.sent_at)}` : null,
        m.slot ? simTag(m.slot, m.device_id) : m.want_slot ? `Asked for ${simTag(m.want_slot)}` : 'Any SIM',
        `${m.parts || 1} SMS · ${m.encoding || '–'}`,
        m.source && !incoming ? `from ${m.source}` : null,
        m.attempts ? `${m.attempts} attempt${m.attempts === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      out.push(h('div', { class: 'detail', style: { padding: '0 18px 14px 60px' } },
        facts.map((f) => h('span', {}, f)),
        m.error ? h('span', { class: 'error-text' }, m.error) : null,
        code ? h('button', { class: 'btn sm', type: 'button', onclick: () => copy(code) }, icon('copy'), `Copy code ${code}`) : null,
        failed && onRetry ? h('button', { class: 'btn sm', type: 'button', onclick: () => onRetry(m) }, icon('refresh'), 'Try again') : null,
        incoming ? h('a', { class: 'btn sm', href: `/messages?to=${encodeURIComponent(m.number)}` }, icon('send'), 'Reply') : null
      ));
    }
    return out;
  };
  li.append(...draw(open));
  return li;
}

export function callText(c) {
  const secs = c.ring_ms ? Math.max(1, Math.round(c.ring_ms / 1000)) : null;
  if (c.action === 'rejected') return secs ? `Hung up by the gateway after ${secs} s` : 'Hung up by the gateway';
  return secs ? `Rang ${secs} s, caller gave up` : 'Caller gave up';
}

export function callRow(c) {
  return h('li', {}, h('div', { class: 'item' },
    h('span', { class: 'ico call' }, icon('calls')),
    h('span', { class: 'grow' }, h('span', { class: 'who' }, c.number), h('span', { class: 'text' }, callText(c))),
    h('span', { class: 'meta' }, timeEl(c.ts), c.slot ? simName(c.slot, c.device_id) : '')
  ));
}

// The start of a day in the browser's time zone, in ms ("2026-11-18" -> midnight there; add = days later)
function localDay(value, add = 0) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d + add).getTime();
}

// SIM, date range and CSV export above the Messages and Calls lists. query() gives the page's own
// filters (search, direction), so the export holds what the list shows.
export function filterBar({ csv, query, onChange }) {
  const lines = lineList();
  const sim = h('select', { class: 'select', 'aria-label': 'SIM card', hidden: lines.length < 2 },
    h('option', { value: '' }, 'All SIM cards'),
    lines.map((l) => h('option', { value: `${l.device}:${l.slot}` }, l.label)));
  const from = h('input', { class: 'input', type: 'date', 'aria-label': 'From this day' });
  const to = h('input', { class: 'input', type: 'date', 'aria-label': 'To this day' });
  const params = () => {
    const p = {};
    if (sim.value) [p.device, p.sim] = sim.value.split(':');
    if (from.value) p.since = String(localDay(from.value));
    if (to.value) p.until = String(localDay(to.value, 1)); // the whole last day
    return p;
  };
  const active = () => !!(sim.value || from.value || to.value);
  const clearBtn = h('button', {
    class: 'btn sm', type: 'button', hidden: true,
    onclick: () => {
      sim.value = from.value = to.value = '';
      changed();
    },
  }, 'Clear');
  const href = () => `${csv}?${new URLSearchParams({ ...query(), ...params(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`;
  const link = h('a', {
    class: 'btn sm', href: href(), download: '', title: 'Download what the list shows as a CSV file (Excel, Google Sheets, Numbers)',
    onclick: () => (link.href = href()),
  }, icon('download'), 'Export CSV');
  function changed() {
    clearBtn.hidden = !active();
    onChange();
  }
  for (const el of [sim, from, to]) el.addEventListener('change', changed);
  return {
    el: h('div', { class: 'toolbar filters' }, sim,
      h('span', { class: 'range' }, from, h('span', { class: 'muted' }, 'to'), to), clearBtn, h('span', { class: 'grow' }), link),
    params,
    active,
  };
}

export function logList(items) {
  return h('ul', { class: 'list log' }, items.map((l) =>
    h('li', {},
      h('time', { datetime: new Date(l.ts).toISOString(), title: fullTime(l.ts) }, ago(l.ts)),
      h('span', { class: l.level === 'info' ? '' : l.level }, l.slot ? `SIM ${l.slot}: ` : '', l.text.replace(/^SIM \d: /, ''))
    )
  ));
}
