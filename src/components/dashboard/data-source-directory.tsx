"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Database,
  ExternalLink,
  Search,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Layers,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import {
  PAGE_DATA_SOURCES,
  getPageDataSourceSummary,
  type PageDataSourceMapping,
} from "@/lib/dashboard/data-sources-page-map";

export function DataSourceDirectory() {
  const [sources, setSources] = useState<PageDataSourceMapping[]>([
    ...PAGE_DATA_SOURCES,
  ]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "dummy" | "nyata">(
    "all",
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const summary = getPageDataSourceSummary(sources);

  const filtered = sources.filter((item) => {
    const matchSearch =
      item.pageTitle.toLowerCase().includes(search.toLowerCase()) ||
      item.pagePath.toLowerCase().includes(search.toLowerCase()) ||
      item.envKey.toLowerCase().includes(search.toLowerCase()) ||
      item.goLiveCriterion.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "all" || item.status === statusFilter;
    const matchCategory =
      categoryFilter === "all" || item.category === categoryFilter;
    return matchSearch && matchStatus && matchCategory;
  });

  const toggleSourceStatus = (pagePath: string) => {
    setSources((prev) =>
      prev.map((s) => {
        if (s.pagePath === pagePath) {
          const nextStatus = s.status === "dummy" ? "nyata" : "dummy";
          return { ...s, status: nextStatus };
        }
        return s;
      }),
    );
  };

  const handlePromoteAll = () => {
    setSources((prev) => prev.map((s) => ({ ...s, status: "nyata" })));
  };

  const handleResetToDummy = () => {
    setSources((prev) => prev.map((s) => ({ ...s, status: "dummy" })));
  };

  return (
    <div
      data-testid="data-source-directory"
      className="flex flex-col gap-6"
    >
      {/* Kartu Ringkasan Status Sumber Data */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Halaman / Rute
            </span>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {summary.totalPages}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {summary.totalModules} modul terdaftar di registry
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Sumber Data Dummy
            </span>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {summary.dummyPages}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Tiruan sementara untuk pengujian
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Sumber Data Nyata
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {summary.nyataPages}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Terkoneksi ke database / backend real
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Kesiapan Go-Live
            </span>
            <Sparkles className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {summary.readinessPercentage}%
            </span>
            <span className="text-xs text-muted-foreground">
              ({summary.nyataPages}/{summary.totalPages} modul)
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Fase 5: Promosi penuh ke server
          </p>
        </div>
      </div>

      {/* Kontrol Pencarian, Filter & Aksi Massal */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari halaman, envKey, atau modul..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex items-center gap-1">
            {(["all", "dummy", "nyata"] as const).map((s) => (
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

          <div className="flex items-center gap-1">
            {(
              [
                "all",
                "Monitoring",
                "Infrastruktur",
                "Pelanggan & Billing",
                "Sistem",
              ] as const
            ).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  categoryFilter === cat
                    ? "bg-muted-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {cat === "all" ? "Semua Kategori" : cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePromoteAll}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Setel Semua ke Nyata
          </button>
          <button
            onClick={handleResetToDummy}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Reset ke Dummy
          </button>
        </div>
      </div>

      {/* Tabel Direktori Sumber Data */}
      <div className="rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b bg-muted/40 font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Halaman & Rute</th>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Status Sumber</th>
                <th className="px-4 py-3">Env Pengendali</th>
                <th className="px-4 py-3">Kriteria Go-Live</th>
                <th className="px-4 py-3">Jalur Baca / Tulis</th>
                <th className="px-4 py-3 text-right">Aksi Kendali</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((item) => (
                <tr key={item.pagePath} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      {item.pageTitle}
                      <Link
                        href={item.pagePath}
                        className="text-muted-foreground hover:text-foreground"
                        title="Buka Halaman"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {item.pagePath}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-xs bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                      {item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {item.status === "nyata" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        NYATA
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                        <AlertCircle className="h-3 w-3" />
                        DUMMY
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                    {item.envKey}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs">
                    {item.goLiveCriterion}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] text-muted-foreground max-w-xs truncate">
                    <div>R: {item.readPath}</div>
                    <div>W: {item.writePath}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleSourceStatus(item.pagePath)}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                        item.status === "dummy"
                          ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                          : "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                      }`}
                    >
                      {item.status === "dummy" ? (
                        <>
                          <ToggleLeft className="h-3.5 w-3.5" />
                          Ganti ke Nyata
                        </>
                      ) : (
                        <>
                          <ToggleRight className="h-3.5 w-3.5" />
                          Ganti ke Dummy
                        </>
                      )}
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
                    Tidak ada halaman yang cocok dengan filter pencarian.
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
