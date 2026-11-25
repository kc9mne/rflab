/* SkyHop reference data: bands, ground, feedlines, radios, matching devices.
 * Feedline loss uses the usual two-term fit: dB/100ft = k1*sqrt(f) + k2*f (f in MHz),
 * fitted to manufacturer datasheet curves. Values are typical, not guaranteed. */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};

  const BANDS = {
    '40m':  { id: '40m',  label: '40 m',  f: 7.15,   group: 'hf' },
    '20m':  { id: '20m',  label: '20 m',  f: 14.175, group: 'hf' },
    '2m':   { id: '2m',   label: '2 m',   f: 146,    group: 'vu' },
    '70cm': { id: '70cm', label: '70 cm', f: 440,    group: 'vu' }
    // next: '80m', '33cm' (Meshtastic 915 MHz)
  };

  const GROUNDS = {
    poor:    { label: 'Poor (sand, rock, city)', er: 5,  sigma: 0.001 },
    average: { label: 'Average (farmland)',      er: 13, sigma: 0.005 },
    good:    { label: 'Good (rich, wet soil)',   er: 20, sigma: 0.0303 },
    salt:    { label: 'Salt water',              er: 81, sigma: 5 }
  };

  const COAX = {
    'rg58':     { name: 'RG-58/U',             group: 'RG',     z0: 50,  k1: 0.42,   k2: 0.0070 },
    'rg8x':     { name: 'RG-8X (mini-8)',      group: 'RG',     z0: 50,  k1: 0.31,   k2: 0.0045 },
    'rg8':      { name: 'RG-8/U (foam)',       group: 'RG',     z0: 50,  k1: 0.15,   k2: 0.0020 },
    'rg213':    { name: 'RG-213/U',            group: 'RG',     z0: 50,  k1: 0.18,   k2: 0.0026 },
    'lmr195':   { name: 'LMR-195',             group: 'LMR',    z0: 50,  k1: 0.3603, k2: 0.00032 },
    'lmr240':   { name: 'LMR-240',             group: 'LMR',    z0: 50,  k1: 0.2422, k2: 0.00033 },
    'lmr400':   { name: 'LMR-400',             group: 'LMR',    z0: 50,  k1: 0.1223, k2: 0.00026 },
    'lmr600':   { name: 'LMR-600',             group: 'LMR',    z0: 50,  k1: 0.0775, k2: 0.00026 },
    'lmr900':   { name: 'LMR-900',             group: 'LMR',    z0: 50,  k1: 0.0511, k2: 0.00020 },
    'lmr1200':  { name: 'LMR-1200',            group: 'LMR',    z0: 50,  k1: 0.0382, k2: 0.00016 },
    'fsj1':     { name: 'Heliax FSJ1-50A (1/4" superflex)', group: 'Heliax', z0: 50, k1: 0.19, k2: 0.0007 },
    'fsj4':     { name: 'Heliax FSJ4-50B (1/2" superflex)', group: 'Heliax', z0: 50, k1: 0.10, k2: 0.0004 },
    'ldf4':     { name: 'Heliax LDF4-50A (1/2")',   group: 'Heliax', z0: 50, k1: 0.064, k2: 0.0003 },
    'ldf5':     { name: 'Heliax LDF5-50A (7/8")',   group: 'Heliax', z0: 50, k1: 0.035, k2: 0.00017 },
    'ldf6':     { name: 'Heliax LDF6-50 (1-1/4")',  group: 'Heliax', z0: 50, k1: 0.025, k2: 0.00012 },
    'ldf7':     { name: 'Heliax LDF7-50A (1-5/8")', group: 'Heliax', z0: 50, k1: 0.020, k2: 0.00010 },
    'ladder':   { name: '450 Ω window line',  group: 'Open wire', z0: 450, k1: 0.03, k2: 0.0003, balanced: true }
  };

  // matching device at the antenna feedpoint: impedance ratio (antenna:line) and its own loss
  const MATCH = {
    none:    { name: 'None (direct connection)', ratio: 1,  loss: 0 },
    choke:   { name: '1:1 current balun / choke', ratio: 1, loss: 0.1 },
    '4to1':  { name: '4:1 balun',                ratio: 4,  loss: 0.25 },
    '9to1':  { name: '9:1 unun',                 ratio: 9,  loss: 1.0 },
    '49to1': { name: '49:1 unun (EFHW)',         ratio: 49, loss: 0.8 },
    hairpin: { name: 'Hairpin / beta match',     ideal: true, loss: 0.1 },
    ideal:   { name: 'Built-in match (as designed)', ideal: true, loss: 0.1 }
  };

  // power out (W) per band; atu = max SWR the built-in tuner handles (0 = none); nf = receiver noise figure (dB)
  const RADIOS = {
    ftdx10:  { name: 'Yaesu FTdx10',      power: { '40m': 100, '20m': 100 }, atu: 3, nf: 14 },
    ft991a:  { name: 'Yaesu FT-991A',     power: { '40m': 100, '20m': 100, '2m': 50, '70cm': 50 }, atu: 3, nf: 15 },
    ft891:   { name: 'Yaesu FT-891',      power: { '40m': 100, '20m': 100 }, atu: 0, nf: 15 },
    ic7300:  { name: 'Icom IC-7300',      power: { '40m': 100, '20m': 100 }, atu: 3, nf: 15 },
    ts2000:  { name: 'Kenwood TS-2000',   power: { '40m': 100, '20m': 100, '2m': 100, '70cm': 50 }, atu: 3, nf: 15 },
    flex8400:{ name: 'FlexRadio FLEX-8400', power: { '40m': 100, '20m': 100 }, atu: 3, nf: 12, note: 'ATU is an option on this model' },
    g90:     { name: 'Xiegu G90',         power: { '40m': 20, '20m': 20 }, atu: 5, nf: 17 },
    ic9700:  { name: 'Icom IC-9700',      power: { '2m': 100, '70cm': 75 }, atu: 0, nf: 6 },
    ic2730a: { name: 'Icom IC-2730A',     power: { '2m': 50, '70cm': 50 }, atu: 0, nf: 8 },
    uv5r:    { name: 'Baofeng UV-5R',     power: { '2m': 4, '70cm': 4 }, atu: 0, nf: 10 },
    at878:   { name: 'AnyTone AT-D878UV Plus', power: { '2m': 7, '70cm': 6 }, atu: 0, nf: 9 }
  };

  // ITU-R P.372 man-made noise: Fa = c - d*log10(fMHz)
  const NOISE = {
    city:        { label: 'City',          c: 76.8, d: 27.7 },
    residential: { label: 'Suburban / residential', c: 72.5, d: 27.7 },
    rural:       { label: 'Rural',         c: 67.2, d: 27.7 },
    quiet:       { label: 'Quiet rural',   c: 53.6, d: 28.6 }
  };

  // required SNR in a 2500 Hz reference bandwidth
  const MODES = {
    ft8: { label: 'FT8', snr: -20 },
    cw:  { label: 'CW',  snr: -3 },
    ssb: { label: 'SSB', snr: 10 },
    fm:  { label: 'FM',  snr: 12 }   // ~12 dB SINAD in a 16 kHz channel, referred to 2500 Hz
  };

  // VHF/UHF: how much the ground between stations departs from smooth earth
  const TERRAIN = {
    flat:     { label: 'Flat (prairie, farmland)', loss: 0,  sigma: 6 },
    rolling:  { label: 'Rolling hills',            loss: 6,  sigma: 8 },
    hilly:    { label: 'Hilly',                    loss: 12, sigma: 10 },
    mountain: { label: 'Mountainous',              loss: 20, sigma: 12 }
  };
  // typical height of trees and buildings around the antenna, from the local-noise setting (m)
  const CLUTTER = { quiet: 3, rural: 4, residential: 10, city: 18 };

  const SOLAR = {
    low:  { label: 'Solar minimum (SSN 10)', ssn: 10 },
    mid:  { label: 'Moderate (SSN 70)',      ssn: 70 },
    high: { label: 'Solar maximum (SSN 140)', ssn: 140 }
  };

  function coaxLoss(id, fMHz, ft) {
    const c = COAX[id];
    return (c.k1 * Math.sqrt(fMHz) + c.k2 * fMHz) * ft / 100;
  }

  HS.data = { BANDS, GROUNDS, COAX, MATCH, RADIOS, NOISE, MODES, SOLAR, TERRAIN, CLUTTER, coaxLoss };
})(typeof window !== 'undefined' ? window : globalThis);
