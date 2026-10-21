// Bentuk catatan undo dan pemulihan tanggal dari JSONB (murni, tanpa DB, agar mudah diuji).

export type UndoKind = "device" | "customer" | "route" | "segment" | "override" | "layer";

export type UndoChange = {
  kind: UndoKind;
  id: string;
  /** Baris sebelum aksi; null = baris dibuat aksi ini */
  before: Record<string, unknown> | null;
};

const DATE_KEYS = new Set(["createdAt", "updatedAt", "snappedAt"]);

/** JSONB menyimpan Date sebagai string ISO; kolom timestamp Drizzle butuh Date lagi. */
export function reviveDates<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of DATE_KEYS) {
    if (typeof out[key] === "string") out[key] = new Date(out[key] as string);
  }
  return out as T;
}
