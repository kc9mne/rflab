require('../js/nec.js'); require('../js/data.js'); require('../js/antennas.js');
const A = HS.antennas, N = HS.nec;
const base = { height: 35, endHeight: 35, dir: 90, cutFor: 'auto', radials: 16, gpRadials: 4, elements: 3 };
const cases = [
  ['dipole', {}], ['dipole', { endHeight: 15 }], ['dipole', { height: 20, endHeight: 20 }], ['fan', {}], ['doublet', {}],
  ['efhw', { height: 12, endHeight: 20 }], ['hloop', {}], ['delta', { height: 8 }], ['vertical', {}], ['vertical', { radials: 4 }], ['gp', { height: 25 }],
  ['yagi', { height: 50, dir: 0, elements: 2 }], ['yagi', { height: 50, dir: 0, elements: 3 }], ['yagi', { height: 50, dir: 0, elements: 5 }]
];
for (const band of ['40m', '20m']) for (const [t, o] of cases) {
  if (t === 'yagi' && band === '40m' && o.elements > 2) continue;
  const p = { type: t, ...base, ...o };
  const t0 = Date.now();
  const r = A.analyze(p, band, 'average');
  const pat = r.pat;
  let fb = '';
  if (t === 'yagi') fb = ' F/B ' + (N.lookup(pat, 0, pat.maxEl) - N.lookup(pat, 180, pat.maxEl)).toFixed(1);
  console.log(band, t.padEnd(8), JSON.stringify(o).padEnd(36), 'Z', r.sol.z.r.toFixed(0).padStart(5), r.sol.z.x.toFixed(0).padStart(6),
    ' max', pat.max.toFixed(1), '@el', pat.maxEl, 'az', pat.maxAz, ' G@50el', N.lookup(pat, 0, 50).toFixed(1), ' eff', r.avgGainDb.toFixed(1), fb, ' unk', r.sol.unknowns, (Date.now() - t0) + 'ms');
}
// EFHW cut for 40 used on 20
const e = A.analyze({ type: 'efhw', ...base, height: 12, endHeight: 20, cutFor: '40m' }, '20m', 'average');
console.log('efhw40 on 20m Z', e.sol.z.r.toFixed(0), e.sol.z.x.toFixed(0), 'max', e.pat.max.toFixed(1), '@', e.pat.maxEl, e.pat.maxAz);
const d = A.analyze({ type: 'dipole', ...base, cutFor: '40m' }, '20m', 'average');
console.log('dipole40 on 20m Z', d.sol.z.r.toFixed(0), d.sol.z.x.toFixed(0));
