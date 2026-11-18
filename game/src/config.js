// =============================================================================
// Neon City: Vice Circuit — central configuration
// =============================================================================
// Every tuning number, threshold and colour in the game lives in this single
// module. Nothing else in the codebase should hardcode a magic number that
// could plausibly be tweaked: AI speeds, weapon stats, spawn caps, camera
// smoothing, palette — it all comes from here.
//
// The world is a fixed 3200x3200 top-down city. The camera follows the player
// and zooms with speed, so none of these values depend on screen size.

// ---------------------------------------------------------------- world size
// Fixed square world; roads are laid out on a grid across both axes.
export const WORLD = { width: 3200, height: 3200 };

/**
 * The simulation's fixed step, in seconds.
 * Invariant: all update*() modules are stepped at exactly 60 Hz regardless
 * of the display's refresh rate, so every dt-dependent constant below is
 * calibrated for this step and must not be rescaled.
 */
export const STEP = 1 / 60;

// ---------------------------------------------------------------- city grid
// Geometry of the road grid and the blocks between roads.
export const CITY = {
  cell: 400,            // distance between road centre-lines
  roadW: 90,            // full width of a road (asphalt only)
  laneOffset: 22,       // lane centre offset from the road centre-line
  sidewalk: 18,         // pavement band on each side of the asphalt
  parkChance: 0.16,     // chance a block is a park instead of buildings
  buildingGap: 14,      // spacing between buildings inside a block
  minBuilding: 70,      // smallest building footprint
  landmarkCount: 3,
  districts: [
    'Crimson Docks', 'Voltrow Heights', 'Ashline Market',
    'Glassrow', 'Sable Park', 'Neon Verge',
  ],
};

// ------------------------------------------------------------------ palette
// Flat colours plus the neon accents; wall / wallTop pair up per building
// style index so body and fake-3D roof always match.
export const PALETTE = {
  asphalt: '#14161d',
  roadLine: '#3a3f52',
  sidewalk: '#232735',
  grass: '#1d3326',
  tree: '#2c5236',
  water: '#101a2c',
  wall: ['#262c3d', '#2c2438', '#1f2b33', '#33262c', '#243040', '#2b2b3a'],
  wallTop: ['#3d4763', '#463a58', '#33464f', '#543a44', '#3a5069', '#42426b'],
  neon: ['#ff2d78', '#00e5ff', '#ffd60a', '#7b2dff', '#39ff88', '#ff7a1a'],
  player: '#00e5ff',
  police: '#3982ff',
  policeStripe: '#b7d0ff',
  traffic: ['#8d93a8', '#a8792f', '#7d4b9e', '#3f7d5c', '#a83f4b'],
  sedan: '#8d93a8', sport: '#ff2d78', van: '#a8792f', patrol: '#3982ff',
  ped: '#c9cfdd',
  bullet: '#ffd60a',
  blood: '#e5534b',
  skid: 'rgba(20,20,26,0.55)',
  hud: 'rgba(10,12,20,0.78)',
  hudEdge: '#00e5ff',
  text: '#eef1f5',
  muted: '#8b93a3',
  danger: '#ff2d78',
  ok: '#39ff88',
  marker: '#ffd60a',
  spotlight: 'rgba(255,255,210,0.16)',
};

// --------------------------------------------------------------- font stack
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// ------------------------------------------------------------------- player
// On-foot movement and pistol stats.
export const PLAYER = {
  speed: 175,           // on-foot px/s
  radius: 9,
  health: 100,
  regenDelay: 8,        // seconds after damage before slow regen
  regenRate: 2,         // hp per second once regenerating
  shootCooldown: 0.22,
  bulletSpeed: 900,
  bulletDamage: 26,
  bulletLife: 0.5,
};

// --------------------------------------------------------------------- cars
// Vehicle kinds and the physics tuning they share. Per-type fields:
//   speed — top px/s
//   accel — px/s^2
//   grip  — lateral friction 0..1 (1 = no drift at all)
//   turn  — rad/s at full steer
//   w/l   — footprint (width / length in px)
// hp is shared by collisions and bullets; reaching 0 wrecks the car.
export const CAR = {
  types: {
    sedan:  { w: 40, l: 76, speed: 330, accel: 300, grip: 0.90, turn: 2.4, hp: 100 },
    sport:  { w: 38, l: 74, speed: 470, accel: 430, grip: 0.82, turn: 2.8, hp: 80 },
    van:    { w: 46, l: 90, speed: 270, accel: 220, grip: 0.95, turn: 1.9, hp: 140 },
    patrol: { w: 42, l: 80, speed: 400, accel: 360, grip: 0.88, turn: 2.6, hp: 110 },
  },
  bounce: 0.45,         // speed kept after hitting a wall
  damageBounce: 6,      // hp lost per hard wall hit
  drag: 0.6,            // per-second speed decay when coasting
  brakeForce: 520,
  handbrakeGrip: 0.35,  // grip multiplier with Space held (drift!)
  enterRange: 60,       // how close on foot to enter a car
  zoomFast: 0.72,       // camera zoom when driving at top speed
  zoomBase: 1.0,
};

// ------------------------------------------------------------------ traffic
// Ambient AI cars cruising the road grid.
export const TRAFFIC = {
  count: 26,
  speed: 150,
  turnChance: 0.35,     // chance of turning at an intersection
  avoidAhead: 90,       // px of look-ahead for basic collision avoidance
};

// --------------------------------------------------------------------- peds
// Ambient pedestrians, including their panic response.
export const PED = {
  count: 44,
  speed: 55,
  fleeSpeed: 150,
  fleeTime: 5,
  radius: 7,
  hp: 40,
};

// ------------------------------------------------------------------- police
// Escalation table and response tuning. maxUnits maps wanted level 1..5 to
// the number of simultaneous chase cars; roadblockWanted / heliWanted are the
// thresholds where those heavier responses kick in.
export const POLICE = {
  maxUnits: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6 },
  spawnDelay: 4,
  chaseSpeed: 1.0,      // multiplier on patrol top speed
  roadblockWanted: 3,
  heliWanted: 4,
  heliSpeed: 130,
  evadeTime: 10,        // seconds out of sight to drop a wanted star
  shootRange: 260,
  shootCooldown: 1.1,
  bulletDamage: 8,
};

// ----------------------------------------------------------------- missions
export const MISSION = {
  markerRadius: 40,
  reward: [300, 500, 700, 1200, 1800, 3000],
};

// ------------------------------------------------------------------- combat
export const COMBAT = {
  pedFearRadius: 260,   // peds panic when shots land this close
};

// --------------------------------------------------------------------- misc
// Persistence and camera smoothing.
export const SAVE_KEY = 'neon-city-vice-circuit.save';
export const SAVE_INTERVAL = 5; // seconds between autosaves
export const CAMERA = { lerp: 4.5, zoomLerp: 2.2 };
export const MONEY_START = 250;
