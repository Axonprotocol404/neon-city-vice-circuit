// =============================================================================
// Neon City: Vice Circuit — car model & physics
// =============================================================================
// Simple but pleasant car physics: forward acceleration, steering that scales
// with speed, light lateral drift (grip), handbrake drifting, building bounce
// and damage. Four kinds of vehicles with distinct tuning (see CAR.types).
//
// MOTION MODEL: every car carries both a signed scalar `speed` (along its
// heading) and a free 2D velocity (vx, vy). The gap between the two is what
// produces drift: grip blends the velocity vector toward the heading every
// step, so lower grip = longer, more visible slides.
//
// Units: speeds in px/s, accelerations in px/s^2, angles in radians. All
// constants come from CAR in config.js — nothing is retuned here per car.
import { CAR, WORLD } from './config.js';

// Monotonic id source; lets other modules tag/compare cars cheaply.
let nextId = 1;

// ------------------------------------------------------------- construction

/**
 * Create a car of `kind` at (x, y) with `angle` heading. `driver` is one of
 * 'player' | 'traffic' | 'police' | null; `city` is required for physics.
 */
export function createCar(kind, x, y, angle, color, driver = null, city = null) {
  const t = CAR.types[kind];
  return {
    id: nextId++,
    kind, x, y, angle, city,
    w: t.w, l: t.l,
    maxSpeed: t.speed, accel: t.accel, grip: t.grip, turnRate: t.turn, hp: t.hp, maxHp: t.hp,
    vx: Math.cos(angle) * 0, vy: Math.sin(angle) * 0,
    speed: 0,             // signed forward speed
    steer: 0,             // -1..1 input
    throttle: 0,          // 0..1
    brake: false,
    handbrake: false,
    driver,               // 'player' | 'traffic' | 'police' | null
    color,
    wrecked: false,
    smokeTimer: 0,
    skidTimer: 0,
    honk: 0,
  };
}

/** The four vehicle kinds as a spawn helper for traffic / police. */
export function carKinds() {
  return Object.keys(CAR.types);
}

// ---------------------------------------------------------------- physics

/**
 * Step the physics for one car for one fixed step. Returns an impact object
 * {nx, ny, speed} when the car hit a building this step, else null.
 */
export function updateCar(c, dt) {
  // Wrecks keep sliding and bleeding off speed, but take no input at all.
  if (c.wrecked) {
    c.speed *= 1 - Math.min(1, 3 * dt);
    c.x += Math.cos(c.angle) * c.speed * dt;
    c.y += Math.sin(c.angle) * c.speed * dt;
    return null;
  }

  const t = CAR.types[c.kind];
  const handbraking = c.handbrake;
  // Handbrake drops effective grip so the tail steps out under steering.
  const grip = handbraking ? t.grip * CAR.handbrakeGrip : t.grip;

  // -- Forward dynamics ------------------------------------------------------
  if (c.throttle > 0) {
    c.speed += c.accel * c.throttle * dt;
  } else {
    // Coasting drag: proportional decay plus a small constant roll-off so the
    // car actually comes to rest instead of creeping forever. The 4 px/s
    // snap threshold kills residual jitter near zero.
    c.speed -= Math.sign(c.speed) * CAR.drag * Math.abs(c.speed) * dt + Math.sign(c.speed) * 20 * dt;
    if (Math.abs(c.speed) < 4) c.speed = 0;
  }
  if (c.brake) {
    const f = CAR.brakeForce * dt;
    c.speed = Math.abs(c.speed) <= f ? 0 : c.speed - Math.sign(c.speed) * f;
  }
  // Reverse cap is gentler than forward top speed (40% of it).
  const cap = t.speed * (c.speed < 0 ? 0.4 : 1);
  c.speed = Math.max(-cap, Math.min(cap, c.speed));

  // -- Steering scales with speed so the car is stable standing still.
  // The `|| 1` guard keeps the sign valid at zero speed (no NaN, no flip).
  const speedFactor = Math.min(1, Math.abs(c.speed) / (t.speed * 0.35));
  c.angle += c.steer * t.turn * speedFactor * dt * Math.sign(c.speed || 1);

  // -- Drift: blend velocity direction toward heading by grip. Lower grip =
  // the velocity vector lags behind the nose, which reads as a slide.
  const vx = Math.cos(c.angle) * c.speed;
  const vy = Math.sin(c.angle) * c.speed;
  const lx = c.vx * (1 - grip) + vx * grip;
  const ly = c.vy * (1 - grip) + vy * grip;
  c.vx = lx; c.vy = ly;
  // Skid marks only while both sliding hard and actually moving fast. NOTE:
  // `Math.hypot(lx, vy)` mixes blended-x with heading-y — that mismatch is
  // intentional (it measures slide asymmetry) and is kept as-is.
  const slide = Math.hypot(lx, vy) - Math.abs(c.speed);
  c.skidTimer = Math.abs(slide) > 40 && Math.abs(c.speed) > 80 ? 0.12 : Math.max(0, c.skidTimer - dt);

  c.x += lx * dt;
  c.y += ly * dt;

  // -- Building collisions ---------------------------------------------------
  // Bounce off the pushed-out normal, lose speed, take damage. The loop runs
  // at most twice (i < 2) but unconditionally breaks after the first resolved
  // impact, so only one bounce happens per step.
  let impact = null;
  for (let i = 0; i < 2; i++) {
    const corners = carCorners(c);
    // Find the deepest building penetration among the four corners.
    let deepest = null, depthMax = 0;
    for (const pt of corners) {
      const hit = rectNormal(c.city, pt.x, pt.y, c.w / 2 + c.l / 4);
      if (hit && hit.depth > depthMax) { deepest = hit; depthMax = hit.depth; }
    }
    if (!deepest) break;
    const speed = Math.abs(c.speed);
    // Depenetrate first, then reflect the velocity about the surface normal.
    c.x += deepest.nx * deepest.depth;
    c.y += deepest.ny * deepest.depth;
    // Reflect velocity about the normal, damped by CAR.bounce.
    const dot = c.vx * deepest.nx + c.vy * deepest.ny;
    c.vx = (c.vx - 2 * dot * deepest.nx) * CAR.bounce;
    c.vy = (c.vy - 2 * dot * deepest.ny) * CAR.bounce;
    c.speed = Math.hypot(c.vx, c.vy) * Math.sign(c.speed || 1) * CAR.bounce;
    // Nudge the nose away from the wall so the car does not grind along it.
    c.angle += (deepest.nx * Math.sin(c.angle) + deepest.ny * -Math.cos(c.angle)) * 0.08;
    // Only hard hits above the threshold cost hp (soft scrapes are free).
    if (speed > 180) {
      c.hp -= CAR.damageBounce;
      if (c.hp <= 0) wreckCar(c);
    }
    impact = { nx: deepest.nx, ny: deepest.ny, speed };
    break;
  }

  // -- World bounds (20px margin) and damaged-engine smoke cadence.
  c.x = Math.max(20, Math.min(WORLD.width - 20, c.x));
  c.y = Math.max(20, Math.min(WORLD.height - 20, c.y));
  if (c.hp < c.maxHp * 0.35) {
    c.smokeTimer -= dt;
    if (c.smokeTimer <= 0) c.smokeTimer = 0.08;
  }
  return impact;
}

/** The four rotated corners of the car's footprint box. */
function carCorners(c) {
  const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
  const hl = c.l / 2, hw = c.w / 2;
  return [
    { x: c.x + cos * hl - sin * hw, y: c.y + sin * hl + cos * hw },
    { x: c.x + cos * hl + sin * hw, y: c.y + sin * hl - cos * hw },
    { x: c.x - cos * hl - sin * hw, y: c.y - sin * hl + cos * hw },
    { x: c.x - cos * hl + sin * hw, y: c.y - sin * hl - cos * hw },
  ];
}

/** Distance from a point to the nearest building surface with a push-out vector. */
function rectNormal(city, x, y, pad) {
  let best = null;
  for (const b of city.buildings) {
    // Closest point on the building rect, then push out along that delta.
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    const dx = x - nx, dy = y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < pad * pad) {
      const d = Math.sqrt(d2) || 0.001; // guard against a point exactly on the edge
      if (!best || d < best.depth) best = { nx: dx / d, ny: dy / d, depth: pad - d };
    }
  }
  return best;
}

// ------------------------------------------------------------ damage & wrecks

export function damageCar(c, amount) {
  if (c.wrecked) return;
  c.hp -= amount;
  if (c.hp <= 0) wreckCar(c);
}

export function wreckCar(c) {
  if (c.wrecked) return;
  c.wrecked = true;
  c.speed = 0; c.vx = 0; c.vy = 0;
  if (c.driver === 'player') {
    // The player is ejected on foot beside the wreck; main.js handles the
    // actual state change via wasPlayerInCar — nothing to do here.
  }
}

// ------------------------------------------------------- car-vs-car contact

/** Car-vs-car overlap test (circle approximations). */
export function carsOverlap(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  const rr = (a.l + b.l) * 0.34;
  return dx * dx + dy * dy < rr * rr;
}

/** Rough bounce between two cars sharing momentum a little. */
export function bounceCars(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1; // guard: perfectly stacked cars
  const nx = dx / d, ny = dy / d;
  const push = 2;                   // px of mutual separation per step
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
  // Only a genuinely fast closing pair (combined speed) takes damage.
  const rel = Math.abs(a.speed) + Math.abs(b.speed);
  if (rel > 160) {
    damageCar(a, 4); damageCar(b, 4);
    a.speed *= 0.85; b.speed *= 0.85;
  }
}
