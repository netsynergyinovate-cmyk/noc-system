# Titik 0 Mbps di grafik "Traffic Jaringan Real-Time" (2026-11-14)

## Gejala
Grafik live sesekali turun ke tepat 0,0 Mbps unduh DAN unggah selama 1 detik, lalu naik lagi (screenshot pengguna 22.32.55 dan 22.37.28 WIB).

## Bukti (router asli 10.167.80.1, RouterOS 7.21.4, interface UPLINK ether2-lan0)
1. Klien, hub, dan state.Manager tidak membuat angka 0; detik tanpa sampel = celah. Titik 0/0 = backend mencatat sampel 0.
2. `/interface/monitor-traffic` lewat API biner, baris mentah dari router:
   `rx-bits-per-second=129831728 tx-bits-per-second=15348496 fp-rx-bits-per-second=0 ...`.
   Kode membaca `row["rx-bps"]` dan `row["tx-bps"]`, kolom yang tidak pernah dikirim router, sehingga SEMUA baris dilewati: 0 sampel dalam 60 dtk. Tes lolos karena tiruan routernya juga memakai `rx-bps`. Akibatnya router mode API tidak pernah memakai stream; trafik selalu dari jalur cadangan counter interface.
   Sampel pertama stream bukan 0 (129,8 Mbps), jadi hipotesis "sampel pertama 0" gugur.
3. Counter `/interface` lewat API: polling 1 dtk mendapat counter identik pada 3 dari 69 pembacaan (~4%); polling 0,5 dtk pada 35 dari 69. Router memperbarui counter kira-kira 1x per detik. `ifRate` menerima counter identik sebagai laju 0, yang muncul sebagai titik 0/0, lalu titik berikutnya melonjak (2 periode data dalam 1 selang).
4. REST lokal: 0 counter identik dari 89 pembacaan (pembacaan REST lebih lambat), sehingga jarang terlihat di lokal.

Kesimpulan: dip 0 BUKAN putusnya koneksi aplikasi ke MikroTik (kalau putus, titiknya tidak ada sama sekali). Penyebabnya counter router yang belum diperbarui, terbaca sebagai 0, diperparah stream monitor-traffic yang tidak pernah aktif karena nama kolomnya salah.

Belum terbukti langsung di produksi: log Coolify dan tabel routers.protocol server belum terbaca (DB server menunggu langkah tunnel). Mekanisme yang sama berlaku untuk router mana pun.

## Perbaikan
- `backend/internal/collector/api.go`: MonitorTraffic membaca `rx-bits-per-second`/`tx-bits-per-second`. Uji ulang ke router: 30 sampel/30 dtk, 0 nol, minimum 29,0 Mbps.
- `backend/internal/collector/ifrate.go`: `counterTick` (2 dtk) + `staleCounters`. Counter identik dalam < 2 dtk = belum diperbarui. Pembacaan dibuang dan pembanding lama dipertahankan, jadi selisih berikutnya mencakup selang yang benar (tanpa 0, tanpa lonjakan). Counter yang diam >= 2 dtk tetap 0 (interface memang diam).
- `poller.go`: `interfaceTraffic` mengembalikan `stale`; `runQueues` tidak mencatat titik pada detik itu (celah 1 dtk, tidak beralih ke jumlah queue).
- `vlan.go`: VLAN PON memakai aturan yang sama. Pada detik basi ditampilkan pengukuran terakhir dengan `At` aslinya, sehingga riwayat telemetry tidak bertambah dan tidak ada sampel karangan.
- Tes Go: tiruan monitor-traffic memakai baris asli router; `TestInterfaceTrafficSkipsStaleCountersInsteadOfZero`; `TestVlanRatesKeepLastMeasurementOnStaleCounters`.

## Tanda di grafik (live 5 menit)
- `src/lib/dashboard/traffic-marks.ts`: `trafficMarks` (titik 0/0, celah >= 3 dtk) dan `trafficPointNote`.
  - 0/0: "Router mengirim 0 Mbps: koneksi aplikasi ke MikroTik tetap ada, interface tidak mengalirkan trafik".
  - Celah: "Sebelumnya tanpa data N dtk: router tidak mengirim sampel ke backend (RTO/putus)". WebSocket browser yang putus tidak menimbulkan celah, karena snapshot mengirim ulang seri.
- `traffic-chart.tsx`: plugin cincin (warna --warning) untuk 0/0 dan pita redup untuk celah, baris catatan di tooltip, `note` di `InspectedTrafficPoint`.
- `noc-dense-dashboard.tsx`: chip "Titik" menampilkan catatan (`data-testid="traffic-point-note"`).

## Uji
- `npm run backend:check`: semua package ok.
- `npm run typecheck`: 0 error. eslint 3 berkas: 0 error; 1 warning `set-state-in-effect` di noc-dense-dashboard.tsx sudah ada di HEAD.
- `node --test tests/traffic-marks.test.mjs tests/traffic-staleness.test.mjs`: 8/8.
- Belum: tampilan di browser (butuh login dan data dengan titik 0), redeploy produksi, restart backend lokal (`npm run all` di tab sesi utama masih memakai binary lama).
