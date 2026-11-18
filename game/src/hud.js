// HUD: minimap (city blocks + mission marker + police blips), health bar,
// wanted stars, money, objective text, speedometer while driving, mission
// dialog lines and a large map on M.
import { CITY, FONT, PALETTE, WORLD } from './config.js';

/** Build the HUD state: big-map toggle and a fading flash-message slot. */
export function createHud() {
  return { bigMap: false, flash: 0, flashText: '', flashColor: PALETTE.ok };
}

/** Show a centered flash message for ~3 seconds. */
export function hudFlash(hud, text, color = PALETTE.ok) {
  hud.flash = 3;
  hud.flashText = text;
  hud.flashColor = color;
}

export function updateHud(hud, dt) {
  hud.flash = Math.max(0, hud.flash - dt);
}

/** Main draw call — ctx is already screen-sized. */
export function drawHud(ctx, hud, state, screen) {
  const W = ctx.canvas.width / (window.devicePixelRatio || 1);
  const H = ctx.canvas.height / (window.devicePixelRatio || 1);
  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = 'top';

  drawMinimap(ctx, hud, state, W, H);
  drawVitals(ctx, state, W);
  drawObjective(ctx, state, W);
  drawSpeedo(ctx, state, W, H);
  drawDialog(ctx, state, W, H);
  drawMoney(ctx, state, W);

  // Centered flash message (mission complete, heat dropped, ...).
  if (hud.flash > 0) {
    ctx.globalAlpha = Math.min(1, hud.flash);
    ctx.fillStyle = hud.flashColor;
    ctx.textAlign = 'center';
    ctx.font = `bold 26px ${FONT}`;
    ctx.fillText(hud.flashText, W / 2, 110);
    ctx.globalAlpha = 1;
  }

  if (screen === 'paused') {
    ctx.fillStyle = 'rgba(6,8,14,0.7)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = 'center';
    ctx.font = `bold 42px ${FONT}`;
    ctx.fillText('PAUSED', W / 2, H / 2 - 40);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('Esc to resume', W / 2, H / 2 + 14);
  }
  ctx.restore();
}

/** Flat translucent panel with a 1px neon edge, the HUD's base look. */
function panel(ctx, x, y, w, h) {
  ctx.fillStyle = PALETTE.hud;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PALETTE.hudEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// -------------------------------------------------------------- minimap
// Small corner map by default; M opens an 80%-viewport big map with more
// detail (building footprints, pulsing ring on the mission marker).
function drawMinimap(ctx, hud, state, W, H) {
  const size = hud.bigMap ? Math.min(W, H) * 0.8 : 170;
  const x = hud.bigMap ? (W - size) / 2 : W - size - 16;
  const y = hud.bigMap ? (H - size) / 2 : 16;
  const scale = size / WORLD.width;

  panel(ctx, x, y, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  // City blocks (buildings simplified, only on the big map; dots on small).
  if (hud.bigMap) {
    ctx.fillStyle = PALETTE.sidewalk;
    for (const b of state.city.buildings) {
      ctx.fillRect(x + b.x * scale, y + b.y * scale, Math.max(1, b.w * scale), Math.max(1, b.h * scale));
    }
  } else {
    ctx.fillStyle = PALETTE.wallTop[0];
    for (const b of state.city.buildings) {
      ctx.fillRect(x + b.x * scale, y + b.y * scale, Math.max(1, b.w * scale), Math.max(1, b.h * scale));
    }
  }

  // Mission marker
  const def = state.missions.index < state.missions.list.length && state.missions.state === 'active'
    ? state.missions.list[state.missions.index] : null;
  if (def) {
    const mx = x + def.pos.x * scale;
    const my = y + def.pos.y * scale;
    ctx.fillStyle = PALETTE.marker;
    ctx.beginPath();
    ctx.arc(mx, my, hud.bigMap ? 8 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (hud.bigMap) {
      ctx.strokeStyle = PALETTE.marker;
      ctx.beginPath();
      ctx.arc(mx, my, 14, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Police blips
  ctx.fillStyle = PALETTE.police;
  for (const u of state.police.units) {
    ctx.fillRect(x + u.x * scale - 2, y + u.y * scale - 2, 4, 4);
  }
  if (state.police.heli) {
    ctx.fillStyle = PALETTE.policeStripe;
    ctx.beginPath();
    ctx.arc(x + state.police.heli.x * scale, y + state.police.heli.y * scale, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player
  const px = x + state.player.x * scale;
  const py = y + state.player.y * scale;
  ctx.fillStyle = PALETTE.player;
  ctx.beginPath();
  ctx.arc(px, py, hud.bigMap ? 6 : 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (hud.bigMap) {
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = 'center';
    ctx.font = `14px ${FONT}`;
    ctx.fillText('NEON CITY — district grid (M to close)', x + size / 2, y + size + 8);
  }
}

// --------------------------------------------------------------- vitals
// Health bar (green > 50%, amber > 25%, red below) and five wanted stars.
function drawVitals(ctx, state, W) {
  panel(ctx, 16, 16, 220, 74);
  const hp = Math.max(0, state.player.health / state.player.maxHealth);
  ctx.fillStyle = '#333a4d';
  ctx.fillRect(26, 26, 200, 12);
  ctx.fillStyle = hp > 0.5 ? PALETTE.ok : hp > 0.25 ? PALETTE.marker : PALETTE.danger;
  ctx.fillRect(26, 26, 200 * hp, 12);
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `11px ${FONT}`;
  ctx.fillText(`HEALTH ${Math.ceil(state.player.health)}`, 26, 42);

  for (let star = 0; star < 5; star++) {
    ctx.fillStyle = star < state.player.wanted ? PALETTE.danger : '#333a4d';
    ctx.font = `16px ${FONT}`;
    ctx.fillText('★', 26 + star * 20, 60);
  }
}

// Money counter, directly under the vitals panel.
function drawMoney(ctx, state, W) {
  panel(ctx, 16, 96, 150, 30);
  ctx.fillStyle = PALETTE.ok;
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(`$ ${state.player.money}`, 26, 104);
}

// Objective panel: mission title, one-line brief, and either the countdown
// (reach missions) or the time-left-to-clear (survive missions).
function drawObjective(ctx, state, W) {
  const def = state.missions.index < state.missions.list.length ? state.missions.list[state.missions.index] : null;
  if (!def) {
    if (state.missions.completed.length) {
      ctx.fillStyle = PALETTE.ok;
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillText('Circuit complete — free roam', 16, 134);
    }
    return;
  }
  panel(ctx, 16, 134, Math.min(360, W - 32), 46);
  ctx.fillStyle = PALETTE.marker;
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillText(`MISSION: ${def.title.toUpperCase()}`, 26, 142);
  ctx.fillStyle = PALETTE.text;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(def.brief.slice(0, 56), 26, 160);
  if (state.missions.timer > 0 && def.kind !== 'survive') {
    ctx.fillStyle = state.missions.timer < 20 ? PALETTE.danger : PALETTE.muted;
    ctx.fillText(`${Math.ceil(state.missions.timer)}s`, 330, 160);
  } else if (def.kind === 'survive') {
    const left = Math.max(0, def.time - state.missions.surviveProgress);
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText(`${Math.ceil(left)}s to clear`, 240, 160);
  }
}

// Speedometer, shown only while driving: km/h readout (red past 180) plus a
// thin car-damage sliver under it.
function drawSpeedo(ctx, state, W, H) {
  const car = state.player.inCar;
  if (!car) return;
  const kmh = Math.abs(Math.round(car.speed * 0.6));
  panel(ctx, W - 190, H - 70, 174, 54);
  ctx.fillStyle = kmh > 180 ? PALETTE.danger : PALETTE.hudEdge;
  ctx.font = `bold 30px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillText(String(kmh), W - 70, H - 60);
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `12px ${FONT}`;
  ctx.fillText('km/h', W - 62, H - 52);
  ctx.textAlign = 'left';
  // Damage sliver
  const hp = Math.max(0, car.hp / car.maxHp);
  ctx.fillStyle = '#333a4d';
  ctx.fillRect(W - 180, H - 26, 154, 6);
  ctx.fillStyle = hp > 0.4 ? PALETTE.marker : PALETTE.danger;
  ctx.fillRect(W - 180, H - 26, 154 * hp, 6);
}

// Dialog box at the bottom: speaker name + current line, one at a time.
function drawDialog(ctx, state, W, H) {
  const m = state.missions;
  const line = m.dialogQueue[0];
  if (!line) return;
  const w = Math.min(520, W - 40);
  const h = 58;
  panel(ctx, (W - w) / 2, H - h - 18, w, h);
  ctx.fillStyle = PALETTE.hudEdge;
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillText(line.who, (W - w) / 2 + 14, H - h - 8);
  ctx.fillStyle = PALETTE.text;
  ctx.font = `14px ${FONT}`;
  ctx.fillText(line.text.slice(0, 62), (W - w) / 2 + 14, H - h + 12);
}
