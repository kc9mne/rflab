/* SkyHop propagation + station chain.
 *
 * HF sky-wave model, simplified from the ideas behind VOACAP / ITU-R P.533:
 *  - hops off an F2 layer whose critical frequency follows the sun at each reflection point
 *  - curved-earth hop geometry -> takeoff angle and MUF (secant law)
 *  - D-layer absorption (George/Piggott form), free-space spreading, ground-reflection and excess loss
 *  - ITU-R P.372 man-made noise; reliability from day-to-day MUF and fading spread
 * It is a teaching model: relative differences between setups are its strong suit. */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};
  const RE = 6371;
  const D2R = Math.PI / 180;

  /* ---------- Maidenhead grid ---------- */
  function gridToLatLon(g) {
    g = (g || '').trim();
    if (!/^[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2})?$/.test(g)) return null;
    const G = g.toUpperCase();
    let lon = (G.charCodeAt(0) - 65) * 20 - 180 + (+G[2]) * 2;
    let lat = (G.charCodeAt(1) - 65) * 10 - 90 + (+G[3]);
    if (G.length === 6) {
      lon += (G.charCodeAt(4) - 65) * (2 / 24) + 1 / 24;
      lat += (G.charCodeAt(5) - 65) * (1 / 24) + 0.5 / 24;
    } else { lon += 1; lat += 0.5; }
    return { lat, lon };
  }
  function latLonToGrid(lat, lon) {
    lon += 180; lat += 90;
    const A = i => String.fromCharCode(65 + i), a = i => String.fromCharCode(97 + i);
    return A(Math.floor(lon / 20)) + A(Math.floor(lat / 10)) + Math.floor((lon % 20) / 2) + Math.floor(lat % 10) +
      a(Math.floor((lon % 2) * 12)) + a(Math.floor((lat % 1) * 24));
  }

  function distBearing(a, b) {
    const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
    const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
    const ang = Math.acos(Math.min(1, Math.max(-1, c)));
    const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return { km: ang * RE, ang, brg: (Math.atan2(y, x) / D2R + 360) % 360 };
  }
  // point at fraction t along the great circle a->b
  function gcPoint(a, b, t) {
    const p1 = a.lat * D2R, l1 = a.lon * D2R, p2 = b.lat * D2R, l2 = b.lon * D2R;
    const d = distBearing(a, b).ang;
    if (d < 1e-9) return { lat: a.lat, lon: a.lon };
    const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R, lon: Math.atan2(y, x) / D2R };
  }

  /* ---------- ionosphere ---------- */
  function cosZenith(pt, hourUTC, month) {
    const doy = (month - 0.5) * 30.4;
    const dec = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365) * D2R;
    const H = ((hourUTC * 15 + pt.lon) - 180) * D2R;
    const lat = pt.lat * D2R;
    return Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  }
  function layer(pt, hourUTC, month, ssn) {
    const cz = cosZenith(pt, hourUTC, month);
    const day = Math.pow(Math.max(0, (cz + 0.12) / 1.12), 0.5);
    const foDay = 5 + 0.045 * ssn, foNight = 2.6 + 0.022 * ssn;
    // higher latitudes run a little lower
    const latF = 1 - 0.15 * Math.max(0, (Math.abs(pt.lat) - 40) / 30);
    return { foF2: (foNight + (foDay - foNight) * day) * latF, h: 300 + 60 * (1 - day), cz };
  }

  function hopGeom(hopKm, h) {
    const th = hopKm / (2 * RE);
    const el = Math.atan((Math.cos(th) - RE / (RE + h)) / Math.sin(th));
    const sinPhi = RE * Math.cos(el) / (RE + h);
    const slant = Math.sqrt(RE * RE + (RE + h) ** 2 - 2 * RE * (RE + h) * Math.cos(th));
    const sinI100 = RE * Math.cos(el) / (RE + 100);
    return { el: el / D2R, secPhi: 1 / Math.sqrt(1 - sinPhi * sinPhi), slant: 2 * slant, secI100: 1 / Math.sqrt(1 - sinI100 * sinI100) };
  }

  const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
  function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

  /* Path geometry and loss for a frequency between two points (no antennas). Returns candidate modes. */
  function skyModes(a, b, fMHz, cond) {
    const db = distBearing(a, b);
    const out = [];
    if (db.km < 1) return { db, modes: out };
    const nMin = Math.max(1, Math.ceil(db.km / 3800));
    for (let n = nMin; n <= nMin + 2; n++) {
      const hopKm = db.km / n;
      // control points: middle of each hop
      let muf = Infinity, absorb = 0, hSum = 0, ctrl = [];
      for (let i = 0; i < n; i++) {
        const pt = gcPoint(a, b, (i + 0.5) / n);
        const L = layer(pt, cond.hour, cond.month, cond.ssn);
        ctrl.push({ ...pt, foF2: L.foF2, h: L.h });
        hSum += L.h;
      }
      const h = hSum / n;
      const g = hopGeom(hopKm, h);
      if (g.el < 3) continue;
      ctrl.forEach(c => { muf = Math.min(muf, c.foF2 * hopGeom(hopKm, c.h).secPhi); });
      // absorption where each hop goes up and comes down through the D layer
      for (let i = 0; i < n; i++) {
        [i / n + 0.15 / n, (i + 1) / n - 0.15 / n].forEach(t => {
          const cz = cosZenith(gcPoint(a, b, t), cond.hour, cond.month);
          const I = (1 + 0.0037 * cond.ssn) * Math.pow(Math.max(0, Math.cos(0.881 * Math.acos(Math.max(-1, Math.min(1, cz))))), 1.3);
          absorb += 0.5 * 677.2 * I * g.secI100 / (Math.pow(fMHz + 1.4, 1.98) + 10.2);
        });
      }
      const fspl = 32.45 + 20 * Math.log10(fMHz) + 20 * Math.log10(g.slant);
      const overMuf = fMHz > muf ? Math.min(60, 100 * (fMHz / muf - 1)) : 0;
      const loss = fspl + absorb + 2 * (n - 1) + 8 + overMuf;
      const pOpen = normCdf((muf - fMHz) / (0.15 * muf));
      out.push({ hops: n, el: g.el, h, muf, absorb, fspl, overMuf, loss, pOpen, ctrl, km: db.km });
    }
    return { db, modes: out };
  }

  /* ---------- station chain ---------- */
  function cabs(r, x) { return Math.sqrt(r * r + x * x); }
  function gammaMag(r, x, z0) { return cabs(r - z0, x) / cabs(r + z0, x); }
  const swrOf = g => g >= 0.999 ? 999 : (1 + g) / (1 - g);

  function chain(st, bandId) {
    const D = HS.data, band = D.BANDS[bandId];
    const radio = D.RADIOS[st.radio];
    const maxW = radio.power[bandId];
    const watts = maxW ? Math.min(st.power || maxW, maxW) : 0;
    const ana = HS.antennas.analyze(st.antenna, bandId, st.ground);
    const z = ana.sol.z;
    const M = D.MATCH[st.match] || D.MATCH.none;
    const coax = D.COAX[st.coax];
    const z0 = coax.z0;
    let rl = z.r, xl = z.x;
    if (M.ideal) { rl = z0; xl = 0; } else { rl /= M.ratio; xl /= M.ratio; }
    const swrAnt50 = swrOf(gammaMag(rl, xl, 50));
    const rho = gammaMag(rl, xl, z0);
    const ml = D.coaxLoss(st.coax, band.f, st.coaxFt);
    const a = Math.pow(10, ml / 10);
    const lineLoss = 10 * Math.log10((a * a - rho * rho) / (a * (1 - rho * rho)));
    const rhoIn = rho / a;
    const swrLine = swrOf(rho), swrRadio = swrOf(rhoIn);
    let tuner = 'none', tunerLoss = 0, warn = [];
    if (coax.balanced) { tuner = 'external balanced tuner'; tunerLoss = 0.5 + Math.min(1.5, 0.05 * Math.max(0, swrRadio - 3)); }
    else if (swrRadio <= 1.5) tuner = 'none';
    else if (radio.atu && swrRadio <= radio.atu) { tuner = 'built-in tuner'; tunerLoss = 0.2; }
    else if (swrRadio <= 2) { tuner = 'none (radio may fold back power)'; }
    else {
      tuner = 'external tuner needed'; tunerLoss = Math.min(3, 0.5 + 0.15 * (swrRadio - 3));
      warn.push(`SWR at the radio is ${swrRadio.toFixed(1)}:1, beyond the ${radio.atu ? 'built-in tuner (' + radio.atu + ':1)' : 'radio (no built-in tuner)'}. Assuming an external tuner.`);
    }
    if (swrLine > 10 && !coax.balanced) warn.push(`SWR on the coax is ${swrLine > 99 ? '99+' : swrLine.toFixed(0)}:1. Ladder line or a matching device at the antenna would cut the loss.`);
    if (!maxW) warn.push(`${radio.name} does not cover ${band.label}.`);
    const totalLoss = lineLoss + M.loss + tunerLoss;
    const ptxDbm = watts ? 10 * Math.log10(watts * 1000) : -Infinity;
    // noise at the receiver input (2500 Hz)
    const N = D.NOISE[st.noise];
    const fa = N.c - N.d * Math.log10(band.f);
    const eff = Math.min(0, ana.avgGainDb);
    const nExt = fa - 174 + 34 + eff - totalLoss;
    const nInt = -174 + 34 + radio.nf;
    const nTot = 10 * Math.log10(Math.pow(10, nExt / 10) + Math.pow(10, nInt / 10));
    return {
      band, radio, watts, ana, z, zAntenna: ana.sol.zAntenna, match: M, coax, swrAnt50, swrLine, swrRadio,
      matchedLoss: ml, lineLoss, mismatchLoss: lineLoss - ml, tuner, tunerLoss, totalLoss,
      ptxDbm, perpDbm: ptxDbm - totalLoss, nExt, nInt, noiseDbm: nTot, warn
    };
  }

  function sMeter(dbm) {
    const s = (dbm + 127) / 6; // S1 = -121, S9 = -73 (HF)
    if (s < 1) return 'below S1';
    if (s <= 9) return 'S' + Math.floor(s);
    return 'S9+' + Math.round(dbm + 73);
  }

  /* one direction: tx station -> rx station */
  function link(tx, rx, ctx, cond, txC, rxC) {
    const f = txC.band.f;
    const { db, modes } = skyModes(tx.loc, rx.loc, f, cond);
    const back = distBearing(rx.loc, tx.loc).brg;
    let best = null;
    modes.forEach(m => {
      const gt = HS.nec.lookup(txC.ana.pat, db.brg, m.el);
      const gr = HS.nec.lookup(rxC.ana.pat, back, m.el);
      const sig = txC.perpDbm + gt - m.loss + gr - rxC.totalLoss;
      const snr = sig - rxC.noiseDbm;
      const cand = { ...m, gt, gr, sig, snr };
      if (!best || cand.snr + 10 * Math.log10(Math.max(cand.pOpen, 1e-4)) > best.snr + 10 * Math.log10(Math.max(best.pOpen, 1e-4))) best = cand;
    });
    if (!best || !txC.watts) return { km: db.km, brg: db.brg, back, ok: false, reason: !txC.watts ? 'Radio cannot transmit on this band' : 'Too close for a sky-wave hop', rel: {} };
    const rel = {};
    Object.entries(HS.data.MODES).forEach(([k, md]) => {
      rel[k] = best.pOpen * normCdf((best.snr - md.snr) / 7);
    });
    return { km: db.km, brg: db.brg, back, ok: true, ...best, s: sMeter(best.sig), rel };
  }

  HS.prop = { gridToLatLon, latLonToGrid, distBearing, gcPoint, skyModes, chain, link, sMeter, layer, swrOf };
})(typeof window !== 'undefined' ? window : globalThis);
