"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleHelp,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DiagnosticRunDto } from "@/lib/diagnostics";
import { layerLabel } from "@/lib/diagnostics";
import {
  DiagnosticRunView,
  RunOrigin,
  errorMessage,
  formatWhen,
  isRunActive,
} from "./diagnostic-run-view";

const PAGE_SIZE = 100;

function RunList({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const [runs, setRuns] = useState<DiagnosticRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const res = await fetch(`/api/anomalies/diagnostics?limit=${PAGE_SIZE}`, {
          cache: "no-store",
        });
        if (!res.ok)
          throw new Error(
            await errorMessage(res, "Gagal memuat riwayat diagnosa"),
          );
        const json: unknown = await res.json();
        if (json && typeof json === "object" && "data" in json) {
          const parsed = json as { data: DiagnosticRunDto[] };
          if (!stopped) {
            setRuns(parsed.data);
            setError(null);
          }
        }
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Gagal memuat riwayat diagnosa.",
          );
      }
    }
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <Card className="border-border">
      <CardHeader className="p-3 pb-2 border-b border-border/40">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Daftar Riwayat
          </CardTitle>
          <span className="text-[11px] text-muted-foreground font-mono">
            {runs ? `${runs.length} tercatat` : "…"}
          </span>
        </div>
        <CardDescription className="text-[11px]">
          Manual & otomatis, terbaru di atas.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-2">
        {error && (
          <p className="mb-1.5 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {!runs ? (
          <p className="p-2 text-xs text-muted-foreground">Memuat…</p>
        ) : runs.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">Belum ada diagnosa.</p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-border/40 max-h-[70vh] overflow-y-auto"
            data-testid="diagnostic-recent-runs"
          >
            {runs.map((r) => {
              const scope =
                r.verdictScope ?? (r.isSharedFault ? "shared" : null);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-pressed={activeId === r.id}
                    className={cn(
                      "flex w-full items-start gap-2 p-1.5 text-left text-xs rounded transition-colors hover:bg-muted/60",
                      activeId === r.id && "bg-muted font-medium",
                    )}
                    onClick={() => onOpen(r.id)}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isRunActive(r) ? (
                        <Loader2
                          aria-hidden="true"
                          className="size-3.5 animate-spin text-primary motion-reduce:animate-none"
                        />
                      ) : scope === "shared" ? (
                        <AlertTriangle
                          aria-hidden="true"
                          className="size-3.5 text-destructive"
                        />
                      ) : scope === "own" ? (
                        <CheckCircle2
                          aria-hidden="true"
                          className="size-3.5 text-success"
                        />
                      ) : (
                        <CircleHelp
                          aria-hidden="true"
                          className="size-3.5 text-muted-foreground"
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-medium text-foreground truncate">
                          {r.customerName ??
                            (scope === "shared"
                              ? "Gangguan bersama"
                              : "Pelanggan terhapus")}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground shrink-0">
                          {formatWhen(r.createdAt)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground mt-0.5">
                        <RunOrigin run={r} />
                        <span>
                          {isRunActive(r)
                            ? "sedang berjalan"
                            : r.status === "failed"
                              ? "gagal"
                              : r.verdictLayer
                                ? `bermasalah: ${layerLabel(r.verdictLayer)}${
                                    scope === "shared"
                                      ? " (gangguan bersama)"
                                      : ""
                                  }`
                                : scope === "shared"
                                  ? "diagnosa per pelanggan ditahan"
                                  : "tidak ada lapisan bermasalah"}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Halaman riwayat: daftar diagnosa di kiri, hasil lengkap yang dipilih di kanan.
export function DiagnosticRunHistory() {
  const [runId, setRunId] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="diagnostic-history-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h1
          id="diagnostic-history-heading"
          className="text-sm font-semibold uppercase tracking-wider text-foreground"
        >
          Riwayat Diagnosa
        </h1>
        <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
          <Link href="/app/anomali">
            <ArrowLeft aria-hidden="true" className="size-3" />
            Kembali
          </Link>
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[26rem_minmax(0,1fr)]">
        <RunList activeId={runId} onOpen={setRunId} />
        <Card className="border-border">
          <CardContent className="p-3">
            {runId ? (
              <DiagnosticRunView key={runId} runId={runId} />
            ) : (
              <p className="text-xs text-muted-foreground">
                Pilih satu diagnosa untuk melihat hasilnya.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
