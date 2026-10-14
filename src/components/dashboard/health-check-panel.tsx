"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Clock,
  Server,
  Database,
  Network,
  HardDrive,
  Cpu,
  Search,
} from "lucide-react";
import {
  MOCK_HEALTH_CHECKS,
  type HealthCheckItem,
} from "@/lib/dashboard/deploy-safety";

export function HealthCheckPanel() {
  const [checks, setChecks] = useState<readonly HealthCheckItem[]>(
    MOCK_HEALTH_CHECKS,
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isProbing, setIsProbing] = useState(false);
  const [lastProbedAt, setLastProbedAt] = useState<string>(
    new Date().toLocaleTimeString("id-ID"),
  );

  const fetchRealHealthStatus = async () => {
    setIsProbing(true);
    try {
      const res = await fetch("/api/deploy/health").catch(() =>
        fetch("/api/deploy/status"),
      );
      if (res.ok) {
        const json = await res.json();
        const healthList = json.checks || json.data?.healthChecks;
        if (Array.isArray(healthList)) {
          setChecks(healthList);
          setLastProbedAt(new Date().toLocaleTimeString("id-ID"));
        }
      }
    } catch {
      // Fallback tetap menggunakan data lokal bila API belum terjangkau
    } finally {
      setIsProbing(false);
    }
  };

  useEffect(() => {
    fetchRealHealthStatus();
  }, []);

  const handleProbeAll = () => {
    fetchRealHealthStatus();
  };

  const filtered = checks.filter((c) => {
    const matchSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.message.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.status === statusFilter;
    const matchCat = categoryFilter === "all" || c.category === categoryFilter;
    return matchSearch && matchStatus && matchCat;
  });

  const healthyCount = checks.filter((c) => c.status === "healthy").length;
  const degradedCount = checks.filter((c) => c.status === "degraded").length;
  const failingCount = checks.filter((c) => c.status === "failing").length;

  const getCategoryIcon = (category: HealthCheckItem["category"]) => {
    switch (category) {
      case "database":
        return <Database className="h-4 w-4 text-blue-500" />;
      case "network":
        return <Network className="h-4 w-4 text-emerald-500" />;
      case "storage":
        return <HardDrive className="h-4 w-4 text-amber-500" />;
      case "service":
        return <Cpu className="h-4 w-4 text-purple-500" />;
    }
  };

  return (
    <div
      data-testid="health-check-panel"
      className="flex flex-col gap-6"
    >
      {/* Kartu Ringkasan Metrik Health Check */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Komponen
            </span>
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {checks.length}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Semua subsistem terdaftar
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Komponen Sehat
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {healthyCount}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Latensi di bawah batas toleransi
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Degradasi (Warning)
            </span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {degradedCount}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Memerlukan pemantauan berkala
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Gagal Kritis
            </span>
            <XCircle className="h-4 w-4 text-red-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-red-600 dark:text-red-400">
            {failingCount}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Memblokir promosi deploy otomatis
          </p>
        </div>
      </div>

      {/* Kontrol Pencarian, Filter & Tombol Probe */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari pemeriksaan kesehatan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex items-center gap-1">
            {(["all", "healthy", "degraded", "failing"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors capitalize ${
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                {s === "all" ? "Semua Status" : s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Uji terakhir: {lastProbedAt}
          </span>
          <button
            onClick={handleProbeAll}
            disabled={isProbing}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-xs hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isProbing ? "animate-spin" : ""}`}
            />
            Jalankan Probe Ulang
          </button>
        </div>
      </div>

      {/* Tabel Rincian Health Check */}
      <div className="rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Komponen & Kat</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Latensi</th>
                <th className="px-4 py-3">Pesan Diagnostik</th>
                <th className="px-4 py-3">Wajib Rilis</th>
                <th className="px-4 py-3 text-right">Pemeriksaan Terakhir</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getCategoryIcon(item.category)}
                      <div>
                        <div className="font-semibold text-foreground">
                          {item.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase">
                          {item.category}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {item.status === "healthy" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        SEHAT
                      </span>
                    )}
                    {item.status === "degraded" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        DEGRADASI
                      </span>
                    )}
                    {item.status === "failing" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
                        <XCircle className="h-3 w-3" />
                        GAGAL
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`font-mono text-xs font-medium ${
                        item.latencyMs < 50
                          ? "text-emerald-600 dark:text-emerald-400"
                          : item.latencyMs < 200
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}
                    >
                      {item.latencyMs} ms
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-md">
                    {item.message}
                  </td>
                  <td className="px-4 py-3">
                    {item.requiredForDeploy ? (
                      <span className="inline-flex rounded-xs bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                        WAJIB
                      </span>
                    ) : (
                      <span className="inline-flex rounded-xs bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        OPSIONAL
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] text-muted-foreground">
                    {new Date(item.checkedAt).toLocaleTimeString("id-ID")}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    Tidak ada pemeriksaan kesehatan yang sesuai kriteria pencarian.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
