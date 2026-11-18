// =============================================================================
// Neon City: Vice Circuit — pedestrians
// =============================================================================
// Pedestrians wander the sidewalks, panic and flee when shots land nearby or
// the player's wanted level is high. Can be hurt (and killed) by bullets and
// careless drivers. Dead bodies linger for a while, then get recycled back
// into the world at a distant sidewalk point (recyclePeds).
//
// Randomness note: wandering uses Math.random() — dynamic behaviour, not part
// of the deterministic city generation; the spawn layout itself is seeded.
//
// STATE MACHINE (per ped, implicit):
//   dead    — corpse; deadTimer counts down until recyclePeds() may respawn it
//   fleeing — flee > 0; run along fleeDir with a sine wobble at fleeSpeed
//   normal  — wander with periodic heading changes, steered back onto the
//             sidewalk band whenever movement drifts off the pavement
// Escalation hooks: scarePeds() is called by combat.js on every shot impact,
// scareFromWanted() every step by police.js / main.js, damagePed() by bullets
// and car impacts; the boolean return of damagePed is what police.js uses to
// raise the wanted level when a pedestrian is killed.
import { CITY, COMBAT, PED, WORLD } from './config.js';
import { createRandom, randomSidewalkPoint } from './city.js';

// ---------------------------------------------------------------- spawning

/** Create `count` peds on random sidewalk points (seeded, deterministic). */
export function createPeds(city, seed, count = PED.count) {
  // Distinct xor-shifted seed so ped layout never mirrors the city seed.
  const rnd = createRandom(seed ^ 0x51f15e);
  const peds = [];
  for (let i = 0; i < count; i++) {
    const pt = randomSidewalkPoint(city, rnd);
    peds.push({
      x: pt.x, y: pt.y,
      angle: rnd.range(0, Math.PI * 2),
      speed: PED.speed * rnd.range(0.7, 1.2),   // per-ped walking pace
      hp: PED.hp,
      dead: false,
      deadTimer: 0,
      flee: 0,          // seconds of fleeing left
      fleeDir: null,    // {x, y} unit vector while fleeing
      wanderTimer: rnd.range(1, 4),
      anim: rnd.range(0, 10),
    });
  }
  return peds;
}

// -------------------------------------------------------------- panic hooks

/** Called by combat when a shot lands: nearby peds panic. */
export function scarePeds(peds, x, y, radius = COMBAT.pedFearRadius) {
  for (const p of peds) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < radius) {
      p.flee = PED.fleeTime;
      // Flee directly away; the d < 1 guard avoids dividing by ~zero when the
      // source is practically on top of the ped.
      const away = d < 1 ? { x: 1, y: 0 } : { x: (p.x - x) / d, y: (p.y - y) / d };
      p.fleeDir = away;
    }
  }
}

/** High wanted level keeps peds near the player skittish. */
export function scareFromWanted(peds, playerX, playerY, wanted) {
  if (wanted < 2) return;
  // Fear radius grows with the wanted level.
  scarePeds(peds, playerX, playerY, 200 + wanted * 60);
}

// ------------------------------------------------------------------ damage

/** Returns true when this hit killed the ped (used for wanted escalation). */
export function damagePed(p, amount) {
  if (p.dead) return false;
  p.hp -= amount;
  p.flee = PED.fleeTime; // being hurt always triggers panic
  if (p.hp <= 0) {
    p.dead = true;
    p.deadTimer = 12; // body lingers a while
    return true;
  }
  return false;
}

// ------------------------------------------------------------------- update

/** Step every ped: corpse timers, fleeing, wandering, sidewalk keeping. */
export function updatePeds(peds, city, player, wanted, dt) {
  for (const p of peds) {
    // Corpses just tick their cleanup timer down.
    if (p.dead) {
      p.deadTimer -= dt;
      continue;
    }
    p.anim += dt * 8;

    if (p.flee > 0) {
      // Run away from the remembered threat direction, wobbling a bit. The
      // sine wobble stops the flight path from looking robotic.
      p.flee -= dt;
      const wob = Math.sin(p.anim * 1.7) * 0.4;
      const a = Math.atan2(p.fleeDir.y, p.fleeDir.x) + wob;
      movePed(p, city, Math.cos(a), Math.sin(a), PED.fleeSpeed, dt);
      continue;
    }

    // Normal wandering along sidewalks: pick a new heading now and then,
    // preferring to stay on the pavement band.
    p.wanderTimer -= dt;
    if (p.wanderTimer <= 0) {
      p.wanderTimer = 2 + Math.random() * 3;
      const turn = (Math.random() - 0.5) * Math.PI;
      p.angle += turn;
    }
    movePed(p, city, Math.cos(p.angle), Math.sin(p.angle), p.speed, dt);

    // Steer back toward the nearest sidewalk if we drifted onto asphalt or
    // grass. Whichever axis is closest to a road centre-line wins.
    const gx = Math.round(p.x / CITY.cell) * CITY.cell;
    const gy = Math.round(p.y / CITY.cell) * CITY.cell;
    const off = CITY.roadW / 2 + CITY.sidewalk / 2;
    const distX = Math.abs(p.x - gx), distY = Math.abs(p.y - gy);
    if (distX < distY) {
      // Near a vertical road: pull toward its sidewalk band.
      const want = gx + (p.x > gx ? off : -off);
      if (Math.abs(want - p.x) > 4) p.angle = lerpAngle(p.angle, Math.atan2(0, Math.sign(want - p.x)), 0.05);
    } else {
      const want = gy + (p.y > gy ? off : -off);
      if (Math.abs(want - p.y) > 4) p.angle = lerpAngle(p.angle, Math.atan2(Math.sign(want - p.y), 0), 0.05);
    }
  }
}

/** Integrate one ped step, pushing out of buildings and the world edges. */
function movePed(p, city, dx, dy, speed, dt) {
  let nx = p.x + dx * speed * dt;
  let ny = p.y + dy * speed * dt;
  // Push out of buildings.
  for (const b of city.buildings) {
    const px = Math.max(b.x, Math.min(nx, b.x + b.w));
    const py = Math.max(b.y, Math.min(ny, b.y + b.h));
    const ddx = nx - px, ddy = ny - py;
    const d2 = ddx * ddx + ddy * ddy;
    const r = PED.radius;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.001; // guard: centre exactly on the wall
      nx += (ddx / d) * (r - d);
      ny += (ddy / d) * (r - d);
      // Turn to slide along the wall instead of grinding into it.
      p.angle += (Math.random() - 0.5) * 1.2;
    }
  }
  // World bounds: 6px margin from every edge.
  p.x = Math.max(6, Math.min(WORLD.width - 6, nx));
  p.y = Math.max(6, Math.min(WORLD.height - 6, ny));
  // Face the movement direction; `|| p.angle` keeps the old heading for a
  // zero-length step instead of snapping to 0.
  p.angle = Math.atan2(dy, dx) || p.angle;
}

/** Blend heading `a` toward `b` by fraction t, taking the short way around. */
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// ---------------------------------------------------------------- recycling

/** Respawn far-away dead peds back into the world after a delay. */
export function recyclePeds(peds, city, rnd) {
  for (const p of peds) {
    if (p.dead && p.deadTimer <= 0) {
      const pt = randomSidewalkPoint(city, rnd);
      // Only reuse a ped if the new spawn point is well away from the corpse,
      // so bodies do not visibly pop back to life in front of the player.
      const far = Math.hypot(pt.x - p.x, pt.y - p.y) > 600;
      if (far) {
        p.dead = false;
        p.hp = PED.hp;
        p.x = pt.x; p.y = pt.y;
        p.flee = 0;
      } else {
        p.deadTimer = 4; // try again later
      }
    }
  }
}
