"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Database,
  Filter,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Users,
  Wifi,
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
  filterDataSyncModules,
  getMockDataSyncModules,
  getMockDataSyncOverview,
  type DataSyncFilter,
  type DataSyncModuleItem,
} from "@/lib/dashboard/data-sync";

export function DataSyncBoard() {
  const [modules, setModules] = useState<readonly DataSyncModuleItem[]>(() =>
    getMockDataSyncModules(),
  );
  const [filter, setFilter] = useState<DataSyncFilter>({
    status: "all",
    query: "",
  });
  const [syncingModuleId, setSyncingModuleId] = useState<string | null>(null);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const overview = useMemo(() => getMockDataSyncOverview(modules), [modules]);
  const filteredModules = useMemo(
    () => filterDataSyncModules(modules, filter),
    [modules, filter],
  );

  const handleSyncAll = () => {
    setIsSyncingAll(true);
    setFeedbackMessage(null);
    setTimeout(() => {
      setIsSyncingAll(false);
      setModules((prev) =>
        prev.map((m) => ({
          ...m,
          status: "in_sync",
          lastSyncedAt: new Date().toISOString(),
        })),
      );
      setFeedbackMessage(
        "Seluruh data (akun, perangkat, pelanggan, ambang batas, billing) berhasil disinkronkan secara otomatis.",
      );
    }, 800);
  };

  const handleSyncModule = (id: string) => {
    setSyncingModuleId(id);
    setTimeout(() => {
      setSyncingModuleId(null);
      setModules((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                status: "in_sync",
                lastSyncedAt: new Date().toISOString(),
              }
            : m,
        ),
      );
      setFeedbackMessage(`Modul ${id} berhasil disinkronkan.`);
    }, 600);
  };

  const getStatusBadge = (status: DataSyncModuleItem["status"]) => {
    switch (status) {
      case "in_sync":
        return (
          <Badge
            variant="default"
            className="gap-1 bg-emerald-600 hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-3 w-3" />
            Sinkron
          </Badge>
        );
      case "syncing":
        return (
          <Badge variant="secondary" className="gap-1 animate-pulse">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Menyelaraskan
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Tertunda
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            Gagal
          </Badge>
        );
    }
  };

  const getEntityIcon = (type: DataSyncModuleItem["entityType"]) => {
    switch (type) {
      case "accounts":
        return <Users className="h-4 w-4 text-blue-500" />;
      case "devices":
        return <Server className="h-4 w-4 text-emerald-500" />;
      case "customers":
        return <Wifi className="h-4 w-4 text-amber-500" />;
      case "thresholds":
        return <ShieldCheck className="h-4 w-4 text-purple-500" />;
      case "billing":
        return <Database className="h-4 w-4 text-sky-500" />;
      case "whatsapp":
        return <ArrowLeftRight className="h-4 w-4 text-emerald-600" />;
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="data-sync-board">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status Global</CardDescription>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" />
              {overview.globalStatus === "in_sync"
                ? "Sinkron Penuh"
                : overview.globalStatus}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Arah: {overview.activeDirection}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Modul Terverifikasi</CardDescription>
            <CardTitle className="text-xl font-bold">
              {overview.syncedModules} / {overview.totalModules} Modul
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overview.pendingModules} tertunda · {overview.failedModules}{" "}
              gagal
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Baris Data Diselaraskan</CardDescription>
            <CardTitle className="text-xl font-bold">
              {overview.totalRecordsSynced.toLocaleString()} Baris
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Akun, router, OLT, pelanggan & billing
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sinkronisasi Terakhir</CardDescription>
            <CardTitle className="text-sm font-semibold truncate">
              {overview.lastGlobalSyncAt
                ? new Date(overview.lastGlobalSyncAt).toLocaleTimeString(
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
              Pembaruan otomatis tiap 15-60 menit
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Banner Feedback */}
      {feedbackMessage && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{feedbackMessage}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFeedbackMessage(null)}
            className="h-7 text-xs"
          >
            Tutup
          </Button>
        </div>
      )}

      {/* Action and Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari modul atau checksum..."
              className="pl-8"
              value={filter.query}
              onChange={(e) =>
                setFilter((prev) => ({ ...prev, query: e.target.value }))
              }
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="h-4 w-4 text-muted-foreground ml-2" />
            {(["all", "in_sync", "pending", "failed"] as const).map((st) => (
              <Button
                key={st}
                variant={filter.status === st ? "default" : "outline"}
                size="sm"
                className="text-xs capitalize"
                onClick={() => setFilter((prev) => ({ ...prev, status: st }))}
              >
                {st === "all" ? "Semua" : st === "in_sync" ? "Sinkron" : st}
              </Button>
            ))}
          </div>
        </div>

        <Button
          onClick={handleSyncAll}
          disabled={isSyncingAll}
          className="gap-2"
        >
          <RefreshCw
            className={`h-4 w-4 ${isSyncingAll ? "animate-spin" : ""}`}
          />
          {isSyncingAll ? "Menyelaraskan..." : "Sinkronkan Semua Sekarang"}
        </Button>
      </div>

      {/* Module List Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {filteredModules.map((item) => (
          <Card key={item.id} className="flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-md bg-muted">
                    {getEntityIcon(item.entityType)}
                  </div>
                  <div>
                    <CardTitle className="text-base">{item.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {item.description}
                    </CardDescription>
                  </div>
                </div>
                {getStatusBadge(item.status)}
              </div>
            </CardHeader>

            <CardContent className="space-y-3 pt-0">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-md">
                <div>
                  <span className="block font-medium text-foreground">
                    {item.recordsCount} Baris
                  </span>
                  Data tersinkron
                </div>
                <div>
                  <span className="block font-medium text-foreground capitalize">
                    {item.direction.replace(/_/g, " ")}
                  </span>
                  Arah transfer
                </div>
                <div className="truncate">
                  <span className="block font-mono text-[11px] text-foreground truncate">
                    {item.checksum}
                  </span>
                  Checksum SHA-256
                </div>
                <div>
                  <span className="block font-medium text-foreground">
                    {item.autoSyncIntervalMinutes} menit
                  </span>
                  Interval otomatis
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">
                  Terakhir:{" "}
                  {new Date(item.lastSyncedAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  WIB
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={syncingModuleId === item.id || isSyncingAll}
                  onClick={() => handleSyncModule(item.id)}
                  className="text-xs h-8 gap-1.5"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      syncingModuleId === item.id ? "animate-spin" : ""
                    }`}
                  />
                  {syncingModuleId === item.id ? "Sinkron..." : "Sinkronkan"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
