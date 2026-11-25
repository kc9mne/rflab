/* SkyHop coverage globe: day/night earth, Maidenhead field lines, stations and
 * the sky-wave hops between them (ionosphere height exaggerated 3x). */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};
  const T = root.THREE;
  const D2R = Math.PI / 180;
  const EXAG = 3;
  const xyz = (lat, lon, r = 1) => new T.Vector3(
    r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * Math.cos(lat * D2R) * Math.sin(lon * D2R));

  function init(el) {
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x070d13);
    el.appendChild(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(40, 1, 0.01, 50);
    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.minDistance = 1.25; controls.maxDistance = 6; controls.enablePan = false; controls.rotateSpeed = 0.5;
    controls.addEventListener('change', render);

    const earth = new T.Mesh(new T.SphereGeometry(1, 96, 64), new T.MeshLambertMaterial({ color: 0x1b3550 }));
    scene.add(earth);
    scene.add(new T.AmbientLight(0x8aa4c8, 0.32));
    const sun = new T.DirectionalLight(0xfff4e0, 1.0); scene.add(sun);

    // coastlines
    const landMat = new T.LineBasicMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0.75 });
    (HS.LAND || []).forEach(line => {
      const pts = line.map(([lon, lat]) => xyz(lat, lon, 1.001));
      scene.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), landMat));
    });
    // Maidenhead fields: 20° of longitude by 10° of latitude
    const gridMat = new T.LineBasicMaterial({ color: 0x5d7a94, transparent: true, opacity: 0.18 });
    for (let lon = -180; lon < 180; lon += 20) {
      const pts = []; for (let lat = -90; lat <= 90; lat += 3) pts.push(xyz(lat, lon, 1.0015));
      scene.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), gridMat));
    }
    for (let lat = -80; lat < 90; lat += 10) {
      const pts = []; for (let lon = -180; lon <= 180; lon += 3) pts.push(xyz(lat, lon, 1.0015));
      scene.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), gridMat));
    }

    const dyn = new T.Group(); scene.add(dyn);
    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    el.appendChild(labelLayer);
    let labels = [], homeKey = '';

    function clear() {
      while (dyn.children.length) { const o = dyn.children.pop(); o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }
      labels.forEach(l => l.el.remove()); labels = [];
    }
    function label(pos, html, color) {
      const d = document.createElement('div'); d.className = 'label3d'; d.innerHTML = html; d.style.color = color;
      labelLayer.appendChild(d); labels.push({ el: d, pos });
    }

    function update(d) {
      clear();
      // sun position from hour and month
      const doy = (d.cond.month - 0.5) * 30.4;
      const dec = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365);
      sun.position.copy(xyz(dec, 180 - d.cond.hour * 15, 10));

      const mark = (loc, color, big) => {
        const m = new T.Mesh(new T.SphereGeometry(big ? 0.014 : 0.011, 16, 12), new T.MeshBasicMaterial({ color }));
        m.position.copy(xyz(loc.lat, loc.lon, 1.003)); dyn.add(m);
      };
      mark(d.home.loc, d.home.color, true);
      label(xyz(d.home.loc.lat, d.home.loc.lon, 1.01), `<b>${d.home.name}</b> ${d.home.grid}`, d.home.color);

      d.links.forEach(L => {
        mark(L.st.loc, L.color);
        label(xyz(L.st.loc.lat, L.st.loc.lon, 1.01), `<b>${L.st.name}</b> ${L.text}`, L.color);
        if (!L.link.ok) return;
        const n = L.link.hops, h = L.link.h / 6371 * EXAG;
        const pts = [];
        const N = 40 * n;
        for (let k = 0; k <= N; k++) {
          const t = k / N, hop = Math.min(n - 1, Math.floor(t * n)), lt = t * n - hop;
          const p = HS.prop.gcPoint(d.home.loc, L.st.loc, t);
          // rays: straight up to the layer and back down (triangle), slightly rounded
          const alt = h * Math.pow(Math.sin(Math.PI * lt), 0.6);
          pts.push(xyz(p.lat, p.lon, 1.002 + alt));
        }
        const curve = new T.CatmullRomCurve3(pts);
        const rel = L.rel;
        const tube = new T.Mesh(new T.TubeGeometry(curve, pts.length * 2, L.selected ? 0.0045 : 0.003, 6, false),
          new T.MeshBasicMaterial({ color: new T.Color(L.color), transparent: true, opacity: 0.25 + 0.75 * rel }));
        dyn.add(tube);
        // reflection points
        for (let i = 0; i < n; i++) {
          const p = HS.prop.gcPoint(d.home.loc, L.st.loc, (i + 0.5) / n);
          const m = new T.Mesh(new T.SphereGeometry(0.006, 10, 8), new T.MeshBasicMaterial({ color: new T.Color(L.color), transparent: true, opacity: 0.4 + 0.6 * rel }));
          m.position.copy(xyz(p.lat, p.lon, 1.002 + h)); dyn.add(m);
        }
      });

      const key = d.home.grid + '|' + d.links.length;
      if (key !== homeKey) {
        // frame home plus all stations
        let far = 0;
        d.links.forEach(L => { far = Math.max(far, HS.prop.distBearing(d.home.loc, L.st.loc).km); });
        const mid = d.links.length ? HS.prop.gcPoint(d.home.loc, d.links.reduce((a, L) => HS.prop.distBearing(d.home.loc, L.st.loc).km > HS.prop.distBearing(d.home.loc, a.st.loc).km ? L : a).st.loc, 0.35) : d.home.loc;
        const dist = Math.min(4.2, 1.6 + far / 4000);
        camera.position.copy(xyz(mid.lat - 8, mid.lon, dist));
        controls.update(); homeKey = key;
      }
      render();
    }

    function render() {
      renderer.render(scene, camera);
      const w = el.clientWidth, h = el.clientHeight;
      const camDir = camera.position.clone().normalize();
      labels.forEach(l => {
        const facing = l.pos.clone().normalize().dot(camDir) > 0.15;
        const p = l.pos.clone().project(camera);
        l.el.style.display = facing && p.z < 1 ? '' : 'none';
        l.el.style.left = ((p.x + 1) / 2 * w) + 'px';
        l.el.style.top = ((1 - p.y) / 2 * h) + 'px';
      });
      HS.declutter(labels);
    }
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
    }
    root.addEventListener('resize', resize);
    return { update, resize, render };
  }
  HS.globe = { init };
})(typeof window !== 'undefined' ? window : globalThis);
