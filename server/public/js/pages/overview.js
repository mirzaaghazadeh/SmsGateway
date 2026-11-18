import { h, clear, icon, api, poll, ago, duration, wifiQuality, panel, emptyState, copy } from '../ui.js';
import { simCard, messageRow, callRow, logList } from './parts.js';

export default function overview(page) {
  const body = h('div', { style: { display: 'contents' } }, h('div', { class: 'skeleton' }));
  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Overview'), h('p', { class: 'sub' }, 'Live status of the gateway and both SIM cards.')),
      h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '/messages' }, icon('send'), 'Send SMS'))
    ),
    body
  );
  const open = new Set();
  return poll(async () => {
    const o = await api('/api/overview');
    clear(body, o.devices.length ? dashboard(o, open) : await onboarding(o));
  }, 5000);
}

function dashboard(o, open) {
  const d = o.last24h;
  return [
    ...o.devices.map((dev) => gateway(dev, o.now)),
    h('section', { class: 'panel', 'aria-label': 'Last 24 hours' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Last 24 hours'), h('a', { href: '/analytics', class: 'small' }, 'Analytics')),
      h('div', { class: 'strip' },
        stat(d.received, 'received'),
        stat(d.sent, 'sent'),
        stat(d.failed, 'failed', d.failed > 0),
        stat(d.calls, 'missed calls'),
        stat(d.pending, 'waiting to send')
      )
    ),
    h('div', { class: 'split' },
      panel('Recent messages', h('a', { href: '/messages', class: 'small' }, 'All messages'),
        o.messages.length
          ? h('ul', { class: 'list' }, o.messages.map((m) => messageRow(m, { open: open.has(m.id), onToggle: (id, v) => (v ? open.add(id) : open.delete(id)) })))
          : emptyState('inbox', 'No messages yet', 'Text the SIM number from your phone to see it arrive here.')
      ),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
        panel('Missed calls', h('a', { href: '/calls', class: 'small' }, 'All calls'),
          o.calls.length ? h('ul', { class: 'list' }, o.calls.map(callRow)) : emptyState('calls', 'No calls yet')
        ),
        panel('Events', h('a', { href: '/devices', class: 'small' }, 'Full log'),
          o.logs.length ? logList(o.logs) : emptyState('terminal', 'Nothing logged yet')
        )
      )
    ),
  ];
}

function stat(n, label, bad = false) {
  return h('div', { class: bad ? 'bad' : '' }, h('b', {}, n), h('span', {}, label));
}

function gateway(dev, now) {
  // a slot the owner turned off (no module in it) is not shown
  const sims = [1, 2].filter((slot) => dev.lines?.[slot]?.enabled !== false)
    .map((slot) => simCard(dev.sims.find((x) => x.slot === slot), slot, dev.online, dev.id));
  return [
    h('section', { class: 'panel gateway', 'aria-label': 'Gateway' },
      h('div', {},
        h('div', { class: 'gateway-title' },
          h('h2', {}, dev.name || 'SMS Gateway'),
          dev.online ? h('span', { class: 'badge ok' }, 'Online') : h('span', { class: 'badge bad' }, `Offline · last seen ${ago(dev.last_seen, now)}`)
        ),
        h('div', { class: 'facts' },
          fact('Wi-Fi', dev.ssid ? (dev.wifi_rssi != null ? `${dev.ssid} · ${dev.wifi_rssi} dBm (${wifiQuality(dev.wifi_rssi)})` : dev.ssid) : '–'),
          fact('Address', dev.ip || '–'),
          fact('Running for', duration(dev.uptime)),
          fact('Firmware', dev.fw || '–'),
          fact('Last restart', dev.reset_reason || '–')
        )
      ),
      h('a', { class: 'btn', href: '/devices' }, icon('device'), 'Device tools')
    ),
    h('div', { class: 'sims' }, sims),
  ];
}

function fact(label, value) {
  return h('div', { class: 'fact' }, h('span', {}, label), h('b', {}, value));
}

async function onboarding(o) {
  // keys added but no check-in yet: tell what to finish on the gateway
  if (o.waiting.length) {
    return panel('Waiting for your gateway', h('a', { href: '/devices', class: 'small' }, 'Devices'),
      h('div', { class: 'panel-body form' },
        h('p', {}, 'Added: ', o.waiting.map((w, i) => [i ? ', ' : '', h('b', {}, w.name), ' (key …', h('span', { class: 'mono' }, w.hint), ')']),
          '. It shows up here a few seconds after it checks in.'),
        h('p', { class: 'muted' }, 'Nothing yet? Check the gateway screen: it shows whether Wi-Fi works and what the server answered. ',
          'The server address on its setup page must be this panel\'s address.')
      )
    );
  }
  let st = {};
  try {
    st = await api('/api/settings');
  } catch {}
  return panel('Connect your first gateway', null,
    h('div', { class: 'panel-body split even' },
      h('ol', { class: 'steps' },
        h('li', {}, 'Power the gateway. Until it is set up it opens a Wi-Fi called ', h('b', {}, 'SMS-Gateway-…'), ' (password ', h('code', {}, 'smsgateway'), '); its screen shows the name.'),
        h('li', {}, 'Join that Wi-Fi with your phone. The setup page opens by itself; if not, open ', h('code', {}, 'http://192.168.4.1'), '.'),
        h('li', {}, 'Choose your Wi-Fi and enter the server address shown here. Save.'),
        h('li', {}, 'Copy the device key from the setup page (it is also on the gateway screen) and add it under Devices.')
      ),
      h('div', { class: 'form' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Server address'),
          h('div', { class: 'secret' }, h('input', { class: 'input', readonly: true, value: st.server_url || '', 'aria-label': 'Server address' }),
            h('button', { class: 'btn', type: 'button', onclick: () => copy(st.server_url) }, icon('copy'), 'Copy'))),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '/devices' }, icon('plus'), 'Add the gateway')),
        h('p', { class: 'hint' }, 'To change Wi-Fi later, hold the BOOT button on the ESP32 for 5 seconds: it forgets Wi-Fi and server, keeps its key, and opens the setup Wi-Fi again.')
      )
    )
  );
}
