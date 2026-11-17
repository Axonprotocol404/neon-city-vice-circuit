// Renderer: top-down city with fake building height (roofs offset from their
// base toward the screen), cars with bodies/windows/headlights, pedestrians,
// bullets, particles, skid marks, the helicopter's spotlight cone and a smooth
// follow camera that zooms out at speed. Also draws the title/game-over screens.
import { CAMERA, CAR, CITY, FONT, PALETTE, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'gameover';
export const SCREEN_WIN = 'win';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  };
  resize();
  window.addEventListener('resize', resize);

  return {
    ctx,
    canvas,
    draw(state, screen, time) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.width / dpr, H = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      if (screen === SCREEN_TITLE) {
        drawTitle(ctx, state, W, H, time);
        return;
      }
      drawWorld(ctx, state, W, H, time);
      if (state.hud) state.drawHud(ctx, state, W, H);
      if (screen === SCREEN_OVER) drawGameOver(ctx, W, H, state);
      if (screen === SCREEN_WIN) drawWin(ctx, W, H, state);
      if (screen === SCREEN_PAUSED) {
        ctx.fillStyle = 'rgba(6,8,14,0.72)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = PALETTE.text;
        ctx.textAlign = 'center';
        ctx.font = `bold 44px ${FONT}`;
        ctx.fillText('PAUSED', W / 2, H / 2 - 30);
        ctx.fillStyle = PALETTE.muted;
        ctx.font = `15px ${FONT}`;
        ctx.fillText('Esc resume  ·  M map  ·  progress saves automatically', W / 2, H / 2 + 20);
      }
    },
  };
}

// ------------------------------------------------------------------ world
function drawWorld(ctx, state, W, H, time) {
  const cam = state.camera;
  const shake = state.shake > 0 ? (Math.random() - 0.5) * state.shake : 0;
  ctx.save();
  ctx.translate(W / 2 + shake, H / 2 + shake);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  const view = {
    x0: cam.x - W / (2 * cam.zoom) - 120,
    y0: cam.y - H / (2 * cam.zoom) - 120,
    x1: cam.x + W / (2 * cam.zoom) + 120,
    y1: cam.y + H / (2 * cam.zoom) + 120,
  };

  drawGround(ctx, state.city, view);
  drawSkids(ctx, state.skids, view);
  drawMarker(ctx, state, time);
  drawBuildings(ctx, state.city, view, time);
  drawCars(ctx, state, view, time);
  drawPeds(ctx, state.peds, view);
  drawPlayerOnFoot(ctx, state);
  drawBullets(ctx, state.combat, view);
  drawSparks(ctx, state.combat, view);
  drawParticles(ctx, state.particles, view);
  drawHeli(ctx, state.police, time);
  ctx.restore();
  drawVignette(ctx, W, H);
}

function drawGround(ctx, city, view) {
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  const { roadW, sidewalk } = CITY;
  ctx.fillStyle = PALETTE.sidewalk;
  for (const line of city.roads) {
    if (line < view.y0 - 200 || line > view.y1 + 200) continue;
    ctx.fillRect(0, line - roadW / 2 - sidewalk, WORLD.width, roadW + sidewalk * 2);
  }
  for (const line of city.roads) {
    if (line < view.x0 - 200 || line > view.x1 + 200) continue;
    ctx.fillRect(line - roadW / 2 - sidewalk, 0, roadW + sidewalk * 2, WORLD.height);
  }

  for (const p of city.parks) {
    if (p.x > view.x1 || p.x + p.w < view.x0 || p.y > view.y1 || p.y + p.h < view.y0) continue;
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    if (p.pond) {
      ctx.fillStyle = PALETTE.water;
      ctx.beginPath();
      ctx.ellipse(p.x + p.w * 0.5, p.y + p.h * 0.55, p.w * 0.22, p.h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = PALETTE.tree;
  for (const t of city.trees) {
    if (t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1) continue;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lane dashes
  ctx.strokeStyle = PALETTE.roadLine;
  ctx.lineWidth = 3;
  ctx.setLineDash([18, 26]);
  ctx.beginPath();
  for (const line of city.roads) {
    if (line >= view.y0 - 100 && line <= view.y1 + 100) {
      ctx.moveTo(view.x0, line);
      ctx.lineTo(view.x1, line);
    }
    if (line >= view.x0 - 100 && line <= view.x1 + 100) {
      ctx.moveTo(line, view.y0);
      ctx.lineTo(line, view.y1);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Crosswalk stripes at visible intersections.
  ctx.fillStyle = 'rgba(220,226,240,0.18)';
  for (const gx of city.roads) {
    if (gx < view.x0 - 60 || gx > view.x1 + 60) continue;
    for (const gy of city.roads) {
      if (gy < view.y0 - 60 || gy > view.y1 + 60) continue;
      for (let s = -3; s <= 3; s++) {
        ctx.fillRect(gx + s * 10 - 3, gy - CITY.roadW / 2 - 4, 6, 16);
        ctx.fillRect(gx - CITY.roadW / 2 - 4, gy + s * 10 - 3, 16, 6);
      }
    }
  }
}

function drawSkids(ctx, skids, view) {
  ctx.strokeStyle = PALETTE.skid;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const s of skids) {
    if (s.x < view.x0 || s.x > view.x1 || s.y < view.y0 || s.y > view.y1) continue;
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(s.a) * 6, s.y + Math.sin(s.a) * 6);
  }
  ctx.stroke();
}

function drawBuildings(ctx, city, view, time) {
  for (const b of city.buildings) {
    if (b.x > view.x1 || b.x + b.w < view.x0 || b.y > view.y1 || b.y + b.h < view.y0) continue;

    // Shadow thrown to the south-east.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(b.x + b.height * 0.18, b.y + b.height * 0.12, b.w, b.h);

    // Base footprint (visible where the roof is offset away).
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);

    // Roof lifted north by the fake height.
    ctx.fillStyle = b.top;
    ctx.fillRect(b.x, b.y - b.height, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y - b.height, b.w, b.h);

    // Window lights on the roof face, gently flickering.
    ctx.fillStyle = 'rgba(255,214,10,0.6)';
    const cols = Math.floor(b.w / 24), rows = Math.floor(b.h / 24);
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const seed = (i * 7 + j * 13 + Math.floor(b.x / 10)) % 11;
        if (seed !== 0 && seed !== 5) continue;
        ctx.globalAlpha = 0.25 + 0.15 * Math.sin(time * 0.7 + i + j);
        ctx.fillRect(b.x + 8 + i * 24, b.y - b.height + 8 + j * 24, 9, 9);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Neon signs floating above facades.
  for (const s of city.neonSigns) {
    if (s.x < view.x0 || s.x > view.x1 || s.y < view.y0 - 40 || s.y > view.y1 + 60) continue;
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = s.color;
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText(s.text, s.x, s.y - 10);
    ctx.restore();
  }
}

function drawMarker(ctx, state, time) {
  const m = state.missions;
  const def = m.index < m.list.length ? m.list[m.index] : null;
  if (!def || m.state !== 'active') return;
  const pulse = 1 + Math.sin(time * 4) * 0.15;
  ctx.save();
  ctx.strokeStyle = PALETTE.marker;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(def.pos.x, def.pos.y, 34 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = PALETTE.marker;
  ctx.beginPath();
  ctx.arc(def.pos.x, def.pos.y, 34 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const g = ctx.createLinearGradient(def.pos.x, def.pos.y, def.pos.x, def.pos.y - 160);
  g.addColorStop(0, 'rgba(255,214,10,0.35)');
  g.addColorStop(1, 'rgba(255,214,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(def.pos.x - 20, def.pos.y - 160, 40, 160);
  ctx.restore();
}

// ------------------------------------------------------------------- cars
function drawCars(ctx, state, view, time) {
  const list = [...state.traffic, ...state.police.units];
  for (const rb of state.police.roadblocks) {
    for (const c of rb.cars) drawCar(ctx, c, time, false);
  }
  for (const c of list) {
    if (c.x < view.x0 - 100 || c.x > view.x1 + 100 || c.y < view.y0 - 100 || c.y > view.y1 + 100) continue;
    if (state.player.inCar === c) continue;
    drawCar(ctx, c, time, false);
  }
  if (state.player.inCar) drawCar(ctx, state.player.inCar, time, true);
}

export function drawCar(ctx, c, time, isPlayer) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.angle);
  const w = c.w, l = c.l;

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(-l / 2 + 4, -w / 2 + 5, l, w);

  ctx.fillStyle = c.wrecked ? '#3a3a42' : c.color;
  roundRect(ctx, -l / 2, -w / 2, l, w, 7);
  ctx.fill();

  ctx.fillStyle = 'rgba(10,14,24,0.72)';
  roundRect(ctx, -l * 0.14, -w / 2 + 5, l * 0.38, w - 10, 4);
  ctx.fill();

  if (!c.wrecked) {
    ctx.fillStyle = 'rgba(255,246,200,0.9)';
    ctx.fillRect(l / 2 - 4, -w / 2 + 4, 4, 7);
    ctx.fillRect(l / 2 - 4, w / 2 - 11, 4, 7);
    ctx.fillStyle = 'rgba(255,45,120,0.8)';
    ctx.fillRect(-l / 2, -w / 2 + 4, 3, 6);
    ctx.fillRect(-l / 2, w / 2 - 10, 3, 6);
  }

  if (c.kind === 'patrol' && !c.wrecked) {
    ctx.fillStyle = PALETTE.policeStripe;
    ctx.fillRect(-l * 0.3, -w / 2, l * 0.16, w);
    const blink = Math.sin(time * 14) > 0;
    ctx.fillStyle = blink ? '#ff2d78' : '#3982ff';
    ctx.fillRect(-4, -w / 2 - 3, 8, w + 6);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = blink ? '#ff2d78' : '#3982ff';
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (isPlayer) {
    ctx.strokeStyle = PALETTE.player;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, l * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawPlayerOnFoot(ctx, state) {
  const p = state.player;
  if (p.inCar || p.dead) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(2, 4, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(p.angle + Math.PI / 2);
  const hurt = p.hurtTimer > 0 ? '#ff8a8a' : PALETTE.player;
  ctx.fillStyle = hurt;
  roundRect(ctx, -5, -7, 10, 14, 4);
  ctx.fill();
  ctx.fillStyle = '#f0e6d2';
  ctx.beginPath();
  ctx.arc(0, -3, 3.6, 0, Math.PI * 2);
  ctx.fill();
  const swing = Math.sin(p.walkAnim) * 3;
  ctx.strokeStyle = hurt;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, 1); ctx.lineTo(-8, 1 + swing);
  ctx.moveTo(5, 1); ctx.lineTo(8, 1 - swing);
  ctx.stroke();
  ctx.restore();

  if (state.aim) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,229,255,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(state.aim.x, state.aim.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawPeds(ctx, peds, view) {
  for (const p of peds) {
    if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.dead) {
      ctx.globalAlpha = Math.min(1, Math.max(0.15, p.deadTimer / 4));
      ctx.fillStyle = '#4a4350';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 6, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.rotate(p.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-4, -3, 8, 9);
    ctx.fillStyle = p.flee > 0 ? '#f0b0b0' : PALETTE.ped;
    roundRect(ctx, -3.5, -6, 7, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#d8c7a8';
    ctx.beginPath();
    ctx.arc(0, -4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawBullets(ctx, combat, view) {
  for (const b of combat.bullets) {
    if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
    ctx.fillStyle = PALETTE.bullet;
    ctx.fillRect(b.x - 2, b.y - 2, 5, 5);
    ctx.globalAlpha = 0.4;
    ctx.fillRect(b.x - b.vx * 0.012, b.y - b.vy * 0.012, 9, 1.5);
    ctx.globalAlpha = 1;
  }
}

function drawSparks(ctx, combat, view) {
  for (const s of combat.sparks) {
    if (s.x < view.x0 || s.x > view.x1 || s.y < view.y0 || s.y > view.y1) continue;
    ctx.globalAlpha = Math.max(0, s.life / 0.3);
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}

function drawParticles(ctx, particles, view) {
  for (const p of particles) {
    if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife) * (p.alpha ?? 1);
    ctx.fillStyle = p.color;
    if (p.kind === 'smoke') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - p.life / p.maxLife), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
}

function drawHeli(ctx, police, time) {
  const h = police.heli;
  if (!h) return;
  const cone = ctx.createRadialGradient(h.x, h.y, 6, h.x, h.y, 150);
  cone.addColorStop(0, 'rgba(255,255,210,0.30)');
  cone.addColorStop(0.55, PALETTE.spotlight);
  cone.addColorStop(1, 'rgba(255,255,210,0)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.arc(h.x, h.y, 150, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(h.x - 40, h.y - 40);
  ctx.fillStyle = '#1b2233';
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8fa4c8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-24, 0); ctx.lineTo(24, 0);
  ctx.moveTo(0, -24); ctx.lineTo(0, 24);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,220,255,0.5)';
  const r = 18 + Math.sin(time * 20) * 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, time * 8, time * 8 + Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
}

function drawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(4,6,12,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- screens
function drawTitle(ctx, state, W, H, time) {
  ctx.fillStyle = '#0a0c14';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 14; i++) {
    const y = H * 0.55 + i * i * 3.2;
    if (y > H) break;
    ctx.strokeStyle = `rgba(255,45,120,${0.28 - i * 0.018})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let i = -10; i <= 10; i++) {
    ctx.strokeStyle = 'rgba(0,229,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 40, H * 0.55);
    ctx.lineTo(W / 2 + i * 220, H);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.save();
  ctx.shadowColor = '#ff2d78';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#ff2d78';
  ctx.font = `bold ${Math.min(76, W * 0.09)}px ${FONT}`;
  ctx.fillText('NEON CITY', W / 2, H * 0.30);
  ctx.shadowColor = '#00e5ff';
  ctx.fillStyle = '#00e5ff';
  ctx.font = `bold ${Math.min(34, W * 0.042)}px ${FONT}`;
  ctx.fillText('V I C E   C I R C U I T', W / 2, H * 0.30 + Math.min(58, W * 0.07));
  ctx.restore();

  ctx.fillStyle = PALETTE.text;
  ctx.font = `16px ${FONT}`;
  ctx.fillText('A top-down neon-noir crime sandbox', W / 2, H * 0.30 + Math.min(100, W * 0.10));

  if (Math.sin(time * 3) > -0.2) {
    ctx.fillStyle = PALETTE.marker;
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillText('PRESS  ENTER  /  CLICK  TO  DRIVE', W / 2, H * 0.62);
  }
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `13px ${FONT}`;
  const save = state.save;
  const lines = [
    'WASD walk & drive  ·  F enter / exit car  ·  Click shoot  ·  Space handbrake  ·  M map  ·  Esc pause',
    save
      ? `Saved run: $${save.money ?? 0}  ·  mission ${Math.min(6, (save.index ?? 0) + 1)}/6  ·  seed ${state.city ? state.city.seed : 0}`
      : `Fresh circuit  ·  seed ${state.city ? state.city.seed : 0}`,
  ];
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.78 + i * 22));
}

function drawGameOver(ctx, W, H, state) {
  ctx.fillStyle = 'rgba(10,4,10,0.78)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.danger;
  ctx.font = `bold 54px ${FONT}`;
  ctx.fillText('WASTED', W / 2, H / 2 - 50);
  ctx.fillStyle = PALETTE.text;
  ctx.font = `17px ${FONT}`;
  ctx.fillText(`The clinic kept most of your money: $${state.player.money}`, W / 2, H / 2 + 10);
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `14px ${FONT}`;
  ctx.fillText('Press Enter to respawn', W / 2, H / 2 + 46);
}

function drawWin(ctx, W, H, state) {
  ctx.fillStyle = 'rgba(4,10,8,0.75)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.ok;
  ctx.font = `bold 46px ${FONT}`;
  ctx.fillText('CIRCUIT COMPLETE', W / 2, H / 2 - 40);
  ctx.fillStyle = PALETTE.text;
  ctx.font = `16px ${FONT}`;
  ctx.fillText(`You own the night: $${state.player.money}`, W / 2, H / 2 + 12);
  ctx.fillStyle = PALETTE.muted;
  ctx.fillText('Keep roaming — the city is yours', W / 2, H / 2 + 44);
}

// ---------------------------------------------------------------- helpers
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Camera follow with a zoom that pulls back as the car gains speed. */
export function updateCamera(cam, target, car, dt) {
  const lead = car ? 60 : 0;
  const ratio = car ? Math.min(1, Math.abs(car.speed) / 300) : 0;
  const tx = target.x + (car ? Math.cos(car.angle) * lead * ratio : 0);
  const ty = target.y + (car ? Math.sin(car.angle) * lead * ratio : 0);
  const k = 1 - Math.exp(-CAMERA.lerp * dt);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  const speedRatio = car ? Math.min(1, Math.abs(car.speed) / CAR.types.sport.speed) : 0;
  const wantZoom = CAR.zoomBase + (CAR.zoomFast - CAR.zoomBase) * speedRatio;
  cam.zoom += (wantZoom - cam.zoom) * (1 - Math.exp(-CAMERA.zoomLerp * dt));
}
