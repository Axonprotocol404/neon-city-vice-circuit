# Neon City: Vice Circuit

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Axonprotocol404/neon-city-vice-circuit/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Axonprotocol404/neon-city-vice-circuit/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A top-down neon-noir crime sandbox for the browser — drive, shoot, run from
five stars of police heat, and climb a chain of story missions through a city
that never sleeps. Built entirely from plain ES modules over a 2D canvas for
the [make.fun bounty
gta6-01](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01).

Neon City is a 3200x3200 procedurally generated metropolis split into six
districts — Crimson Docks, Voltrow Heights, Ashline Market, Glassrow, Sable
Park and Neon Verge — with a road grid, parks, water and landmarks all
derived from a single integer seed, so `?seed=N` reproduces the same city
every time. You start on foot with a sport car parked nearby and $250: walk
with WASD, press F to jack any car (sedan, sport, van — or a patrol car, if
you're brave), drift with the handbrake, and shoot with the mouse when words
fail. Traffic obeys lanes and panics under fire; pedestrians wander sidewalks
and scatter when shots land.

Crime has consequences: a wanted level from 1 to 5 drives patrol spawns, road
chases, roadblocks at 3 stars, and a spotlight helicopter at 4+. Stay out of
sight long enough and the heat cools one star at a time. A chain of six story
missions — Midnight Courier, Kestrel Tail, Hot Cargo, the Meridian Vault
heist, the escape to Voltrow, and the showdown at the Hallowdome — plays out
through short dialog between the courier, Marla and the fixer Voss, with
money rewards and a win screen at the end. Every sound is procedural
WebAudio: engine hum that tracks RPM, tyre screech, gunshots and sirens that
pitch with distance. No libraries, no assets, no network — just ES modules
and a canvas.

## Play

Serve the repo root with any static file server, then open the game page:

    python3 -m http.server 8082
    # open http://localhost:8082/game/index.html

or run the vendored dev server (`node serve.ts`) which serves `game/` only,
on http://localhost:8080 by default — use `node serve.ts --port 9090` to
change it. Everything runs client-side and fully offline.

Deterministic URLs:

- `?seed=N` — pin the city generation to seed N (default `1337`)
- `?shot=start` — staged title screen for screenshots
- `?shot=play` — staged in-car play view with HUD
- `?shot=city` — staged city flyover
- `?shot=mission` — staged active mission with marker and dialog

Progress autosaves to `localStorage` (key `neon-city-vice-circuit.save`)
every 5 seconds and restores on the next visit; in private-mode browsers the
save write is swallowed silently and the game simply starts fresh.

## Controls

| Key | Action |
| --- | --- |
| `WASD` / arrows | Walk on foot; steer and throttle in a car |
| `F` | Enter or leave the nearest car |
| Mouse click | Shoot toward the crosshair |
| `Space` | Handbrake (drift) |
| `M` | Toggle the full-screen city map |
| `Esc` | Pause menu |

## Features

- Seeded, deterministic 3200x3200 city with six named districts, parks, water and landmarks
- On-foot and vehicle gameplay with per-car physics: grip, drift, skid marks and body damage
- Jackable traffic — sedans, sports cars, vans and police patrols
- Wanted system 1-5: chasers, roadblocks at 3 stars, spotlight helicopter at 4+
- Six chained story missions with dialog, timers, objective markers and money rewards
- Procedural WebAudio: engine, screech, gunfire and distance-pitched sirens — zero audio files
- Minimap and full-screen map with mission markers and police blips
- Fixed 60 Hz simulation timestep, independent of display refresh rate
- Autosave to localStorage every 5 seconds

## Screenshots

Screenshot deterministik (dirender dari ?shot=...): lihat [screenshots/shot-index.md](screenshots/shot-index.md).

## Development

Plain ES modules, no build step and no dependencies — edit a file and
refresh. The simulation runs on a fixed timestep (`STEP = 1/60`); each system
is a module with a `create*()` factory and an `update*()` step, and `main.js`
owns the world object and wires the update order. Developer notes covering
all 14 units under `game/` (index.html plus 13 modules) live in the dossier
at [main.ts](main.ts). Almost every tuning number lives in `config.js` —
change the feel of the game there, nowhere else.

| File | Responsibility |
| --- | --- |
| `game/src/config.js` | All tuning numbers, palette, world size, save key |
| `game/src/city.js` | Seeded city generator: roads, blocks, districts, spawn |
| `game/src/player.js` | On-foot movement, health/regen, wanted, money, enter/exit car |
| `game/src/car.js` | Vehicle physics, drift, skid marks, damage, car-car collisions |
| `game/src/traffic.js` | Ambient civilian cars: lane following, obstacle stops, panic |
| `game/src/peds.js` | Pedestrians: wandering, fleeing, camera-relative recycling |
| `game/src/police.js` | Wanted response: chasers, roadblocks, helicopter, evasion |
| `game/src/missions.js` | Six chained story missions, dialog, rewards, timers |
| `game/src/combat.js` | Bullets, hit resolution, feedback into health/wanted/panic |
| `game/src/hud.js` | Minimap, health, stars, money, speedometer, dialog, map screen |
| `game/src/render.js` | Canvas renderer, camera, screen state machine, particles |
| `game/src/audio.js` | Procedural WebAudio: engine, screech, shots, sirens |
| `game/src/main.js` | Boot, input, fixed-timestep loop, save/load, `?shot`/`?seed` |

`main.ts` at the repo root is the bounty submission plumbing (Node 22,
standard library only): it copies `game/` and `screenshots/` to `/output`
and writes `dossier.json` for the
[make.fun](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
grader, respecting the scorer's caps on screenshot count and size.

## License

MIT — see [LICENSE](LICENSE).
