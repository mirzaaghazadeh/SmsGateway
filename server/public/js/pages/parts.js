// Pieces shared by several pages: SIM cards, message and call rows.
import { h, icon, signal, simState, REG, volts, statusBadge, timeEl, fullTime, ago } from '../ui.js';

export function simCard(sim, slot, online = true) {
  const cls = slot === 2 ? 's2' : '';
  if (!sim) {
    return h('div', { class: 'simw' }, h('article', { class: `sim ${cls} off` },
      h('div', { class: 'sim-head' }, h('span', { class: 'sim-chip' }, `${slot}`),
        h('div', {}, h('div', { class: 'op' }, `SIM ${slot}`), h('div', { class: 'state' }, 'Not reported by the gateway yet'))),
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
        h('div', { class: 'op' }, sim.operator || `SIM ${slot}`),
        h('div', { class: 'state' }, sim.operator ? `SIM ${slot}` : REG[sim.reg] || '')
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
      h('span', { class: 'meta' }, timeEl(m.created_at), incoming ? (m.slot ? `SIM ${m.slot}` : '') : statusBadge(m.status))
    );
    const out = [btn];
    if (isOpen) {
      const facts = [
        incoming ? `Received ${fullTime(m.created_at)}` : `Created ${fullTime(m.created_at)}`,
        m.sms_time ? `Sent by network ${fullTime(m.sms_time)}` : null,
        m.sent_at ? `Sent ${fullTime(m.sent_at)}` : null,
        m.slot ? `SIM ${m.slot}` : m.want_slot ? `Asked for SIM ${m.want_slot}` : 'Any SIM',
        `${m.parts || 1} SMS · ${m.encoding || '–'}`,
        m.source && !incoming ? `from ${m.source}` : null,
        m.attempts ? `${m.attempts} attempt${m.attempts === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      out.push(h('div', { class: 'detail', style: { padding: '0 18px 14px 60px' } },
        facts.map((f) => h('span', {}, f)),
        m.error ? h('span', { class: 'error-text' }, m.error) : null,
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
    h('span', { class: 'meta' }, timeEl(c.ts), c.slot ? `SIM ${c.slot}` : '')
  ));
}

export function logList(items) {
  return h('ul', { class: 'list log' }, items.map((l) =>
    h('li', {},
      h('time', { datetime: new Date(l.ts).toISOString(), title: fullTime(l.ts) }, ago(l.ts)),
      h('span', { class: l.level === 'info' ? '' : l.level }, l.slot ? `SIM ${l.slot}: ` : '', l.text.replace(/^SIM \d: /, ''))
    )
  ));
}
