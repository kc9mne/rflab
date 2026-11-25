require('../js/nec.js'); require('../js/data.js'); require('../js/antennas.js'); require('../js/prop.js');
const P = HS.prop;
console.log(P.gridToLatLon('EN50'), P.latLonToGrid(40.5, -89), P.gridToLatLon('EM56'));
const me = { loc: P.gridToLatLon('EN50'), radio: 'ft991a', power: 100, coax: 'rg8x', coaxFt: 60, match: '49to1', ground: 'average', noise: 'residential',
  antenna: { type: 'efhw', height: 12, endHeight: 20, dir: 90, cutFor: 'auto', radials: 16, gpRadials: 4, elements: 3 } };
const them = { loc: P.gridToLatLon('EM55'), radio: 'ftdx10', power: 100, coax: 'lmr400', coaxFt: 25, match: 'none', ground: 'average', noise: 'rural',
  antenna: { type: 'vertical', height: 0, endHeight: 0, dir: 0, cutFor: 'auto', radials: 16, gpRadials: 4, elements: 3 } };
for (const band of ['40m', '20m']) {
  const a = P.chain(me, band), b = P.chain(them, band);
  console.log(band, 'me: Z', a.zAntenna.r.toFixed(0), a.zAntenna.x.toFixed(0), 'swrAnt', a.swrAnt50.toFixed(2), 'swrRadio', a.swrRadio.toFixed(2), 'line', a.lineLoss.toFixed(2), 'tot', a.totalLoss.toFixed(2), a.tuner, 'noise', a.noiseDbm.toFixed(1));
  console.log(band, 'them: swr', b.swrRadio.toFixed(2), 'tot', b.totalLoss.toFixed(2), 'noise', b.noiseDbm.toFixed(1));
  for (const hour of [0, 6, 12, 15, 18, 21]) {
    const L = P.link(me, them, null, { hour, month: 11, ssn: 100 }, a, b);
    const R = P.link(them, me, null, { hour, month: 11, ssn: 100 }, b, a);
    console.log(`  ${hour}Z ${L.km.toFixed(0)}km brg ${L.brg.toFixed(0)} hops ${L.hops} el ${L.el?.toFixed(1)} muf ${L.muf?.toFixed(1)} abs ${L.absorb?.toFixed(1)} loss ${L.loss?.toFixed(1)} gt ${L.gt?.toFixed(1)} gr ${L.gr?.toFixed(1)} sig ${L.sig?.toFixed(1)} ${L.s} snr ${L.snr?.toFixed(1)} REL ft8 ${(L.rel.ft8*100).toFixed(0)} ssb ${(L.rel.ssb*100).toFixed(0)} | back snr ${R.snr?.toFixed(1)}`);
  }
}
const far = { ...them, loc: P.gridToLatLon('JO01') };
const a = P.chain(me, '20m'), b = P.chain(far, '20m');
for (const hour of [12, 15, 18]) { const L = P.link(me, far, null, { hour, month: 11, ssn: 100 }, a, b); console.log('EU 20m', hour, L.hops, L.el.toFixed(1), L.muf.toFixed(1), L.snr.toFixed(1), (L.rel.ft8*100).toFixed(0)); }
