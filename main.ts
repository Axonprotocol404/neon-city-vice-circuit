// ============================================================================
// Neon City: Vice Circuit — developer notes
// ============================================================================
//
// This is my entry for the make.fun bounty gta6-01: a top-down neon-noir
// crime sandbox that runs entirely in the browser. No engine, no framework,
// no vendored libraries — just ES modules over a 2D canvas, Node-stdlib-only
// plumbing, and a seeded city you can reproduce pixel-for-pixel.
//
// Serve it locally and open the game:
//
//   python3 -m http.server 8082
//   # then open http://localhost:8082/game/index.html
//
// Everything runs client-side and offline; the only network request is the
// page itself. License: MIT — see README.md.
//
// ----------------------------------------------------------------------------
// Architecture: 13 modules under game/src/
//
// The sim runs on a fixed timestep (STEP = 1/60 in config.js) whatever the
// display's refresh rate, with a max frame clamp of 0.25s so a background tab
// never explodes the physics. Each system is a plain module exporting a
// create*() factory and an update*() step — no classes, no globals, no event
// bus. State flows one way: main.js owns the world object and hands it to each
// system in order.
//
//   config.js   Every tuning number and colour in one file: world size
//               (3200x3200), city grid metrics, the neon palette, player/car/
//               police/combat constants, save key and autosave interval.
//               Change the feel of the game here, nowhere else.
//
//   city.js     The seeded city generator. From one integer seed it builds the
//               road grid, blocks (buildings, parks, water), six named
//               districts, landmarks and the spawn point. Deterministic:
//               ?seed=N always yields the same city.
//
//   player.js   The on-foot avatar: walking, health + slow regen after a
//               delay, wanted level, money, and enter/exit car transitions.
//               Also serialises the player slice for autosave.
//
//   car.js      Vehicle physics: four types (sedan, sport, van, patrol) with
//               per-type speed/accel/grip/turn, lateral grip loss and drift,
//               skid marks, body damage, and car-vs-car bounce/overlap so
//               traffic doesn't stack.
//
//   traffic.js  Ambient civilian cars that spawn on roads, follow lanes, stop
//               for obstacles and panic when shots land nearby. Keeps the
//               city alive without any pathfinding graphs.
//
//   peds.js     Pedestrians on sidewalks: wandering, crossing, fleeing when
//               scared (by gunshots, near-misses or a rising wanted level),
//               and recycling so density stays constant around the camera.
//
//   police.js   The wanted system, levels 1-5. Each star raises the chaser
//               cap; 3+ adds roadblocks and patrol gunfire, 4+ adds a
//               spotlight helicopter. Evading out of sight long enough drops
//               stars one at a time.
//
//   missions.js Six chained story missions (courier run, tail, hot delivery,
//               vault heist, escape, showdown) with objective markers, timers,
//               rewards and short dialog lines between Marla, Voss and the
//               Kestrel Crew. Completion advances the chain and drives the
//               win screen.
//
//   combat.js   Bullets and their consequences: player and police fire,
//               bullet stepping, hit resolution against peds / police /
//               traffic / buildings, and every impact feeding back into
//               health, wanted level and panic.
//
//   hud.js      Everything drawn over the world: minimap with mission marker
//               and police blips, health bar, wanted stars, money, speedometer
//               while driving, objective text, dialog lines, and the full
//               screen map on M.
//
//   render.js   Canvas renderer and camera: world drawing (roads, neon signs,
//               buildings with faux-3D tops), screen state machine
//               (title / play / paused / over / win), camera follow and zoom,
//               screen shake and particles.
//
//   audio.js    Fully procedural WebAudio — engine hum that tracks RPM, tyre
//               screech, gunshots, sirens that pitch with proximity, UI blips.
//               No audio files anywhere; it resumes on first input (autoplay
//               policy) and fails silently when WebAudio is unavailable.
//
//   main.js     Boot, input, the fixed-timestep loop, save/load and screen
//               transitions. Owns the world object, wires every system's
//               update order, handles ?shot= and ?seed= and autosaves every
//               SAVE_INTERVAL (5s) to localStorage.
//
// ----------------------------------------------------------------------------
// Controls (also announced to screen readers via the canvas aria-label)
//
//   WASD / arrows   walk on foot; steer + throttle in a car
//   F               enter or leave the nearest car
//   mouse click     shoot toward the crosshair
//   Space           handbrake (drift!)
//   M               toggle the full-screen city map
//   Esc             pause menu
//
// ----------------------------------------------------------------------------
// Deterministic screenshots
//
//   ?seed=N       pins the city generation to seed N (default 1337)
//   ?shot=start   freezes on the title screen, ready for capture
//   ?shot=play    stages the in-car play view with HUD
//   ?shot=city    stages a wide city flyover for the map shot
//   ?shot=mission stages an active mission with marker and dialog
//
// The four files in screenshots/ (1-start, 2-play, 3-city, 4-mission) were all
// captured through these params, so they're reproducible given the same
// browser. Same trick is handy for regression eyeballing.
//
// ----------------------------------------------------------------------------
// Autosave
//
// Every 5 seconds the player slice (position, health, money, wanted, mission
// progress) is serialised to localStorage under 'neon-city-vice-circuit.save'
// and restored on the next boot. Private-mode browsers swallow the write
// silently — the game just starts fresh, by design.
//
// ----------------------------------------------------------------------------
// Submission plumbing
//
// main.ts at the repo root is not the game — it's the grader hand-in: it
// copies game/ and screenshots/ to /output (or $MAKEFUN_OUTPUT_DIR) and writes
// dossier.json via the vendored makefun library, respecting the scorer's caps
// (<= 4 screenshots, <= 256 KiB each; <= 993 files / 48 MiB in game/). Run it
// with Node 22, standard library only.
//
// Tune first, play second: almost every number worth touching lives in
// config.js. If a chase feels unfair, it's POLICE.maxUnits; if drifting feels
// sticky, it's CAR.types.*.grip. — A.
