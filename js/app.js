/* SkyHop app: state, station builder form, results and views. */
(function () {
  'use strict';
  const { data: D, antennas: A, prop: P } = HS;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'skyhop.v1';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const KM_MI = 0.621371;

  const ant = (type, o = {}) => ({ type, height: 35, endHeight: 35, dir: 90, cutFor: 'auto', radials: 16, gpRadials: 4, elements: 3, ...o });
  function defaults() {
    return {
      band: '40m', hour: 17, month: new Date().getMonth() + 1, solar: 'mid', mode: 'ssb', sel: 'home', focus: 'r2',
      home: { id: 'home', name: 'My station', grid: 'EN50', radio: 'ft991a', power: 100, coax: 'rg8x', coaxFt: 60, match: '49to1', ground: 'average', noise: 'residential', antenna: ant('efhw', { height: 14, endHeight: 20, dir: 90 }) },
      remotes: [
        { id: 'r1', name: 'Next state over', grid: 'EN40', radio: 'ic7300', power: 100, coax: 'rg213', coaxFt: 50, match: 'choke', ground: 'average', noise: 'residential', antenna: ant('dipole', { height: 30, endHeight: 30, dir: 0 }) },
        { id: 'r2', name: 'Down south', grid: 'EM55', radio: 'ftdx10', power: 100, coax: 'lmr400', coaxFt: 25, match: 'none', ground: 'average', noise: 'rural', antenna: ant('vertical', { radials: 8 }) },
        { id: 'r3', name: 'East coast', grid: 'FN20', radio: 'ts2000', power: 100, coax: 'ladder', coaxFt: 80, match: 'none', ground: 'average', noise: 'residential', antenna: ant('doublet', { height: 40, endHeight: 30, dir: 0, cutFor: '40m' }) },
        { id: 'r4', name: 'Colorado contester', grid: 'DM79', radio: 'flex8400', power: 100, coax: 'lmr600', coaxFt: 120, match: 'hairpin', ground: 'poor', noise: 'quiet', antenna: ant('yagi', { height: 55, dir: 75, elements: 3 }) },
        { id: 'r5', name: 'London', grid: 'IO91', radio: 'ic7300', power: 100, coax: 'lmr400', coaxFt: 50, match: 'choke', ground: 'average', noise: 'city', antenna: ant('dipole', { height: 30, endHeight: 20, dir: 0 }) }
      ],
      pinA: null
    };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !S.home || !S.remotes) S = defaults();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage is optional */ } };

  const css = getComputedStyle(document.documentElement);
  const colorOf = st => st.id === 'home' ? css.getPropertyValue('--accent').trim() : css.getPropertyValue('--s' + (1 + (S.remotes.indexOf(st) % 6))).trim();
  const stations = () => [S.home, ...S.remotes];
  const byId = id => stations().find(s => s.id === id);
  const locOf = st => P.gridToLatLon(st.grid) || { lat: 0, lon: 0 };

  /* ---------- top bar ---------- */
  function initTop() {
    $('#bandSeg').innerHTML = Object.values(D.BANDS).map(b => `<button type="button" role="radio" data-band="${b.id}" aria-checked="${b.id === S.band}">${b.label}</button>`).join('');
    $('#bandSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.band = b.dataset.band; initTop(); renderForm(); compute(); });
    $('#month').innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === S.month ? 'selected' : ''}>${m}</option>`).join('');
    $('#solar').innerHTML = Object.entries(D.SOLAR).map(([k, v]) => `<option value="${k}" ${k === S.solar ? 'selected' : ''}>${v.label}</option>`).join('');
    $('#mode').innerHTML = Object.entries(D.MODES).map(([k, v]) => `<option value="${k}" ${k === S.mode ? 'selected' : ''}>${v.label}</option>`).join('');
    $('#hour').value = S.hour; $('#hourOut').textContent = String(S.hour).padStart(2, '0') + ':00Z';
  }
  $('#hour').addEventListener('input', e => { S.hour = +e.target.value; $('#hourOut').textContent = String(S.hour).padStart(2, '0') + ':00Z'; compute(true); });
  $('#month').addEventListener('change', e => { S.month = +e.target.value; compute(); });
  $('#solar').addEventListener('change', e => { S.solar = e.target.value; compute(); });
  $('#mode').addEventListener('change', e => { S.mode = e.target.value; compute(true); });

  /* ---------- station tabs + form ---------- */
  function renderTabs() {
    $('#stationTabs').innerHTML = stations().map(st =>
      `<button type="button" role="tab" class="stab" data-id="${st.id}" aria-selected="${st.id === S.sel}"><span class="dot" style="background:${colorOf(st)}"></span>${esc(st.name)}</button>`).join('') +
      (S.remotes.length < 6 ? `<button type="button" class="stab add" id="addStation">+ Add station</button>` : '');
  }
  $('#stationTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'addStation') {
      const id = 'r' + Date.now().toString(36);
      S.remotes.push({ id, name: 'New station', grid: 'EM79', radio: 'ic7300', power: 100, coax: 'lmr400', coaxFt: 50, match: 'choke', ground: 'average', noise: 'residential', antenna: ant('dipole') });
      S.sel = id; S.focus = id;
    } else { S.sel = b.dataset.id; if (S.sel !== 'home') S.focus = S.sel; }
    renderTabs(); renderForm(); compute();
  });

  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;
  const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];

  function renderForm() {
    const st = byId(S.sel) || S.home;
    const T = A.TYPES[st.antenna.type];
    const radio = D.RADIOS[st.radio];
    const maxW = radio.power[S.band] || 0;
    const hl = T.heightLabels || {};
    const coaxGroups = {};
    Object.entries(D.COAX).forEach(([k, c]) => (coaxGroups[c.group] = coaxGroups[c.group] || []).push([k, c]));
    const hf = Object.entries(D.RADIOS).filter(([, r]) => r.power['40m'] || r.power['20m']);
    const vu = Object.entries(D.RADIOS).filter(([, r]) => !(r.power['40m'] || r.power['20m']));
    const range = (id, label, val, min, max, step, unit, fmt) => `<label class="field"><span>${label}</span><span class="rv"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output for="${id}">${fmt ? fmt(val) : val + ' ' + unit}</output></span></label>`;
    const p = st.antenna;
    let antFields = '';
    if (T.params.includes('height')) antFields += range('a-height', hl.height || (st.antenna.type === 'yagi' ? 'Boom height' : 'Center height'), p.height, 3, 120, 1, 'ft');
    if (T.params.includes('endHeight')) antFields += range('a-endHeight', hl.endHeight || 'Wire end height', p.endHeight, 3, 120, 1, 'ft');
    if (T.params.includes('dir')) antFields += range('a-dir', T.dirLabel || (st.antenna.type === 'efhw' ? 'Wire runs toward' : st.antenna.type.includes('loop') || st.antenna.type === 'delta' || st.antenna.type === 'hloop' ? 'Orientation' : 'Wire runs'), p.dir, 0, 359, 1, '°', v => `${v}° ${compass(v)}`);
    if (T.params.includes('elements')) antFields += `<label class="field"><span>Elements</span><select id="a-elements">${[2, 3, 4, 5].map(n => opt(n, n + ' elements', p.elements)).join('')}</select></label>`;
    if (T.params.includes('radials')) antFields += `<label class="field"><span>Buried radials</span><select id="a-radials">${[[1, 'Ground rod only'], [4, '4 radials'], [8, '8 radials'], [16, '16 radials'], [32, '32 radials'], [64, '64 radials']].map(([n, l]) => opt(n, l, p.radials)).join('')}</select></label>`;
    if (T.params.includes('gpRadials')) antFields += `<label class="field"><span>Raised radials</span><select id="a-gpRadials">${[2, 3, 4].map(n => opt(n, n + ' radials', p.gpRadials)).join('')}</select></label>`;
    if (T.params.includes('cutFor')) antFields += `<label class="field"><span>Cut for</span><select id="a-cutFor">${opt('auto', 'Operating band', p.cutFor)}${Object.values(D.BANDS).map(b => opt(b.id, b.label, p.cutFor)).join('')}</select></label>`;
    let aim = '';
    if (st.antenna.type === 'yagi') {
      const others = stations().filter(o => o.id !== st.id);
      aim = `<div class="field wide"><span>Aim at</span><div class="aim">${others.map(o => `<button type="button" data-aim="${o.id}">${esc(o.name)}</button>`).join('')}</div></div>`;
    }

    $('#stationForm').innerHTML = `
      <div class="fgroup">
        <div class="fgroup-title">Station ${st.id !== 'home' ? '<button type="button" class="linkbtn" id="delStation">Remove</button>' : ''}</div>
        <div class="frow">
          <label class="field"><span>Name</span><input id="f-name" value="${esc(st.name)}" maxlength="28"></label>
          <label class="field"><span>Grid square</span><input id="f-grid" value="${esc(st.grid)}" maxlength="6" spellcheck="false" style="text-transform:uppercase" aria-describedby="gridHelp"></label>
        </div>
        <p class="hint" id="gridHelp">${P.gridToLatLon(st.grid) ? '' : 'Enter a 4 or 6 character grid, like EN50 or EN50wb.'}</p>
      </div>
      <div class="fgroup">
        <div class="fgroup-title">Radio</div>
        <label class="field"><span>Transceiver</span><select id="f-radio">
          <optgroup label="HF">${hf.map(([k, r]) => opt(k, r.name, st.radio)).join('')}</optgroup>
          <optgroup label="VHF / UHF (coming with 2 m and 70 cm)">${vu.map(([k, r]) => opt(k, r.name, st.radio)).join('')}</optgroup>
        </select></label>
        ${maxW ? range('f-power', 'Power', Math.min(st.power, maxW), 1, maxW, 1, 'W') : `<p class="warn">${esc(radio.name)} does not transmit on ${D.BANDS[S.band].label}.</p>`}
      </div>
      <div class="fgroup">
        <div class="fgroup-title">Feedline</div>
        <div class="frow">
          <label class="field"><span>Cable</span><select id="f-coax">${Object.entries(coaxGroups).map(([g, list]) => `<optgroup label="${g}">${list.map(([k, c]) => opt(k, c.name, st.coax)).join('')}</optgroup>`).join('')}</select></label>
          <label class="field"><span>Length (ft)</span><input id="f-coaxFt" type="number" min="3" max="1000" step="1" value="${st.coaxFt}"></label>
        </div>
      </div>
      <div class="fgroup">
        <div class="fgroup-title">Antenna</div>
        <label class="field"><span>Type</span><select id="a-type">${Object.entries(A.TYPES).map(([k, t]) => opt(k, t.name, st.antenna.type)).join('')}</select></label>
        <p class="hint">${esc(T.hint)}</p>
        <div class="frow">${antFields}</div>
        ${aim}
        <div class="frow">
          <label class="field"><span>At the feedpoint</span><select id="f-match">${Object.entries(D.MATCH).filter(([k]) => k !== 'hairpin' || st.antenna.type === 'yagi').map(([k, m]) => opt(k, m.name, st.match)).join('')}</select></label>
          <label class="field"><span>Ground</span><select id="f-ground">${Object.entries(D.GROUNDS).map(([k, g]) => opt(k, g.label, st.ground)).join('')}</select></label>
        </div>
        <label class="field"><span>Local noise</span><select id="f-noise">${Object.entries(D.NOISE).map(([k, n]) => opt(k, n.label, st.noise)).join('')}</select></label>
      </div>`;
  }

  const form = $('#stationForm');
  form.addEventListener('input', e => {
    const st = byId(S.sel); const t = e.target; if (!t.id) return;
    const [kind, key] = t.id.split('-');
    const out = t.parentElement.querySelector('output');
    if (t.type === 'range' && out) out.textContent = key === 'dir' ? `${t.value}° ${compass(+t.value)}` : `${t.value} ${key === 'power' ? 'W' : 'ft'}`;
    if (t.tagName === 'SELECT') return; // handled on change
    if (kind === 'f') {
      if (key === 'name') { st.name = t.value || 'Station'; renderTabs(); }
      else if (key === 'grid') {
        const g = t.value.trim();
        const ok = !!P.gridToLatLon(g);
        $('#gridHelp').textContent = ok ? '' : 'Enter a 4 or 6 character grid, like EN50 or EN50wb.';
        if (ok) st.grid = g.slice(0, 2).toUpperCase() + g.slice(2, 4) + g.slice(4).toLowerCase(); else return;
      } else if (key === 'power') st.power = +t.value;
      else if (key === 'coaxFt') { if (!(+t.value > 0)) return; st.coaxFt = Math.min(1000, +t.value); }
    } else if (kind === 'a') st.antenna[key] = +t.value;
    compute(key === 'name');
  });
  form.addEventListener('change', e => {
    const st = byId(S.sel); const t = e.target; if (t.tagName !== 'SELECT') return;
    const [kind, key] = t.id.split('-');
    if (kind === 'f') {
      st[key] = t.value;
      if (key === 'radio') { const m = D.RADIOS[t.value].power[S.band]; if (m) st.power = m; renderForm(); }
      if (key === 'coax' && D.COAX[t.value].balanced && st.match !== 'none') { st.match = 'none'; renderForm(); }
    } else if (key === 'type') {
      st.antenna.type = t.value; st.match = A.TYPES[t.value].match;
      if (D.COAX[st.coax].balanced) st.match = 'none';
      renderForm();
    } else st.antenna[key] = key === 'cutFor' ? t.value : +t.value;
    compute();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'delStation') {
      S.remotes = S.remotes.filter(r => r.id !== S.sel); S.sel = 'home';
      if (!byId(S.focus)) S.focus = S.remotes[0] && S.remotes[0].id;
      renderTabs(); renderForm(); compute(); return;
    }
    if (b.dataset.aim) {
      const st = byId(S.sel), o = byId(b.dataset.aim);
      st.antenna.dir = Math.round(P.distBearing(locOf(st), locOf(o)).brg) % 360;
      renderForm(); compute();
    }
  });

  /* ---------- compute + render ---------- */
  let view3d, globe, view = 'antenna', timer = null, last = null;
  function compute(fast) {
    clearTimeout(timer);
    const run = () => { try { doCompute(); } finally { $('#busy').hidden = true; } };
    if (fast) { timer = setTimeout(run, 0); return; }
    $('#busy').hidden = false;
    timer = setTimeout(run, 30);
  }

  function doCompute() {
    save();
    const cond = { hour: S.hour, month: S.month, ssn: D.SOLAR[S.solar].ssn };
    const all = stations();
    all.forEach(st => { st.loc = locOf(st); });
    const ch = {}; all.forEach(st => { ch[st.id] = P.chain(st, S.band); });
    const res = S.remotes.map(r => {
      const out = P.link(S.home, r, null, cond, ch.home, ch[r.id]);
      const back = P.link(r, S.home, null, cond, ch[r.id], ch.home);
      const day = [];
      for (let h = 0; h < 24; h++) day.push(P.link(S.home, r, null, { ...cond, hour: h }, ch.home, ch[r.id]).snr);
      return { st: r, out, back, day, color: colorOf(r) };
    });
    // comparison against A
    let A_ = null;
    if (S.pinA && S.pinA.band === S.band) {
      const st = { ...S.pinA.home, id: 'home', loc: S.home.loc };
      const cA = P.chain(st, S.band);
      A_ = { chain: cA, res: S.remotes.map(r => ({ out: P.link(st, r, null, cond, cA, ch[r.id]), back: P.link(r, st, null, cond, ch[r.id], cA) })) };
    }
    last = { cond, ch, res, A: A_ };
    renderSystem(); renderCards(); renderViews(); renderPlots(); renderCaveats();
    $('#restoreA').hidden = $('#clearA').hidden = !S.pinA;
    $('#pinA').textContent = S.pinA ? 'Save my setup as A again' : 'Save my setup as A';
  }

  const fmtW = w => w >= 10 ? w.toFixed(0) : w.toFixed(1);
  function renderSystem() {
    const st = byId(S.sel) || S.home, c = last.ch[st.id];
    const z = c.zAntenna, pct = x => Math.max(0, x * 100);
    const W = c.watts, pAnt = W * Math.pow(10, -c.totalLoss / 10);
    const lossW = db => W * (1 - Math.pow(10, -db / 10));
    const coaxW = lossW(c.matchedLoss), misW = Math.max(0, lossW(c.lineLoss) - coaxW), devW = Math.max(0, W - pAnt - coaxW - misW);
    const pk = c.ana.pat;
    const swr = v => v > 50 ? '50+:1' : v.toFixed(2) + ':1';
    $('#system').innerHTML = `
      <h3>${esc(st.name)} on ${c.band.label}</h3>
      ${W ? `<div class="budget">
        <div class="budget-bar" role="img" aria-label="${fmtW(pAnt)} of ${W} watts reach the antenna">
          <span class="b-out" style="width:${pct(pAnt / W)}%"></span><span class="b-coax" style="width:${pct(coaxW / W)}%"></span><span class="b-mis" style="width:${pct(misW / W)}%"></span><span class="b-dev" style="width:${pct(devW / W)}%"></span>
        </div>
        <div class="budget-key"><span><i class="b-out"></i>${fmtW(pAnt)} W reach the antenna</span><span><i class="b-coax"></i>coax ${fmtW(coaxW)} W</span>${misW > 0.05 ? `<span><i class="b-mis"></i>SWR loss ${fmtW(misW)} W</span>` : ''}${devW > 0.05 ? `<span><i class="b-dev"></i>balun / tuner ${fmtW(devW)} W</span>` : ''}</div>
      </div>` : ''}
      <dl class="kv">
        <dt>Feedpoint impedance</dt><dd>${z.r.toFixed(0)} ${z.x < 0 ? '−' : '+'} j${Math.abs(z.x).toFixed(0)} Ω</dd>
        ${c.z.r - z.r > 0.5 ? `<dt>Ground loss resistance</dt><dd>${(c.z.r - z.r).toFixed(1)} Ω</dd>` : ''}
        <dt>SWR on the line</dt><dd>${swr(c.swrLine)}${c.coax.z0 !== 50 ? ` (${c.coax.z0} Ω)` : ''}</dd>
        <dt>SWR at the radio</dt><dd>${swr(c.swrRadio)}</dd>
        <dt>Tuner</dt><dd>${esc(c.tuner)}</dd>
        <dt>Coax loss (matched)</dt><dd>${c.matchedLoss.toFixed(2)} dB</dd>
        <dt>Extra loss from SWR</dt><dd>${c.mismatchLoss.toFixed(2)} dB</dd>
        <dt>Total system loss</dt><dd>${c.totalLoss.toFixed(2)} dB</dd>
        <dt>Peak gain</dt><dd>${pk.max.toFixed(1)} dBi at ${pk.maxEl}°</dd>
        <dt>Receive noise floor</dt><dd>${P.sMeter(c.noiseDbm)} (${c.noiseDbm.toFixed(0)} dBm)</dd>
      </dl>
      ${c.warn.map(w => `<p class="warn">${esc(w)}</p>`).join('')}`;
  }

  function relPill(rel) {
    const p = rel ?? 0, cls = p >= 0.8 ? 'good' : p >= 0.4 ? 'fair' : 'poor', word = p >= 0.8 ? 'Good' : p >= 0.4 ? 'Fair' : 'Unlikely';
    return `<span class="pill ${cls}">${D.MODES[S.mode].label} ${word} · ${Math.round(p * 100)}%</span>`;
  }
  function dirBlock(label, L) {
    if (!L.ok) return `<div class="dir"><span class="dir-label">${label}</span><span class="smeter">—</span><span class="snr">${esc(L.reason)}</span></div>`;
    return `<div class="dir"><span class="dir-label">${label}</span><span class="smeter">${L.s}</span><span class="snr">SNR ${L.snr > 0 ? '+' : ''}${L.snr.toFixed(0)} dB</span>${relPill(L.rel[S.mode])}</div>`;
  }
  function renderCards() {
    $('#cards').innerHTML = last.res.map((r, i) => {
      const o = r.out, mi = (o.km * KM_MI).toFixed(0);
      let delta = '';
      if (last.A && o.ok && last.A.res[i].out.ok) {
        const d1 = o.snr - last.A.res[i].out.snr, d2 = r.back.snr - last.A.res[i].back.snr;
        const f = d => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1);
        const cls = (d1 + d2) > 0.2 ? 'up' : (d1 + d2) < -0.2 ? 'down' : '';
        delta = `<p class="delta ${cls}">vs A: ${f(d1)} dB out · ${f(d2)} dB back</p>`;
      }
      const path = o.ok ? `${o.hops} hop${o.hops > 1 ? 's' : ''} · takeoff ${o.el.toFixed(0)}° · MUF ${o.muf.toFixed(1)} MHz${o.overMuf > 0 ? ' · band skips this path' : ''}` : '';
      const gains = o.ok ? `Your antenna ${o.gt >= 0 ? '+' : ''}${o.gt.toFixed(1)} dBi there; theirs ${o.gr >= 0 ? '+' : ''}${o.gr.toFixed(1)} dBi` : '';
      return `<div class="card" role="button" tabindex="0" data-id="${r.st.id}" aria-pressed="${r.st.id === S.focus}">
        <div class="card-head"><span class="dot" style="background:${r.color}"></span><span class="nm">${esc(r.st.name)}</span><span class="dist">${esc(r.st.grid)} · ${mi} mi · ${o.brg.toFixed(0)}°</span></div>
        <div class="dirs">${dirBlock('You → them', o)}${dirBlock('Them → you', r.back)}</div>
        <p class="path">${path}<br>${gains}</p>${delta}
      </div>`;
    }).join('') || '<p class="hint">Add a station to see who you can work.</p>';
  }
  $('#cards').addEventListener('click', e => { const c = e.target.closest('.card'); if (!c) return; S.focus = c.dataset.id; renderCards(); renderViews(); renderPlots(); });
  $('#cards').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); e.target.click(); } });

  function renderViews() {
    const st = byId(S.sel) || S.home, c = last.ch[st.id];
    let rays;
    if (st.id === 'home') rays = last.res.filter(r => r.out.ok).map(r => ({ brg: r.out.brg, el: r.out.el, color: r.color, label: r.st.name, gain: r.out.gt, selected: r.st.id === S.focus }));
    else {
      const r = last.res.find(x => x.st.id === st.id);
      rays = r && r.back.ok ? [{ brg: r.back.brg, el: r.back.el, color: colorOf(S.home), label: S.home.name, gain: r.back.gt, selected: true }] : [];
    }
    if (view3d) view3d.update({ model: c.ana.model, pat: c.ana.pat, patA: st.id === 'home' && last.A ? last.A.chain.ana.pat : null, rays, type: st.antenna.type });
    $('#gainLegend').innerHTML = `<span>${esc(st.name)} · ${esc(A.TYPES[st.antenna.type].name)}</span><div class="ramp"></div><div class="ends"><span>${(c.ana.pat.max - 30).toFixed(0)}</span><span>${c.ana.pat.max.toFixed(1)} dBi</span></div>${st.id === 'home' && last.A ? '<span>White mesh: setup A</span>' : ''}`;
    if (globe) globe.update({
      cond: last.cond,
      home: { ...S.home, color: colorOf(S.home) },
      links: last.res.map(r => ({ st: r.st, color: r.color, link: r.out, rel: r.out.ok ? r.out.rel[S.mode] : 0, selected: r.st.id === S.focus, text: r.out.ok ? r.out.s : '' }))
    });
  }

  function renderPlots() {
    const st = byId(S.sel) || S.home, c = last.ch[st.id];
    let target, L;
    if (st.id === 'home') { const r = last.res.find(x => x.st.id === S.focus) || last.res[0]; target = r && r.st; L = r && r.out; }
    else { const r = last.res.find(x => x.st.id === st.id); target = S.home; L = r && r.back; }
    const brg = L ? L.brg : 0;
    $('#elevTitle').textContent = `Elevation pattern toward ${target ? target.name : 'north'}`;
    $('#elevSub').textContent = L && L.ok ? `${st.name} → ${target.name}: the path needs a ${L.el.toFixed(0)}° takeoff angle on ${D.BANDS[S.band].label}. Your antenna gives ${L.gt.toFixed(1)} dBi there.` : 'Pick a station card to see its takeoff angle.';
    const series = [{ pat: c.ana.pat, color: colorOf(st), name: 'Current' }];
    if (st.id === 'home' && last.A) series.push({ pat: last.A.chain.ana.pat, color: css.getPropertyValue('--ink-2').trim(), dash: true, name: 'Setup A' });
    HS.plots.elevation($('#elevPlot'), brg, series, L && L.ok ? [{ el: L.el, color: target.id === 'home' ? colorOf(S.home) : colorOf(target) }] : []);
    $('#dayChartSub').textContent = `From ${S.home.name} on ${D.BANDS[S.band].label}, ${MONTHS[S.month - 1]}, ${D.SOLAR[S.solar].label.toLowerCase()}. Hover for values.`;
    HS.plots.dayChart($('#dayChart'), last.res.map(r => ({ name: r.st.name, color: r.color, values: r.day, selected: r.st.id === S.focus })), { snr: D.MODES[S.mode].snr, label: D.MODES[S.mode].label }, S.hour);
  }

  function renderCaveats() {
    const notes = ['Ground wave is not modeled yet, so short contacts (under about 50 miles) read low.',
      'End-fed half-waves read a higher SWR here than most real ones, because the model has no transformer or coax losses at the feed to soften the impedance peak.',
      'Commercial antennas are represented by the generic design they are built on.'];
    $('#caveats').textContent = notes.join(' ');
  }

  /* ---------- compare ---------- */
  $('#pinA').addEventListener('click', () => { S.pinA = { band: S.band, home: JSON.parse(JSON.stringify({ ...S.home, loc: undefined })) }; compute(); });
  $('#clearA').addEventListener('click', () => { S.pinA = null; compute(); });
  $('#restoreA').addEventListener('click', () => {
    if (!S.pinA) return;
    S.home = JSON.parse(JSON.stringify({ ...S.pinA.home, id: 'home' }));
    S.band = S.pinA.band; S.sel = 'home';
    initTop(); renderTabs(); renderForm(); compute();
  });

  /* ---------- views ---------- */
  document.querySelectorAll('.vt').forEach(b => b.addEventListener('click', () => {
    view = b.dataset.view;
    document.querySelectorAll('.vt').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
    $('#view-antenna').hidden = view !== 'antenna'; $('#view-map').hidden = view !== 'map';
    $('#gainLegend').hidden = view !== 'antenna';
    $('#viewHint').textContent = view === 'antenna' ? 'Drag to orbit · scroll to zoom' : 'Drag to spin · ionosphere height shown 3× · day/night from the hour';
    (view === 'antenna' ? view3d : globe)?.resize();
  }));

  initTop(); renderTabs(); renderForm();
  try {
    view3d = HS.view3d.init($('#view-antenna'));
    globe = HS.globe.init($('#view-map'));
  } catch (e) {
    $('#canvasWrap').innerHTML = '<p class="warn" style="margin:16px">3D view needs WebGL, which this browser has turned off. The predictions below still work.</p>';
  }
  compute();
  requestAnimationFrame(() => { view3d && view3d.resize(); globe && globe.resize(); });
  new ResizeObserver(() => { view3d && view3d.resize(); globe && globe.resize(); }).observe($('#canvasWrap'));
})();
