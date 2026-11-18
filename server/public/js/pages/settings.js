import { h, clear, icon, api, toast, busy, copy, panel, plural, simState } from '../ui.js';

export default function settings(page) {
  const body = h('div', { style: { display: 'contents' } }, h('div', { class: 'skeleton' }));
  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Settings'), h('p', { class: 'sub' }, 'Gateway connection, call handling, Telegram, webhooks and the API.'))
    ),
    body
  );
  const load = async () => {
    try {
      const [st, fw, tg] = await Promise.all([api('/api/settings'), api('/api/firmware'), api('/api/telegram')]);
      draw(st, fw, tg);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  function draw(st, fw, tg) {
    clear(body,
      h('div', { class: 'split even' },
        panel('Connect a gateway', null, h('div', { class: 'panel-body form' },
          h('p', { class: 'muted' }, 'Enter this address on the gateway setup page (the "SMS-Gateway-…" Wi-Fi). Then add the key the gateway shows under Devices.'),
          secret('Server address', st.server_url),
          h('div', { class: 'row' }, h('a', { class: 'btn', href: '/devices' }, icon('device'), 'Devices'))
        )),
        panel('Incoming calls', null, h('div', { class: 'panel-body form' }, callMode(st)))
      ),
      telegramPanel(tg, load),
      firmwarePanel(fw, load),
      ledPanel(st, load),
      webhook(st, load),
      apiPanel(st, load)
    );
  }

  load();
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

function telegramPanel(tg, reload) {
  const token = h('input', {
    class: 'input mono', id: 'tgtoken', type: 'password', autocomplete: 'off', spellcheck: 'false',
    placeholder: tg.token_set ? `Saved (ends in ${tg.token_hint}). Paste a new token to change it.` : '123456789:AAE…',
  });
  const sms = h('input', { type: 'checkbox', checked: tg.sms });
  const calls = h('input', { type: 'checkbox', checked: tg.calls });

  // one row per line (gateway + SIM slot) with its chat IDs
  const inputs = new Map();
  let lastInput = null;
  const lineName = (l) => `${l.gateway} · ${l.name ? `${l.name} (SIM ${l.slot})` : `SIM ${l.slot}`}`;
  const rows = tg.lines.map((l) => {
    const key = `${l.device}:${l.slot}`;
    const input = h('input', {
      class: 'input mono grow', value: l.chats.join(', '), spellcheck: 'false',
      placeholder: 'Chat IDs, e.g. 123456789', 'aria-label': `Chat IDs for ${lineName(l)}`,
      onfocus: () => (lastInput = { input, name: lineName(l) }),
    });
    inputs.set(key, input);
    const test = h('button', {
      class: 'btn', type: 'button', disabled: !tg.token_set,
      onclick: () => busy(test, async () => {
        try {
          const r = await api('/api/telegram/test', { method: 'POST', body: { line: key, chats: input.value } });
          const bad = r.results.filter((x) => !x.ok);
          toast(bad.length ? `Not sent to ${bad.map((b) => `${b.chat} (${b.error})`).join(', ')}` : `Test sent to ${plural(r.results.length, 'chat')}`, bad.length ? 'bad' : '');
        } catch (e) {
          toast(e.message, 'bad');
        }
      }),
    }, icon('send'), 'Test');
    const detail = l.operator || (l.state ? simState(l.state)[1] : 'Nothing reported yet');
    return h('tr', {},
      h('td', { style: { whiteSpace: 'nowrap' } }, h('b', {}, lineName(l)), h('div', { class: 'hint' }, detail)),
      h('td', { style: { width: '100%' } }, h('div', { class: 'row' }, input, test)));
  });

  // chats that wrote to the bot: click one to add it to the line box you clicked last
  const found = h('div', { class: 'chips' });
  const find = h('button', {
    class: 'btn', type: 'button', disabled: !tg.token_set,
    onclick: () => busy(find, async () => {
      try {
        const r = await api('/api/telegram/chats');
        clear(found, r.chats.length
          ? r.chats.map((c) => h('button', {
            class: 'chip', type: 'button', title: 'Add this chat to the line you clicked last',
            onclick: () => {
              if (!lastInput) return copy(c.id);
              const ids = lastInput.input.value.split(/[\s,;]+/).filter(Boolean);
              if (!ids.includes(c.id)) lastInput.input.value = [...ids, c.id].join(', ');
              toast(`${c.name} added to ${lastInput.name}. Press Save.`);
            },
          }, `${c.name} · ${c.id}`))
          : h('p', { class: 'hint' }, `No chats yet. Open ${tg.bot ? '@' + tg.bot.username : 'your bot'} in Telegram, press Start (or write in the group), then try again.`));
      } catch (e) {
        toast(e.message, 'bad');
      }
    }),
  }, icon('search'), 'Find chats');

  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save');
  const remove = tg.token_set ? h('button', {
    class: 'btn danger', type: 'button',
    onclick: () => {
      if (!confirm('Remove the bot? SMS stop going to Telegram. The chat IDs stay saved.')) return;
      busy(remove, async () => {
        try {
          await api('/api/telegram', { method: 'PUT', body: { token: '' } });
          toast('Telegram bot removed');
          reload();
        } catch (e) {
          toast(e.message, 'bad');
        }
      });
    },
  }, icon('trash'), 'Remove bot') : null;

  const status = tg.bot
    ? h('a', { class: 'badge ok', href: `https://t.me/${tg.bot.username}`, target: '_blank', rel: 'noopener' }, `@${tg.bot.username}`)
    : h('span', { class: 'badge plain' }, 'Not connected');

  return panel('Telegram', status, h('form', {
    class: 'panel-body form',
    onsubmit: async (e) => {
      e.preventDefault();
      await busy(save, async () => {
        try {
          const body = { sms: sms.checked, calls: calls.checked, routes: Object.fromEntries([...inputs].map(([k, i]) => [k, i.value])) };
          if (token.value.trim()) body.token = token.value.trim();
          const r = await api('/api/telegram', { method: 'PUT', body });
          toast(r.bot ? `Saved. Messages go out through @${r.bot.username}.` : 'Saved');
          reload();
        } catch (ex) {
          toast(ex.message, 'bad');
        }
      });
    },
  },
    h('p', { class: 'muted' }, 'The server sends each SMS a SIM receives, and its missed calls, to the Telegram chats you choose for that SIM. A long SMS arrives as one message, joined from its parts.'),
    h('div', { class: 'split even' },
      h('div', { class: 'form' },
        h('ol', { class: 'steps small' },
          h('li', {}, 'In Telegram, open ', h('a', { href: 'https://t.me/BotFather', target: '_blank', rel: 'noopener' }, '@BotFather'), ', send /newbot and follow the steps. Paste the token it gives you below.'),
          h('li', {}, 'Open your new bot and press Start. For a group, add the bot to the group and write any message there.'),
          h('li', {}, 'Press Find chats, click a SIM line below, then click a chat to add it. One SIM can go to several chats.')
        ),
        h('div', { class: 'field' }, h('label', { for: 'tgtoken' }, 'Bot token'), token)
      ),
      h('div', { class: 'form' },
        h('label', { class: 'radio' }, sms, h('div', {}, h('b', {}, 'Send received SMS'), h('span', {}, 'Every SMS a SIM receives, with the sender and the text.'))),
        h('label', { class: 'radio' }, calls, h('div', {}, h('b', {}, 'Send missed calls'), h('span', {}, 'Who called which SIM.'))),
        h('div', { class: 'row' }, find),
        found
      )
    ),
    tg.lines.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'SIM line'), h('th', {}, 'Send to these chats'))),
        h('tbody', {}, rows)))
      : h('p', { class: 'hint' }, 'The SIM lines show up here once a gateway has checked in.'),
    tg.waiting ? h('p', { class: 'hint' }, `${plural(tg.waiting, 'message')} waiting to go to Telegram.`) : null,
    h('div', { class: 'row' }, save, remove)
  ));
}

function firmwarePanel(fw, reload) {
  const auto = h('input', { type: 'checkbox', id: 'fwauto', checked: fw.auto });
  const hour = h('select', { class: 'select', id: 'fwhour', style: { maxWidth: '140px' } },
    Array.from({ length: 24 }, (_, i) => h('option', { value: String(i) }, `${String(i).padStart(2, '0')}:00`)));
  hour.value = String(fw.hour);
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save');
  const check = h('button', {
    class: 'btn', type: 'button',
    onclick: () => busy(check, async () => {
      try {
        const r = await api('/api/firmware/check', { method: 'POST' });
        toast(r.error ? `Check failed: ${r.error}` : r.latest ? `Newest release: ${r.latest.version}` : 'No firmware release found yet', r.error ? 'bad' : '');
        reload();
      } catch (e) {
        toast(e.message, 'bad');
      }
    }),
  }, icon('refresh'), 'Check now');
  const l = fw.latest;
  const sameZone = fw.tz === tz;
  return panel('Firmware updates', null, h('div', { class: 'panel-body split even' },
    h('form', {
      class: 'form',
      onsubmit: async (e) => {
        e.preventDefault();
        await busy(save, async () => {
          try {
            await api('/api/firmware', { method: 'PUT', body: { auto: auto.checked, hour: Number(hour.value), tz } });
            toast(auto.checked ? `Gateways update daily at ${hour.value.padStart(2, '0')}:00` : 'Automatic updates off');
            reload();
          } catch (ex) {
            toast(ex.message, 'bad');
          }
        });
      },
    },
      h('label', { class: 'radio' }, auto,
        h('div', {}, h('b', {}, 'Install updates automatically'),
          h('span', {}, 'Once a day at the hour below, a gateway with older firmware installs the newest release and restarts (about 30 s without SMS).'))),
      h('div', { class: 'field' }, h('label', { for: 'fwhour' }, `Daily at (${tz})`), hour,
        sameZone ? null : h('p', { class: 'hint' }, `Saved for ${fw.tz}; saving uses your time zone.`)),
      h('div', { class: 'row' }, save),
      h('p', { class: 'hint' }, 'You can also update one gateway at once on the Devices page. If a new firmware cannot reach the server, the gateway goes back to the old one by itself.')
    ),
    h('div', { class: 'form' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Newest release'), h('dd', {}, l ? [h('b', {}, l.version), l.published_at ? ` · ${new Date(l.published_at).toLocaleDateString()}` : ''] : 'none found yet'),
        h('dt', {}, 'On this server'), h('dd', {}, fw.ready ? `${fw.ready}, ready to install` : 'nothing downloaded yet'),
        h('dt', {}, 'Source'), h('dd', {}, h('a', { href: `https://github.com/${fw.repo}/releases`, target: '_blank', rel: 'noopener' }, `github.com/${fw.repo}`)),
        h('dt', {}, 'Last check'), h('dd', {}, fw.checked_at ? new Date(fw.checked_at).toLocaleString() : 'not yet', fw.error ? h('span', { class: 'error-text' }, ` · ${fw.error}`) : '')
      ),
      l?.page ? h('a', { href: l.page, target: '_blank', rel: 'noopener', class: 'small' }, `What is new in ${l.version}`) : null,
      h('div', { class: 'row' }, check)
    )
  ));
}

const MODE_LABELS = { solid: 'Steady', pulse: 'Breathing', slow: 'Slow blink', blink: 'Blink', fast: 'Fast blink', flash: 'Short flash', off: 'Off' };

function ledPanel(st, reload) {
  const led = st.led;
  const bright = h('input', { type: 'range', min: 0, max: 100, step: 5, value: led.brightness, id: 'ledb', style: { width: '100%', accentColor: 'var(--accent)' } });
  const brightOut = h('b', { class: 'num' }, `${led.brightness}%`);
  bright.addEventListener('input', () => (brightOut.textContent = `${bright.value}%`));
  const rows = st.led_states.map(([key, desc]) => {
    const cur = led.states[key];
    const dot = h('span', { class: `led-dot ${cur.mode}` });
    dot.style.setProperty('--c', cur.color); // custom properties need setProperty
    const color = h('input', { type: 'color', value: cur.color, 'aria-label': `${desc}: color` });
    const mode = h('select', { class: 'select', 'aria-label': `${desc}: pattern` },
      st.led_modes.map((m) => h('option', { value: m }, MODE_LABELS[m] || m)));
    mode.value = cur.mode;
    const sync = () => {
      dot.className = `led-dot ${mode.value}`;
      dot.style.setProperty('--c', color.value);
    };
    color.addEventListener('input', sync);
    mode.addEventListener('change', sync);
    return { key, color, mode, el: h('tr', {}, h('td', {}, dot), h('td', {}, desc), h('td', {}, color), h('td', {}, mode)) };
  });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save');
  const reset = h('button', {
    class: 'btn', type: 'button',
    onclick: () => busy(reset, async () => {
      await api('/api/settings', { method: 'PUT', body: { led: 'default' } });
      toast('Default colors back');
      reload();
    }),
  }, 'Default colors');
  return panel('Status light', null, h('form', {
    class: 'panel-body form',
    onsubmit: async (e) => {
      e.preventDefault();
      await busy(save, async () => {
        try {
          const states = Object.fromEntries(rows.map((r) => [r.key, { color: r.color.value, mode: r.mode.value }]));
          await api('/api/settings', { method: 'PUT', body: { led: { brightness: Number(bright.value), states } } });
          toast('Saved. The gateway uses it from its next check-in.');
        } catch (ex) {
          toast(ex.message, 'bad');
        }
      });
    },
  },
    h('p', { class: 'muted' }, 'The RGB light on the ESP32 shows what the gateway is doing. Choose a color and pattern for each state.'),
    h('div', { class: 'field' }, h('label', { for: 'ledb', class: 'row', style: { justifyContent: 'space-between' } }, 'Brightness', brightOut), bright),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table led-table' },
      h('thead', {}, h('tr', {}, h('th', {}, h('span', { class: 'sr-only' }, 'Preview')), h('th', {}, 'When'), h('th', {}, 'Color'), h('th', {}, 'Pattern'))),
      h('tbody', {}, rows.map((r) => r.el)))),
    h('div', { class: 'row' }, save, reset)
  ));
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
