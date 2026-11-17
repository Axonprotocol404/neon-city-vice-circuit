// Combat: the player fires toward the mouse cursor (click), bullets travel,
// hit peds / police / traffic / buildings, and every impact feeds back into
// health, wanted level and panic.
import { COMBAT, PLAYER } from './config.js';
import { damageCar } from './car.js';
import { damagePed, scarePeds } from './peds.js';
import { damagePoliceCar } from './police.js';

export function createCombat() {
  return { bullets: [], sparks: [] };
}

/** Fire a bullet from the player toward a world-space aim point. */
export function playerShoot(combat, player, aimX, aimY, events) {
  if (player.fireCooldown > 0 || player.dead) return false;
  player.fireCooldown = PLAYER.shootCooldown;
  const dx = aimX - player.x, dy = aimY - player.y;
  const d = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  // Muzzle offset a bit in front of the body (or car nose).
  const src = player.inCar
    ? { x: player.inCar.x + Math.cos(player.inCar.angle) * (player.inCar.l / 2), y: player.inCar.y + Math.sin(player.inCar.angle) * (player.inCar.l / 2) }
    : { x: player.x + Math.cos(angle) * 14, y: player.y + Math.sin(angle) * 14 };
  combat.bullets.push({
    x: src.x, y: src.y,
    vx: Math.cos(angle) * PLAYER.bulletSpeed,
    vy: Math.sin(angle) * PLAYER.bulletSpeed,
    life: PLAYER.bulletLife,
    from: 'player',
    damage: PLAYER.bulletDamage,
  });
  events.push({ type: 'shot', x: src.x, y: src.y, angle });
  scarePeds(combat.peds ?? [], src.x, src.y);
  return true;
}

/** A police bullet spawned by police.js events. */
export function policeShoot(combat, x, y, angle, damage) {
  combat.bullets.push({
    x, y,
    vx: Math.cos(angle) * PLAYER.bulletSpeed * 0.8,
    vy: Math.sin(angle) * PLAYER.bulletSpeed * 0.8,
    life: PLAYER.bulletLife,
    from: 'police',
    damage,
  });
}

function spark(combat, x, y, color) {
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 40 + Math.random() * 120;
    combat.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3, color });
  }
}

/**
 * Step all bullets and resolve hits.
 *  - player bullets: hurt peds (raise wanted), police cars/units, traffic cars
 *  - police bullets: hurt player and the player's car
 */
export function updateCombat(combat, player, peds, trafficCars, police, city, dt, events) {
  combat.peds = peds; // cached for muzzle-panic in playerShoot

  for (let i = combat.bullets.length - 1; i >= 0; i--) {
    const b = combat.bullets[i];
    const steps = 3; // sub-steps so fast bullets do not tunnel through walls
    let consumed = false;
    for (let s = 0; s < steps && !consumed; s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;

      // Buildings stop everything.
      for (const bl of city.buildings) {
        if (b.x >= bl.x && b.x <= bl.x + bl.w && b.y >= bl.y && b.y <= bl.y + bl.h) {
          spark(combat, b.x, b.y, '#ffd60a');
          consumed = true;
          break;
        }
      }
      if (consumed) break;

      if (b.from === 'player') {
        // Peds
        for (const p of peds) {
          if (p.dead) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) < 10) {
            const killed = damagePed(p, b.damage);
            spark(combat, b.x, b.y, '#e5534b');
            scarePeds(peds, p.x, p.y);
            events.push({ type: 'pedHit', killed });
            player.wanted = Math.min(5, Math.max(player.wanted, killed ? 3 : 2));
            consumed = true;
            break;
          }
        }
        if (consumed) break;
        // Police units and roadblock cars
        for (const u of police.units.concat(...police.roadblocks.map(r => r.cars))) {
          if (u.wrecked) continue;
          if (Math.hypot(u.x - b.x, u.y - b.y) < u.l * 0.4) {
            damagePoliceCar(police, u, b.damage, events);
            spark(combat, b.x, b.y, '#b7d0ff');
            player.wanted = Math.min(5, Math.max(player.wanted, 3));
            consumed = true;
            break;
          }
        }
        if (consumed) break;
        // Traffic cars (angry drivers honk — main.js plays it)
        for (const c of trafficCars) {
          if (c.wrecked || c.driver === 'player') continue;
          if (Math.hypot(c.x - b.x, c.y - b.y) < c.l * 0.4) {
            damageCar(c, b.damage);
            spark(combat, b.x, b.y, '#ffd60a');
            events.push({ type: 'carHit' });
            player.wanted = Math.min(5, Math.max(player.wanted, 1));
            consumed = true;
            break;
          }
        }
      } else {
        // Police bullet vs player (on foot) or the car they drive.
        const target = player.inCar ?? player;
        const r = player.inCar ? player.inCar.l * 0.38 : 10;
        if (!player.dead && Math.hypot(target.x - b.x, target.y - b.y) < r) {
          if (player.inCar) {
            damageCar(player.inCar, b.damage * 0.8);
          } else {
            events.push({ type: 'playerHurt', damage: b.damage });
          }
          spark(combat, b.x, b.y, '#e5534b');
          consumed = true;
          break;
        }
      }
    }

    b.life -= dt;
    if (consumed || b.life <= 0) combat.bullets.splice(i, 1);
  }

  // Sparks (visual only).
  for (let i = combat.sparks.length - 1; i >= 0; i--) {
    const s = combat.sparks[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= 0.9; s.vy *= 0.9;
    s.life -= dt;
    if (s.life <= 0) combat.sparks.splice(i, 1);
  }
}

/** Screen-space to world-space aim point (main.js owns the camera). */
export function aimPoint(screenX, screenY, camera, canvasW, canvasH) {
  return {
    x: (screenX - canvasW / 2) / camera.zoom + camera.x,
    y: (screenY - canvasH / 2) / camera.zoom + camera.y,
  };
}
