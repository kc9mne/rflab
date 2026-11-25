require('../js/nec.js'); require('../js/data.js'); require('../js/antennas.js'); require('../js/prop.js');
const P = HS.prop;
// path loss vs distance, 146 MHz, 10 m antennas both ends, flat
console.log('d km   FSPL   base   (a)   dLos  scatter?');
for (const d of [1, 5, 10, 20, 30, 40, 60, 80, 120, 200, 400]) {
  const L = P.losCore(d, 146, 10, 10, { terrain: 'flat' });
  console.log(String(d).padStart(4), L.fspl.toFixed(1).padStart(6), L.lBase.toFixed(1).padStart(6), L.a.toFixed(1).padStart(6), L.dLos.toFixed(1).padStart(6), L.scatter);
}
const mk = (grid, radio, vu, noise = 'residential', elevFt = 650) => ({ grid, loc: P.gridToLatLon(grid), radio, ground: 'average', noise, elevFt, vu });
const me = mk('EN50mm', 'ft991a', { antenna: { type: 'jpole', height: 25, cutFor: 'auto' }, coax: 'rg8x', coaxFt: 50, match: 'ideal', power: 50 });
const ht = mk('EN50om', 'uv5r', { antenna: { type: 'duck', height: 5 }, coax: 'rg58', coaxFt: 0, match: 'none', power: 4 });
const club = mk('EN50am', 'ic9700', { antenna: { type: 'yagi', height: 50, dir: 90, elements: 5, pol: 'h' }, coax: 'lmr400', coaxFt: 100, match: 'hairpin', power: 100 });
const hill = mk('EM69', 'ts2000', { antenna: { type: 'collinear', height: 60, sections: 3 }, coax: 'lmr600', coaxFt: 100, match: 'ideal', power: 100 }, 'rural', 1200);
for (const band of ['2m', '70cm']) {
  const c = { me: P.chain(me, band), ht: P.chain(ht, band), club: P.chain(club, band), hill: P.chain(hill, band) };
  console.log(band, 'me loss', c.me.totalLoss.toFixed(2), 'noise', c.me.noiseDbm.toFixed(1), 'hAnt', c.me.hAnt.toFixed(1), '| ht loss', c.ht.totalLoss.toFixed(1));
  for (const [n, st] of [['ht', ht], ['club', club], ['hill', hill]]) {
    const L = P.link(me, st, null, { terrain: 'flat' }, c.me, c[n]);
    const R = P.link(st, me, null, { terrain: 'flat' }, c[n], c.me);
    console.log(`  ${n.padEnd(5)} ${(L.km * 0.6214).toFixed(1)}mi los=${L.los} base ${L.lBase.toFixed(1)} clutter ${L.clutter.toFixed(1)} pol ${L.polLoss.toFixed(1)} gt ${L.gt.toFixed(1)} gr ${L.gr.toFixed(1)} sig ${L.sig.toFixed(1)} ${L.s} snr ${L.snr.toFixed(1)} FM ${(L.rel.fm * 100).toFixed(0)}% | back ${R.s} snr ${R.snr.toFixed(1)} FM ${(R.rel.fm * 100).toFixed(0)}%`);
  }
}
