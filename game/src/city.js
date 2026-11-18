// =============================================================================
// Neon City: Vice Circuit — city generation & geometry helpers
// =============================================================================
// Seeded city generator: a grid of roads, blocks of buildings with varied
// colours and fake heights, sidewalks, parks and a few landmarks.
//
// Determinism contract: everything here derives from a single mulberry32
// PRNG seeded by `seed`, so ?seed=N reproduces the exact same city. Never
// use Math.random() in the generator — only the rnd helpers.
//
// Also hosts the shared geometric queries (road/sidewalk point sampling,
// building lookup, circle push-out) used by the movement and combat modules.
import { CITY, PALETTE, WORLD } from './config.js';

// -------------------------------------------------------------- PRNG helpers

/**
 * Deterministic PRNG (mulberry32). The returned function also carries
 * convenience helpers: range(a,b) for floats, int(a,b) for inclusive
 * integers, pick(arr) for a random array element.
 */
export function createRandom(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => Math.floor(next.range(a, b + 1));
  next.pick = (arr) => arr[next.int(0, arr.length - 1)];
  return next;
}

// ------------------------------------------------------------ city generator

const ROAD_LINES = Math.floor(WORLD.width / CITY.cell) + 1; // 9 lines at 0..3200

export function createCity(seed) {
  const rnd = createRandom(seed);

  // Road centre-lines, in px, for both axes (shared grid).
  const roads = [];
  for (let i = 0; i < ROAD_LINES; i++) roads.push(i * CITY.cell);

  // District names by coarse quadrant + centre, all original. The 3x3
  // quadrant index maps onto the (cyclic) district name list.
  const districtNames = CITY.districts;
  const districtAt = (x, y) => {
    const col = x < WORLD.width * 0.34 ? 0 : x < WORLD.width * 0.67 ? 1 : 2;
    const row = y < WORLD.height * 0.34 ? 0 : y < WORLD.height * 0.67 ? 1 : 2;
    return districtNames[(row * 3 + col) % districtNames.length];
  };

  // World content lists, all filled below in deterministic order.
  const buildings = [];
  const parks = [];
  const trees = [];
  const neonSigns = [];
  const landmarks = [];

  // Inset from the road so blocks sit behind asphalt + sidewalk.
  const half = CITY.roadW / 2 + CITY.sidewalk;
  const cols = ROAD_LINES - 1;

  for (let gy = 0; gy < cols; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      // Rectangle of usable ground for this block (inset on all sides).
      const x0 = roads[gx] + half, y0 = roads[gy] + half;
      const x1 = roads[gx + 1] - half, y1 = roads[gy + 1] - half;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const district = districtAt(cx, cy);

      // Tuning: some fraction of blocks become parks instead of buildings.
      if (rnd() < CITY.parkChance) {
        // A park: grass patch, a pond, some trees.
        parks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, pond: rnd() < 0.5 });
        const n = rnd.int(5, 9);
        for (let t = 0; t < n; t++) {
          trees.push({ x: rnd.range(x0 + 30, x1 - 30), y: rnd.range(y0 + 30, y1 - 30), r: rnd.range(10, 16) });
        }
        continue;
      }

      // Subdivide the block into 1-4 buildings per axis with the tuned gap.
      // Edge case: very small sub-cells clamp up to CITY.minBuilding, which
      // can make adjacent footprints touch — that is accepted, not a bug.
      const rowsX = rnd.int(1, 2), rowsY = rnd.int(1, 2);
      for (let by = 0; by < rowsY; by++) {
        for (let bx = 0; bx < rowsX; bx++) {
          const sw = (x1 - x0) / rowsX, sh = (y1 - y0) / rowsY;
          const bw = Math.max(CITY.minBuilding, sw - CITY.buildingGap * 2);
          const bh = Math.max(CITY.minBuilding, sh - CITY.buildingGap * 2);
          const bxx = x0 + bx * sw + (sw - bw) / 2;
          const byy = y0 + by * sh + (sh - bh) / 2;
          const idx = rnd.int(0, PALETTE.wall.length - 1);
          const height = rnd.range(10, 46); // fake 3D: rendered as a roof offset
          const b = {
            x: bxx, y: byy, w: bw, h: bh,
            color: PALETTE.wall[idx], top: PALETTE.wallTop[idx],
            height, district,
          };
          buildings.push(b);
          // Roughly half of buildings get a glowing sign on their front edge.
          if (rnd() < 0.45) {
            neonSigns.push({
              x: bxx + rnd.range(8, bw - 8), y: byy,
              color: rnd.pick(PALETTE.neon),
              text: rnd.pick(['ZAZA', 'VOLT', 'NOIR', 'KRYO', 'LUX', 'RAIL', 'DUSK', 'OMEN', 'HALO', 'FUSE']),
            });
          }
        }
      }
    }
  }

  // Landmarks: tall towers at hand-picked intersections, original names.
  // They are pushed into `buildings` too, so they block movement & bullets.
  const landmarkDefs = [
    { gx: 2, gy: 2, name: 'Voltspire Tower', color: '#463a58' },
    { gx: 5, gy: 4, name: 'Meridian Exchange', color: '#3a5069' },
    { gx: 6, gy: 6, name: 'The Hallowdome', color: '#543a44' },
  ];
  for (const lm of landmarkDefs.slice(0, CITY.landmarkCount)) {
    const x = roads[lm.gx] + half, y = roads[lm.gy] + half;
    const w = (roads[lm.gx + 1] - half) - x, h = (roads[lm.gy + 1] - half) - y;
    landmarks.push({
      x: x + w * 0.15, y: y + h * 0.15, w: w * 0.7, h: h * 0.7,
      name: lm.name, color: lm.color, height: 62,
    });
    buildings.push(landmarks[landmarks.length - 1]);
  }

  // Paved plaza right by the first landmark: the player spawns near here.
  const spawn = {
    x: roads[2] + CITY.laneOffset + 60, y: roads[2] - CITY.roadW - 30,
  };

  return {
    seed, roads, buildings, parks, trees, neonSigns, landmarks, spawn,
    districtAt,
  };
}

// ---------------------------------------------------------- geometry queries

/** True when the point sits on asphalt (any road strip, either axis). */
export function isOnRoad(x, y) {
  const r = CITY.roadW / 2 + CITY.sidewalk;
  const gx = Math.round(x / CITY.cell) * CITY.cell;
  const gy = Math.round(y / CITY.cell) * CITY.cell;
  return Math.abs(x - gx) <= r || Math.abs(y - gy) <= r;
}

/** Distance from (x,y) to the nearest road centre-line on each axis. */
export function roadDistances(x, y) {
  const gx = Math.round(x / CITY.cell) * CITY.cell;
  const gy = Math.round(y / CITY.cell) * CITY.cell;
  return { dx: Math.abs(x - gx), dy: Math.abs(y - gy), gx, gy };
}

/** Find the first building whose rectangle contains the point (for collisions). */
export function buildingAt(city, x, y, pad = 0) {
  for (const b of city.buildings) {
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return b;
  }
  return null;
}

/**
 * Push a circle out of any building it overlaps; returns the hit normal or
 * null. First-hit semantics: callers slide along the returned normal.
 */
export function resolveCircle(city, x, y, r) {
  for (const b of city.buildings) {
    const nx = Math.max(b.x, Math.min(x, b.x + b.w));
    const ny = Math.max(b.y, Math.min(y, b.y + b.h));
    const dx = x - nx, dy = y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      const d = Math.sqrt(d2) || 0.001; // guard: exactly on the surface
      return { nx: dx / d, ny: dy / d, depth: r - d, building: b };
    }
  }
  return null;
}

// ------------------------------------------------------------ point sampling

/** A random point on a sidewalk: used to seed pedestrians. */
export function randomSidewalkPoint(city, rnd) {
  const road = rnd.pick(city.roads);
  const along = rnd.range(60, WORLD.width - 60);
  const off = CITY.roadW / 2 + CITY.sidewalk / 2;
  const side = rnd() < 0.5 ? -off : off;
  return rnd() < 0.5 ? { x: road + side, y: along } : { x: along, y: road + side };
}

/**
 * A random point on the asphalt of some road, facing along it.
 * Returns {x, y, angle, axis} with axis 'v' (moving along Y) or 'h' (along X).
 */
export function randomRoadPoint(city, rnd, lane = CITY.laneOffset) {
  const road = rnd.pick(city.roads);
  const along = rnd.range(60, WORLD.width - 60);
  const dir = rnd.pick([1, -1]);
  if (rnd() < 0.5) return { x: road + lane * dir, y: along, angle: dir > 0 ? 0 : Math.PI, axis: 'v' };
  return { x: along, y: road + lane * dir, angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2, axis: 'h' };
}
