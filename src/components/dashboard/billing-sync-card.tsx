"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "cn";
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
  describeSyncState,
  summarizeSync,
  type BillingSyncState,
} from "@/lib/dashboard/billing";
import { parseBillingScrapeError } from "@/lib/dashboard/billing-scrape-errors";
import { formatInteger } from "@/lib/dashboard/format";
import { RunningDuration } from "./running-duration";
import {
  SyncAge,
  SyncCountdown,
  SyncStateIcon,
  SyncTime,
} from "./billing-sync-parts";

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex flex-col text-sm">{children}</dd>
    </div>
  );
}

// Keadaan sinkron billing: yang terakhir selesai, yang berikutnya, dan dari
// sinkron mana data tagihan di halaman ini berasal. Sinkron yang gagal tidak
// menghapus data: halaman tetap menampilkan hasil sinkron berhasil terakhir,
// dan kartu ini menyebut sudah berapa lama data itu.
export function BillingSyncCard({
  sync,
  now,
}: {
  sync: BillingSyncState;
  // Detik epoch saat data ini diminta, untuk menulis "hari ini atau bukan".
  now: number;
}) {
  const summary = useMemo(() => summarizeSync(sync.runs), [sync.runs]);
  const { last, lastSuccess, consecutiveFailures } = summary;
  const running = sync.running !== null;
  const status = describeSyncState(sync);
  const failed = last?.status === "failed";
  const errorDetail =
    failed && last
      ? parseBillingScrapeError(last.error, consecutiveFailures)
      : null;

  return (
    <Card
      data-testid="billing-sync"
      data-running={running}
      data-last-status={last?.status ?? "none"}
      data-failures={consecutiveFailures}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Sinkron billing
          {(sync as { source?: string }).source === "live" && (
            <span
              data-testid="billing-source"
              data-source="live"
              className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
            >
              Koneksi Billing Aktif
            </span>
          )}
          {(sync as { source?: string }).source === "mock" && (
            <span
              data-testid="billing-source"
              data-source="mock"
              className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            >
              Simulasi (Mock)
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Berjalan otomatis {describeSyncInterval(sync.intervalSeconds)}:
          tagihan dibaca dari sistem billing, lalu dicocokkan dengan pelanggan
          lewat nama koneksi PPPoE.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <SyncStateIcon status={status} />
          <div className="min-w-0">
            <p
              role="status"
              data-testid="billing-headline"
              data-tone={status.tone}
              className="text-lg font-semibold tracking-tight"
            >
              {status.text}
            </p>
            {sync.running && (
              <p className="text-sm text-muted-foreground">
                Mulai{" "}
                <SyncTime
                  seconds={sync.running.startedAt}
                  now={now}
                  testId="billing-running-since"
                />
                ,{" "}
                <RunningDuration
                  startedAt={sync.running.startedAt}
                  testId="billing-running-for"
                />
              </p>
            )}
          </div>
        </div>

        {failed && last && errorDetail && (
          <div
            role="status"
            data-testid="billing-error"
            data-tone={errorDetail.tone}
            data-category={errorDetail.category}
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              errorDetail.tone === "danger"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-warning/40 bg-warning/10 text-warning",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="billing-error-badge"
                className="rounded-full border border-current px-2 py-0.5 text-xs font-medium"
              >
                {errorDetail.badgeLabel}
              </span>
              <p data-testid="billing-error-title" className="font-semibold">
                {errorDetail.title}
              </p>
            </div>
            <p
              data-testid="billing-error-raw"
              className="mt-2 break-words font-mono text-xs"
            >
              {last.error}
            </p>
            <p data-testid="billing-error-impact" className="mt-2">
              {errorDetail.explanation}{" "}
              {lastSuccess
                ? "Tabel di bawah masih memakai hasil sinkron berhasil terakhir; status pembayaran bisa sudah berubah di billing."
                : "Belum ada sinkron yang berhasil, jadi status di bawah masih yang tersimpan sebelumnya."}
            </p>
            <p data-testid="billing-error-action" className="mt-1">
              <span className="font-medium">Tindakan: </span>
              {errorDetail.actionHint}
            </p>
            <p data-testid="billing-error-retry" className="mt-1">
              <span className="font-medium">Coba ulang: </span>
              {errorDetail.retryBehavior}
            </p>
          </div>
        )}

        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Sinkron terakhir">
            {last ? (
              <>
                <span>
                  <SyncTime
                    seconds={last.finishedAt}
                    now={now}
                    testId="billing-last-at"
                  />{" "}
                  <span data-testid="billing-last-outcome">
                    ({last.status === "success" ? "berhasil" : "gagal"})
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  <SyncAge at={last.finishedAt} testId="billing-last-age" />
                </span>
              </>
            ) : (
              <span>Belum ada</span>
            )}
          </Item>
          <Item label="Sinkron berikutnya">
            {sync.running ? (
              <span data-testid="billing-next-running">Sedang berjalan</span>
            ) : (
              <>
                <SyncTime
                  seconds={sync.nextRunAt}
                  now={now}
                  testId="billing-next-at"
                />
                <span className="text-xs text-muted-foreground">
                  <SyncCountdown at={sync.nextRunAt} />
                </span>
              </>
            )}
          </Item>
          <Item label="Data tagihan per">
            {lastSuccess ? (
              <>
                <SyncTime
                  seconds={lastSuccess.finishedAt}
                  now={now}
                  testId="billing-data-at"
                />
                <span className="text-xs text-muted-foreground">
                  <SyncAge
                    at={lastSuccess.finishedAt}
                    testId="billing-data-age"
                  />
                </span>
              </>
            ) : (
              <span data-testid="billing-data-at">Belum pernah berhasil</span>
            )}
          </Item>
          <Item label="Hasil sinkron berhasil terakhir">
            {lastSuccess?.result ? (
              <>
                <span data-testid="billing-result">
                  {describeSyncResult(lastSuccess.result)}
                </span>
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="billing-result-without"
                >
                  {formatInteger(lastSuccess.result.withoutInvoice)} pelanggan
                  tanpa tagihan
                </span>
              </>
            ) : (
              <span>Belum ada</span>
            )}
          </Item>
        </dl>
      </CardContent>
    </Card>
  );
}
