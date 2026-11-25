/* SkyHop thin-wire antenna solver.
 *
 * Method of moments for straight wire segments (mixed-potential EFIE, Galerkin
 * with triangle basis functions, reduced thin-wire kernel). Ground is handled
 * the MININEC way: perfect-ground images while solving for the currents, then
 * Fresnel reflection coefficients for the real ground when computing the far
 * field. Coordinates are metres: x = east, y = north, z = up.
 */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};

  const ETA = 376.730313;
  const C0 = 299792458;

  // Gauss-Legendre nodes/weights on [0,1]
  function gauss(n) {
    const tab = {
      2: [[-0.5773502691896257, 1], [0.5773502691896257, 1]],
      3: [[-0.7745966692414834, 0.5555555555555556], [0, 0.8888888888888888], [0.7745966692414834, 0.5555555555555556]],
      4: [[-0.8611363115940526, 0.3478548451374538], [-0.3399810435848563, 0.6521451548625461],
          [0.3399810435848563, 0.6521451548625461], [0.8611363115940526, 0.3478548451374538]],
      8: [[-0.9602898564975363, 0.1012285362903763], [-0.7966664774136267, 0.2223810344533745],
          [-0.5255324099163290, 0.3137066458778873], [-0.1834346424956498, 0.3626837833783620],
          [0.1834346424956498, 0.3626837833783620], [0.5255324099163290, 0.3137066458778873],
          [0.7966664774136267, 0.2223810344533745], [0.9602898564975363, 0.1012285362903763]]
    }[n];
    return { x: tab.map(t => (t[0] + 1) / 2), w: tab.map(t => t[1] / 2) };
  }
  const G8 = gauss(8), G3 = gauss(3);

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => Math.sqrt(dot(a, a));

  /* wires: [{p1:[x,y,z], p2:[x,y,z], radius, segs}] (segs optional: uses maxSeg)
   * feed: {wire, at: 0..1}  -- position along the wire; snapped to nearest node
   * opts: {freqMHz, ground: {er, sigma} | null, maxSegFrac, loadOhms} */
  function buildMesh(wires, freqMHz, maxSegFrac) {
    const lam = C0 / (freqMHz * 1e6);
    const maxSeg = lam * (maxSegFrac || 1 / 40);
    const segs = [];
    const wireSegs = [];
    wires.forEach((w, wi) => {
      const L = norm(sub(w.p2, w.p1));
      let n = w.segs || Math.max(1, Math.ceil(L / maxSeg));
      const list = [];
      for (let i = 0; i < n; i++) {
        const a = w.p1.map((v, k) => v + (w.p2[k] - v) * i / n);
        const b = w.p1.map((v, k) => v + (w.p2[k] - v) * (i + 1) / n);
        const d = sub(b, a), l = norm(d);
        list.push(segs.length);
        segs.push({ a, b, L: l, t: d.map(v => v / l), r: w.radius || 0.001, wire: wi });
      }
      wireSegs.push(list);
    });
    return { segs, wireSegs, lam };
  }

  function assemble(mesh, groundOn) {
    const { segs } = mesh;
    // merge endpoints into nodes
    const nodes = [];
    const tol = 1e-4;
    function nodeOf(p) {
      for (let i = 0; i < nodes.length; i++) {
        const q = nodes[i].p;
        if (Math.abs(q[0] - p[0]) < tol && Math.abs(q[1] - p[1]) < tol && Math.abs(q[2] - p[2]) < tol) return i;
      }
      nodes.push({ p, att: [] });
      return nodes.length - 1;
    }
    segs.forEach((s, i) => {
      s.nA = nodeOf(s.a); nodes[s.nA].att.push({ seg: i, end: 0 });
      s.nB = nodeOf(s.b); nodes[s.nB].att.push({ seg: i, end: 1 });
    });
    const inHalf = at => ({ seg: at.seg, end: at.end, sg: at.end === 1 ? 1 : -1 });
    const outHalf = at => ({ seg: at.seg, end: at.end, sg: at.end === 0 ? 1 : -1 });
    const basis = [];
    nodes.forEach((nd, ni) => {
      const onGround = groundOn && Math.abs(nd.p[2]) < 1e-6;
      if (onGround) {
        nd.att.forEach(at => basis.push({ node: ni, halves: [outHalf(at)] }));
      } else if (nd.att.length >= 2) {
        for (let i = 1; i < nd.att.length; i++)
          basis.push({ node: ni, halves: [inHalf(nd.att[i]), outHalf(nd.att[0])] });
      }
    });
    return { nodes, basis };
  }

  /* Integrals of the reduced kernel between test segment p and source segment q.
   * Returns K[ep][eq] = ∫∫ u_ep u_eq G, and S = ∫∫ G (complex as [re, im]). */
  function pairIntegrals(p, q, k, mirror) {
    // source geometry (optionally mirrored in z=0)
    const qa = mirror ? [q.a[0], q.a[1], -q.a[2]] : q.a;
    const qt = mirror ? [q.t[0], q.t[1], -q.t[2]] : q.t;
    const L = q.L, a2 = q.r * q.r;
    const K = [[[0, 0], [0, 0]], [[0, 0], [0, 0]]];
    const S = [0, 0];
    const inv4pi = 1 / (4 * Math.PI);
    for (let i = 0; i < 8; i++) {
      const xi = G8.x[i], wo = G8.w[i] * p.L;
      const r = [p.a[0] + p.t[0] * p.L * xi, p.a[1] + p.t[1] * p.L * xi, p.a[2] + p.t[2] * p.L * xi];
      const d = sub(r, qa);
      const s0 = dot(d, qt);
      let rho2 = dot(d, d) - s0 * s0; if (rho2 < 0) rho2 = 0;
      const re2 = rho2 + a2, re = Math.sqrt(re2);
      // analytic static part
      const I0 = Math.asinh((L - s0) / re) - Math.asinh(-s0 / re);
      const RL = Math.sqrt((L - s0) * (L - s0) + re2), R0 = Math.sqrt(s0 * s0 + re2);
      const I1 = (RL - R0 + s0 * I0) / L;   // ∫ (s/L)/R ds
      let J1r = I1, J1i = 0, J0r = I0 - I1, J0i = 0; // ∫u1/R, ∫u0/R
      // smooth dynamic part (e^{-jkR}-1)/R
      for (let j = 0; j < 8; j++) {
        const s = G8.x[j] * L, wi = G8.w[j] * L;
        const R = Math.sqrt((s - s0) * (s - s0) + re2);
        const kr = k * R;
        const gr = (Math.cos(kr) - 1) / R, gi = -Math.sin(kr) / R;
        const u1 = G8.x[j], u0 = 1 - u1;
        J1r += wi * u1 * gr; J1i += wi * u1 * gi;
        J0r += wi * u0 * gr; J0i += wi * u0 * gi;
      }
      J0r *= inv4pi; J0i *= inv4pi; J1r *= inv4pi; J1i *= inv4pi;
      const up = [1 - xi, xi];
      for (let ep = 0; ep < 2; ep++) {
        K[ep][0][0] += wo * up[ep] * J0r; K[ep][0][1] += wo * up[ep] * J0i;
        K[ep][1][0] += wo * up[ep] * J1r; K[ep][1][1] += wo * up[ep] * J1i;
      }
      S[0] += wo * (J0r + J1r); S[1] += wo * (J0i + J1i);
    }
    return { K, S, qt };
  }

  // complex dense solve (Gaussian elimination, partial pivoting); A is n*n re/im arrays
  function csolve(n, Ar, Ai, br, bi) {
    for (let c = 0; c < n; c++) {
      let piv = c, best = -1;
      for (let r = c; r < n; r++) {
        const m = Ar[r * n + c] ** 2 + Ai[r * n + c] ** 2;
        if (m > best) { best = m; piv = r; }
      }
      if (piv !== c) {
        for (let j = 0; j < n; j++) {
          let t = Ar[c * n + j]; Ar[c * n + j] = Ar[piv * n + j]; Ar[piv * n + j] = t;
          t = Ai[c * n + j]; Ai[c * n + j] = Ai[piv * n + j]; Ai[piv * n + j] = t;
        }
        let t = br[c]; br[c] = br[piv]; br[piv] = t;
        t = bi[c]; bi[c] = bi[piv]; bi[piv] = t;
      }
      const pr = Ar[c * n + c], pi = Ai[c * n + c], pd = pr * pr + pi * pi;
      for (let r = c + 1; r < n; r++) {
        const xr = Ar[r * n + c], xi = Ai[r * n + c];
        if (xr === 0 && xi === 0) continue;
        const fr = (xr * pr + xi * pi) / pd, fi = (xi * pr - xr * pi) / pd;
        for (let j = c; j < n; j++) {
          const ar = Ar[c * n + j], ai = Ai[c * n + j];
          Ar[r * n + j] -= fr * ar - fi * ai;
          Ai[r * n + j] -= fr * ai + fi * ar;
        }
        br[r] -= fr * br[c] - fi * bi[c];
        bi[r] -= fr * bi[c] + fi * br[c];
      }
    }
    const xr = new Float64Array(n), xi = new Float64Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let sr = br[r], si = bi[r];
      for (let j = r + 1; j < n; j++) {
        sr -= Ar[r * n + j] * xr[j] - Ai[r * n + j] * xi[j];
        si -= Ar[r * n + j] * xi[j] + Ai[r * n + j] * xr[j];
      }
      const pr = Ar[r * n + r], pi = Ai[r * n + r], pd = pr * pr + pi * pi;
      xr[r] = (sr * pr + si * pi) / pd; xi[r] = (si * pr - sr * pi) / pd;
    }
    return { xr, xi };
  }

  /* Solve an antenna model.
   * model: {wires, feed:{wire, at}, freqMHz, ground:{er,sigma}|null, loadOhms} */
  function solve(model) {
    const k = 2 * Math.PI * model.freqMHz * 1e6 / C0;
    const groundOn = !!model.ground;
    const mesh = buildMesh(model.wires, model.freqMHz, model.maxSegFrac);
    const { segs } = mesh;
    const { nodes, basis } = assemble(mesh, groundOn);
    const n = basis.length;
    const Ns = segs.length;

    // feed node: nearest node on feed wire to fractional position
    const fw = model.wires[model.feed.wire];
    const fp = fw.p1.map((v, i) => v + (fw.p2[i] - v) * model.feed.at);
    const fsegs = mesh.wireSegs[model.feed.wire];
    let feedNode = -1, best = Infinity;
    fsegs.forEach(si => {
      [segs[si].nA, segs[si].nB].forEach(ni => {
        const d = norm(sub(nodes[ni].p, fp));
        if (d < best) { best = d; feedNode = ni; }
      });
    });
    // gap segment: a feed-wire segment touching the node
    let gapSeg = fsegs.find(si => segs[si].nA === feedNode) ?? fsegs.find(si => segs[si].nB === feedNode);
    const gapEnd = segs[gapSeg].nA === feedNode ? 0 : 1;

    // pair integral cache
    const cache = new Map();
    function pair(pi, qi, mir) {
      const key = (pi * Ns + qi) * 2 + (mir ? 1 : 0);
      let v = cache.get(key);
      if (!v) { v = pairIntegrals(segs[pi], segs[qi], k, mir); cache.set(key, v); }
      return v;
    }

    const Ar = new Float64Array(n * n), Ai = new Float64Array(n * n);
    const cA = k * ETA;       // jωμ  -> j*k*η
    const cP = ETA / k;       // 1/(jωε) -> -j*η/k
    for (let m = 0; m < n; m++) {
      for (const hm of basis[m].halves) {
        const p = segs[hm.seg];
        const dp = hm.sg * (hm.end === 1 ? 1 : -1) / p.L;
        for (let nn = 0; nn < n; nn++) {
          let zr = 0, zi = 0;
          for (const hn of basis[nn].halves) {
            const q = segs[hn.seg];
            const dq = hn.sg * (hn.end === 1 ? 1 : -1) / q.L;
            for (let mir = 0; mir < (groundOn ? 2 : 1); mir++) {
              const P = pair(hm.seg, hn.seg, mir === 1);
              const f = mir ? -1 : 1;
              const tt = dot(p.t, P.qt) * hm.sg * hn.sg;
              const Kc = P.K[hm.end][hn.end];
              // j*cA*tt*K  ->  re: -cA*tt*Ki, im: cA*tt*Kr
              zr += f * (-cA * tt * Kc[1]);
              zi += f * (cA * tt * Kc[0]);
              // -j*cP*dp*dq*S -> re: cP*dp*dq*Si, im: -cP*dp*dq*Sr
              const dd = dp * dq;
              zr += f * (cP * dd * P.S[1]);
              zi += f * (-cP * dd * P.S[0]);
            }
          }
          Ar[m * n + nn] += zr; Ai[m * n + nn] += zi;
        }
      }
    }

    // conductor loss (copper skin effect): Z_mn += R' ∫ f_m·f_n ds on shared segments
    if (model.copperLoss !== false) {
      const w = 2 * Math.PI * model.freqMHz * 1e6;
      const Rs = Math.sqrt(w * 4e-7 * Math.PI / (2 * 5.8e7));
      for (let m = 0; m < n; m++) for (const hm of basis[m].halves) {
        for (let nn = 0; nn < n; nn++) for (const hn of basis[nn].halves) {
          if (hn.seg !== hm.seg) continue;
          const sg = segs[hm.seg], Rp = Rs / (2 * Math.PI * sg.r);
          Ar[m * n + nn] += hm.sg * hn.sg * Rp * sg.L * (hm.end === hn.end ? 1 / 3 : 1 / 6);
        }
      }
    }

    // excitation: 1 V delta gap at feed node on gap segment, oriented along its t
    const br = new Float64Array(n), bi = new Float64Array(n);
    const feedTerms = [];
    basis.forEach((b, m) => {
      b.halves.forEach(h => {
        if (h.seg === gapSeg && h.end === gapEnd) { br[m] += h.sg; feedTerms.push([m, h.sg]); }
      });
    });
    const Arc = Ar.slice(), Aic = Ai.slice();
    const { xr, xi } = csolve(n, Arc, Aic, br.slice(), bi.slice());
    let Ir = 0, Ii = 0;
    feedTerms.forEach(([m, sg]) => { Ir += sg * xr[m]; Ii += sg * xi[m]; });
    const d = Ir * Ir + Ii * Ii;
    let Zr = Ir / d, Zi = -Ii / d;
    const load = model.loadOhms || 0;

    // segment end currents (linear along each segment)
    const segI = segs.map(() => ({ ar: 0, ai: 0, br: 0, bi: 0 }));
    basis.forEach((b, m) => b.halves.forEach(h => {
      const s = segI[h.seg];
      if (h.end === 0) { s.ar += h.sg * xr[m]; s.ai += h.sg * xi[m]; }
      else { s.br += h.sg * xr[m]; s.bi += h.sg * xi[m]; }
    }));
    // with a series loss resistor, the feed current for 1 V is scaled
    const Ztot = [Zr + load, Zi];
    const sc = (() => { // I_actual/I_solved = Z/(Z+Rl)
      const nr = Zr * Ztot[0] + Zi * Ztot[1], ni = Zi * Ztot[0] - Zr * Ztot[1], dd = Ztot[0] ** 2 + Ztot[1] ** 2;
      return [nr / dd, ni / dd];
    })();
    segI.forEach(s => {
      const t = [s.ar, s.ai, s.br, s.bi];
      s.ar = t[0] * sc[0] - t[1] * sc[1]; s.ai = t[0] * sc[1] + t[1] * sc[0];
      s.br = t[2] * sc[0] - t[3] * sc[1]; s.bi = t[2] * sc[1] + t[3] * sc[0];
    });
    const Ifr = Ir * sc[0] - Ii * sc[1], Ifi = Ir * sc[1] + Ii * sc[0];
    const Pin = 0.5 * (Ztot[0]) * (Ifr * Ifr + Ifi * Ifi);

    return {
      z: { r: Ztot[0], x: Ztot[1] }, zAntenna: { r: Zr, x: Zi }, loadOhms: load,
      segs, segI, k, Pin, ground: model.ground, freqMHz: model.freqMHz,
      lambda: mesh.lam, unknowns: n
    };
  }

  function csqrt(r, i) {
    const m = Math.sqrt(r * r + i * i);
    const a = Math.sqrt((m + r) / 2);
    let b = Math.sqrt(Math.max(0, (m - r) / 2));
    if (i < 0) b = -b;
    return [a, b];
  }
  const cdiv = (ar, ai, br, bi) => { const d = br * br + bi * bi; return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d]; };

  function fresnel(ground, lambda, el) {
    const er = ground.er, ei = -60 * ground.sigma * lambda;
    const s = Math.sin(el), c2 = Math.cos(el) ** 2;
    const [qr, qi] = csqrt(er - c2, ei);
    const gh = cdiv(s - qr, -qi, s + qr, qi);
    const es_r = er * s, es_i = ei * s;
    const gv = cdiv(es_r - qr, es_i - qi, es_r + qr, es_i + qi);
    return { gh, gv };
  }

  /* gain (dBi) in direction az (deg from north, clockwise), el (deg above horizon) */
  function gainAt(sol, azDeg, elDeg) {
    const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
    if (sol.ground && el < 0) return { total: -99, v: -99, h: -99 };
    const ce = Math.cos(el), se = Math.sin(el), sa = Math.sin(az), ca = Math.cos(az);
    const rh = [ce * sa, ce * ca, se];
    const hh = [ca, -sa, 0];
    const vh = [-se * sa, -se * ca, ce];
    const k = sol.k;
    function field(mir) {
      let Ar = [0, 0, 0], Ai = [0, 0, 0];
      sol.segs.forEach((s, i) => {
        const I = sol.segI[i];
        const a = mir ? [s.a[0], s.a[1], -s.a[2]] : s.a;
        const t = mir ? [s.t[0], s.t[1], -s.t[2]] : s.t;
        let sr = 0, si = 0;
        for (let g = 0; g < 3; g++) {
          const x = G3.x[g], w = G3.w[g] * s.L;
          const ph = k * (rh[0] * (a[0] + t[0] * s.L * x) + rh[1] * (a[1] + t[1] * s.L * x) + rh[2] * (a[2] + t[2] * s.L * x));
          const ir = I.ar * (1 - x) + I.br * x, ii = I.ai * (1 - x) + I.bi * x;
          const c = Math.cos(ph), sn = Math.sin(ph);
          sr += w * (ir * c - ii * sn); si += w * (ir * sn + ii * c);
        }
        for (let d = 0; d < 3; d++) { Ar[d] += sr * t[d]; Ai[d] += si * t[d]; }
      });
      return { vr: dot(Ar, vh), vi: dot(Ai, vh), hr: dot(Ar, hh), hi: dot(Ai, hh) };
    }
    const D = field(false);
    let Ev = [D.vr, D.vi], Eh = [D.hr, D.hi];
    if (sol.ground) {
      const M = field(true);
      const { gh, gv } = fresnel(sol.ground, sol.lambda, el);
      // vertical: factor -Γv ; horizontal: factor Γh
      Ev[0] += -(gv[0] * M.vr - gv[1] * M.vi); Ev[1] += -(gv[0] * M.vi + gv[1] * M.vr);
      Eh[0] += gh[0] * M.hr - gh[1] * M.hi; Eh[1] += gh[0] * M.hi + gh[1] * M.hr;
    }
    const f = k * k * ETA / (8 * Math.PI * sol.Pin);
    const gv_ = f * (Ev[0] ** 2 + Ev[1] ** 2), gh_ = f * (Eh[0] ** 2 + Eh[1] ** 2);
    const db = x => x > 1e-10 ? 10 * Math.log10(x) : -99;
    return { total: db(gv_ + gh_), v: db(gv_), h: db(gh_) };
  }

  /* Sample the full pattern on a grid. */
  function pattern(sol, azStep = 5, elStep = 2) {
    const elMin = sol.ground ? 0 : -90;
    const az = [], el = [];
    for (let a = 0; a < 360; a += azStep) az.push(a);
    for (let e = elMin; e <= 90; e += elStep) el.push(e);
    const g = new Float32Array(az.length * el.length);
    let max = -99, maxAz = 0, maxEl = 0;
    el.forEach((e, j) => az.forEach((a, i) => {
      const v = (e === 0 && sol.ground) ? gainAt(sol, a, 0.3).total : gainAt(sol, a, e).total;
      g[j * az.length + i] = v;
      if (v > max) { max = v; maxAz = a; maxEl = e; }
    }));
    return { az, el, g, azStep, elStep, elMin, max, maxAz, maxEl };
  }

  function lookup(pat, azDeg, elDeg) {
    let a = ((azDeg % 360) + 360) % 360;
    const fi = a / pat.azStep, i0 = Math.floor(fi) % pat.az.length, i1 = (i0 + 1) % pat.az.length, tx = fi - Math.floor(fi);
    const fj = Math.min(Math.max((elDeg - pat.elMin) / pat.elStep, 0), pat.el.length - 1);
    const j0 = Math.floor(fj), j1 = Math.min(j0 + 1, pat.el.length - 1), ty = fj - j0;
    const N = pat.az.length;
    const v = (j, i) => pat.g[j * N + i];
    return (v(j0, i0) * (1 - tx) + v(j0, i1) * tx) * (1 - ty) + (v(j1, i0) * (1 - tx) + v(j1, i1) * tx) * ty;
  }

  HS.nec = { solve, gainAt, pattern, lookup, fresnel, C0 };
})(typeof window !== 'undefined' ? window : globalThis);
