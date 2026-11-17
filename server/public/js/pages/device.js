import { h, clear, icon, api, poll, toast, busy, segmented, emptyState, panel, ago, clock } from '../ui.js';
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

export default function device(page) {
  const devBox = h('div', { style: { display: 'contents' } }, h('div', { class: 'skeleton' }));
  const logBox = h('div', {});
  let devices = [];
  let consoleBuilt = false;
  const consoleBox = h('div', { style: { display: 'contents' } });

  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Device'), h('p', { class: 'sub' }, 'Restart parts of the gateway, talk to the SIM800L modules, read the event log.'))
    ),
    devBox,
    consoleBox,
    panel('Event log', null, logBox)
  );

  let logItems = [];
  let logMore = false;
  async function loadLog(before) {
    const r = await api(`/api/logs?limit=60${before ? `&before=${before}` : ''}`);
    logItems = before ? logItems.concat(r.items) : r.items;
    logMore = r.more;
    clear(logBox,
      logItems.length ? logList(logItems) : emptyState('terminal', 'Nothing logged yet'),
      logMore ? h('div', { class: 'more' }, h('button', { class: 'btn sm', type: 'button', onclick: (e) => busy(e.currentTarget, () => loadLog(logItems.at(-1).id)) }, 'Show older')) : null
    );
  }

  const stop = poll(async () => {
    devices = await api('/api/devices');
    clear(devBox, devices.length ? devices.map(deviceTools) : panel('Gateway', null, emptyState('device', 'No gateway connected yet', 'Set it up from the Overview page.')));
    if (devices.length && !consoleBuilt) {
      consoleBuilt = true;
      consoleBox.append(atConsole(() => devices));
    }
    if (logItems.length <= 60) await loadLog();
  }, 8000);
  return stop;
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

function deviceTools(dev) {
  const act = (label, iconName, body, confirmText, cls = '') =>
    h('button', {
      class: `btn ${cls}`, type: 'button', disabled: !dev.online,
      onclick: async (e) => {
        if (confirmText && !confirm(confirmText)) return;
        const btn = e.currentTarget;
        await busy(btn, async () => {
          try {
            toast('Sent to the gateway');
            await runJob(dev.id, body, (j) => toast(j.status === 'done' ? `${label}: done` : `${label}: ${j.result || j.status}`, j.status === 'done' ? '' : 'bad'));
          } catch (ex) {
            toast(ex.message, 'bad');
          }
        });
      },
    }, icon(iconName), label);

  return panel(dev.name || 'SMS Gateway',
    h('span', { class: `badge ${dev.online ? 'ok' : 'bad'}` }, dev.online ? 'Online' : `Offline · ${ago(dev.last_seen)}`),
    h('div', { class: 'panel-body form' },
      h('p', { class: 'muted small' }, 'ID ', h('code', {}, dev.id), dev.online ? '' : '. The buttons work again when the gateway is back online.'),
      h('div', { class: 'row' },
        act('Restart gateway', 'power', { type: 'reboot' }, 'Restart the ESP32? SMS sending pauses for about 30 seconds.'),
        act('Restart SIM 1 module', 'refresh', { type: 'modem_reset', slot: 1 }, null),
        act('Restart SIM 2 module', 'refresh', { type: 'modem_reset', slot: 2 }, null),
        act('Open Wi-Fi setup', 'hotspot', { type: 'setup' },
          'Open the setup hotspot? The gateway stays online and also starts the "SMS-Gateway-…" Wi-Fi so you can change its settings from a phone.')
      ),
      !dev.online ? h('div', { class: 'row' }, h('button', {
        class: 'btn danger', type: 'button',
        onclick: async () => {
          if (!confirm('Remove this gateway from the panel? Its messages stay. If it comes back online it reappears.')) return;
          await api(`/api/devices/${encodeURIComponent(dev.id)}`, { method: 'DELETE' });
          toast('Removed');
        },
      }, icon('trash'), 'Remove from panel')) : null
    )
  );
}

function atConsole(getDevices) {
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
    const dev = getDevices().find((d) => d.online) || getDevices()[0];
    line('cmd', `[${clock(Date.now())}] SIM ${slot} > ${cmd}`);
    await busy(btn, async () => {
      try {
        await runJob(dev.id, { type: 'at', slot, cmd }, (j) => line(j.status === 'done' ? '' : 'err', (j.result || j.status).trim()));
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
