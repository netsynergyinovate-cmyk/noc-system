"use client";

import { useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  describeSyncInterval,
  describeSyncResult,
  sortRuns,
  type BillingSyncRun,
} from "@/lib/dashboard/billing";
import {
  filterSyncRuns,
  summarizeSyncHistory,
  type SyncRunStatusFilter,
} from "@/lib/dashboard/billing-history";
import {
  formatElapsed,
  formatInteger,
  isoDuration,
} from "@/lib/dashboard/format";
import { SyncTime } from "./billing-sync-parts";

// Sinkron terakhir yang sudah selesai, terbaru di atas, supaya petugas melihat
// apakah jadwalnya benar-benar berjalan dan kapan terakhir kali gagal.
export function BillingSyncHistory({
  runs,
  intervalSeconds,
  now,
}: {
  runs: BillingSyncRun[] | null;
  intervalSeconds: number;
  now: number;
}) {
  const [statusFilter, setStatusFilter] =
    useState<SyncRunStatusFilter>("all");
  const all = runs ? sortRuns(runs) : null;
  const summary = all ? summarizeSyncHistory(all) : null;
  const sorted = all ? filterSyncRuns(all, statusFilter) : null;
  const options: { value: SyncRunStatusFilter; label: string }[] = summary
    ? [
        { value: "all", label: `Semua (${summary.total})` },
        { value: "success", label: `Berhasil (${summary.success})` },
        { value: "failed", label: `Gagal (${summary.failed})` },
      ]
    : [];
  return (
    <Card
      data-testid="billing-history"
      data-count={all?.length}
      className="min-w-0"
    >
      <CardHeader>
        <CardTitle>Riwayat sinkron</CardTitle>
        <CardDescription role="status">
          {all
            ? `${formatInteger(all.length)} sinkron terakhir, terbaru di atas. Jadwalnya ${describeSyncInterval(intervalSeconds)}.`
            : "Memuat riwayat sinkron…"}
        </CardDescription>
        {summary && summary.total > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span
              data-testid="billing-history-rate"
              className="rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums"
            >
              Berhasil {summary.successRatePercent}% · rata-rata{" "}
              {formatElapsed(summary.averageDurationSeconds)}
            </span>
            <div
              role="group"
              aria-label="Saring riwayat menurut hasil"
              className="flex flex-wrap gap-1"
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  data-testid={`billing-history-filter-${o.value}`}
                  aria-pressed={statusFilter === o.value}
                  onClick={() => setStatusFilter(o.value)}
                  className="rounded-md border px-2.5 py-1 text-xs font-medium aria-pressed:bg-secondary"
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {sorted === null ? (
          <div
            role="status"
            aria-label="Memuat riwayat sinkron"
            className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ) : sorted.length === 0 ? (
          <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
            {statusFilter === "all"
              ? "Belum ada sinkron yang selesai."
              : "Tidak ada sinkron dengan hasil ini."}
          </div>
        ) : (
          <div
            // relative: lihat catatan di tabel pelanggan.
            className="relative max-h-[24rem] overflow-auto rounded-lg border"
            tabIndex={0}
            role="region"
            aria-label="Riwayat sinkron billing"
          >
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">
                Sinkron billing yang sudah selesai, yang terbaru di atas: waktu
                mulai sampai detik, lamanya, hasilnya, dan keterangannya
              </caption>
              <thead className="sticky top-0 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Mulai
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Lama
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Hasil
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Keterangan
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((run) => {
                  const lasted = run.finishedAt - run.startedAt;
                  const ok = run.status === "success";
                  const Icon = ok ? CircleCheck : CircleX;
                  return (
                    <tr
                      key={run.id}
                      data-testid="billing-run-row"
                      data-run-id={run.id}
                      data-outcome={run.status}
                      className="border-t"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <SyncTime
                          seconds={run.startedAt}
                          now={now}
                          testId="billing-run-started"
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                        <time
                          dateTime={isoDuration(lasted)}
                          data-testid="billing-run-lasted"
                        >
                          {formatElapsed(lasted)}
                        </time>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <Icon
                            className={
                              ok
                                ? "size-3.5 text-success"
                                : "size-3.5 text-destructive"
                            }
                            aria-hidden="true"
                          />
                          {ok ? "Berhasil" : "Gagal"}
                        </span>
                      </td>
                      <td
                        data-testid="billing-run-note"
                        className="px-4 py-3 text-muted-foreground"
                      >
                        {ok && run.result
                          ? `${describeSyncResult(run.result)}; ${formatInteger(run.result.withoutInvoice)} pelanggan tanpa tagihan`
                          : (run.error ?? "Gagal tanpa keterangan")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
