# Lonceng notifikasi di header Dashboard NOC (2026-11-14)

## Permintaan
Ikon/tombol notifikasi beranimasi di dashboard; notifikasi seperti "koneksi aplikasi ke MikroTik putus" tidak lagi berupa banner besar. Posisi: paling kanan atas header, di samping pil "Live · Diperbarui".

## Perubahan
- `src/components/dashboard/notification-bell.tsx` (dari `router-health-banner.tsx`, git mv): tombol lonceng + popover.
  - Isi: "Aliran data terputus" (`streamDisconnectedView`, tombol Sambungkan ulang) + kartu per router tidak terjangkau (isi banner lama: penyebab, perintah MikroTik, Salin, Panduan, Minta bantuan admin, data beku sejak ...).
  - Ada masalah: lonceng merah `BellRing` berayun 3x (`noc-bell-ring`, diputar ulang saat masalah berubah lewat `key`), badge angka dengan halo `animate-ping`; semua gerak memakai `motion-safe:`.
  - Aksesibilitas: aria-label tombol memuat jumlah + ringkasan; `role="status"` sr-only tetap mengumumkan walau popover tertutup.
  - Alamat layanan router (`/api/routers/{id}/service`) dibaca saat popover dibuka, bukan lewat efek terus-menerus.
- `src/app/(protected)/app/page.tsx`: `<NotificationBell />` setelah `<LiveStatus />`; `StreamDisconnectedBanner` dicabut (komponen dihapus; tes view-nya tetap).
- `src/app/(protected)/app/layout.tsx`: `RouterHealthBanner` dicabut.
- `src/components/ui/popover.tsx`: ditambah via `npx shadcn@4.21.0 add popover` (memakai `radix-ui` yang sudah ada).
- `src/app/globals.css`: `@keyframes noc-bell-ring`. `AGENTS.md`: rujukan RouterHealthBanner -> NotificationBell.

## Batasan
Lonceng hanya di header `/app`; halaman lain tidak lagi menampilkan peringatan router (dulu banner di semua halaman).

## Uji
- typecheck 0 error; eslint 0; `stream-disconnected-banner` + `router-health` 12/12.
- Browser (localhost:3001, akun admin uji lokal sementara, sudah dihapus): normal -> "Notifikasi: tidak ada masalah"; backend Go dimatikan -> lonceng merah badge 1, aria "Notifikasi: 1 masalah. Aliran data terputus", popover menampilkan kartu + "Sambungkan ulang"; banner besar tidak muncul. `npm run all` dijalankan ulang (web 200, backend 200).

## Lanjutan: popover tertimpa peta
- Akar: PopoverContent z-50, sedangkan kontrol/panel Leaflet z-1000..1010.
- Perbaikan: PopoverContent lonceng `z-[1100]`.
- Bukti browser: computed z-index 1100; elementFromPoint di sudut popover = popover (3/3).
