/* SkyHop 3D antenna view: wires, supports, the radiation pattern and the takeoff
 * rays each remote station needs. World coords (x east, y north, z up) map to
 * three.js as (x, z, -y). */
(function (root) {
  'use strict';
  const HS = root.HS = root.HS || {};
  const T = root.THREE;
  const toV = p => new T.Vector3(p[0], p[2], -p[1]);
  const RAMP = ['#1d3d8f', '#1689b5', '#2fbf8f', '#e3c341', '#f07a2a', '#e2342c'].map(c => new T.Color(c));
  function rampColor(t) {
    t = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(t));
    return RAMP[i].clone().lerp(RAMP[i + 1], t - i);
  }
  const DB_RANGE = 30;

  function init(el) {
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0a131c);
    el.appendChild(renderer.domElement);
    const scene = new T.Scene();
    scene.fog = new T.Fog(0x0a131c, 120, 400);
    const camera = new T.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(28, 22, 34);
    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.maxPolarAngle = Math.PI * 0.495;
    let freeMode = false;
    controls.addEventListener('change', render);
    scene.add(new T.HemisphereLight(0xcfe3ff, 0x2a3a2a, 0.9));
    const sun = new T.DirectionalLight(0xffffff, 0.6); sun.position.set(40, 80, 30); scene.add(sun);

    const dyn = new T.Group(); scene.add(dyn);
    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    el.appendChild(labelLayer);
    let labels = [];
    let lastR = 0;

    function clearDyn() {
      while (dyn.children.length) {
        const o = dyn.children.pop();
        o.traverse && o.traverse(c => { c.geometry && c.geometry.dispose(); c.material && c.material.dispose(); });
      }
      labels.forEach(l => l.el.remove()); labels = [];
    }
    function addLabel(pos, html, color, cls) {
      const d = document.createElement('div');
      d.className = 'label3d' + (cls ? ' ' + cls : '');
      d.innerHTML = html; if (color) d.style.color = color;
      labelLayer.appendChild(d);
      labels.push({ el: d, pos });
    }
    function cyl(a, b, r, mat) {
      const A = toV(a), B = toV(b), len = A.distanceTo(B);
      const m = new T.Mesh(new T.CylinderGeometry(r, r, len, 8, 1), mat);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      return m;
    }

    function update(d) {
      clearDyn();
      const wires = d.model.wires;
      let maxE = 0, cx = 0, cy = 0, cz = 0, n = 0, zmax = 0;
      wires.forEach(w => [w.p1, w.p2].forEach(p => {
        cx += p[0]; cy += p[1]; cz += p[2]; n++; zmax = Math.max(zmax, p[2]);
      }));
      cx /= n; cy /= n; cz /= n;
      wires.forEach(w => [w.p1, w.p2].forEach(p => { maxE = Math.max(maxE, Math.hypot(p[0] - cx, p[1] - cy), p[2]); }));
      const free = !!d.freeSpace;
      let minZ = Infinity; wires.forEach(w => { minZ = Math.min(minZ, w.p1[2], w.p2[2]); });
      if (free) { maxE = 0; wires.forEach(w => [w.p1, w.p2].forEach(p => { maxE = Math.max(maxE, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz)); })); }
      const R = free ? Math.max(0.6, maxE * 1.6) : Math.max(10, maxE * 1.15);
      const origin = [cx, cy, free ? cz : Math.max(cz, 0.5)];

      if (free) {
        // VHF/UHF: the antenna in free space, with a horizon plane through it for reference
        const hR = R * 1.5;
        const hz = new T.PolarGridHelper(hR, 12, 4, 64, 0x35536b, 0x22384a);
        hz.position.set(origin[0], origin[2], -origin[1]); dyn.add(hz);
        [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => {
          const r = hR * 1.06, ar = a * Math.PI / 180;
          addLabel(toV([origin[0] + Math.sin(ar) * r, origin[1] + Math.cos(ar) * r, origin[2]]), t, null, 'compass');
        });
        addLabel(toV([origin[0], origin[1] - hR * 0.72, origin[2]]), 'horizon', null, 'compass');
      }
      // ground
      const gR = R * 1.7;
      if (!free) {
      const ground = new T.Mesh(new T.CircleGeometry(gR, 64), new T.MeshLambertMaterial({ color: 0x1a2b22 }));
      ground.rotation.x = -Math.PI / 2; dyn.add(ground);
      const polar = new T.PolarGridHelper(gR, 12, 6, 64, 0x2e4a3c, 0x2e4a3c);
      polar.position.y = 0.01; dyn.add(polar);
      [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => {
        const r = gR * 1.04, ar = a * Math.PI / 180;
        addLabel(toV([Math.sin(ar) * r, Math.cos(ar) * r, 0]), t, null, 'compass');
      });
      }

      // wires
      const wR = free ? R * 0.006 : Math.max(0.04, R * 0.004);
      const copper = new T.MeshStandardMaterial({ color: 0xd98a3d, metalness: 0.6, roughness: 0.35 });
      const tubeR = w => (w.radius > 0.005 ? wR * 1.8 : wR);
      wires.forEach(w => dyn.add(cyl(w.p1, w.p2, tubeR(w), copper)));
      // feed point
      const fw = wires[d.model.feed.wire];
      const fp = fw.p1.map((v, i) => v + (fw.p2[i] - v) * d.model.feed.at);
      const feed = new T.Mesh(new T.SphereGeometry(wR * 4, 16, 12), new T.MeshBasicMaterial({ color: 0xff4d3d }));
      feed.position.copy(toV(fp)); dyn.add(feed);

      // supports: masts, poles, trees
      const poleMat = new T.MeshLambertMaterial({ color: 0x7a6a58 });
      const tops = [];

      if (free) {
        if (d.type === 'mobile') {
          const roof = new T.Mesh(new T.BoxGeometry(R * 0.9, 0.04, R * 1.1), new T.MeshStandardMaterial({ color: 0x55606b, metalness: 0.6, roughness: 0.4 }));
          roof.position.set(0, minZ - 0.03, 0); dyn.add(roof);
        } else if (d.type !== 'duck') {
          const top = d.type === 'yagi' ? (wires[0].p1[2] + wires[0].p2[2]) / 2 : minZ;
          dyn.add(cyl([0, 0, top], [0, 0, Math.max(0, top - R * 1.3)], wR * 2.5, poleMat));
        }
      }
      if (d.type === 'yagi' || (d.type === 'gp' && !free)) {
        const top = d.type === 'yagi' ? (wires[0].p1[2] + wires[0].p2[2]) / 2 : fw.p1[2];
        if (!free) tops.push([0, 0, top]);
        if (d.type === 'yagi') {
          const ends = wires.filter((w, i) => i !== d.model.feed.wire + 1).map(w => [(w.p1[0] + w.p2[0]) / 2, (w.p1[1] + w.p2[1]) / 2, (w.p1[2] + w.p2[2]) / 2]);
          let a = ends[0], b = ends[0], best = -1;
          ends.forEach(p => ends.forEach(q => { const dd = Math.hypot(p[0] - q[0], p[1] - q[1]); if (dd > best) { best = dd; a = p; b = q; } }));
          dyn.add(cyl(a, b, wR * 2.2, new T.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 0.7, roughness: 0.3 })));
        }
      } else if (!free) {
        const pts = [];
        wires.forEach(w => [w.p1, w.p2].forEach(p => { if (p[2] > 1.5 && !pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.05)) pts.push(p); }));
        pts.forEach(p => {
          const steepUp = wires.some(w => {
            const o = (Math.hypot(w.p1[0] - p[0], w.p1[1] - p[1], w.p1[2] - p[2]) < 0.05) ? w.p2 : (Math.hypot(w.p2[0] - p[0], w.p2[1] - p[1], w.p2[2] - p[2]) < 0.05 ? w.p1 : null);
            if (!o) return false;
            const dz = o[2] - p[2], dh = Math.hypot(o[0] - p[0], o[1] - p[1]);
            return dz > 0 && dz > dh;
          });
          if (!steepUp) tops.push(p);
        });
      }
      tops.forEach(p => dyn.add(cyl([p[0], p[1], 0], [p[0], p[1], p[2] + 0.3], wR * 2.5, poleMat)));

      // pattern
      if (d.pat) dyn.add(patternMesh(d.pat, R, origin, d.patOpacity ?? 0.55));
      if (d.patA) {
        const m = patternMesh(d.patA, R, origin, 1, true);
        dyn.add(m);
      }

      // takeoff rays
      (d.rays || []).forEach(r => {
        const a = r.brg * Math.PI / 180, e = r.el * Math.PI / 180;
        const dir = [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
        const L = R * 1.25;
        const tip = origin.map((v, i) => v + dir[i] * L);
        const col = new T.Color(r.color);
        const geo = new T.BufferGeometry().setFromPoints([toV(origin), toV(tip)]);
        const line = new T.Line(geo, new T.LineDashedMaterial({ color: col, dashSize: R * 0.04, gapSize: R * 0.025, transparent: true, opacity: r.selected ? 1 : 0.7 }));
        line.computeLineDistances(); dyn.add(line);
        if (d.pat) {
          const g = HS.nec.lookup(d.pat, r.brg, r.el);
          const rr = R * Math.max(0, (g - (d.pat.max - DB_RANGE)) / DB_RANGE);
          const hit = new T.Mesh(new T.SphereGeometry(wR * (r.selected ? 6 : 4.5), 16, 12), new T.MeshBasicMaterial({ color: col }));
          hit.position.copy(toV(origin.map((v, i) => v + dir[i] * rr))); dyn.add(hit);
        }
        addLabel(toV(tip), `<b>${r.label}</b> ${(Math.round(r.el) || 0)}° · ${r.gain >= 0 ? '+' : ''}${r.gain.toFixed(1)} dBi`, r.color);
      });

      controls.maxPolarAngle = free ? Math.PI : Math.PI * 0.495;
      if (Math.abs(R - lastR) > 0.05 * Math.max(R, lastR) || free !== freeMode) {
        freeMode = free;
        if (free) { camera.position.set(origin[0] + R * 2.2, origin[2] + R * 1.2, -origin[1] + R * 2.6); controls.target.set(origin[0], origin[2], -origin[1]); }
        else { camera.position.set(R * 2.3, R * 1.5, R * 2.7); controls.target.set(origin[0], R * 0.35, -origin[1]); }
        camera.near = R * 0.01; camera.far = R * 40; camera.updateProjectionMatrix();
        scene.fog.near = R * 4; scene.fog.far = R * 12;
        controls.update(); lastR = R;
      }
      render();
    }

    function patternMesh(pat, R, origin, opacity, wire) {
      const nA = pat.az.length, nE = pat.el.length;
      const pos = new Float32Array(nA * nE * 3), col = new Float32Array(nA * nE * 3);
      const floor = pat.max - DB_RANGE;
      for (let j = 0; j < nE; j++) for (let i = 0; i < nA; i++) {
        const g = pat.g[j * nA + i];
        const t = Math.max(0, (g - floor) / DB_RANGE);
        const r = R * t;
        const a = pat.az[i] * Math.PI / 180, e = pat.el[j] * Math.PI / 180;
        const w = [origin[0] + r * Math.cos(e) * Math.sin(a), origin[1] + r * Math.cos(e) * Math.cos(a), origin[2] + r * Math.sin(e)];
        const k = (j * nA + i) * 3;
        pos[k] = w[0]; pos[k + 1] = w[2]; pos[k + 2] = -w[1];
        const c = rampColor(t); col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
      const idx = [];
      for (let j = 0; j < nE - 1; j++) for (let i = 0; i < nA; i++) {
        const a = j * nA + i, b = j * nA + (i + 1) % nA, c = (j + 1) * nA + i, dd = (j + 1) * nA + (i + 1) % nA;
        idx.push(a, b, c, b, dd, c);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('color', new T.BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      if (wire) {
        const m = new T.LineSegments(new T.WireframeGeometry(geo), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22 }));
        return m;
      }
      const grp = new T.Group();
      grp.add(new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity, side: T.DoubleSide, depthWrite: false })));
      grp.add(new T.LineSegments(new T.WireframeGeometry(geo), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 })));
      return grp;
    }

    function render() {
      renderer.render(scene, camera);
      const w = el.clientWidth, h = el.clientHeight;
      labels.forEach(l => {
        const p = l.pos.clone().project(camera);
        const vis = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
        l.el.style.display = vis ? '' : 'none';
        l.el.style.left = ((p.x + 1) / 2 * w) + 'px';
        l.el.style.top = ((1 - p.y) / 2 * h) + 'px';
      });
      HS.declutter(labels);
    }
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix(); render();
    }
    root.addEventListener('resize', resize);
    return { update, resize, render };
  }

  // push overlapping HTML labels apart vertically
  HS.declutter = function (labels) {
    const shown = labels.filter(l => l.el.style.display !== 'none' && !l.el.classList.contains('compass'))
      .map(l => ({ l, x: parseFloat(l.el.style.left), y: parseFloat(l.el.style.top), w: l.el.offsetWidth, h: l.el.offsetHeight + 3 }))
      .sort((a, b) => a.y - b.y);
    for (let i = 0; i < shown.length; i++) for (let j = 0; j < i; j++) {
      const a = shown[i], b = shown[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < a.h) { a.y = b.y + a.h; a.l.el.style.top = a.y + 'px'; }
    }
  };

  HS.view3d = { init, rampColor, DB_RANGE };
})(typeof window !== 'undefined' ? window : globalThis);
