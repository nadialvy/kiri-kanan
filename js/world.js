import * as THREE from 'three';
import { ROAD_HALF, SHOULDER, mulberry32 } from './track.js';

// Tree / obstacle colliders in a hashed grid
export class Colliders {
  constructor() { this.cell = 10; this.map = new Map(); }
  k(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(x, z, r) {
    const c = this.cell;
    for (let a = Math.floor((x - r) / c); a <= Math.floor((x + r) / c); a++)
      for (let b = Math.floor((z - r) / c); b <= Math.floor((z + r) / c); b++) {
        const key = this.k(a, b); let arr = this.map.get(key); if (!arr) this.map.set(key, (arr = [])); arr.push({ x, z, r });
      }
  }
  query(x, z) { return this.map.get(this.k(Math.floor(x / this.cell), Math.floor(z / this.cell))) || []; }
}

function ribbon(track, offL, offR, y, color, opts = {}) {
  const { X, Z, TX, TZ, n } = track;
  const step = opts.step || 1;
  const pos = [], idx = [];
  let v = 0;
  for (let i = 0; i < n; i += step) {
    const lx = TZ[i], lz = -TX[i]; // left vector
    pos.push(X[i] + lx * offL, y, Z[i] + lz * offL, X[i] + lx * offR, y, Z[i] + lz * offR);
    if (v > 0) { const a = (v - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    v++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // make sure normals face up regardless of winding
  const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -(opts.layer || 1), polygonOffsetUnits: -(opts.layer || 1) }));
  m.receiveShadow = true;
  return m;
}

function dashes(track, off, y, color, dashLen, gapLen, width) {
  const { X, Z, TX, TZ, n } = track;
  const pos = [], idx = []; let v = 0;
  const per = Math.round((dashLen + gapLen) / 2), on = Math.round(dashLen / 2);
  for (let i = 0; i + on < n; i += per) {
    const quad = [];
    for (const j of [i, i + on]) {
      const lx = TZ[j], lz = -TX[j];
      quad.push(X[j] + lx * (off + width), y, Z[j] + lz * (off + width), X[j] + lx * (off - width), y, Z[j] + lz * (off - width));
    }
    pos.push(...quad); idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
}

function groundTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6fb34a'; g.fillRect(0, 0, 256, 256);
  const r = mulberry32(7);
  for (let i = 0; i < 900; i++) {
    const s = 2 + r() * 10; g.fillStyle = r() < 0.5 ? 'rgba(90,160,60,0.5)' : 'rgba(130,195,85,0.45)';
    g.fillRect(r() * 256, r() * 256, s, s);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildWorld(scene, track, assets) {
  const group = new THREE.Group(); scene.add(group);
  const colliders = new Colliders();
  const rnd = mulberry32(track.seed * 31 + 5);

  // bounds
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < track.n; i++) { minX = Math.min(minX, track.X[i]); maxX = Math.max(maxX, track.X[i]); minZ = Math.min(minZ, track.Z[i]); maxZ = Math.max(maxZ, track.Z[i]); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, span = Math.max(maxX - minX, maxZ - minZ) + 800;

  // ground
  const gt = groundTexture(); gt.repeat.set(span / 24, span / 24);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshLambertMaterial({ map: gt }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0, cz); ground.receiveShadow = true; group.add(ground);

  // road layers
  group.add(ribbon(track, ROAD_HALF + SHOULDER, -(ROAD_HALF + SHOULDER), 0.0, 0xc9a574, { layer: 1 }));
  group.add(ribbon(track, ROAD_HALF, -ROAD_HALF, 0.0, 0x4a4d55, { layer: 2 }));
  group.add(ribbon(track, ROAD_HALF - 0.25, ROAD_HALF - 0.45, 0.0, 0xf2f2f2, { layer: 3 }));
  group.add(ribbon(track, -(ROAD_HALF - 0.25), -(ROAD_HALF - 0.45), 0.0, 0xf2f2f2, { layer: 3 }));
  group.add(dashes(track, 0, 0.0, 0xf4f4f4, 4, 6, 0.12));

  // start + finish gates
  const gate = (i, color, text) => {
    const g = new THREE.Group();
    const postM = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), postM); p.position.set(sx * (ROAD_HALF + 1), 2.5, 0); p.castShadow = true; g.add(p);
    }
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 512, 96);
    x.fillStyle = '#fff'; x.font = 'bold 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 50);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 + 2.4, 1.3, 0.25), new THREE.MeshLambertMaterial({ map: tex }));
    banner.position.y = 4.6; g.add(banner);
    g.position.set(track.X[i], 0, track.Z[i]); g.rotation.y = track.H[i];
    group.add(g);
  };
  gate(8, '#e8413c', 'START');
  gate(track.n - 30, '#1d1d1f', '🏁 FINISH 🏁');

  // roadside white posts (instanced)
  const postGeo = new THREE.BoxGeometry(0.18, 0.9, 0.18); postGeo.translate(0, 0.45, 0);
  const postCount = Math.floor(track.n / 12) * 2;
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), postCount);
  const m4 = new THREE.Matrix4(); let pc = 0;
  for (let i = 0; i < track.n && pc < postCount - 1; i += 12) {
    for (const side of [1, -1]) {
      const off = side * (ROAD_HALF + SHOULDER + 0.4);
      const x = track.X[i] + track.TZ[i] * off, z = track.Z[i] - track.TX[i] * off;
      if (track.roadDist(x, z) < ROAD_HALF + SHOULDER) continue;
      m4.makeTranslation(x, 0, z); posts.setMatrixAt(pc++, m4);
    }
  }
  posts.count = pc; group.add(posts);

  // ---- trees: instanced low-poly pines + round "broccoli" trees ----
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6); trunkGeo.translate(0, 0.8, 0);
  const pineGeo = new THREE.ConeGeometry(1.6, 4.2, 7); pineGeo.translate(0, 3.6, 0);
  const pine2 = new THREE.ConeGeometry(1.15, 3, 7); pine2.translate(0, 5.3, 0);
  const roundGeo = new THREE.IcosahedronGeometry(1.9, 0); roundGeo.translate(0, 3.2, 0);
  const round2 = new THREE.IcosahedronGeometry(1.3, 0); round2.translate(0.7, 4.3, 0.3);
  const MAX = 4200;
  const mk = (geo, color) => { const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), MAX); im.castShadow = true; im.receiveShadow = false; im.count = 0; group.add(im); return im; };
  const trunks = mk(trunkGeo, 0x7a5232), pineA = mk(pineGeo, 0xffffff), pineB = mk(pine2, 0xffffff), roundA = mk(roundGeo, 0xffffff), roundB = mk(round2, 0xffffff);
  const col = new THREE.Color();
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let tc = 0, pcount = 0, rcount = 0;
  const addTree = (x, z, scale) => {
    if (tc >= MAX) return;
    q.setFromAxisAngle(up, rnd() * 6.28); s.set(scale, scale * (0.85 + rnd() * 0.3), scale); p.set(x, 0, z);
    m4.compose(p, q, s);
    trunks.setMatrixAt(tc++, m4);
    if (rnd() < 0.55) {
      col.setHSL(0.36 + rnd() * 0.05, 0.45, 0.24 + rnd() * 0.08);
      pineA.setMatrixAt(pcount, m4); pineB.setMatrixAt(pcount, m4); pineA.setColorAt(pcount, col); pineB.setColorAt(pcount, col); pcount++;
    } else {
      col.setHSL(0.24 + rnd() * 0.07, 0.55, 0.42 + rnd() * 0.1);
      roundA.setMatrixAt(rcount, m4); roundB.setMatrixAt(rcount, m4); roundA.setColorAt(rcount, col); roundB.setColorAt(rcount, col.offsetHSL(0, 0, 0.05)); rcount++;
    }
    colliders.add(x, z, 0.55 * scale + 0.15);
  };

  // dense lines for "TREES" corners on the outside
  const outsideDense = [];
  for (const sg of track.segs) if (sg.type === 'C' && sg.trees) outsideDense.push(sg);
  for (const sg of outsideDense) {
    const i0 = Math.round(sg.s0 / 2), i1 = Math.round(sg.s1 / 2);
    const side = -sg.dir; // outside of the curve
    for (let i = i0; i <= i1; i += 2) {
      const off = side * (ROAD_HALF + SHOULDER + 1.4 + rnd() * 1.5);
      const x = track.X[i] + track.TZ[i] * off, z = track.Z[i] - track.TX[i] * off;
      if (track.roadDist(x, z) > ROAD_HALF + SHOULDER + 1) addTree(x, z, 0.9 + rnd() * 0.4);
    }
  }
  // scattered forest along the whole stage
  for (let i = 0; i < track.n; i += 1) {
    for (const side of [1, -1]) {
      if (rnd() > 0.55) continue;
      const lat = side * (ROAD_HALF + SHOULDER + 3 + Math.pow(rnd(), 1.6) * 40);
      const x = track.X[i] + track.TZ[i] * lat + (rnd() - 0.5) * 3, z = track.Z[i] - track.TX[i] * lat + (rnd() - 0.5) * 3;
      if (track.roadDist(x, z) < ROAD_HALF + SHOULDER + 2.5) continue;
      addTree(x, z, 0.8 + rnd() * 0.7);
    }
  }
  for (const im of [trunks]) im.count = tc;
  pineA.count = pineB.count = pcount; roundA.count = roundB.count = rcount;
  for (const im of [trunks, pineA, pineB, roundA, roundB]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }

  // ---- Kenney forest blocks far back to thicken the woods ----
  if (assets.forest) {
    const fg = assets.forest;
    const FMAX = 600;
    const parts = [];
    fg.traverse((o) => { if (o.isMesh) parts.push(o); });
    const ims = parts.map((pm) => { const im = new THREE.InstancedMesh(pm.geometry, pm.material, FMAX); im.castShadow = false; im.count = 0; group.add(im); return im; });
    let fc = 0;
    for (let i = 0; i < track.n && fc < FMAX; i += 9) {
      for (const side of [1, -1]) {
        if (rnd() < 0.35) continue;
        const lat = side * (34 + rnd() * 40);
        const x = track.X[i] + track.TZ[i] * lat, z = track.Z[i] - track.TX[i] * lat;
        if (track.roadDist(x, z) < 22) continue;
        const sc = 1.3 + rnd() * 0.6;
        q.setFromAxisAngle(up, Math.floor(rnd() * 4) * Math.PI / 2); s.set(sc, sc, sc); p.set(x, 0, z);
        m4.compose(p, q, s);
        for (const im of ims) im.setMatrixAt(fc, m4);
        colliders.add(x, z, 5 * sc);
        fc++;
        if (fc >= FMAX) break;
      }
    }
    for (const im of ims) { im.count = fc; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }

  // a few rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0x9a948c, flatShading: true }), 300);
  let rc = 0;
  for (let i = 0; i < track.n && rc < 300; i += 7) {
    if (rnd() > 0.45) continue;
    const side = rnd() < 0.5 ? 1 : -1;
    const lat = side * (ROAD_HALF + SHOULDER + 2 + rnd() * 14);
    const x = track.X[i] + track.TZ[i] * lat, z = track.Z[i] - track.TX[i] * lat;
    if (track.roadDist(x, z) < ROAD_HALF + SHOULDER + 1.5) continue;
    const sc = 0.4 + rnd() * 0.9;
    q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); s.set(sc * 1.3, sc, sc * 1.1); p.set(x, sc * 0.3, z);
    m4.compose(p, q, s); rocks.setMatrixAt(rc++, m4);
    if (sc > 0.7) colliders.add(x, z, sc);
  }
  rocks.count = rc; rocks.castShadow = true; group.add(rocks);

  return { group, colliders, dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry && o.geometry !== assets.forestGeo) o.geometry.dispose?.(); }); } };
}

// ---- blocky cockpit, seen from inside ----
export function buildCockpit() {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xd8312b });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2d3a });
  const grey = new THREE.MeshLambertMaterial({ color: 0x9c9fa6 });
  const navy = new THREE.MeshLambertMaterial({ color: 0x3b4466 });
  const orange = new THREE.MeshLambertMaterial({ color: 0xf2a33a });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf1d2a8 });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };

  box(1.9, 0.08, 1.9, navy, 0, 1.8, -0.2);           // roof liner
  box(1.9, 0.14, 0.22, red, 0, 1.74, 0.82);            // windscreen header
  box(1.8, 0.28, 0.5, grey, 0, 0.92, 1.05);            // dashboard
  box(1.8, 0.1, 0.25, dark, 0, 1.08, 0.95);            // dash top
  box(0.2, 0.3, 1.6, red, 0.95, 0.85, 0.1);            // door L
  box(0.2, 0.3, 1.6, red, -0.95, 0.85, 0.1);           // door R
  box(0.12, 0.08, 1.2, red, 0.86, 1.02, 0.1);          // armrest L
  box(0.12, 0.08, 1.2, red, -0.86, 1.02, 0.1);
  for (const sx of [1, -1]) {                          // A pillars
    const p = box(0.1, 0.85, 0.1, red, sx * 0.92, 1.36, 0.95); p.rotation.x = -0.5;
    const b = box(0.12, 0.9, 0.12, red, sx * 0.93, 1.3, -0.75); // B pillars
  }
  box(0.28, 0.07, 0.04, dark, 0, 1.64, 0.8);           // rear-view mirror
  box(0.25, 0.25, 1.0, orange, 0, 0.55, 0.3);           // centre console
  const stick = box(0.06, 0.25, 0.06, dark, 0, 0.75, 0.4); const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), red); knob.position.y = 0.15; stick.add(knob);
  box(0.6, 0.12, 0.7, navy, 0.42, 0.5, -0.1);           // seat L
  box(0.6, 0.12, 0.7, navy, -0.42, 0.5, -0.1);

  // steering wheel (driver = left seat, +X)
  const wheel = new THREE.Group(); wheel.position.set(0.42, 1.0, 0.62); wheel.rotation.x = -0.45;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 18), dark); wheel.add(rim);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.03), dark); wheel.add(spoke);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.06), grey); hub.position.y = -0.05; wheel.add(hub);
  g.add(wheel);

  // blocky arms holding the wheel
  const arm = (fromX) => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.55), skin);
    g.add(a); return { mesh: a, fromX };
  };
  const armL = arm(0.62), armR = arm(0.22);

  // navigator's tablet (right seat, -X)
  const tablet = new THREE.Group(); tablet.position.set(-0.36, 0.95, 0.42); tablet.rotation.x = -0.9;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.03), orange); tablet.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.35), new THREE.MeshBasicMaterial({ color: 0x111111 })); screen.position.z = 0.017; tablet.add(screen);
  g.add(tablet);
  const navArms = [arm(-0.62), arm(-0.12)];

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function placeArm(a, shoulder, hand) {
    tmpA.copy(shoulder); tmpB.copy(hand);
    a.mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
    a.mesh.lookAt(tmpB);
    a.mesh.scale.z = tmpA.distanceTo(tmpB) / 0.55;
  }
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  function update(steer, t) {
    wheel.rotation.z = steer * 1.8;
    const c = Math.cos(steer * 1.8), s = Math.sin(steer * 1.8);
    const handL = new THREE.Vector3(0.18 * c, 0.18 * s, 0); handL.applyEuler(wheel.rotation.clone().set(-0.45, 0, 0)).add(wheel.position);
    const handR = new THREE.Vector3(-0.18 * c, -0.18 * s, 0); handR.applyEuler(wheel.rotation.clone().set(-0.45, 0, 0)).add(wheel.position);
    placeArm(armL, v(0.66, 0.92, -0.25), handL);
    placeArm(armR, v(0.2, 0.92, -0.25), handR);
    const bob = Math.sin(t * 9) * 0.005;
    placeArm(navArms[0], v(-0.64, 0.92, -0.25), v(-0.5, 0.95 + bob, 0.42));
    placeArm(navArms[1], v(-0.2, 0.92, -0.25), v(-0.22, 0.95 + bob, 0.42));
  }
  update(0, 0);
  return { group: g, update, tablet };
}
