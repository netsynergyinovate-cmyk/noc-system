# Laporan Rekayasa: Bangun Halaman Peta Jalur Kabel dengan Data Nyata dari Backend

## 1. Ringkasan Eksekusi
- **Task ID**: `peta-pelanggan-amp-topologi-jaringan/jalur-kabel-pelanggan/bangun-halaman-peta-jalur-kabel-dengan-data-nyata`
- **Fitur / Modul**: `Jalur Kabel Pelanggan` (Cable Routes Map)
- **Status**: **DONE** (Lolos seluruh gerbang verifikasi mandiri)

## 2. Masalah yang Diselesaikan
Sebelumnya sistem NOC memiliki modul Peta Peletakan Fisik Infrastruktur (`/app/peta`), Susunan Bertingkat (`/app/topologi`), dan Sebaran Pelanggan (`/app/pelanggan/peta`), namun belum memiliki halaman khusus yang berfokus mendalam pada visualisasi bentangan kabel serat optik operasional lapangan (Backbone, Feeder, Distribusi, dan Drop Optik) lengkap dengan data riil dari backend PostgreSQL, metrik panjang bentangan kabel (Haversine distance), serta filter dan legenda kapasitas core.

## 3. Rincian Implementasi & Perubahan Teknis
1. **Service Backend Data Kabel Jaringan (`src/services/cable-map.service.ts`)**:
   - Membaca data topologi infrastruktur fisik (`network_infrastructure`) dan pelanggan terhubung (`customers`) dari database PostgreSQL riil.
   - Mengelompokkan seluruh segmen kabel ke dalam 4 tingkatan spesifik:
     * **Backbone**: Koneksi Core Router BGP ke OLT / ODC (kapasitas 48 Core).
     * **Feeder**: Koneksi OLT / ODC ke ODP (kapasitas 16–24 Core).
     * **Distribusi**: Koneksi antar ODC / ODP / Tiang distribusi (kapasitas 4–8 Core).
     * **Drop Optik**: Koneksi kotak ODP ke modem ONU pelanggan bertitik koordinat riil (kapasitas 1–2 Core).
   - Menghitung jarak bentangan fisik nyata menggunakan formula trigonometri bola bumi *Haversine Distance* (`calculateHaversineDistanceMeters`).
   - Mengkalkulasi ringkasan metrik: total segmen kabel, total estimasi panjang kabel (meter/kilometer), rincian segmen per jenis, dan status kesehatan kabel (`active`, `warning` jika optical power <= -25 dBm, `offline`).
2. **Endpoint API Terautentikasi (`src/app/api/map/cables/route.ts`)**:
   - Menyediakan handler HTTP `GET /api/map/cables` terproteksi sesi (`withApiSession`) dengan header `Cache-Control: private, no-cache, no-store`.
3. **Komponen Papan Peta Jalur Kabel (`src/components/map/cable-map-board.tsx`)**:
   - Grid metrik ringkasan interaktif: Total Jalur Kabel, Total Panjang Kabel, Backbone & Feeder, Drop Pelanggan, dan Kondisi Normal/Aktif.
   - Panel samping (sidebar) daftar kabel dengan pencarian teks fleksibel (nama rute, titik awal, atau titik akhir).
   - Filter jenis kabel multi-kategori (`Semua Tipe`, `Backbone`, `Feeder`, `Drop`).
   - Filter status kondisi kabel (`Semua Kondisi`, `Aktif`, `Peringatan`, `Putus`).
   - Legenda kapasitas serat optik visual (48C Ungu, 16C Cyan, 8C Amber, 1-2C Emerald/Rose).
   - Panel detail mengambang kabel terpilih di atas peta beserta tombol sorot cepat titik induk dan titik ujung.
   - Pemuatan peta vektor satelit via `NetworkMapLeafletLoader`.
4. **Halaman Server Component & Rute Alias (`src/app/(protected)/app/peta/kabel/page.tsx` & `/app/kabel/page.tsx`)**:
   - Server Component di App Router Next.js dengan perlindungan `await requireSession()`, pembacaan parameter fokus URL (`readFocusId`), dan metadata judul SEO/NOC terstruktur.
   - Alias rute `/app/kabel` disediakan untuk kenyamanan akses cepat operator.
5. **Integrasi Navigasi Global**:
   - Menambahkan menu `Jalur Kabel` (`/app/peta/kabel`) ke dalam kategori "Infrastruktur" di sidebar navigasi utama (`src/components/dashboard/app-nav.tsx`).
   - Menambahkan tombol shortcut `Jalur Kabel` di bilah header halaman Peta Peletakan (`src/app/(protected)/app/peta/page.tsx`).

## 4. Bukti Verifikasi Mandiri (Evidence Before Assertions)
1. **Unit Test Spesifik Modul Peta Jalur Kabel**:
   - Command: `node --test tests/cable-map-page-and-data.test.mjs`
   - Hasil: 7/7 subtests PASS (0 failures).
2. **Uji Regresi Menyeluruh (9 Test Suites Peta & Topologi)**:
   - Command: `node --test tests/cable-map-page-and-data.test.mjs tests/sync-tree-and-map-after-reassign.test.mjs tests/reassign-hierarchy-parent.test.mjs tests/toggle-panel-without-reload.test.mjs tests/highlight-map-node-from-tree.test.mjs tests/collapsible-tree-panel.test.mjs tests/hierarchy-tier-structure.test.mjs tests/parent-device-link-rendering.test.mjs tests/zoom-sharpness-and-scaling.test.mjs`
   - Hasil: 53/53 subtests PASS (0 failures, duration 218ms).
3. **TypeScript Typecheck**:
   - Command: `npm run typecheck`
   - Hasil: Exit code 0, Types generated successfully, 0 error.
4. **ESLint Static Analysis**:
   - Command: `npx eslint src/services/cable-map.service.ts src/app/api/map/cables/route.ts src/components/map/cable-map-board.tsx "src/app/(protected)/app/peta/kabel/page.tsx" "src/app/(protected)/app/kabel/page.tsx" src/components/dashboard/app-nav.tsx "src/app/(protected)/app/peta/page.tsx"`
   - Hasil: Exit code 0, 0 errors, 0 warnings.
