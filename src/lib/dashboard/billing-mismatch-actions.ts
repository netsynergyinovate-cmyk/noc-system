// Penandaan ketidaksesuaian billing oleh operator. Murni (tanpa server-only):
// disimpan di localStorage, jatuh ke memori bila penyimpanan diblokir/rusak.
// ponytail: hanya per-peramban; ganti dengan endpoint audit/billing saat backend ada.

export type MismatchResolutionAction =
  | "investigate"
  | "ignore"
  | "followup_customer"
  | "manual_pair";

export interface MismatchResolutionRecord {
  mismatchKey: string;
  action: MismatchResolutionAction;
  notes?: string;
  resolvedBy: string;
  resolvedAt: string;
}

export const mismatchActionLabels: Record<MismatchResolutionAction, string> = {
  investigate: "Telah Diinvestigasi",
  ignore: "Abaikan Sementara",
  followup_customer: "Perlu Follow-up Pelanggan",
  manual_pair: "Setujui Koreksi Nama PPPoE",
};

export const mismatchActions = Object.keys(
  mismatchActionLabels,
) as MismatchResolutionAction[];

export const MISMATCH_RESOLUTIONS_KEY = "billing_mismatch_resolutions";

// Cadangan bila localStorage tidak ada atau melempar galat.
let memory: Record<string, MismatchResolutionRecord> = {};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function valid(value: unknown): value is MismatchResolutionRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.mismatchKey === "string" &&
    typeof r.action === "string" &&
    Object.hasOwn(mismatchActionLabels, r.action) &&
    typeof r.resolvedBy === "string" &&
    typeof r.resolvedAt === "string" &&
    (r.notes === undefined || typeof r.notes === "string")
  );
}

function read(): Record<string, MismatchResolutionRecord> {
  const s = storage();
  if (!s) return { ...memory };
  try {
    const raw = s.getItem(MISMATCH_RESOLUTIONS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, MismatchResolutionRecord> = Object.create(null);
    for (const [key, value] of Object.entries(parsed)) {
      if (valid(value) && value.mismatchKey === key) out[key] = value;
    }
    return { ...out };
  } catch {
    return { ...memory };
  }
}

function write(all: Record<string, MismatchResolutionRecord>) {
  memory = { ...all };
  const s = storage();
  if (!s) return;
  try {
    s.setItem(MISMATCH_RESOLUTIONS_KEY, JSON.stringify(all));
  } catch {
    // Penyimpanan penuh/diblokir: nilai tetap berlaku di sesi ini lewat memori.
  }
}

export function markMismatchResolved(
  record: MismatchResolutionRecord,
): MismatchResolutionRecord {
  if (!valid(record) || record.mismatchKey === "") {
    throw new Error("Catatan penandaan tidak valid");
  }
  const notes = record.notes?.trim();
  const saved: MismatchResolutionRecord = {
    mismatchKey: record.mismatchKey,
    action: record.action,
    ...(notes ? { notes } : {}),
    resolvedBy: record.resolvedBy,
    resolvedAt: record.resolvedAt,
  };
  const all = read();
  all[saved.mismatchKey] = saved;
  write(all);
  return saved;
}

export function getAllMismatchResolutions(): Record<
  string,
  MismatchResolutionRecord
> {
  return read();
}

export function getMismatchResolution(
  mismatchKey: string,
): MismatchResolutionRecord | null {
  const all = read();
  return Object.hasOwn(all, mismatchKey) ? all[mismatchKey] : null;
}

export function isMismatchResolved(mismatchKey: string): boolean {
  return getMismatchResolution(mismatchKey) !== null;
}

export function removeMismatchResolution(mismatchKey: string): boolean {
  const all = read();
  if (!Object.hasOwn(all, mismatchKey)) return false;
  delete all[mismatchKey];
  write(all);
  return true;
}

export function clearMismatchResolutions(): void {
  memory = {};
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(MISMATCH_RESOLUTIONS_KEY);
  } catch {
    // Diabaikan: memori sudah dikosongkan.
  }
}
