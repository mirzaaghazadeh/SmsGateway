import { h, clear, icon, api, poll, toast, busy, segmented, emptyState, plural, simTag, simOn } from '../ui.js';
import { analyzeText, MAX_PARTS } from '../gsm.js';
import { messageRow } from './parts.js';

const FILTERS = [
  ['all', 'All'],
  ['in', 'Received'],
  ['out', 'Sent'],
  ['failed', 'Failed'],
  ['queued', 'Waiting'],
];

export default function messages(page, { params }) {
  let filter = 'all';
  let q = '';
  let items = [];
  let more = false;
  let extraPages = false;
  const open = new Set();

  const list = h('div', {}, h('div', { class: 'skeleton', style: { margin: '18px' } }));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Number or text', 'aria-label': 'Search messages' });
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      q = search.value.trim();
      load();
    }, 250);
  });

  const query = (before) => {
    const p = new URLSearchParams({ limit: '40' });
    if (filter === 'in' || filter === 'out') p.set('direction', filter);
    if (filter === 'failed') p.set('status', 'failed');
    if (filter === 'queued') p.set('status', 'queued');
    if (q) p.set('q', q);
    if (before) p.set('before', before);
    return `/api/messages?${p}`;
  };

  async function load() {
    const r = await api(query());
    items = r.items;
    more = r.more;
    extraPages = false;
    draw();
  }

  async function loadMore(btn) {
    await busy(btn, async () => {
      const r = await api(query(items[items.length - 1].id));
      items = items.concat(r.items);
      more = r.more;
      extraPages = true;
      draw();
    });
  }

  async function retry(m) {
    try {
      await api(`/api/messages/${m.id}/retry`, { method: 'POST' });
      toast('Queued again');
      load();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  function draw() {
    if (!items.length) {
      clear(list, emptyState('inbox', q ? 'Nothing matches your search' : 'No messages here',
        q ? 'Try part of the number or a word from the text.' : filter === 'all' ? 'Send one with the form, or text the SIM number.' : null));
      return;
    }
    clear(list,
      h('ul', { class: 'list' }, items.map((m) => messageRow(m, {
        open: open.has(m.id),
        onToggle: (id, v) => (v ? open.add(id) : open.delete(id)),
        onRetry: retry,
      }))),
      more ? h('div', { class: 'more' }, h('button', { class: 'btn sm', type: 'button', onclick: (e) => loadMore(e.currentTarget) }, 'Show older')) : null
    );
  }

  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Messages'), h('p', { class: 'sub' }, 'Everything received and sent through both SIM cards.'))
    ),
    h('div', { class: 'split' },
      h('section', { class: 'panel' },
        h('div', { class: 'toolbar' },
          segmented(FILTERS, filter, (v) => {
            filter = v;
            load();
          }, 'Filter messages'),
          h('label', { class: 'search' }, icon('search'), search)
        ),
        list
      ),
      compose(params.get('to') || '', load)
    )
  );

  // keep the first page fresh; stop refreshing once older pages are loaded
  return poll(() => (extraPages ? null : load()), 8000);
}

function compose(prefill, onSent) {
  const to = h('input', { class: 'input mono', id: 'to', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '+1 555 123 4567', value: prefill, required: true });
  const sim = h('select', { class: 'select', id: 'sim' },
    h('option', { value: '0' }, 'Any ready SIM'),
    [1, 2].filter((s) => simOn(s)).map((s) => h('option', { value: String(s) }, simTag(s)))
  );
  const text = h('textarea', { class: 'textarea', id: 'text', dir: 'auto', required: true, placeholder: 'Message' });
  const left = h('span', {});
  const right = h('span', {});
  const err = h('p', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('send'), 'Send');

  const update = () => {
    const a = analyzeText(text.value);
    left.textContent = `${a.encoding}${a.encoding === 'UCS-2' ? ' (Unicode)' : ''}`;
    right.textContent = text.value ? `${a.units} / ${a.parts * a.perPart} · ${plural(a.parts, 'SMS', 'SMS')}` : `0 / ${a.perPart}`;
    right.className = a.parts > MAX_PARTS ? 'warn' : '';
  };
  text.addEventListener('input', update);
  update();

  const form = h('form', {
    class: 'form panel-body',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (analyzeText(text.value).parts > MAX_PARTS) {
        err.textContent = `Too long: at most ${MAX_PARTS} SMS per message.`;
        return;
      }
      await busy(btn, async () => {
        try {
          const m = await api('/api/messages', { method: 'POST', body: { to: to.value, text: text.value, sim: Number(sim.value) } });
          toast(`Queued for ${m.number}`);
          text.value = '';
          update();
          onSent();
        } catch (ex) {
          err.textContent = ex.message;
        }
      });
    },
  },
    h('div', { class: 'field' }, h('label', { for: 'to' }, 'To'), to,
      h('p', { class: 'hint' }, 'With country code for numbers abroad, e.g. +49…')),
    h('div', { class: 'field' }, h('label', { for: 'sim' }, 'Send from'), sim),
    h('div', { class: 'field' }, h('label', { for: 'text' }, 'Text'), text, h('div', { class: 'counter' }, left, right)),
    h('p', { class: 'hint' }, 'Persian, Turkish ş ğ ı and emoji switch to Unicode: 70 characters per SMS instead of 160.'),
    err,
    h('div', { class: 'row' }, btn)
  );
  if (prefill) setTimeout(() => text.focus(), 50);
  // On narrow screens the form sits above the list, folded until "Write" is pressed.
  const section = h('section', { class: `panel sticky compose ${prefill ? '' : 'collapsed'}` });
  const toggle = h('button', {
    class: 'btn sm toggle', type: 'button', 'aria-expanded': String(!!prefill),
    onclick: () => {
      const open = section.classList.toggle('collapsed') === false;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.lastChild.textContent = open ? 'Close' : 'Write';
      if (open) to.focus();
    },
  }, icon('plus'), h('span', {}, prefill ? 'Close' : 'Write'));
  section.append(h('div', { class: 'panel-head' }, h('h2', {}, 'New message'), toggle), form);
  return section;
}
