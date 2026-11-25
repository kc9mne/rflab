/* RFLab app: state, station builder form, results and views.
 * Each station has one radio and two antenna systems: st.hf (40 m / 20 m) and st.vu (2 m / 70 cm). */
(function () {
  'use strict';
  const { data: D, antennas: A, prop: P } = HS;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'rflab.v1';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const KM_MI = 0.621371;
  const mi = km => { const m = km * KM_MI; return m < 10 ? m.toFixed(1) : m.toFixed(0); };

  const ant = (type, o = {}) => ({ type, height: 35, endHeight: 35, dir: 90, cutFor: 'auto', radials: 16, gpRadials: 4, elements: 3, sections: 2, pol: 'h', ...o });
  const sysOf = (antenna, coax, coaxFt, match, power) => ({ antenna, coax, coaxFt, match, power });
  const stn = (id, name, grid, radio, noise, hf, vu, o = {}) => ({ id, name, grid, radio, ground: 'average', noise, elevFt: 650, hf, vu, ...o });
  const vuDefault = () => sysOf(ant('collinear', { height: 30, sections: 2 }), 'lmr400', 50, 'ideal', 50);
  const hfDefault = () => sysOf(ant('dipole', { height: 30, endHeight: 30 }), 'rg213', 50, 'choke', 100);

  function defaults() {
    return {
      band: '40m', hour: 17, month: new Date().getMonth() + 1, solar: 'mid', mode: 'ssb', terrain: 'flat', sel: 'home', focus: { hf: 'r2', vu: 'v2' },
      home: stn('home', 'My station', 'EN50', 'ft991a', 'residential',
        sysOf(ant('efhw', { height: 14, endHeight: 20, dir: 90 }), 'rg8x', 60, '49to1', 100),
        sysOf(ant('jpole', { height: 25 }), 'rg8x', 50, 'ideal', 50)),
      remotes: [
        stn('r1', 'Next state over', 'EN40', 'ic7300', 'residential', sysOf(ant('dipole', { height: 30, endHeight: 30, dir: 0 }), 'rg213', 50, 'choke', 100), vuDefault()),
        stn('r2', 'Down south', 'EM55', 'ftdx10', 'rural', sysOf(ant('vertical', { radials: 8 }), 'lmr400', 25, 'none', 100), vuDefault()),
        stn('r3', 'East coast', 'FN20', 'ft891', 'residential', sysOf(ant('doublet', { height: 40, endHeight: 30, dir: 0, cutFor: '40m' }), 'ladder', 80, 'none', 100), vuDefault()),
        stn('r4', 'Colorado contester', 'DM79', 'flex8400', 'quiet', sysOf(ant('yagi', { height: 55, dir: 75, elements: 3 }), 'lmr600', 120, 'hairpin', 100), vuDefault(), { ground: 'poor' }),
        stn('r5', 'London', 'IO91', 'ic7300', 'city', sysOf(ant('dipole', { height: 30, endHeight: 20, dir: 0 }), 'lmr400', 50, 'choke', 100), vuDefault()),
        stn('v1', 'Handheld across town', 'EN50nm', 'uv5r', 'residential', hfDefault(), sysOf(ant('duck', { height: 5 }), 'rg58', 0, 'none', 4)),
        stn('v2', 'Mobile up the highway', 'EN50mt', 'ic2730a', 'rural', hfDefault(), sysOf(ant('mobile'), 'rg58', 15, 'none', 50)),
        stn('v3', 'Club station', 'EN50bk', 'ic9700', 'rural', hfDefault(), sysOf(ant('yagi', { height: 50, dir: 85, elements: 5, pol: 'h' }), 'lmr400', 100, 'hairpin', 100)),
        stn('v4', 'Hilltop station', 'EM69aq', 'ts2000', 'rural', hfDefault(), sysOf(ant('collinear', { height: 60, sections: 3 }), 'ldf5', 90, 'ideal', 100), { elevFt: 1150 })
      ],
      pinA: null
    };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !S.home || !S.home.hf || !S.remotes) S = defaults();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S, (k, v) => k === 'loc' ? undefined : v)); } catch (e) { /* storage is optional */ } };

  const grp = () => D.BANDS[S.band].group;
  const bandsIn = g => Object.values(D.BANDS).filter(b => b.group === g);
  const radioIn = (st, g) => bandsIn(g).some(b => D.RADIOS[st.radio].power[b.id]);
  const groupRemotes = () => S.remotes.filter(r => radioIn(r, grp()));
  const css = getComputedStyle(document.documentElement);
  const colorOf = st => st.id === 'home' ? css.getPropertyValue('--accent').trim()
    : css.getPropertyValue('--s' + (1 + (Math.max(0, groupRemotes().indexOf(st)) % 6))).trim();
  const stations = () => [S.home, ...groupRemotes()];
  const byId = id => [S.home, ...S.remotes].find(s => s.id === id);
  const locOf = st => P.gridToLatLon(st.grid) || { lat: 0, lon: 0 };
  const focusId = () => S.focus[grp()];

  /* ---------- top bar ---------- */
  function initTop() {
    $('#bandSeg').innerHTML = Object.values(D.BANDS).map(b => `<button type="button" role="radio" data-band="${b.id}" aria-checked="${b.id === S.band}">${b.label}</button>`).join('');
    $('#month').innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === S.month ? 'selected' : ''}>${m}</option>`).join('');
    $('#solar').innerHTML = Object.entries(D.SOLAR).map(([k, v]) => `<option value="${k}" ${k === S.solar ? 'selected' : ''}>${v.label}</option>`).join('');
    $('#mode').innerHTML = Object.entries(D.MODES).map(([k, v]) => `<option value="${k}" ${k === S.mode ? 'selected' : ''}>${v.label}</option>`).join('');
    $('#terrain').innerHTML = Object.entries(D.TERRAIN).map(([k, v]) => `<option value="${k}" ${k === S.terrain ? 'selected' : ''}>${v.label}</option>`).join('');
    $('#hour').value = S.hour; $('#hourOut').textContent = String(S.hour).padStart(2, '0') + ':00Z';
    document.querySelectorAll('.hf-only').forEach(e => { e.hidden = grp() !== 'hf'; });
    document.querySelectorAll('.vu-only').forEach(e => { e.hidden = grp() !== 'vu'; });
  }
  $('#bandSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const was = grp(); S.band = b.dataset.band;
    if (grp() !== was) { S.mode = grp() === 'vu' ? 'fm' : 'ssb'; if (!stations().includes(byId(S.sel))) S.sel = 'home'; }
    initTop(); renderTabs(); renderForm(); compute();
  });
  $('#hour').addEventListener('input', e => { S.hour = +e.target.value; $('#hourOut').textContent = String(S.hour).padStart(2, '0') + ':00Z'; compute(true); });
  $('#month').addEventListener('change', e => { S.month = +e.target.value; compute(); });
  $('#solar').addEventListener('change', e => { S.solar = e.target.value; compute(); });
  $('#mode').addEventListener('change', e => { S.mode = e.target.value; compute(true); });
  $('#terrain').addEventListener('change', e => { S.terrain = e.target.value; compute(true); });

  /* ---------- station tabs + form ---------- */
  function renderTabs() {
    const hidden = S.remotes.length - groupRemotes().length;
    $('#stationTabs').innerHTML = stations().map(st =>
      `<button type="button" role="tab" class="stab" data-id="${st.id}" aria-selected="${st.id === S.sel}"><span class="dot" style="background:${colorOf(st)}"></span>${esc(st.name)}</button>`).join('') +
      (S.remotes.length < 12 ? `<button type="button" class="stab add" id="addStation">+ Add station</button>` : '') +
      (hidden ? `<p class="hint tabs-note">${hidden} station${hidden > 1 ? 's' : ''} with ${grp() === 'vu' ? 'HF-only' : 'VHF/UHF-only'} radios hidden on this band.</p>` : '');
  }
  $('#stationTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'addStation') {
      const id = 'r' + Date.now().toString(36);
      const vu = grp() === 'vu';
      S.remotes.push(stn(id, 'New station', vu ? 'EN50pp' : 'EM79', vu ? 'ic2730a' : 'ic7300', 'residential', hfDefault(), vuDefault()));
      S.sel = id; S.focus[grp()] = id;
    } else { S.sel = b.dataset.id; if (S.sel !== 'home') S.focus[grp()] = S.sel; }
    renderTabs(); renderForm(); compute();
  });

  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;
  const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];

  function renderForm() {
    const st = byId(S.sel) || S.home, g = grp(), sys = st[g];
    const T = A.TYPES[sys.antenna.type];
    const radio = D.RADIOS[st.radio];
    const maxW = radio.power[S.band] || 0;
    const hl = T.heightLabels || {};
    const coaxGroups = {};
    Object.entries(D.COAX).forEach(([k, c]) => (coaxGroups[c.group] = coaxGroups[c.group] || []).push([k, c]));
    const has = (r, gg) => bandsIn(gg).some(b => r.power[b.id]);
    const rg = { both: [], hf: [], vu: [] };
    Object.entries(D.RADIOS).forEach(([k, r]) => rg[has(r, 'hf') && has(r, 'vu') ? 'both' : has(r, 'hf') ? 'hf' : 'vu'].push([k, r]));
    const range = (id, label, val, min, max, step, unit, fmt) => `<label class="field"><span>${label}</span><span class="rv"><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><output for="${id}">${fmt ? fmt(val) : val + ' ' + unit}</output></span></label>`;
    const p = sys.antenna, ty = p.type;
    let antFields = '';
    if (T.params.includes('height')) antFields += range('a-height', hl.height || (ty === 'yagi' ? 'Boom height' : ty === 'gp' ? 'Base height' : 'Center height'), p.height, ty === 'duck' ? 2 : 3, ty === 'duck' ? 30 : 150, 1, 'ft');
    if (T.params.includes('endHeight')) antFields += range('a-endHeight', hl.endHeight || 'Wire end height', p.endHeight, 3, 150, 1, 'ft');
    if (T.params.includes('dir')) antFields += range('a-dir', T.dirLabel || (ty === 'efhw' ? 'Wire runs toward' : (ty === 'hloop' || ty === 'delta') ? 'Orientation' : 'Wire runs'), p.dir, 0, 359, 1, '°', v => `${v}° ${compass(v)}`);
    if (T.params.includes('elements')) antFields += `<label class="field"><span>Elements</span><select id="a-elements">${[2, 3, 4, 5].map(n => opt(n, n + ' elements', p.elements)).join('')}</select></label>`;
    if (T.params.includes('pol') && g === 'vu') antFields += `<label class="field"><span>Polarization</span><select id="a-pol">${opt('h', 'Horizontal (SSB, CW)', p.pol)}${opt('v', 'Vertical (FM)', p.pol)}</select></label>`;
    if (T.params.includes('sections')) antFields += `<label class="field"><span>Stacked sections</span><select id="a-sections">${[2, 3, 4].map(n => opt(n, n + ' × λ/2', p.sections)).join('')}</select></label>`;
    if (T.params.includes('radials')) antFields += `<label class="field"><span>Buried radials</span><select id="a-radials">${[[1, 'Ground rod only'], [4, '4 radials'], [8, '8 radials'], [16, '16 radials'], [32, '32 radials'], [64, '64 radials']].map(([n, l]) => opt(n, l, p.radials)).join('')}</select></label>`;
    if (T.params.includes('gpRadials')) antFields += `<label class="field"><span>Raised radials</span><select id="a-gpRadials">${[2, 3, 4].map(n => opt(n, n + ' radials', p.gpRadials)).join('')}</select></label>`;
    if (T.params.includes('cutFor')) antFields += `<label class="field"><span>Cut for</span><select id="a-cutFor">${opt('auto', 'Operating band', p.cutFor)}${bandsIn(g).map(b => opt(b.id, b.label, p.cutFor)).join('')}</select></label>`;
    let aim = '';
    if (ty === 'yagi') {
      const others = stations().filter(o => o.id !== st.id);
      aim = `<div class="field wide"><span>Aim at</span><div class="aim">${others.map(o => `<button type="button" data-aim="${o.id}">${esc(o.name)}</button>`).join('')}</div></div>`;
    }
    const typeOpts = Object.entries(A.TYPES).filter(([, t]) => t.groups.includes(g)).map(([k, t]) => opt(k, t.name, ty)).join('');

    $('#stationForm').innerHTML = `
      <div class="fgroup">
        <div class="fgroup-title">Station ${st.id !== 'home' ? '<button type="button" class="linkbtn" id="delStation">Remove</button>' : ''}</div>
        <div class="frow">
          <label class="field"><span>Name</span><input id="f-name" value="${esc(st.name)}" maxlength="28"></label>
          <label class="field"><span>Grid square</span><input id="f-grid" value="${esc(st.grid)}" maxlength="6" spellcheck="false" aria-describedby="gridHelp"></label>
        </div>
        <p class="hint" id="gridHelp">${P.gridToLatLon(st.grid) ? (g === 'vu' ? 'Use 6 characters (like EN50nm) for local stations.' : '') : 'Enter a 4 or 6 character grid, like EN50 or EN50wb.'}</p>
        ${g === 'vu' ? `<div class="frow"><label class="field"><span>Ground elevation (ft above sea level)</span><input id="f-elevFt" type="number" min="-200" max="14000" step="10" value="${st.elevFt ?? 650}"></label>
          <label class="field"><span>Local noise</span><select id="f-noise">${Object.entries(D.NOISE).map(([k, n]) => opt(k, n.label, st.noise)).join('')}</select></label></div>
          <p class="hint">Local noise also sets how tall the trees and buildings around the antenna are.</p>` : ''}
      </div>
      <div class="fgroup">
        <div class="fgroup-title">Radio</div>
        <label class="field"><span>Transceiver</span><select id="f-radio">
          <optgroup label="HF + VHF/UHF">${rg.both.map(([k, r]) => opt(k, r.name, st.radio)).join('')}</optgroup>
          <optgroup label="HF">${rg.hf.map(([k, r]) => opt(k, r.name, st.radio)).join('')}</optgroup>
          <optgroup label="VHF / UHF">${rg.vu.map(([k, r]) => opt(k, r.name, st.radio)).join('')}</optgroup>
        </select></label>
        ${maxW ? range('s-power', 'Power', Math.min(sys.power || maxW, maxW), 1, maxW, 1, 'W') : `<p class="warn">${esc(radio.name)} does not transmit on ${D.BANDS[S.band].label}.</p>`}
      </div>
      <div class="fgroup">
        <div class="fgroup-title">${g === 'vu' ? 'VHF/UHF' : 'HF'} feedline</div>
        <div class="frow">
          <label class="field"><span>Cable</span><select id="s-coax">${Object.entries(coaxGroups).map(([gn, list]) => `<optgroup label="${gn}">${list.map(([k, c]) => opt(k, c.name, sys.coax)).join('')}</optgroup>`).join('')}</select></label>
          <label class="field"><span>Length (ft)</span><input id="s-coaxFt" type="number" min="0" max="1000" step="1" value="${sys.coaxFt}"></label>
        </div>
      </div>
      <div class="fgroup">
        <div class="fgroup-title">${g === 'vu' ? 'VHF/UHF' : 'HF'} antenna</div>
        <label class="field"><span>Type</span><select id="a-type">${typeOpts}</select></label>
        <p class="hint">${esc(T.hint)}</p>
        <div class="frow">${antFields}</div>
        ${aim}
        <div class="frow">
          <label class="field"><span>At the feedpoint</span><select id="s-match">${Object.entries(D.MATCH).filter(([k]) => (k !== 'hairpin' || ty === 'yagi') && (k !== 'ideal' || T.match === 'ideal')).map(([k, m]) => opt(k, m.name, sys.match)).join('')}</select></label>
          ${g === 'hf' ? `<label class="field"><span>Ground</span><select id="f-ground">${Object.entries(D.GROUNDS).map(([k, gr]) => opt(k, gr.label, st.ground)).join('')}</select></label>` : ''}
        </div>
        ${g === 'hf' ? `<label class="field"><span>Local noise</span><select id="f-noise">${Object.entries(D.NOISE).map(([k, n]) => opt(k, n.label, st.noise)).join('')}</select></label>` : ''}
      </div>`;
  }

  const form = $('#stationForm');
  form.addEventListener('input', e => {
    const st = byId(S.sel), sys = st[grp()]; const t = e.target; if (!t.id) return;
    const [kind, key] = t.id.split('-');
    const out = t.parentElement.querySelector('output');
    if (t.type === 'range' && out) out.textContent = key === 'dir' ? `${t.value}° ${compass(+t.value)}` : `${t.value} ${key === 'power' ? 'W' : 'ft'}`;
    if (t.tagName === 'SELECT') return; // handled on change
    if (kind === 'f') {
      if (key === 'name') { st.name = t.value || 'Station'; renderTabs(); }
      else if (key === 'grid') {
        const gv = t.value.trim();
        const ok = !!P.gridToLatLon(gv);
        $('#gridHelp').textContent = ok ? '' : 'Enter a 4 or 6 character grid, like EN50 or EN50wb.';
        if (ok) st.grid = gv.slice(0, 2).toUpperCase() + gv.slice(2, 4) + gv.slice(4).toLowerCase(); else return;
      } else if (key === 'elevFt') { if (t.value === '' || isNaN(+t.value)) return; st.elevFt = +t.value; }
    } else if (kind === 's') {
      if (key === 'power') sys.power = +t.value;
      else if (key === 'coaxFt') { if (t.value === '' || !(+t.value >= 0)) return; sys.coaxFt = Math.min(1000, +t.value); }
    } else if (kind === 'a') sys.antenna[key] = +t.value;
    compute(key === 'name');
  });
  form.addEventListener('change', e => {
    const st = byId(S.sel), sys = st[grp()]; const t = e.target; if (t.tagName !== 'SELECT') return;
    const [kind, key] = t.id.split('-');
    if (kind === 'f') {
      st[key] = t.value;
      if (key === 'radio') {
        ['hf', 'vu'].forEach(g => { const m = Math.max(0, ...bandsIn(g).map(b => D.RADIOS[t.value].power[b.id] || 0)); if (m) st[g].power = m; });
        if (st.id !== 'home' && !radioIn(st, grp())) { S.sel = 'home'; renderTabs(); }
        renderForm(); renderTabs();
      }
    } else if (kind === 's') {
      sys[key] = t.value;
      if (key === 'coax' && D.COAX[t.value].balanced && sys.match !== 'none') { sys.match = 'none'; renderForm(); }
    } else if (key === 'type') {
      sys.antenna.type = t.value; sys.match = A.TYPES[t.value].match;
      if (D.COAX[sys.coax].balanced) sys.match = 'none';
      if (t.value === 'duck') { sys.antenna.height = 5; sys.coaxFt = 0; }
      renderForm();
    } else sys.antenna[key] = (key === 'cutFor' || key === 'pol') ? t.value : +t.value;
    compute();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'delStation') {
      S.remotes = S.remotes.filter(r => r.id !== S.sel); S.sel = 'home';
      ['hf', 'vu'].forEach(g => { if (!byId(S.focus[g])) S.focus[g] = (S.remotes[0] || {}).id; });
      renderTabs(); renderForm(); compute(); return;
    }
    if (b.dataset.aim) {
      const st = byId(S.sel), o = byId(b.dataset.aim);
      st[grp()].antenna.dir = Math.round(P.distBearing(locOf(st), locOf(o)).brg) % 360;
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
    const vu = grp() === 'vu';
    const cond = { hour: S.hour, month: S.month, ssn: D.SOLAR[S.solar].ssn, terrain: S.terrain };
    const all = stations();
    all.forEach(st => { st.loc = locOf(st); });
    const ch = {}; all.forEach(st => { ch[st.id] = P.chain(st, S.band); });
    if (!byId(focusId()) || !all.includes(byId(focusId()))) S.focus[grp()] = all[1] && all[1].id;
    const res = groupRemotes().map(r => {
      const out = P.link(S.home, r, null, cond, ch.home, ch[r.id]);
      const back = P.link(r, S.home, null, cond, ch[r.id], ch.home);
      let day = null;
      if (!vu) { day = []; for (let h = 0; h < 24; h++) day.push(P.link(S.home, r, null, { ...cond, hour: h }, ch.home, ch[r.id]).snr); }
      return { st: r, out, back, day, color: colorOf(r) };
    });
    let A_ = null;
    if (S.pinA && D.BANDS[S.pinA.band] && D.BANDS[S.pinA.band].group === grp()) {
      const st = { ...JSON.parse(JSON.stringify(S.pinA.home)), id: 'home', loc: S.home.loc };
      const cA = P.chain(st, S.band);
      A_ = { st, chain: cA, res: res.map(r => ({ out: P.link(st, r.st, null, cond, cA, ch[r.st.id]), back: P.link(r.st, st, null, cond, ch[r.st.id], cA) })) };
    }
    last = { cond, ch, res, A: A_, vu };
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
    const coaxW = lossW(c.matchedLoss), misW = Math.max(0, lossW(c.lineLoss) - coaxW);
    const antW = Math.max(0, W * Math.pow(10, -(c.totalLoss - c.antLoss) / 10) - pAnt);
    const devW = Math.max(0, W - pAnt - coaxW - misW - antW);
    const pk = c.ana.pat;
    const swr = v => v > 50 ? '50+:1' : v.toFixed(2) + ':1';
    const multiFeed = !!c.ana.model.feeds;
    $('#system').innerHTML = `
      <h3>${esc(st.name)} on ${c.band.label}</h3>
      ${W ? `<div class="budget">
        <div class="budget-bar" role="img" aria-label="${fmtW(pAnt)} of ${W} watts radiated">
          <span class="b-out" style="width:${pct(pAnt / W)}%"></span><span class="b-coax" style="width:${pct(coaxW / W)}%"></span><span class="b-mis" style="width:${pct(misW / W)}%"></span><span class="b-dev" style="width:${pct(devW / W)}%"></span><span class="b-ant" style="width:${pct(antW / W)}%"></span>
        </div>
        <div class="budget-key"><span><i class="b-out"></i>${fmtW(pAnt)} W ${antW > 0.05 ? 'radiated' : 'reach the antenna'}</span>${coaxW > 0.05 ? `<span><i class="b-coax"></i>coax ${fmtW(coaxW)} W</span>` : ''}${misW > 0.05 ? `<span><i class="b-mis"></i>SWR loss ${fmtW(misW)} W</span>` : ''}${devW > 0.05 ? `<span><i class="b-dev"></i>balun / tuner ${fmtW(devW)} W</span>` : ''}${antW > 0.05 ? `<span><i class="b-ant"></i>lost in the antenna ${fmtW(antW)} W</span>` : ''}</div>
      </div>` : ''}
      <dl class="kv">
        <dt>Feedpoint impedance</dt><dd>${multiFeed ? 'matched (phasing network)' : `${z.r.toFixed(0)} ${z.x < 0 ? '−' : '+'} j${Math.abs(z.x).toFixed(0)} Ω`}</dd>
        ${c.match.ideal && !multiFeed ? `<dt>After ${esc(c.match.name.toLowerCase())}</dt><dd>50 Ω</dd>` : ''}
        ${c.z.r - z.r > 0.5 ? `<dt>Ground loss resistance</dt><dd>${(c.z.r - z.r).toFixed(1)} Ω</dd>` : ''}
        <dt>SWR on the line</dt><dd>${swr(c.swrLine)}${c.coax.z0 !== 50 ? ` (${c.coax.z0} Ω)` : ''}</dd>
        <dt>SWR at the radio</dt><dd>${swr(c.swrRadio)}</dd>
        <dt>Tuner</dt><dd>${esc(c.tuner)}</dd>
        <dt>Coax loss (matched)</dt><dd>${c.matchedLoss.toFixed(2)} dB</dd>
        <dt>Extra loss from SWR</dt><dd>${c.mismatchLoss.toFixed(2)} dB</dd>
        <dt>Total system loss</dt><dd>${c.totalLoss.toFixed(2)} dB</dd>
        <dt>Peak gain</dt><dd>${pk.max.toFixed(1)} dBi at ${pk.maxEl}°</dd>
        ${last.vu ? `<dt>Antenna height</dt><dd>${(c.hAnt / A.FT).toFixed(0)} ft</dd>` : ''}
        <dt>Receive noise floor</dt><dd>${P.sMeter(c.noiseDbm, last.vu)} (${c.noiseDbm.toFixed(0)} dBm)</dd>
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
  const sg = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  function pathText(o) {
    if (!o.ok) return '';
    if (o.vu) {
      const parts = [o.los ? `Line of sight (radio horizon ${mi(o.dLos)} mi)` : `Past the radio horizon (${mi(o.dLos)} mi), by ${o.scatter ? 'troposcatter' : 'diffraction'}`];
      if (o.clutter > 0.5) parts.push(`trees and buildings −${o.clutter.toFixed(0)} dB`);
      if (o.polLoss > 3) parts.push(`polarization mismatch −${o.polLoss.toFixed(0)} dB`);
      return parts.join(' · ') + `<br>Your antenna ${sg(o.gt)} dBi toward them; theirs ${sg(o.gr)} dBi`;
    }
    return `${o.hops} hop${o.hops > 1 ? 's' : ''} · takeoff ${o.el.toFixed(0)}° · MUF ${o.muf.toFixed(1)} MHz${o.overMuf > 0 ? ' · band skips this path' : ''}<br>Your antenna ${sg(o.gt)} dBi there; theirs ${sg(o.gr)} dBi`;
  }
  function renderCards() {
    $('#cards').innerHTML = last.res.map((r, i) => {
      const o = r.out;
      let delta = '';
      if (last.A && o.ok && last.A.res[i].out.ok && r.back.ok && last.A.res[i].back.ok) {
        const d1 = o.snr - last.A.res[i].out.snr, d2 = r.back.snr - last.A.res[i].back.snr;
        const cls = (d1 + d2) > 0.2 ? 'up' : (d1 + d2) < -0.2 ? 'down' : '';
        delta = `<p class="delta ${cls}">vs A: ${sg(d1)} dB out · ${sg(d2)} dB back</p>`;
      }
      return `<div class="card" role="button" tabindex="0" data-id="${r.st.id}" aria-pressed="${r.st.id === focusId()}">
        <div class="card-head"><span class="dot" style="background:${r.color}"></span><span class="nm">${esc(r.st.name)}</span><span class="dist">${esc(r.st.grid)} · ${mi(o.km)} mi · ${o.brg.toFixed(0)}°</span></div>
        <div class="dirs">${dirBlock('You → them', o)}${dirBlock('Them → you', r.back)}</div>
        <p class="path">${pathText(o)}</p>${delta}
      </div>`;
    }).join('') || '<p class="hint">Add a station to see who you can work.</p>';
  }
  $('#cards').addEventListener('click', e => { const c = e.target.closest('.card'); if (!c) return; S.focus[grp()] = c.dataset.id; renderCards(); renderViews(); renderPlots(); });
  $('#cards').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); e.target.click(); } });

  function renderViews() {
    const st = byId(S.sel) || S.home, c = last.ch[st.id];
    let rays;
    if (st.id === 'home') rays = last.res.filter(r => r.out.ok).map(r => ({ brg: r.out.brg, el: r.out.el, color: r.color, label: r.st.name, gain: r.out.gt, selected: r.st.id === focusId() }));
    else {
      const r = last.res.find(x => x.st.id === st.id);
      rays = r && r.back.ok ? [{ brg: r.back.brg, el: r.back.el, color: colorOf(S.home), label: S.home.name, gain: r.back.gt, selected: true }] : [];
    }
    if (view3d) view3d.update({ model: c.ana.model, pat: c.ana.pat, patA: st.id === 'home' && last.A ? last.A.chain.ana.pat : null, rays, type: st[grp()].antenna.type, freeSpace: c.ana.freeSpace });
    $('#gainLegend').innerHTML = `<span>${esc(st.name)} · ${esc(A.TYPES[st[grp()].antenna.type].name)}${c.ana.freeSpace ? ' · free space' : ''}</span><div class="ramp"></div><div class="ends"><span>${(c.ana.pat.max - 30).toFixed(0)}</span><span>${c.ana.pat.max.toFixed(1)} dBi</span></div>${st.id === 'home' && last.A ? '<span>White mesh: setup A</span>' : ''}`;
    if (globe) {
      const span = Math.max(1, ...last.res.map(r => r.out.km));
      const hc = last.ch.home;
      globe.update({
        cond: last.cond, span,
        horizonKm: last.vu ? Math.sqrt(2 * P.AE * hc.hAnt / 1000) + Math.sqrt(2 * P.AE * 9.1 / 1000) : 0,
        home: { ...S.home, color: colorOf(S.home) },
        links: last.res.map(r => ({ st: r.st, color: r.color, link: r.out, rel: r.out.ok ? r.out.rel[S.mode] : 0, selected: r.st.id === focusId(), text: r.out.ok ? r.out.s : '' }))
      });
    }
  }

  function renderPlots() {
    const st = byId(S.sel) || S.home, c = last.ch[st.id];
    let target, L;
    if (st.id === 'home') { const r = last.res.find(x => x.st.id === focusId()) || last.res[0]; target = r && r.st; L = r && r.out; }
    else { const r = last.res.find(x => x.st.id === st.id); target = S.home; L = r && r.back; }
    const brg = L ? L.brg : 0;
    $('#elevTitle').textContent = `Elevation pattern toward ${target ? target.name : 'north'}`;
    $('#elevSub').textContent = L && L.ok
      ? (last.vu ? `${st.name} → ${target.name}: the signal leaves almost flat (${L.el.toFixed(1)}°), so what counts is gain at the horizon: ${L.gt.toFixed(1)} dBi.`
        : `${st.name} → ${target.name}: the path needs a ${L.el.toFixed(0)}° takeoff angle on ${D.BANDS[S.band].label}. Your antenna gives ${L.gt.toFixed(1)} dBi there.`)
      : 'Pick a station card to see its takeoff angle.';
    const series = [{ pat: c.ana.pat, color: colorOf(st), name: 'Current' }];
    if (st.id === 'home' && last.A) series.push({ pat: last.A.chain.ana.pat, color: css.getPropertyValue('--ink-2').trim(), dash: true, name: 'Setup A' });
    HS.plots.elevation($('#elevPlot'), brg, series, L && L.ok ? [{ el: Math.max(0, L.el), color: target.id === 'home' ? colorOf(S.home) : colorOf(target) }] : []);
    const thr = { snr: D.MODES[S.mode].snr, label: D.MODES[S.mode].label };
    if (!last.vu) {
      $('#dayTitle').textContent = 'Signal-to-noise through the day';
      $('#dayChartSub').textContent = `From ${S.home.name} on ${D.BANDS[S.band].label}, ${MONTHS[S.month - 1]}, ${D.SOLAR[S.solar].label.toLowerCase()}. Hover for values.`;
      HS.plots.dayChart($('#dayChart'), last.res.map(r => ({ name: r.st.name, color: r.color, values: r.day, selected: r.st.id === focusId() })), thr, S.hour);
      return;
    }
    // VHF/UHF: SNR against distance between you and the focused station's setup
    const r = last.res.find(x => x.st.id === focusId()) || last.res[0];
    $('#dayTitle').textContent = 'How far does it reach?';
    if (!r || !r.out.ok || !r.back.ok) { $('#dayChartSub').textContent = 'Pick a station whose radio is on this band.'; $('#dayChart').innerHTML = ''; return; }
    const hc = last.ch.home, rc = last.ch[r.st.id];
    const maxMi = Math.max(10, r.out.km * KM_MI * 1.8, r.out.dLos * KM_MI * 1.6);
    const ptsOut = [], ptsBack = [];
    for (let k = 1; k <= 80; k++) {
      const m = maxMi * k / 80, km = m / KM_MI;
      ptsOut.push({ x: m, v: P.losBudget(S.home, r.st, hc, rc, km, r.out.brg, r.out.back, last.cond).snr });
      ptsBack.push({ x: m, v: P.losBudget(r.st, S.home, rc, hc, km, r.out.back, r.out.brg, last.cond).snr });
    }
    $('#dayChartSub').textContent = `${S.home.name} and ${r.st.name}'s setups, moved apart along the same bearing over ${D.TERRAIN[S.terrain].label.toLowerCase()} terrain. Hover for values.`;
    HS.plots.distChart($('#dayChart'), [
      { name: `You → ${r.st.name}`, color: colorOf(S.home), values: ptsOut },
      { name: `${r.st.name} → you`, color: r.color, values: ptsBack, dash: true }
    ], thr, [{ x: r.out.km * KM_MI, label: r.st.name, color: r.color, points: [r.out.snr, r.back.snr] }], { x: r.out.dLos * KM_MI, label: 'radio horizon' }, 'mi');
  }

  function renderCaveats() {
    const notes = last.vu
      ? ['VHF/UHF uses a smooth-earth model, because real terrain elevation data isn’t loaded yet. Hills between stations are covered by the Terrain setting and each station’s ground elevation. Repeaters, ducting and sporadic-E are not modeled yet.']
      : ['Ground wave is not modeled yet, so short contacts (under about 50 miles) read low.',
        'End-fed half-waves read a higher SWR here than most real ones, because the model has no transformer or coax losses at the feed to soften the impedance peak.'];
    notes.push('Commercial antennas are represented by the generic design they are built on.');
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
    $('#viewHint').textContent = view === 'antenna' ? 'Drag to orbit · scroll to zoom' : (grp() === 'vu' ? 'Drag to spin · scroll to zoom · dashed ring: your radio horizon' : 'Drag to spin · ionosphere height shown 3× · day/night from the hour');
    (view === 'antenna' ? view3d : globe)?.resize();
  }));

  initTop(); renderTabs(); renderForm();
  try {
    view3d = HS.view3d.init($('#view-antenna'));
    globe = HS.globe.init($('#view-map'));
  } catch (e) {
    $('#canvasWrap').innerHTML = '<p class="warn" style="margin:16px">The 3D view needs WebGL, which is turned off in this browser. The predictions below still work.</p>';
  }
  compute();
  requestAnimationFrame(() => { view3d && view3d.resize(); globe && globe.resize(); });
  new ResizeObserver(() => { view3d && view3d.resize(); globe && globe.resize(); }).observe($('#canvasWrap'));
})();
