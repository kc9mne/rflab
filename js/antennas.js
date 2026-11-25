/* SkyHop antenna library: turns a few friendly parameters into wire geometry
 * for the solver, trims to resonance where a ham would, and caches results. */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};
  const FT = 0.3048;
  const WIRE = 0.00081;      // #14 AWG radius (m)
  const TUBE = 0.0125;       // ~1" aluminium tubing radius (m)
  const lamOf = f => 299.792458 / f;

  const unit = deg => [Math.sin(deg * Math.PI / 180), Math.cos(deg * Math.PI / 180), 0];
  const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

  // ground-loss resistance (ohms) for a ground-mounted quarter-wave vs radial count, average soil
  const RADIAL_LOSS = { 1: 36, 4: 20, 8: 13, 16: 8, 32: 4.5, 64: 2.5 };
  const SOIL_FACTOR = { poor: 1.4, average: 1, good: 0.7, salt: 0.1 };

  // Generic two-arm (dipole/inverted-V) wire set. armLen in metres, heights in metres.
  function arms(armLen, hc, he, dir, radius) {
    const u = unit(dir);
    const drop = Math.max(0, Math.min(hc - he, armLen * 0.707)); // keep the included angle >= 90°
    const horiz = Math.sqrt(Math.max(armLen * armLen - drop * drop, 0.01));
    const c = [0, 0, hc];
    return [
      { p1: c, p2: [u[0] * horiz, u[1] * horiz, hc - drop], radius },
      { p1: c, p2: [-u[0] * horiz, -u[1] * horiz, hc - drop], radius }
    ];
  }

  const TYPES = {
    dipole: {
      name: 'Half-wave dipole / inverted-V',
      hint: 'Center-fed λ/2 wire. Lower the ends for an inverted-V.',
      params: ['height', 'endHeight', 'dir', 'cutFor'], groups: ['hf', 'vu'],
      match: 'choke', trim: true, pol: 'h',
      build(p, fd, s) {
        return { wires: arms(lamOf(fd) * 0.245 * s, p.height * FT, p.endHeight * FT, p.dir, WIRE), feed: { wire: 0, at: 0 } };
      }
    },
    fan: {
      name: 'Fan dipole (40m + 20m)',
      hint: 'Two dipoles sharing one feedpoint, spread apart at the ends.',
      params: ['height', 'endHeight', 'dir'],
      match: 'choke', trim: false, multiband: true, pol: 'h',
      build(p, fd, s, ctx) {
        const soil = (ctx && ctx.soil) || 'average';
        const g = HS.data.GROUNDS[soil];
        const key = 'fan|' + soil + '|' + JSON.stringify([p.height, p.endHeight, p.dir]);
        const sc = memo(key, () => {
          // trim each pair of arms in place, because the other band's wires detune it
          let s40 = 1, s20 = 1;
          for (let pass = 0; pass < 2; pass++) {
            s20 = trimScale(x => fanModel(p, s40, x), 14.175, g, s20);
            s40 = trimScale(x => fanModel(p, x, s20), 7.15, g, s40);
          }
          return [s40, s20];
        });
        return fanModel(p, sc[0], sc[1]);
      }
    },
    doublet: {
      name: 'Full-wave doublet (center-fed 1λ)',
      hint: 'Two λ/2 arms. High feedpoint impedance: wants ladder line and a tuner.',
      params: ['height', 'endHeight', 'dir', 'cutFor'],
      match: '4to1', trim: false, pol: 'h',
      build(p, fd) {
        return { wires: arms(lamOf(fd) * 0.5, p.height * FT, p.endHeight * FT, p.dir, WIRE), feed: { wire: 0, at: 0 } };
      }
    },
    efhw: {
      name: 'End-fed half-wave (EFHW)',
      hint: 'λ/2 wire fed at one end through a 49:1 transformer. Works on harmonics.',
      params: ['height', 'endHeight', 'dir', 'cutFor'],
      heightLabels: { height: 'Feed end height', endHeight: 'Far end height' },
      match: '49to1', trim: true, highZ: true, pol: 'h',
      build(p, fd, s) {
        const lam = lamOf(fd), L = lam * 0.47 * s;
        const u = unit(p.dir), hf = p.height * FT, he = p.endHeight * FT;
        const rise = Math.max(Math.min(he - hf, L * 0.9), -L * 0.9);
        const hz = Math.sqrt(L * L - rise * rise);
        const fp = [0, 0, hf];
        // counterpoise: the coax shield running down toward the rig
        const cpL = Math.min(lam * 0.1, Math.max(hf - 0.3, 0.3)); // shield runs down to a choke near the ground
        return {
          wires: [
            { p1: [0, 0, hf - cpL], p2: fp, radius: WIRE },
            { p1: fp, p2: [u[0] * hz, u[1] * hz, hf + rise], radius: WIRE }
          ], feed: { wire: 1, at: 0 }
        };
      }
    },
    hloop: {
      name: 'Horizontal full-wave loop',
      hint: 'A square "sky loop" one wavelength around, flat above the ground.',
      params: ['height', 'dir', 'cutFor'],
      match: '4to1', trim: true, pol: 'h',
      build(p, fd, s) {
        const a = lamOf(fd) * 0.254 * s / 2, h = p.height * FT;
        const u = unit(p.dir), v = [u[1], -u[0], 0];
        const P = (x, y) => [u[0] * x + v[0] * y, u[1] * x + v[1] * y, h];
        const c = [P(-a, -a), P(a, -a), P(a, a), P(-a, a)], m = P(0, -a);
        return {
          wires: [{ p1: m, p2: c[1], radius: WIRE }, { p1: c[1], p2: c[2], radius: WIRE },
            { p1: c[2], p2: c[3], radius: WIRE }, { p1: c[3], p2: c[0], radius: WIRE }, { p1: c[0], p2: m, radius: WIRE }],
          feed: { wire: 0, at: 0 }
        };
      }
    },
    delta: {
      name: 'Delta loop (vertical, apex up)',
      hint: 'Triangle loop one wavelength around, fed in the middle of the bottom wire.',
      params: ['height', 'dir', 'cutFor'],
      heightLabels: { height: 'Bottom wire height' },
      match: 'choke', trim: true, pol: 'h',
      build(p, fd, s) {
        const side = lamOf(fd) * 1.02 * s / 3, h = p.height * FT, u = unit(p.dir);
        const L = [-u[0] * side / 2, -u[1] * side / 2, h], R = [u[0] * side / 2, u[1] * side / 2, h];
        const top = [0, 0, h + side * 0.866], m = [0, 0, h];
        return {
          wires: [{ p1: m, p2: R, radius: WIRE }, { p1: R, p2: top, radius: WIRE },
            { p1: top, p2: L, radius: WIRE }, { p1: L, p2: m, radius: WIRE }],
          feed: { wire: 0, at: 0 }
        };
      }
    },
    vertical: {
      name: 'Quarter-wave vertical (ground mounted)',
      hint: 'λ/4 radiator at ground level over buried radials. Radial count sets ground loss.',
      params: ['radials', 'cutFor'],
      match: 'none', trim: true, pol: 'v',
      build(p, fd, s, ctx) {
        const L = lamOf(fd) * 0.245 * s;
        const loss = (RADIAL_LOSS[p.radials] || 20) * (SOIL_FACTOR[ctx.soil] || 1);
        return { wires: [{ p1: [0, 0, 0], p2: [0, 0, L], radius: TUBE }], feed: { wire: 0, at: 0 }, loadOhms: loss };
      }
    },
    gp: {
      name: 'Elevated ground-plane vertical',
      hint: 'λ/4 radiator up on a mast with tuned radials sloping down from its base.',
      params: ['height', 'gpRadials', 'cutFor'], groups: ['hf', 'vu'],
      heightLabels: { height: 'Base height' },
      match: 'choke', trim: true, pol: 'v',
      build(p, fd, s) {
        const L = lamOf(fd) * 0.245 * s, hb = p.height * FT, n = p.gpRadials || 4;
        const ang = Math.min(30 * Math.PI / 180, Math.asin(Math.min(1, Math.max(0, (hb - 0.3) / L))));
        const base = [0, 0, hb];
        const w = [{ p1: base, p2: [0, 0, hb + L], radius: TUBE }];
        for (let i = 0; i < n; i++) {
          const a = i * 2 * Math.PI / n;
          w.push({ p1: base, p2: [Math.sin(a) * L * Math.cos(ang), Math.cos(a) * L * Math.cos(ang), hb - L * Math.sin(ang)], radius: WIRE });
        }
        return { wires: w, feed: { wire: 0, at: 0 } };
      }
    },
    yagi: {
      name: 'Yagi beam',
      hint: 'Driven element plus a reflector and directors on a boom, aimed with a rotator.',
      params: ['height', 'dir', 'elements', 'pol'], groups: ['hf', 'vu'],
      dirLabel: 'Beam heading',
      match: 'hairpin', trim: true, pol: 'h', monoband: true,
      build(p, fd, s, ctx) {
        const lam = lamOf(fd), h = p.height * FT, n = p.elements || 3, vert = p.pol === 'v';
        const rad = Math.min(TUBE, lam / 400);
        const Lres = resonantElement(fd, h, ctx && ctx.ground, rad);
        // spacing (λ) from the previous element and length factor relative to a resonant element
        const plan = [[0, 1.05], [0.16, s]];
        const dSp = [0.15, 0.2, 0.22], dLen = [0.955, 0.945, 0.935];
        for (let i = 0; i < n - 2; i++) plan.push([dSp[i], dLen[i]]);
        const u = unit(p.dir), v = vert ? [0, 0, 1] : [u[1], -u[0], 0];
        let x = 0; const pos = plan.map(([sp]) => (x += sp * lam));
        const mid = (pos[0] + pos[pos.length - 1]) / 2;
        const wires = []; let feed;
        plan.forEach(([, lf], i) => {
          const half = Lres * lf / 2, b = pos[i] - mid;
          const c = [u[0] * b, u[1] * b, h];
          if (i === 1) {
            feed = { wire: wires.length, at: 0 };
            wires.push({ p1: c, p2: add(c, v, half), radius: rad });
            wires.push({ p1: c, p2: add(c, v, -half), radius: rad });
          } else {
            wires.push({ p1: add(c, v, -half), p2: add(c, v, half), radius: rad, segs: 2 * Math.ceil(half / (lam / 40)) });
          }
        });
        return { wires, feed };
      }
    },
    jpole: {
      name: 'J-pole',
      hint: 'End-fed λ/2 vertical with a λ/4 matching stub, usually copper pipe or ladder line.',
      params: ['height', 'cutFor'], groups: ['vu'],
      heightLabels: { height: 'Bottom height' },
      match: 'ideal', trim: false, pol: 'v', maxSegFrac: 1 / 60,
      build(p, fd) {
        const lam = lamOf(fd), hb = p.height * FT, sp = lam * 0.025, r = lam / 700;
        const Ll = lam * 0.75 * 0.96, Ls = lam * 0.25 * 0.96, tap = lam * 0.04;
        const A = [0, 0, hb], At = [0, 0, hb + tap], B = [sp, 0, hb], Bt = [sp, 0, hb + tap];
        return {
          wires: [
            { p1: A, p2: At, radius: r }, { p1: At, p2: [0, 0, hb + Ll], radius: r },
            { p1: B, p2: Bt, radius: r }, { p1: Bt, p2: [sp, 0, hb + Ls], radius: r },
            { p1: A, p2: B, radius: r, segs: 2 }, { p1: At, p2: Bt, radius: r, segs: 2 }
          ], feed: { wire: 5, at: 0.5 }
        };
      }
    },
    collinear: {
      name: 'Collinear vertical (X50 / X200 style)',
      hint: 'Half-wave sections stacked and fed in phase. More sections squeeze the pattern toward the horizon.',
      params: ['height', 'sections', 'cutFor'], groups: ['vu'],
      heightLabels: { height: 'Base height' },
      match: 'ideal', trim: false, pol: 'v',
      build(p, fd) {
        const lam = lamOf(fd), hb = p.height * FT, n = p.sections || 2, half = lam * 0.235, r = lam / 500;
        const wires = [], feeds = [];
        for (let i = 0; i < n; i++) {
          const c = hb + half + i * 0.75 * lam;
          feeds.push({ wire: wires.length, at: 1 });
          wires.push({ p1: [0, 0, c - half], p2: [0, 0, c], radius: r });
          wires.push({ p1: [0, 0, c], p2: [0, 0, c + half], radius: r });
        }
        return { wires, feed: feeds[0], feeds };
      }
    },
    mobile: {
      name: 'Mobile whip (car roof)',
      hint: 'Quarter-wave whip on a mag mount, with the car roof as its ground plane.',
      params: ['cutFor'], groups: ['vu'],
      match: 'none', trim: true, pol: 'v',
      build(p, fd, s) {
        const lam = lamOf(fd), hb = 1.5, L = lam * 0.245 * s, rl = Math.min(0.6, lam * 0.25);
        const w = [{ p1: [0, 0, hb], p2: [0, 0, hb + L], radius: 0.001 }];
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; w.push({ p1: [0, 0, hb], p2: [Math.sin(a) * rl, Math.cos(a) * rl, hb], radius: 0.01 }); }
        return { wires: w, feed: { wire: 0, at: 0 } };
      }
    },
    duck: {
      name: 'Handheld rubber duck',
      hint: 'The stock helical antenna on a handheld radio. Short and lossy, and your hand and body soak up more.',
      params: ['height'], groups: ['vu'],
      heightLabels: { height: 'Held at' },
      match: 'none', trim: true, pol: 'v', extraLoss: { '2m': 7, '70cm': 4 },
      build(p, fd, s) {
        const lam = lamOf(fd), h = p.height * FT, L = lam * 0.245 * s, cp = Math.min(lam * 0.1, h - 0.3);
        return { wires: [{ p1: [0, 0, h - cp], p2: [0, 0, h], radius: 0.02 }, { p1: [0, 0, h], p2: [0, 0, h + L], radius: 0.002 }], feed: { wire: 1, at: 0 } };
      }
    }
  };
  Object.values(TYPES).forEach(T => { T.groups = T.groups || ['hf']; });

  function fanModel(p, s40, s20) {
    const L40 = trimmedLen('dipole', p, 7.15) * s40, L20 = trimmedLen('dipole', p, 14.175) * s20;
    const u = unit(p.dir), hc = p.height * FT, he = p.endHeight * FT, g = 0.15;
    const cA = [u[0] * g, u[1] * g, hc], cB = [-u[0] * g, -u[1] * g, hc];
    const w = [{ p1: cB, p2: cA, radius: WIRE, segs: 2 }];
    // arms leave the ends of the short center wire; the 20m pair hangs 0.6 m lower to spread them
    [[L40, 0], [L20, 0.6]].forEach(([L, sag]) => {
      [[cA, 1], [cB, -1]].forEach(([c, sg]) => {
        const len = L - g, drop = Math.max(0, Math.min(hc - he + sag, len * 0.707));
        const hz = Math.sqrt(len * len - drop * drop);
        w.push({ p1: c, p2: [c[0] + sg * u[0] * hz, c[1] + sg * u[1] * hz, hc - drop], radius: WIRE });
      });
    });
    return { wires: w, feed: { wire: 0, at: 0.5 } };
  }

  const cache = new Map();
  const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

  function resonantElement(fd, h, ground, rad) {
    return memo('el|' + fd + '|' + h.toFixed(2) + '|' + !!ground + '|' + rad, () => {
      const lam = lamOf(fd);
      const s = trimScale(sc => ({ wires: [{ p1: [-lam * 0.24 * sc, 0, h], p2: [lam * 0.24 * sc, 0, h], radius: rad, segs: 22 }], feed: { wire: 0, at: 0.5 } }), fd, ground === undefined ? { er: 13, sigma: 0.005 } : ground);
      return lam * 0.48 * s;
    });
  }

  // secant search for the scale that zeroes feed reactance
  function trimScale(buildAt, fd, ground, start = 1) {
    const X = s => { const m = buildAt(s); return HS.nec.solve({ ...m, freqMHz: fd, ground }).zAntenna.x; };
    let s0 = start, s1 = start * 0.97, x0 = X(s0), x1 = X(s1);
    for (let i = 0; i < 8 && Math.abs(x1) > 1; i++) {
      const s2 = s1 - x1 * (s1 - s0) / (x1 - x0);
      if (!isFinite(s2) || Math.abs(s2 - s1) < 1e-5) break;
      s0 = s1; x0 = x1; s1 = Math.min(Math.max(s2, 0.7), 1.3); x1 = X(s1);
    }
    return s1;
  }

  // end-fed: trim the way a ham does, for lowest SWR through the 49:1 transformer
  function trimHighZ(buildAt, fd, ground) {
    const swr = sc => {
      const z = HS.nec.solve({ ...buildAt(sc), freqMHz: fd, ground }).zAntenna;
      const r = z.r / 49, x = z.x / 49;
      const nr = r - 50, d = (r + 50) ** 2 + x * x;
      const g = Math.sqrt(((nr * (r + 50) + x * x) ** 2 + (x * (r + 50) - nr * x) ** 2)) / d;
      return (1 + g) / (1 - Math.min(g, 0.999));
    };
    let best = 1.04, bv = Infinity;
    for (let sc = 0.96; sc <= 1.121; sc += 0.01) { const v = swr(sc); if (v < bv) { bv = v; best = sc; } }
    let lo = best - 0.01, hi = best + 0.01;
    for (let i = 0; i < 10; i++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      if (swr(m1) < swr(m2)) hi = m2; else lo = m1;
    }
    return (lo + hi) / 2;
  }

  function effCut(p, opBand) {
    const B = HS.data.BANDS, c = p.cutFor;
    return (c && c !== 'auto' && B[c] && B[c].group === B[opBand].group) ? c : opBand;
  }

  function trimmedLen(type, p, fd) {
    // arm length (m) of a dipole trimmed at fd at this height
    const sc = scaleFor(type, p, fd, 'average');
    return lamOf(fd) * 0.245 * sc;
  }

  const groundOf = soil => soil === 'free' ? null : (HS.data.GROUNDS[soil] || HS.data.GROUNDS.average);

  function scaleFor(type, p, fd, soil) {
    const T = TYPES[type];
    if (!T.trim) return 1;
    const g = groundOf(soil);
    const key = 'trim|' + type + '|' + fd + '|' + soil + '|' + JSON.stringify(geomParams(T, p));
    const bld = s => ({ ...T.build(p, fd, s, { soil, ground: g }), loadOhms: 0, maxSegFrac: T.maxSegFrac });
    return memo(key, () => T.highZ ? trimHighZ(bld, fd, g) : trimScale(bld, fd, g));
  }

  function geomParams(T, p) {
    const o = {}; T.params.forEach(k => o[k] = p[k]); return o;
  }

  /* Build + solve + sample the pattern for a station's antenna on a band.
   * Returns {sol, pat, model, info} (cached by inputs). */
  function analyze(ant, bandId, soilIn) {
    const band = HS.data.BANDS[bandId];
    const T = TYPES[ant.type];
    // at VHF/UHF the antenna is solved in free space: the line-of-sight model adds the ground itself
    const soil = band.group === 'vu' ? 'free' : soilIn;
    const cutId = T.multiband ? bandId : (T.monoband ? bandId : effCut(ant, bandId));
    const fd = HS.data.BANDS[cutId].f;
    const key = 'an|' + ant.type + '|' + bandId + '|' + cutId + '|' + soil + '|' + JSON.stringify(geomParams(T, ant));
    return memo(key, () => {
      const s = scaleFor(ant.type, ant, fd, soil);
      const g = groundOf(soil);
      const model = T.build(ant, fd, s, { soil, ground: g });
      const sol = HS.nec.solve({ ...model, freqMHz: band.f, ground: g, maxSegFrac: T.maxSegFrac });
      const pat = HS.nec.pattern(sol, 5, 2);
      // radiation efficiency for noise scaling: radiated / input, from pattern integral
      let prad = 0, wsum = 0;
      pat.el.forEach((e, j) => {
        const w = Math.cos(e * Math.PI / 180);
        pat.az.forEach((a, i) => { prad += Math.pow(10, pat.g[j * pat.az.length + i] / 10) * w; wsum += w; });
      });
      const avgGain = g ? prad / wsum / 2 : prad / wsum; // over ground: upper hemisphere only
      const extraLoss = (T.extraLoss && T.extraLoss[bandId]) || 0;
      return { sol, pat, model, cutBand: cutId, scale: s, extraLoss, freeSpace: !g, avgGainDb: 10 * Math.log10(Math.max(avgGain, 1e-6)) };
    });
  }

  HS.antennas = { TYPES, analyze, FT, unit, lamOf };
})(typeof window !== 'undefined' ? window : globalThis);
