// =============================================================================
// Neon City: Vice Circuit — traffic AI
// =============================================================================
// Cars drive along roads in lanes, pick a direction at each intersection
// (sometimes turning), and do basic look-ahead braking so they do not plough
// into whatever is ahead.
//
// Traffic cars are "lite" AI bodies: they still own the fields created by
// car.js (speed, vx/vy, grip, ...) but run a cheaper physics step here
// (stepCarLite) that never bounces hard off buildings — they simply stop and
// slide clear, which reads far better for background traffic. They are also
// repossessed when the player carjacks them (driver !== 'traffic').
//
// NOTE ON RANDOMNESS: intersection turning uses Math.random() on purpose —
// it is dynamic gameplay, not part of the deterministic city seed.
import { CAR, CITY, TRAFFIC } from './config.js';
import { createCar } from './car.js';
import { createRandom, randomRoadPoint } from './city.js';

// The two lane offsets on either side of a road centre-line.
const LANES = [CITY.laneOffset, -CITY.laneOffset];

// ---------------------------------------------------------------- spawning

/**
 * Spawn `count` traffic cars on random road lanes.
 * dir: 'v' (moving along Y, heading +/-PI/2) or 'h' (along X, heading 0/PI).
 *
 * GUARD: the spawn loop is bounded by count * 10 attempts so a pathological
 * seed can never hang the game; the result may then hold fewer than `count`
 * cars (acceptable for background traffic).
 */
export function createTraffic(city, seed, count = TRAFFIC.count) {
  // Distinct xor-shifted seed so traffic layout never mirrors the city seed.
  const rnd = createRandom(seed ^ 0x9e3779b9);
  const cars = [];
  const colors = ['#8d93a8', '#a8792f', '#7d4b9e', '#3f7d5c', '#a83f4b', '#5a6b8c'];
  const kinds = ['sedan', 'sedan', 'sedan', 'van', 'sport']; // sedans dominate
  let guard = 0;
  while (cars.length < count && guard++ < count * 10) {
    const pt = randomRoadPoint(city, rnd);
    const dir = axisToDir(pt.angle);
    const car = createCar(rnd.pick(kinds), pt.x, pt.y, pt.angle, rnd.pick(colors), 'traffic', city);
    car.dir = dir;              // 'up'|'down'|'left'|'right'
    car.speed = TRAFFIC.speed;
    // Lane side is derived from which side of the centre-line we spawned on;
    // the `|| LANES[0]` fallback covers the exact-centre case where sign is 0.
    car.lane = Math.sign(pt.x - Math.round(pt.x / CITY.cell) * CITY.cell) || LANES[0];
    cars.push(car);
  }
  return cars;
}

/** Map a heading angle to a compass-ish direction string. */
function axisToDir(angle) {
  if (Math.abs(Math.sin(angle)) < 0.5) return Math.cos(angle) > 0 ? 'right' : 'left';
  return Math.sin(angle) > 0 ? 'down' : 'up';
}

// Direction tables: unit vector along travel, and the matching heading.
const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIR_ANGLE = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };

// ------------------------------------------------------------------- update

/** Step all traffic cars. playerCar is used for avoidance and panic honks. */
export function updateTraffic(cars, city, playerCar, peds, dt) {
  for (const c of cars) {
    // Only live, un-wrecked traffic is steered here; the player may have
    // carjacked a car, in which case it stops being our business.
    if (c.wrecked || c.driver !== 'traffic') continue;

    // -- Lane keeping: steer toward the target lane centre-line on our axis.
    if (c.dir === 'up' || c.dir === 'down') {
      const gx = Math.round(c.x / CITY.cell) * CITY.cell;
      const targetX = gx + c.lane;
      c.steer = clamp((targetX - c.x) * 0.05 + angleCorrection(c), -1, 1);
    } else {
      const gy = Math.round(c.y / CITY.cell) * CITY.cell;
      const targetY = gy + c.lane;
      c.steer = clamp(-(targetY - c.y) * 0.05 + angleCorrection(c), -1, 1);
    }

    // -- Look ahead: brake for cars, peds and the player in front of us.
    // A probe point TRAFFIC.avoidAhead px ahead along the current direction;
    // overlapping bodies near that probe count as "blocked".
    const [fx, fy] = DIR_VEC[c.dir];
    const ax = c.x + fx * TRAFFIC.avoidAhead;
    const ay = c.y + fy * TRAFFIC.avoidAhead;
    let blocked = false;
    for (const o of cars) {
      // Same-lane traffic ahead is expected, not an obstacle (note: the
      // precedence here is `o === c || (o.driver === 'traffic' && parallel)`).
      if (o === c || o.driver === 'traffic' && laneParallel(o, c)) continue;
      if (Math.hypot(o.x - ax, o.y - ay) < (c.l + o.l) / 2.4) { blocked = true; break; }
    }
    if (!blocked && playerCar && !playerCar.wrecked) {
      if (Math.hypot(playerCar.x - ax, playerCar.y - ay) < (c.l + playerCar.l) / 2.2) blocked = true;
    }
    if (!blocked) {
      for (const p of peds) {
        if (p.dead) continue;
        if (Math.hypot(p.x - ax, p.y - ay) < 34) { blocked = true; break; }
      }
    }

    // -- Controls for this step. `desired` is the target speed the lite
    // physics tries to reach; brake only matters above a walking pace (30).
    c.throttle = blocked ? 0 : 1;
    c.brake = blocked && Math.abs(c.speed) > 30;
    c.desired = blocked ? 0 : TRAFFIC.speed;
    c.handbrake = false;

    // Drive via the shared physics: feed throttle toward the traffic speed.
    driveTowardSpeed(c, dt);

    // -- Intersection turning: when we cross a road centre-line perpendicular
    // to our axis, sometimes turn onto it. lastGX/lastGY remember the previous
    // position so a crossing is only detected once per intersection.
    const gx = Math.round(c.x / CITY.cell) * CITY.cell;
    const gy = Math.round(c.y / CITY.cell) * CITY.cell;
    const onCrossX = c.dir === 'up' || c.dir === 'down'
      ? Math.abs(c.x - gx) < 6 && c.x !== c.lastGX
      : false;
    const onCrossY = (c.dir === 'left' || c.dir === 'right')
      ? Math.abs(c.y - gy) < 6 && c.y !== c.lastGY
      : false;
    c.lastGX = c.x; c.lastGY = c.y;

    if ((onCrossX || onCrossY) && Math.random() < TRAFFIC.turnChance) {
      // Pick a perpendicular direction, snapping position onto the new lane.
      const newDir = pickTurn(c.dir);
      if (newDir) {
        c.dir = newDir;
        c.angle = DIR_ANGLE[newDir];
        const lane = LANES[Math.floor(Math.random() * 2)];
        if (c.dir === 'up' || c.dir === 'down') {
          c.x = gx + lane; c.lane = lane;
        } else {
          c.y = gy + lane; c.lane = lane;
        }
        c.speed *= 0.6; // turning costs speed
      }
    }
    clampToCity(c);
  }
}

/** Perpendicular direction options; a turn is always a 90-degree change. */
function pickTurn(dir) {
  const options = dir === 'up' || dir === 'down' ? ['left', 'right'] : ['up', 'down'];
  return options[Math.floor(Math.random() * 2)];
}

/** True when `o` is another traffic car travelling the same direction. */
function laneParallel(o, c) {
  return o.driver === 'traffic' && o.dir === c.dir;
}

/** Signed heading error toward the lane direction, scaled into a steer input. */
function angleCorrection(c) {
  const want = DIR_ANGLE[c.dir];
  let diff = want - c.angle;
  // Wrap into (-PI, PI] so the car turns the short way around.
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff * 1.4;
}

/** Accelerate/brake toward `desired`, then integrate with the lite physics. */
function driveTowardSpeed(c, dt) {
  const want = c.desired ?? TRAFFIC.speed;
  const diff = want - c.speed;
  // Approach the target within one step's accel/brake budget, then hand the
  // integration to the shared lite physics (drift & building push-out).
  c.speed += clamp(diff, -CAR.brakeForce * dt, c.accel * dt);
  // Integrate using the shared physics for drift & collisions.
  c.throttle = 0; c.brake = false;
  stepCarLite(c, dt);
}

/** Minimal re-run of the car physics for AI-driven cars (no throttle input). */
function stepCarLite(c, dt) {
  const grip = c.grip;
  // Grip-blend the velocity toward the heading, exactly like updateCar but
  // without the throttle/brake/steering stages (AI sets speed directly).
  const vx = Math.cos(c.angle) * c.speed;
  const vy = Math.sin(c.angle) * c.speed;
  c.vx = c.vx * (1 - grip) + vx * grip;
  c.vy = c.vy * (1 - grip) + vy * grip;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  // Building overlap: just stop and slide back (traffic never bounces hard).
  for (const b of c.city.buildings) {
    const nx = Math.max(b.x, Math.min(c.x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
    const dx = c.x - nx, dy = c.y - ny;
    const d2 = dx * dx + dy * dy;
    const r = c.l * 0.3;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.001; // guard: centre exactly on the surface
      c.x += (dx / d) * (r - d);
      c.y += (dy / d) * (r - d);
      c.speed *= 0.5;
    }
  }
}

/** Turn the car around when it reaches the city edge (hardcoded 3200 bounds). */
function clampToCity(c) {
  const m = 30;
  if (c.x < m || c.x > 3200 - m || c.y < m || c.y > 3200 - m) {
    // U-turn at the city edge.
    c.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[c.dir];
    c.angle = DIR_ANGLE[c.dir];
    c.x = Math.max(m, Math.min(3200 - m, c.x));
    c.y = Math.max(m, Math.min(3200 - m, c.y));
  }
}

/** Clamp helper shared by the steering maths in this module. */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
