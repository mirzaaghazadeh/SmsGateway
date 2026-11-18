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
  const simsBox = h('div', { style: { display: 'contents' } });
  const consoleBox = h('div', { style: { display: 'contents' } });
  let simsSig = '';
  const scans = new Map(); // "<device>:<slot>" -> { busy, list, error } of "Find networks"
  const logBox = h('div', {});
  const waitingHint = h('div', {});

  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Devices'),
        h('p', { class: 'sub' }, 'Add gateways, restart them, talk to their SIM800L modules and read the event log.'))
    ),
    addBox,
    listBox,
    simsBox,
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
    clear(listBox, gateways.map((g) => gatewayPanel(g, refresh, r.firmware)));
    // SIM card settings: redraw only when they change, and never while you type in them
    const connected = gateways.filter((g) => g.connected);
    const sig = JSON.stringify([connected.map((g) => [g.id, g.name, g.fw, g.online, g.lines, g.sims.map((x) => [x.slot, x.operator, x.balance, x.balance_at])]),
      [...scans.entries()]]);
    if (sig !== simsSig && !simsBox.contains(document.activeElement)) {
      simsSig = sig;
      clear(simsBox, connected.map((g) => simsPanel(g, scans, () => refresh())));
    }
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

async function runJob(deviceId, body, onDone, maxMs = 120_000) {
  const job = await api(`/api/devices/${encodeURIComponent(deviceId)}/jobs`, { method: 'POST', body });
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 1000));
    const j = await api(`/api/jobs/${job.id}`);
    if (['done', 'failed', 'lost'].includes(j.status)) return onDone(j);
  }
  onDone({ status: 'lost', result: `No answer within ${Math.round(maxMs / 60000)} minutes` });
}

// "+COPS: (2,"Operator A","OPA","28601"),(1,...),,(0-4),(0-2)" -> [{ stat, name, code }]
// stat: 1 available, 2 in use now, 3 not allowed for this SIM
function parseNetworks(text) {
  const out = [];
  const re = /\((\d),"([^"]*)","([^"]*)","(\d{5,6})"(?:,\d+)?\)/g;
  let m;
  while ((m = re.exec(text || ''))) out.push({ stat: Number(m[1]), name: m[2] || m[3] || m[4], code: m[4] });
  return out;
}

const NET_STAT = { 2: ' · in use now', 3: ' · not allowed for this SIM' };

// One row per SIM slot: a name, on/off, and the mobile network (automatic or chosen).
function simsPanel(g, scans, refresh) {
  const fwOk = newer(g.fw, '1.1.9');
  const save = async (slot, body, okText) => {
    try {
      await api(`/api/devices/${encodeURIComponent(g.id)}/sims/${slot}`, { method: 'PUT', body });
      toast(okText);
      refresh();
    } catch (e) {
      toast(e.message, 'bad');
      refresh();
    }
  };
  const row = (slot) => {
    const line = g.lines[slot];
    const sim = g.sims.find((x) => x.slot === slot);
    const key = `${g.id}:${slot}`;
    const scan = scans.get(key) || {};

    const name = h('input', {
      class: 'input', value: line.name, maxlength: 24, placeholder: 'e.g. Work', 'aria-label': `Name of SIM ${slot}`,
      style: { width: '170px' },
      onkeydown: (e) => e.key === 'Enter' && e.target.blur(),
      onchange: (e) => save(slot, { name: e.target.value }, e.target.value.trim() ? `SIM ${slot} is now "${e.target.value.trim()}"` : `SIM ${slot} name removed`),
    });

    const on = h('input', {
      type: 'checkbox', checked: line.enabled, 'aria-label': `SIM ${slot} on`,
      onchange: (e) => {
        if (!e.target.checked && !confirm(`Turn SIM ${slot} off? The gateway stops using this slot and the panel hides it. You can turn it on here again at any time.`)) {
          e.target.checked = true;
          return;
        }
        save(slot, { enabled: e.target.checked }, e.target.checked ? `SIM ${slot} on` : `SIM ${slot} off`);
      },
    });

    const nets = scan.list || [];
    const net = h('select', {
      class: 'select', 'aria-label': `Mobile network of SIM ${slot}`, disabled: !line.enabled,
      style: { width: 'auto', flex: '1 1 200px', maxWidth: '340px' },
    },
      h('option', { value: 'auto' }, 'Automatic'),
      nets.map((n) => h('option', { value: n.code, disabled: n.stat === 3 }, `${n.name} (${n.code})${NET_STAT[n.stat] || ''}`)),
      line.network !== 'auto' && !nets.some((n) => n.code === line.network) ? h('option', { value: line.network }, `Network ${line.network}`) : null,
      h('option', { value: 'other' }, 'Other code…')
    );
    net.value = line.network;
    net.addEventListener('change', () => {
      let v = net.value;
      if (v === 'other') {
        v = (prompt('Network code: country + operator, 5 or 6 digits (e.g. 28601)') || '').trim();
        if (!v) {
          net.value = line.network;
          return;
        }
      }
      save(slot, { network: v }, v === 'auto' ? `SIM ${slot}: automatic network` : `SIM ${slot}: network ${v} chosen`);
    });

    const find = h('button', {
      class: `btn ${scan.busy ? 'busy' : ''}`, type: 'button', disabled: !g.online || !line.enabled || scan.busy || !fwOk,
      title: fwOk ? 'Ask the SIM800L which networks it can see (takes up to 3 minutes)' : 'Needs firmware 1.2.0 on the gateway',
      onclick: async () => {
        scans.set(key, { busy: true });
        refresh();
        try {
          await runJob(g.id, { type: 'at', slot, cmd: 'AT+COPS=?' }, (j) => {
            const list = j.status === 'done' ? parseNetworks(j.result) : [];
            scans.set(key, { list, error: list.length ? null : j.result || j.status });
            toast(list.length ? `SIM ${slot}: ${list.length} networks found` : `SIM ${slot}: no networks found (${j.result || j.status})`, list.length ? '' : 'bad');
          }, 240_000);
        } catch (e) {
          scans.set(key, { error: e.message });
          toast(e.message, 'bad');
        }
        refresh();
      },
    }, icon('search'), scan.busy ? 'Searching…' : 'Find networks');

    const state = !line.enabled ? 'Off' : sim?.operator ? `${sim.operator}` : sim ? sim.state : 'not reported yet';
    return h('tr', {},
      h('td', { class: 'nowrap' }, h('b', {}, `SIM ${slot}`), h('div', { class: 'hint' }, state)),
      h('td', {}, name),
      h('td', {}, h('label', { class: 'row', style: { gap: '6px' } }, on, line.enabled ? 'On' : 'Off')),
      h('td', { style: { minWidth: '300px' } }, h('div', { class: 'row' }, net, find),
        scan.error ? h('div', { class: 'hint' }, scan.error) : null)
    );
  };
  const ussdOk = newer(g.fw, '1.2.9');
  const on = [1, 2].filter((slot) => g.lines[slot].enabled);
  return panel(`SIM cards · ${g.name}`, null, h('div', { class: 'panel-body form' },
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Slot'), h('th', {}, 'Name'), h('th', {}, 'In use'), h('th', {}, 'Mobile network'))),
      h('tbody', {}, [1, 2].map(row)))),
    h('p', { class: 'hint' },
      'A name shows up across the panel and in Telegram. Turn a slot off when it has no module or SIM: the gateway stops trying it and the panel hides it. ',
      'Automatic lets the SIM800L pick the network. Pick one to stay on it; if it is gone, the module picks another by itself.'),
    fwOk ? null : h('p', { class: 'note' }, icon('alert'), h('span', {}, `This gateway runs ${g.fw || 'old firmware'}. Names work now; on/off and the network choice need firmware 1.2.0.`)),
    on.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'SIM'), h('th', {}, 'Balance'), h('th', {}, 'Keep-alive SMS'))),
      h('tbody', {}, on.map((slot) => upkeepRow(g, slot, save, refresh, ussdOk))))) : null,
    on.length ? h('p', { class: 'hint' },
      'Balance: the code your operator uses to show the balance (often *123# or *100#). The answer shows here, and the gateway can check it by itself and send it to the Telegram chats of the SIM. ',
      'Keep-alive: many operators switch off a prepaid SIM that has not been used for some months. The gateway sends one SMS to the number you choose (yours, or a free number of the operator) when the SIM sent nothing for that many days. If it sent nothing yet, the first one goes out at once.') : null,
    on.length && !ussdOk ? h('p', { class: 'note' }, icon('alert'), h('span', {}, `Balance checks need firmware 1.3.0 on the gateway (it runs ${g.fw || 'old firmware'}). The keep-alive SMS works now.`)) : null
  ));
}

const EVERY = [[0, 'only when I check'], [1, 'every day'], [3, 'every 3 days'], [7, 'every week'], [14, 'every 2 weeks'], [30, 'every month']];
const KEEP = [[0, 'Off'], [30, 'after 30 days'], [60, 'after 60 days'], [90, 'after 90 days'], [180, 'after 180 days']];
const options = (list, value) => {
  const sel = list.map(([v, label]) => h('option', { value: String(v) }, label));
  if (!list.some(([v]) => v === value)) sel.push(h('option', { value: String(value) }, `after ${value} days`));
  return sel;
};

// Balance code, automatic check and keep-alive SMS of one SIM.
function upkeepRow(g, slot, save, refresh, ussdOk) {
  const line = g.lines[slot];
  const sim = g.sims.find((x) => x.slot === slot);
  const label = line.name || `SIM ${slot}`;

  const code = h('input', {
    class: 'input mono', value: line.ussd, placeholder: '*123#', 'aria-label': `Balance code of ${label}`, style: { width: '110px' },
    onkeydown: (e) => e.key === 'Enter' && e.target.blur(),
    onchange: (e) => save(slot, { ussd: e.target.value }, e.target.value.trim() ? `${label}: balance code ${e.target.value.trim()}` : `${label}: balance code removed`),
  });
  const every = h('select', { class: 'select', 'aria-label': `How often ${label} checks its balance`, style: { width: 'auto' }, disabled: !line.ussd },
    options(EVERY, line.balance_days));
  every.value = String(line.balance_days);
  every.addEventListener('change', () => save(slot, { balance_days: Number(every.value) },
    Number(every.value) ? `${label}: balance checked ${EVERY.find(([v]) => v === Number(every.value))[1]}` : `${label}: balance checked only when you ask`));
  const check = h('button', {
    class: 'btn', type: 'button', disabled: !g.online || !line.ussd || !ussdOk,
    title: !ussdOk ? 'Needs firmware 1.3.0 on the gateway' : !line.ussd ? 'Enter the balance code first' : 'Ask the network now (takes a few seconds)',
    onclick: (e) => busy(e.currentTarget, async () => {
      try {
        await runJob(g.id, { type: 'ussd', slot }, (j) => toast(j.status === 'done' ? `${label}: ${j.result}` : `${label}: ${j.result || j.status}`, j.status === 'done' ? '' : 'bad'), 90_000);
      } catch (ex) {
        toast(ex.message, 'bad');
      }
      refresh();
    }),
  }, icon('refresh'), 'Check now');
  const balance = sim?.balance
    ? h('div', { class: 'balance' }, h('span', {}, sim.balance), h('span', { class: 'hint' }, ` · ${ago(sim.balance_at)}`))
    : h('div', { class: 'hint' }, line.ussd ? 'Not checked yet' : 'No code set');

  const days = h('select', { class: 'select', 'aria-label': `Keep-alive SMS of ${label}`, style: { width: 'auto' } }, options(KEEP, line.keep_days));
  days.value = String(line.keep_days);
  const to = h('input', {
    class: 'input mono', type: 'tel', value: line.keep_to, placeholder: '+15551234567', 'aria-label': `Keep-alive SMS of ${label} goes to`,
    style: { width: '160px' }, onkeydown: (e) => e.key === 'Enter' && e.target.blur(),
  });
  const text = h('input', {
    class: 'input', value: line.keep_text, maxlength: 160, 'aria-label': `Text of the keep-alive SMS of ${label}`,
    style: { flex: '1 1 180px', width: 'auto' }, onkeydown: (e) => e.key === 'Enter' && e.target.blur(),
  });
  const saveKeep = () => {
    const n = Number(days.value);
    if (n && !to.value.trim()) {
      if (document.activeElement !== to) to.focus();
      return toast('Enter the number the keep-alive SMS goes to', 'bad');
    }
    save(slot, { keep_days: n, keep_to: to.value, keep_text: text.value },
      n ? `${label}: keep-alive SMS to ${to.value.trim()} after ${n} days without an SMS` : `${label}: keep-alive off`);
  };
  for (const el of [days, to, text]) el.addEventListener('change', saveKeep);

  return h('tr', {},
    h('td', { class: 'nowrap' }, h('b', {}, label), line.name ? h('div', { class: 'hint' }, `SIM ${slot}`) : null),
    h('td', { style: { minWidth: '300px' } },
      h('div', { class: 'row' }, code, every, check),
      balance),
    h('td', { style: { minWidth: '320px' } },
      h('div', { class: 'row' }, days, to),
      h('div', { class: 'row', style: { marginTop: '6px' } }, text))
  );
}

// true when version a is newer than b ("1.1.0" > "1.0.9")
function newer(a, b) {
  const p = (v) => String(v || '').replace(/^v/, '').split('.').map(Number);
  const x = p(a);
  const y = p(b);
  if (x.length !== 3 || x.some(isNaN)) return false;
  if (y.length !== 3 || y.some(isNaN)) return true;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function firmwareLine(g, latest, refresh) {
  const canUpdate = latest && newer(latest, g.fw);
  const btn = canUpdate ? h('button', {
    class: 'btn sm', type: 'button', disabled: !g.online,
    onclick: (e) => busy(e.currentTarget, async () => {
      try {
        const r = await api(`/api/devices/${encodeURIComponent(g.id)}/update`, { method: 'POST' });
        toast(`The gateway installs ${r.version} at its next check-in and restarts by itself`);
        refresh();
      } catch (ex) {
        toast(ex.message, 'bad');
      }
    }),
  }, icon('refresh'), `Update to ${latest}`) : null;
  return h('dd', { class: 'row', style: { gap: '10px' } },
    h('span', {}, g.fw || '–', canUpdate ? '' : latest ? ' · up to date' : ''),
    btn,
    g.fw_result ? h('span', { class: 'faint small' }, g.fw_result) : null
  );
}

function gatewayPanel(g, refresh, latestFw) {
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
        g.connected ? [h('dt', {}, 'ID'), h('dd', { class: 'mono' }, g.id), h('dt', {}, 'Firmware'), firmwareLine(g, latestFw, refresh)] : null
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
