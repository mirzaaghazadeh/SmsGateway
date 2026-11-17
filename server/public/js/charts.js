// Small SVG charts: time series lines and stacked daily bars, with a hover read-out.
import { h, s, clear } from './ui.js';

const M = { top: 12, right: 14, bottom: 26, left: 46 };

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * mag;
}

function ticks(min, max, count = 4) {
  const step = niceStep(max - min || 1, count);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

// Re-render on width changes; returns the container.
function responsive(draw) {
  const box = h('div', { class: 'chart' });
  let last = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.round(box.clientWidth);
    if (w && w !== last) {
      last = w;
      draw(box, w);
    }
  });
  ro.observe(box);
  return box;
}

function tooltip(box, title, rows, x, y, w) {
  let tip = box.querySelector('.tip');
  if (!tip) box.append((tip = h('div', { class: 'tip', role: 'presentation' })));
  clear(tip,
    h('div', { class: 't' }, title),
    rows.map((r) => h('div', { class: 'r' },
      h('span', {}, h('i', { class: 'key', style: { background: r.color } }), r.label),
      h('b', {}, r.value)
    ))
  );
  tip.classList.add('show');
  const tw = tip.offsetWidth || 160;
  tip.style.left = `${Math.min(Math.max(0, x + 14), w - tw)}px`;
  tip.style.top = `${Math.max(0, y)}px`;
  if (x + 14 + tw > w) tip.style.left = `${Math.max(0, x - tw - 14)}px`;
}

const hideTip = (box) => box.querySelector('.tip')?.classList.remove('show');

/**
 * points: [{ t, [key]: number|null }], series: [{ key, label, color, fmt }]
 * opts: { height, yMin, yMax, bands: [{ from, to }], gapMs, xFmt, yFmt }
 */
export function lineChart(points, series, opts = {}) {
  const height = opts.height || 240;
  return responsive((box, width) => {
    const iw = width - M.left - M.right;
    const ih = height - M.top - M.bottom;
    const ts = points.map((p) => p.t);
    const t0 = opts.from ?? Math.min(...ts);
    const t1 = opts.to ?? Math.max(...ts);
    const vals = points.flatMap((p) => series.map((sr) => p[sr.key])).filter((v) => v != null);
    let y0 = opts.yMin ?? Math.min(...vals);
    let y1 = opts.yMax ?? Math.max(...vals);
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) [y0, y1] = [0, 1];
    if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
    if (opts.yMin == null || opts.yMax == null) {
      const pad = (y1 - y0) * 0.12;
      if (opts.yMin == null) y0 -= pad;
      if (opts.yMax == null) y1 += pad;
    }
    const x = (t) => M.left + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
    const y = (v) => M.top + ih - ((v - y0) / (y1 - y0)) * ih;
    const yFmt = opts.yFmt || ((v) => String(v));
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': opts.label || 'chart' });

    for (const b of opts.bands || []) {
      const top = y(Math.min(y1, b.to));
      const bottom = y(Math.max(y0, b.from));
      if (bottom > top) svg.append(s('rect', { class: 'band', x: M.left, y: top, width: iw, height: bottom - top }));
    }
    for (const v of ticks(y0, y1, 4)) {
      svg.append(s('line', { class: 'gridline', x1: M.left, x2: M.left + iw, y1: y(v), y2: y(v) }));
      svg.append(s('text', { class: 'axis', x: M.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, yFmt(v)));
    }
    const xCount = Math.max(2, Math.floor(iw / 110));
    for (let i = 0; i <= xCount; i++) {
      const t = t0 + ((t1 - t0) * i) / xCount;
      svg.append(s('text', { class: 'axis', x: x(t), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === xCount ? 'end' : 'middle' }, opts.xFmt(t)));
    }
    const gap = opts.gapMs || Infinity;
    for (const sr of series) {
      let d = '';
      let prevT = null;
      for (const p of points) {
        const v = p[sr.key];
        if (v == null) {
          prevT = null;
          continue;
        }
        d += `${prevT == null || p.t - prevT > gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
        prevT = p.t;
      }
      if (d) svg.append(s('path', { class: 'line', d, style: `stroke:${sr.color}` }));
    }

    const cross = s('line', { class: 'cross', y1: M.top, y2: M.top + ih, visibility: 'hidden' });
    const dots = series.map((sr) => s('circle', { r: 4, style: `fill:${sr.color};stroke:var(--surface);stroke-width:2`, visibility: 'hidden' }));
    svg.append(cross, ...dots);
    const hit = s('rect', { class: 'hit', x: M.left, y: M.top, width: iw, height: ih });
    svg.append(hit);
    const move = (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * width;
      const t = t0 + ((px - M.left) / iw) * (t1 - t0);
      let best = null;
      for (const p of points) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      if (!best) return;
      const cx = x(best.t);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      series.forEach((sr, i) => {
        const v = best[sr.key];
        dots[i].setAttribute('visibility', v == null ? 'hidden' : 'visible');
        if (v != null) dots[i].setAttribute('cx', cx), dots[i].setAttribute('cy', y(v));
      });
      tooltip(box, opts.tipFmt(best.t), series.map((sr) => ({
        label: sr.label, color: sr.color, value: best[sr.key] == null ? '–' : (sr.fmt || yFmt)(best[sr.key]),
      })), cx, M.top, width);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      hideTip(box);
    });
    clear(box, svg);
  });
}

/** data: [{ label, title, [key]: n }], series: [{ key, label, color }] stacked bars */
export function barChart(data, series, opts = {}) {
  const height = opts.height || 220;
  return responsive((box, width) => {
    const iw = width - M.left - M.right;
    const ih = height - M.top - M.bottom;
    const totals = data.map((d) => series.reduce((a, sr) => a + (d[sr.key] || 0), 0));
    const max = Math.max(4, ...totals);
    const tk = ticks(0, max, 4);
    const top = Math.max(max, tk[tk.length - 1]);
    const y = (v) => M.top + ih - (v / top) * ih;
    const band = iw / data.length;
    const bw = Math.max(2, Math.min(28, band * 0.64));
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': opts.label || 'chart' });
    for (const v of tk) {
      svg.append(s('line', { class: 'gridline', x1: M.left, x2: M.left + iw, y1: y(v), y2: y(v) }));
      svg.append(s('text', { class: 'axis', x: M.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v)));
    }
    const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 64))));
    data.forEach((d, i) => {
      const cx = M.left + band * i + band / 2;
      let acc = 0;
      const g = s('g', {});
      for (const sr of series) {
        const v = d[sr.key] || 0;
        if (!v) continue;
        const y1 = y(acc + v);
        const y0 = y(acc);
        g.append(s('rect', { x: cx - bw / 2, y: y1, width: bw, height: Math.max(1, y0 - y1 - 1), rx: Math.min(3, bw / 3), style: `fill:${sr.color}` }));
        acc += v;
      }
      svg.append(g);
      if (i % every === 0 || i === data.length - 1) {
        if (i === data.length - 1 && i % every !== 0 && (i % every) < every / 2) {
          // too close to the previous label
        } else svg.append(s('text', { class: 'axis', x: cx, y: height - 6, 'text-anchor': 'middle' }, d.label));
      }
      const hit = s('rect', { class: 'hit', x: M.left + band * i, y: M.top, width: band, height: ih });
      const show = () => tooltip(box, d.title, series.map((sr) => ({ label: sr.label, color: sr.color, value: String(d[sr.key] || 0) })), cx, M.top, width);
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', () => hideTip(box));
      svg.append(hit);
    });
    clear(box, svg);
  });
}

export function legend(series) {
  return h('div', { class: 'legend' }, series.map((sr) =>
    h('span', {}, h('i', { class: `key ${sr.square ? 'sq' : ''}`, style: { background: sr.color } }), sr.label)
  ));
}

export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
