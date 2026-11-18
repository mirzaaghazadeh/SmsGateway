import { h, clear, api, poll, segmented, emptyState, panel, shortTime, hm, fullTime, simName, simOn } from '../ui.js';
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
    const xFmt = hours <= 24 ? hm : (t) => shortTime(t).replace(/,? \d\d:\d\d.*/, '');
    const common = { from, to, xFmt, tipFmt: (t) => fullTime(t), gapMs: Math.max(3 * r.bucket, 180_000) };
    const last = r.points.at(-1);
    const on = [1, 2].filter((s) => simOn(s, device)); // slots turned off are not drawn
    const sig = [
      ...on.map((s) => ({ key: `s${s}`, label: simName(s, device), color: `var(--sim${s})`, fmt: (v) => `${v} dBm` })),
      { key: 'wifi', label: 'Wi-Fi', color: 'var(--wifi)', fmt: (v) => `${v} dBm` },
    ];
    const mv = on.map((s) => ({ key: `s${s}mv`, label: simName(s, device), color: `var(--sim${s})`, fmt: (v) => `${(v / 1000).toFixed(2)} V` }));
    const dbm = (v) => (v == null ? '–' : `${v} dBm`);
    // the scale reaches up to -45 dBm; a very strong signal (Wi-Fi next to a phone hotspot) widens it
    const strongest = Math.max(-45, ...r.points.flatMap((p) => sig.map((s) => p[s.key])).filter((v) => v != null));
    const yMax = strongest > -45 ? Math.min(0, Math.ceil((strongest + 5) / 10) * 10) : -45;
    const minMv = Math.min(...r.points.flatMap((p) => on.map((s) => p[`s${s}mv`])).filter((v) => v));
    clear(body,
      panel('Signal strength', legend(sig),
        h('div', { class: 'panel-body' },
          lineChart(r.points, sig, { ...common, yMin: -115, yMax, yFmt: (v) => `${v}`, height: 260, label: 'Signal strength in dBm',
            bands: [{ from: -73, to: yMax }, { from: -99, to: -85 }] }),
          h('p', { class: 'hint', style: { marginTop: '10px' } },
            'Shaded: above -73 dBm is excellent, -85 to -99 is fair. Below -100 dBm SMS may fail; move the antennas or the box. ',
            `Now: ${[...on.map((s) => `${simName(s, device)} ${dbm(last[`s${s}`])}`), `Wi-Fi ${dbm(last.wifi)}`].join(', ')}.`)
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
