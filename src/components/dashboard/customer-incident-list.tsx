"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  evidenceRanges,
  peakWindows,
  type CustomerIncidentRow,
  type EvidenceRangeId,
} from "@/lib/customer-evidence-types";
import {
  formatDurationCompact,
  formatWibDateTime,
} from "@/lib/customer-evidence-text";
import { cn } from "@/lib/utils";
import { formatSource, incidentSources } from "@/lib/diagnostic-sources";

export function CustomerIncidentList() {
  const [range, setRange] = useState<EvidenceRangeId>("3d");
  const [dataState, setDataState] = useState<{
    range: EvidenceRangeId;
    key: number;
    data: CustomerIncidentRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [search, setSearch] = useState<string>("");
  const [showAll, setShowAll] = useState<boolean>(false);
  const [onlyTroubled, setOnlyTroubled] = useState<boolean>(true);
  const [showExplanation, setShowExplanation] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/anomalies/customer-incidents?range=${range}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Gagal memuat gangguan pelanggan (${res.status})`);
        }
        const json = (await res.json()) as { data?: CustomerIncidentRow[] };
        if (!alive) return;
        setDataState({ range, key: reloadKey, data: json.data ?? [] });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(
          err instanceof Error
            ? err.message
            : "Gagal memuat data gangguan per pelanggan.",
        );
      });

    return () => {
      alive = false;
    };
  }, [range, reloadKey]);

  const data =
    dataState?.range === range && dataState?.key === reloadKey
      ? dataState.data
      : null;
  const loading = !error && !data;
  // Bergangguan = ada gangguan nyata atau yang masih menunggu verifikasi; sisanya hanya kedipan/tidak terbukti.
  const troubledCount = data
    ? data.filter((r) => r.summary.real > 0 || r.summary.belumTerverifikasi > 0)
        .length
    : 0;
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter(
      (row) =>
        (!onlyTroubled ||
          row.summary.real > 0 ||
          row.summary.belumTerverifikasi > 0) &&
        (!q ||
          row.name.toLowerCase().includes(q) ||
          row.pppoeUsername.toLowerCase().includes(q) ||
          (row.routerName?.toLowerCase().includes(q) ?? false)),
    );
  }, [data, search, onlyTroubled]);

  const visibleRows = showAll ? filtered : filtered.slice(0, 15);
  const peakShort: Record<string, string> = {
    siang: "Siang",
    "pulang-sekolah": "Sekolah",
    "pulang-kerja": "Kerja",
    "magrib-malam": "Magrib",
  };

  return (
    <Card className="min-w-0 shadow-2xs" data-testid="customer-incident-list">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            Gangguan per pelanggan
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowExplanation((prev) => !prev)}
            className="size-6 text-muted-foreground hover:text-foreground"
            aria-expanded={showExplanation}
            aria-label="Apa ini? Aturan penghitungan gangguan nyata"
          >
            <HelpCircle className="size-3.5" />
          </Button>
        </div>
        <Tabs
          value={range}
          onValueChange={(val) => {
            setRange(val as EvidenceRangeId);
            setShowAll(false);
          }}
        >
          <TabsList className="h-7 p-0.5">
            {evidenceRanges.map((r) => (
              <TabsTrigger
                key={r.id}
                value={r.id}
                className="px-2 py-0.5 text-xs"
              >
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        {showExplanation && (
          <div className="space-y-1.5 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Gangguan nyata</strong> =
              putus-nyambung berjarak &le; 15 menit digabung jadi satu; dihitung
              bila total down &ge; 5 menit atau &ge; 3 kali putus, dan trafik
              pelanggan membuktikannya (antrean berhenti saat down).
            </p>
            <p>
              <strong className="text-foreground">Belum terverifikasi</strong>:
              data trafik di sekitar kejadian belum ada/belum final.{" "}
              <strong className="text-foreground">Kedipan</strong>: terlalu
              singkat, tidak dihitung.{" "}
              <strong className="text-foreground">Tidak terbukti</strong>:
              trafik tetap mengalir saat tercatat down.{" "}
              <strong className="text-foreground">Massal</strong>: &ge; 3
              pelanggan lain dan &ge; 20% pelanggan router yang sama ikut down.
            </p>
            <p className="font-mono text-[10px]">
              Sumber: {incidentSources.map((s) => formatSource(s)).join(" | ")}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[220px]">
            <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Cari pelanggan…"
              aria-label="Cari pelanggan atau username"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-8 text-xs"
            />
          </div>
          <Button
            type="button"
            variant={onlyTroubled ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={onlyTroubled}
            onClick={() => {
              setOnlyTroubled((v) => !v);
              setShowAll(false);
            }}
            className="h-7 px-2 text-xs"
          >
            {onlyTroubled
              ? `Bergangguan (${troubledCount})`
              : `Semua pelanggan (${data?.length ?? 0})`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setReloadKey((k) => k + 1)}
            className="ml-auto size-7 text-muted-foreground"
            aria-label="Segarkan"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>

        {loading ? (
          <div
            role="status"
            aria-label="Memuat gangguan per pelanggan"
            className="flex h-32 items-center justify-center gap-2 text-xs text-muted-foreground"
          >
            <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
            Memuat…
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-2 rounded-md bg-destructive/10 p-5 text-center text-xs text-destructive"
          >
            <AlertCircle className="size-4" />
            <p className="font-medium">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReloadKey((k) => k + 1)}
              className="h-7 gap-1 text-xs"
            >
              <RefreshCw className="size-3" />
              Coba lagi
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            {search.trim()
              ? "Tidak ada pelanggan yang cocok."
              : onlyTroubled
                ? "Tidak ada gangguan nyata pada rentang ini."
                : "Tidak ada data pada rentang ini."}
          </p>
        ) : (
          <>
            <div className="rounded-md border border-border/60 [&_[data-slot=table-container]]:max-h-[185px] [&_[data-slot=table-container]]:overflow-y-auto">
              <Table className="min-w-[640px] text-xs">
                <TableHeader className="sticky top-0 bg-card z-20 shadow-xs">
                  <TableRow className="border-b border-border/60 hover:bg-card bg-card">
                    <TableHead className="h-8 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Pelanggan
                    </TableHead>
                    <TableHead className="h-8 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Gangguan
                    </TableHead>
                    <TableHead className="h-8 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Total down
                    </TableHead>
                    <TableHead className="h-8 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Terakhir (WIB)
                    </TableHead>
                    <TableHead className="h-8 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Jam sibuk
                    </TableHead>
                    <TableHead className="h-8 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Catatan
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const s = row.summary;
                    const notes = [
                      row.billingStatus?.toLowerCase().includes("terminate")
                        ? "billing: Terminate (cek Core)"
                        : "",
                      s.belumTerverifikasi > 0
                        ? `${s.belumTerverifikasi} belum terverifikasi`
                        : "",
                      s.kedipan > 0 ? `${s.kedipan} kedipan` : "",
                      s.tidakTerbukti > 0
                        ? `${s.tidakTerbukti} tidak terbukti`
                        : "",
                    ].filter(Boolean);
                    const peaks = peakWindows.filter(
                      (pw) => (s.realByWindow?.[pw.id] ?? 0) > 0,
                    );
                    return (
                      <TableRow
                        key={row.customerId}
                        data-testid="customer-incident-row"
                        className="border-border/40 hover:bg-muted/40 transition-colors"
                      >
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="relative flex size-2 shrink-0">
                              <span
                                className={cn(
                                  "size-2 rounded-full",
                                  row.isOnline
                                    ? "bg-emerald-500 ring-2 ring-emerald-500/20"
                                    : "bg-rose-500 ring-2 ring-rose-500/20",
                                )}
                                title={row.isOnline ? "Online" : "Offline"}
                              />
                            </span>
                            <div className="min-w-0">
                              <Link
                                href={`/app/pelanggan/${row.customerId}?range=${range}#bukti`}
                                className="block truncate font-medium text-foreground hover:text-primary transition-colors text-xs"
                              >
                                {row.name}
                              </Link>
                              <span className="block truncate text-[10px] font-mono text-muted-foreground/80">
                                {row.pppoeUsername}
                                {row.routerName ? ` · ${row.routerName}` : ""}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          {s.real > 0 ? (
                            <span className="inline-flex min-w-[24px] items-center justify-center rounded-md bg-rose-500/15 border border-rose-500/25 px-1.5 py-0.5 text-xs font-bold text-rose-500 dark:text-rose-400 tabular-nums">
                              {s.real}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30 font-mono text-xs">
                              –
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 text-right font-mono text-xs tabular-nums">
                          {s.real > 0 ? (
                            <span
                              className={cn(
                                "font-semibold",
                                s.realDownSeconds >= 3600 * 6
                                  ? "text-amber-500 dark:text-amber-400"
                                  : "text-foreground",
                              )}
                            >
                              {formatDurationCompact(s.realDownSeconds)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30">–</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                          {s.lastRealAt ? (
                            formatWibDateTime(s.lastRealAt)
                          ) : (
                            <span className="text-muted-foreground/30">–</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 whitespace-nowrap">
                          {peaks.length === 0 && s.realMassal === 0 ? (
                            <span className="text-muted-foreground/30 font-mono text-xs">
                              –
                            </span>
                          ) : (
                            <div className="flex flex-nowrap items-center gap-1">
                              {peaks.map((pw) => (
                                <span
                                  key={pw.id}
                                  title={`${pw.label}: ${s.realByWindow[pw.id]} gangguan nyata dimulai di jam ini`}
                                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap"
                                >
                                  <span>{peakShort[pw.id] ?? pw.label}</span>
                                  <span className="font-bold tabular-nums text-foreground">
                                    {s.realByWindow[pw.id]}
                                  </span>
                                </span>
                              ))}
                              {s.realMassal > 0 && (
                                <span
                                  title="Gangguan massal: pelanggan lain di router yang sama ikut down"
                                  className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-500 dark:text-rose-400 whitespace-nowrap"
                                >
                                  <span>Massal</span>
                                  <span className="tabular-nums">
                                    {s.realMassal}
                                  </span>
                                </span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                          {notes.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {notes.map((n, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground font-medium border border-border/40"
                                >
                                  {n}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/30 font-mono">
                              –
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
