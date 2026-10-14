"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createRefreshedSyncHistoryEntry,
  filterSyncHistoryEntries,
  getMockSyncHistoryList,
  getMockSyncHistoryOverview,
  getSyncHistoryFacetCounts,
  type SyncHistoryEntry,
  type SyncHistoryFilter,
} from "@/lib/dashboard/sync-history";

export function SyncHistoryPanel() {
  const [entries, setEntries] = useState<readonly SyncHistoryEntry[]>(() =>
    getMockSyncHistoryList(),
  );
  const [filter, setFilter] = useState<SyncHistoryFilter>({
    status: "all",
    triggerType: "all",
    query: "",
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefreshIntervalSec, setAutoRefreshIntervalSec] = useState<number>(0);
  const [feedback, setFeedback] = useState<string | null>(null);

  const overview = useMemo(
    () => getMockSyncHistoryOverview(entries),
    [entries],
  );

  const facetCounts = useMemo(
    () => getSyncHistoryFacetCounts(entries, filter),
    [entries, filter],
  );

  const filteredEntries = useMemo(
    () => filterSyncHistoryEntries(entries, filter),
    [entries, filter],
  );

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    setFeedback(null);
    setTimeout(() => {
      setIsRefreshing(false);
      const newEntry = createRefreshedSyncHistoryEntry();
      setEntries((prev) => [newEntry, ...prev.slice(0, 19)]);
      setFeedback(
        `Riwayat sinkronisasi berhasil diperbarui. Entri terbaru (${newEntry.id}) ditambahkan ke log.`,
      );
    }, 600);
  };

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshIntervalSec <= 0) return;
    const interval = setInterval(() => {
      const newEntry = createRefreshedSyncHistoryEntry(
        "Sistem (Auto-Sync Daemon)",
      );
      setEntries((prev) => [newEntry, ...prev.slice(0, 19)]);
    }, autoRefreshIntervalSec * 1000);

    return () => clearInterval(interval);
  }, [autoRefreshIntervalSec]);

  const getStatusBadge = (status: SyncHistoryEntry["status"]) => {
    switch (status) {
      case "success":
        return (
          <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            Sukses
          </Badge>
        );
      case "partial":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Sebagian
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <ShieldAlert className="h-3 w-3" />
            Gagal
          </Badge>
        );
    }
  };

  const getTriggerLabel = (type: SyncHistoryEntry["triggerType"]) => {
    switch (type) {
      case "scheduled":
        return "Terjadwal (Daemon)";
      case "manual":
        return "Manual (Operator)";
      case "startup_seed":
        return "Bootstrap Startup";
      case "transfer_pipeline":
        return "Pipeline Transfer";
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="sync-history-panel">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sinkronisasi Sukses Terakhir</CardDescription>
            <CardTitle className="text-sm font-semibold truncate">
              {overview.lastSuccessfulSyncAt
                ? new Date(overview.lastSuccessfulSyncAt).toLocaleTimeString(
                    "id-ID",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    },
                  ) + " WIB"
                : "-"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overview.successRuns} run sukses dari {overview.totalRuns} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tingkat Keberhasilan</CardDescription>
            <CardTitle className="text-xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-5 w-5" />
              {overview.successRatePercent}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overview.failedRuns === 0
                ? "Nol kegagalan dalam 24 jam"
                : `${overview.failedRuns} run gagal`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Record Diselaraskan</CardDescription>
            <CardTitle className="text-xl font-bold">
              {overview.totalRecordsProcessed.toLocaleString()} Baris
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Akun, perangkat, pelanggan & tagihan
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Rata-rata Durasi Eksekusi</CardDescription>
            <CardTitle className="text-xl font-bold flex items-center gap-1.5">
              <Zap className="h-5 w-5 text-amber-500" />
              {overview.averageDurationMs} ms
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Transaksi database terisolasi
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Banner Feedback */}
      {feedback && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{feedback}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFeedback(null)}
            className="h-7 text-xs"
          >
            Tutup
          </Button>
        </div>
      )}

      {/* Filter and Refresh Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari ID run, aktor, pesan..."
              className="pl-8"
              value={filter.query}
              onChange={(e) =>
                setFilter((prev) => ({ ...prev, query: e.target.value }))
              }
            />
          </div>

          {/* Status Faceted Filters */}
          <div className="flex items-center gap-1">
            <Filter className="h-4 w-4 text-muted-foreground ml-2" />
            {(["all", "success", "failed"] as const).map((st) => (
              <Button
                key={st}
                variant={filter.status === st ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => setFilter((prev) => ({ ...prev, status: st }))}
              >
                {st === "all"
                  ? `Semua (${facetCounts.status.all})`
                  : st === "success"
                    ? `Sukses (${facetCounts.status.success})`
                    : `Gagal (${facetCounts.status.failed})`}
              </Button>
            ))}
          </div>

          {/* Trigger Type Filter */}
          <div className="flex items-center gap-1">
            {(["all", "scheduled", "manual"] as const).map((tr) => (
              <Button
                key={tr}
                variant={filter.triggerType === tr ? "secondary" : "ghost"}
                size="sm"
                className="text-xs"
                onClick={() => setFilter((prev) => ({ ...prev, triggerType: tr }))}
              >
                {tr === "all"
                  ? "Semua Tipe"
                  : tr === "scheduled"
                    ? `Terjadwal (${facetCounts.triggerType.scheduled})`
                    : `Manual (${facetCounts.triggerType.manual})`}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto Refresh selector */}
          <select
            value={autoRefreshIntervalSec}
            onChange={(e) => setAutoRefreshIntervalSec(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            aria-label="Pilih Interval Auto Refresh"
          >
            <option value={0}>Auto-refresh: Mati</option>
            <option value={15}>Auto-refresh: 15 dtk</option>
            <option value={30}>Auto-refresh: 30 dtk</option>
          </select>

          <Button
            variant="default"
            size="sm"
            disabled={isRefreshing}
            onClick={handleManualRefresh}
            className="text-xs gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {isRefreshing ? "Menyegarkan..." : "Segarkan Riwayat"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilter({ status: "all", triggerType: "all", query: "" })
            }
            className="text-xs gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
      </div>

      {/* History Log Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {filteredEntries.length === 0 ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2">
            <p className="text-sm font-medium text-foreground">
              Tidak ada riwayat yang cocok dengan saringan saat ini.
            </p>
            <p className="text-xs text-muted-foreground">
              Coba sesuaikan kata kunci pencarian atau reset filter status.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFilter({ status: "all", triggerType: "all", query: "" })
              }
              className="mt-2 text-xs"
            >
              Tampilkan Semua Riwayat
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-muted/50 text-muted-foreground font-medium">
                <tr>
                  <th className="p-3">Waktu Eksekusi</th>
                  <th className="p-3">ID & Pemicu</th>
                  <th className="p-3">Cakupan</th>
                  <th className="p-3">Data Disinkronkan</th>
                  <th className="p-3">Durasi</th>
                  <th className="p-3">Aktor</th>
                  <th className="p-3">Checksum</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredEntries.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/30">
                    <td className="p-3 font-medium text-foreground whitespace-nowrap">
                      {new Date(item.runAt).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}{" "}
                      WIB
                      <span className="block text-[11px] text-muted-foreground">
                        {new Date(item.runAt).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </td>

                    <td className="p-3">
                      <span className="font-mono font-semibold text-foreground">
                        {item.id}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {getTriggerLabel(item.triggerType)}
                      </span>
                    </td>

                    <td className="p-3">
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">
                        {item.scope}
                      </Badge>
                    </td>

                    <td className="p-3">
                      <span className="font-semibold text-foreground">
                        {item.recordsProcessed} baris
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        +{item.recordsInserted} baru · ~{item.recordsUpdated} update
                      </span>
                    </td>

                    <td className="p-3 font-mono text-muted-foreground">
                      {item.durationMs} ms
                    </td>

                    <td className="p-3 text-muted-foreground truncate max-w-[150px]">
                      {item.actor}
                    </td>

                    <td className="p-3 font-mono text-[11px] text-muted-foreground truncate max-w-[120px]">
                      {item.checksum}
                    </td>

                    <td className="p-3">{getStatusBadge(item.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
