import { h, clear, icon, api, toast, busy, copy, panel } from '../ui.js';

export default function settings(page) {
  const body = h('div', { style: { display: 'contents' } }, h('div', { class: 'skeleton' }));
  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Settings'), h('p', { class: 'sub' }, 'Gateway connection, call handling, webhooks and the API.'))
    ),
    body
  );
  const load = async () => {
    try {
      draw(await api('/api/settings'));
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  function draw(st) {
    clear(body,
      h('div', { class: 'split even' },
        panel('Connect a gateway', null, h('div', { class: 'panel-body form' },
          h('p', { class: 'muted' }, 'Enter this address on the gateway setup page (the "SMS-Gateway-…" Wi-Fi). Then add the key the gateway shows under Devices.'),
          secret('Server address', st.server_url),
          h('div', { class: 'row' }, h('a', { class: 'btn', href: '/devices' }, icon('device'), 'Devices'))
        )),
        panel('Incoming calls', null, h('div', { class: 'panel-body form' }, callMode(st)))
      ),
      webhook(st, load),
      apiPanel(st, load)
    );
  }

  load();
}

function secret(label, value, hint) {
  const id = `f-${label.replace(/\W+/g, '-')}`;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('div', { class: 'secret' },
      h('input', { class: 'input', id, readonly: true, value: value || '', onfocus: (e) => e.target.select() }),
      h('button', { class: 'btn', type: 'button', onclick: () => copy(value), 'aria-label': `Copy ${label}` }, icon('copy'))
    ),
    hint ? h('p', { class: 'hint' }, hint) : null
  );
}

function callMode(st) {
  const opt = (value, title, text) => h('label', { class: 'radio' },
    h('input', {
      type: 'radio', name: 'call_mode', value, checked: st.call_mode === value,
      onchange: async () => {
        try {
          await api('/api/settings', { method: 'PUT', body: { call_mode: value } });
          toast('Saved. The gateway uses it from its next check-in.');
        } catch (e) {
          toast(e.message, 'bad');
        }
      },
    }),
    h('div', {}, h('b', {}, title), h('span', {}, text))
  );
  return h('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': 'Incoming calls' },
    opt('reject', 'Hang up and log the caller', 'The caller hears one ring, then busy. Good for missed-call verification.'),
    opt('ignore', 'Let it ring and log the caller', 'The call rings until the caller gives up. Nobody answers it.')
  );
}

function webhook(st, reload) {
  const url = h('input', { class: 'input', id: 'wh', type: 'url', placeholder: 'https://example.com/sms-hook', value: st.webhook_url });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save');
  const test = h('button', {
    class: 'btn', type: 'button',
    onclick: () => busy(test, async () => {
      const r = await api('/api/settings/webhook-test', { method: 'POST' });
      toast(r.ok ? `Test delivered (HTTP ${r.status})` : `Test failed: ${r.error}`, r.ok ? '' : 'bad');
    }),
  }, 'Send test');
  const example = JSON.stringify({ event: 'sms.received', time: '2026-11-17T12:00:00.000Z', data: { id: 42, device: '…', sim: 1, from: '+15551234567', text: 'Hello', parts: 1 } }, null, 2);
  return panel('Webhook', null, h('div', { class: 'panel-body split even' },
    h('form', {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        await busy(save, async () => {
          try {
            await api('/api/settings', { method: 'PUT', body: { webhook_url: url.value } });
            toast(url.value ? 'Webhook saved' : 'Webhook turned off');
            reload();
          } catch (ex) {
            toast(ex.message, 'bad');
          }
        });
      },
    },
      h('p', { class: 'muted' }, 'The server POSTs JSON to this address for every event. Leave it empty to turn webhooks off.'),
      h('div', { class: 'field' }, h('label', { for: 'wh' }, 'URL'), url),
      h('div', { class: 'row' }, save, test),
      secret('Signing secret', st.webhook_secret, 'Header X-Gateway-Signature is sha256= plus the HMAC-SHA256 of the body with this secret.')
    ),
    h('div', { class: 'form' },
      h('span', { class: 'label' }, 'Events'),
      h('div', { class: 'chips' }, st.webhook_events.map((e) => h('code', { class: 'chip', style: { cursor: 'default' } }, e))),
      h('span', { class: 'label' }, 'Example body'),
      h('pre', { class: 'code' }, example)
    )
  ));
}

function apiPanel(st, reload) {
  const base = st.server_url;
  const regen = h('button', {
    class: 'btn danger', type: 'button', disabled: st.api_key_from_env,
    onclick: () => {
      if (!confirm('Make a new API key? Apps using the old key stop working.')) return;
      busy(regen, async () => {
        try {
          await api('/api/settings/api-key', { method: 'POST' });
          toast('New API key made');
          reload();
        } catch (e) {
          toast(e.message, 'bad');
        }
      });
    },
  }, icon('refresh'), 'New key');
  const send = `curl -X POST ${base}/api/v1/sms \\
  -H "Authorization: Bearer ${st.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "+15551234567", "text": "Your code is 4321", "sim": 0}'`;
  const read = `curl "${base}/api/v1/messages?direction=in&since_id=0" \\
  -H "Authorization: Bearer ${st.api_key}"`;
  return panel('API', null, h('div', { class: 'panel-body split even' },
    h('div', { class: 'form' },
      secret('API key', st.api_key, st.api_key_from_env ? 'Set by API_KEY on the server.' : null),
      h('div', { class: 'row' }, regen),
      h('dl', { class: 'kv' },
        h('dt', {}, h('code', {}, 'POST /api/v1/sms')), h('dd', {}, 'send: to, text, sim (0 any, 1, 2)'),
        h('dt', {}, h('code', {}, 'GET /api/v1/sms/:id')), h('dd', {}, 'status of one SMS'),
        h('dt', {}, h('code', {}, 'GET /api/v1/messages')), h('dd', {}, 'direction, since_id, limit'),
        h('dt', {}, h('code', {}, 'GET /api/v1/calls')), h('dd', {}, 'since_id, limit'),
        h('dt', {}, h('code', {}, 'GET /api/v1/status')), h('dd', {}, 'gateways and SIM cards')
      )
    ),
    h('div', { class: 'form' },
      h('span', { class: 'label' }, 'Send an SMS'),
      h('pre', { class: 'code' }, send),
      h('span', { class: 'label' }, 'Read received messages'),
      h('pre', { class: 'code' }, read)
    )
  ));
}
