// Pemetaan galat koneksi MikroTik REST. Murni (tanpa jaringan), aman diimpor server-side.
import { DeviceConnectionError } from "@/lib/device-connection";

export type MikrotikErrorCode =
  | "INVALID_HOST"
  | "AUTH_FAILED"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "CONNECTION_REFUSED"
  | "CONNECTION_CLOSED"
  | "DNS_ERROR"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "WRONG_PORT"
  | "TLS_ERROR"
  | "CONNECTION_FAILED";

export interface MikrotikMappedError {
  code: MikrotikErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  title: string;
  hint: string;
  command?: string;
}

export class MikrotikError extends DeviceConnectionError {
  readonly mapped: MikrotikMappedError;
  override cause?: unknown;

  constructor(mapped: MikrotikMappedError, cause?: unknown) {
    super(mapped.code, mapped.message);
    this.name = "MikrotikError";
    this.mapped = mapped;
    if (cause !== undefined) this.cause = cause;
  }
}

type Context = { host?: string; port?: number };

const where = (ctx?: Context) =>
  ctx?.host ? ` ${ctx.host}${ctx.port ? `:${ctx.port}` : ""}` : "";

// Bentuk dasar tiap kode; message diisi pemanggil.
const TABLE: Record<
  MikrotikErrorCode,
  Omit<MikrotikMappedError, "code" | "message">
> = {
  INVALID_HOST: {
    status: 422,
    retryable: false,
    title: "Alamat router tidak valid",
    hint: "Isi host berupa IP atau domain saja, tanpa path, spasi, atau kredensial.",
  },
  TIMEOUT: {
    status: 504,
    retryable: true,
    title: "Koneksi ke router timeout",
    hint: "Router tidak menjawab tepat waktu. Periksa router menyala, rute jaringan, dan firewall.",
  },
  AUTH_FAILED: {
    status: 502,
    retryable: false,
    title: "Login router ditolak",
    hint: "Periksa username dan password akun RouterOS (butuh hak akses api/rest).",
  },
  CONNECTION_CLOSED: {
    status: 502,
    retryable: true,
    title: "Router menutup koneksi",
    hint: "Router menerima sambungan lalu langsung memutusnya. Biasanya IP server ini tidak ada di daftar yang diizinkan layanan www (/ip service, kolom address). TAMBAHKAN IP server ke daftar yang sudah ada (jangan mengganti). Jika jalur melewati NAT, alamat yang dilihat router bisa berbeda: cek /ip firewall connection print where dst-port=<port-www>.",
    command: "/ip service set www address=<DAFTAR-LAMA>,<IP-SERVER>/32",
  },
  CONNECTION_REFUSED: {
    status: 502,
    retryable: true,
    title: "Koneksi ditolak router",
    hint: "Port REST mati atau salah. Cek layanan www dan PORT yang berlaku di router, lalu isi port itu di form (atau tulis IP:port di host). Jika bertanda X, aktifkan dengan /ip service enable www.",
    command: '/ip service print where name~"www"',
  },
  NOT_FOUND: {
    status: 502,
    retryable: false,
    title: "Endpoint REST tidak ditemukan",
    hint: "REST belum aktif. Pastikan RouterOS v7 dan layanan www-ssl aktif.",
    command: "/ip service set www-ssl disabled=no",
  },
  DNS_ERROR: {
    status: 502,
    retryable: true,
    title: "Host tidak ditemukan",
    hint: "Nama host tidak bisa di-resolve. Periksa ejaan domain atau pakai alamat IP.",
  },
  NETWORK_ERROR: {
    status: 502,
    retryable: true,
    title: "Jaringan ke router bermasalah",
    hint: "Router tidak dapat dijangkau. Pastikan alamat benar, router menyala, dan jaringan tersambung.",
  },
  HTTP_ERROR: {
    status: 502,
    retryable: false,
    title: "Router membalas galat HTTP",
    hint: "Router membalas status tak terduga. Periksa log RouterOS.",
  },
  WRONG_PORT: {
    status: 422,
    retryable: false,
    title: "Port bukan layanan REST",
    hint: "REST RouterOS jalan di layanan www (80) atau www-ssl (443). Port 8728/8729 adalah API biner, dan port Winbox (8291) tidak melayani HTTP.",
    command: "/ip service print",
  },
  TLS_ERROR: {
    status: 502,
    retryable: false,
    title: "Sertifikat HTTPS router tidak dipercaya",
    hint: "www-ssl RouterOS memakai sertifikat self-signed secara bawaan. Pasang sertifikat yang valid di router, atau pakai layanan www (HTTP) lewat jaringan privat/VPN. Bila router sebenarnya tidak memakai HTTPS di port ini, hilangkan centang HTTPS.",
    command: "/ip service print",
  },
  CONNECTION_FAILED: {
    status: 502,
    retryable: false,
    title: "Gagal terhubung ke router",
    hint: "Penyebab tidak dikenal. Periksa alamat, port, dan log server.",
  },
};

function build(
  code: MikrotikErrorCode,
  message: string,
  over?: Partial<MikrotikMappedError>,
): MikrotikMappedError {
  return { ...TABLE[code], ...over, code, message };
}

function httpStatusOf(err: unknown): number | null {
  if (typeof err === "number") return Number.isInteger(err) ? err : null;
  if (typeof err === "string")
    return /^\d{3}$/.test(err.trim()) ? Number(err.trim()) : null;
  if (err && typeof err === "object") {
    const o = err as { status?: unknown; statusCode?: unknown };
    for (const v of [o.status, o.statusCode]) {
      if (typeof v === "number" && Number.isInteger(v)) return v;
      if (typeof v === "string" && /^\d{3}$/.test(v.trim()))
        return Number(v.trim());
    }
  }
  return null;
}

function fromHttpStatus(s: number, ctx?: Context): MikrotikMappedError | null {
  if (s === 401 || s === 403)
    return build(
      "AUTH_FAILED",
      `Router${where(ctx)} menolak login (HTTP ${s}): periksa username dan password.`,
    );
  if (s === 404)
    return build(
      "NOT_FOUND",
      `Endpoint REST tidak ditemukan (HTTP 404). Pastikan RouterOS v7 dan layanan www/www-ssl aktif.`,
    );
  if (s >= 500 && s <= 599)
    return build("HTTP_ERROR", `Router${where(ctx)} membalas HTTP ${s}.`, {
      retryable: true,
    });
  if (s >= 300)
    return build("HTTP_ERROR", `Router${where(ctx)} membalas HTTP ${s}.`);
  return null;
}

const KNOWN = new Set<string>(Object.keys(TABLE));

function fromCode(
  code: string,
  message: string,
  ctx?: Context,
): MikrotikMappedError {
  if (KNOWN.has(code)) return build(code as MikrotikErrorCode, message);
  // Kode luar daftar (mis. UNREACHABLE) diperlakukan sebagai galat jaringan.
  if (code === "UNREACHABLE") return build("NETWORK_ERROR", message);
  return build(
    "CONNECTION_FAILED",
    message || `Gagal menghubungi router${where(ctx)}.`,
  );
}

export function mapMikrotikError(
  err: unknown,
  context?: Context,
): MikrotikMappedError {
  if (err instanceof MikrotikError) return err.mapped;
  if (err instanceof DeviceConnectionError)
    return fromCode(err.code, err.message, context);

  const status = httpStatusOf(err);
  if (status !== null) {
    const m = fromHttpStatus(status, context);
    if (m) return m;
  }

  if (err && typeof err === "object") {
    const e = err as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      cause?: { code?: unknown };
    };
    const text = [e.message, e.code, e.cause?.code]
      .filter((v) => typeof v === "string")
      .join(" ");
    const label = `router${where(context)}`;
    if (
      e.name === "AbortError" ||
      /ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/.test(text)
    )
      return build(
        "TIMEOUT",
        `Koneksi ke ${label} lambat atau terputus (timeout).`,
      );
    if (
      /ECONNRESET|UND_ERR_SOCKET|other side closed|socket hang up|EPIPE|forcibly closed|wsarecv|wsasend|WSAECONNRESET/i.test(
        text,
      )
    )
      return build(
        "CONNECTION_CLOSED",
        `Router${where(context)} menutup koneksi setelah tersambung: kemungkinan IP server ini tidak diizinkan di address= layanan www.`,
      );
    if (text.includes("ECONNREFUSED"))
      return build(
        "CONNECTION_REFUSED",
        `Koneksi ditolak oleh ${label}. Pastikan port terbuka.`,
      );
    if (/ENOTFOUND|EAI_AGAIN/.test(text))
      return build(
        "DNS_ERROR",
        "Host tidak ditemukan. Pastikan alamat IP atau domain benar.",
      );
    // Sebelum cabang "fetch failed": kegagalan TLS juga datang sebagai "fetch failed".
    if (
      /SELF_SIGNED|UNABLE_TO_VERIFY|CERT_|ERR_TLS|ERR_SSL|EPROTO|certificate/i.test(
        text,
      )
    )
      return build(
        "TLS_ERROR",
        `Koneksi HTTPS ke ${label} gagal: sertifikat tidak dipercaya atau router tidak berbicara HTTPS di port ini.`,
      );
    if (/EHOSTUNREACH|ENETUNREACH|fetch failed|NetworkError/.test(text))
      return build(
        "NETWORK_ERROR",
        `Gagal menghubungi ${label}. Pastikan alamat benar dan perangkat menyala.`,
      );
    if (typeof e.message === "string" && e.message)
      return build(
        "CONNECTION_FAILED",
        `Gagal menghubungi ${label}: ${e.message}`,
      );
  }

  return build(
    "CONNECTION_FAILED",
    `Gagal menghubungi router${where(context)}: kesalahan tidak dikenal`,
  );
}
