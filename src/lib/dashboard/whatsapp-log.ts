// Riwayat pengiriman notifikasi WhatsApp (data tiruan, fungsi waktu saja).
// Kontrak GET /api/v1/notifications/whatsapp di backend kelak: `sentAt` detik epoch.

export type WaDeliveryStatus = "delivered" | "sent" | "failed";

export interface WhatsappNotificationLog {
  id: string;
  recipientName: string;
  recipientPhone: string;
  alertId: string;
  severity: "critical" | "warning";
  kind: string;
  message: string;
  status: WaDeliveryStatus;
  sentAt: number; // detik epoch
  latencyMs: number | null;
  errorReason?: string;
}

export interface WhatsappLogFilter {
  status: WaDeliveryStatus | "all";
  severity: "critical" | "warning" | "all";
  query: string;
  /** Tanpa nilai = "all". */
  timeRange?: "all" | "1h" | "24h" | "7d";
}

export interface WhatsappLogSummary {
  total: number;
  delivered: number;
  sent: number;
  failed: number;
  /** Persen pesan tidak gagal, 0-100 (satu desimal). 0 bila kosong. */
  successRate: number;
  /** Rata-rata latensi (ms, dibulatkan) pesan yang punya latensi; null bila tidak ada. */
  avgLatencyMs: number | null;
}

const WA_LOG_COUNT = 24;
const WA_LOG_SPAN = 7 * 24 * 3600;

const recipients = [
  { name: "Budi Santoso", phone: "6281234567890" },
  { name: "Dewi Lestari", phone: "6281298765432" },
  { name: "Agus Prasetyo", phone: "6285711223344" },
];

const kinds = [
  {
    kind: "Router offline",
    severity: "critical" as const,
    text: "Router tidak merespons REST API",
  },
  {
    kind: "Pelanggan offline",
    severity: "critical" as const,
    text: "Sesi PPPoE pelanggan terputus",
  },
  {
    kind: "CPU tinggi",
    severity: "warning" as const,
    text: "CPU router di atas ambang 85%",
  },
  {
    kind: "Redaman optik",
    severity: "warning" as const,
    text: "Redaman ONU melewati -27 dBm",
  },
];

const failReasons = [
  "Gateway timeout",
  "Nomor tidak terdaftar di WhatsApp",
  "Kuota gateway habis",
];

export function mockWhatsappLogs(now: number): WhatsappNotificationLog[] {
  const step = Math.floor(WA_LOG_SPAN / WA_LOG_COUNT);
  const logs: WhatsappNotificationLog[] = [];
  for (let i = 0; i < WA_LOG_COUNT; i++) {
    const r = recipients[i % recipients.length];
    const k = kinds[(i * 7 + 1) % kinds.length];
    // 1 dari 6 gagal, 1 dari 4 baru "terkirim"; sisanya diterima.
    const status: WaDeliveryStatus =
      i % 6 === 2 ? "failed" : i % 4 === 1 ? "sent" : "delivered";
    const sentAt = Math.floor(now) - 600 - i * step - ((i * 977) % 3000);
    const alertId = `alert-${1000 + i * 13}`;
    const time = new Date(sentAt * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    logs.push({
      id: `wa-${i + 1}`,
      recipientName: r.name,
      recipientPhone: r.phone,
      alertId,
      severity: k.severity,
      kind: k.kind,
      message: `[${k.severity === "critical" ? "KRITIS" : "PERINGATAN"}] ${k.kind}\n${k.text}\nWaktu: ${time} UTC\nID: ${alertId}`,
      status,
      sentAt,
      latencyMs: status === "failed" ? null : 200 + ((i * 131) % 651),
      ...(status === "failed"
        ? { errorReason: failReasons[i % failReasons.length] }
        : {}),
    });
  }
  return logs;
}

// Log yang dicatat pengiriman uji: localStorage key `whatsappLogs`, memori saja
// bila penyimpanan diblokir. Digabung dengan data tiruan oleh loadWhatsappLogs.
export const WHATSAPP_LOG_STORAGE_KEY = "whatsappLogs";
const MAX_RECORDED_LOGS = 100;

export type WhatsappLogStorage = Pick<Storage, "getItem" | "setItem">;

export function createWhatsappLogStore(
  storage: () => WhatsappLogStorage | null = () => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  },
) {
  let memory: WhatsappNotificationLog[] = [];
  let memoryOnly = false;

  const valid = (v: unknown): v is WhatsappNotificationLog => {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return (
      typeof o.id === "string" &&
      typeof o.recipientName === "string" &&
      typeof o.recipientPhone === "string" &&
      typeof o.alertId === "string" &&
      (o.severity === "critical" || o.severity === "warning") &&
      typeof o.kind === "string" &&
      typeof o.message === "string" &&
      (o.status === "delivered" ||
        o.status === "sent" ||
        o.status === "failed") &&
      typeof o.sentAt === "number" &&
      Number.isFinite(o.sentAt) &&
      (o.latencyMs === null || typeof o.latencyMs === "number")
    );
  };

  function read(): WhatsappNotificationLog[] {
    if (memoryOnly) return memory;
    try {
      const store = storage();
      if (store === null) throw new Error("no storage");
      const raw = store.getItem(WHATSAPP_LOG_STORAGE_KEY);
      if (raw === null) return memory;
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter(valid) : [];
    } catch (e) {
      // JSON rusak: abaikan; penyimpanan tidak ada/diblokir: pakai memori.
      if (e instanceof SyntaxError) return [];
      memoryOnly = true;
      return memory;
    }
  }

  function record(
    entry: Omit<WhatsappNotificationLog, "id" | "sentAt">,
  ): WhatsappNotificationLog {
    const list = read();
    const stamp = Date.now();
    let id = `wa-log-test-${stamp}`;
    for (let n = 1; list.some((l) => l.id === id); n++)
      id = `wa-log-test-${stamp}-${n}`;
    const created: WhatsappNotificationLog = {
      ...entry,
      id,
      sentAt: stamp / 1000,
    };
    const next = [created, ...list].slice(0, MAX_RECORDED_LOGS);
    memory = next;
    if (!memoryOnly) {
      try {
        const store = storage();
        if (store === null) throw new Error("no storage");
        store.setItem(WHATSAPP_LOG_STORAGE_KEY, JSON.stringify(next));
      } catch {
        memoryOnly = true;
      }
    }
    return created;
  }

  function load(now: number): WhatsappNotificationLog[] {
    return [...read(), ...mockWhatsappLogs(now)].sort(
      (a, b) => b.sentAt - a.sentAt,
    );
  }

  return { record, load, read };
}

const logStore = createWhatsappLogStore();

export const recordWhatsappLog = logStore.record;
export const loadWhatsappLogs = logStore.load;

export const WA_TIME_RANGE_SECONDS = {
  "1h": 3600,
  "24h": 86400,
  "7d": 604800,
} as const;

const nowSeconds = () => Math.floor(Date.now() / 1000);

// ponytail: sentAt di masa depan tetap lolos rentang (log uji dicatat sedikit
// setelah `now` beku milik komponen); tambah batas atas bila backend nyata perlu.
function matchesWith(
  l: WhatsappNotificationLog,
  { status, severity, timeRange = "all" }: Omit<WhatsappLogFilter, "query">,
  words: string[],
  nowSec: number,
): boolean {
  if (status !== "all" && l.status !== status) return false;
  if (severity !== "all" && l.severity !== severity) return false;
  if (
    timeRange !== "all" &&
    l.sentAt < nowSec - WA_TIME_RANGE_SECONDS[timeRange]
  )
    return false;
  if (words.length === 0) return true;
  const hay =
    `${l.recipientName} ${l.recipientPhone} ${l.message} ${l.kind} ${l.errorReason ?? ""}`
      .normalize("NFC")
      .toLowerCase();
  return words.every((w) => hay.includes(w));
}

const toWords = (query: string) =>
  query.normalize("NFC").toLowerCase().split(/\s+/).filter(Boolean);

export function filterWhatsappLogs(
  logs: WhatsappNotificationLog[],
  filter: WhatsappLogFilter,
  nowSec: number = nowSeconds(),
): WhatsappNotificationLog[] {
  const words = toWords(filter.query);
  return logs.filter((l) => matchesWith(l, filter, words, nowSec));
}

export interface WhatsappLogFacetCounts {
  status: Record<WaDeliveryStatus | "all", number>;
  severity: Record<"critical" | "warning" | "all", number>;
  timeRange: Record<"all" | "1h" | "24h" | "7d", number>;
}

/** Jumlah baris bila opsi dipilih, dengan dimensi filter lain tetap berlaku. */
export function getWhatsappLogFacetCounts(
  logs: WhatsappNotificationLog[],
  filter: WhatsappLogFilter,
  nowSec: number = nowSeconds(),
): WhatsappLogFacetCounts {
  const words = toWords(filter.query);
  const count = (override: Partial<Omit<WhatsappLogFilter, "query">>) =>
    logs.filter((l) =>
      matchesWith(l, { ...filter, ...override }, words, nowSec),
    ).length;
  return {
    status: {
      all: count({ status: "all" }),
      delivered: count({ status: "delivered" }),
      sent: count({ status: "sent" }),
      failed: count({ status: "failed" }),
    },
    severity: {
      all: count({ severity: "all" }),
      critical: count({ severity: "critical" }),
      warning: count({ severity: "warning" }),
    },
    timeRange: {
      all: count({ timeRange: "all" }),
      "1h": count({ timeRange: "1h" }),
      "24h": count({ timeRange: "24h" }),
      "7d": count({ timeRange: "7d" }),
    },
  };
}

const csvCell = (v: string | number | null | undefined): string => {
  let s = v === null || v === undefined ? "" : String(v);
  // Cegah injeksi rumus saat dibuka di spreadsheet.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function whatsappLogsToCsv(logs: WhatsappNotificationLog[]): string {
  const head = [
    "id",
    "waktu_utc",
    "penerima",
    "nomor",
    "alert_id",
    "keparahan",
    "jenis",
    "status",
    "latensi_ms",
    "alasan_gagal",
    "pesan",
  ];
  const lines = logs.map((l) =>
    [
      l.id,
      new Date(l.sentAt * 1000).toISOString(),
      l.recipientName,
      l.recipientPhone,
      l.alertId,
      l.severity,
      l.kind,
      l.status,
      l.latencyMs,
      l.errorReason,
      l.message,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n");
}

export const WHATSAPP_LOG_MOCK_ENTRY = {
  id: "whatsapp-notification-log",
  module: "Log Notifikasi WhatsApp",
  targetDevice: "Gateway WhatsApp / DB network_logs",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/whatsapp-log.ts (loadWhatsappLogs)",
  writePath: "POST /api/v1/notifications/whatsapp/resend",
  envKey: "WHATSAPP_API_KEY",
  notes:
    "Tiruan sementara log pengiriman pesan WhatsApp; wajib dialihkan ke tabel log database di Fase 5",
};

export function summarizeWhatsappLogs(
  logs: WhatsappNotificationLog[],
): WhatsappLogSummary {
  const count = (s: WaDeliveryStatus) =>
    logs.filter((l) => l.status === s).length;
  const failed = count("failed");
  const lat = logs
    .map((l) => l.latencyMs)
    .filter((v): v is number => v !== null);
  return {
    total: logs.length,
    delivered: count("delivered"),
    sent: count("sent"),
    failed,
    successRate: logs.length
      ? Math.round(((logs.length - failed) / logs.length) * 1000) / 10
      : 0,
    avgLatencyMs: lat.length
      ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length)
      : null,
  };
}
