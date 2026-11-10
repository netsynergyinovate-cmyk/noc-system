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
  // Transport router dan alamat lokal backend menuju router (dari telemetri Go).
  protocol?: "rest" | "api" | null;
  sourceIp?: string | null;
  localSourceIp?: string | null;
}

export type UnreachableCause =
  "closed" | "timeout" | "refused" | "auth" | "dns" | "wrong-port" | "unknown";

export interface UnreachableDiagnosis {
  cause: UnreachableCause;
  title: string;
  hint: string;
  // Perintah RouterOS yang membantu; kosong bila tidak relevan.
  command?: string;
}

export interface UnreachableContext {
  // Alamat publik backend yang menuju router (wire.RouterHealth.sourceIp).
  sourceIp?: string | null;
  // Alamat LAN backend; router di jaringan yang sama bisa melihat ini.
  localSourceIp?: string | null;
  // Isi address= layanan saat ini (dibaca backend). Bila ada, perintah
  // MENAMBAHKAN IP baru tanpa menghapus entri lama.
  existingAddress?: string | null;
  protocol?: "rest" | "api" | null;
}

/**
 * Perintah satu baris untuk layanan RouterOS. Bila `existingAddress` diketahui,
 * entri lama dipertahankan dan IP baru ditambahkan. Bila tidak, daftar diganti
 * dengan IP server (akses Winbox/SSH tidak terpengaruh).
 */
export function formatAllowListEntry(ip: string): string {
  const clean = ip.trim();
  if (clean.includes("/")) return clean;
  const parts = clean.split(".");
  if (parts.length === 4) {
    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    // Subnet privat RFC 1918 (10.x, 192.168.x, 172.16-31.x): gunakan /24
    // agar IP dinamis DHCP modem/server pasca-reboot tidak memutuskan koneksi.
    if (
      p0 === 10 ||
      (p0 === 192 && p1 === 168) ||
      (p0 === 172 && p1 >= 16 && p1 <= 31)
    ) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }
    return `${clean}/32`;
  }
  return clean.includes(":") ? `${clean}/128` : `${clean}/32`;
}

export function allowListCommand(
  service: "www" | "api",
  sourceIp?: string | null,
  localSourceIp?: string | null,
  existingAddress?: string | null,
): string | undefined {
  const rawList = [sourceIp, localSourceIp]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  const newEntries = [...new Set(rawList.map(formatAllowListEntry))];
  const existing = (existingAddress ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const entries = [...new Set([...existing, ...newEntries])];
  if (entries.length === 0) return undefined;
  return `/ip service set ${service} address=${entries.join(",")}`;
}

// Urutan penting: yang paling spesifik lebih dulu.
export function diagnoseUnreachable(
  lastError: string,
  ctx: UnreachableContext = {},
): UnreachableDiagnosis {
  const e = (lastError ?? "").toLowerCase();
  const service: "www" | "api" = ctx.protocol === "api" ? "api" : "www";
  const label = service === "api" ? "api/api-ssl" : "www/www-ssl";
  const sourceIp = (ctx.sourceIp ?? "").trim();
  const localSourceIp = (ctx.localSourceIp ?? "").trim();
  const ipLabel = [...new Set([sourceIp, localSourceIp].filter(Boolean))].join(
    " / ",
  );
  if (/menolak login|http 40[13]|unauthorized/.test(e)) {
    return {
      cause: "auth",
      title: "Login ke router ditolak",
      hint: `Username atau kata sandi akun router berubah, atau akun itu kehilangan izin ${service === "api" ? "API" : "REST"}. Perbarui kredensial di halaman Router.`,
    };
  }
  if (
    /no such host|tidak ditemukan|lookup|getaddrinfo|wsahostnotfound/.test(e)
  ) {
    return {
      cause: "dns",
      title: "Alamat router tidak ditemukan",
      hint: "Nama host tidak bisa di-resolve. Periksa alamat router atau gunakan alamat IP.",
    };
  }
  if (
    /refused|ditolak oleh|actively refused|wsaeconnrefused|target machine actively refused/.test(
      e,
    )
  ) {
    return {
      cause: "refused",
      title:
        service === "api"
          ? "Layanan API router mati"
          : "Layanan REST router mati",
      hint:
        service === "api"
          ? "Router terjangkau tetapi layanan api/api-ssl tidak aktif atau portnya berubah. Aktifkan lagi di router."
          : "Router terjangkau tetapi layanan www tidak aktif atau portnya berubah. Aktifkan lagi di router.",
      command: `/ip service set ${service} disabled=no`,
    };
  }
  if (
    /eof|reset by peer|connection reset|broken pipe|ditutup|forcibly closed|closed by the remote host|wsarecv|wsasend|connection closed|aborted by the software|wsaeconnaborted|wsaeconnreset|connection aborted/.test(
      e,
    )
  ) {
    const command = allowListCommand(
      service,
      sourceIp,
      localSourceIp,
      ctx.existingAddress,
    );
    return {
      cause: "closed",
      title: "Router menutup koneksi",
      hint: command
        ? `Router menerima sambungan lalu langsung menutupnya. IP server ini (${ipLabel}) belum ada di kolom address= layanan ${label}. Perintah di bawah ${ctx.existingAddress ? "MENAMBAHKAN IP itu ke daftar yang sudah ada (entri lama dipertahankan)" : "MENGGANTI daftar address= dengan IP itu"}; akses Winbox/SSH tidak terpengaruh. Tempel apa adanya.`
        : `Router menerima sambungan lalu langsung menutupnya. Biasanya alamat IP server ini tidak ada di daftar yang diizinkan layanan ${label}. Jalankan perintah di bawah untuk melihat daftar, lalu tambahkan IP server yang tampil di backend.`,
      command: command ?? `/ip service print where name~"${service}"`,
    };
  }
  if (
    /timeout|timed out|deadline|tidak menjawab|i\/o timeout|unreachable|did not properly respond|semaphore timeout|wsatimedout/.test(
      e,
    )
  ) {
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
      hint: "Gunakan port layanan www (80) atau www-ssl (443), bukan port API biner (8728/8729). Atau ubah protokol router menjadi Binary API.",
      command: `/ip service print where name~"www"`,
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
export function describeLastOk(
  lastOkAt: number | null,
  nowSec: number,
): string {
  if (lastOkAt === null)
    return "Belum ada pembacaan yang berhasil sejak backend menyala.";
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
export function unreachableRouters(
  list: readonly RouterHealth[],
): RouterHealth[] {
  return list.filter((r) => r.active && !r.reachable);
}
