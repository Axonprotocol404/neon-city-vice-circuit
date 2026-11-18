// ============================================================================
// Neon City: Vice Circuit — developer dossier (make.fun bounty gta6-01)
// ============================================================================
//
// This file is the developer hand-in for the finished game, not a starter and
// not executable code. The game itself lives in game/ as plain ES modules over
// a 2D canvas: no engine, no framework, no npm dependencies, nothing to build.
// Serve the repo root with any static file server and open the game page:
//
//   python3 -m http.server 8082
//   # open http://localhost:8082/game/index.html
//
// Everything runs client-side and fully offline. License: MIT (see LICENSE).
//
// ----------------------------------------------------------------------------
// Architecture: 14 units under game/ (index.html + 13 modules in game/src/)
//
// DESIGN RULE: the simulation runs on a fixed timestep (STEP = 1/60, defined
// in config.js) whatever the display refresh rate is, with a 0.25 s frame
// clamp (MAX_FRAME in main.js) so a background tab never destabilises the
// physics. Each system is a plain module exporting a create*() factory and an
// update*() step — no classes, no globals. main.js owns the world object and
// hands it to every system in a fixed order each tick; systems push typed
// events into one array that handleEvents() maps to audio, HUD flashes,
// particles, camera shake and mission chaining.
//
//   index.html    The single shell page: canvas#game is the entire app
//                 (crosshair cursor, touch-action none), p#status is a hidden
//                 aria-live line for screen-reader announcements, and one
//                 module script tag boots game/src/main.js. Nothing else.
//
//   config.js     Single source of truth for every tunable value: world size
//                 (3200x3200), road-grid geometry (cell 400, roadW 90), the
//                 neon palette and font, AI speeds, weapon stats, spawn caps,
//                 CAR.types, POLICE escalation numbers, save key and autosave
//                 interval. Per its own header no other module may hardcode a
//                 plausibly tweakable number.
//
//   city.js       The seeded city generator. One mulberry32 PRNG seeded by
//                 ?seed=N builds the road grid, blocks of buildings with
//                 varied colours and fake heights, sidewalks, parks and
//                 landmarks in a fixed iteration order, so ?seed=N always
//                 yields the identical city. Also exports the createRandom
//                 helpers (.range/.int/.pick), randomRoadPoint /
//                 randomSidewalkPoint samplers and the circle push-out
//                 collision resolver shared by movement and combat.
//
//   player.js     The on-foot human side: WASD/arrows walking with building
//                 collision, health with delayed regen, money, wanted level
//                 0-5, fire cooldown and F enter/exit car transitions. It
//                 never touches vehicle physics — the driven car lives in
//                 car.js, referenced via player.inCar. Exposes playerSave /
//                 playerLoad for the autosave.
//
//   car.js        Vehicle physics: four types (sedan, sport, van, patrol)
//                 with per-type speed/accel/grip/turn from CAR.types. Each car
//                 carries a signed scalar speed plus a free 2D velocity whose
//                 gap from the heading produces visible drift; handbrake
//                 sliding, building bounces, body damage and car-vs-car
//                 bounce/overlap resolution live here.
//
//   traffic.js    Ambient civilian cars: seeded lane spawns (guarded by count
//                 * 10 attempts so no seed can hang the spawn loop), lane
//                 centring, intersection direction picks and look-ahead
//                 braking. Traffic runs a cheaper stepCarLite physics that
//                 stops and slides instead of hard-bouncing, and cars are
//                 repossessed when the player carjacks them. Intersection
//                 choices deliberately use Math.random() — dynamic gameplay,
//                 not part of the deterministic city seed.
//
//   peds.js       Pedestrians: seeded sidewalk spawns, per-ped walking pace,
//                 wandering, panic-and-flee when bullets land nearby or the
//                 wanted level rises, and death by bullets or careless
//                 drivers. Bodies linger briefly and are recycled to distant
//                 sidewalk points so density stays constant without respawn
//                 code.
//
//   police.js     The wanted response ladder, levels 1-5: the patrol spawn
//                 cap scales with stars; 3+ adds patrol gunfire and roadblocks
//                 spawned ahead of the player; 4+ adds a spotlight helicopter
//                 that counts as persistent line-of-sight. Evading out of
//                 sight long enough drops heat one star at a time. Talks to
//                 main.js purely through typed events (policeShoot, evade,
//                 heliIn, heliGone, copDown).
//
//   missions.js   Six chained story missions set in the original-fiction city
//                 of Neon Verge: courier run, chase, delivery, heist, escape
//                 and a final showdown, with original characters Marla, Voss
//                 and the Kestrel Crew. Objectives are 'reach' (within
//                 MISSION.markerRadius) or 'survive' (timer), each with a
//                 minimap marker, money reward and HUD dialog lines. The
//                 SCRIPT block is story content, treated as immutable.
//
//   combat.js     Bullets and consequences: the player fires toward the mouse
//                 cursor (muzzle offset from body or car nose for drive-bys),
//                 police fire comes through policeShoot events. Bullet
//                 ownership ('player' vs 'police') decides who is hurt and how
//                 wanted escalates. Fast bullets advance in BULLET_SUBSTEPS
//                 sub-steps per frame so they never tunnel thin targets;
//                 sparks are purely visual.
//
//   hud.js        Everything drawn over the world: minimap with mission
//                 marker and police blips, health bar, wanted stars, money,
//                 objective text, speedometer while driving, dialog lines,
//                 flash messages and the full-screen map on M. Works in CSS
//                 pixels because render.js applies the devicePixelRatio
//                 transform before calling in.
//
//   render.js     The Canvas 2D renderer: faux-3D buildings (roofs offset
//                 toward the screen), cars with bodies/windows/headlights,
//                 peds, bullets, sparks, skid marks, the helicopter spotlight
//                 cone, particles, a speed-zooming follow camera with screen
//                 shake, and the title/paused/gameover/win screens. Painter's
//                 algorithm layer order, culled against the viewport.
//
//   audio.js      Fully procedural WebAudio with zero assets: a detuned
//                 saw + sub-square engine hum whose pitch and gain track
//                 speed, a continuous police siren layer, gunshots, explosion
//                 thuds and UI blips, all synthesized from oscillators and
//                 white-noise buffers. The AudioContext is created lazily on
//                 the first user gesture and fails silently when WebAudio is
//                 unavailable.
//
//   main.js       Boot, input, the fixed-timestep accumulator loop, event
//                 routing, screen transitions and save/load. Owns the world
//                 object, wires every system's update order, parses ?seed=
//                 (default 1337) and ?shot=, and autosaves to localStorage.
//
// ----------------------------------------------------------------------------
// Controls (also announced to screen readers via the canvas aria-label)
//
//   WASD / arrows   walk on foot; steer + throttle in a car
//   F               enter or leave the nearest car
//   mouse click     shoot toward the crosshair (works on foot and drive-by)
//   Space           handbrake (drift)
//   M               toggle the full-screen city map
//   Esc             pause menu
//
// Any key or click on the title screen starts a run.
//
// ----------------------------------------------------------------------------
// Deterministic screenshots (?shot + ?seed)
//
//   ?seed=N       pins city generation to seed N (default 1337)
//   ?shot=start   freezes on the title screen, ready for capture
//   ?shot=play    stages the in-car play view with HUD
//   ?shot=city    stages a wide city flyover
//   ?shot=mission stages an active mission with marker and dialog
//
// Combine them (e.g. ?shot=city&seed=1) and reload for a pixel-identical
// frame in any browser. Screenshot images are rendered at runtime by the
// game; no binary image files are stored in the repo — screenshots/
// shot-index.md documents each shot and how to re-render it.
//
// ----------------------------------------------------------------------------
// Autosave
//
// Every SAVE_INTERVAL seconds (see config.js) the player slice — position,
// health, money, wanted level and mission progress — is serialised to
// localStorage under SAVE_KEY ('neon-city-vice-circuit.save') and restored on
// the next boot. In private-mode browsers the write is swallowed silently and
// the game simply starts fresh with MONEY_START; it never throws on a blocked
// store.
//
// ----------------------------------------------------------------------------
// License
//
// MIT — see the LICENSE file at the repo root. Tune first, play second:
// almost every number worth touching lives in config.js. If a chase feels
// unfair it is POLICE.maxUnits; if drifting feels sticky it is
// CAR.types.*.grip; if the city feels cramped widen the grid metrics and let
// the districts breathe.
