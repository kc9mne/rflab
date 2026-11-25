require('../js/nec.js');
const N = HS.nec;
const f = 14.2, lam = 299.792458 / f;
function dip(L, h, ground, r = 0.001) {
  return N.solve({ wires: [{ p1: [-L / 2, 0, h], p2: [L / 2, 0, h], radius: r }], feed: { wire: 0, at: 0.5 }, freqMHz: f, ground });
}
let t0 = Date.now();
for (const fr of [0.47, 0.48, 0.5]) {
  const s = dip(fr * lam, 0, null);
  console.log('free dipole', fr, 'Z=', s.z.r.toFixed(1), s.z.x.toFixed(1), 'G broadside', N.gainAt(s, 0, 0).total.toFixed(2), 'unk', s.unknowns);
}
console.log('ms', Date.now() - t0);
// monopole over PEC
const PEC = { er: 1, sigma: 1e7 };
const m = N.solve({ wires: [{ p1: [0, 0, 0], p2: [0, 0, 0.25 * lam], radius: 0.001 }], feed: { wire: 0, at: 0 }, freqMHz: f, ground: PEC });
console.log('monopole PEC Z', m.z.r.toFixed(1), m.z.x.toFixed(1), 'G@1deg', N.gainAt(m, 0, 1).total.toFixed(2));
const AVG = { er: 13, sigma: 0.005 };
for (const hf of [0.25, 0.5]) {
  const s = dip(0.48 * lam, hf * lam, AVG);
  const p = N.pattern(s, 10, 2);
  const sp = dip(0.48 * lam, hf * lam, PEC); const pp = N.pattern(sp, 10, 2);
  console.log('dipole h=', hf, 'avg: Z', s.z.r.toFixed(1), s.z.x.toFixed(1), 'max', p.max.toFixed(2), '@el', p.maxEl, ' PEC max', pp.max.toFixed(2), '@', pp.maxEl);
}
const mv = N.solve({ wires: [{ p1: [0, 0, 0], p2: [0, 0, 0.245 * lam], radius: 0.01 }], feed: { wire: 0, at: 0 }, freqMHz: f, ground: AVG, loadOhms: 10 });
const pv = N.pattern(mv, 30, 2);
console.log('vertical avg+10ohm loss: Z', mv.z.r.toFixed(1), mv.z.x.toFixed(1), 'max', pv.max.toFixed(2), '@', pv.maxEl);
