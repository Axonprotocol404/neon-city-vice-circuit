// =============================================================================
// Neon City: Vice Circuit — boot, fixed-timestep loop, input, save/load
// =============================================================================
// Screens: title -> play -> gameover/win. ?seed=N fixes the city; ?shot=start|
// play|city|mission stages a deterministic scene for screenshots.
//
// LOOP SHAPE: a fixed-timestep accumulator runs stepWorld() at exactly 60 Hz
// (STEP) regardless of display refresh; rendering happens once per animation
// frame. Systems push typed events into `events`, which handleEvents() maps
// to audio, HUD flashes, particles, shake, mission chaining and transitions.
import { MONEY_START, PALETTE, SAVE_INTERVAL, SAVE_KEY, STEP } from './config.js';
import { createCity, createRandom } from './city.js';
import { createPlayer, damagePlayer, enterCar, exitCar, playerLoad, playerSave, updatePlayer, walkPlayer } from './player.js';
import { bounceCars, carsOverlap, createCar, updateCar } from './car.js';
import { createTraffic, updateTraffic } from './traffic.js';
import { createPeds, recyclePeds, scareFromWanted, updatePeds } from './peds.js';
import { createPolice, updatePolice } from './police.js';
import { createMissions, missionsLoad, missionsSave, skipDialog, startMission, updateMissions } from './missions.js';
import { aimPoint, createCombat, playerShoot, policeShoot, updateCombat } from './combat.js';
import { createHud, drawHud, hudFlash, updateHud } from './hud.js';
import { SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN, createRenderer, updateCamera } from './render.js';
import { createAudio } from './audio.js';

/** Clamp the integration step so a lagging tab can't fast-forward the world. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 1337;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const audio = createAudio();

// ------------------------------------------------------------- input
// Keyboard/mouse state. `keys` is held state, `pressed` is a one-frame edge
// queue consumed via takePress, and the mouse tracks position + a queued click.
function createInput() {
  const keys = new Set();
  const pressed = new Set();
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  let clickQueued = false;
  const KEYMAP = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'hand', KeyF: 'enter', KeyM: 'map', Escape: 'pause', Enter: 'confirm',
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (k) {
      e.preventDefault();
      if (!keys.has(k)) pressed.add(k);
      keys.add(k);
    }
    audio.resume();
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) keys.delete(k);
  });
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
  });
  canvas.addEventListener('mousedown', (e) => {
    audio.resume();
    mouseDown = true;
    clickQueued = true;
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  return {
    axis() {
      return {
        x: (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0),
        y: (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0),
      };
    },
    held: (k) => keys.has(k),
    takePress: (k) => {
      if (pressed.has(k)) { pressed.delete(k); return true; }
      return false;
    },
    mouse() { return { x: mouseX, y: mouseY, down: mouseDown, click: clickQueued }; },
    consumeClick() { clickQueued = false; },
    endFrame() { pressed.clear(); clickQueued = false; },
  };
}

// ------------------------------------------------------------- save/load
// localStorage JSON under SAVE_KEY; every failure (private mode, quota) is
// swallowed so the game never breaks on a read-only environment.
function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeSave(data) {
  try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

// ------------------------------------------------------------- world state
// Build a fresh world from the seed: city, player, traffic, peds, police,
// missions, combat, HUD and the player's starter car.
function buildWorld() {
  const city = createCity(seed);
  const player = createPlayer(city, city.spawn.x, city.spawn.y);
  player.money = MONEY_START;

  const rnd = createRandom(seed ^ 0xc0ffee);
  const traffic = createTraffic(city, seed);
  const peds = createPeds(city, seed);
  const police = createPolice(city);
  const missions = createMissions(city);
  const combat = createCombat();
  const hud = createHud();

  // Player's starter sedan parked nearby.
  const starter = createCar('sport', city.spawn.x + 90, city.spawn.y + 40, -Math.PI / 2, PALETTE.sport, null, city);
  const cars = [starter];

  const state = {
    seed, city, player, traffic, peds, police, missions, combat, hud, cars,
    camera: { x: player.x, y: player.y, zoom: 1 },
    skids: [],
    particles: [],
    shake: 0,
    aim: null,
    time: 0,
    save: null,
    drawHud: null,
  };
  return state;
}

function restoreSave(state, save) {
  playerLoad(state.player, save);
  missionsLoad(state.missions, save.missions);
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
}

/** Flat JSON snapshot: player stats + mission progress + the fixed seed. */
function snapshotSave(state) {
  return {
    ...playerSave(state.player),
    missions: missionsSave(state.missions),
    seed: state.seed,
  };
}

// ------------------------------------------------------------- effects
// Skid marks: capped ring buffer (shift oldest past 400).
function addSkid(state, x, y, angle) {
  state.skids.push({ x, y, a: angle });
  if (state.skids.length > 400) state.skids.shift();
}

// Particles: sparks (short, small) or smoke (long, big), capped at 300.
function addParticles(state, x, y, color, count, kind = 'spark') {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 30 + Math.random() * 130;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: kind === 'smoke' ? 1.4 : 0.4,
      maxLife: kind === 'smoke' ? 1.4 : 0.4,
      size: kind === 'smoke' ? 8 : 3,
      color,
      kind,
    });
  }
  if (state.particles.length > 300) state.particles.splice(0, state.particles.length - 300);
}

// Drift particles: damped velocity + shrinking life, removed when dead.
function updateParticles(state, dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

// ------------------------------------------------------------- events
// Event pump: systems push typed events; here they map to audio, HUD flashes,
// particles, screen shake, mission chaining and screen transitions.
function handleEvents(state, events, screenCtl) {
  for (const ev of events) {
    switch (ev.type) {
      case 'shot':
        addParticles(state, ev.x, ev.y, PALETTE.bullet, 3);
        audio.shot();
        state.shake = Math.max(state.shake, 3);
        break;
      case 'policeShoot':
        policeShoot(state.combat, ev.x, ev.y, ev.angle, ev.damage);
        audio.policeShot();
        break;
      case 'playerHurt':
        damagePlayer(state.player, ev.damage);
        audio.hurt();
        state.shake = Math.max(state.shake, 5);
        break;
      case 'pedHit':
        if (ev.killed) { audio.hit(); hudFlash(state.hud, 'WITNESS PANIC', PALETTE.danger); }
        break;
      case 'carHit':
        audio.hit();
        break;
      case 'copDown':
        audio.explosion();
        addParticles(state, state.player.x, state.player.y, '#3982ff', 10);
        break;
      case 'missionComplete':
        audio.mission();
        hudFlash(state.hud, `MISSION COMPLETE  +$${ev.reward}`, PALETTE.ok);
        status.textContent = `Mission complete. Reward $${ev.reward}.`;
        // Chain: start the next mission after a beat.
        setTimeout(() => { if (screenCtl.playing()) startMission(state.missions, state.player); }, 2500);
        break;
      case 'missionFail':
        audio.fail();
        hudFlash(state.hud, 'MISSION FAILED — RESTARTING', PALETTE.danger);
        setTimeout(() => { if (screenCtl.playing()) startMission(state.missions, state.player); }, 2000);
        break;
      case 'evade':
        audio.blip();
        hudFlash(state.hud, `HEAT DROPPED (${ev.stars}★)`, PALETTE.ok);
        break;
      case 'heliIn':
        hudFlash(state.hud, 'AIR UNIT DEPLOYED', PALETTE.danger);
        break;
      case 'storyEnd':
        screenCtl.win();
        break;
      default:
        break;
    }
  }
}

// ------------------------------------------------------------- step
// One fixed STEP of simulation: movement/driving, shooting, key presses, then
// every system (traffic, peds, police, combat, missions, particles, HUD,
// audio ambience, camera), mission auto-start proximity, and death check.
function stepWorld(state, input, events) {
  const p = state.player;
  const car = p.inCar;
  state.time += STEP;

  // Movement / driving
  const axis = input.axis();
  if (car && !car.wrecked) {
    car.throttle = axis.y < 0 ? 1 : axis.y > 0 ? 0 : 0;
    if (axis.y > 0 && car.speed > 1) { car.brake = true; }
    else if (axis.y > 0) { car.throttle = 0.5; car.brake = false; }
    else { car.brake = false; }
    if (axis.y < 0) car.throttle = 1;
    car.steer = axis.x;
    car.handbrake = input.held('hand');
    const impact = updateCar(car, STEP);
    if (impact && impact.speed > 200) {
      audio.crash();
      state.shake = Math.max(state.shake, 6);
      addParticles(state, car.x, car.y, '#ffd60a', 6);
    }
    p.x = car.x;
    p.y = car.y;
    // Skid marks while drifting
    if (car.skidTimer > 0) {
      addSkid(state, car.x - Math.cos(car.angle) * car.l * 0.3, car.y - Math.sin(car.angle) * car.l * 0.3, car.angle);
      addSkid(state, car.x + Math.cos(car.angle) * car.l * 0.3, car.y + Math.sin(car.angle) * car.l * 0.3, car.angle + Math.PI);
    }
    // Smoke when damaged
    if (car.hp < car.maxHp * 0.35 && Math.random() < 0.3) {
      addParticles(state, car.x, car.y, 'rgba(90,90,100,0.6)', 1, 'smoke');
    }
  } else {
    walkPlayer(p, axis.x, axis.y, STEP);
    updateCar(stillNearbyCar(state, p), STEP);
  }

  // Shooting
  const m = input.mouse();
  const aim = aimPoint(m.x, m.y, state.camera, window.innerWidth, window.innerHeight);
  state.aim = aim;
  if ((m.down || m.click) && !p.dead) {
    if (playerShoot(state.combat, p, aim.x, aim.y, events)) input.consumeClick();
  } else {
    input.consumeClick();
  }

  // Presses
  if (input.takePress('enter')) {
    if (car) { exitCar(p); audio.blip(); }
    else {
      const got = enterCar(p, [...state.cars, ...state.traffic, ...state.police.units]);
      if (got) { audio.confirm(); audio.startEngine(); if (got.driver === 'player' && got.isPolice) got.isPolice = false; }
    }
  }
  if (input.takePress('map')) {
    state.hud.bigMap = !state.hud.bigMap;
    audio.blip();
  }
  if (input.takePress('pause')) return 'pause';
  if (m.click && state.missions.dialogQueue.length && Math.random() < 0.02) skipDialog(state.missions);

  // Systems
  updatePlayer(p, STEP);
  updateTraffic(state.traffic, state.city, car, state.peds, STEP);
  updatePeds(state.peds, state.city, p, p.wanted, STEP);
  recyclePeds(state.peds, state.city, createRandom(state.seed + Math.floor(state.time)));
  scareFromWanted(state.peds, p.x, p.y, p.wanted);

  updatePolice(state.police, p, state.traffic, null, STEP, events);
  // Police unit physics (chase driving is integrated in police.js AI).
  for (const u of state.police.units) {
    if (u.wrecked) continue;
    const impact = updateCar(u, STEP);
    if (impact && impact.speed > 220) audio.crash();
  }
  for (const rb of state.police.roadblocks) {
    for (const c of rb.cars) { c.throttle = 0; c.brake = true; updateCar(c, STEP); }
  }

  // Traffic physics step for AI cars (traffic.js moved them; collisions here).
  for (const t of state.traffic) {
    if (t.wrecked || t.driver !== 'traffic') continue;
    t.throttle = 0;
    updateCar(t, STEP);
    if (t.hp < t.maxHp * 0.4 && Math.random() < 0.1) addParticles(state, t.x, t.y, 'rgba(90,90,100,0.5)', 1, 'smoke');
  }

  // Car-vs-car interactions (player vs everything).
  if (car && !car.wrecked) {
    for (const other of [...state.traffic, ...state.police.units]) {
      if (other === car || other.wrecked) continue;
      if (carsOverlap(car, other)) {
        bounceCars(car, other);
        audio.crash();
        state.shake = Math.max(state.shake, 5);
        if (other.isPolice) p.wanted = Math.min(5, Math.max(p.wanted, 2));
      }
    }
  }

  updateCombat(state.combat, p, state.peds, state.traffic, state.police, state.city, STEP, events);
  updateMissions(state.missions, p, STEP, events);
  updateParticles(state, STEP);
  updateHud(state.hud, STEP);

  // Wanted-level ambience + audio
  audio.setSiren(p.wanted >= 2 && state.police.units.length > 0);
  audio.updateEngine(car ? Math.min(1, Math.abs(car.speed) / car.maxSpeed) : 0, Boolean(car));

  // Camera + screen shake decay
  updateCamera(state.camera, p, car, STEP);
  state.shake = Math.max(0, state.shake - STEP * 14);

  // Mission trigger proximity: auto-start when idle and the player walks free.
  if (state.missions.state === 'idle' && state.missions.index < state.missions.list.length && !p.dead) {
    const def = state.missions.list[state.missions.index];
    if (Math.hypot(def.pos.x - p.x, def.pos.y - p.y) < 3000) startMission(state.missions, p);
  }

  // Death
  if (p.dead) return 'dead';
  return null;
}

/** A parked car near the player to keep physics alive (pushable on contact). */
function stillNearbyCar(state, p) {
  for (const c of state.cars) {
    if (c.driver === 'player') continue;
    if (Math.hypot(c.x - p.x, c.y - p.y) < 400) return c;
  }
  return state.cars[0];
}

// ------------------------------------------------------------- shot staging
// Deterministic scenes for screenshots: ?shot=start (title), city (overview
// driving fast), play|mission (chase with heat, patrols, heli, marker).
const CITY_LANE = 22;

function stageShot(name, state) {
  const p = state.player;
  if (name === 'start') return { screen: SCREEN_TITLE, time: 0 };
  if (name === 'city') {
    // Overview: drop the player into the starter car mid-speed on a road.
    const car = state.cars[0];
    car.driver = 'player';
    p.inCar = car;
    car.x = state.city.roads[4] + 60;
    car.y = state.city.roads[4] + 300;
    car.speed = 380;
    car.angle = -Math.PI / 2;
    p.x = car.x;
    p.y = car.y;
    state.camera.x = car.x;
    state.camera.y = car.y;
    state.camera.zoom = 0.8;
    return { screen: SCREEN_PLAY, time: 1.2 };
  }
  if (name === 'play' || name === 'mission') {
    // Chase scene: player driving with heat, police in pursuit, mission marker.
    const car = state.cars[0];
    car.driver = 'player';
    p.inCar = car;
    car.x = state.city.roads[3] + CITY_LANE;
    car.y = state.city.roads[3] + 260;
    car.speed = 240;
    car.angle = 0;
    p.x = car.x;
    p.y = car.y;
    p.wanted = 3;
    state.camera.x = car.x;
    state.camera.y = car.y;
    const first = state.missions.list[2]; // delivery: a marker across town
    state.missions.index = 2;
    state.missions.state = 'active';
    state.missions.dialogQueue = first.dialog.slice();
    state.missions.dialogTimer = 5;
    // Two patrols mid-chase.
    for (const off of [-320, 420]) {
      const u = createCar('patrol', car.x + off, car.y + 90, 0, PALETTE.police, 'police', state.city);
      u.isPolice = true;
      u.siren = true;
      state.police.units.push(u);
    }
    state.police.heli = { x: car.x + 180, y: car.y - 260, angle: 0.6, rotor: 0 };
    return { screen: SCREEN_PLAY, time: 1.0 };
  }
  return { screen: SCREEN_PLAY, time: 0 };
}

// ------------------------------------------------------------- boot
// Main game loop: fixed-timestep accumulator over stepWorld, autosave every
// SAVE_INTERVAL seconds, title/gameover/pause transitions wired to input.
function runGame() {
  const state = buildWorld();
  const input = createInput();
  state.save = readSave();
  state.drawHud = (ctx, s, W, H) => drawHud(ctx, s.hud, s, W, H);

  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;
  const events = [];
  const screenCtl = {
    playing: () => screen === SCREEN_PLAY,
    win: () => { screen = SCREEN_WIN; writeSave(snapshotSave(state)); },
  };

  /** Title -> play: restore save if any, refill health, start audio. */
  function begin() {
    if (state.save) restoreSave(state, state.save);
    state.player.dead = false;
    state.player.health = state.player.maxHealth;
    screen = SCREEN_PLAY;
    audio.resume();
    audio.startEngine();
    audio.confirm();
    status.textContent = 'Playing. WASD to move, F to enter a car, follow the gold marker.';
  }

  /** Gameover -> play: respawn at the clinic with 80% money kept, heat cleared. */
  function respawn() {
    state.player.dead = false;
    state.player.health = state.player.maxHealth;
    state.player.wanted = 0;
    state.player.money = Math.floor(state.player.money * 0.8);
    exitCarSafe(state);
    state.player.x = state.city.spawn.x;
    state.player.y = state.city.spawn.y;
    state.camera.x = state.player.x;
    state.camera.y = state.player.y;
    state.police.units.length = 0;
    state.police.heli = null;
    screen = SCREEN_PLAY;
    status.textContent = 'Respawned at the clinic. Mission restarts when you reach the marker.';
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    if (screen === SCREEN_TITLE) {
      if (input.takePress('confirm') || input.mouse().click) { input.endFrame(); begin(); }
      state.time += STEP;
      renderer.draw(state, screen, state.time);
      return;
    }

    while (accumulator >= STEP) {
      accumulator -= STEP;
      const result = stepWorld(state, input, events);
      handleEvents(state, events, screenCtl);
      events.length = 0;
      if (result === 'pause') {
        screen = SCREEN_PAUSED;
        status.textContent = 'Paused.';
        break;
      }
      if (result === 'dead' && screen === SCREEN_PLAY) {
        screen = SCREEN_OVER;
        audio.stopEngine();
        audio.setSiren(false);
        status.textContent = 'Wasted. Press Enter to respawn.';
        writeSave(snapshotSave(state));
        break;
      }
      saveTimer += STEP;
      if (saveTimer >= SAVE_INTERVAL) {
        saveTimer = 0;
        state.save = snapshotSave(state);
        writeSave(state.save);
      }
    }

    if (screen === SCREEN_OVER && (input.takePress('confirm') || input.mouse().click)) {
      input.endFrame();
      respawn();
    }
    input.endFrame();
    renderer.draw(state, screen, state.time);
  }

  const renderer = createRenderer(canvas);
  requestAnimationFrame(frame);
}

function exitCarSafe(state) {
  if (state.player.inCar) exitCar(state.player);
}

// ?shot=... renders a staged scene twice then flags readiness for the
// screenshot harness; otherwise boot the interactive game.
if (shot) runShot();
else runGame();

function runShot() {
  const state = buildWorld();
  const scene = stageShot(shot, state);
  state.save = readSave();
  state.drawHud = (ctx, s, W, H) => drawHud(ctx, s.hud, s, W, H);
  const renderer = createRenderer(canvas);
  // Advance a few fixed steps so effects (blinks, particles) look alive but
  // the scene stays deterministic.
  for (let i = 0; i < 8; i++) {
    state.time += STEP;
    updateParticles(state, STEP);
    updatePeds(state.peds, state.city, state.player, state.player.wanted, STEP);
  }
  let painted = 0;
  function paint() {
    renderer.draw(state, scene.screen, scene.time);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}
