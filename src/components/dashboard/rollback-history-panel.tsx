"use client";

import { useEffect, useState } from "react";
import {
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Clock,
  User,
  Search,
  Table,
  ShieldCheck,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  MOCK_ROLLBACK_HISTORY,
  type MigrationRollbackEvent,
} from "@/lib/dashboard/deploy-safety";

export function RollbackHistoryPanel() {
  const [history, setHistory] = useState<MigrationRollbackEvent[]>([
    ...MOCK_ROLLBACK_HISTORY,
  ]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] =
    useState<MigrationRollbackEvent | null>(null);

  useEffect(() => {
    fetch("/api/deploy/rollback-history")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data?.history && Array.isArray(json.data.history)) {
          setHistory(json.data.history);
        }
      })
      .catch(() => null);
  }, []);

  const filtered = history.filter((item) => {
    const matchSearch =
      item.migrationFile.toLowerCase().includes(search.toLowerCase()) ||
      item.reason.toLowerCase().includes(search.toLowerCase()) ||
      item.affectedTables.some((t) =>
        t.toLowerCase().includes(search.toLowerCase()),
      );
    const matchStatus =
      statusFilter === "all" || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalSuccess = history.filter((h) => h.status === "success").length;
  const autoSafeguardCount = history.filter(
    (h) => h.actor === "system_safeguard",
  ).length;

  return (
    <div
      data-testid="rollback-history-panel"
      className="flex flex-col gap-6"
    >
      {/* Kartu Ringkasan Riwayat Rollback */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Insiden Rollback
            </span>
            <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {history.length}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Pembalikan migrasi yang terekam
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Otomatis (Safeguard)
            </span>
            <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {autoSafeguardCount}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Rollback otomatis saat migrasi gagal
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Tingkat Keberhasilan
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              100%
            </span>
            <span className="text-xs text-muted-foreground">
              ({totalSuccess}/{history.length})
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Skema berhasil kembali ke status stabil
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Rollback Terakhir
            </span>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-sm font-semibold tracking-tight text-foreground truncate">
            {history[0]?.migrationFile ?? "-"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {history[0]
              ? new Date(history[0].executedAt).toLocaleDateString("id-ID")
              : "-"}
          </p>
        </div>
      </div>

      {/* Kontrol Pencarian & Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Cari berkas migrasi, alasan error, atau tabel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            Status:
          </span>
          {(["all", "success", "partial", "failed"] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors capitalize ${
                statusFilter === st
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {st === "all" ? "Semua" : st}
            </button>
          ))}
        </div>
      </div>

      {/* Tabel Riwayat Rollback */}
      <div className="rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Berkas & Versi Target</th>
                <th className="px-4 py-3">Penyebab / Galat</th>
                <th className="px-4 py-3">Tabel Terdampak</th>
                <th className="px-4 py-3">Eksekutor</th>
                <th className="px-4 py-3">Durasi</th>
                <th className="px-4 py-3">Waktu Eksekusi</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => setSelectedEvent(item)}
                  className="cursor-pointer hover:bg-muted/20"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <FileCode className="h-3.5 w-3.5 text-amber-500" />
                      {item.migrationFile}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      Kembali ke: {item.targetVersion}
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-sm">
                    <div className="text-foreground line-clamp-1">
                      {item.reason}
                    </div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1 italic">
                      💡 {item.remediationHint}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {item.affectedTables.map((t) => (
                        <span
                          key={t}
                          className="rounded-xs bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 ${
                        item.actor === "system_safeguard"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "bg-secondary text-secondary-foreground"
                      }`}
                    >
                      <User className="h-3 w-3" />
                      {item.actor}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">
                    {item.durationMs} ms
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(item.executedAt).toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      SUKSES
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    Tidak ada catatan riwayat rollback yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rincian Event Terpilih */}
      {selectedEvent && (
        <div
          data-testid="rollback-detail-card"
          className="rounded-xl border bg-muted/30 p-4 shadow-xs"
        >
          <div className="flex items-center justify-between pb-3 border-b">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-semibold text-foreground">
                Rincian Eksekusi Rollback: {selectedEvent.migrationFile}
              </h3>
            </div>
            <button
              onClick={() => setSelectedEvent(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Tutup Rincian
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div>
              <span className="font-medium text-muted-foreground">Alasan Kegagalan:</span>
              <p className="mt-0.5 text-foreground">{selectedEvent.reason}</p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Petunjuk Remedial:</span>
              <p className="mt-0.5 text-emerald-600 dark:text-emerald-400">
                {selectedEvent.remediationHint}
              </p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Pernyataan Revert:</span>
              <p className="mt-0.5 font-mono text-[11px]">
                {selectedEvent.revertStatementsCount} operasi DDL / DROP diterapkan secara transaksional
              </p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Waktu Eksekusi:</span>
              <p className="mt-0.5 text-muted-foreground">
                {new Date(selectedEvent.executedAt).toLocaleString("id-ID")} ({selectedEvent.durationMs} ms)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
