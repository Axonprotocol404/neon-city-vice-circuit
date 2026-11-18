// =============================================================================
// Neon City: Vice Circuit — player (on-foot state & actions)
// =============================================================================
// The player walks on foot (WASD / arrows), presses F near a car to enter or
// leave it, and carries health, a wanted level and money. The car state
// itself lives in car.js — this module only owns the human side of the
// simulation and never touches vehicle physics.
import { CAR, PLAYER, WORLD } from './config.js';
import { resolveCircle } from './city.js';

// ------------------------------------------------------------- construction

/**
 * Build the initial player record at (x, y). Money starts at 0 here and is
 * topped up from the save by main.js (MONEY_START applies to fresh games).
 */
export function createPlayer(city, x, y) {
  return {
    x, y,
    angle: -Math.PI / 2,     // facing up by default
    health: PLAYER.health,
    maxHealth: PLAYER.health,
    money: 0,
    wanted: 0,               // 0..5
    inCar: null,             // reference to a car object while driving
    fireCooldown: 0,
    hurtTimer: 0,
    regenTimer: 0,
    dead: false,
    city,
    walkAnim: 0,
  };
}

// ------------------------------------------------------------------ walking

/** Move on foot; collision against buildings; returns true when blocked. */
export function walkPlayer(p, dx, dy, dt) {
  let blocked = false;
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    // Normalise input so diagonals are not faster than cardinal movement.
    const nx = dx / len, ny = dy / len;
    p.x += nx * PLAYER.speed * dt;
    p.y += ny * PLAYER.speed * dt;
    p.angle = Math.atan2(ny, nx);
    p.walkAnim += dt * 10;
    // Slide along walls instead of sticking: resolveCircle pushes the circle
    // out along the hit normal, giving free wall-sliding on both axes.
    const hit = resolveCircle(p.city, p.x, p.y, PLAYER.radius);
    if (hit) {
      p.x += hit.nx * hit.depth;
      p.y += hit.ny * hit.depth;
      blocked = true;
    }
    // Hard clamp to the world bounds (10px margin from every edge).
    p.x = Math.max(10, Math.min(WORLD.width - 10, p.x));
    p.y = Math.max(10, Math.min(WORLD.height - 10, p.y));
  }
  return blocked;
}

// ------------------------------------------------------------ car enter/exit

/** Enter the nearest car within range; returns the car or null. */
export function enterCar(p, cars) {
  // Nearest-within-range scan; wrecked and already-driven cars are skipped.
  let best = null, bestD = CAR.enterRange;
  for (const c of cars) {
    if (c.driver === 'player' || c.wrecked) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (best) {
    best.driver = 'player';
    p.inCar = best;
    // Carjacking heat: stealing a patrol car raises the wanted floor to 2.
    // The trailing `Math.max(p.wanted, 0)` keeps the wanted level clamped
    // into the valid 0..5 band after the enter action.
    if (best.kind === 'patrol' && p.wanted < 2) p.wanted = Math.max(p.wanted, 2);
    p.wanted = Math.max(p.wanted, 0);
  }
  return best;
}

export function exitCar(p) {
  const c = p.inCar;
  if (!c) return;
  // Step out on the left side, but never inside a building: fall back to the
  // car's centre when the ejection spot is blocked.
  let ox = p.x - Math.cos(c.angle + Math.PI / 2) * (c.w / 2 + PLAYER.radius + 4);
  let oy = p.y - Math.sin(c.angle + Math.PI / 2) * (c.w / 2 + PLAYER.radius + 4);
  const hit = resolveCircle(p.city, ox, oy, PLAYER.radius);
  if (hit) { ox = p.x; oy = p.y; }
  p.x = ox; p.y = oy;
  c.driver = null;
  p.inCar = null;
}

// -------------------------------------------------------- health & upkeep

/** Apply damage; starts the regen delay and can kill the player. */
export function damagePlayer(p, amount) {
  if (p.dead) return;
  p.health -= amount;
  p.hurtTimer = 0.25;
  p.regenTimer = PLAYER.regenDelay;
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
  }
}

/** Update timers, regen; call every fixed step. */
export function updatePlayer(p, dt) {
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.hurtTimer = Math.max(0, p.hurtTimer - dt);
  // Slow regen kicks in only after the post-damage delay has elapsed.
  if (p.regenTimer > 0) p.regenTimer -= dt;
  else if (p.health > 0 && p.health < p.maxHealth) {
    p.health = Math.min(p.maxHealth, p.health + PLAYER.regenRate * dt);
  }
  // Wanted heat cools slowly when not regenerated elsewhere (police.js drives
  // the real decay; this only caps the value into the 0..5 band).
  p.wanted = Math.max(0, Math.min(5, p.wanted));
}

// ------------------------------------------------------------- persistence

/** Data saved to localStorage between sessions. */
export function playerSave(p) {
  return { x: Math.round(p.x), y: Math.round(p.y), health: Math.round(p.health), money: Math.round(p.money), wanted: p.wanted };
}

/**
 * Restore from a save blob. Every field is validated independently so a
 * partial / corrupted save degrades gracefully; health never restores below 1
 * (a dead-on-load player would soft-lock the game) and wanted stays in band.
 */
export function playerLoad(p, data) {
  if (!data) return;
  if (Number.isFinite(data.x)) p.x = data.x;
  if (Number.isFinite(data.y)) p.y = data.y;
  if (Number.isFinite(data.health)) p.health = Math.max(1, Math.min(p.maxHealth, data.health));
  if (Number.isFinite(data.money)) p.money = data.money;
  if (Number.isFinite(data.wanted)) p.wanted = Math.max(0, Math.min(5, data.wanted));
}
