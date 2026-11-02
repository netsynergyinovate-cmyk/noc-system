// Keterjangkauan router dari sisi backend (GET /api/v1/routers/health). Murni:
// menerjemahkan galat teknis menjadi sebab dan langkah perbaikan untuk petugas.

export interface RouterHealth {
  routerId: string;
  name: string;
  host: string;
  active: boolean;
  reachable: boolean;
  failures: number;
  // Sudah disanitasi backend (tanpa kata sandi/token).
  lastError: string;
  lastErrorAt: number | null;
  // null = belum pernah berhasil dibaca sejak backend menyala.
  lastOkAt: number | null;
}

export type UnreachableCause =
  | "closed"
  | "timeout"
  | "refused"
  | "auth"
  | "dns"
  | "wrong-port"
  | "unknown";

export interface UnreachableDiagnosis {
  cause: UnreachableCause;
  title: string;
  hint: string;
  // Perintah RouterOS yang membantu; kosong bila tidak relevan.
  command?: string;
}

// Urutan penting: yang paling spesifik lebih dulu.
export function diagnoseUnreachable(lastError: string): UnreachableDiagnosis {
  const e = (lastError ?? "").toLowerCase();
  if (/menolak login|http 40[13]|unauthorized/.test(e)) {
    return {
      cause: "auth",
      title: "Login ke router ditolak",
      hint: "Username atau kata sandi akun router berubah, atau akun itu kehilangan izin REST. Perbarui kredensial di halaman Router.",
    };
  }
  if (/no such host|tidak ditemukan|lookup/.test(e)) {
    return {
      cause: "dns",
      title: "Alamat router tidak ditemukan",
      hint: "Nama host tidak bisa di-resolve. Periksa alamat router atau gunakan alamat IP.",
    };
  }
  if (/refused|ditolak oleh|actively refused/.test(e)) {
    return {
      cause: "refused",
      title: "Layanan REST router mati",
      hint: "Router terjangkau tetapi layanan www tidak aktif atau portnya berubah. Aktifkan lagi di router.",
      command: "/ip service set www disabled=no",
    };
  }
  if (/eof|reset by peer|connection reset|broken pipe|ditutup/.test(e)) {
    return {
      cause: "closed",
      title: "Router menutup koneksi",
      hint: "Router menerima sambungan lalu langsung menutupnya. Biasanya alamat IP server ini tidak ada di daftar yang diizinkan layanan www (/ip service, kolom address). TAMBAHKAN IP server ke daftar yang sudah ada (jangan mengganti), atau pakai rentang jaringan. Jika jalur ke router melewati NAT, alamat yang dilihat router bisa berbeda: cek dengan `/ip firewall connection print where dst-port=<port-www>` lalu daftarkan alamat di kolom src-address.",
      command: "/ip service set www address=<DAFTAR-LAMA>,<IP-SERVER>/32",
    };
  }
  if (/timeout|timed out|deadline|tidak menjawab|i\/o timeout|unreachable/.test(e)) {
    return {
      cause: "timeout",
      title: "Router tidak menjawab",
      hint: "Router mati, kabel/jaringan putus, atau firewall menjatuhkan paket. Periksa daya dan jaringan router, lalu coba lagi.",
    };
  }
  if (/8728|8729|bukan rest/.test(e)) {
    return {
      cause: "wrong-port",
      title: "Port bukan layanan REST",
      hint: "Gunakan port layanan www (80) atau www-ssl (443), bukan port API biner.",
    };
  }
  return {
    cause: "unknown",
    title: "Router tidak bisa dibaca",
    hint: "Penyebab belum dikenali. Periksa log backend untuk rinciannya.",
  };
}

const jakarta = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
});

/** "10:20:52" (WIB) bersama selang waktunya, mis. "23 menit lalu". */
export function describeLastOk(lastOkAt: number | null, nowSec: number): string {
  if (lastOkAt === null) return "Belum ada pembacaan yang berhasil sejak backend menyala.";
  const ago = Math.max(0, nowSec - lastOkAt);
  const rel =
    ago < 60
      ? `${ago} detik lalu`
      : ago < 3600
        ? `${Math.floor(ago / 60)} menit lalu`
        : ago < 86_400
          ? `${Math.floor(ago / 3600)} jam ${Math.floor((ago % 3600) / 60)} menit lalu`
          : `${Math.floor(ago / 86_400)} hari lalu`;
  return `Data terakhir berhasil dibaca ${jakarta.format(new Date(lastOkAt * 1000))} WIB (${rel}).`;
}

/** Hanya router aktif yang tidak terjangkau; nonaktif dimatikan sengaja. */
export function unreachableRouters(list: readonly RouterHealth[]): RouterHealth[] {
  return list.filter((r) => r.active && !r.reachable);
}
