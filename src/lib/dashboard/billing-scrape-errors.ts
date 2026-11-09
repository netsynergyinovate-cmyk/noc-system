// Mengubah pesan galat sinkron billing (teks dari log backend) menjadi
// penjelasan untuk operator NOC: apa yang terjadi, dampaknya pada data, apa
// yang perlu dilakukan, dan bagaimana sinkron akan diulang. Murni; pengenalan
// berdasarkan kata kunci, jadi pesan yang tidak dikenal jatuh ke "unknown".

export type BillingScrapeErrorCategory =
  | "credentials"
  | "source_changed"
  | "unknown_status"
  | "empty_source"
  | "anomalous_drop"
  | "network"
  | "timeout"
  | "server_error"
  | "unknown";

export interface BillingScrapeErrorDetail {
  category: BillingScrapeErrorCategory;
  title: string;
  badgeLabel: string;
  tone: "danger" | "warning";
  explanation: string;
  actionHint: string;
  retryBehavior: string;
}

// Urutan penting: yang lebih spesifik lebih dulu (timeout sebelum network
// karena "tidak dapat dihubungi" dan "batas waktu" bisa muncul berdekatan).
const RULES: ReadonlyArray<[BillingScrapeErrorCategory, RegExp]> = [
  ["anomalous_drop", /turun drastis|merosot|\bdrop\b|penyusutan/i],
  ["empty_source", /nol tagihan|satu pun tagihan|sumber (billing )?kosong/i],
  ["unknown_status", /status tagihan tidak dikenal|status.*tidak dikenal/i],
  [
    "credentials",
    /login.*ditolak|kredensial|kata sandi|password|csrf|menolak akses|hak akses/i,
  ],
  ["timeout", /timeout|batas waktu|tidak menjawab/i],
  ["server_error", /gangguan|\b5\d\d\b|5xx|server/i],
  [
    "network",
    /jaringan|tidak dapat dihubungi|gagal menghubungi|tls|sertifikat/i,
  ],
  [
    "source_changed",
    /struktur|selektor|susunan halaman|tampilan.*berubah|tidak terbaca/i,
  ],
];

const KEEP_OLD =
  "Data lama tetap dipertahankan; status pelanggan di bawah tidak terhapus.";
const NO_RETRY =
  "Tidak diulang otomatis: kegagalan ini tidak akan hilang sendiri. Menunggu jadwal berikutnya.";
const TRANSIENT_RETRY =
  "Diulang otomatis beberapa kali dengan jeda bertahap; bila tetap gagal, menunggu jadwal berikutnya.";

export function classifyBillingScrapeError(
  rawMessage: string | null | undefined,
): BillingScrapeErrorCategory {
  const text = typeof rawMessage === "string" ? rawMessage : "";
  for (const [category, pattern] of RULES) {
    if (pattern.test(text)) return category;
  }
  return "unknown";
}

export function parseBillingScrapeError(
  rawMessage: string | null | undefined,
  consecutiveFailures = 1,
): BillingScrapeErrorDetail {
  const category = classifyBillingScrapeError(rawMessage);

  switch (category) {
    case "credentials": {
      const slowed = consecutiveFailures >= 3;
      return {
        category,
        title: "Login ke sistem billing ditolak",
        badgeLabel: "Kredensial",
        tone: "danger",
        explanation: `Akun billing tidak diterima. ${KEEP_OLD}`,
        actionHint:
          "Periksa BILLING_USERNAME dan BILLING_PASSWORD, serta hak akses akun di sistem billing.",
        retryBehavior: slowed
          ? `Gagal ${consecutiveFailures} kali berturut-turut: sinkron diperlambat menjadi setiap 6 jam agar akun tidak terkunci. Tidak diulang sampai kredensial diperbaiki.`
          : "Tidak diulang dalam putaran yang sama. Bila gagal 3 kali berturut-turut, sinkron diperlambat menjadi setiap 6 jam.",
      };
    }
    case "source_changed":
      return {
        category,
        title: "Tampilan sistem billing berubah",
        badgeLabel: "Halaman berubah",
        tone: "danger",
        explanation: `Tabel tagihan tidak terbaca sesuai profil. ${KEEP_OLD}`,
        actionHint:
          "Buka halaman billing dan sesuaikan selektor profil scraper dengan susunan halaman terbaru.",
        retryBehavior: NO_RETRY,
      };
    case "unknown_status":
      return {
        category,
        title: "Status tagihan tidak dikenal",
        badgeLabel: "Status asing",
        tone: "danger",
        explanation: `Sinkron dihentikan agar status asing tidak ditebak (Lunas/Isolir). ${KEEP_OLD}`,
        actionHint:
          "Tambahkan teks status itu ke StatusMap profil bila sah, lalu tunggu sinkron berikutnya.",
        retryBehavior: NO_RETRY,
      };
    case "empty_source":
      return {
        category,
        title: "Sumber billing tidak mengembalikan tagihan",
        badgeLabel: "Sumber kosong",
        tone: "danger",
        explanation: `Proteksi drop guard bekerja: daftar tagihan kosong ditolak supaya pelanggan tidak terisolir massal. ${KEEP_OLD}`,
        actionHint:
          "Periksa halaman billing dan filter tagihan (periode, akun) secara manual; pastikan daftar tidak sengaja kosong.",
        retryBehavior: NO_RETRY,
      };
    case "anomalous_drop":
      return {
        category,
        title: "Jumlah tagihan turun drastis",
        badgeLabel: "Penurunan janggal",
        tone: "danger",
        explanation: `Proteksi drop guard bekerja: penurunan tajam ditolak supaya pelanggan tidak terisolir massal. ${KEEP_OLD}`,
        actionHint:
          "Periksa tampilan billing. Bila penurunan memang benar, atur BILLING_DROP_PERCENT.",
        retryBehavior: NO_RETRY,
      };
    case "network":
      return {
        category,
        title: "Sistem billing tidak dapat dihubungi",
        badgeLabel: "Jaringan",
        tone: consecutiveFailures >= 2 ? "danger" : "warning",
        explanation: `Koneksi ke sistem billing gagal. ${KEEP_OLD}`,
        actionHint:
          "Periksa koneksi server NOC ke billing, DNS, dan sertifikat TLS.",
        retryBehavior: TRANSIENT_RETRY,
      };
    case "timeout":
      return {
        category,
        title: "Sistem billing tidak menjawab tepat waktu",
        badgeLabel: "Timeout",
        tone: consecutiveFailures >= 2 ? "danger" : "warning",
        explanation: `Sinkron melewati batas waktu. ${KEEP_OLD}`,
        actionHint:
          "Periksa beban dan ketersediaan sistem billing; sering sembuh sendiri.",
        retryBehavior: TRANSIENT_RETRY,
      };
    case "server_error":
      return {
        category,
        title: "Sistem billing mengalami gangguan",
        badgeLabel: "Server billing",
        tone: consecutiveFailures >= 2 ? "danger" : "warning",
        explanation: `Sistem billing menjawab dengan galat server (5xx). ${KEEP_OLD}`,
        actionHint:
          "Hubungi pengelola billing bila berlanjut; tidak ada yang perlu diubah di sisi NOC.",
        retryBehavior: TRANSIENT_RETRY,
      };
    default:
      return {
        category: "unknown",
        title: "Sinkron billing gagal",
        badgeLabel: "Tidak dikenal",
        tone: consecutiveFailures >= 2 ? "danger" : "warning",
        explanation: `Penyebab tidak dikenali dari pesan. ${KEEP_OLD}`,
        actionHint: "Baca pesan di atas dan log backend untuk rincian.",
        retryBehavior: "Menunggu jadwal sinkron berikutnya.",
      };
  }
}
