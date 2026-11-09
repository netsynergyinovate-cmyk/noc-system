// Kamus data tips panduan operasional per halaman rute NOC.
// Menjelaskan fungsi halaman, metrik yang disajikan, dan solusi saat ada masalah.
// TIRUAN SEMENTARA: wajib dihapus saat go-live (Fase 5 / 6) digantikan tabel tutorial_content. Murni.

import type { DataSourceEntry } from "./setup-extended.ts";

export interface PageTipItem {
  pagePath: string;
  pageTitle: string;
  summary: string;
  metrics: readonly { name: string; description: string }[];
  troubleshooting: readonly { issue: string; solution: string }[];
}

export const PAGE_TIPS_MOCK_ENTRY: DataSourceEntry = {
  id: "page-tips-mock-content",
  module: "Konten Tips & Panduan Operasional Per Halaman",
  targetDevice: "Panduan Antarmuka & Troubleshooting NOC",
  status: "dummy",
  readPath: "src/lib/dashboard/page-tips-data.ts",
  writePath: "POST /api/tutorial/content",
  envKey: "DASHBOARD_DATA",
  notes:
    "Tiruan sementara konten panduan tips per halaman; digantikan tabel database tutorial_content saat go-live.",
};

export const PAGE_TIPS_REGISTRY: Record<string, PageTipItem> = {
  "/app": {
    pagePath: "/app",
    pageTitle: "Dasbor Utama NOC",
    summary:
      "Pusat pemantauan kesehatan jaringan real-time: status konektivitas router, total CPE online/offline, dan grafik ringkasan trafik.",
    metrics: [
      {
        name: "Kesehatan Sistem",
        description: "Persentase ketersediaan link core dan router border.",
      },
      {
        name: "Pelanggan Aktif",
        description: "Jumlah sesi PPPoE aktif dibandingkan total pelanggan.",
      },
      {
        name: "Throughput Gabungan",
        description: "Volume trafik uplink (In/Out) dalam satuan Mbps/Gbps.",
      },
    ],
    troubleshooting: [
      {
        issue: "Grafik trafik kosong atau datar",
        solution:
          "Periksa apakah polling router MikroTik aktif dan antarmuka WAN tidak dinonaktifkan.",
      },
      {
        issue: "Angka pelanggan drop tiba-tiba",
        solution:
          "Cek log PPPoE server di MikroTik dan periksa apakah ada link OLT yang terputus.",
      },
    ],
  },
  "/app/alert": {
    pagePath: "/app/alert",
    pageTitle: "Pusat Alert & Insiden Gangguan",
    summary:
      "Daftar insiden gangguan aktif (kritis & peringatan) serta riwayat penanganan alert teknisi.",
    metrics: [
      {
        name: "Alert Aktif",
        description:
          "Insiden yang belum diselesaikan atau belum ditandai ditangani.",
      },
      {
        name: "Tingkat Keparahan",
        description:
          "Klasifikasi Kritis (link putus) vs Peringatan (latensi tinggi).",
      },
      {
        name: "Durasi Gangguan",
        description: "Waktu berlalu sejak anomali pertama kali terdeteksi.",
      },
    ],
    troubleshooting: [
      {
        issue: "Notifikasi suara alert tidak berbunyi",
        solution:
          "Klik tombol lonceng suara di sidebar untuk mengaktifkan izin audio browser.",
      },
      {
        issue: "Alert berulang-ulang muncul",
        solution:
          "Tandai alert sebagai ditangani dan periksa batas ambang alert di menu Pengaturan.",
      },
    ],
  },
  "/app/anomali": {
    pagePath: "/app/anomali",
    pageTitle: "Deteksi Anomali Jaringan",
    summary:
      "Papan pemantauan otomatis anomali lonjakan trafik, utilisasi CPU abnormal, dan degradasi redaman optik.",
    metrics: [
      {
        name: "Skor Anomali",
        description:
          "Tingkat penyimpangan metrik dari baseline perilaku normal.",
      },
      {
        name: "Kategori Kejadian",
        description:
          "Klasifikasi tipe anomali: CPU Spike, Drop Link, Latency Spike.",
      },
    ],
    troubleshooting: [
      {
        issue: "Deteksi anomali terlalu sensitif",
        solution:
          "Naikkan ambang batas toleransi deteksi pada menu Pengaturan > Ambang Batas.",
      },
    ],
  },
  "/app/traffic": {
    pagePath: "/app/traffic",
    pageTitle: "Tren Trafik & Bandwidth Uplink",
    summary:
      "Grafik deret waktu pemakaian bandwidth antarmuka router MikroTik (1 jam, 6 jam, 24 jam, hingga 7 hari).",
    metrics: [
      {
        name: "Trafik Masuk (Inbound)",
        description: "Laju unduh agregat seluruh pelanggan ISP.",
      },
      {
        name: "Trafik Keluar (Outbound)",
        description: "Laju unggah upstream ke penyedia transit / NAP.",
      },
      {
        name: "Puncak Pemakaian",
        description: "Titik utilisasi bandwidth tertinggi dalam rentang waktu.",
      },
    ],
    troubleshooting: [
      {
        issue: "Grafik terputus di jam tertentu",
        solution:
          "Periksa apakah server collector sempat mati atau koneksi ke REST API router time out.",
      },
    ],
  },
  "/app/cpe": {
    pagePath: "/app/cpe",
    pageTitle: "OLT HSGQ & Port Optik PON",
    summary:
      "Manajemen OLT, pemantauan redaman optik RX/TX Power ONU per port PON, dan status modem pelanggan.",
    metrics: [
      {
        name: "RX Optical Power",
        description:
          "Daya terima optik ONU (standar baik: -18 dBm s/d -25 dBm).",
      },
      {
        name: "ONU Terdaftar",
        description: "Jumlah modem ONT yang terotentikasi pada port PON.",
      },
      {
        name: "Status Port PON",
        description: "Kondisi operasional modul SFP PON (Aktif / Non-aktif).",
      },
    ],
    troubleshooting: [
      {
        issue: "Redaman optik menunjukkan nilai lebih buruk dari -27 dBm",
        solution:
          "Kirim teknisi lapangan untuk membersihkan konektor patch cord atau sambungan splitter ODP.",
      },
      {
        issue: "ONU status Los / Offline massal pada satu port",
        solution:
          "Periksa modul SFP OLT atau kabel feeder utama dari OTB ke FDT.",
      },
    ],
  },
  "/app/router": {
    pagePath: "/app/router",
    pageTitle: "Manajemen Router MikroTik",
    summary:
      "Daftar router terdaftar, utilisasi CPU, konsumsi RAM, serta pemantauan simple queues bandwidth.",
    metrics: [
      {
        name: "Beban CPU & RAM",
        description:
          "Persentase utilisasi pemrosesan paket pada prosesor router.",
      },
      {
        name: "Antrean Queue",
        description:
          "Penggunaan alokasi bandwidth upload/download per paket pelanggan.",
      },
      {
        name: "Uptime Router",
        description: "Lama waktu perangkat menyala tanpa restart.",
      },
    ],
    troubleshooting: [
      {
        issue: "CPU MikroTik mencapai 100%",
        solution:
          "Periksa aturan firewall filter dan periksa apakah ada anomali loop trafik atau serangan DNS flood.",
      },
      {
        issue: "Status router tidak terhubung",
        solution:
          "Uji koneksi REST API v7, pastikan IP tidak terblokir firewall service port 443.",
      },
    ],
  },
  "/app/netflow": {
    pagePath: "/app/netflow",
    pageTitle: "Analisis Trafik NetFlow",
    summary:
      "Visualisasi top talker pelanggan, pemakaian protokol (TCP/UDP), dan deteksi lonjakan anomali aliran data.",
    metrics: [
      {
        name: "Top Source / Dest IP",
        description: "Alamat IP yang mengonsumsi transfer data terbesar.",
      },
      {
        name: "Distribusi Protokol",
        description: "Perbandingan trafik HTTPS, DNS, Game UDP, dan Streaming.",
      },
      {
        name: "Paket per Detik (PPS)",
        description:
          "Laju aliran paket untuk mendeteksi potensi serangan DDoS.",
      },
    ],
    troubleshooting: [
      {
        issue: "Tabel NetFlow kosong tanpa aliran data",
        solution:
          "Arahkan target IP flow di MikroTik ke port UDP 2055 host server NOC.",
      },
    ],
  },
  "/app/pelanggan": {
    pagePath: "/app/pelanggan",
    pageTitle: "Manajemen Pelanggan & PPPoE",
    summary:
      "Daftar akun pelanggan ISP, username PPPoE, alamat instalasi, ODP terhubung, dan status operasional.",
    metrics: [
      {
        name: "Total Pelanggan",
        description: "Seluruh basis pelanggan terdaftar dalam sistem.",
      },
      {
        name: "Pelanggan Online",
        description: "Pengguna dengan sesi antarmuka PPPoE aktif saat ini.",
      },
    ],
    troubleshooting: [
      {
        issue: "Username PPPoE tidak muncul",
        solution:
          "Periksa kembali status sesi PPPoE aktif pada router MikroTik.",
      },
    ],
  },
  "/app/billing": {
    pagePath: "/app/billing",
    pageTitle: "Sinkronisasi Billing & Status Pelanggan",
    summary:
      "Penyelarasan status langganan PPPoE dengan catatan tagihan pembayaran (Lunas vs Isolir).",
    metrics: [
      {
        name: "Tingkat Keselarasan",
        description: "Persentase kecocokan nama PPPoE dengan database tagihan.",
      },
      {
        name: "Pelanggan Isolir",
        description:
          "Pengguna yang ditangguhkan layanannya karena tagihan lewat jatuh tempo.",
      },
    ],
    troubleshooting: [
      {
        issue: "Sinkronisasi billing gagal beruntun",
        solution:
          "Periksa kredensial portal billing di variabel BILLING_URL, USERNAME, dan PASSWORD.",
      },
    ],
  },
  "/app/pengaturan": {
    pagePath: "/app/pengaturan",
    pageTitle: "Pengaturan Sistem & Notifikasi",
    summary:
      "Konfigurasi batas ambang peringatan (CPU, queue, redaman), gateway WhatsApp, dan preferensi akun.",
    metrics: [
      {
        name: "Ambang Batas Alert",
        description: "Batas pemicu otomatis alert gangguan jaringan.",
      },
      {
        name: "Status Gateway WA",
        description: "Kesiapan bot WhatsApp mengirim pesan darurat.",
      },
    ],
    troubleshooting: [
      {
        issue: "Pengaturan tidak tersimpan ke server",
        solution:
          "Pastikan Anda memiliki izin peran Admin untuk memperbarui konfigurasi sistem.",
      },
    ],
  },
  "/app/migrasi": {
    pagePath: "/app/migrasi",
    pageTitle: "Migrasi Skema Database",
    summary:
      "Penerapan skema database otomatis berbasis Drizzle ORM tanpa perlu eksekusi SQL manual.",
    metrics: [
      {
        name: "Versi Skema",
        description:
          "Nomor batch migrasi skema database yang telah diterapkan.",
      },
      {
        name: "Status Drizzle",
        description:
          "Kondisi keselarasan skema database runtime dengan schema file.",
      },
    ],
    troubleshooting: [
      {
        issue: "Migrasi berstatus pending atau gagal",
        solution:
          "Jalankan npm run db:migrate dan periksa koneksi variabel DATABASE_URL.",
      },
    ],
  },
  "/app/sinkronisasi": {
    pagePath: "/app/sinkronisasi",
    pageTitle: "Sinkronisasi Data Otomatis",
    summary:
      "Penyelarasan data seed bawaan, transfer data konfigurasi lokal ke server, dan log histori sinkronisasi.",
    metrics: [
      {
        name: "Status Sinkronisasi",
        description: "Indikasi apakah data lokal dan server sudah sejalan.",
      },
      {
        name: "Log Histori",
        description:
          "Daftar operasi sinkronisasi yang pernah dieksekusi beserta hasilnya.",
      },
    ],
    troubleshooting: [
      {
        issue: "Sinkronisasi tertunda atau konflik data",
        solution:
          "Gunakan tombol 'Sinkronkan Ulang Sekarang' untuk memicu rekonsiliasi manual.",
      },
    ],
  },
  "/app/pengaman-deploy": {
    pagePath: "/app/pengaman-deploy",
    pageTitle: "Pengaman Deploy & Kesiapan Rilis",
    summary:
      "Pemeriksaan kesehatan sistem (health check), cadangan snapshot, rollback otomatis, dan verifikasi nol dummy.",
    metrics: [
      {
        name: "Health Score",
        description:
          "Status kelulusan seluruh probe layanan (DB, Redis, Go, REST).",
      },
      {
        name: "Integritas Snapshot",
        description: "Ketersediaan titik cadangan konfigurasi untuk rollback.",
      },
    ],
    troubleshooting: [
      {
        issue: "Verifikasi nol dummy gagal",
        solution:
          "Jalankan npm run deploy:verify:zero-dummy dan pastikan seluruh mode simulator telah dimatikan.",
      },
    ],
  },
  "/app/jejak-aktivitas": {
    pagePath: "/app/jejak-aktivitas",
    pageTitle: "Jejak Aktivitas & Audit Log",
    summary:
      "Rekam jejak setiap aksi operator NOC: perubahan perangkat, pengubahan ambang batas, dan penanganan alert.",
    metrics: [
      {
        name: "Total Aksi Tercatat",
        description: "Jumlah log audit dalam 30 hari terakhir.",
      },
      {
        name: "Kategori Perubahan",
        description:
          "Aktivitas dikelompokkan berdasarkan modul perangkat / alert.",
      },
    ],
    troubleshooting: [
      {
        issue: "Ada aksi operator yang tidak tercatat",
        solution:
          "Periksa apakah tabel audit_log di database terisi dan gagal-aman aktif.",
      },
    ],
  },
  "/app/ekspor": {
    pagePath: "/app/ekspor",
    pageTitle: "Ekspor Laporan & Data NOC",
    summary:
      "Pembuatan berkas laporan metrik performa jaringan, daftar pelanggan, dan rekap alert format CSV/PDF.",
    metrics: [
      {
        name: "Rentang Laporan",
        description:
          "Periode waktu data yang diunduh (harian, mingguan, bulanan).",
      },
      {
        name: "Format File",
        description: "Pilihan berkas ekspor: CSV, Excel, atau PDF Ringkasan.",
      },
    ],
    troubleshooting: [
      {
        issue: "Unduhan gagal saat ukuran data besar",
        solution:
          "Gunakan filter rentang waktu lebih sempit atau ekspor dalam format CSV terkompresi.",
      },
    ],
  },
  "/app/onboarding": {
    pagePath: "/app/onboarding",
    pageTitle: "Pusat Onboarding & Tutorial Wajib",
    summary:
      "Panduan interaktif integrasi aplikasi dari awal hingga sistem siap dipromosikan ke tahap go-live produksi.",
    metrics: [
      {
        name: "Progres Langkah",
        description: "Persentase penyelesaian tahapan wajib dan opsional.",
      },
      {
        name: "Gerbang Konfigurasi",
        description:
          "Status kelulusan router MikroTik sebagai syarat fungsi utama.",
      },
    ],
    troubleshooting: [
      {
        issue: "Gerbang konfigurasi tetap tertahan",
        solution:
          "Buka form uji MikroTik dan klik 'Simpan & Buka Gerbang Wajib Onboarding' setelah uji koneksi sukses.",
      },
    ],
  },
};

/**
 * Mengambil data tips untuk rute halaman tertentu.
 */
export function getPageTips(pathname: string): PageTipItem | null {
  if (PAGE_TIPS_REGISTRY[pathname]) {
    return PAGE_TIPS_REGISTRY[pathname];
  }
  // Cek prefix kecocokan
  const match = Object.keys(PAGE_TIPS_REGISTRY).find(
    (k) => k !== "/app" && pathname.startsWith(k),
  );
  return match ? PAGE_TIPS_REGISTRY[match] : PAGE_TIPS_REGISTRY["/app"] || null;
}
