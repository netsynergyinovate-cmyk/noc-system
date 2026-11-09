// Tanggapan tiket alert (mock): status, prioritas, catatan, dan penugasan
// teknisi. Murni; tanpa import apa pun supaya bisa diuji langsung dengan node.
// Penyimpanan tiruan di localStorage `alert_ticket_responses`, memori bila
// storage diblokir. Backend nyata: POST /api/v1/alerts/{id}/ticket.

export type AlertTicketStatus =
  "open" | "in_progress" | "resolved" | "escalated";
export type AlertTicketPriority = "low" | "medium" | "high" | "critical";

export interface AlertTicketResponseRecord {
  id: string;
  alertId: string;
  status: AlertTicketStatus;
  priority: AlertTicketPriority;
  operator: string;
  notes: string;
  respondedAt: string;
  actionTaken?: string;
  dispatchTechnician?: boolean;
  technicianName?: string;
}

export interface AlertTicketActionInput {
  alertId: string;
  operator: string;
  status: AlertTicketStatus;
  priority: AlertTicketPriority;
  notes: string;
  actionTaken?: string;
  dispatchTechnician?: boolean;
  technicianName?: string;
}

export const alertTicketStatusLabels: Record<AlertTicketStatus, string> = {
  open: "Terbuka",
  in_progress: "Sedang Ditangani",
  resolved: "Selesai",
  escalated: "Eskalasi",
};

export const alertTicketPriorityLabels: Record<AlertTicketPriority, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  critical: "Kritis",
};

export const TICKET_NOTES_MIN = 5;
export const TICKET_TECHNICIAN_MIN = 2;

export function validateTicketActionInput(input: AlertTicketActionInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!input.alertId?.trim()) errors.push("ID alert wajib ada.");
  if (!input.operator?.trim()) errors.push("Operator wajib ada.");
  const notes = input.notes?.trim() ?? "";
  if (notes.length < TICKET_NOTES_MIN) {
    errors.push(`Catatan wajib diisi, minimal ${TICKET_NOTES_MIN} karakter.`);
  }
  if (
    input.dispatchTechnician === true &&
    (input.technicianName?.trim().length ?? 0) < TICKET_TECHNICIAN_MIN
  ) {
    errors.push(
      `Nama teknisi wajib diisi, minimal ${TICKET_TECHNICIAN_MIN} karakter.`,
    );
  }
  return { valid: errors.length === 0, errors };
}

let counter = 0;
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `tkt-${c.randomUUID()}`;
  counter += 1;
  return `tkt-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTicketResponseRecord(
  input: AlertTicketActionInput,
  now: string = new Date().toISOString(),
): AlertTicketResponseRecord {
  const dispatch = input.dispatchTechnician === true;
  const record: AlertTicketResponseRecord = {
    id: newId(),
    alertId: input.alertId.trim(),
    status: input.status,
    priority: input.priority,
    operator: input.operator.trim(),
    notes: input.notes.trim(),
    respondedAt: now,
  };
  if (input.actionTaken?.trim()) record.actionTaken = input.actionTaken.trim();
  if (dispatch) {
    record.dispatchTechnician = true;
    record.technicianName = input.technicianName?.trim();
  }
  return record;
}

// ---- Penyimpanan tiruan ----------------------------------------------------

export const TICKET_STORAGE_KEY = "alert_ticket_responses";

let memory: AlertTicketResponseRecord[] = [];

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is AlertTicketResponseRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.alertId === "string" &&
    typeof r.status === "string" &&
    Object.hasOwn(alertTicketStatusLabels, r.status) &&
    typeof r.priority === "string" &&
    Object.hasOwn(alertTicketPriorityLabels, r.priority) &&
    typeof r.operator === "string" &&
    typeof r.notes === "string" &&
    typeof r.respondedAt === "string"
  );
}

function readAll(): AlertTicketResponseRecord[] {
  const s = storage();
  if (!s) return memory;
  try {
    const raw = s.getItem(TICKET_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return memory;
  }
}

export function saveTicketResponse(record: AlertTicketResponseRecord): void {
  const next = [...readAll(), record];
  memory = next;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(TICKET_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ponytail: memori saja bila storage penuh/diblokir; hilang saat muat ulang.
  }
}

export function getTicketResponses(
  alertId?: string,
): AlertTicketResponseRecord[] {
  const all = readAll();
  return alertId === undefined
    ? [...all]
    : all.filter((r) => r.alertId === alertId);
}

export function getLatestTicketResponse(
  alertId: string,
): AlertTicketResponseRecord | null {
  const list = getTicketResponses(alertId);
  // Urutan simpan = urutan waktu; yang terakhir ditulis adalah yang terbaru.
  return list.length ? list[list.length - 1] : null;
}

export function clearTicketResponses(): void {
  memory = [];
  try {
    storage()?.removeItem(TICKET_STORAGE_KEY);
  } catch {
    // diabaikan
  }
}
