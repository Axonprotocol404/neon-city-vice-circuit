// =============================================================================
// Neon City: Vice Circuit — police response
// =============================================================================
// Wanted level 1-5 drives patrol spawns, chasing cars, roadblocks at 3+, and
// a spotlight helicopter at 4+. Evading (staying out of sight long enough)
// drops the heat star by star.
//
// Escalation ladder (see POLICE in config.js):
//   1-2  patrol cars chase (cap scales with level)
//   3+   patrols open fire, roadblocks spawn ahead of the player
//   4+   helicopter joins and counts as persistent line-of-sight
//
// The module communicates with main.js purely through the `events` array:
// policeShoot / evade / heliIn / heliGone / copDown event objects.
//
// SIGHTING RULES: police.sighted is recomputed every step from scratch —
// the helicopter hovering overhead always counts, plus any live patrol within
// 560 px of the chased target (the car if driving, the body otherwise). The
// evade timer only accumulates while sighted is false, and being spotted
// resets it to zero immediately, so a single glimpse stalls the cooldown.
//
// UNIT LIFECYCLE: spawnPatrol() creates cruisers on roads 600-1000 px out;
// they retire (wanted 0) once > 900 px away, and wrecked hulks are dropped
// from the list once the player is 700 px past them — both numbers generous
// enough that units never despawn in the player's view.
import { CAR, CITY, PALETTE, POLICE, WORLD } from './config.js';
import { createCar, damageCar } from './car.js';

// ------------------------------------------------------------ state factory

/** Fresh police-response state bound to a city. */
export function createPolice(city) {
  return {
    city,
    units: [],        // patrol cars chasing the player
    roadblocks: [],   // {x, y, angle, cars:[], hp}
    heli: null,       // {x, y, tx, ty, angle} or null
    spawnTimer: 0,
    evadeTimer: 0,    // counts down out-of-sight seconds toward a star drop
    stars: 0,         // mirrored wanted level (main.js syncs from player)
    sighted: false,
  };
}

// ------------------------------------------------------------- main update

/** Sync the wanted level from the player and run the response each step. */
export function updatePolice(police, player, trafficCars, bullets, dt, events) {
  police.stars = player.wanted;

  if (player.wanted === 0) {
    // Stand down: units drive off (removed once far enough away), heavier
    // responses are cleared immediately.
    for (const u of police.units) {
      if (Math.hypot(u.x - player.x, u.y - player.y) > 900) u.retire = true;
    }
    police.roadblocks.length = 0;
    if (police.heli) events.push({ type: 'heliGone' });
    police.heli = null;
    police.units = police.units.filter(u => !u.retire);
    return;
  }

  // --- evasion: player unseen cools one star every evadeTime seconds.
  if (!police.sighted) {
    police.evadeTimer += dt;
    if (police.evadeTimer >= POLICE.evadeTime) {
      police.evadeTimer = 0;
      if (player.wanted > 0) {
        player.wanted -= 1;
        events.push({ type: 'evade', stars: player.wanted });
      }
    }
  } else {
    police.evadeTimer = 0; // being seen resets the evasion countdown
  }

  // --- spawn chasers up to the level cap.
  const cap = POLICE.maxUnits[Math.max(1, Math.min(5, player.wanted))] ?? 1;
  police.spawnTimer -= dt;
  const chasing = police.units.filter(u => !u.wrecked && !u.retire).length;
  if (chasing < cap && police.spawnTimer <= 0) {
    spawnPatrol(police, player);
    police.spawnTimer = POLICE.spawnDelay;
  }

  // --- roadblocks at 3+.
  if (player.wanted >= POLICE.roadblockWanted) {
    updateRoadblocks(police, player, dt);
  } else {
    police.roadblocks.length = 0;
  }

  // --- helicopter at 4+.
  if (player.wanted >= POLICE.heliWanted) {
    if (!police.heli) {
      police.heli = {
        x: player.x + 400, y: player.y - 400, // arrives from the north-east
        angle: 0, rotor: 0,
      };
      events.push({ type: 'heliIn' });
    }
    updateHeli(police.heli, player, dt);
  } else if (police.heli) {
    police.heli = null;
    events.push({ type: 'heliGone' });
  }

  // --- patrol car AI: chase, ram, and shoot at 3+.
  // Line of sight: the helicopter always counts as sighting; any patrol
  // within 560px of the target also does.
  police.sighted = Boolean(police.heli);
  for (const u of police.units) {
    if (u.wrecked || u.retire) continue;
    const t = player.inCar ?? player;
    if (Math.hypot(t.x - u.x, t.y - u.y) < 560) police.sighted = true;
    chasePlayer(u, player, dt, events);
  }
  // Cleanup: wrecked units vanish once the player has left them behind.
  police.units = police.units.filter(u => !u.wrecked || Math.hypot(u.x - player.x, u.y - player.y) < 700);
}

// ------------------------------------------------------------- patrol spawn

function spawnPatrol(police, player) {
  // Spawn on a road a few blocks away, heading roughly toward the player.
  const ang = Math.random() * Math.PI * 2;
  const dist = 600 + Math.random() * 400;
  let x = player.x + Math.cos(ang) * dist;
  let y = player.y + Math.sin(ang) * dist;
  // Snap to the nearest road centre-line (whichever axis is closer).
  const gx = Math.round(x / CITY.cell) * CITY.cell;
  const gy = Math.round(y / CITY.cell) * CITY.cell;
  if (Math.abs(x - gx) < Math.abs(y - gy)) x = gx + CITY.laneOffset; else y = gy + CITY.laneOffset;
  x = Math.max(40, Math.min(WORLD.width - 40, x));
  y = Math.max(40, Math.min(WORLD.height - 40, y));
  const u = createCar('patrol', x, y, Math.atan2(player.y - y, player.x - x), PALETTE.police, 'police', police.city);
  u.siren = true;
  u.shootTimer = 0;
  u.isPolice = true;
  police.units.push(u);
}

// ---------------------------------------------------------------- pursuit AI

function chasePlayer(u, player, dt, events) {
  const target = player.inCar ?? player; // chase the car, or the body on foot
  const dx = target.x - u.x, dy = target.y - u.y;
  const dist = Math.hypot(dx, dy);

  // Steer toward the target (wrapped to the shortest turn direction).
  let want = Math.atan2(dy, dx);
  let diff = want - u.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  u.steer = Math.max(-1, Math.min(1, diff * 2));

  // Full throttle unless very close and on foot (arrest range slows them).
  const near = dist < 120;
  u.throttle = near ? 0.35 : 1;
  u.brake = false;
  u.desiredSpeed = CAR.types.patrol.speed * POLICE.chaseSpeed * (near ? 0.4 : 1);

  // Drive with the shared physics.
  drivePolice(u, dt);

  // Shooting at wanted 3+: timed volleys aimed straight at the target.
  if (player.wanted >= 3 && dist < POLICE.shootRange) {
    u.shootTimer -= dt;
    if (u.shootTimer <= 0) {
      u.shootTimer = POLICE.shootCooldown;
      const aim = Math.atan2(target.y - u.y, target.x - u.x);
      events.push({ type: 'policeShoot', x: u.x, y: u.y, angle: aim, damage: POLICE.bulletDamage });
    }
  }
}

/** Police-only driving step: same grip model as traffic, softer wall response. */
function drivePolice(u, dt) {
  const grip = u.grip;
  const want = u.desiredSpeed ?? CAR.types.patrol.speed;
  // Accelerate toward desired speed, capped by accel / brakeForce per step.
  u.speed += Math.max(-CAR.brakeForce * dt, Math.min(u.accel * dt, want - u.speed));
  const speedFactor = Math.min(1, Math.abs(u.speed) / (u.maxSpeed * 0.35));
  u.angle += u.steer * u.turnRate * speedFactor * dt;
  const vx = Math.cos(u.angle) * u.speed;
  const vy = Math.sin(u.angle) * u.speed;
  u.vx = u.vx * (1 - grip) + vx * grip;
  u.vy = u.vy * (1 - grip) + vy * grip;
  u.x += u.vx * dt;
  u.y += u.vy * dt;
  // Building slide (police bounce softly, do not explode into walls).
  for (const b of u.city.buildings) {
    const px = Math.max(b.x, Math.min(u.x, b.x + b.w));
    const py = Math.max(b.y, Math.min(u.y, b.y + b.h));
    const dx = u.x - px, dy = u.y - py;
    const d2 = dx * dx + dy * dy;
    const r = u.l * 0.32;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.001; // guard: centre exactly on the surface
      u.x += (dx / d) * (r - d);
      u.y += (dy / d) * (r - d);
      u.speed *= 0.6;
    }
  }
}

// ---------------------------------------------------------------- roadblocks

function updateRoadblocks(police, player, dt) {
  // Keep at most one active roadblock ahead of the player's travel direction;
  // recycle it (and rebuild further ahead) once the player passes it by.
  const active = police.roadblocks[0];
  const target = player.inCar ?? player;
  const heading = player.inCar ? player.inCar.angle : player.angle;
  const aheadX = target.x + Math.cos(heading) * 520;
  const aheadY = target.y + Math.sin(heading) * 520;

  if (!active || Math.hypot(active.x - target.x, active.y - target.y) > 900) {
    police.roadblocks.length = 0;
    // Snap the blocker onto the nearest road the player is heading toward.
    // "across" = heading mostly along X, so the road crossed is vertical.
    const gx = Math.round(aheadX / CITY.cell) * CITY.cell;
    const gy = Math.round(aheadY / CITY.cell) * CITY.cell;
    const across = Math.abs(heading) < Math.PI / 4 || Math.abs(heading) > 3 * Math.PI / 4;
    const x = across ? gx : aheadX;
    const y = across ? aheadY : gy;
    const rb = { x, y, angle: across ? 0 : Math.PI / 2, cars: [], hp: 3 };
    // Two patrol cars parked nose-to-nose across the road.
    for (const off of [-CITY.laneOffset, CITY.laneOffset]) {
      const cx = across ? x : x + off;
      const cy = across ? y + off : y;
      const c = createCar('patrol', cx, cy, rb.angle + Math.PI / 2, PALETTE.police, 'police', police.city);
      c.blocker = true;
      rb.cars.push(c);
    }
    police.roadblocks.push(rb);
  }

  // The blocker cars sit still but can be destroyed (3 hits each hp pool):
  // keep them anchored and flagged as driven so enterCar/traffic skip them.
  for (const rb of police.roadblocks) {
    for (const c of rb.cars) {
      if (!c.wrecked) {
        c.speed = 0;
        c.driver = 'police';
      }
    }
  }
}

/** Police roadblock / unit cars take damage from the player's bullets. */
export function damagePoliceCar(police, car, amount, events) {
  if (car.blocker) {
    // Blockers use their own small hp pool instead of car damage rules.
    car.hp -= amount;
    if (car.hp <= 0 && !car.wrecked) {
      car.wrecked = true;
      events.push({ type: 'copDown' });
    }
    return;
  }
  damageCar(car, amount);
  if (car.wrecked) events.push({ type: 'copDown' });
}

// ------------------------------------------------------------- helicopter

function updateHeli(h, player, dt) {
  const tx = player.x, ty = player.y;
  const dx = tx - h.x, dy = ty - h.y;
  const d = Math.hypot(dx, dy) || 1; // guard: directly overhead
  const sp = POLICE.heliSpeed;
  // Move at most `sp * dt` per step and never overshoot the player.
  h.x += (dx / d) * Math.min(sp * dt, d);
  h.y += (dy / d) * Math.min(sp * dt, d);
  h.angle = Math.atan2(dy, dx);
  h.rotor += dt * 30;
}
