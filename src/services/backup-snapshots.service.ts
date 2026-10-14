import {
  MOCK_BACKUP_SNAPSHOTS,
  type BackupSnapshotItem,
} from "@/lib/dashboard/deploy-safety";
import { createPortableBackupPackage } from "@/services/portable-backup.service";

let customSnapshots: BackupSnapshotItem[] = [...MOCK_BACKUP_SNAPSHOTS];

/**
 * Mengambil daftar seluruh snapshot cadangan beserta metadata waktu pembuatan.
 */
export async function listBackupSnapshots(): Promise<BackupSnapshotItem[]> {
  // Urutkan snapshot terbaru di awal
  return [...customSnapshots].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Membuat rekaman snapshot cadangan baru dan mencatat ke dalam daftar aktif.
 */
export async function createNewBackupSnapshot(
  type: BackupSnapshotItem["type"] = "full_snapshot",
  label?: string,
): Promise<BackupSnapshotItem> {
  const pkgType =
    type === "schema_only"
      ? "schema_only"
      : type === "data_only"
        ? "config_only"
        : "full";

  const pkg = await createPortableBackupPackage({
    type: pkgType,
    label: label ?? `Cadangan ${type} (${new Date().toLocaleDateString("id-ID")})`,
  });

  const typeLabel =
    type === "full_snapshot"
      ? "Snapshot Penuh"
      : type === "schema_only"
        ? "Skema DDL Saja"
        : type === "data_only"
          ? "Data Saja"
          : "Pra-Migrasi";

  const snapshot: BackupSnapshotItem = {
    id: `snap-${Date.now().toString(36)}`,
    label: label ?? `${typeLabel} (${new Date().toLocaleTimeString("id-ID")})`,
    type,
    sizeBytes:
      type === "schema_only"
        ? 850000
        : type === "data_only"
          ? 26500000
          : 43200000,
    status: "available",
    checksum: `sha256-${pkg.manifest.dataPayloadChecksum.slice(0, 16)}`,
    createdAt: pkg.manifest.createdAt,
    filename: `noc_backup_${type}_${Date.now()}.sql.gz`,
    canRestore: true,
  };

  customSnapshots = [snapshot, ...customSnapshots];
  return snapshot;
}

/**
 * Reset daftar snapshot kembali ke bawaan (untuk keperluan isolasi tes).
 */
export function resetBackupSnapshotsForTest(): void {
  customSnapshots = [...MOCK_BACKUP_SNAPSHOTS];
}
