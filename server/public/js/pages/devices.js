import { h, clear, icon, api, poll, toast, busy, segmented, emptyState, panel, ago, clock, shortTime, copy } from '../ui.js';
import { logList } from './parts.js';

const PRESETS = [
  ['AT+CSQ', 'signal'],
  ['AT+CREG?', 'registration'],
  ['AT+COPS?', 'operator'],
  ['AT+CBC', 'voltage'],
  ['AT+CPIN?', 'SIM status'],
  ['AT+CCID', 'SIM ID'],
  ['ATI', 'module info'],
];

export default function devices(page) {
  let gateways = [];
  let serverUrl = '';
  let consoleBuilt = false;
  const addBox = h('div', { style: { display: 'contents' } });
  const listBox = h('div', { style: { display: 'contents' } }, h('div', { class: 'skeleton' }));
  const consoleBox = h('div', { style: { display: 'contents' } });
  const logBox = h('div', {});
  const waitingHint = h('div', {});

  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Devices'),
        h('p', { class: 'sub' }, 'Add gateways, restart them, talk to their SIM800L modules and read the event log.'))
    ),
    addBox,
    listBox,
    consoleBox,
    panel('Event log', null, logBox)
  );

  let logItems = [];
  async function loadLog(before) {
    const r = await api(`/api/logs?limit=60${before ? `&before=${before}` : ''}`);
    logItems = before ? logItems.concat(r.items) : r.items;
    clear(logBox,
      logItems.length ? logList(logItems) : emptyState('terminal', 'Nothing logged yet'),
      r.more ? h('div', { class: 'more' }, h('button', { class: 'btn sm', type: 'button', onclick: (e) => busy(e.currentTarget, () => loadLog(logItems.at(-1).id)) }, 'Show older')) : null
    );
  }

  let refresh;
  api('/api/settings').then((s) => {
    serverUrl = s.server_url;
    clear(addBox, addPanel(serverUrl, waitingHint, () => refresh()));
  }).catch(() => clear(addBox, addPanel('', waitingHint, () => refresh())));

  const stop = poll((refresh = async () => {
    const r = await api('/api/devices');
    gateways = r.gateways;
    clear(waitingHint, r.waiting.length ? h('div', { class: 'note' }, icon('alert'),
      h('span', {}, r.waiting.map((w, i) => [i ? h('br') : null,
        `A gateway with a key ending in `, h('b', { class: 'mono' }, w.hint), ` tried to connect ${ago(w.at)}. Paste its full key here to add it.`]))) : null);
    clear(listBox, gateways.map((g) => gatewayPanel(g, refresh)));
    if (gateways.some((g) => g.connected) && !consoleBuilt) {
      consoleBuilt = true;
      consoleBox.append(atConsole(() => gateways.filter((g) => g.connected)));
    }
    if (logItems.length <= 60) await loadLog();
  }), 5000);
  return stop;
}

function addPanel(serverUrl, waitingHint, onAdded) {
  const key = h('input', {
    class: 'input mono', id: 'devkey', placeholder: 'K7Q2-M9XD-4TPA-W3HZ', autocomplete: 'off', spellcheck: 'false',
    autocapitalize: 'characters', maxlength: 19, required: true,
  });
  key.addEventListener('input', () => {
    const raw = key.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16);
    key.value = (raw.match(/.{1,4}/g) || []).join('-');
  });
  const name = h('input', { class: 'input', id: 'devname', placeholder: 'Home', maxlength: 40 });
  const err = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Add gateway');
  const form = h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      await busy(btn, async () => {
        try {
          const g = await api('/api/devices', { method: 'POST', body: { key: key.value, name: name.value } });
          toast(`Added. Gateway …${g.hint} can connect now.`);
          key.value = '';
          name.value = '';
          onAdded();
        } catch (ex) {
          err.textContent = ex.message;
        }
      });
    },
  },
    h('div', { class: 'field' }, h('label', { for: 'devkey' }, 'Device key'), key,
      h('p', { class: 'hint' }, 'Shown on the gateway setup page and on its screen.')),
    h('div', { class: 'field' }, h('label', { for: 'devname' }, 'Name (optional)'), name),
    waitingHint,
    err,
    h('div', { class: 'row' }, btn)
  );
  return panel('Add a gateway', null, h('div', { class: 'panel-body split even' },
    form,
    h('ol', { class: 'steps' },
      h('li', {}, 'Power the gateway. Until it is set up it opens the Wi-Fi ', h('b', {}, 'SMS-Gateway-…'),
        ' (password ', h('code', {}, 'smsgateway'), ').'),
      h('li', {}, 'Join it with your phone. The setup page opens by itself, or open ', h('code', {}, 'http://192.168.4.1'), '.'),
      h('li', {}, 'Choose your Wi-Fi and enter this server address:',
        serverUrl ? h('div', { class: 'secret', style: { marginTop: '6px' } },
          h('input', { class: 'input', readonly: true, value: serverUrl, 'aria-label': 'Server address', onfocus: (e) => e.target.select() }),
          h('button', { class: 'btn', type: 'button', onclick: () => copy(serverUrl), 'aria-label': 'Copy server address' }, icon('copy'))) : null),
      h('li', {}, 'Copy the device key from the setup page and add it here. The gateway shows up within a few seconds.')
    )
  ));
}

async function runJob(deviceId, body, onDone) {
  const job = await api(`/api/devices/${encodeURIComponent(deviceId)}/jobs`, { method: 'POST', body });
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    await new Promise((r) => setTimeout(r, 1000));
    const j = await api(`/api/jobs/${job.id}`);
    if (['done', 'failed', 'lost'].includes(j.status)) return onDone(j);
  }
  onDone({ status: 'lost', result: 'No answer within 2 minutes' });
}

function gatewayPanel(g, refresh) {
  const act = (label, iconName, body, confirmText) =>
    h('button', {
      class: 'btn', type: 'button', disabled: !g.online,
      onclick: async (e) => {
        if (confirmText && !confirm(confirmText)) return;
        await busy(e.currentTarget, async () => {
          try {
            toast('Sent to the gateway');
            await runJob(g.id, body, (j) => toast(j.status === 'done' ? `${label}: done` : `${label}: ${j.result || j.status}`, j.status === 'done' ? '' : 'bad'));
          } catch (ex) {
            toast(ex.message, 'bad');
          }
        });
      },
    }, icon(iconName), label);

  const remove = h('button', {
    class: 'btn danger', type: 'button',
    onclick: async () => {
      if (!confirm(`Remove "${g.name}"? Its key stops working at once; add it again to reconnect. Messages and calls stay.`)) return;
      try {
        await api(`/api/devices/key/${g.key_id}`, { method: 'DELETE' });
        toast('Gateway removed');
        refresh();
      } catch (ex) {
        toast(ex.message, 'bad');
      }
    },
  }, icon('trash'), 'Remove');

  const badge = !g.connected
    ? h('span', { class: 'badge warn' }, 'Waiting for its first check-in')
    : h('span', { class: `badge ${g.online ? 'ok' : 'bad'}` }, g.online ? 'Online' : `Offline · ${ago(g.last_seen)}`);

  return panel(g.name, badge,
    h('div', { class: 'panel-body form' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Key'), h('dd', { class: 'mono' }, `…${g.hint}`),
        h('dt', {}, 'Added'), h('dd', {}, shortTime(g.added_at)),
        g.connected ? [h('dt', {}, 'ID'), h('dd', { class: 'mono' }, g.id), h('dt', {}, 'Firmware'), h('dd', {}, g.fw || '–')] : null
      ),
      g.connected
        ? h('div', { class: 'row' },
            act('Restart gateway', 'power', { type: 'reboot' }, 'Restart the ESP32? SMS sending pauses for about 30 seconds.'),
            act('Restart SIM 1 module', 'refresh', { type: 'modem_reset', slot: 1 }, null),
            act('Restart SIM 2 module', 'refresh', { type: 'modem_reset', slot: 2 }, null),
            act('Open Wi-Fi setup', 'hotspot', { type: 'setup' },
              'Open the setup hotspot? The gateway stays online and also starts the "SMS-Gateway-…" Wi-Fi so you can change its settings from a phone.'),
            remove)
        : h('div', { class: 'row' },
            h('p', { class: 'muted small grow' }, 'Finish the setup on the gateway (Wi-Fi and server address). It turns online here a few seconds later.'),
            remove)
    )
  );
}

function atConsole(getGateways) {
  let slot = 1;
  const out = h('pre', { class: 'console', 'aria-live': 'polite' },
    h('span', { class: 'dim' }, 'Commands go to the chosen SIM800L. Answers take a few seconds (the gateway checks in every 5 s).\n'));
  const input = h('input', { class: 'input mono grow', placeholder: 'AT+CSQ', 'aria-label': 'AT command', autocomplete: 'off', spellcheck: 'false' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('send'), 'Run');
  const line = (cls, text) => {
    out.append(h('span', { class: cls }, text), '\n');
    out.scrollTop = out.scrollHeight;
  };
  const run = async (cmd) => {
    cmd = cmd.trim();
    if (!cmd) return;
    const g = getGateways().find((d) => d.online) || getGateways()[0];
    if (!g) return line('err', 'No gateway connected');
    line('cmd', `[${clock(Date.now())}] SIM ${slot} > ${cmd}`);
    await busy(btn, async () => {
      try {
        await runJob(g.id, { type: 'at', slot, cmd }, (j) => line(j.status === 'done' ? '' : 'err', (j.result || j.status).trim()));
      } catch (e) {
        line('err', e.message);
      }
    });
  };
  const form = h('form', { class: 'row', onsubmit: (e) => (e.preventDefault(), run(input.value), input.select()) },
    segmented([[1, 'SIM 1'], [2, 'SIM 2']], slot, (v) => (slot = v), 'SIM'), input, btn);
  return panel('AT console', null,
    h('div', { class: 'panel-body form' },
      form,
      h('div', { class: 'chips' }, PRESETS.map(([cmd, what]) =>
        h('button', { class: 'chip', type: 'button', title: what, onclick: () => ((input.value = cmd), run(cmd)) }, cmd))),
      out
    )
  );
}
