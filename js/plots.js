/* SkyHop 2D plots: elevation-plane cut and the 24-hour SNR chart (plain SVG). */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  };
  const txt = (parent, x, y, s, anchor = 'middle', extra = {}) => { const t = el('text', { x, y, 'text-anchor': anchor, ...extra }, parent); t.textContent = s; return t; };
  const tip = () => document.getElementById('tooltip');
  function showTip(evt, html) {
    const t = tip(); t.innerHTML = html; t.hidden = false;
    const x = Math.min(evt.clientX + 14, root.innerWidth - t.offsetWidth - 8);
    t.style.left = x + 'px'; t.style.top = (evt.clientY + 14) + 'px';
  }
  const hideTip = () => { tip().hidden = true; };

  /* Elevation cut toward a bearing (right half) and away from it (left half).
   * series: [{pat, color, dash, name}], rays: [{el, color, label}] */
  function elevation(container, brg, series, rays) {
    container.innerHTML = '';
    const W = 380, H = 214, cx = W / 2, cy = H - 22, R = 168;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Elevation pattern' }, container);
    const outer = Math.ceil(Math.max(...series.map(s => s.pat.max)) / 2) * 2 + 1;
    const rOf = g => R * Math.max(0, (g - (outer - 30)) / 30);
    [0, 10, 20].forEach(dd => {
      const r = rOf(outer - dd);
      el('path', { d: `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`, class: 'grid' }, svg);
      txt(svg, cx + 4, cy - r + 12, `${(outer - dd).toFixed(0)} dBi`, 'start');
    });
    [15, 30, 45, 60, 75, 105, 120, 135, 150, 165].forEach(a => {
      const t = a * Math.PI / 180;
      el('line', { x1: cx, y1: cy, x2: cx + R * Math.cos(t), y2: cy - R * Math.sin(t), class: 'grid', 'stroke-dasharray': '2 3' }, svg);
      if (a <= 75) txt(svg, cx + (R + 10) * Math.cos(t), cy - (R + 10) * Math.sin(t) + 4, a + '°');
    });
    el('line', { x1: cx - R, y1: cy, x2: cx + R, y2: cy, class: 'axis' }, svg);
    txt(svg, cx + R, cy + 15, 'toward ▸', 'end');
    txt(svg, cx - R, cy + 15, '◂ away', 'start');
    series.forEach(s => {
      let d = '';
      for (let t = 0; t <= 180; t += 1) {
        const g = t <= 90 ? HS.nec.lookup(s.pat, brg, t) : HS.nec.lookup(s.pat, brg + 180, 180 - t);
        const r = rOf(g), a = t * Math.PI / 180;
        d += (t ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy - r * Math.sin(a)).toFixed(1);
      }
      el('path', { d, fill: s.dash ? 'none' : s.color, 'fill-opacity': s.dash ? 0 : 0.12, stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dash ? '5 4' : 'none', 'stroke-linejoin': 'round' }, svg);
    });
    rays.forEach(r => {
      const a = r.el * Math.PI / 180;
      el('line', { x1: cx, y1: cy, x2: cx + (R + 2) * Math.cos(a), y2: cy - (R + 2) * Math.sin(a), stroke: r.color, 'stroke-width': 2, 'stroke-dasharray': '1 3', 'stroke-linecap': 'round' }, svg);
      el('circle', { cx: cx + rOf(HS.nec.lookup(series[0].pat, brg, r.el)) * Math.cos(a), cy: cy - rOf(HS.nec.lookup(series[0].pat, brg, r.el)) * Math.sin(a), r: 4.5, fill: r.color, stroke: 'var(--panel)', 'stroke-width': 2 }, svg);
    });
    // hover readout
    const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', e => {
      const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) * W / b.width - cx, y = cy - (e.clientY - b.top) * H / b.height;
      if (y < 0) { hideTip(); return; }
      const t = Math.atan2(y, x) * 180 / Math.PI;
      const toward = t <= 90, e2 = toward ? t : 180 - t;
      const rows = series.map(s => `${s.name}: ${(toward ? HS.nec.lookup(s.pat, brg, e2) : HS.nec.lookup(s.pat, brg + 180, e2)).toFixed(1)} dBi`).join('<br>');
      showTip(e, `${e2.toFixed(0)}° ${toward ? 'toward' : 'away'}<br>${rows}`);
    });
    hit.addEventListener('mouseleave', hideTip);
    if (series.length > 1) {
      const lg = document.createElement('div'); lg.className = 'chart-legend';
      lg.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('');
      container.appendChild(lg);
    }
  }

  /* 24-hour SNR chart. lines: [{name, color, values[24]}], threshold {snr, label}, hour */
  function dayChart(container, lines, threshold, hour) {
    container.innerHTML = '';
    const W = 640, H = 240, L = 40, Rm = 12, Tm = 12, B = 28;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Signal-to-noise ratio by hour, UTC' }, container);
    const vals = lines.flatMap(l => l.values.filter(v => isFinite(v)));
    let lo = Math.min(-30, Math.floor((Math.min(...vals, 0) - 5) / 10) * 10), hi = Math.max(30, Math.ceil((Math.max(...vals, 0) + 5) / 10) * 10);
    lo = Math.max(lo, -60); hi = Math.min(hi, 80);
    const x = h => L + (W - L - Rm) * h / 23, y = v => Tm + (H - Tm - B) * (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo));
    for (let v = lo; v <= hi; v += 10) {
      el('line', { x1: L, x2: W - Rm, y1: y(v), y2: y(v), class: 'grid' }, svg);
      txt(svg, L - 6, y(v) + 4, (v > 0 ? '+' : '') + v, 'end');
    }
    for (let h = 0; h < 24; h += 3) txt(svg, x(h), H - 10, String(h).padStart(2, '0') + 'Z');
    txt(svg, L + 4, Tm + 10, 'SNR (dB)', 'start', { 'font-size': 10 });
    // threshold
    el('line', { x1: L, x2: W - Rm, y1: y(threshold.snr), y2: y(threshold.snr), stroke: 'var(--ink-2)', 'stroke-dasharray': '6 4', 'stroke-width': 1.25 }, svg);
    txt(svg, W - Rm - 2, y(threshold.snr) - 5, `${threshold.label} needs ${threshold.snr > 0 ? '+' : ''}${threshold.snr} dB`, 'end');
    // current hour
    el('line', { x1: x(hour), x2: x(hour), y1: Tm, y2: H - B, stroke: 'var(--accent)', 'stroke-width': 1.5 }, svg);
    lines.forEach(l => {
      let d = ''; l.values.forEach((v, h) => { d += (h ? 'L' : 'M') + x(h).toFixed(1) + ' ' + y(v).toFixed(1); });
      el('path', { d, fill: 'none', stroke: l.color, 'stroke-width': l.selected ? 2.75 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: l.selected || !lines.some(q => q.selected) ? 1 : 0.55 }, svg);
      const v = l.values[hour];
      el('circle', { cx: x(hour), cy: y(v), r: 4, fill: l.color, stroke: 'var(--panel)', 'stroke-width': 2 }, svg);
    });
    // hover crosshair
    const cross = el('line', { y1: Tm, y2: H - B, stroke: 'var(--ink-3)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    const hit = el('rect', { x: L, y: Tm, width: W - L - Rm, height: H - Tm - B, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', e => {
      const b = svg.getBoundingClientRect();
      const h = Math.round(((e.clientX - b.left) * W / b.width - L) / (W - L - Rm) * 23);
      if (h < 0 || h > 23) return;
      cross.setAttribute('x1', x(h)); cross.setAttribute('x2', x(h)); cross.setAttribute('visibility', 'visible');
      showTip(e, `<b>${String(h).padStart(2, '0')}:00Z</b><br>` + lines.map(l => `<span style="color:${l.color}">●</span> ${l.name}: ${isFinite(l.values[h]) ? (l.values[h] > 0 ? '+' : '') + l.values[h].toFixed(0) + ' dB' : '—'}`).join('<br>'));
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    const lg = document.createElement('div'); lg.className = 'chart-legend';
    lg.innerHTML = lines.map(l => `<span><i style="background:${l.color}"></i>${l.name}</span>`).join('');
    container.appendChild(lg);
  }

  /* SNR vs distance (VHF/UHF). lines: [{name,color,values:[{x,v}]}], marks: [{x,label,color}], horizon {x,label} */
  function distChart(container, lines, threshold, marks, horizon, unit) {
    container.innerHTML = '';
    const W = 640, H = 240, L = 40, Rm = 12, Tm = 12, B = 28;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Signal-to-noise ratio by distance' }, container);
    const xs = lines[0].values.map(p => p.x), xMax = xs[xs.length - 1];
    const vals = lines.flatMap(l => l.values.map(p => p.v)).filter(isFinite);
    let lo = Math.max(-40, Math.min(-20, Math.floor((Math.min(...vals) - 5) / 10) * 10)), hi = Math.min(90, Math.max(30, Math.ceil((Math.max(...vals) + 5) / 10) * 10));
    const x = v => L + (W - L - Rm) * v / xMax, y = v => Tm + (H - Tm - B) * (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo));
    for (let v = lo; v <= hi; v += 10) {
      el('line', { x1: L, x2: W - Rm, y1: y(v), y2: y(v), class: 'grid' }, svg);
      txt(svg, L - 6, y(v) + 4, (v > 0 ? '+' : '') + v, 'end');
    }
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find(s => xMax / s <= 8) || 1000;
    for (let v = 0; v <= xMax + 1e-9; v += step) txt(svg, x(v), H - 10, v + (v === 0 ? '' : ''), 'middle');
    txt(svg, W - Rm, H - 10 - 12, unit, 'end', { 'font-size': 10 });
    txt(svg, L + 4, Tm + 10, 'SNR (dB)', 'start', { 'font-size': 10 });
    el('line', { x1: L, x2: W - Rm, y1: y(threshold.snr), y2: y(threshold.snr), stroke: 'var(--ink-2)', 'stroke-dasharray': '6 4', 'stroke-width': 1.25 }, svg);
    txt(svg, W - Rm - 2, y(threshold.snr) - 5, `${threshold.label} needs ${threshold.snr > 0 ? '+' : ''}${threshold.snr} dB`, 'end');
    if (horizon && horizon.x < xMax) {
      el('line', { x1: x(horizon.x), x2: x(horizon.x), y1: Tm, y2: H - B, stroke: 'var(--ink-3)', 'stroke-dasharray': '2 3' }, svg);
      txt(svg, x(horizon.x) + 4, Tm + 24, horizon.label, 'start', { 'font-size': 10 });
    }
    lines.forEach(l => {
      let d = ''; l.values.forEach((p, i) => { d += (i ? 'L' : 'M') + x(p.x).toFixed(1) + ' ' + y(p.v).toFixed(1); });
      el('path', { d, fill: 'none', stroke: l.color, 'stroke-width': 2.25, 'stroke-dasharray': l.dash ? '6 4' : 'none', 'stroke-linejoin': 'round' }, svg);
    });
    marks.forEach(m => {
      el('line', { x1: x(m.x), x2: x(m.x), y1: Tm, y2: H - B, stroke: m.color, 'stroke-width': 1.5 }, svg);
      m.points.forEach(v => el('circle', { cx: x(m.x), cy: y(v), r: 4, fill: m.color, stroke: 'var(--panel)', 'stroke-width': 2 }, svg));
      txt(svg, x(m.x) - 4, Tm + 10, m.label, 'end', { 'font-size': 10 });
    });
    const cross = el('line', { y1: Tm, y2: H - B, stroke: 'var(--ink-3)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    const hit = el('rect', { x: L, y: Tm, width: W - L - Rm, height: H - Tm - B, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', e => {
      const b = svg.getBoundingClientRect();
      const xv = ((e.clientX - b.left) * W / b.width - L) / (W - L - Rm) * xMax;
      const i = Math.max(0, Math.min(xs.length - 1, Math.round(xv / xMax * (xs.length - 1))));
      cross.setAttribute('x1', x(xs[i])); cross.setAttribute('x2', x(xs[i])); cross.setAttribute('visibility', 'visible');
      showTip(e, `<b>${xs[i].toFixed(xs[i] < 10 ? 1 : 0)} ${unit}</b><br>` + lines.map(l => `<span style="color:${l.color}">●</span> ${l.name}: ${(l.values[i].v > 0 ? '+' : '') + l.values[i].v.toFixed(0)} dB`).join('<br>'));
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    const lg = document.createElement('div'); lg.className = 'chart-legend';
    lg.innerHTML = lines.map(l => `<span><i style="background:${l.color}"></i>${l.name}</span>`).join('');
    container.appendChild(lg);
  }

  HS.plots = { elevation, dayChart, distChart };
})(typeof window !== 'undefined' ? window : globalThis);
