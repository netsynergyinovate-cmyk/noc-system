# Panduan Deploy & Rollback Native Ubuntu (NOC ISP)

Panduan operasional untuk pemasangan dan pemeliharaan aplikasi NOC System di **SERVER NATIVE** (Ubuntu Server milik sendiri) di bawah unit **systemd**, dengan PostgreSQL berjalan di dalam kontainer Docker.

---

## 1. Arsitektur Pemasangan di Server

- **Frontend Next.js**: Berjalan native di bawah systemd (`noc-web.service`) pada port `3000`.
- **Backend Go**: Berjalan native di bawah systemd (`noc-backend.service`) pada port `8080`.
- **Database PostgreSQL**: Berjalan di Docker dengan volume persisten (`postgres-data`).
- **Rilis Berversi**: Terpasang di `/srv/noc/releases/<versi>/` (bersifat *immutable*).
- **Symlink Aktif**: `/srv/noc/current` menunjuk secara atomik ke rilis aktif saat ini.
- **Konfigurasi Bersama**: `/srv/noc/shared/.env` ditautkan ke rilis aktif.

---

## 2. Struktur Direktori Server

```
/srv/noc/
├── current -> /srv/noc/releases/0.1.0+a1b2c3d/   # Symlink atomik
├── releases/
│   ├── 0.1.0+a1b2c3d/                           # Rilis lama (tersimpan aman untuk rollback)
│   └── 0.1.1+e4f5g6h/                           # Rilis aktif baru
├── shared/
│   └── .env                                     # Environment produksi rahasia
└── backups/
    └── backup-2026-10-31T12-00-00.sql.gz        # Backup database sebelum tiap rilis
```

---

## 3. Alur Rilis Melalui Halaman Deploy (Localhost)

1. Buka `http://localhost:3000/app/deploy` dari mesin pengembang.
   *(Halaman ini secara otomatis menolak 404 pada SERVER NATIVE demi keamanan).*
2. Pastikan target server, jalur koneksi (LAN / Tailscale), dan kunci SSH teruji.
3. Klik **Uji Kesiapan (Dry-run)** untuk memastikan server siap tanpa mengubah keadaan apa pun.
4. Klik **Jalankan Deploy**:
   - Sistem melakukan pre-flight koneksi.
   - Database di-backup otomatis ke `/srv/noc/backups/`.
   - Rilis berversi baru diunggah dan diekstrak.
   - Migrasi database dieksekusi dengan advisory lock.
   - Konfigurasi dari localhost dipindahkan secara idempoten.
   - Titik balik versi aktif dicatat.
   - Symlink `/srv/noc/current` ditukar secara atomik.
   - Layanan `noc-web` dan `noc-backend` di-restart via `systemctl`.
   - Health check dijalankan.

---

## 4. Rollback Rilis

### A. Rollback Otomatis
Bila health check pasca-swap gagal merespons dalam 5 kali percobaan, sistem secara mandiri:
1. Memindahkan symlink `/srv/noc/current` kembali ke **titik balik versi sebelumnya**.
2. Me-restart layanan `noc-web` dan `noc-backend`.
3. Menguji ulang health check dan mencatat entri riwayat berjenis `rollback (otomatis)`.

### B. Rollback Manual (Jika Diperlukan)
Bila rilis baru berjalan namun operator ingin kembali ke rilis stabil sebelumnya:

**Melalui Halaman Deploy:**
1. Buka tab **Riwayat & Rollback**.
2. Klik tombol **Rollback Manual**.
3. Pilih versi rilis yang ingin dipulihkan.
4. Konfirmasi tindakan.

**Melalui Terminal SSH Server:**
```bash
# 1. Tukar symlink atomik ke versi rilis yang diinginkan
ln -sfn /srv/noc/releases/<versi-lama> /srv/noc/current.tmp && mv -Tf /srv/noc/current.tmp /srv/noc/current

# 2. Restart layanan systemd
sudo -n systemctl restart noc-web noc-backend

# 3. Verifikasi kesehatan layanan
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8080/healthz
```

> **PERINGATAN PENTING MENGENAI DATABASE:**
> Rollback rilis **HANYA** memutar balik kode aplikasi dan symlink rilis. Skema database **TETAP** pada hasil migrasi terakhir dan **TIDAK** diputar balik secara otomatis, agar tidak menghancurkan data operasional yang masuk.
