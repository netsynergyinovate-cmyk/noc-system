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
  // Langkah perbaikan berurutan. allowIp ada = langkah isian IP (perintah disusun dari isian).
  steps?: {
    title: string;
    detail: string;
    command?: string;
    allowIp?: string;
  }[];
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
  // Alamat router (RouterHealth.host): dasar perintah baca tabel koneksi.
  host?: string | null;
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

// shortcut: hanya IPv4 (dengan /prefix opsional); tambah IPv6 bila ada router yang dihubungi lewat IPv6.
const IPV4 =
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;

/** IP yang boleh disisipkan ke perintah RouterOS (masukan petugas divalidasi ketat). */
export function isAllowListIp(value: string): boolean {
  return IPV4.test(value.trim());
}

/**
 * MENAMBAH satu entri ke address= layanan dengan ekspresi array RouterOS, jadi
 * entri lama tetap ada walau aplikasi tidak bisa membacanya (router menolak kita).
 */
export function appendAllowListCommand(
  service: "www" | "api",
  ip: string,
): string | undefined {
  if (!isAllowListIp(ip)) return undefined;
  return `/ip service set ${service} address=([/ip service get ${service} address],"${formatAllowListEntry(ip)}")`;
}

/** Baca IP sumber server menurut router dari tabel koneksi (hanya baca). */
export function seenSourceCommand(
  host: string,
  service: "www" | "api",
): string | undefined {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(
    host.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/$/, ""),
  );
  if (!m || !isAllowListIp(m[1])) return undefined;
  const port = m[2] ?? (service === "api" ? "8728" : "80");
  return `/ip firewall connection print where protocol=tcp and dst-address~"${m[1]}:${port}\\$"`;
}

export function dropStaleSessionsCommand(service: "www" | "api"): string {
  return `/ip service disable ${service}\n/ip service enable ${service}`;
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
    const guessIp = sourceIp || localSourceIp;
    const seen = ctx.host ? seenSourceCommand(ctx.host, service) : undefined;
    const append = guessIp ? appendAllowListCommand(service, guessIp) : undefined;
    return {
      cause: "closed",
      title: "Router memutus sambungan dari server",
      hint:
        `Router menerima sambungan lalu memutusnya sebelum menjawab (reset/EOF). Penyebabnya di sisi router, ada dua: ` +
        `(1) IP server menurut router tidak ada di daftar address= layanan ${label}. Server di belakang router ini (PPPoE/LAN) atau di dalam Docker terlihat dengan IP internalnya, bukan IP publik, dan IP PPPoE/DHCP itu bisa berganti setelah mati listrik. ` +
        `(2) Slot max-sessions layanan ${label} (bawaan 20) masih terisi sesi lama setelah server atau link mati mendadak. ` +
        (guessIp
          ? `Perkiraan backend: ${ipLabel}, pastikan dulu di langkah 1. `
          : "Backend tidak bisa mengetahui IP itu dari dalam container atau dari balik router ini, jadi baca di langkah 1. ") +
        "Setelah router mengizinkan, backend tersambung sendiri dalam ±2 detik tanpa restart.",
      command: append ?? seen ?? `/ip service print where name~"${service}"`,
      steps: [
        {
          title: "Lihat IP server menurut router",
          detail: `Hanya membaca, tidak mengubah apa pun. Kolom SRC-ADDRESS (tanpa :port) adalah IP server menurut router. Bila kosong, jalankan lagi beberapa detik kemudian; backend mencoba tiap 2 detik.`,
          command: [seen, `/ip service print where name~"${service}"`]
            .filter(Boolean)
            .join("\n"),
        },
        {
          title: "Izinkan IP itu, daftar lama tetap",
          detail: `Isi IP dari langkah 1. Perintah MENAMBAH ke address= ${label}; entri lama dan akses Winbox/SSH tidak berubah. IP privat ditulis /24 supaya tetap cocok bila IP PPPoE/DHCP server berganti setelah mati listrik.`,
          allowIp: guessIp || "",
        },
        {
          title: "Bila masih diputus: buang sesi lama",
          detail: `Mematikan lalu menyalakan layanan ${service} membuang semua sesi lama sekaligus (pengguna webfig/REST lain ikut tersambung ulang).`,
          command: dropStaleSessionsCommand(service),
        },
      ],
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
