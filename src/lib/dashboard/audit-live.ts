import {
  AUDIT_SYSTEM_ACTOR,
  AUDIT_WINDOW_SECONDS,
  AuditEntryError,
  AuditLoadError,
  auditActions,
  buildAuditEntry,
  type AuditAction,
  type AuditChange,
  type AuditEntry,
} from "./audit.ts";

// JEJAK AKTIVITAS NYATA: baris tabel `audit_log` lewat GET /api/audit. Hanya
// memetakan bentuk baris ke AuditEntry; tidak ada data tiruan. Catatan dari
// database tidak dipercaya begitu saja: setiap catatan lewat buildAuditEntry,
// yang menolak yang memuat sesuatu yang tampak seperti rahasia.

// Bentuk satu catatan dari /api/audit (services/audit.service.ts getAuditEntries).
export interface LiveAuditRow {
  id: string;
  at: number;
  actor: { id: string; name: string };
  action: string;
  target: string;
  summary: string;
  changes?: unknown;
}

// Penulis di server memakai beberapa penamaan untuk tindakan yang sama
// (alert_handle dan alert-handled). Yang setara dipetakan; yang tidak dikenal
// jatuh ke "Pengaturan diubah", dengan nama aslinya tetap tertulis di ringkasan.
const ALIASES: Readonly<Record<string, AuditAction>> = {
  alert_handle: "alert-handled",
  update_thresholds: "threshold-changed",
  reset_thresholds: "threshold-changed",
  "threshold-reset": "threshold-changed",
};

const isKnown = (a: string): a is AuditAction => Object.hasOwn(auditActions, a);

export function resolveAuditAction(raw: string): AuditAction {
  if (isKnown(raw)) return raw;
  // hasOwn: nama seperti "__proto__" atau "constructor" bukan alias.
  return Object.hasOwn(ALIASES, raw) ? ALIASES[raw] : "settings-changed";
}

// Hanya perubahan bidang yang bentuknya benar yang dipakai; sisanya dibuang.
function readChanges(raw: unknown): AuditChange[] {
  if (!Array.isArray(raw)) return [];
  const out: AuditChange[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const field = (c as { field?: unknown }).field;
    if (typeof field !== "string" || field.trim() === "") continue;
    if ((c as { redacted?: unknown }).redacted === true) {
      out.push({ field, redacted: true });
      continue;
    }
    const { from, to } = c as { from?: unknown; to?: unknown };
    if (
      (typeof from === "string" || typeof from === "number") &&
      (typeof to === "string" || typeof to === "number")
    ) {
      out.push({ field, from: String(from), to: String(to) });
    }
  }
  return out;
}

const HIDDEN_SUMMARY = "Rincian disembunyikan karena memuat data yang tampak sensitif.";

// Tidak pernah melempar: satu catatan buruk tidak boleh menjatuhkan seluruh halaman.
export function mapAuditRow(row: LiveAuditRow): AuditEntry | null {
  if (!row || typeof row.id !== "string" || !Number.isSafeInteger(row.at) || row.at < 0) {
    return null;
  }
  const actor =
    !row.actor || row.actor.id === "system" || !row.actor.name
      ? AUDIT_SYSTEM_ACTOR
      : { id: String(row.actor.id), name: String(row.actor.name) };
  const base = {
    id: row.id,
    at: row.at,
    actor,
    action: resolveAuditAction(String(row.action)),
    target: String(row.target ?? "").trim() || "-",
    summary: String(row.summary ?? "").trim() || `${actor.name}: ${row.action}`,
  };
  const attempts = [
    { ...base, changes: readChanges(row.changes) },
    { ...base },
    { ...base, target: "(disembunyikan)", summary: HIDDEN_SUMMARY },
  ];
  for (const attempt of attempts) {
    try {
      return buildAuditEntry(attempt);
    } catch (error) {
      if (!(error instanceof AuditEntryError)) throw error;
    }
  }
  return null;
}

const MAX = 500;

export async function loadLiveAudit(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<AuditEntry[]> {
  let res: Response;
  try {
    res = await fetch(`/api/audit?limit=${MAX}`);
  } catch {
    throw new AuditLoadError();
  }
  if (!res.ok) throw new AuditLoadError();
  const json = (await res.json().catch(() => null)) as { data?: LiveAuditRow[] } | null;
  const since = nowSec - AUDIT_WINDOW_SECONDS;
  const entries: AuditEntry[] = [];
  for (const row of json?.data ?? []) {
    const entry = mapAuditRow(row);
    if (entry && entry.at > since && entry.at <= nowSec) entries.push(entry);
  }
  return entries.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
