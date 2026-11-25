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

  // a station keeps one antenna system per band group: st.hf and st.vu = {antenna, coax, coaxFt, match, power}
  function chain(st, bandId) {
    const D = HS.data, band = D.BANDS[bandId];
    const sys = st[band.group] || st;
    const radio = D.RADIOS[st.radio];
    const maxW = radio.power[bandId];
    const watts = maxW ? Math.min(sys.power || maxW, maxW) : 0;
    const ana = HS.antennas.analyze(sys.antenna, bandId, st.ground);
    const wz = []; ana.model.wires.forEach(w => wz.push(w.p1[2], w.p2[2]));
    const hAnt = Math.max(0.5, wz.reduce((a, b) => a + b, 0) / wz.length);
    const z = ana.sol.z;
    const M = D.MATCH[sys.match] || D.MATCH.none;
    const coax = D.COAX[sys.coax];
    const z0 = coax.z0;
    let rl = z.r, xl = z.x;
    if (M.ideal) { rl = z0; xl = 0; } else { rl /= M.ratio; xl /= M.ratio; }
    const swrAnt50 = swrOf(gammaMag(rl, xl, 50));
    const rho = gammaMag(rl, xl, z0);
    const ml = D.coaxLoss(sys.coax, band.f, sys.coaxFt);
    const a = Math.pow(10, ml / 10);
    const lineLoss = 10 * Math.log10((a * a - rho * rho) / (a * (1 - rho * rho)));
    const rhoIn = rho / a;
    const swrLine = swrOf(rho), swrRadio = swrOf(rhoIn);
    let tuner = 'none', tunerLoss = 0, warn = [];
    if (coax.balanced) { tuner = 'external balanced tuner'; tunerLoss = 0.5 + Math.min(1.5, 0.05 * Math.max(0, swrRadio - 3)); }
    else if (swrRadio <= 1.5) tuner = 'none';
    else if (radio.atu && band.group === 'hf' && swrRadio <= radio.atu) { tuner = 'built-in tuner'; tunerLoss = 0.2; }
    else if (swrRadio <= 2) { tuner = 'none (radio may fold back power)'; }
    else {
      tuner = 'external tuner needed'; tunerLoss = Math.min(3, 0.5 + 0.15 * (swrRadio - 3));
      warn.push(`SWR at the radio is ${swrRadio.toFixed(1)}:1, beyond the ${radio.atu && band.group === 'hf' ? 'built-in tuner (' + radio.atu + ':1)' : 'radio (no built-in tuner on this band)'}. Assuming an external tuner.`);
    }
    if (swrLine > 10 && !coax.balanced) warn.push(`SWR on the coax is ${swrLine > 99 ? '99+' : swrLine.toFixed(0)}:1. Ladder line or a matching device at the antenna would cut the loss.`);
    if (!maxW) warn.push(`${radio.name} does not cover ${band.label}.`);
    const antLoss = ana.extraLoss || 0;
    if (antLoss) warn.push(`A rubber duck throws away about ${antLoss} dB on ${band.label} compared with a full-size antenna.`);
    const totalLoss = lineLoss + M.loss + tunerLoss + antLoss;
    const ptxDbm = watts ? 10 * Math.log10(watts * 1000) : -Infinity;
    // noise at the receiver input (2500 Hz)
    const N = D.NOISE[st.noise];
    const fa = N.c - N.d * Math.log10(band.f);
    const eff = Math.min(0, ana.avgGainDb);
    const nExt = fa - 174 + 34 + eff - totalLoss;
    const nInt = -174 + 34 + radio.nf;
    const nTot = 10 * Math.log10(Math.pow(10, nExt / 10) + Math.pow(10, nInt / 10));
    return {
      band, radio, watts, ana, z, hAnt, antLoss, sys, zAntenna: ana.sol.zAntenna, match: M, coax, swrAnt50, swrLine, swrRadio,
      matchedLoss: ml, lineLoss, mismatchLoss: lineLoss - ml, tuner, tunerLoss, totalLoss,
      ptxDbm, perpDbm: ptxDbm - totalLoss, nExt, nInt, noiseDbm: nTot, warn
    };
  }

  // IARU S-meter: S9 = -73 dBm below 30 MHz, -93 dBm above; 6 dB per S-unit
  function sMeter(dbm, vu) {
    const s9 = vu ? -93 : -73, s = (dbm - s9) / 6 + 9;
    if (s < 1) return 'below S1';
    if (s <= 9) return 'S' + Math.floor(s);
    return 'S9+' + Math.round(dbm - s9);
  }

  /* ---------- VHF/UHF line of sight ----------
   * Smooth earth with a 4/3 effective radius: plane-earth (two-ray) loss inside the radio horizon,
   * ITU-R P.526 spherical-earth diffraction beyond it, a rough tropospheric-scatter floor for long paths,
   * plus terrain roughness, local clutter (trees, buildings) and polarisation mismatch. */
  const AE = 8495; // km
  function p526(dKm, fMHz, h1, h2) {
    const X = 2.188 * Math.cbrt(fMHz) * Math.pow(AE, -2 / 3) * dKm;
    const Yk = 9.575e-3 * Math.pow(fMHz, 2 / 3) * Math.pow(AE, -1 / 3);
    const F = X >= 1.6 ? 11 + 10 * Math.log10(X) - 17.6 * X : -20 * Math.log10(X) - 5.6488 * Math.pow(X, 1.425);
    const G = h => { const B = Yk * h; const g = B > 2 ? 17.6 * Math.sqrt(B - 1.1) - 5 * Math.log10(B - 1.1) - 8 : 20 * Math.log10(B + 0.1 * B * B * B); return Math.max(g, -38); };
    return -(F + G(h1) + G(h2)); // dB below free space
  }
  // smooth-earth excess loss over free space for effective antenna heights h1, h2 (m)
  function smoothExcess(dk, fMHz, h1, h2) {
    const dm = dk * 1000;
    const fspl = 32.45 + 20 * Math.log10(fMHz) + 20 * Math.log10(dk);
    const dLos = Math.sqrt(2 * AE * h1 / 1000) + Math.sqrt(2 * AE * h2 / 1000);
    const aPe = Math.max(0, 40 * Math.log10(dm) - 20 * Math.log10(h1 * h2) - fspl);
    const aDf = Math.max(0, p526(dk, fMHz, h1, h2));
    let a;
    if (dk <= 0.8 * dLos) a = aPe;
    else if (dk >= 1.2 * dLos) a = aDf;
    else { const t = (dk - 0.8 * dLos) / (0.4 * dLos); a = aPe * (1 - t) + aDf * t; }
    return { a, dLos, fspl };
  }
  const J = nu => nu > -0.78 ? 6.9 + 20 * Math.log10(Math.sqrt((nu - 0.1) ** 2 + 1) + nu - 0.1) : 0;
  /* ITU-R P.526 Bullington diffraction over a profile (d km, h m above sea level),
   * terminals hts/hrs m above sea level, wavelength lam m. */
  function bullington(d, h, hts, hrs, lam) {
    const N = d.length, D = d[N - 1], Ce = 1 / AE;
    let Stim = -Infinity, iTim = -1;
    for (let i = 1; i < N - 1; i++) {
      const s = (h[i] + 500 * Ce * d[i] * (D - d[i]) - hts) / d[i];
      if (s > Stim) { Stim = s; iTim = i; }
    }
    const Str = (hrs - hts) / D;
    let nu, idx = iTim, clear;
    if (N < 3) { return { L: 0, nu: -9, idx: -1, clear: true, Stim: Str }; }
    if (Stim < Str) {
      clear = true; nu = -Infinity;
      for (let i = 1; i < N - 1; i++) {
        const v = (h[i] + 500 * Ce * d[i] * (D - d[i]) - (hts * (D - d[i]) + hrs * d[i]) / D) * Math.sqrt(0.002 * D / (lam * d[i] * (D - d[i])));
        if (v > nu) { nu = v; idx = i; }
      }
    } else {
      clear = false;
      let Srim = -Infinity;
      for (let i = 1; i < N - 1; i++) Srim = Math.max(Srim, (h[i] + 500 * Ce * d[i] * (D - d[i]) - hrs) / (D - d[i]));
      const dbp = (hrs - hts + Srim * D) / (Stim + Srim);
      nu = (hts + Stim * dbp - (hts * (D - dbp) + hrs * dbp) / D) * Math.sqrt(0.002 * D / (lam * dbp * (D - dbp)));
    }
    const Luc = J(nu);
    return { L: Luc + (1 - Math.exp(-Luc / 6)) * (10 + 0.02 * D), nu, idx, clear, Stim };
  }
  // least-squares smooth earth through a profile: surface height (m) at each end
  function smoothFit(d, h) {
    let v1 = 0, v2 = 0; const D = d[d.length - 1];
    for (let i = 1; i < d.length; i++) {
      const dd = d[i] - d[i - 1];
      v1 += dd * (h[i] + h[i - 1]);
      v2 += dd * (h[i] * (2 * d[i] + d[i - 1]) + h[i - 1] * (d[i] + 2 * d[i - 1]));
    }
    return { hst: (2 * v1 * D - v2) / (D * D), hsr: (v2 - v1 * D) / (D * D) };
  }
  const reverseProfile = p => ({ d: p.d.map(x => p.km - x).reverse(), h: p.h.slice().reverse(), km: p.km });

  /* Path loss between antennas h1, h2 (m). Without a profile, h1/h2 are heights above the lower site and the
   * ground is a smooth earth (plus the statistical Terrain setting). With a profile {d,h}, h1/h2 are heights
   * above local ground and the delta-Bullington method of ITU-R P.526 adds the real terrain. */
  function losCore(dKm, fMHz, h1, h2, cond, prof) {
    const D = HS.data;
    const dk = Math.max(dKm, 0.05);
    let a, dLos, he1 = h1, he2 = h2, terr = null;
    const fspl = 32.45 + 20 * Math.log10(fMHz) + 20 * Math.log10(dk);
    if (prof && prof.d.length >= 3) {
      const n = prof.d.length, lam = 299.792458 / fMHz;
      const hts = prof.h[0] + h1, hrs = prof.h[n - 1] + h2;
      const fit = smoothFit(prof.d, prof.h);
      he1 = Math.max(h1, hts - fit.hst); he2 = Math.max(h2, hrs - fit.hsr);
      const zero = prof.d.map(() => 0);
      const Lb = bullington(prof.d, prof.h, hts, hrs, lam);
      const Ls = bullington(prof.d, zero, he1, he2, lam);
      const sm = smoothExcess(dk, fMHz, he1, he2);
      a = Lb.L + Math.max(0, sm.a - Ls.L);
      dLos = sm.dLos;
      terr = { ...Lb, hts, hrs, he1, he2, terrainLoss: Math.max(0, a - smoothExcess(dk, fMHz, h1, h2).a) };
    } else {
      const sm = smoothExcess(dk, fMHz, h1, h2);
      a = sm.a; dLos = sm.dLos;
    }
    const lDiff = fspl + a;
    // troposcatter floor: starts no stronger than the ground-reflection loss at the horizon (low antennas scatter poorly)
    const fsplH = 32.45 + 20 * Math.log10(fMHz) + 20 * Math.log10(dLos);
    const aH = Math.max(0, 40 * Math.log10(dLos * 1000) - 20 * Math.log10(he1 * he2) - fsplH);
    // terrain near either end raises the scatter angle too, so the scatter path pays part of the hill loss
    const hillScatter = terr ? 0.5 * Math.max(0, a - smoothExcess(dk, fMHz, h1, h2).a) : 0;
    const lSc = dk > dLos ? fspl + Math.max(40, aH + 6) + 0.08 * (dk - dLos) + 10 * Math.log10(fMHz / 144) + hillScatter : Infinity;
    const lBase = -10 * Math.log10(Math.pow(10, -lDiff / 10) + Math.pow(10, -lSc / 10));
    const T = D.TERRAIN[cond.terrain] || D.TERRAIN.flat;
    const terrain = terr ? 0 : T.loss * (1 - Math.exp(-dk / 30));
    return { fspl, dLos, a, lDiff, lSc, lBase, terrain, sigma: terr ? 6 : T.sigma, scatter: lSc < lDiff && dk > 80, terr };
  }
  function clutterLoss(st, c) {
    const hc = HS.data.CLUTTER[st.noise] ?? 6;
    if (c.hAnt >= hc) return 0;
    return Math.min(20, 4 + (hc - c.hAnt)) * (c.band.f > 300 ? 1.2 : 1);
  }
  // signal for a VHF/UHF path at distance dKm (lets the chart sweep distance with the same stations)
  function losBudget(tx, rx, txC, rxC, dKm, brg, back, cond, prof) {
    const FT = 0.3048;
    let h1, h2, L;
    const dm = Math.max(dKm, 0.05) * 1000, aeM = AE * 1000;
    let elT, elR;
    if (prof) {
      h1 = txC.hAnt; h2 = rxC.hAnt;
      L = losCore(dKm, txC.band.f, h1, h2, cond, prof);
      const t = L.terr;
      if (t.clear) {
        elT = (Math.atan((t.hrs - t.hts) / dm) - dm / (2 * aeM)) * 180 / Math.PI;
        elR = (Math.atan((t.hts - t.hrs) / dm) - dm / (2 * aeM)) * 180 / Math.PI;
      } else {
        // aim at the terrain edge that blocks the path
        elT = Math.atan(t.Stim / 1000) * 180 / Math.PI;
        const rp = reverseProfile(prof), r = bullington(rp.d, rp.h, t.hrs, t.hts, 299.792458 / txC.band.f);
        elR = Math.atan(r.Stim / 1000) * 180 / Math.PI;
      }
    } else {
      const e1 = (tx.elevFt ?? 650) * FT, e2 = (rx.elevFt ?? 650) * FT, base = Math.min(e1, e2);
      h1 = txC.hAnt + e1 - base; h2 = rxC.hAnt + e2 - base;
      L = losCore(dKm, txC.band.f, h1, h2, cond);
      elT = (Math.atan((h2 - h1) / dm) - dm / (2 * aeM)) * 180 / Math.PI;
      elR = (Math.atan((h1 - h2) / dm) - dm / (2 * aeM)) * 180 / Math.PI;
    }
    elT = Math.max(-10, Math.min(30, elT)); elR = Math.max(-10, Math.min(30, elR));
    const gt = HS.nec.lookup(txC.ana.pat, brg, elT), gr = HS.nec.lookup(rxC.ana.pat, back, elR);
    const vt = HS.nec.vertFrac(txC.ana.pat, brg, elT), vr = HS.nec.vertFrac(rxC.ana.pat, back, elR);
    const polLoss = -10 * Math.log10(Math.max(0.01, vt * vr + (1 - vt) * (1 - vr)));
    const clutter = clutterLoss(tx, txC) + clutterLoss(rx, rxC);
    const loss = L.lBase + L.terrain + clutter + polLoss;
    const sig = txC.perpDbm + gt - loss + gr - rxC.totalLoss;
    const los = L.terr ? L.terr.clear : dKm <= L.dLos;
    return { ...L, h1, h2, el: elT, gt, gr, polLoss, clutter, loss, sig, snr: sig - rxC.noiseDbm, los };
  }

  function link(tx, rx, ctx, cond, txC, rxC) {
    const f = txC.band.f;
    if (txC.band.group === 'vu') {
      const db = distBearing(tx.loc, rx.loc), back = distBearing(rx.loc, tx.loc).brg;
      if (!txC.watts) return { km: db.km, brg: db.brg, back, ok: false, reason: 'Radio cannot transmit on this band', rel: {} };
      if (!rxC.radio.power[txC.band.id]) return { km: db.km, brg: db.brg, back, ok: false, reason: 'Their radio is not on this band', rel: {} };
      const b = losBudget(tx, rx, txC, rxC, db.km, db.brg, back, cond, ctx && ctx.prof);
      const rel = {};
      Object.entries(HS.data.MODES).forEach(([k, md]) => { rel[k] = normCdf((b.snr - md.snr) / b.sigma); });
      return { km: db.km, brg: db.brg, back, ok: true, vu: true, hops: 0, h: 0, ...b, s: sMeter(b.sig, true), rel };
    }
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

  HS.prop = { gridToLatLon, latLonToGrid, distBearing, gcPoint, skyModes, chain, link, sMeter, layer, swrOf, losCore, losBudget, bullington, smoothFit, reverseProfile, AE };
})(typeof window !== 'undefined' ? window : globalThis);
