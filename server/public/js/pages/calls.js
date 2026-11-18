import { h, clear, icon, api, poll, busy, emptyState, timeEl, fullTime, simName } from '../ui.js';
import { callText, filterBar } from './parts.js';

export default function calls(page) {
  let items = [];
  let more = false;
  let q = '';
  let extra = false;
  const list = h('div', {}, h('div', { class: 'skeleton', style: { margin: '18px' } }));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Number', 'aria-label': 'Search calls' });
  let t;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => ((q = search.value.trim()), load()), 250);
  });

  const own = () => (q ? { q } : {});
  const bar = filterBar({ csv: '/api/calls.csv', query: own, onChange: () => load() });
  const url = (before) => `/api/calls?${new URLSearchParams({ limit: '50', ...own(), ...bar.params(), ...(before ? { before } : {}) })}`;

  async function load() {
    const r = await api(url());
    items = r.items;
    more = r.more;
    extra = false;
    draw();
  }

  function draw() {
    if (!items.length) {
      clear(list, emptyState('calls', q ? 'No calls from that number' : bar.active() ? 'No calls on those days or that SIM' : 'No missed calls yet',
        q || bar.active() ? null : 'Call one of the SIM numbers: the gateway logs the caller and hangs up (change this in Settings).'));
      return;
    }
    clear(list,
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Caller'), h('th', {}, 'SIM'), h('th', {}, 'What happened'), h('th', { class: 'r' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', {}, items.map((c) => h('tr', {},
          h('td', { class: 'nowrap', title: fullTime(c.ts) }, timeEl(c.ts)),
          h('td', { class: 'mono nowrap' }, c.number),
          h('td', { class: 'nowrap' }, c.slot ? simName(c.slot, c.device_id) : '–'),
          h('td', { class: 'muted' }, callText(c)),
          h('td', { class: 'r' }, c.number !== 'unknown'
            ? h('a', { class: 'btn sm', href: `/messages?to=${encodeURIComponent(c.number)}` }, icon('send'), 'Text back')
            : null)
        )))
      )),
      more ? h('div', { class: 'more' }, h('button', {
        class: 'btn sm', type: 'button',
        onclick: (e) => busy(e.currentTarget, async () => {
          const r = await api(url(items[items.length - 1].id));
          items = items.concat(r.items);
          more = r.more;
          extra = true;
          draw();
        }),
      }, 'Show older')) : null
    );
  }

  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Missed calls'), h('p', { class: 'sub' }, 'Every call to the SIM cards, with the caller number.'))
    ),
    h('section', { class: 'panel' }, h('div', { class: 'toolbar' }, h('label', { class: 'search' }, icon('search'), search)), bar.el, list)
  );
  return poll(() => (extra ? null : load()), 10000);
}
