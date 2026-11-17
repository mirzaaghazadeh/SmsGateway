import { h, clear, api, poll, segmented, emptyState, panel, shortTime, clock, fullTime } from '../ui.js';
import { lineChart, legend } from '../charts.js';

const RANGES = [
  [6, '6 h'],
  [24, '24 h'],
  [168, '7 days'],
  [720, '30 days'],
];

export default function signalPage(page) {
  let hours = 24;
  let device = null;
  let lastKey = '';
  const body = h('div', { style: { display: 'contents' } }, h('div', { class: 'skeleton' }));
  const deviceBox = h('span', {});

  clear(page,
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Signal'), h('p', { class: 'sub' }, 'Mobile signal, Wi-Fi and SIM800L supply voltage, one sample per minute.')),
      h('div', { class: 'actions' }, deviceBox, segmented(RANGES, hours, (v) => ((hours = v), refresh(true)), 'Time range'))
    ),
    body
  );

  async function refresh(force = false) {
    const r = await api(`/api/signals?hours=${hours}${device ? `&device=${encodeURIComponent(device)}` : ''}`);
    device = r.device;
    if (r.devices.length > 1 && !deviceBox.firstChild) {
      const sel = h('select', { class: 'select', 'aria-label': 'Gateway', onchange: () => ((device = sel.value), refresh(true)) },
        r.devices.map((d) => h('option', { value: d.id }, d.name || d.id)));
      sel.value = device;
      deviceBox.append(sel);
    }
    const key = `${hours}|${device}|${r.points.length}|${r.points.at(-1)?.t}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    draw(r);
  }

  function draw(r) {
    if (!r.points.length) {
      clear(body, h('section', { class: 'panel' }, emptyState('signal', 'No samples in this time range', 'The gateway sends one sample per minute while it is online.')));
      return;
    }
    const to = Date.now();
    const from = to - hours * 3600_000;
    const xFmt = hours <= 24 ? (t) => clock(t).slice(0, 5) : (t) => shortTime(t).replace(/,? \d\d:\d\d.*/, '');
    const common = { from, to, xFmt, tipFmt: (t) => fullTime(t), gapMs: Math.max(3 * r.bucket, 180_000) };
    const last = r.points.at(-1);
    const sig = [
      { key: 's1', label: 'SIM 1', color: 'var(--sim1)', fmt: (v) => `${v} dBm` },
      { key: 's2', label: 'SIM 2', color: 'var(--sim2)', fmt: (v) => `${v} dBm` },
      { key: 'wifi', label: 'Wi-Fi', color: 'var(--wifi)', fmt: (v) => `${v} dBm` },
    ];
    const mv = [
      { key: 's1mv', label: 'SIM 1', color: 'var(--sim1)', fmt: (v) => `${(v / 1000).toFixed(2)} V` },
      { key: 's2mv', label: 'SIM 2', color: 'var(--sim2)', fmt: (v) => `${(v / 1000).toFixed(2)} V` },
    ];
    const minMv = Math.min(...r.points.flatMap((p) => [p.s1mv, p.s2mv]).filter((v) => v));
    clear(body,
      panel('Signal strength', legend(sig),
        h('div', { class: 'panel-body' },
          lineChart(r.points, sig, { ...common, yMin: -115, yMax: -45, yFmt: (v) => `${v}`, height: 260, label: 'Signal strength in dBm',
            bands: [{ from: -73, to: -45 }, { from: -99, to: -85 }] }),
          h('p', { class: 'hint', style: { marginTop: '10px' } },
            'Shaded: above -73 dBm is excellent, -85 to -99 is fair. Below -100 dBm SMS may fail; move the antennas or the box. ',
            `Now: SIM 1 ${last.s1 ?? '–'} dBm, SIM 2 ${last.s2 ?? '–'} dBm, Wi-Fi ${last.wifi ?? '–'} dBm.`)
        )
      ),
      panel('SIM800L supply voltage', legend(mv),
        h('div', { class: 'panel-body' },
          lineChart(r.points, mv, { ...common, yMin: 3300, yMax: 4400, yFmt: (v) => (v / 1000).toFixed(1), height: 200, label: 'Supply voltage',
            bands: [{ from: 3400, to: 3550 }] }),
          h('p', { class: `hint ${minMv < 3550 ? 'error-text' : ''}`, style: { marginTop: '10px' } },
            minMv < 3550
              ? `Lowest reading ${(minMv / 1000).toFixed(2)} V: close to the 3.4 V cut-off. Check the LM2596 is set to 4.0 V and the 1000 µF capacitor sits right at the module.`
              : 'The modules need 3.4 to 4.4 V; the LM2596 should hold them near 4.0 V. The shaded band is the danger zone.')
        )
      )
    );
  }

  return poll(() => refresh(), 30_000);
}
