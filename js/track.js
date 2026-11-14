// Procedural rally stage: seeded so both players build the exact same road.
export const DS = 2;            // metres between centreline samples
export const ROAD_HALF = 4;     // asphalt half width
export const SHOULDER = 1.6;    // dirt shoulder each side

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
      const next = segs[i + 1];
      if (next && next.type === 'C') extras.push('INTO');
      notes.push({ s: s.s0, s1: s.s1, dir: s.dir > 0 ? 'L' : 'R', sev: s.sev, label: `${name} ${dirTxt}`, sub: extras.join(' · ') });
    } else if (s.finish) {
      notes.push({ s: s.s0, s1: s.s1, dir: 'S', sev: 7, label: 'FINISH', sub: 'full gas!' });
    } else if (s.s1 - s.s0 >= 90) {
      notes.push({ s: s.s0, s1: s.s1, dir: 'S', sev: 7, label: `STRAIGHT ${Math.round((s.s1 - s.s0) / 10) * 10}`, sub: 'flat out' });
    }
  }

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
    return { i: bi, dist: Math.sqrt(bd), lat, s: bi * DS };
  }

  return { seed, X, Z, H, K, TX, TZ, n, length, segs, notes, roadDist, nearest };
}

export function medalTimes(length) {
  return { gold: length / 22, silver: length / 18, bronze: length / 14 };
}
