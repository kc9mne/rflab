/* RFLab terrain: real ground elevation from Terrarium tiles (AWS Open Data, Mapzen/Tilezen terrain,
 * built from SRTM, NED, GMTED and others). Elevation (m) = R*256 + G + B/256 - 32768.
 * Tiles load in the browser and are cached; profiles and lookups only use tiles already loaded. */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};
  const Z = 9;                       // ~235 m per pixel at 40° latitude
  const SOURCES = [
    'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    'terrain/{z}/{x}/{y}.png'        // local copy, if one is published next to the page
  ];
  const tiles = new Map();           // key -> Float32Array | null (failed) | Promise
  let failures = 0, successes = 0;

  const n = 1 << Z;
  function tileXY(lat, lon) {
    const x = (lon + 180) / 360 * n;
    const r = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    return { x, y };
  }
  const key = (x, y) => Z + '/' + x + '/' + y;

  async function decode(blob) {
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, 256, 256).data;
    const out = new Float32Array(256 * 256);
    for (let i = 0; i < out.length; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return out;
  }
  async function fetchTile(x, y) {
    for (const src of SOURCES) {
      try {
        const r = await fetch(src.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
        if (!r.ok) continue;
        return await decode(await r.blob());
      } catch (e) { /* try the next source */ }
    }
    return null;
  }
  function load(x, y) {
    const k = key(x, y);
    if (tiles.has(k)) { const v = tiles.get(k); return v instanceof Promise ? v : Promise.resolve(v); }
    const p = fetchTile(x, y).then(t => { tiles.set(k, t); t ? successes++ : failures++; return t; });
    tiles.set(k, p);
    return p;
  }

  // tiles needed to cover a set of lat/lon points (with one pixel of margin)
  function tilesFor(points) {
    const set = new Map();
    points.forEach(p => {
      const t = tileXY(p.lat, p.lon);
      [[-0.01, -0.01], [0.01, 0.01], [-0.01, 0.01], [0.01, -0.01]].forEach(([dx, dy]) => {
        const x = Math.floor(t.x + dx), y = Math.floor(t.y + dy);
        if (y >= 0 && y < n) set.set(key((x + n) % n, y), [(x + n) % n, y]);
      });
    });
    return [...set.values()];
  }
  function ready(points) {
    return tilesFor(points).every(([x, y]) => { const v = tiles.get(key(x, y)); return v && !(v instanceof Promise); });
  }
  function ensure(points) { return Promise.all(tilesFor(points).map(([x, y]) => load(x, y))); }

  // elevation in metres, or undefined if its tile is not loaded (null if the tile failed)
  function elev(lat, lon) {
    const t = tileXY(lat, lon);
    const tx = Math.floor(t.x), ty = Math.floor(t.y);
    const px = (t.x - tx) * 256 - 0.5, py = (t.y - ty) * 256 - 0.5;
    const at = (ix, iy) => {
      let X = tx, Y = ty;
      if (ix < 0) { X--; ix += 256; } else if (ix > 255) { X++; ix -= 256; }
      if (iy < 0) { Y--; iy += 256; } else if (iy > 255) { Y++; iy -= 256; }
      const tile = tiles.get(key((X + n) % n, Y));
      if (!tile || tile instanceof Promise) return tile === null ? null : undefined;
      return tile[iy * 256 + ix];
    };
    const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    if ([a, b, c, d].some(v => v === undefined)) return undefined;
    if ([a, b, c, d].some(v => v === null)) return null;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  // points along the great circle a->b; spacing about one pixel
  function pathPoints(a, b, km) {
    const steps = Math.max(24, Math.min(700, Math.ceil(km / 0.2)));
    const pts = [];
    for (let i = 0; i <= steps; i++) pts.push(HS.prop.gcPoint(a, b, i / steps));
    return pts;
  }
  /* ground profile a->b: {d: km[], h: m[]} or null if any tile is missing */
  function profile(a, b) {
    const km = HS.prop.distBearing(a, b).km;
    const pts = pathPoints(a, b, km);
    const d = [], h = [];
    for (let i = 0; i < pts.length; i++) {
      const e = elev(pts[i].lat, pts[i].lon);
      if (e == null) return null;
      d.push(km * i / (pts.length - 1)); h.push(Math.max(e, -50));
    }
    return { d, h, km };
  }
  // destination point from a start, bearing (deg) and distance (km)
  function dest(a, brg, km) {
    const d = km / 6371, b = brg * Math.PI / 180, la = a.lat * Math.PI / 180, lo = a.lon * Math.PI / 180;
    const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lon = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
    return { lat: lat / Math.PI * 180, lon: ((lon / Math.PI * 180 + 540) % 360) - 180 };
  }

  HS.terrain = {
    Z, tileXY, tilesFor, ready, ensure, elev, profile, pathPoints, dest,
    status: () => ({ failures, successes, loading: [...tiles.values()].some(v => v instanceof Promise) }),
    _tiles: tiles
  };
})(typeof window !== 'undefined' ? window : globalThis);
