import { mockRouters } from "./mock-data.ts";
import type { DashboardCustomer } from "./types.ts";
import { hashString, unit } from "./mock-random.ts";
import { paginate, type Page } from "./paging.ts";

// Entri registry Setup Perangkat. TIRUAN SEMENTARA: wajib dialihkan ke tabel
// audit_log nyata di Fase 5 (hapus mockAuditLog, ganti loadAudit).
export const AUDIT_LOG_MOCK_ENTRY = {
  id: "audit-log-events",
  module: "Jejak Aktivitas & Log Audit",
  targetDevice: "Database audit_log PostgreSQL",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/audit.ts (loadAudit)",
  writePath: "src/db/schema/audit-log.ts",
  envKey: "DATABASE_URL",
  notes:
    "Tiruan sementara log riwayat aktivitas operator; wajib dialihkan ke tabel audit_log database nyata di Fase 5",
};

// KONTRAK API JEJAK AKTIVITAS (yang diasumsikan frontend; backend belum
// mengimplementasikannya). Titik ganti ke backend: loadAudit di bawah ->
// GET /api/v1/audit?limit=&before= . Jejak aktivitas adalah catatan siapa
// mengubah apa dan kapan (audit log): login dan logout, alert yang ditandai
// ditangani, perubahan ambang, router, CPE pelanggan, sinkron billing, dan
// pengaturan.
//
//   limit   banyak catatan paling banyak (1 sampai AUDIT_MAX_LIMIT, bawaan
//           semuanya dalam jendela 30 hari, tetapi tidak lebih dari batas itu).
//   before  detik epoch BULAT, eksklusif: hanya catatan yang lebih lama.
//   hasil   { entries: AuditEntry[] }, TERBARU DI ATAS (urut turun menurut
//           `at`), tanpa catatan di masa depan.
//
// ATURAN YANG WAJIB DIJAGA BACKEND DAN FRONTEND:
//
//   1. `actor` diambil dari SESI yang sah di server (id dan nama petugas), tidak
//      pernah dari isi permintaan. Kejadian otomatis (mis. sinkron billing yang
//      berjalan sendiri) memakai AUDIT_SYSTEM_ACTOR.
//   2. `at` memakai JAM SERVER dan berupa detik epoch BULAT, seperti kontrak
//      alert dan billing. Jam browser tidak pernah dipakai.
//   3. TIDAK ADA RAHASIA di log: kata sandi Wi-Fi, kata sandi router, token bot,
//      kunci API dan sejenisnya ditulis sebagai kejadian TANPA nilai ("kata sandi
//      Wi-Fi diubah"). Perubahan bidang rahasia hanya boleh berbentuk
//      { field, redacted: true } tanpa `from` dan `to`. Jaminannya berlapis:
//      tipe AuditChange melarang `from`/`to` pada bidang yang disembunyikan,
//      `changed()` menolak nama bidang rahasia dan nilai yang tampak seperti
//      rahasia, dan `buildAuditEntry` memeriksa ulang SEMUA teks sebuah catatan.
//      Backend juga memakai aturan yang sama sebelum menulis ke tabel log.
//   4. Catatan tidak pernah diubah atau dihapus (hanya ditambah), dan `id`-nya
//      stabil: catatan yang sama selalu membawa id dan isi yang sama.
//
// Data tiruan di bawah (mockAuditLog) adalah fungsi waktu saja, seperti
// mockActiveAlerts: `nowSec` yang sama selalu menghasilkan daftar yang sama, dan
// ketika jendela bergeser hanya catatan yang keluar atau masuk jendela yang
// berbeda.

// Jendela yang ditampilkan.
export const AUDIT_WINDOW_DAYS = 30;
export const AUDIT_WINDOW_SECONDS = AUDIT_WINDOW_DAYS * 86_400;
// Berapa baris per halaman di tabel.
export const AUDIT_PAGE_SIZE = 20;
// Halaman menyegarkan daftar tiap sekian milidetik.
export const AUDIT_REFRESH_MS = 30_000;
// Batas `limit` pada GET /api/v1/audit.
export const AUDIT_MAX_LIMIT = 500;
// Data tiruan: tiap hari UTC punya sekian sampai sekian catatan.
export const AUDIT_MOCK_DAY_MIN = 4;
export const AUDIT_MOCK_DAY_MAX = 8;
// Data tiruan: pencatatan dimulai pada hari ini (UTC). Sebelum itu log kosong,
// seperti sistem yang belum pernah dipakai.
export const AUDIT_MOCK_START = Date.UTC(2025, 0, 1) / 1000;
// Jeda tiruan sebelum data "tiba", seperti sebuah permintaan jaringan.
export const AUDIT_MOCK_LATENCY_MS = 200;

// --- Tipe ------------------------------------------------------------------

export type AuditAction =
  | "login"
  | "logout"
  | "alert-handled"
  | "threshold-changed"
  | "router-added"
  | "router-updated"
  | "cpe-changed"
  | "billing-sync"
  | "settings-changed";

export type AuditGroup = "akses" | "alert" | "perangkat" | "pengaturan";

// Nama ikon lucide; komponen memetakan nama ke gambarnya (lib ini murni, tanpa
// React), sama seperti billing-badge.ts.
export type AuditIconName =
  | "LogIn"
  | "LogOut"
  | "CircleCheck"
  | "SlidersHorizontal"
  | "CirclePlus"
  | "Wrench"
  | "Wifi"
  | "RefreshCw"
  | "Settings";

export interface AuditActionInfo {
  readonly label: string;
  readonly icon: AuditIconName;
  readonly group: AuditGroup;
}

function freezeActions(table: Record<AuditAction, AuditActionInfo>) {
  for (const info of Object.values(table)) Object.freeze(info);
  return Object.freeze(table);
}

// Satu-satunya tabel aksi: label Indonesia, ikon, dan kelompok. Tidak bisa
// diubah (beku).
export const auditActions: Readonly<Record<AuditAction, AuditActionInfo>> =
  freezeActions({
    login: { label: "Masuk", icon: "LogIn", group: "akses" },
    logout: { label: "Keluar", icon: "LogOut", group: "akses" },
    "alert-handled": {
      label: "Tandai ditangani",
      icon: "CircleCheck",
      group: "alert",
    },
    "threshold-changed": {
      label: "Ambang diubah",
      icon: "SlidersHorizontal",
      group: "alert",
    },
    "router-added": {
      label: "Router ditambah",
      icon: "CirclePlus",
      group: "perangkat",
    },
    "router-updated": {
      label: "Router diubah",
      icon: "Wrench",
      group: "perangkat",
    },
    "cpe-changed": {
      label: "CPE pelanggan diubah",
      icon: "Wifi",
      group: "perangkat",
    },
    "billing-sync": {
      label: "Sinkron billing",
      icon: "RefreshCw",
      group: "pengaturan",
    },
    "settings-changed": {
      label: "Pengaturan diubah",
      icon: "Settings",
      group: "pengaturan",
    },
  });

// Urutan aksi yang tetap (untuk legenda dan pengujian).
export const auditActionList: readonly AuditAction[] = Object.freeze(
  Object.keys(auditActions) as AuditAction[],
);

export const auditGroupLabels: Readonly<Record<AuditGroup, string>> =
  Object.freeze({
    akses: "Akses",
    alert: "Alert",
    perangkat: "Perangkat",
    pengaturan: "Pengaturan",
  });

export type AuditActorType = "system" | "operator";

// Pelaku otomatis (Sistem) dibedakan dari petugas manusia.
export function auditActorType(actor: AuditActor): AuditActorType {
  return actor.id === AUDIT_SYSTEM_ACTOR.id ||
    actor.name === AUDIT_SYSTEM_ACTOR.name
    ? "system"
    : "operator";
}

// Usia ringkas untuk petunjuk di bawah waktu mutlak. Detik negatif (jam
// bergeser) dianggap 0.
export function formatAuditAge(seconds: number, now: number): string {
  const age = Math.max(0, Math.floor(now - seconds));
  if (age < 60) return "< 1 mnt lalu";
  if (age < 3600) return `${Math.floor(age / 60)} mnt lalu`;
  if (age < 86_400) return `${Math.floor(age / 3600)} jam lalu`;
  return `${Math.floor(age / 86_400)} hari lalu`;
}

export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(auditActions, value)
  );
}

export interface AuditActor {
  readonly id: string;
  // Tidak pernah kosong.
  readonly name: string;
}

// Pelaku kejadian otomatis (bukan petugas).
export const AUDIT_SYSTEM_ACTOR: AuditActor = Object.freeze({
  id: "system",
  name: "Sistem",
});

// Perubahan satu bidang yang BUKAN rahasia: nilai lama dan baru sebagai teks.
export interface AuditFieldChange {
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly redacted?: undefined;
}

// Perubahan bidang rahasia: hanya bahwa bidang itu berubah. `from` dan `to`
// DILARANG oleh tipe (never), jadi nilai rahasia tidak bisa masuk lewat sini.
export interface AuditRedactedChange {
  readonly field: string;
  readonly redacted: true;
  readonly from?: never;
  readonly to?: never;
}

export type AuditChange = AuditFieldChange | AuditRedactedChange;

export interface AuditEntry {
  // Stabil dan unik.
  readonly id: string;
  // Detik epoch BULAT, jam server.
  readonly at: number;
  readonly actor: AuditActor;
  readonly action: AuditAction;
  // Yang diubah, mis. "Router RTR-Pusat-01", "Ambang CPU", "Alert alt-123".
  readonly target: string;
  // Satu kalimat Indonesia.
  readonly summary: string;
  // Bidang yang berubah; kosong bila tidak ada yang perlu dirinci.
  readonly changes: readonly AuditChange[];
}

// Masukan untuk membuat catatan: sama dengan AuditEntry, `changes` boleh tak
// ada. Bentuk inilah yang akan diisi dari JSON backend sebelum dipakai.
export interface AuditEntryInput {
  id: string;
  at: number;
  actor: AuditActor;
  action: AuditAction;
  target: string;
  summary: string;
  changes?: readonly AuditChange[];
}

// --- Pencegah rahasia ------------------------------------------------------

// Catatan yang tidak sah (bentuknya salah, atau memuat sesuatu yang tampak
// seperti rahasia). Pesannya TIDAK PERNAH memuat nilai yang dicurigai.
export class AuditEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditEntryError";
  }
}

// Nama bidang yang nilainya rahasia. Bidang seperti ini hanya boleh dicatat
// lewat redacted().
const secretFieldPattern =
  /(kata\s*sandi|sandi|password|passwd|\bpwd\b|passphrase|token|kunci|secret|rahasia|api[-_\s]?key|\bpsk\b|credential|\botp\b)/i;

export function isSecretField(field: string) {
  return secretFieldPattern.test(field);
}

// Pola isi teks yang tidak boleh ada di log. Tiap pola punya nama, yang dipakai
// untuk pesan galat; nilai yang cocok tidak pernah ikut ditulis.
const secretTextPatterns: readonly { name: string; pattern: RegExp }[] = [
  { name: "password", pattern: /\b(password|passwd|passphrase|pwd)\b/i },
  { name: "kata sandi dengan nilai", pattern: /kata\s*sandi\s*[:=]/i },
  {
    name: "kunci dengan nilai",
    pattern: /\b(token|secret|api[-_\s]?key|apikey|kunci(\s+api)?|psk)\s*[:=]/i,
  },
  { name: "bearer", pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i },
  {
    name: "token bot Telegram",
    pattern: /\b\d{6,12}:[A-Za-z0-9_-]{30,}/,
  },
  {
    name: "awalan kunci layanan",
    pattern: /\b(ngpk_|sk-|ghp_|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}/,
  },
  { name: "kredensial di alamat", pattern: /\/\/[^\s/:@]+:[^\s/@]+@/ },
  { name: "teks acak panjang", pattern: /[A-Za-z0-9+/_=-]{32,}/ },
];

// Nama pola pertama yang cocok dengan `text`, atau null bila bersih.
export function findSecret(text: string): string | null {
  for (const { name, pattern } of secretTextPatterns) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function assertClean(text: string, where: string) {
  const found = findSecret(text);
  if (found) {
    throw new AuditEntryError(
      `Teks pada ${where} tampak seperti rahasia (pola: ${found}); nilainya tidak boleh masuk jejak aktivitas.`,
    );
  }
}

// Perubahan bidang biasa. Menolak bidang rahasia (pakai redacted()) dan nilai
// yang tampak seperti rahasia.
export function changed(
  field: string,
  from: string,
  to: string,
): AuditFieldChange {
  if (isSecretField(field)) {
    throw new AuditEntryError(
      `Bidang "${field}" rahasia: catat dengan redacted(), tanpa nilai.`,
    );
  }
  assertClean(from, `nilai lama bidang "${field}"`);
  assertClean(to, `nilai baru bidang "${field}"`);
  return Object.freeze({ field, from, to });
}

// Perubahan bidang rahasia: hanya bahwa bidangnya berubah, tanpa nilai.
export function redacted(field: string): AuditRedactedChange {
  return Object.freeze({ field, redacted: true });
}

// Satu baris tentang satu perubahan, untuk layar dan pembaca layar.
export function describeChange(change: AuditChange) {
  return change.redacted
    ? `${change.field}: nilai disembunyikan`
    : `${change.field}: dari ${change.from} ke ${change.to}`;
}

function requireText(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AuditEntryError(`${where} wajib berupa teks yang tidak kosong.`);
  }
  return value;
}

function checkChange(change: AuditChange, index: number): AuditChange {
  const where = `perubahan ke-${index + 1}`;
  const field = requireText(change.field, `Nama bidang ${where}`);
  assertClean(field, `nama bidang ${where}`);
  const loose = change as { from?: unknown; to?: unknown; redacted?: unknown };
  if (loose.redacted === true) {
    if (loose.from !== undefined || loose.to !== undefined) {
      throw new AuditEntryError(
        `Bidang "${field}" disembunyikan, jadi tidak boleh membawa nilai lama atau baru.`,
      );
    }
    return redacted(field);
  }
  if (loose.redacted !== undefined) {
    throw new AuditEntryError(`Penanda redacted pada ${where} tidak sah.`);
  }
  // Bidang rahasia tanpa redacted: ditolak, apa pun isi nilainya.
  return changed(
    field,
    requireText(loose.from, `Nilai lama ${where}`),
    requireText(loose.to, `Nilai baru ${where}`),
  );
}

// Membuat catatan yang sah dari `input`, atau melempar AuditEntryError. Semua
// catatan data tiruan lewat sini, dan backend wajib memakai aturan yang sama.
// Hasilnya beku.
export function buildAuditEntry(input: AuditEntryInput): AuditEntry {
  const id = requireText(input.id, "id");
  if (!Number.isSafeInteger(input.at) || input.at < 0) {
    throw new AuditEntryError(
      `Waktu catatan ${id} harus bilangan bulat detik epoch (jam server).`,
    );
  }
  if (!isAuditAction(input.action)) {
    throw new AuditEntryError(`Aksi pada catatan ${id} tidak dikenal.`);
  }
  const actorId = requireText(input.actor?.id, "id petugas");
  const actorName = requireText(input.actor?.name, "nama petugas");
  const target = requireText(input.target, "objek");
  const summary = requireText(input.summary, "ringkasan");
  assertClean(actorName, "nama petugas");
  assertClean(target, "objek");
  assertClean(summary, "ringkasan");
  const changes = (input.changes ?? []).map(checkChange);
  return Object.freeze({
    id,
    at: input.at,
    actor: Object.freeze({ id: actorId, name: actorName }),
    action: input.action,
    target,
    summary,
    changes: Object.freeze(changes),
  });
}

// --- Data tiruan -----------------------------------------------------------

// Lima petugas tetap. Namanya sengaja bukan nama pelanggan tiruan lengkap.
export const auditOperators: readonly AuditActor[] = Object.freeze([
  Object.freeze({ id: "op-andi", name: "Andi Prasetyo" }),
  Object.freeze({ id: "op-siti", name: "Siti Nurhaliza" }),
  Object.freeze({ id: "op-bayu", name: "Bayu Kurniawan" }),
  Object.freeze({ id: "op-ratna", name: "Ratna Wulandari" }),
  Object.freeze({ id: "op-yoga", name: "Yoga Permadi" }),
]);

// Catatan hari itu dibuat antara 00.00 dan 15.00 UTC (07.00 sampai 22.00 WIB),
// jam kerja petugas.
const ACTIVE_SECONDS_PER_DAY = 15 * 3_600;

const actionWeights: readonly (readonly [AuditAction, number])[] = [
  ["login", 22],
  ["logout", 14],
  ["alert-handled", 20],
  ["threshold-changed", 8],
  ["router-added", 3],
  ["router-updated", 8],
  ["cpe-changed", 12],
  ["billing-sync", 7],
  ["settings-changed", 6],
];
const totalWeight = actionWeights.reduce((sum, [, weight]) => sum + weight, 0);

function actionFor(roll: number): AuditAction {
  let target = roll * totalWeight;
  for (const [action, weight] of actionWeights) {
    if (target < weight) return action;
    target -= weight;
  }
  return actionWeights[actionWeights.length - 1][0];
}

const emptyCustomers: DashboardCustomer[] = [];
function customers() {
  return emptyCustomers;
}

const thresholdRules = [
  { label: "CPU router", unit: "%", values: [70, 75, 80, 85, 90, 95] },
  {
    label: "Redaman optik (Rx ONU)",
    unit: " dBm",
    values: [-22, -23, -24, -25, -26, -27],
  },
  { label: "Penurunan trafik", unit: "%", values: [30, 40, 50, 60, 70] },
  {
    label: "Pelanggan terputus",
    unit: " detik",
    values: [30, 45, 60, 90, 120],
  },
] as const;

const newRouterNames = [
  "RTR-Selatan-04",
  "RTR-Utara-05",
  "RTR-Cabang-06",
  "RTR-Kota-07",
  "RTR-Desa-08",
] as const;

const wifiSuffixes = ["Home", "Fiber", "Net", "5G", "Plus"] as const;

type EntryBody = Pick<AuditEntryInput, "target" | "summary" | "changes">;

function entryBody(
  action: AuditAction,
  actor: AuditActor,
  roll: (salt: string) => number,
): EntryBody {
  const pick = <T>(items: readonly T[], salt: string): T =>
    items[Math.floor(roll(salt) * items.length)];
  const who = actor.name;

  switch (action) {
    case "login":
      return {
        target: `Akun ${who}`,
        summary: `${who} masuk ke dasbor NOC.`,
        changes: [],
      };
    case "logout":
      return {
        target: `Akun ${who}`,
        summary: `${who} keluar dari dasbor NOC.`,
        changes: [],
      };
    case "alert-handled": {
      const router = pick(mockRouters, "router");
      const customer = pick(customers(), "customer");
      const what = pick(
        [
          `CPU tinggi di ${router.name}`,
          `Router ${router.name} tidak merespons`,
          `Pelanggan ${customer.name} terputus`,
          `Redaman optik buruk pada ${customer.name}`,
        ],
        "what",
      );
      return {
        target: `Alert alt-${100 + Math.floor(roll("alert") * 900)}`,
        summary: `${who} menandai alert "${what}" sudah ditangani.`,
        changes: [changed("Status", "Aktif", "Ditangani")],
      };
    }
    case "threshold-changed": {
      const rule = pick(thresholdRules, "rule");
      const values = rule.values;
      const fromIndex = Math.floor(roll("from") * values.length);
      // Selalu beda dari nilai lama.
      const toIndex =
        (fromIndex + 1 + Math.floor(roll("to") * (values.length - 1))) %
        values.length;
      return {
        target: `Ambang ${rule.label}`,
        summary: `${who} mengubah ambang alert ${rule.label}.`,
        changes: [
          changed(
            `Ambang ${rule.label}`,
            `${values[fromIndex]}${rule.unit}`,
            `${values[toIndex]}${rule.unit}`,
          ),
        ],
      };
    }
    case "router-added": {
      const index = Math.floor(roll("new-router") * newRouterNames.length);
      const name = newRouterNames[index];
      return {
        target: `Router ${name}`,
        summary: `${who} menambahkan router ${name}.`,
        changes: [
          changed("Alamat router", "(belum ada)", `10.10.0.${index + 4}`),
          redacted("Kata sandi router"),
        ],
      };
    }
    case "router-updated": {
      const router = pick(mockRouters, "router");
      const variant = Math.floor(roll("variant") * 3);
      if (variant === 0) {
        return {
          target: `Router ${router.name}`,
          summary: `${who} mengubah alamat router ${router.name}.`,
          changes: [
            changed(
              "Alamat router",
              router.host,
              `10.20.0.${1 + Math.floor(roll("host") * 200)}`,
            ),
          ],
        };
      }
      if (variant === 1) {
        return {
          target: `Router ${router.name}`,
          summary: `${who} mengganti kata sandi router ${router.name}.`,
          changes: [redacted("Kata sandi router")],
        };
      }
      const turnOff = roll("active") < 0.5;
      return {
        target: `Router ${router.name}`,
        summary: `${who} ${turnOff ? "menonaktifkan" : "mengaktifkan"} router ${router.name}.`,
        changes: [
          changed(
            "Status router",
            turnOff ? "Aktif" : "Nonaktif",
            turnOff ? "Nonaktif" : "Aktif",
          ),
        ],
      };
    }
    case "cpe-changed": {
      const customer = pick(customers(), "customer");
      const first = customer.name.split(" ")[0];
      const variant = Math.floor(roll("variant") * 3);
      const fromIndex = Math.floor(roll("ssid-from") * wifiSuffixes.length);
      const toIndex =
        (fromIndex +
          1 +
          Math.floor(roll("ssid-to") * (wifiSuffixes.length - 1))) %
        wifiSuffixes.length;
      const ssid = changed(
        "SSID Wi-Fi",
        `${first}-${wifiSuffixes[fromIndex]}`,
        `${first}-${wifiSuffixes[toIndex]}`,
      );
      const password = redacted("Kata sandi Wi-Fi");
      if (variant === 0) {
        return {
          target: `Pelanggan ${customer.name}`,
          summary: `${who} mengganti SSID Wi-Fi pelanggan ${customer.name}.`,
          changes: [ssid],
        };
      }
      if (variant === 1) {
        return {
          target: `Pelanggan ${customer.name}`,
          summary: `${who} mengganti kata sandi Wi-Fi pelanggan ${customer.name}.`,
          changes: [password],
        };
      }
      return {
        target: `Pelanggan ${customer.name}`,
        summary: `${who} mengganti SSID dan kata sandi Wi-Fi pelanggan ${customer.name}.`,
        changes: [ssid, password],
      };
    }
    case "billing-sync": {
      if (roll("ok") < 0.8) {
        const invoices = 98 + Math.floor(roll("invoices") * 5);
        const unmatched = Math.floor(roll("unmatched") * 4);
        return {
          target: "Sinkron billing",
          summary: `Sinkron billing otomatis selesai: ${invoices} tagihan terbaca, ${invoices - unmatched} cocok, ${unmatched} belum cocok.`,
          changes: [],
        };
      }
      return {
        target: "Sinkron billing",
        summary:
          "Sinkron billing otomatis gagal: sistem billing tidak merespons.",
        changes: [],
      };
    }
    case "settings-changed": {
      const variant = Math.floor(roll("variant") * 4);
      if (variant === 0) {
        return {
          target: "Notifikasi Telegram",
          summary: `${who} mengganti token bot Telegram.`,
          changes: [redacted("Token bot Telegram")],
        };
      }
      if (variant === 1) {
        return {
          target: "Integrasi billing",
          summary: `${who} mengganti kunci API billing.`,
          changes: [redacted("Kunci API billing")],
        };
      }
      if (variant === 2) {
        const longer = roll("retention") < 0.5;
        return {
          target: "Penyimpanan data",
          summary: `${who} mengubah lama penyimpanan data trafik.`,
          changes: [
            changed(
              "Retensi data trafik",
              longer ? "30 hari" : "60 hari",
              longer ? "60 hari" : "30 hari",
            ),
          ],
        };
      }
      const mute = roll("sound") < 0.5;
      return {
        target: "Bunyi alert",
        summary: `${who} ${mute ? "mematikan" : "menyalakan"} bunyi alert bawaan.`,
        changes: [
          changed(
            "Bunyi alert bawaan",
            mute ? "Aktif" : "Nonaktif",
            mute ? "Nonaktif" : "Aktif",
          ),
        ],
      };
    }
  }
}

// Catatan satu hari UTC, urut naik menurut waktu lalu indeks. Hasilnya hanya
// bergantung pada nomor hari, jadi catatan yang sama muncul berapa pun jendela
// yang meminta. Disimpan per hari supaya objeknya sama di tiap pemanggilan.
const dayCache = new Map<number, readonly AuditEntry[]>();

function dayEntries(day: number): readonly AuditEntry[] {
  const cached = dayCache.get(day);
  if (cached) return cached;
  const count =
    AUDIT_MOCK_DAY_MIN +
    Math.floor(
      unit(hashString(`audit:${day}:count`)) *
        (AUDIT_MOCK_DAY_MAX - AUDIT_MOCK_DAY_MIN + 1),
    );
  const entries: AuditEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = (salt: string) =>
      unit(hashString(`audit:${day}:${index}:${salt}`));
    const action = actionFor(roll("action"));
    const actor =
      action === "billing-sync"
        ? AUDIT_SYSTEM_ACTOR
        : auditOperators[Math.floor(roll("actor") * auditOperators.length)];
    entries.push(
      buildAuditEntry({
        id: `audit-${day}-${index}`,
        at: day * 86_400 + Math.floor(roll("at") * ACTIVE_SECONDS_PER_DAY),
        actor,
        action,
        ...entryBody(action, actor, roll),
      }),
    );
  }
  // Urut naik; indeks menjadi pemutus agar urutan tetap pasti bila waktunya sama.
  const indexOf = (entry: AuditEntry) => Number(entry.id.split("-")[2]);
  entries.sort((a, b) => a.at - b.at || indexOf(a) - indexOf(b));
  const frozen = Object.freeze(entries);
  dayCache.set(day, frozen);
  return frozen;
}

// Log tiruan dalam jendela AUDIT_WINDOW_DAYS sampai `nowSec`, terbaru di atas.
// Fungsi waktu saja: `nowSec` yang sama selalu daftar yang sama. Catatan berada
// di jendela bila `nowSec - 30 hari < at <= nowSec` (tidak ada yang di masa
// depan), dan tidak ada yang lebih lama dari AUDIT_MOCK_START.
export function mockAuditLog(nowSec: number): AuditEntry[] {
  if (!Number.isFinite(nowSec)) return [];
  const now = Math.floor(nowSec);
  const since = now - AUDIT_WINDOW_SECONDS;
  const out: AuditEntry[] = [];
  // Hari sebelum log dimulai tidak pernah dibuat (waktunya bisa negatif).
  const firstDay = Math.max(
    Math.floor(since / 86_400),
    Math.floor(AUDIT_MOCK_START / 86_400),
  );
  for (let day = Math.floor(now / 86_400); day >= firstDay; day -= 1) {
    const entries = dayEntries(day);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry.at > since && entry.at <= now && entry.at >= AUDIT_MOCK_START) {
        out.push(entry);
      }
    }
  }
  return out;
}

// --- Memuat ----------------------------------------------------------------

// Permintaan yang gagal tiba (jaringan putus, server menolak).
export class AuditLoadError extends Error {
  constructor(message = "Jejak aktivitas belum bisa dimuat.") {
    super(message);
    this.name = "AuditLoadError";
  }
}

export interface LoadAuditOptions {
  // Detik epoch "sekarang"; bawaannya jam peramban (data tiruan memakainya
  // sebagai jam server).
  nowSec?: number;
  limit?: number;
  before?: number;
}

// Titik ganti ke backend: GET /api/v1/audit?limit=&before= (kontrak di atas).
// Data tiruan datang setelah jeda kecil, dan gagal bila peramban sedang offline
// (permintaan yang sesungguhnya juga tidak akan sampai), seperti alert-actions.
export async function loadAudit(
  options: LoadAuditOptions = {},
): Promise<AuditEntry[]> {
  const { nowSec = Math.floor(Date.now() / 1000), limit, before } = options;
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_MAX_LIMIT)
  ) {
    throw new RangeError(
      `limit harus bilangan bulat 1 sampai ${AUDIT_MAX_LIMIT}.`,
    );
  }
  if (before !== undefined && !Number.isInteger(before)) {
    throw new RangeError("before harus bilangan bulat detik epoch.");
  }
  await new Promise((resolve) => setTimeout(resolve, AUDIT_MOCK_LATENCY_MS));
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new AuditLoadError();
  }
  let entries = mockAuditLog(nowSec);
  if (before !== undefined) {
    entries = entries.filter((entry) => entry.at < before);
  }
  return limit === undefined ? entries : entries.slice(0, limit);
}

// --- Tampilan --------------------------------------------------------------

// Membagi catatan menjadi halaman (terbaru di halaman pertama). Ukuran yang
// bukan bilangan bulat >= 1 (nol, negatif, pecahan, NaN) jatuh ke
// AUDIT_PAGE_SIZE, dan nomor halaman dipaksa masuk rentang oleh paginate.
export function pageAudit<T = AuditEntry>(
  entries: readonly T[],
  page: number,
  size: number = AUDIT_PAGE_SIZE,
): Page<T> {
  const safeSize = Number.isInteger(size) && size >= 1 ? size : AUDIT_PAGE_SIZE;
  return paginate(entries, page, safeSize);
}

export interface AuditSummary {
  // Semua catatan yang diberikan.
  total: number;
  // Yang waktunya dalam 24 jam terakhir sampai `nowSec`.
  last24h: number;
  // Petugas berbeda yang tercatat (kejadian otomatis tidak dihitung).
  operators: number;
}

// Angka ringkasan, semuanya dihitung dari catatan.
export function summarizeAudit(
  entries: readonly AuditEntry[],
  nowSec: number,
): AuditSummary {
  const operators = new Set<string>();
  let last24h = 0;
  for (const entry of entries) {
    if (entry.at > nowSec - 86_400 && entry.at <= nowSec) last24h += 1;
    if (entry.actor.id !== AUDIT_SYSTEM_ACTOR.id) operators.add(entry.actor.id);
  }
  return { total: entries.length, last24h, operators: operators.size };
}

export type AuditViewKind = "loading" | "error" | "empty" | "ready";

export interface AuditView {
  kind: AuditViewKind;
  // Pembaruan terakhir gagal tetapi data sebelumnya masih ada dan tetap tampil.
  stale: boolean;
}

// Keadaan layar: `entries` null berarti belum pernah berhasil dimuat. Gagal tidak
// menghapus data terakhir yang berhasil (seperti usePolled).
export function auditView(
  entries: readonly AuditEntry[] | null,
  failed: boolean,
): AuditView {
  if (entries === null) {
    return { kind: failed ? "error" : "loading", stale: false };
  }
  return { kind: entries.length === 0 ? "empty" : "ready", stale: failed };
}
