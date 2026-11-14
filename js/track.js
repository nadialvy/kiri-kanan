// Procedural rally stage: seeded so both players build the exact same road.
export const DS = 2;            // metres between centreline samples
export const ROAD_HALF = 4;     // asphalt half width
export const SHOULDER = 1.6;    // dirt shoulder each side
export const BRIDGE_HALF = 2.7; // skinny bridge half width
export const RAMP_LEN = 5, RAMP_H = 1.15;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RADIUS = { 1: 13, 2: 20, 3: 30, 4: 45, 5: 66, 6: 100 };
const ANGLE = { 1: [140, 180], 2: [70, 120], 3: [45, 100], 4: [35, 90], 5: [25, 70], 6: [15, 45] };

export function generateTrack(seed, targetLen = 2400) {
  // retry sub-seeds until the stage is long enough (layout can paint itself into a corner)
  let best = null;
  for (let k = 0; k < 12; k++) {
    const t = buildTrack(seed, k, targetLen);
    if (!best || t.length > best.length) best = t;
    if (t.length >= targetLen * 0.85) break;
  }
  return best;
}

function buildTrack(seed, sub, targetLen) {
  const rnd = mulberry32(seed * 977 + sub * 7919 + 1);
  const R = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const X = [0], Z = [0], H = [0], K = [0];
  const segs = [];

  const build = (len, curv) => {
    const n = Math.max(1, Math.round(len / DS));
    let x = X[X.length - 1], z = Z[Z.length - 1], h = H[H.length - 1];
    const out = [];
    for (let i = 0; i < n; i++) {
      const hm = h + curv * DS * 0.5;
      x += Math.sin(hm) * DS; z += Math.cos(hm) * DS; h += curv * DS;
      out.push([x, z, h]);
    }
    return out;
  };
  const clear = (pts) => {
    const limit = X.length - 45; // ignore the most recent ~90 m
    for (const [x, z] of pts) {
      for (let j = 0; j < limit; j += 2) {
        const dx = X[j] - x, dz = Z[j] - z;
        if (dx * dx + dz * dz < 42 * 42) return false;
      }
    }
    return true;
  };
  const commit = (pts, curv, seg) => {
    seg.s0 = (X.length - 1) * DS;
    for (const [x, z, h] of pts) { X.push(x); Z.push(z); H.push(h); K.push(curv); }
    seg.s1 = (X.length - 1) * DS;
    segs.push(seg);
  };

  commit(build(60, 0), 0, { type: 'S' });
  let lastDir = 0, guard = 0;
  while ((X.length - 1) * DS < targetLen && guard++ < 400) {
    const prev = segs[segs.length - 1];
    let placed = false;
    const wantCurve = prev.type === 'S' ? rnd() < 0.85 : rnd() < 0.62;
    if (wantCurve) {
      for (let tries = 0; tries < 12 && !placed; tries++) {
        const sev = pick([1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6]);
        let dir = rnd() < 0.5 ? 1 : -1;
        if (prev.type === 'C' && rnd() < 0.6) dir = -lastDir; // chicane-ish flow
        if (tries % 2) dir = -dir;
        const ang = (R(...ANGLE[sev]) * Math.PI) / 180;
        const r = RADIUS[sev];
        const curv = dir / r;
        const pts = build(ang * r, curv);
        if (clear(pts)) {
          commit(pts, curv, { type: 'C', dir, sev, ang, trees: sev <= 3 && rnd() < 0.5 });
          lastDir = dir; placed = true;
        }
      }
    }
    if (!placed) {
      for (let tries = 0; tries < 6 && !placed; tries++) {
        const len = tries ? 20 + tries * 8 : R(30, 150);
        const pts = build(len, 0);
        if (clear(pts)) { commit(pts, 0, { type: 'S' }); placed = true; }
      }
    }
    if (!placed) break;
  }
  commit(build(90, 0), 0, { type: 'S', finish: true });

  const n = X.length;
  const TX = new Float32Array(n), TZ = new Float32Array(n);
  for (let i = 0; i < n; i++) { TX[i] = Math.sin(H[i]); TZ[i] = Math.cos(H[i]); }
  const length = (n - 1) * DS;

  // ----- features: skinny bridges, jump ramps, cliffs -----
  const HALF = new Float32Array(n).fill(ROAD_HALF);
  const CLIFF = new Int8Array(n); // +1 = drop on the left, -1 = drop on the right
  const ramps = [], bridges = [], featNotes = [];
  for (let k = 1; k < segs.length; k++) {
    const sg = segs[k], next = segs[k + 1];
    const L = sg.s1 - sg.s0;
    if (sg.type === 'S' && !sg.finish) {
      if (L >= 70 && rnd() < 0.45) {
        const bl = Math.min(40, L - 30), b0 = sg.s0 + (L - bl) / 2, b1 = b0 + bl;
        for (let i = Math.ceil(b0 / DS); i <= Math.floor(b1 / DS); i++) HALF[i] = BRIDGE_HALF;
        const im = Math.round((b0 + b1) / 2 / DS);
        bridges.push({ s0: b0, s1: b1, x: X[im], z: Z[im], h: H[im], len: bl });
        featNotes.push({ s: b0, s1: b1, dir: 'S', sev: 8, kind: 'bridge', label: 'SKINNY BRIDGE', sub: 'tengah, jangan belok!' });
      } else if (L >= 45 && rnd() < 0.6) {
        const rs = sg.s1 - 28;
        ramps.push({ s: rs, len: RAMP_LEN, h: RAMP_H });
        const into = next && next.type === 'C' ? `INTO ${next.sev === 1 ? 'HAIRPIN' : next.sev} ${next.dir > 0 ? 'LEFT' : 'RIGHT'}!` : 'lurus, ga bisa belok di udara';
        featNotes.push({ s: rs, s1: rs + RAMP_LEN, dir: 'S', sev: 9, kind: 'jump', label: 'JUMP!', sub: into });
      }
    } else if (sg.type === 'C' && !sg.trees && sg.sev >= 2 && sg.sev <= 5 && rnd() < 0.4) {
      sg.cliff = true;
      for (let i = Math.round(sg.s0 / DS); i <= Math.round(sg.s1 / DS); i++) CLIFF[i] = -sg.dir;
    }
  }

  // ----- pace notes -----
  const notes = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.type === 'C') {
      const dirTxt = s.dir > 0 ? 'LEFT' : 'RIGHT';
      const name = s.sev === 1 ? 'HAIRPIN' : String(s.sev);
      const extras = [];
      if (s.sev >= 3 && s.ang > 1.75) extras.push('LONG');
      if (s.trees) extras.push("TREES, DON'T CUT");
      if (s.cliff) extras.push('⚠ CLIFF OUTSIDE');
      const next = segs[i + 1];
      if (next && next.type === 'C') extras.push('INTO');
      notes.push({ s: s.s0, s1: s.s1, dir: s.dir > 0 ? 'L' : 'R', sev: s.sev, label: `${name} ${dirTxt}`, sub: extras.join(' · ') });
    } else if (s.finish) {
      notes.push({ s: s.s0, s1: s.s1, dir: 'S', sev: 7, label: 'FINISH', sub: 'full gas!' });
    } else if (s.s1 - s.s0 >= 90) {
      notes.push({ s: s.s0, s1: s.s1, dir: 'S', sev: 7, label: `STRAIGHT ${Math.round((s.s1 - s.s0) / 10) * 10}`, sub: 'flat out' });
    }
  }

  notes.push(...featNotes);
  notes.sort((a, b) => a.s - b.s);

  // ----- spatial grid of samples for fast proximity queries -----
  const CELL = 25, grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(X[i] / CELL), Math.floor(Z[i] / CELL));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
  }
  function roadDist(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = 1e9;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = grid.get(key(cx + a, cz + b)); if (!arr) continue;
      for (const i of arr) { const dx = X[i] - x, dz = Z[i] - z, d = dx * dx + dz * dz; if (d < best) best = d; }
    }
    return Math.sqrt(best);
  }
  // nearest sample searching near a hint index (car moves continuously)
  function nearest(x, z, hint = 0, win = 40) {
    let bi = hint, bd = 1e18;
    const lo = Math.max(0, hint - win), hi = Math.min(n - 1, hint + win);
    for (let i = lo; i <= hi; i++) { const dx = X[i] - x, dz = Z[i] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
    // lateral offset (+ = left of travel direction)
    const dx = x - X[bi], dz = z - Z[bi];
    const lat = dx * TZ[bi] - dz * TX[bi];
    const along = dx * TX[bi] + dz * TZ[bi];
    return { i: bi, dist: Math.sqrt(bd), lat, s: bi * DS + along };
  }
  // nearest sample anywhere (grid based), for world decoration
  function nearestAny(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let bi = -1, bd = 1e18;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = grid.get(key(cx + a, cz + b)); if (!arr) continue;
      for (const i of arr) { const dx = X[i] - x, dz = Z[i] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
    }
    if (bi < 0) return null;
    return { i: bi, lat: (x - X[bi]) * TZ[bi] - (z - Z[bi]) * TX[bi] };
  }
  function groundAt(s, lat) {
    for (const r of ramps) if (s >= r.s && s <= r.s + r.len && Math.abs(lat) <= ROAD_HALF + 0.6) return (r.h * (s - r.s)) / r.len;
    return 0;
  }
  function inRiver(x, z) {
    for (const b of bridges) {
      const dx = x - b.x, dz = z - b.z, tx = Math.sin(b.h), tz = Math.cos(b.h);
      if (Math.abs(dx * tx + dz * tz) < b.len / 2 - 2 && Math.abs(dx * tz - dz * tx) < 45) return true;
    }
    return false;
  }
  function inChasm(x, z) {
    const q = nearestAny(x, z); if (!q || !CLIFF[q.i]) return false;
    return Math.sign(q.lat) === CLIFF[q.i] && Math.abs(q.lat) > ROAD_HALF + SHOULDER + 0.8;
  }

  return { seed, X, Z, H, K, TX, TZ, n, length, segs, notes, roadDist, nearest, HALF, CLIFF, ramps, bridges, groundAt, inRiver, inChasm };
}

export function medalTimes(length) {
  return { gold: length / 22, silver: length / 18, bronze: length / 14 };
}
