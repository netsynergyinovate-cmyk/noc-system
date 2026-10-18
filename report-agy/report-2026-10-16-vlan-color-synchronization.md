# Laporan Rekayasa: Sinkronisasi Harmonisasi Warna Elemen VLAN Traffic dengan Tema Utama Halaman

**Tanggal**: 16 Oktober 2026  
**Status**: SELESAI & TERVERIFIKASI  
**Pelaksana**: Gemini & Claude Code Methodology (Surgical, Zero-Dummy, Strict Verification)  
**Tautan Berkas**:
- [`src/components/dashboard/vlan-pon-traffic-board.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/vlan-pon-traffic-board.tsx)
- [`src/components/dashboard/noc-dense-dashboard.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/noc-dense-dashboard.tsx)
- [`src/components/dashboard/traffic-chart.tsx`](file:///e:/NOC%20SYSTEM/src/components/dashboard/traffic-chart.tsx)

---

## 1. Akar Masalah Ketidaksesuaian Warna (Root Cause Analysis)

Sebelum perbaikan, tampilan kartu VLAN per PON OLT memiliki beberapa inkonsistensi visual (*color clash* / jomplang) terhadap komponen utama dashboard:
1. **Disparitas Identitas Warna Seri (Series Color Identity Mismatch)**:
   - Pada grafik utama uPlot (`traffic-chart.tsx`) dan kotak metrik (`traffic-panel.tsx`), **Unduh (Rx)** memakai token `--chart-1` (`#60a5fa` / `#38bdf8` Sky Blue), sedangkan **Unggah (Tx)** memakai token `--chart-2` (`#fb923c` Orange).
   - Pada `vlan-pon-traffic-board.tsx` sebelumnya, Unggah digambar menggunakan warna lavender/indigo (`#a78bfa`), dengan indikator dot indigo dan glow indigo saat diinspeksi. Ini menyebabkan kontras visual yang janggal (*disconnected visual cue*).
2. **Inkonsistensi Latar Belakang & Border (Surface Tokens Discrepancy)**:
   - Panel dan metrik utama dashboard memakai tema standar `#111317` untuk kontainer besar dengan `border-[#1e222a]`, dan blok metrik dalam memakai `bg-zinc-900/60` atau `bg-zinc-900/90` dengan `border-zinc-800`.
   - Kartu VLAN sebelumnya memakai warna navy acak `#0d0f14`, `#101319`, `#0b0d11`, dan canvas container `#07090c`. Warna-warna ad-hoc ini membuat kartu VLAN tampak mengambang dengan saturasi berbeda dari tema zinc dark mode.
3. **Inkonsistensi Status Bar Inspeksi**:
   - Di `noc-dense-dashboard.tsx`, tooltip status bar inspeksi titik sempat menggunakan `text-emerald-400` untuk Unduh dan `text-purple-400` untuk Unggah, bertentangan dengan warna garis grafik (Sky Blue & Orange).

---

## 2. Rincian Perubahan Teknis (Surgical Diff)

### A. Komponen `src/components/dashboard/vlan-pon-traffic-board.tsx`
1. **Sinkronisasi Header & Ringkasan Baris**:
   - Ikon judul: Diganti menjadi `Layers` dengan warna `text-emerald-400 shrink-0` (identik dengan aksen Activity di grafik utama).
   - Badge `1 DTK`: Menggunakan kelas standar `flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-950/60 border border-emerald-500/40 text-[9px] font-mono text-emerald-400 font-semibold`.
   - Ringkasan Status: Menggunakan `bg-zinc-900/60 border border-zinc-800`. Angka Total DL diberi `text-sky-400 font-bold font-mono` dan Total UL `text-orange-400 font-bold font-mono`.
2. **Sinkronisasi Kartu `VlanPonCard`**:
   - Kontainer kartu: Normal `border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900/80`. Saat terpilih (`isSelected`): `border-sky-500/60 bg-zinc-900/90 ring-1 ring-sky-500/40 shadow-sm shadow-sky-950/40`.
   - Kotak Kecepatan Unduh:
     - Indikator: `w-3 border-t-[2.5px] border-solid rounded-full border-sky-400` (identik dengan `SeriesStat`).
     - Normal: `bg-zinc-900/90 border-zinc-800`. Saat diinspeksi: `bg-sky-950/30 border-sky-500/50`.
     - Angka: `text-white font-mono font-bold text-base tabular-nums`.
   - Kotak Kecepatan Unggah:
     - Indikator: `w-3 border-t-[2.5px] border-solid rounded-full border-orange-400` (identik dengan `SeriesStat`).
     - Normal: `bg-zinc-900/90 border-zinc-800`. Saat diinspeksi: `bg-orange-950/30 border-orange-500/50`.
     - Angka: `text-white font-mono font-bold text-base tabular-nums`.
   - Wadah Canvas: `bg-[#0c0e12] rounded border border-zinc-800` (100% identik dengan wadah uPlot `TrafficChart`).
   - Footer: Status aktif menggunakan `text-emerald-400 font-semibold uppercase` dan standby `text-zinc-600 uppercase`.
3. **Sinkronisasi Engine Kanvas `VlanRichChart`**:
   - Grid Sumbu Y & X: `ctx.strokeStyle = "#1e222a"`.
   - Label Angka & Waktu: `ctx.fillStyle = "#71717a"`, font `8px 'JetBrains Mono', Consolas, monospace`.
   - Seri Unduh: Garis `#38bdf8` (width 1.5), area gradien `rgba(56, 189, 248, 0.16)` ke `rgba(56, 189, 248, 0.005)`.
   - Seri Unggah: Garis `#fb923c` (width 1.5), area gradien `rgba(251, 146, 60, 0.16)` ke `rgba(251, 146, 60, 0.005)`.
   - Crosshair Inspeksi (Hover): Garis putus-putus `#52525b`, dot unduh `#38bdf8`, dot unggah `#fb923c`.

### B. Komponen `src/components/dashboard/noc-dense-dashboard.tsx`
- Menyelaraskan teks inspeksi titik pada baris 467–469:
  - Unduh: `text-sky-400 font-bold` (sebelumnya `text-emerald-400`).
  - Unggah: `text-orange-400 font-bold` (sebelumnya `text-purple-400`).

---

## 3. Gerbang Verifikasi Mandiri (Evidence Before Assertions)

### 1. `npm run typecheck`
```text
> ngodingpakeai-starter@0.1.0 typecheck
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
(Exit code: 0)
```

### 2. `npx eslint src/components/dashboard/vlan-pon-traffic-board.tsx src/components/dashboard/noc-dense-dashboard.tsx`
```text
(0 errors, 0 warnings, exit code: 0)
```

### 3. `node --test tests/vlan-traffic-service.test.mjs`
```text
✔ getVlanPonTraffic (live): mengembalikan 6 PON VLAN dengan deret grafik lengkap (2.8582ms)
✔ getVlanPonTraffic (1h): mengembalikan deret histori 1 jam dengan timeLabel jam:menit (1.1137ms)
✔ getVlanPonTraffic (24h): mengembalikan deret histori 24 jam (0.8373ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ duration_ms 853.8379
(Exit code: 0)
```

### 4. Docker Build & Restart
```text
docker compose build app
=> exporting to image nocsystem-app:latest (Exit code: 0)
docker compose up -d --no-deps app
=> Container nocsystem-app-1 Recreated && Started (Exit code: 0)
```

### 5. Verifikasi Visual Headless Browser (Playwright)
- `node scripts/capture-vlan-traffic.mjs` dieksekusi menghasilkan tangkapan layar terkini:
  - `screenshots/08-vlan-pon-traffic-board.png`: Tampilan utuh dashboard dengan keselarasan warna sempurna di setiap elemen kartu VLAN PON terhadap grafik utama dan panel lainnya.
  - `screenshots/08-vlan-pon-hover-inspection.png`: Pengujian interaksi hover kursor menunjukkan titik inspeksi dan tooltip selaras secara presisi (Sky Blue untuk unduh dan Orange untuk unggah).

---

## 4. Kesimpulan

Tugas harmonisasi warna telah selesai secara tuntas (*done and verified*). Seluruh elemen kartu VLAN per PON kini menggunakan token warna yang sinkron dengan sistem desain dashboard NOC:
- **Unduh**: Sky Blue (`#38bdf8` / `text-sky-400`)
- **Unggah**: Orange (`#fb923c` / `text-orange-400`)
- **Latar & Garis Batas**: `bg-zinc-900/60`, `bg-[#0c0e12]`, `border-zinc-800`, `border-[#1e222a]`
- **Tipografi & Status**: JetBrains Mono, `#71717a` (muted), `#ffffff` (angka utama), `text-emerald-400` (aktif / 1 DTK).

