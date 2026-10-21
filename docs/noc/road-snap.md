# Road snapping (`POST /api/snap`)

Aplikasi peta menempelkan jalur kabel ke jalan nyata lewat endpoint ini. Peta
tidak pernah memanggil OSRM atau layanan routing luar langsung; hanya NOC yang
bicara ke OSRM self-host (`OSRM_BASE_URL`, bawaan `http://127.0.0.1:5000`).

## Kontrak

```http
POST /api/snap
Authorization: Bearer noc_...        (key "read" pun boleh: endpoint ini hanya menghitung)
Content-Type: application/json

{ "points": [[lat, lng], ...], "toleranceM": 30 }
→ 200 { "snapped": true,  "geometry": [[lat, lng], ...], "provider": "osrm-foot" }
→ 200 { "snapped": false, "geometry": <points apa adanya>, "provider": "manual" }
```

- `points` 2–2000 titik, urutan = rute pilihan pengguna (tidak diubah).
  `toleranceM` > 0 dan ≤ 500. Body lain → 422 `VALIDATION_ERROR`.
- Respons TIDAK dibungkus `{ data }`: klien peta (`snapGeometry` di
  `src/server/central-api/adapter.ts` repo peta) membaca `snapped` di level atas.
- `snapped:false` bila ada titik tanpa jalan dalam `toleranceM`, OSRM tidak
  menemukan rute, mati, atau lewat 4 detik (klien menyerah di 5 detik). Geometri
  tidak pernah dikarang; `src/lib/cable-path-routing.ts` (belokan L) tidak dipakai.

Logika: `src/services/road-snap.service.ts`. Satu panggilan OSRM `route` dengan
`radiuses=toleranceM` per titik: OSRM menempelkan tiap titik ke jalan terdekat
(sama seperti `nearest`), menolak `NoSegment` bila lebih jauh dari toleransi, dan
mengembalikan geometri jalan antar titik berurutan (`overview=full&geometries=geojson`).
Satu permintaan, bukan N+1, supaya muat di batas waktu.

Profil `foot`: kabel mengikuti tiang di sisi jalan, jadi larangan satu arah
profil `driving` membuat garis memutar blok, dan `driving` membuang gang sempit,
footway, dan jalan setapak. `foot` memakai semuanya tanpa arah.

## Menyalakan OSRM (sekali)

Butuh Docker. Unduhan ±280 MB (Geofabrik `asia/indonesia/sumatra-latest.osm.pbf`),
pra-olah butuh beberapa GB RAM untuk Docker dan beberapa menit; hasil olahan ±1–2 GB
di `docker/osrm/data/` (di-gitignore, tidak di-commit).

```bash
npm run osrm:download   # unduh sumatra-latest.osm.pbf
npm run osrm:prepare    # osrm-extract (foot.lua) → osrm-partition → osrm-customize (MLD)
npm run osrm:up         # osrm-routed --algorithm mld di 127.0.0.1:5000 + jaringan nocsystem_default
```

`osrm:up` butuh jaringan `nocsystem_default`, jadi nyalakan stack `compose.yaml`
dulu. Kontainer app memanggil `http://osrm:5000` (diisi `compose.yaml`); `npm run dev`
di host memakai bawaan `127.0.0.1:5000`. Perbarui data: ulangi ketiga perintah lalu
`docker restart nocsystem-osrm`. Log: `npm run osrm:logs`.

Uji cepat (ganti key):

```bash
curl -s -X POST http://127.0.0.1:3001/api/snap -H "Authorization: Bearer noc_..." -H "Content-Type: application/json" -d '{"points":[[-0.9471,100.3543],[-0.9502,100.3585]],"toleranceM":30}'
```

## Batas yang diketahui

- Koordinat dikirim polos di URL OSRM. Rute ratusan titik aman; bila OSRM menolak
  URL sangat panjang (mendekati 2000 titik), hasilnya `snapped:false`, bukan error.
- Hanya data Sumatra. Titik di luar pulau selalu `snapped:false`.
