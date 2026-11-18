// Combat: the player fires toward the mouse cursor (click), bullets travel,
// hit peds / police / traffic / buildings, and every impact feeds back into
// health, wanted level and panic.
import { COMBAT, PLAYER } from './config.js';
import { damageCar } from './car.js';
import { damagePed, scarePeds } from './peds.js';
import { damagePoliceCar } from './police.js';

/** How many sub-steps each bullet takes per frame so fast shots don't tunnel. */
const BULLET_SUBSTEPS = 3;

/** Build the combat container: live bullets and short-lived impact sparks. */
export function createCombat() {
  return { bullets: [], sparks: [] };
}

/** Fire a bullet from the player toward a world-space aim point. */
export function playerShoot(combat, player, aimX, aimY, events) {
  if (player.fireCooldown > 0 || player.dead) return false;
  player.fireCooldown = PLAYER.shootCooldown;
  const dx = aimX - player.x;
  const dy = aimY - player.y;
  const dist = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  // Muzzle offset a bit in front of the body (or car nose).
  const muzzle = player.inCar
    ? {
        x: player.inCar.x + Math.cos(player.inCar.angle) * (player.inCar.l / 2),
        y: player.inCar.y + Math.sin(player.inCar.angle) * (player.inCar.l / 2),
      }
    : { x: player.x + Math.cos(angle) * 14, y: player.y + Math.sin(angle) * 14 };
  combat.bullets.push({
    x: muzzle.x,
    y: muzzle.y,
    vx: Math.cos(angle) * PLAYER.bulletSpeed,
    vy: Math.sin(angle) * PLAYER.bulletSpeed,
    life: PLAYER.bulletLife,
    from: 'player',
    damage: PLAYER.bulletDamage,
  });
  events.push({ type: 'shot', x: muzzle.x, y: muzzle.y, angle });
  scarePeds(combat.peds ?? [], muzzle.x, muzzle.y);
  return true;
}

/** A police bullet spawned by police.js events. */
export function policeShoot(combat, x, y, angle, damage) {
  combat.bullets.push({
    x,
    y,
    vx: Math.cos(angle) * PLAYER.bulletSpeed * 0.8,
    vy: Math.sin(angle) * PLAYER.bulletSpeed * 0.8,
    life: PLAYER.bulletLife,
    from: 'police',
    damage,
  });
}

/** Spawn a small radial burst of impact sparks (visual only). */
function spark(combat, x, y, color) {
  for (let i = 0; i < 5; i++) {
    const spread = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 120;
    combat.sparks.push({ x, y, vx: Math.cos(spread) * speed, vy: Math.sin(spread) * speed, life: 0.3, color });
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
    const bullet = combat.bullets[i];
    let consumed = false;
    for (let step = 0; step < BULLET_SUBSTEPS && !consumed; step++) {
      bullet.x += (bullet.vx * dt) / BULLET_SUBSTEPS;
      bullet.y += (bullet.vy * dt) / BULLET_SUBSTEPS;

      // Buildings stop everything.
      for (const bl of city.buildings) {
        if (bullet.x >= bl.x && bullet.x <= bl.x + bl.w && bullet.y >= bl.y && bullet.y <= bl.y + bl.h) {
          spark(combat, bullet.x, bullet.y, '#ffd60a');
          consumed = true;
          break;
        }
      }
      if (consumed) break;

      if (bullet.from === 'player') {
        // Peds
        for (const p of peds) {
          if (p.dead) continue;
          if (Math.hypot(p.x - bullet.x, p.y - bullet.y) < 10) {
            const killed = damagePed(p, bullet.damage);
            spark(combat, bullet.x, bullet.y, '#e5534b');
            scarePeds(peds, p.x, p.y);
            events.push({ type: 'pedHit', killed });
            player.wanted = Math.min(5, Math.max(player.wanted, killed ? 3 : 2));
            consumed = true;
            break;
          }
        }
        if (consumed) break;
        // Police units and roadblock cars
        const policeTargets = police.units.concat(...police.roadblocks.map((rb) => rb.cars));
        for (const unit of policeTargets) {
          if (unit.wrecked) continue;
          if (Math.hypot(unit.x - bullet.x, unit.y - bullet.y) < unit.l * 0.4) {
            damagePoliceCar(police, unit, bullet.damage, events);
            spark(combat, bullet.x, bullet.y, '#b7d0ff');
            player.wanted = Math.min(5, Math.max(player.wanted, 3));
            consumed = true;
            break;
          }
        }
        if (consumed) break;
        // Traffic cars (angry drivers honk — main.js plays it)
        for (const car of trafficCars) {
          if (car.wrecked || car.driver === 'player') continue;
          if (Math.hypot(car.x - bullet.x, car.y - bullet.y) < car.l * 0.4) {
            damageCar(car, bullet.damage);
            spark(combat, bullet.x, bullet.y, '#ffd60a');
            events.push({ type: 'carHit' });
            player.wanted = Math.min(5, Math.max(player.wanted, 1));
            consumed = true;
            break;
          }
        }
      } else {
        // Police bullet vs player (on foot) or the car they drive.
        const target = player.inCar ?? player;
        const hitRadius = player.inCar ? player.inCar.l * 0.38 : 10;
        if (!player.dead && Math.hypot(target.x - bullet.x, target.y - bullet.y) < hitRadius) {
          if (player.inCar) {
            damageCar(player.inCar, bullet.damage * 0.8);
          } else {
            events.push({ type: 'playerHurt', damage: bullet.damage });
          }
          spark(combat, bullet.x, bullet.y, '#e5534b');
          consumed = true;
          break;
        }
      }
    }

    bullet.life -= dt;
    if (consumed || bullet.life <= 0) combat.bullets.splice(i, 1);
  }

  // Sparks (visual only).
  for (let i = combat.sparks.length - 1; i >= 0; i--) {
    const sparkDot = combat.sparks[i];
    sparkDot.x += sparkDot.vx * dt;
    sparkDot.y += sparkDot.vy * dt;
    sparkDot.vx *= 0.9;
    sparkDot.vy *= 0.9;
    sparkDot.life -= dt;
    if (sparkDot.life <= 0) combat.sparks.splice(i, 1);
  }
}

/** Screen-space to world-space aim point (main.js owns the camera). */
export function aimPoint(screenX, screenY, camera, canvasW, canvasH) {
  return {
    x: (screenX - canvasW / 2) / camera.zoom + camera.x,
    y: (screenY - canvasH / 2) / camera.zoom + camera.y,
  };
}
