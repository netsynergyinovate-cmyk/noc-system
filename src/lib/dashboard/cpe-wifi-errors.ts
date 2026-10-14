// Pemetaan galat perubahan SSID CPE (POST /api/cpe/tasks) ke teks Indonesia. Murni, tanpa React.
export type CpeWifiErrorCode =
  | "CPE_OFFLINE"
  | "PARAMETER_FAULT"
  | "TASK_CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface CpeWifiErrorView {
  code: CpeWifiErrorCode;
  title: string;
  hint: string;
  canRetry: boolean;
}

const VIEWS: Record<CpeWifiErrorCode, CpeWifiErrorView> = {
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    title: "Sesi kedaluwarsa",
    hint: "Sesi kedaluwarsa, silakan login kembali.",
    canRetry: false,
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    title: "Akses ditolak",
    hint: "Akses ditolak, membutuhkan izin cpe:manage. Hubungi admin.",
    canRetry: false,
  },
  TASK_CONFLICT: {
    code: "TASK_CONFLICT",
    title: "Perintah sebelumnya masih berjalan",
    hint: "Perintah konfigurasi sebelumnya masih berjalan di antrean GenieACS. Tunggu 1-2 menit lalu coba lagi.",
    canRetry: true,
  },
  PARAMETER_FAULT: {
    code: "PARAMETER_FAULT",
    title: "Parameter ditolak modem",
    hint: "Parameter ditolak modem pelanggan (TR-069 Fault 9003/9005). Periksa karakter SSID dan password, hindari simbol khusus.",
    canRetry: false,
  },
  CPE_OFFLINE: {
    code: "CPE_OFFLINE",
    title: "Modem tidak merespons",
    hint: "Modem pelanggan tidak merespons (TR-069 timeout). Pastikan modem menyala dan terhubung, lalu coba lagi.",
    canRetry: true,
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR",
    title: "Gagal terhubung ke server",
    hint: "Gagal terhubung ke server atau layanan GenieACS NBI (port 7557). Periksa koneksi lalu coba lagi.",
    canRetry: true,
  },
  UNKNOWN: {
    code: "UNKNOWN",
    title: "Perintah gagal dikirim",
    hint: "Terjadi kesalahan tak dikenal. Periksa isian lalu coba lagi.",
    canRetry: true,
  },
};

function bodyCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as { code?: unknown; error?: unknown };
  if (typeof b.code === "string") return b.code.toUpperCase();
  if (typeof b.error === "string") return b.error.toUpperCase();
  if (b.error && typeof b.error === "object") {
    const c = (b.error as { code?: unknown }).code;
    if (typeof c === "string") return c.toUpperCase();
  }
  return "";
}

function fromCode(code: string): CpeWifiErrorCode | null {
  if (code === "TASK_CONFLICT") return "TASK_CONFLICT";
  if (code === "PARAMETER_FAULT" || code === "FAULT_9003" || code === "FAULT_9005") return "PARAMETER_FAULT";
  if (code === "CPE_OFFLINE" || code === "DEVICE_UNREACHABLE") return "CPE_OFFLINE";
  return null;
}

/** status 0 = fetch gagal sebelum ada respons. Kode di body menang atas status HTTP. */
export function parseCpeWifiError(status: number, responseBody?: unknown): CpeWifiErrorView {
  const code = fromCode(bodyCode(responseBody));
  if (code) return VIEWS[code];
  if (status === 0) return VIEWS.NETWORK_ERROR;
  if (status === 401) return VIEWS.UNAUTHORIZED;
  if (status === 403) return VIEWS.FORBIDDEN;
  if (status === 409) return VIEWS.TASK_CONFLICT;
  if (status === 422) return VIEWS.PARAMETER_FAULT;
  if (status === 504) return VIEWS.CPE_OFFLINE;
  return VIEWS.UNKNOWN;
}
