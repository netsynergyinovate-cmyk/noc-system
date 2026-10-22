# Diagnosa Pelanggan Berlapis — Fase 1

Tanggal: 2026-10-22. Acuan: `deteksi-anomali-pelanggan-PRD.md` bagian 3 Fase 1, alur 4A/4B, aturan arsitektur bagian 5.

## Yang dibangun

| PRD Fase 1 | Implementasi |
| --- | --- |
| Pilih pelanggan (ID/nama) | `/app/anomali` → kartu "Diagnosa pelanggan": cari nama, username PPPoE, atau UUID |
| Jalankan pemeriksaan | `POST /api/anomalies/diagnostics` → antrean → `executeRun` |
| Hasil berlapis hulu→hilir | 8 lapisan: Hulu, MikroTik, Log, Firewall/NAT, Optik, ONT, Trafik, Billing |
| Angka & ambang | Tiap temuan: nilai, pembanding, ambang, sumber (router/OLT/tabel) dan waktu sampel |
| Tanda "tidak dapat diperiksa" | Status `unchecked` + alasan; lapisan fase berikut ditulis "dibangun di Fase N" |
| Tombol manual di 3 tempat | `/app/anomali`, baris anomali milik pelanggan, header detail pelanggan. Tombol selalu aktif; tekan lagi saat berjalan = run yang sama (`reused`) |
| Progres per lapisan | Temuan ditulis per lapisan; tampilan polling 1 dtk ("Memeriksa lapisan k dari 8") |
| Pemicu otomatis | Alert baru milik pelanggan (offline/optical/queue), tiket keluhan, billing berubah ke isolir |
| Kebijakan pemicu | Kartu "Pemicu otomatis": aktif/mati per jenis, jendela anti-duplikat, ambang & jendela gangguan bersama (`threshold:manage`) |
| Penahan gangguan massal | ≥ ambang pelanggan beralert dalam jendela → satu run "Gangguan bersama", per-pelanggan ditahan |
| Antrean berprioritas | Manual (0) di depan otomatis (10); 1 run per router; otomatis jeda 2 dtk per router |
| Penanda asal | Badge Manual (oleh operator) / Otomatis (pemicu), "digabung N kejadian", waktu diminta/mulai/selesai |

## Pemeriksaan nyata di Fase 1

- **MikroTik — sesi PPPoE**: baca langsung `/rest/ppp/active` router pelanggan (kredensial lewat `getRouterDecryptedCredentials`). Router gagal dibaca = `unchecked` dengan alasan, bukan "offline". Sengaja tidak memakai `getRouterPppoeSessions` karena fungsi itu menelan galat jadi daftar kosong (akan terbaca "offline") dan memberi data tiruan di mode demo.
- **Optik ONU**: `olt_onus` (status, Rx) vs ambang `getOpticalSignalStatus` (-24..-8 dBm; < -27 kritis), sama dengan badge di detail pelanggan. Sampel > 10 menit = `unchecked` (data basi).
- **Billing**: `billing_status` (bukan `customers.billing_status` yang default "lunas"). Tidak cocok tagihan = `unchecked`.
- Lainnya (queue/ifrate/DHCP/ARP, log, firewall, hulu/BGP/IPv6, ONT GenieACS, trafik/NetFlow, mismatch billing) = `unchecked` "dibangun di Fase N".

## Kesimpulan (sementara)

`pickVerdict`: lapisan `fail` pertama menurut urutan billing → hulu → optik → ONT → MikroTik → firewall → log → trafik, lalu `warn`. PPPoE putus + LOS menyalahkan optik. Tanpa temuan bermasalah dan ada lapisan tak terperiksa: "kesimpulan belum lengkap". Diganti rule engine Fase 8.

## Skema (migrasi 0033)

`diagnostic_runs` (trigger_mode, triggered_by, trigger_reason, trigger_source_ref, dedupe_key unik, merged_count, priority, status, verdict_*, is_shared_fault; indeks unik parsial: satu run manual aktif per pelanggan), `diagnostic_findings` (layer, metric, value, threshold, comparator, status ok/warn/fail/unchecked, source_ref, sampled_at), `diagnostic_policy` (satu baris, ditanam migrasi).

## Bukti uji

- `npm run typecheck`: 0 galat.
- `npx eslint` berkas yang diubah: 0 galat, 0 peringatan.
- `node --test tests/diagnostics.test.mjs tests/diagnostics-service.test.mjs` pada PostgreSQL 17 sekali pakai (migrasi 0000–0033 diterapkan): 14/14 lulus — router gagal = unchecked, isolir jadi kesimpulan, tekan ulang = run sama, dedupe digabung, kebijakan mati, gangguan massal ditahan, antrean manual-dulu dan satu per router.

## Batasan yang diketahui

- Antrean di memori satu proses Next.js; lebih dari satu instance app perlu kunci di DB.
- Jendela dedupe tetap (bukan geser): dua kejadian yang mengapit batas jendela bisa jadi dua run.
- Run yang tertinggal saat server mati ditandai gagal saat start ("Server dimulai ulang…").
- Pemicu alert hanya membaca alert yang dibuat sesudah server start (tidak memutar ulang).
- Billing isolir massal (awal bulan) tetap memicu per pelanggan; dilindungi antrean 1 per router.
