// ============================================================================
// Neon City: Vice Circuit — developer dossier (make.fun bounty gta6-01)
// ============================================================================
//
// NOTE: this file is the dossier hand-in, not the game. The game lives in
// game/ as plain ES modules over a 2D canvas — no engine, no framework, no
// npm dependencies, nothing to build. Serve the repo root with any static
// file server and open the game page:
//
//   python3 -m http.server 8082
//   # open http://localhost:8082/game/index.html
//
// or run the vendored dev server (node serve.ts) which serves game/ only,
// on 127.0.0.1:8080 by default, with --port to change it. Everything runs
// client-side and fully offline. License: MIT (see LICENSE).
//
// ----------------------------------------------------------------------------
// Architecture: 14 units under game/ (index.html + 13 modules in game/src/)
//
// DESIGN RULE: the simulation runs on a fixed timestep (STEP = 1/60, defined
// in config.js) whatever the display refresh rate is, with a 0.25 s frame
// clamp so a background tab never destabilises the physics. Every system is
// a plain module exporting a create*() factory and an update*() step — no
// classes, no globals, no event bus. State flows one way: main.js owns the
// world object and hands it to each system in a fixed order every tick, so
// a given seed + input sequence replays identically.
//
//   index.html    The single page: canvas, aria-label announcing the
//                 controls to screen readers, and the module script tag
//                 that boots main.js. Deliberately nothing else lives here.
//
//   config.js     Every tuning number and colour in one place: world size
//                 (3200x3200), city grid metrics, the neon palette, player/
//                 car/police/combat constants, save key, autosave interval.
//                 Change the feel of the game here, nowhere else.
//
//   city.js       The seeded city generator. From one integer seed it builds
//                 the road grid, blocks (buildings, parks, water), six named
//                 districts (Crimson Docks, Voltrow Heights, Ashline Market,
//                 Glassrow, Sable Park, Neon Verge), landmarks and the spawn
//                 point. Deterministic: ?seed=N always yields the same city.
//
//   player.js     The on-foot avatar: walking, health with slow regen after
//                 a delay, wanted level, money, and enter/exit car
//                 transitions. Also serialises the player slice for autosave.
//
//   car.js        Vehicle physics: four types (sedan, sport, van, patrol)
//                 with per-type speed/accel/grip/turn, lateral grip loss and
//                 drift, skid marks, body damage, and car-vs-car bounce/
//                 overlap resolution so traffic never stacks into one blob.
//
//   traffic.js    Ambient civilian cars that spawn on roads, follow lanes,
//                 stop for obstacles and panic when shots land nearby.
//                 Keeps the city alive without any pathfinding graph.
//
//   peds.js       Pedestrians on sidewalks: wandering, crossing, fleeing
//                 when scared (gunshots, near-misses, a rising wanted
//                 level), and recycling so density stays constant around
//                 the camera instead of thinning out as you drive away.
//
//   police.js     The wanted system, levels 1-5. Each star raises the
//                 chaser cap; 3+ adds roadblocks and patrol gunfire, 4+
//                 adds a spotlight helicopter. Evading out of sight long
//                 enough drops stars one at a time — no instant forgiveness.
//
//   missions.js   Six chained story missions (Midnight Courier, Kestrel
//                 Tail, Hot Cargo, the Meridian Vault heist, the Voltrow
//                 escape, the Hallowdome showdown) with objective markers,
//                 timers, money rewards and dialog between Marla, Voss and
//                 the Kestrel Crew. Completion advances the chain and drives
//                 the win screen.
//
//   combat.js     Bullets and consequences: player and police fire, bullet
//                 stepping, hit resolution against peds / police / traffic /
//                 buildings, and every impact feeding back into health,
//                 wanted level and civilian panic.
//
//   hud.js        Everything drawn over the world: minimap with mission
//                 marker and police blips, health bar, wanted stars, money,
//                 speedometer while driving, objective text, dialog lines,
//                 and the full-screen map on M.
//
//   render.js     Canvas renderer and camera: world drawing (roads, neon
//                 signs, buildings with faux-3D tops), the screen state
//                 machine (title / play / paused / over / win), camera
//                 follow and zoom, screen shake and particles.
//
//   audio.js      Fully procedural WebAudio — engine hum that tracks RPM,
//                 tyre screech, gunshots, sirens that pitch with proximity,
//                 UI blips. No audio files anywhere; it resumes on first
//                 input (autoplay policy) and fails silently when WebAudio
//                 is unavailable.
//
//   main.js       Boot, input, the fixed-timestep loop, save/load and
//                 screen transitions. Owns the world object, wires every
//                 system's update order, handles ?shot= and ?seed=, and
//                 autosaves every SAVE_INTERVAL (5 s) to localStorage.
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
// Deterministic screenshots (?shot + ?seed)
//
//   ?seed=N       pins city generation to seed N (default 1337)
//   ?shot=start   freezes on the title screen, ready for capture
//   ?shot=play    stages the in-car play view with HUD
//   ?shot=city    stages a wide city flyover for the map shot
//   ?shot=mission stages an active mission with marker and dialog
//
// The four files in screenshots/ (1-start, 2-play, 3-city, 4-mission) were
// all captured through these params, so they are reproducible given the same
// browser; screenshots/shot-index.md documents what each image shows. The
// same trick is handy for quick regression eyeballing after a tuning change.
//
// ----------------------------------------------------------------------------
// Autosave
//
// Every 5 seconds (SAVE_INTERVAL in config.js) the player slice — position,
// health, money, wanted level, mission progress — is serialised to
// localStorage under the key 'neon-city-vice-circuit.save' and restored on
// the next boot. Private-mode browsers swallow the write silently: the game
// just starts fresh, by design, and never throws on a blocked store.
//
// ----------------------------------------------------------------------------
// Submission plumbing (this file's actual job)
//
// main.ts at the repo root is the grader hand-in: it copies game/ and
// screenshots/ to /output (or $MAKEFUN_OUTPUT_DIR) and writes dossier.json
// via the vendored makefun library, respecting the scorer's caps — at most
// 4 screenshots at <= 256 KiB each, and at most 993 files / 48 MiB in game/.
// Run it with Node 22, standard library only.
//
// Tune first, play second: almost every number worth touching lives in
// config.js. If a chase feels unfair, it's POLICE.maxUnits; if drifting
// feels sticky, it's CAR.types.*.grip; if the city feels cramped, widen
// CITY.blockSize and let the districts breathe. — A.
