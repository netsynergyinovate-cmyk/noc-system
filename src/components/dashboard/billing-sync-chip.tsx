"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  BILLING_REFRESH_MS,
  describeSyncState,
  loadBillingSync,
  nextBillingRefreshAt,
  summarizeSync,
  type BillingSyncState,
} from "@/lib/dashboard/billing";
import { usePolled } from "@/lib/dashboard/use-polled";
import { useRefreshAt } from "@/lib/dashboard/use-refresh-at";
import { RunningDuration } from "./running-duration";
import { SyncAge, SyncStateIcon, SyncTime } from "./billing-sync-parts";

function ChipBody({ sync, now }: { sync: BillingSyncState; now: number }) {
  const status = describeSyncState(sync);
  const { last, lastSuccess } = summarizeSync(sync.runs);
  return (
    <div
      data-testid="billing-sync-chip"
      data-phase={status.phase}
      data-last-status={last?.status ?? "none"}
      data-failures={status.failures}
      className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 self-start rounded-lg border bg-card px-3 py-2 text-sm"
    >
      <SyncStateIcon status={status} size="sm" />
      <div className="flex min-w-0 flex-col">
        <p role="status" className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">Billing</span>
          <strong
            data-testid="billing-chip-headline"
            data-tone={status.tone}
            className="font-semibold"
          >
            {status.text}
          </strong>
          {sync.running ? (
            <span data-testid="billing-chip-detail">
              mulai{" "}
              <SyncTime
                seconds={sync.running.startedAt}
                now={now}
                testId="billing-chip-running-since"
              />
              ,{" "}
              <RunningDuration
                startedAt={sync.running.startedAt}
                testId="billing-chip-running-for"
              />
            </span>
          ) : last ? (
            <span data-testid="billing-chip-detail">
              pukul{" "}
              <SyncTime
                seconds={last.finishedAt}
                now={now}
                testId="billing-chip-last-at"
              />{" "}
              (<SyncAge at={last.finishedAt} testId="billing-chip-last-age" />)
            </span>
          ) : null}
        </p>
        {last?.status === "failed" && !sync.running && (
          <p
            data-testid="billing-chip-data"
            className="text-xs text-muted-foreground"
          >
            {lastSuccess ? (
              <>
                Data tagihan per{" "}
                <SyncTime
                  seconds={lastSuccess.finishedAt}
                  now={now}
                  testId="billing-chip-data-at"
                />{" "}
                (
                <SyncAge
                  at={lastSuccess.finishedAt}
                  testId="billing-chip-data-age"
                />
                )
              </>
            ) : (
              "Belum ada sinkron yang berhasil."
            )}
          </p>
        )}
      </div>
      <Button variant="link" size="sm" className="ml-auto h-auto p-0" asChild>
        <Link href="/app/billing">Lihat rincian</Link>
      </Button>
    </div>
  );
}

// Ringkasan keadaan sinkron billing untuk halaman yang menampilkan status
// tagihan (tabel Pelanggan): kapan sinkron terakhir, berhasil atau gagal, dan
// tautan ke halaman Billing. Datanya hanya keadaan sinkron (loadBillingSync),
// bukan seluruh daftar tagihan, dan disegarkan seperti di halaman Billing:
// berkala, tepat saat sinkron mulai, dan sering selama berjalan.
export function BillingSyncChip() {
  const { state, failed, retry } = usePolled(
    loadBillingSync,
    BILLING_REFRESH_MS,
  );
  const sync = state?.data ?? null;
  const now = state?.now ?? 0;
  useRefreshAt(sync ? nextBillingRefreshAt(sync, now) : null, retry);

  if (sync) return <ChipBody sync={sync} now={now} />;
  if (failed) {
    return (
      <div
        role="alert"
        className="flex max-w-full flex-wrap items-center gap-3 self-start rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        Keadaan sinkron billing belum bisa dimuat.
        <Button variant="outline" size="sm" onClick={retry}>
          Coba lagi
        </Button>
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-label="Memuat keadaan sinkron billing"
      className="h-12 w-full max-w-md animate-pulse self-start rounded-lg bg-muted motion-reduce:animate-none"
    />
  );
}
