// 2D physics on the XZ plane: circles vs wall segments, bumpers, a rotating
// spinner, friction zones, water hazards and the cup. Y is always 0 here —
// rendering adds the height.

export const BALL_R = 0.22;
export const WALL_T = 0.28;          // wall half-thickness
const RESTITUTION_WALL = 0.72;
const RESTITUTION_BUMPER = 1.08;
const RESTITUTION_SPINNER = 0.85;
const RESTITUTION_BALL = 0.9;
const FRICTION_GRASS = 1.05;         // 1/s velocity decay
const FRICTION_SAND = 5.0;
const FRICTION_GREEN = 0.7;
const STOP_SPEED = 0.15;
const CUP_CAPTURE_SPEED = 4.2;
export const MAX_SPEED = 24; // ~50% more than the initial 16

export function clampSpeed(vel) {
  const s = Math.hypot(vel.x, vel.z);
  if (s > MAX_SPEED) { vel.x *= MAX_SPEED / s; vel.z *= MAX_SPEED / s; }
}

function closestPointOnSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz || 1e-9;
  let t = ((px - ax) * abx + (pz - az) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + abx * t, z: az + abz * t };
}

// Resolve a circle hitting a segment. surfaceVel = velocity of the segment at
// the contact point (for the moving spinner). Returns true on contact.
function collideSegment(ball, seg, surfaceVel, restitution) {
  const c = closestPointOnSegment(ball.pos.x, ball.pos.z, seg.ax, seg.az, seg.bx, seg.bz);
  let dx = ball.pos.x - c.x, dz = ball.pos.z - c.z;
  let dist = Math.hypot(dx, dz);
  const minDist = BALL_R + (seg.t ?? WALL_T);
  if (dist >= minDist) return false;
  if (dist < 1e-6) { dx = 0; dz = 1; dist = 1; }
  const nx = dx / dist, nz = dz / dist;

  // push out
  ball.pos.x += nx * (minDist - dist);
  ball.pos.z += nz * (minDist - dist);

  // relative velocity along normal
  const svx = surfaceVel ? surfaceVel.x : 0, svz = surfaceVel ? surfaceVel.z : 0;
  const rvx = ball.vel.x - svx, rvz = ball.vel.z - svz;
  const vn = rvx * nx + rvz * nz;
  if (vn < 0) {
    ball.vel.x -= (1 + restitution) * vn * nx;
    ball.vel.z -= (1 + restitution) * vn * nz;
  }
  return true;
}

export function inSand(course, x, z) {
  return course.sandZones.some(s => Math.hypot(x - s.x, z - s.z) < s.r);
}

export function inWater(course, x, z) {
  // canal water, unless on the bridge planks
  for (const w of course.waterZones) {
    if (x > w.x - w.w / 2 && x < w.x + w.w / 2 && z > w.z - w.d / 2 && z < w.z + w.d / 2) {
      const b = course.bridge;
      const onBridge = x > b.x - b.w / 2 - BALL_R * 0.4 && x < b.x + b.w / 2 + BALL_R * 0.4 &&
                       z > b.z - b.d / 2 && z < b.z + b.d / 2;
      if (!onBridge) return true;
    }
  }
  return false;
}

function spinnerEnds(course) {
  const s = course.spinner;
  const hx = Math.cos(s.angle) * s.len, hz = Math.sin(s.angle) * s.len;
  return { ax: s.x - hx, az: s.z - hz, bx: s.x + hx, bz: s.z + hz, t: s.thick };
}

export function step(course, balls, dt, events) {
  const s = course.spinner;
  s.angle += s.angSpeed * dt;

  for (const ball of balls) {
    if (ball.holed || ball.inWater) continue;

    // friction
    let mu = FRICTION_GRASS;
    if (inSand(course, ball.pos.x, ball.pos.z)) mu = FRICTION_SAND;
    else if (Math.hypot(ball.pos.x - course.green.x, ball.pos.z - course.green.z) < course.green.r) mu = FRICTION_GREEN;
    const f = Math.max(0, 1 - mu * dt);
    ball.vel.x *= f; ball.vel.z *= f;

    const speed = Math.hypot(ball.vel.x, ball.vel.z);
    if (speed < STOP_SPEED) { ball.vel.x = 0; ball.vel.z = 0; }

    ball.pos.x += ball.vel.x * dt;
    ball.pos.z += ball.vel.z * dt;

    // walls
    for (const w of course.walls) {
      if (collideSegment(ball, w, null, RESTITUTION_WALL)) events.bounce = true;
    }

    // bumpers (bouncy circles)
    for (const b of course.bumpers) {
      const dx = ball.pos.x - b.x, dz = ball.pos.z - b.z;
      const dist = Math.hypot(dx, dz);
      const minDist = BALL_R + b.r;
      if (dist < minDist && dist > 1e-6) {
        const nx = dx / dist, nz = dz / dist;
        ball.pos.x += nx * (minDist - dist);
        ball.pos.z += nz * (minDist - dist);
        const vn = ball.vel.x * nx + ball.vel.z * nz;
        if (vn < 0) {
          ball.vel.x -= (1 + RESTITUTION_BUMPER) * vn * nx;
          ball.vel.z -= (1 + RESTITUTION_BUMPER) * vn * nz;
          events.bumper = true;
        }
      }
    }

    // spinner (rotating bar — imparts its surface velocity)
    const seg = spinnerEnds(course);
    const relx = ball.pos.x - s.x, relz = ball.pos.z - s.z;
    const surfVel = { x: s.angSpeed * relz, z: -s.angSpeed * relx };
    if (collideSegment(ball, seg, surfVel, RESTITUTION_SPINNER)) events.bounce = true;

    // cup
    const cd = Math.hypot(ball.pos.x - course.cup.x, ball.pos.z - course.cup.z);
    if (cd < course.cup.r && Math.hypot(ball.vel.x, ball.vel.z) < CUP_CAPTURE_SPEED) {
      ball.holed = true;
      ball.vel.x = 0; ball.vel.z = 0;
      events.holed = ball;
    }

    // water
    if (inWater(course, ball.pos.x, ball.pos.z)) {
      ball.inWater = true;
      ball.vel.x = 0; ball.vel.z = 0;
      events.splash = ball;
    }
  }

  // ball-ball collisions (equal mass elastic)
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.holed || a.inWater) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.holed || b.inWater) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      const minDist = BALL_R * 2;
      if (dist < minDist && dist > 1e-6) {
        const nx = dx / dist, nz = dz / dist;
        const overlap = (minDist - dist) / 2;
        a.pos.x -= nx * overlap; a.pos.z -= nz * overlap;
        b.pos.x += nx * overlap; b.pos.z += nz * overlap;
        const avn = a.vel.x * nx + a.vel.z * nz;
        const bvn = b.vel.x * nx + b.vel.z * nz;
        const swap = (bvn - avn) * RESTITUTION_BALL;
        a.vel.x += swap * nx; a.vel.z += swap * nz;
        b.vel.x -= swap * nx; b.vel.z -= swap * nz;
        events.bounce = true;
      }
    }
  }
}

export function allRested(balls) {
  return balls.every(b => b.holed || b.inWater || (b.vel.x === 0 && b.vel.z === 0));
}
