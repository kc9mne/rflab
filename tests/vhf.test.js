require('../js/nec.js'); require('../js/data.js'); require('../js/antennas.js');
const A = HS.antennas, N = HS.nec;
const base = { height: 25, endHeight: 25, dir: 0, cutFor: 'auto', gpRadials: 4, elements: 5, sections: 2, pol: 'h' };
const cases = [['dipole', { pol: 'h' }], ['gp', {}], ['jpole', {}], ['collinear', { sections: 2 }], ['collinear', { sections: 3 }], ['mobile', {}], ['duck', { height: 5 }],
  ['yagi', { elements: 3 }], ['yagi', { elements: 5 }], ['yagi', { elements: 5, pol: 'v' }], ['jpole', { cutFor: '2m' }]];
for (const band of ['2m', '70cm']) for (const [t, o] of cases) {
  const t0 = Date.now();
  const r = A.analyze({ type: t, ...base, ...o }, band, 'average');
  const p = r.pat;
  console.log(band, t.padEnd(9), JSON.stringify(o).padEnd(22), 'Z', r.sol.z.r.toFixed(0).padStart(5), r.sol.z.x.toFixed(0).padStart(6),
    'max', p.max.toFixed(1), '@el', p.maxEl, 'az', p.maxAz, ' G@horizon az0', N.lookup(p, 0, 0).toFixed(1), ' vfrac', N.vertFrac(p, 0, 0).toFixed(2),
    ' F/B', (N.lookup(p, 0, 0) - N.lookup(p, 180, 0)).toFixed(1), ' eff', r.avgGainDb.toFixed(1), ' unk', r.sol.unknowns, (Date.now() - t0) + 'ms');
}
