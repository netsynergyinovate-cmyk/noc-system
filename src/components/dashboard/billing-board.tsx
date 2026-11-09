"use client";

import { useMemo } from "react";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { Ban, CircleCheck, FileQuestion, Unlink } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BILLING_REFRESH_MS,
  loadBilling,
  nextBillingRefreshAt,
  summarizeBilling,
  withLiveStatuses,
  type BillingTotals,
} from "@/lib/dashboard/billing";
import { formatInteger } from "@/lib/dashboard/format";
import {
  selectBillingStatuses,
  useDashboardStore,
} from "@/lib/dashboard/store";
import { usePolled } from "@/lib/dashboard/use-polled";
import { useRefreshAt } from "@/lib/dashboard/use-refresh-at";
import { BillingCustomerTable } from "./billing-customer-table";
import { BillingMismatchList } from "./billing-mismatch-list";
import { mockBillingSession } from "@/lib/dashboard/billing-session";
import { BillingSessionCard } from "./billing-session-card";
import { BillingSyncCard } from "./billing-sync-card";
import { BillingSyncHistory } from "./billing-sync-history";
import { MetricCard } from "./metric-card";

function Skeleton({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-lg bg-muted motion-reduce:animate-none",
        className,
      )}
    />
  );
}

function percentOf(count: number, total: number) {
  return total === 0
    ? "Belum ada pelanggan"
    : `${Math.round((count / total) * 100)}% dari ${formatInteger(total)} pelanggan`;
}

// Empat angka sekilas. Warna hanya pelengkap: makna ada di label dan keterangan.
function BillingTiles({ totals }: { totals: BillingTotals }) {
  return (
    <section
      aria-label="Ringkasan status billing"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <MetricCard
        data-testid="billing-tile"
        data-kind="lunas"
        data-value={totals.lunas}
        label="Lunas"
        value={formatInteger(totals.lunas)}
        hint={percentOf(totals.lunas, totals.customers)}
        Icon={CircleCheck}
        tone="success"
      />
      <MetricCard
        data-testid="billing-tile"
        data-kind="isolir"
        data-value={totals.isolir}
        label="Isolir"
        value={formatInteger(totals.isolir)}
        hint={percentOf(totals.isolir, totals.customers)}
        Icon={Ban}
        tone="danger"
      />
      <MetricCard
        data-testid="billing-tile"
        data-kind="unmatched"
        data-value={totals.unmatchedInvoices}
        label="Tagihan belum cocok"
        value={formatInteger(totals.unmatchedInvoices)}
        hint={
          totals.unmatchedInvoices === 0
            ? "Semua tagihan cocok dengan pelanggan"
            : "Tagihan yang tidak bisa dipasangkan dengan pelanggan"
        }
        Icon={Unlink}
        tone={totals.unmatchedInvoices === 0 ? "success" : "warning"}
      />
      <MetricCard
        data-testid="billing-tile"
        data-kind="without-invoice"
        data-value={totals.withoutInvoice}
        label="Tanpa tagihan"
        value={formatInteger(totals.withoutInvoice)}
        hint={
          totals.withoutInvoice === 0
            ? "Semua pelanggan punya tagihan"
            : "Pelanggan yang statusnya belum diperbarui dari billing"
        }
        Icon={FileQuestion}
        tone={totals.withoutInvoice === 0 ? "success" : "warning"}
      />
    </section>
  );
}

// Halaman Billing: keadaan sinkron, ringkasan, status tagihan tiap pelanggan,
// ketidakcocokan, dan riwayat sinkron. Data dimuat lewat loadBilling (tiruan
// sekarang, GET /api/v1/billing nanti). Status tiap pelanggan ikut berubah dari
// store, tempat pesan hub tiba, bersamaan dengan lencana di tabel Pelanggan dan di
// peta, jadi tabel dan angka ringkasan di sini tidak menunggu penyegaran berikutnya.
export function BillingBoard() {
  const isDemo = useSession(selectPreviewEnabled);
  const { state, failed, retry } = usePolled(loadBilling, BILLING_REFRESH_MS);
  const overview = state?.data ?? null;
  const now = state?.now ?? 0;
  const live = useDashboardStore(useShallow(selectBillingStatuses));
  const overviewRows = overview?.rows ?? null;
  const rows = useMemo(
    () => (overviewRows ? withLiveStatuses(overviewRows, live) : null),
    [overviewRows, live],
  );
  const unmatched = overview?.unmatched ?? null;
  const sync = overview?.sync;
  const session = useMemo(
    () => (sync ? mockBillingSession(sync) : null),
    [sync],
  );
  const totals = useMemo(
    () => (rows && unmatched ? summarizeBilling(rows, unmatched) : null),
    [rows, unmatched],
  );

  // Sinkron mulai tepat pada jamnya, dan selesai beberapa detik kemudian: tanya
  // lagi pada saat-saat itu, tanpa menunggu penyegaran berkala.
  useRefreshAt(
    overview ? nextBillingRefreshAt(overview.sync, now) : null,
    retry,
  );

  return (
    <div className="flex flex-col gap-6" data-testid="billing-board">
      {isDemo && (
        <Badge
          variant="outline"
          className="gap-1.5 py-1 text-xs font-normal"
          data-testid="billing-mock-badge"
        >
          Data Tiruan Billing (Fase 2) · Wajib beralih ke sinkronisasi billing
          nyata di Fase 5
        </Badge>
      )}
      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {overview
            ? "Pembaruan terakhir gagal; yang tampil adalah data sebelumnya."
            : "Data billing belum bisa dimuat."}
          <Button variant="outline" size="sm" onClick={retry}>
            Coba lagi
          </Button>
        </div>
      )}
      {overview && session ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <BillingSyncCard sync={overview.sync} now={now} />
          <BillingSessionCard session={session} />
        </div>
      ) : (
        <Skeleton className="h-64" />
      )}
      {totals ? (
        <BillingTiles totals={totals} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      )}
      <BillingCustomerTable rows={rows} />
      <BillingMismatchList rows={rows} unmatched={unmatched} />
      <BillingSyncHistory
        runs={overview?.sync.runs ?? null}
        intervalSeconds={overview?.sync.intervalSeconds ?? 3_600}
        now={now}
      />
    </div>
  );
}
