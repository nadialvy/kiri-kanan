import { ROAD_HALF, SHOULDER } from './track.js';

// Arcade rally physics. Gas + steering only — no brakes, on purpose.
export const PENALTY_CRASH = 3;
export const PENALTY_RESET = 10;
const GRAVITY = 22;

export function createCar(track) {
  const c = { x: 0, z: 0, y: 0, vy: 0, air: false, fall: 0, fallKind: '', groundV: 0, h: 0, vx: 0, vz: 0, yaw: 0, steer: 0, idx: 0, lat: 0, s: 0, slip: 0, surface: 'road', crashes: 0, resets: 0, penalty: 0, lastCrash: -9, offTimer: 0 };
  resetTo(c, track, 4);
  return c;
}

export function resetTo(c, track, idx) {
  idx = Math.max(0, Math.min(track.n - 2, idx));
  // don't respawn on a skinny bridge or a ramp — back up to plain road
  while (idx > 4 && (track.HALF[idx] < ROAD_HALF || track.groundAt(idx * 2, 0) > 0)) idx--;
  c.x = track.X[idx]; c.z = track.Z[idx]; c.h = track.H[idx];
  c.vx = c.vz = 0; c.yaw = 0; c.steer = 0; c.idx = idx; c.lat = 0; c.s = idx * 2; c.offTimer = 0;
  c.y = 0; c.vy = 0; c.air = false; c.fall = 0; c.fallKind = ''; c.groundV = 0;
}

const MAX_V = 40;          // ~144 km/h
const WHEELBASE = 2.6;

// returns events: { crash, reset, land, fall }
export function stepCar(c, input, dt, track, colliders, time, running) {
  const ev = {};

  // ---- falling off a cliff / into the river: no control, then respawn ----
  if (c.fall > 0) {
    c.fall -= dt;
    c.vy -= GRAVITY * dt; c.y += c.vy * dt;
    if (c.fallKind === 'water' && c.y < -0.9) { c.y = -0.9; c.vx *= 0.9; c.vz *= 0.9; c.vy = 0; }
    c.x += c.vx * dt; c.z += c.vz * dt;
    c.h += c.yaw * dt;
    if (c.fall <= 0) {
      resetTo(c, track, c.idx - 8);
      if (running) { c.resets++; c.penalty += PENALTY_RESET; }
      ev.reset = true;
    }
    return ev;
  }

  const fx = Math.sin(c.h), fz = Math.cos(c.h);
  const lx = fz, lz = -fx; // left
  let vf = c.vx * fx + c.vz * fz;
  let vl = c.vx * lx + c.vz * lz;

  const near = track.nearest(c.x, c.z, c.idx);
  c.idx = near.i; c.lat = near.lat; c.s = near.s;
  const absLat = Math.abs(near.lat);
  const half = track.HALF[near.i];
  c.surface = absLat <= half + 0.3 ? 'road' : absLat <= ROAD_HALF + SHOULDER + 0.3 && half >= ROAD_HALF ? 'dirt' : 'grass';
  const grip = c.air ? 0 : c.surface === 'road' ? 1 : c.surface === 'dirt' ? 0.8 : 0.6;

  // steering input smoothing (keyboard friendly)
  const target = running ? input.steer : 0;
  const rate = target === 0 ? 7 : 4.2;
  c.steer += Math.max(-rate * dt, Math.min(rate * dt, target - c.steer));

  // throttle — no brake. Lift to slow down via drag & rolling resistance. No traction in the air.
  const thr = running && !c.air ? input.gas : 0;
  const speedFrac = Math.max(0, vf) / MAX_V;
  const accel = thr * 13.5 * (1 - speedFrac * speedFrac) * (c.surface === 'grass' ? 0.55 : 1);
  const roll = c.air ? 0 : (c.surface === 'grass' ? 1.9 : c.surface === 'dirt' ? 0.8 : 0.35) + (running && input.gas ? 0 : 0.9);
  const drag = 0.0045 * vf * Math.abs(vf) + roll * Math.sign(vf);
  vf += (accel - drag) * dt;
  if (!thr && !c.air && Math.abs(vf) < 0.25) vf = 0;
  if (vf < -6) vf = -6;

  // yaw: bicycle model, capped by available grip (understeer/drift). Frozen in the air.
  if (!c.air) {
    const maxSteer = 0.55 / (1 + Math.abs(vf) * 0.03);
    const yawTarget = (vf * Math.tan(c.steer * maxSteer)) / WHEELBASE;
    const latLimit = 13 * grip; // m/s^2
    const yawCap = latLimit / Math.max(3, Math.abs(vf));
    const yawT = Math.max(-yawCap * 1.25, Math.min(yawCap * 1.25, yawTarget));
    c.yaw += (yawT - c.yaw) * Math.min(1, dt * 8);
  }
  c.h += c.yaw * dt;

  // rotate velocity into new heading, lateral velocity decays with grip
  const nfx = Math.sin(c.h), nfz = Math.cos(c.h), nlx = nfz, nlz = -nfx;
  const wx = fx * vf + lx * vl, wz = fz * vf + lz * vl; // world vel after accel
  vf = wx * nfx + wz * nfz;
  vl = wx * nlx + wz * nlz;
  if (!c.air) vl *= Math.exp(-dt * 6 * grip);
  c.slip = c.air ? 0 : Math.abs(vl);

  c.vx = nfx * vf + nlx * vl; c.vz = nfz * vf + nlz * vl;
  c.x += c.vx * dt; c.z += c.vz * dt;

  // ---- vertical: ramps launch you, gravity brings you back ----
  const g = track.groundAt(c.s, c.lat);
  if (!c.air) {
    if (g + 0.05 < c.y) { c.air = true; c.vy = c.groundV; }     // left the ramp lip
    else { c.groundV = (g - c.y) / dt; c.y = g; }
  }
  if (c.air) {
    c.vy -= GRAVITY * dt; c.y += c.vy * dt;
    if (c.y <= g) {
      ev.land = Math.min(1, -c.vy / 14);
      c.y = g; c.vy = 0; c.air = false; c.groundV = 0;
      // landing crooked scrubs speed
      c.vx *= 0.93; c.vz *= 0.93;
    }
  }

  // ---- tree/rock collisions (front + rear circles); fly over them if high enough ----
  if (c.y < 1.5) {
    for (const off of [1.1, -1.1]) {
      const px = c.x + nfx * off, pz = c.z + nfz * off;
      for (const o of colliders.query(px, pz)) {
        const dx = px - o.x, dz = pz - o.z, rr = o.r + 0.95, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), nx = dx / d, nz = dz / d;
          c.x += nx * (rr - d); c.z += nz * (rr - d);
          const vn = c.vx * nx + c.vz * nz;
          if (vn < 0) {
            const speed = Math.hypot(c.vx, c.vz);
            c.vx -= nx * vn * 1.4; c.vz -= nz * vn * 1.4;
            if (-vn > 7 && time - c.lastCrash > 1) {
              c.vx *= 0.25; c.vz *= 0.25; c.lastCrash = time;
              if (running) { c.crashes++; c.penalty += PENALTY_CRASH; }
              ev.crash = Math.min(1, speed / 30);
            } else { c.vx *= 0.92; c.vz *= 0.92; }
          }
        }
      }
    }
  }

  // ---- drops: off the skinny bridge into the river, or over a cliff edge ----
  if (!c.air && running) {
    const cliff = track.CLIFF[c.idx];
    if (cliff && Math.sign(c.lat) === cliff && Math.abs(c.lat) > ROAD_HALF + SHOULDER + 0.8) {
      c.fall = 1.1; c.fallKind = 'cliff'; c.vy = 0; c.yaw = (Math.random() - 0.5) * 2; ev.fall = 'cliff';
    } else if (Math.abs(c.lat) > half + 0.4 && track.inRiver(c.x, c.z)) {
      c.fall = 0.9; c.fallKind = 'water'; c.vy = 1.5; ev.fall = 'water';
    }
  }

  // way off the stage → put back on the road
  if (absLat > ROAD_HALF + 28) c.offTimer += dt; else c.offTimer = 0;
  if (running && c.offTimer > 0.6) {
    resetTo(c, track, c.idx); c.resets++; c.penalty += PENALTY_RESET; ev.reset = true;
  }
  return ev;
}

export function manualReset(c, track) {
  resetTo(c, track, c.idx); c.resets++; c.penalty += PENALTY_RESET;
}

export function speedOf(c) { return Math.hypot(c.vx, c.vz); }
