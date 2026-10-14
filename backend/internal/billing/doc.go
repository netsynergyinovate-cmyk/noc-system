// Package billing membaca daftar tagihan dari sistem billing berbasis web:
// masuk dengan cookiejar dan token CSRF, membaca tabel tagihan dengan goquery,
// lalu mengembalikan []Invoice. Bagian lain menyambung hasilnya ke
// aplikasi:
//
//   - match.go (MatchInvoices) memasangkan tagihan dengan pelanggan lewat nama
//     PPPoE. Fungsi murni, dengan aturan yang IDENTIK dengan matchBilling di
//     src/lib/dashboard/billing.ts; testdata/match_cases.json, yang dibuat dari
//     fungsi TS itu, membuktikannya.
//
//   - store.go (Store) menyimpan hasilnya ke PostgreSQL secara transaksional:
//     log sinkron, status tagihan per pelanggan, dan tagihan yang tidak cocok.
//
//   - syncer.go (Syncer) menjalankan satu sinkron penuh: membaca tagihan,
//     mencocokkan, menerapkan, mencatat log sinkron, dan memangkas riwayat.
//     Sumber yang mengembalikan nol tagihan, atau jauh lebih sedikit daripada
//     sinkron berhasil terakhir, dianggap gagal (status lama dijaga).
//
//   - failure.go (Classify) menggolongkan galat sinkron menjadi jenis, pesan
//     Indonesia yang aman untuk petugas (itulah yang disimpan di log sinkron dan
//     tampil di dashboard, tidak pernah teks mentah galat), dan sifat
//     sementara/permanen. Pembacaan sumber yang gagal SEMENTARA (jaringan,
//     timeout, 5xx) diulang di dalam satu sinkron: paling banyak 3 percobaan, jeda
//     15 lalu 45 detik, tidak melewati batas waktu sinkron, satu baris log.
//     Kegagalan permanen, terutama login yang ditolak, tidak pernah diulang.
//
//   - schedule.go dan scheduler.go (NextRun, Scheduler) menjalankannya sekali
//     tiap jam UTC pada menit BILLING_SYNC_MINUTE (bawaan 5), menyusul saat
//     backend baru hidup bila sinkron berhasil terakhir sudah tua, dan tidak
//     pernah mengejar slot yang terlewat. Sesudah 3 sinkron berturut-turut gagal
//     karena login ditolak, penjadwal hanya mencoba sekali per 6 jam sampai
//     berhasil, supaya akun billing tidak terkunci; hitungannya dipulihkan dari
//     log sinkron saat backend dimulai ulang.
//
// Apa pun yang gagal, billing_status dan customers.billing_status tidak
// disentuh: status lama tetap berlaku sampai sinkron berikutnya berhasil.
//
// Endpoint HTTP dan WebSocket adalah pekerjaan lain; kontraknya ada di
// backend/README.md ("Status billing").
//
// Alur satu pembacaan:
//
//  1. GET halaman login, ambil token CSRF dengan selektor profil.
//  2. POST kredensial + token (cookie sesi dibawa cookiejar), lalu pastikan
//     login berhasil menurut Profile.LoginSuccess.
//  3. GET halaman tagihan satu per satu (nomor halaman atau tautan "berikutnya")
//     sampai habis atau batas tercapai, dan baca barisnya menurut selektor profil.
//  4. Bila di tengah jalan sesi berakhir (dialihkan ke halaman login), login
//     ulang SATU kali lalu lanjutkan; bila masih gagal, kembalikan ErrSessionLost.
//
// Keamanan:
//
//   - Verifikasi TLS tidak pernah dimatikan di paket ini. Tes memakai server
//     tiruan dan sertifikatnya sendiri lewat WithTransport.
//   - Kata sandi, token CSRF, dan nilai cookie tidak pernah masuk log, pesan
//     galat, atau String(). Galat hanya mengutip metode, path (tanpa query), dan
//     kode status HTTP, tidak pernah isi form atau isi halaman.
//   - Semua permintaan hanya ke asal (skema, host, port) BaseURL. Pengalihan atau
//     tautan "berikutnya" ke asal lain ditolak sebelum dikirim, jadi cookie sesi
//     dan kredensial tidak bisa bocor ke host lain.
//   - Ada batas untuk waktu per permintaan, ukuran tubuh (setelah dekompresi),
//     jumlah pengalihan, jumlah halaman, dan jumlah baris.
//
// Belum diuji terhadap sistem billing sungguhan, hanya terhadap server tiruan
// (httptest) yang meniru login ber-CSRF, sesi yang berakhir, dan HTML yang kotor.
// Profile bawaan sengaja generik; situs yang nyata hampir pasti butuh profil
// sendiri (selektor dan teks status).
package billing
