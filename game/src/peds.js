// Pedestrians: wander the sidewalks, panic and flee when shots land nearby or
// the player's wanted level is high. Can be hurt (and killed) by bullets and
// careless drivers.
import { CITY, COMBAT, PED, WORLD } from './config.js';
import { createRandom, randomSidewalkPoint } from './city.js';

export function createPeds(city, seed, count = PED.count) {
  const rnd = createRandom(seed ^ 0x51f15e);
  const peds = [];
  for (let i = 0; i < count; i++) {
    const pt = randomSidewalkPoint(city, rnd);
    peds.push({
      x: pt.x, y: pt.y,
      angle: rnd.range(0, Math.PI * 2),
      speed: PED.speed * rnd.range(0.7, 1.2),
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

/** Called by combat when a shot lands: nearby peds panic. */
export function scarePeds(peds, x, y, radius = COMBAT.pedFearRadius) {
  for (const p of peds) {
    if (p.dead) continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < radius) {
      p.flee = PED.fleeTime;
      const away = d < 1 ? { x: 1, y: 0 } : { x: (p.x - x) / d, y: (p.y - y) / d };
      p.fleeDir = away;
    }
  }
}

/** High wanted level keeps peds near the player skittish. */
export function scareFromWanted(peds, playerX, playerY, wanted) {
  if (wanted < 2) return;
  scarePeds(peds, playerX, playerY, 200 + wanted * 60);
}

export function damagePed(p, amount) {
  if (p.dead) return false;
  p.hp -= amount;
  p.flee = PED.fleeTime;
  if (p.hp <= 0) {
    p.dead = true;
    p.deadTimer = 12; // body lingers a while
    return true;
  }
  return false;
}

export function updatePeds(peds, city, player, wanted, dt) {
  for (const p of peds) {
    if (p.dead) {
      p.deadTimer -= dt;
      continue;
    }
    p.anim += dt * 8;

    if (p.flee > 0) {
      // Run away from the remembered threat direction, wobbling a bit.
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

    // Steer back toward the nearest sidewalk if we drifted onto asphalt or grass.
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
      const d = Math.sqrt(d2) || 0.001;
      nx += (ddx / d) * (r - d);
      ny += (ddy / d) * (r - d);
      // Turn to slide along the wall instead of grinding into it.
      p.angle += (Math.random() - 0.5) * 1.2;
    }
  }
  p.x = Math.max(6, Math.min(WORLD.width - 6, nx));
  p.y = Math.max(6, Math.min(WORLD.height - 6, ny));
  p.angle = Math.atan2(dy, dx) || p.angle;
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/** Respawn far-away dead peds back into the world after a delay. */
export function recyclePeds(peds, city, rnd) {
  for (const p of peds) {
    if (p.dead && p.deadTimer <= 0) {
      const pt = randomSidewalkPoint(city, rnd);
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
