import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  cableRoutes,
  cableSegmentSamples,
  cableSegments,
  mapCustomers as customers,
  mapLayers,
  mapOverrides,
  mapUndoEntries,
  mapDevices as networkDevices,
} from "@/db/schema";
import { ClassifiedCentralApiError } from "./types";
import { reviveDates, type UndoChange, type UndoKind } from "./undo-format";

export type { UndoChange } from "./undo-format";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = Record<string, unknown>;

const TABLES = {
  device: networkDevices,
  customer: customers,
  route: cableRoutes,
  segment: cableSegments,
  layer: mapLayers,
} as const;

// override memakai kunci "entityType:entityId" (PK gabungan)
const overrideWhere = (key: string) => {
  const [entityType, ...rest] = key.split(":");
  return and(
    eq(mapOverrides.entityType, entityType),
    eq(mapOverrides.entityId, rest.join(":")),
  );
};

/** Keadaan baris saat ini (sebelum diubah); baris yang belum ada dicatat before = null. */
export async function snapshot(
  tx: Tx,
  kind: UndoKind,
  ids: string[],
): Promise<UndoChange[]> {
  const out: UndoChange[] = [];
  for (const id of new Set(ids)) {
    let row: Row | undefined;
    if (kind === "override") {
      [row] = await tx
        .select()
        .from(mapOverrides)
        .where(overrideWhere(id))
        .limit(1);
    } else {
      const t = TABLES[kind];
      [row] = await tx.select().from(t).where(eq(t.id, id)).limit(1);
    }
    if (row && kind === "segment") {
      // Sampel ikut dicatat: menghapus/mengganti segmen ikut menghapus sampelnya (cascade)
      row.samples = await tx
        .select()
        .from(cableSegmentSamples)
        .where(eq(cableSegmentSamples.segmentId, id));
    }
    out.push({ kind, id, before: row ?? null });
  }
  return out;
}

/** Baris yang baru dibuat aksi ini: dibatalkan dengan menghapusnya. */
export const created = (kind: UndoKind, id: string): UndoChange => ({
  kind,
  id,
  before: null,
});

// shortcut: riwayat undo disimpan 24 jam lalu dibuang; perpanjang bila operator butuh undo lintas hari
const RETENTION_MS = 24 * 60 * 60 * 1000;

export async function saveUndo(
  tx: Tx,
  label: string,
  changes: UndoChange[],
): Promise<string> {
  await tx
    .delete(mapUndoEntries)
    .where(lt(mapUndoEntries.createdAt, new Date(Date.now() - RETENTION_MS)));
  const [entry] = await tx
    .insert(mapUndoEntries)
    .values({ label: label.slice(0, 160), changes })
    .returning({ id: mapUndoEntries.id });
  return entry.id;
}

async function restore(tx: Tx, change: UndoChange) {
  const { kind, id } = change;
  const before = change.before ? reviveDates(change.before) : null;

  if (kind === "override") {
    await tx.delete(mapOverrides).where(overrideWhere(id));
    if (before)
      await tx
        .insert(mapOverrides)
        .values(before as typeof mapOverrides.$inferInsert);
    return;
  }

  const t = TABLES[kind];
  if (!before) {
    await tx.delete(t).where(eq(t.id, id));
    return;
  }
  const { samples, ...row } = before as Row & { samples?: Row[] };
  // Upsert, bukan hapus+sisip: menghapus segmen akan ikut menghapus sampel lewat cascade
  await tx
    .insert(t)
    .values(row as never)
    .onConflictDoUpdate({ target: t.id, set: row as never });
  if (kind === "segment") {
    await tx
      .delete(cableSegmentSamples)
      .where(eq(cableSegmentSamples.segmentId, id));
    if (samples?.length) {
      await tx
        .insert(cableSegmentSamples)
        .values(samples.map((s) => reviveDates(s)) as never);
    }
  }
}

/** Pulihkan satu aksi: perubahan dibalik dari yang terakhir dicatat. Mengembalikan label aksinya. */
export async function applyUndo(id: string): Promise<string> {
  return await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(mapUndoEntries)
      .where(eq(mapUndoEntries.id, id))
      .for("update")
      .limit(1);
    if (!entry) {
      throw new ClassifiedCentralApiError(
        "NOT_FOUND",
        "Aksi ini sudah dibatalkan atau riwayatnya kedaluwarsa (lebih dari 24 jam).",
        404,
      );
    }
    for (const change of [...(entry.changes as UndoChange[])].reverse()) {
      await restore(tx, change);
    }
    await tx.delete(mapUndoEntries).where(inArray(mapUndoEntries.id, [id]));
    return entry.label;
  });
}
