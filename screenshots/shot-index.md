# Screenshot index — Neon City: Vice Circuit

Semua screenshot dirender runtime oleh game dari URL `?shot=start|play|city|mission`
(dengan seed default `1337`) — TIDAK disimpan sebagai file biner di repo.
Karena seed dan param deterministik, hasil render identik di setiap browser.

Cara render ulang di lokal:

    python3 -m http.server 8082
    # open http://localhost:8082/game/index.html?shot=start&seed=1337
    # open http://localhost:8082/game/index.html?shot=play&seed=1337
    # open http://localhost:8082/game/index.html?shot=city&seed=1337
    # open http://localhost:8082/game/index.html?shot=mission&seed=1337

Deskripsi tiap tampilan:

| Param | Description |
| --- | --- |
| `?shot=start` | The title screen at boot: neon-noir logo, tagline and the control hints before the first input freezes the sim for capture. |
| `?shot=play` | An in-car play view: the sport car mid-drift on a road in Ashline Market, with the HUD showing minimap + police blips, health bar, wanted stars, money and the speedometer. |
| `?shot=city` | A wide camera flyover over the 3200x3200 map: district names, park and water blocks, landmarks and the road grid — the framing used for the full-screen map on M. |
| `?shot=mission` | An active story mission: objective marker on the minimap, objective text, a timer, and a dialog line between Marla and Voss on screen. |

Reproduce any of them locally, e.g.:

    python3 -m http.server 8082
    # open http://localhost:8082/game/index.html?shot=play&seed=1337
