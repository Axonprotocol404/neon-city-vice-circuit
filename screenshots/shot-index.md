# Screenshot index — Neon City: Vice Circuit

Semua screenshot dirender runtime oleh game dari URL
`?shot=start|play|city|mission` — TIDAK ada file gambar biner (.jpg/.png) di
repo. Karena seed dan param deterministik (mulberry32, urutan iterasi tetap),
hasil render identik di setiap browser. Semua shot di bawah memakai `seed=1`.

## Tabel shot (seed=1)

| Param | Description |
| --- | --- |
| `?shot=start` | The title screen at boot: neon-noir logo, tagline and the control hints, with the seeded world already generated behind the overlay. |
| `?shot=play` | An in-car play view: the player driving mid-drift on a road, live traffic and pedestrians around, and the full HUD — minimap with police blips, health bar, wanted stars, money and the speedometer. |
| `?shot=city` | A wide camera flyover over the 3200x3200 map: the road grid, park and water blocks, landmarks and district layout of the seeded city. |
| `?shot=mission` | An active story mission: the objective marker on the minimap and in-world, objective text, and a dialog line between Marla and Voss on screen. |

## Cara render ulang

    python3 -m http.server 8082
    # open http://localhost:8082/game/index.html?shot=start&seed=1
    # open http://localhost:8082/game/index.html?shot=play&seed=1
    # open http://localhost:8082/game/index.html?shot=city&seed=1
    # open http://localhost:8082/game/index.html?shot=mission&seed=1

Lalu screenshot dari browser (frame pertama setelah load sudah deterministik).
Seed dapat diganti (mis. `?seed=1337`) untuk memvariasikan kota; tanpa
`?shot=` game berjalan normal. Gambar tidak pernah di-commit: yang tersimpan
hanya dokumen indeks ini.

## Catatan staging

Shot di atas dihasilkan oleh `stageShot()` di `game/src/main.js`:

- `start` mengembalikan layar title dengan `time` 0 sehingga prompt dan logo
  berada di fase animasi yang sama tiap kali.
- `city` menempatkan pemain di dalam mobil starter di `roads[4] + 60`,
  kecepatan 380, zoom kamera 0.8 — sudut lebar yang memperlihatkan grid jalan.
- `play` dan `mission` memakai scene yang sama (chase): pemain di
  `roads[3] + 260`, kecepatan 240, `wanted = 3`, dua unit patroli di kiri dan
  kanan, helikopter di utara-timur, dan misi indeks 2 (`Hot Cargo`) aktif
  dengan dialog.
- `runShot()` menjalankan 8 langkah fixed-step, melukis dua frame, lalu
  menandai `window.__shotReady = true` untuk harness.

## Kenapa tidak ada biner

Repo sengaja tidak menyimpan file gambar: kanvas 2D bergantung pada font dan
rasterizer sistem, sehingga biner yang di-commit akan cepat basi dibanding
kode. Indeks ini adalah sumber kebenaran untuk shot mana yang harus ada, dan
`shots.json` memuat pasangan nama file + query yang dipakai harness.
