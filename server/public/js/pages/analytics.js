import { h, clear, api, segmented, panel, emptyState, toast, simTag } from '../ui.js';
import { barChart, legend } from '../charts.js';

const RANGES = [
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
];
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayLabel = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayTitle = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'long' });

export default function analytics(page) {
  let days = 30;
  const body = h('div', { style: { display: 'contents' } }, h('div', { class: 'skeleton' }));
  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Analytics'), h('p', { class: 'sub' }, `Traffic per day, in your time zone (${tz}).`)),
      h('div', { class: 'actions' }, segmented(RANGES, days, (v) => ((days = v), load()), 'Time range'))
    ),
    body
  );

  async function load() {
    try {
      draw(await api(`/api/stats?days=${days}&tz=${encodeURIComponent(tz)}`));
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  function draw(st) {
    const t = st.totals;
    const attempts = t.sent + t.failed;
    const rows = st.daily.map((d) => {
      const date = new Date(`${d.date}T12:00:00`);
      return { ...d, label: dayLabel.format(date), title: dayTitle.format(date) };
    });
    const msgSeries = [
      { key: 'received', label: 'Received', color: 'var(--accent)', square: true },
      { key: 'sent', label: 'Sent', color: 'var(--wifi)', square: true },
      { key: 'failed', label: 'Failed', color: 'var(--bad)', square: true },
    ];
    const callSeries = [{ key: 'calls', label: 'Missed calls', color: 'var(--warn)', square: true }];
    clear(body,
      h('section', { class: 'panel', 'aria-label': 'Totals' },
        h('div', { class: 'strip' },
          stat(t.received, 'received'),
          stat(t.sent, 'sent'),
          stat(t.failed, 'failed', t.failed > 0),
          stat(t.calls, 'missed calls'),
          stat(attempts ? `${Math.round((t.sent / attempts) * 100)}%` : '–', 'of sends delivered to the network')
        )
      ),
      panel('Messages per day', legend(msgSeries),
        h('div', { class: 'panel-body' }, barChart(rows, msgSeries, { height: 240, label: 'Messages per day' }))
      ),
      h('div', { class: 'split even' },
        panel('Missed calls per day', null, h('div', { class: 'panel-body' }, barChart(rows, callSeries, { height: 180, label: 'Calls per day' }))),
        panel('By SIM card', null, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'r' }, 'Received'), h('th', { class: 'r' }, 'Sent'), h('th', { class: 'r' }, 'Failed'), h('th', { class: 'r' }, 'Calls'))),
          h('tbody', {}, [1, 2].map((s) => h('tr', {},
            h('td', {}, h('span', { class: 'row', style: { gap: '8px' } }, h('i', { class: 'key', style: { background: `var(--sim${s})`, width: '10px', height: '10px', borderRadius: '3px' } }), simTag(s))),
            ...['received', 'sent', 'failed', 'calls'].map((k) => h('td', { class: 'r num' }, st.bySim[s][k]))
          )))
        )))
      ),
      h('div', { class: 'split even' },
        panel('Who texts most', null, ranking(st.topSenders, 'No messages received in this range')),
        panel('Who calls most', null, ranking(st.topCallers, 'No calls in this range'))
      )
    );
  }

  load();
}

function stat(n, label, bad = false) {
  return h('div', { class: bad ? 'bad' : '' }, h('b', {}, n), h('span', {}, label));
}

function ranking(list, empty) {
  if (!list.length) return emptyState('analytics', empty);
  const max = list[0].count;
  return h('div', { class: 'panel-body' }, h('ol', { class: 'rank' }, list.map((x) =>
    h('li', {},
      h('span', { class: 'who' }, x.number),
      h('b', { class: 'num' }, x.count),
      h('span', { class: 'bar' }, h('i', { style: { width: `${Math.max(4, (x.count / max) * 100)}%` } }))
    )
  )));
}
