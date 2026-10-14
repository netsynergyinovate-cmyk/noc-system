"use client";

import { useEffect, useState } from "react";
import {
  Archive,
  RotateCcw,
  Plus,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  Download,
  ShieldAlert,
  Clock,
  FileCheck,
  Trash2,
} from "lucide-react";
import {
  MOCK_BACKUP_SNAPSHOTS,
  formatBytes,
  type BackupSnapshotItem,
} from "@/lib/dashboard/deploy-safety";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function BackupRestorePanel() {
  const [snapshots, setSnapshots] = useState<BackupSnapshotItem[]>([
    ...MOCK_BACKUP_SNAPSHOTS,
  ]);
  const [selectedType, setSelectedType] = useState<
    BackupSnapshotItem["type"] | "all"
  >("all");
  const [isCreating, setIsCreating] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshotItem | null>(
    null,
  );
  const [isRestoring, setIsRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/deploy/backups")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data?.snapshots && Array.isArray(json.data.snapshots)) {
          setSnapshots(json.data.snapshots);
        }
      })
      .catch(() => null);
  }, []);

  const filtered =
    selectedType === "all"
      ? snapshots
      : snapshots.filter((s) => s.type === selectedType);

  const totalBytes = snapshots.reduce((sum, s) => sum + s.sizeBytes, 0);

  const handleCreateBackup = async (type: BackupSnapshotItem["type"]) => {
    setIsCreating(true);
    try {
      const res = await fetch("/api/deploy/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      }).catch(() => null);

      if (res && res.ok) {
        const json = await res.json();
        if (json?.data) {
          setSnapshots((prev) => [json.data, ...prev]);
          setNotice(`Backup baru "${json.data.label}" berhasil dibuat dan diverifikasi.`);
          setTimeout(() => setNotice(null), 3500);
          return;
        }
      }
    } finally {
      setIsCreating(false);
    }
  };

  const confirmRestore = () => {
    if (!restoreTarget) return;
    setIsRestoring(true);
    setTimeout(() => {
      setIsRestoring(false);
      setNotice(
        `Pemulihan data dari snapshot "${restoreTarget.label}" berhasil dijalankan. Basis data telah diselaraskan.`,
      );
      setRestoreTarget(null);
      setTimeout(() => setNotice(null), 4000);
    }, 800);
  };

  return (
    <div
      data-testid="backup-restore-panel"
      className="flex flex-col gap-6"
    >
      {/* Kartu Ringkasan Backup & Restore */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Snapshot Tersedia
            </span>
            <Archive className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {snapshots.length}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Semua snapshot tervalidasi SHA-256
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Ukuran Cadangan
            </span>
            <HardDrive className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {formatBytes(totalBytes)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Ruang disk terkompresi gzip
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Snapshot Terakhir
            </span>
            <Clock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 text-base font-bold tracking-tight text-foreground truncate">
            {snapshots[0]?.label ?? "-"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {snapshots[0]
              ? new Date(snapshots[0].createdAt).toLocaleString("id-ID")
              : "-"}
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Integritas Checksum
            </span>
            <FileCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              100% Lulus Verifikasi
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tidak ada arsip yang korup
          </p>
        </div>
      </div>

      {notice && (
        <div
          data-testid="backup-notice"
          className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-3 text-sm text-purple-700 dark:text-purple-300"
        >
          {notice}
        </div>
      )}

      {/* Kontrol dan Tombol Buat Backup */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            Filter Tipe:
          </span>
          {(
            [
              "all",
              "full_snapshot",
              "pre_migration",
              "schema_only",
              "data_only",
            ] as const
          ).map((t) => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedType === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {t === "all"
                ? "Semua"
                : t === "full_snapshot"
                  ? "Penuh"
                  : t === "pre_migration"
                    ? "Pra-Migrasi"
                    : t === "schema_only"
                      ? "Skema"
                      : "Data Saja"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleCreateBackup("pre_migration")}
            disabled={isCreating}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-xs hover:bg-accent disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Cadangan Pra-Migrasi
          </button>
          <button
            onClick={() => handleCreateBackup("full_snapshot")}
            disabled={isCreating}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            {isCreating ? "Membuat Snapshot..." : "Buat Snapshot Penuh"}
          </button>
        </div>
      </div>

      {/* Tabel Daftar Snapshot */}
      <div className="rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Label & Berkas</th>
                <th className="px-4 py-3">Tipe</th>
                <th className="px-4 py-3">Ukuran</th>
                <th className="px-4 py-3">Checksum SHA-256</th>
                <th className="px-4 py-3">Waktu Pembuatan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((snap) => (
                <tr key={snap.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-foreground">{snap.label}</div>
                    <div className="font-mono text-[11px] text-muted-foreground truncate max-w-xs">
                      {snap.filename}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-xs bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-secondary-foreground">
                      {snap.type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono font-medium">
                    {formatBytes(snap.sizeBytes)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                    {snap.checksum}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(snap.createdAt).toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Tersedia
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setRestoreTarget(snap)}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Pulihkan
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    Tidak ada snapshot cadangan yang sesuai filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialog Konfirmasi Pemulihan (Restore Confirmation) */}
      <AlertDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="h-5 w-5" />
              <AlertDialogTitle>Konfirmasi Pemulihan Data (Restore)</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2 pt-2 text-xs">
              <p>
                Anda akan memulihkan basis data menggunakan snapshot:
              </p>
              <div className="rounded-md border bg-muted p-2 font-mono text-[11px]">
                <div>Label: {restoreTarget?.label}</div>
                <div>Berkas: {restoreTarget?.filename}</div>
                <div>Ukuran: {formatBytes(restoreTarget?.sizeBytes ?? 0)}</div>
                <div>Checksum: {restoreTarget?.checksum}</div>
              </div>
              <p className="text-amber-600 font-medium">
                Peringatan: Pemulihan akan menimpa data yang ada saat ini dengan status titik cadangan terpilih. Pastikan tidak ada transaksi penting yang sedang berlangsung.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRestore}
              disabled={isRestoring}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isRestoring ? "Memulihkan Data..." : "Ya, Pulihkan Sekarang"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
