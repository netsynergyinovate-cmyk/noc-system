// Logika murni tugas diagnostik CPE (tiruan Fase 2).
// ponytail: riwayat di localStorage/memori; ganti dengan antrean NBI GenieACS di Fase 5.

export type CpeDiagnosticAction =
  | "ping_test"
  | "traceroute"
  | "reboot_device"
  | "factory_reset"
  | "check_optical"
  | "speed_test";

export type CpeDiagnosticStatus = "pending" | "running" | "success" | "failed";

export interface CpeDiagnosticTask {
  id: string;
  customerId: string;
  customerName: string;
  deviceSerial: string;
  action: CpeDiagnosticAction;
  parameters?: Record<string, string | number | boolean>;
  status: CpeDiagnosticStatus;
  resultSummary?: string;
  latencyMs?: number | null;
  initiatedBy: string;
  createdAt: string;
  completedAt?: string;
  errorReason?: string;
}

export const cpeActionLabels: Record<CpeDiagnosticAction, string> = {
  ping_test: "Uji Ping",
  traceroute: "Traceroute",
  reboot_device: "Reboot Modem",
  factory_reset: "Reset Pabrik",
  check_optical: "Cek Optik TR-069",
  speed_test: "Uji Kecepatan",
};

export const cpeStatusLabels: Record<CpeDiagnosticStatus, string> = {
  pending: "Menunggu",
  running: "Sedang Berjalan",
  success: "Berhasil",
  failed: "Gagal",
};

export const CPE_DIAG_STORAGE_KEY = "cpe_diagnostic_tasks";
const MAX_TASKS = 200;

let memory: CpeDiagnosticTask[] = [];
let counter = 0;

function hasStorage(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

function read(): CpeDiagnosticTask[] {
  if (!hasStorage()) return memory;
  try {
    const raw = localStorage.getItem(CPE_DIAG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CpeDiagnosticTask[]) : [];
  } catch {
    return memory;
  }
}

function write(tasks: CpeDiagnosticTask[]): void {
  const trimmed = tasks.slice(0, MAX_TASKS);
  memory = trimmed;
  if (!hasStorage()) return;
  try {
    localStorage.setItem(CPE_DIAG_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // penyimpanan diblokir/penuh: tetap di memori
  }
}

function newId(): string {
  counter += 1;
  return `diag-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Terbaru dulu.
export function getDiagnosticTasks(customerId?: string): CpeDiagnosticTask[] {
  const all = [...read()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return customerId ? all.filter((t) => t.customerId === customerId) : all;
}

export function enqueueDiagnosticTask(
  task: Omit<CpeDiagnosticTask, "id" | "createdAt" | "status">,
): CpeDiagnosticTask {
  const created: CpeDiagnosticTask = {
    ...task,
    id: newId(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  write([created, ...read()]);
  return created;
}

export function updateTaskStatus(
  taskId: string,
  status: CpeDiagnosticStatus,
  outcome?: { resultSummary?: string; latencyMs?: number; errorReason?: string },
): CpeDiagnosticTask | null {
  const all = read();
  const idx = all.findIndex((t) => t.id === taskId);
  if (idx < 0) return null;
  const updated: CpeDiagnosticTask = { ...all[idx], status, ...outcome };
  if (status === "success" || status === "failed") updated.completedAt = new Date().toISOString();
  const next = [...all];
  next[idx] = updated;
  write(next);
  return updated;
}

export function clearDiagnosticTasks(): void {
  memory = [];
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(CPE_DIAG_STORAGE_KEY);
  } catch {
    // diabaikan
  }
}

const seedCustomers = [
  { id: "seed-c1", name: "Budi Santoso", serial: "ZTEGC0A1B2C3" },
  { id: "seed-c2", name: "Dewi Lestari", serial: "HWTC1D2E3F40" },
  { id: "seed-c3", name: "Agus Wijaya", serial: "ZTEGC4D5E6F7" },
  { id: "seed-c4", name: "Siti Rahma", serial: "FHTT9A8B7C6D" },
];

// Riwayat contoh: fungsi waktu `Date.now()` saja, id tetap.
export function generateMockSeedTasks(): CpeDiagnosticTask[] {
  const now = Date.now();
  const defs: Array<{
    c: number;
    action: CpeDiagnosticAction;
    status: CpeDiagnosticStatus;
    minsAgo: number;
    by: string;
    summary?: string;
    latency?: number;
    error?: string;
    params?: Record<string, string | number | boolean>;
  }> = [
    { c: 0, action: "ping_test", status: "success", minsAgo: 5, by: "Rina (NOC)", summary: "4/4 paket diterima, loss 0%", latency: 12, params: { host: "8.8.8.8" } },
    { c: 1, action: "check_optical", status: "success", minsAgo: 22, by: "Rina (NOC)", summary: "RX -23.4 dBm, TX 2.1 dBm, normal" },
    { c: 2, action: "reboot_device", status: "failed", minsAgo: 47, by: "Dimas (NOC)", error: "CPE tidak inform ke ACS (timeout 30 dtk)", params: { mode: "soft" } },
    { c: 3, action: "speed_test", status: "success", minsAgo: 95, by: "Dimas (NOC)", summary: "Down 48.2 Mbps / Up 19.7 Mbps", latency: 18 },
    { c: 0, action: "traceroute", status: "success", minsAgo: 180, by: "Rina (NOC)", summary: "7 hop sampai 1.1.1.1", latency: 21, params: { host: "1.1.1.1" } },
    { c: 1, action: "ping_test", status: "failed", minsAgo: 300, by: "Sistem", error: "Host tujuan tidak merespons (loss 100%)", params: { host: "10.20.30.40" } },
    { c: 2, action: "reboot_device", status: "success", minsAgo: 1500, by: "Rina (NOC)", summary: "Modem menyala ulang dalam 84 detik", params: { mode: "hard" } },
  ];
  return defs.map((d, i) => {
    const cust = seedCustomers[d.c];
    const createdAt = new Date(now - d.minsAgo * 60_000).toISOString();
    return {
      id: `seed-${i + 1}`,
      customerId: cust.id,
      customerName: cust.name,
      deviceSerial: cust.serial,
      action: d.action,
      parameters: d.params,
      status: d.status,
      resultSummary: d.summary,
      latencyMs: d.latency ?? null,
      initiatedBy: d.by,
      createdAt,
      completedAt: new Date(now - d.minsAgo * 60_000 + 4000).toISOString(),
      errorReason: d.error,
    };
  });
}

// Isi riwayat dengan contoh hanya bila masih kosong.
export function seedDiagnosticTasksIfEmpty(): void {
  if (read().length === 0) write(generateMockSeedTasks());
}
