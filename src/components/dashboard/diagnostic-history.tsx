"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Paperclip,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type DiagnosticRunDto,
  type FindingChangeKind,
  type RunComparison,
  layerLabel,
  runSummaryText,
} from "@/lib/diagnostics";
import {
  DiagnosticRunView,
  RunOrigin,
  errorMessage,
  formatWhen,
  isRunActive,
  scopeBadgeLabels,
} from "./diagnostic-run-view";

export interface DiagnosticAlertOption {
  id: string;
  type?: string;
  severity?: string;
  startedAt?: number;
  endedAt?: number | null;
  title?: string | null;
  message?: string | null;
}

export interface DiagnosticHistoryProps {
  customerId: string;
  alerts?: DiagnosticAlertOption[];
  className?: string;
}

const changeKindLabels: Record<FindingChangeKind, string> = {
  worse: "memburuk",
  better: "membaik",
  changed: "berubah",
  new: "baru",
  gone: "hilang",
  same: "sama",
};

// Salin teks dengan fallback jika clipboard API tidak tersedia.
function copyText(text: string): boolean {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function DiagnosticHistory({
  customerId,
  alerts: alertsProp,
  className,
}: DiagnosticHistoryProps) {
  // Tanpa daftar alert (panel /anomali) tombol lampirkan disembunyikan, bukan
  // menyatakan "tidak ada alert" yang belum tentu benar.
  const alerts = alertsProp ?? [];
  const canAttach = alertsProp !== undefined;
  const [runs, setRuns] = useState<DiagnosticRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Status lampirkan ke alert per-run
  const [attachRunId, setAttachRunId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string>("");
  const [attaching, setAttaching] = useState(false);
  const [attachMessage, setAttachMessage] = useState<{
    runId: string;
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/anomalies/diagnostics?customerId=${encodeURIComponent(customerId)}&limit=20`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error(
            await errorMessage(res, "Gagal memuat riwayat diagnosa"),
          );
        }
        const { data } = (await res.json()) as { data: DiagnosticRunDto[] };
        if (!stopped) {
          setRuns(data);
          setError(null);
        }
      } catch (e) {
        if (!stopped) {
          setError(
            e instanceof Error ? e.message : "Gagal memuat riwayat diagnosa.",
          );
        }
      }
    }
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [customerId]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const handleCompare = async () => {
    if (selectedIds.length !== 2 || !runs) return;
    const r1 = runs.find((r) => r.id === selectedIds[0]);
    const r2 = runs.find((r) => r.id === selectedIds[1]);
    if (!r1 || !r2) return;
    const t1 = new Date(r1.createdAt).getTime();
    const t2 = new Date(r2.createdAt).getTime();
    // Urutkan waktu sendiri: yang lebih lama sebagai before, yang lebih baru after
    const [older, newer] = t1 <= t2 ? [r1, r2] : [r2, r1];

    setComparing(true);
    setCompareError(null);
    try {
      const res = await fetch(
        `/api/anomalies/diagnostics/compare?before=${encodeURIComponent(older.id)}&after=${encodeURIComponent(newer.id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(
          await errorMessage(res, "Gagal membandingkan diagnosa"),
        );
      }
      const json = (await res.json()) as { data: RunComparison };
      setComparison(json.data);
    } catch (e) {
      setCompareError(
        e instanceof Error ? e.message : "Gagal membandingkan diagnosa.",
      );
    } finally {
      setComparing(false);
    }
  };

  const handleCopy = async (run: DiagnosticRunDto) => {
    let targetRun = run;
    // Jika run dalam daftar belum memuat findings lengkap, ambil detail sebelum diformat
    if (!run.findings || run.findings.length === 0) {
      try {
        const res = await fetch(
          `/api/anomalies/diagnostics/${encodeURIComponent(run.id)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const json = (await res.json()) as { data: DiagnosticRunDto };
          if (json.data) targetRun = json.data;
        }
      } catch {
        // shortcut: gunakan data ringkas jika fetch detail gagal
      }
    }
    const text = runSummaryText(targetRun);
    copyText(text);
    setCopiedId(run.id);
    setTimeout(() => {
      setCopiedId((curr) => (curr === run.id ? null : curr));
    }, 2000);
  };

  const handleAttachSubmit = async (runId: string) => {
    if (!selectedAlertId) return;
    setAttaching(true);
    setAttachMessage(null);
    try {
      const res = await fetch(
        `/api/anomalies/diagnostics/${encodeURIComponent(runId)}/attach`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId: selectedAlertId }),
        },
      );
      if (res.status === 403) {
        setAttachMessage({
          runId,
          type: "error",
          text: "Butuh izin menangani alert",
        });
        return;
      }
      if (!res.ok) {
        const msg = await errorMessage(res, "Gagal melampirkan ke tiket");
        setAttachMessage({ runId, type: "error", text: msg });
        return;
      }
      setAttachMessage({
        runId,
        type: "success",
        text: "Diagnosa berhasil dilampirkan ke tiket.",
      });
    } catch (e) {
      setAttachMessage({
        runId,
        type: "error",
        text: e instanceof Error ? e.message : "Gagal melampirkan ke tiket.",
      });
    } finally {
      setAttaching(false);
    }
  };

  return (
    <Card
      className={cn("w-full border-border", className)}
      data-testid="diagnostic-history"
    >
      <CardHeader className="p-3 pb-2 border-b border-border/40">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Riwayat Diagnosa
            </CardTitle>
            <CardDescription className="text-[11px]">
              Pemeriksaan terdahulu pelanggan ini. Pilih 2 diagnosa untuk
              membandingkan perubahan.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="history-compare-button"
            disabled={selectedIds.length !== 2 || comparing}
            onClick={() => void handleCompare()}
          >
            {comparing ? (
              <>
                <Loader2
                  aria-hidden="true"
                  className="mr-1.5 size-3 animate-spin motion-reduce:animate-none"
                />
                Membandingkan…
              </>
            ) : (
              `Bandingkan (${selectedIds.length}/2)`
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 flex flex-col gap-3">
        {compareError && (
          <p className="text-sm text-destructive" role="alert">
            {compareError}
          </p>
        )}

        {comparison && (
          <section
            data-testid="history-compare"
            aria-labelledby="comparison-heading"
            className="rounded-md border p-3 bg-muted/20 flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <h4 id="comparison-heading" className="text-sm font-semibold">
                Perbandingan diagnosa
              </h4>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setComparison(null)}
              >
                Tutup
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">
                {formatWhen(comparison.beforeAt)}:{" "}
                {comparison.verdictBefore.layer
                  ? layerLabel(comparison.verdictBefore.layer)
                  : "Normal"}
                {comparison.verdictBefore.scope && (
                  <span className="ml-1 text-muted-foreground">
                    (
                    {scopeBadgeLabels[
                      comparison.verdictBefore
                        .scope as keyof typeof scopeBadgeLabels
                    ] ?? comparison.verdictBefore.scope}
                    )
                  </span>
                )}
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-3 text-muted-foreground"
              />
              <span className="font-medium">
                {formatWhen(comparison.afterAt)}:{" "}
                {comparison.verdictAfter.layer
                  ? layerLabel(comparison.verdictAfter.layer)
                  : "Normal"}
                {comparison.verdictAfter.scope && (
                  <span className="ml-1 text-muted-foreground">
                    (
                    {scopeBadgeLabels[
                      comparison.verdictAfter
                        .scope as keyof typeof scopeBadgeLabels
                    ] ?? comparison.verdictAfter.scope}
                    )
                  </span>
                )}
              </span>
              <span className="text-muted-foreground">
                ·{" "}
                {comparison.verdictChanged
                  ? "Kesimpulan berubah"
                  : "Kesimpulan sama"}
              </span>
            </div>

            {comparison.changes.length > 0 ? (
              <ul className="flex flex-col divide-y text-xs">
                {comparison.changes.map((c) => (
                  <li
                    key={`${c.layer}-${c.metric}`}
                    data-testid="history-change"
                    className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {layerLabel(c.layer)} · {c.label}
                      </span>
                      <Badge
                        variant={
                          c.kind === "worse" ? "destructive" : "secondary"
                        }
                        className={
                          c.kind === "better"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : c.kind === "changed"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : c.kind === "new"
                                ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                                : undefined
                        }
                      >
                        {changeKindLabels[c.kind] ?? c.kind}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                      <span>
                        Sebelum: {c.before?.status ?? "—"}{" "}
                        {c.before?.value ? `(${c.before.value})` : ""}{" "}
                        {c.before?.threshold
                          ? `[ambang ${c.before.threshold}]`
                          : ""}
                      </span>
                      <span>→</span>
                      <span>
                        Sesudah: {c.after?.status ?? "—"}{" "}
                        {c.after?.value ? `(${c.after.value})` : ""}{" "}
                        {c.after?.threshold
                          ? `[ambang ${c.after.threshold}]`
                          : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Tidak ada perubahan temuan antara kedua diagnosa ini.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              {comparison.sameCount} temuan lainnya tidak berubah.
            </p>
          </section>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {!runs ? (
          <p className="text-sm text-muted-foreground">
            Memuat riwayat diagnosa…
          </p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada riwayat diagnosa untuk pelanggan ini.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {runs.map((r) => {
              const scope =
                r.verdictScope ?? (r.isSharedFault ? "shared" : null);
              const isSelected = selectedIds.includes(r.id);
              const isMaxSelected = selectedIds.length >= 2 && !isSelected;
              const isExpanded = expandedRunId === r.id;
              const isAttachOpen = attachRunId === r.id;
              const isCopied = copiedId === r.id;

              return (
                <li
                  key={r.id}
                  data-testid="history-run"
                  data-run-id={r.id}
                  className="flex flex-col gap-1.5 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Pilih diagnosa ${formatWhen(r.createdAt)} untuk dibandingkan`}
                        checked={isSelected}
                        disabled={isMaxSelected}
                        onChange={() => toggleSelect(r.id)}
                        className="mt-1 size-4 rounded border-input text-primary focus:ring-1 focus:ring-ring"
                      />
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {formatWhen(r.createdAt)}
                          </span>
                          <RunOrigin run={r} />
                          {scope && (
                            <Badge
                              variant={
                                scope === "shared"
                                  ? "destructive"
                                  : scope === "unknown"
                                    ? "secondary"
                                    : "outline"
                              }
                              className={
                                scope === "shared"
                                  ? "border-destructive/40 bg-destructive/10 text-destructive text-[11px]"
                                  : "text-[11px]"
                              }
                            >
                              {scopeBadgeLabels[scope]}
                            </Badge>
                          )}
                          <Badge
                            variant={
                              r.status === "failed"
                                ? "destructive"
                                : r.status === "done"
                                  ? "outline"
                                  : "secondary"
                            }
                            className="text-[11px]"
                          >
                            {r.status === "done"
                              ? "Selesai"
                              : r.status === "failed"
                                ? "Gagal"
                                : r.status === "running"
                                  ? "Berjalan"
                                  : "Antrean"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
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
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        data-testid="history-copy"
                        onClick={() => void handleCopy(r)}
                      >
                        {isCopied ? (
                          <>
                            <Check
                              aria-hidden="true"
                              className="size-3 text-emerald-600"
                            />
                            Tersalin
                          </>
                        ) : (
                          <>
                            <Copy aria-hidden="true" className="size-3" />
                            Salin ringkasan
                          </>
                        )}
                      </Button>

                      {canAttach && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          data-testid="history-attach"
                          onClick={() => {
                            setAttachRunId(isAttachOpen ? null : r.id);
                            if (
                              !isAttachOpen &&
                              alerts.length > 0 &&
                              !selectedAlertId
                            ) {
                              setSelectedAlertId(alerts[0].id);
                            }
                          }}
                        >
                          <Paperclip aria-hidden="true" className="size-3" />
                          Lampirkan ke tiket
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() =>
                          setExpandedRunId(isExpanded ? null : r.id)
                        }
                      >
                        {isExpanded ? (
                          <>
                            Tutup
                            <ChevronUp aria-hidden="true" className="size-3" />
                          </>
                        ) : (
                          <>
                            Detail
                            <ChevronDown
                              aria-hidden="true"
                              className="size-3"
                            />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {isAttachOpen && (
                    <div className="mt-2 rounded-md border p-3 bg-muted/20 flex flex-col gap-2">
                      <span className="text-xs font-semibold">
                        Lampirkan ringkasan diagnosa ke tiket alert:
                      </span>
                      {alerts.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Tidak ada alert untuk pelanggan ini yang dapat
                          dilampirkan.
                        </p>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Pilih alert pelanggan"
                            value={selectedAlertId}
                            onChange={(e) => setSelectedAlertId(e.target.value)}
                            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            {alerts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.title || a.type} ({a.severity})
                                {a.startedAt
                                  ? ` · ${formatWhen(new Date(a.startedAt * 1000).toISOString())}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={attaching || !selectedAlertId}
                            onClick={() => void handleAttachSubmit(r.id)}
                          >
                            {attaching ? "Melampirkan…" : "Kirim ke tiket"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setAttachRunId(null)}
                          >
                            Batal
                          </Button>
                        </div>
                      )}
                      {attachMessage && attachMessage.runId === r.id && (
                        <p
                          className={cn(
                            "text-xs font-medium",
                            attachMessage.type === "error"
                              ? "text-destructive"
                              : "text-emerald-600 dark:text-emerald-400",
                          )}
                          role="status"
                        >
                          {attachMessage.text}
                        </p>
                      )}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-2 rounded-md border p-3 bg-muted/10">
                      <DiagnosticRunView runId={r.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
