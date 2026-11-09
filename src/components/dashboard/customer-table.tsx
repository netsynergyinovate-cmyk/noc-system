"use client";

import { memo, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInteger } from "@/lib/dashboard/format";
import {
  defaultFilters,
  filterCustomers,
  hasActiveFilters,
  type CustomerFilters,
  type StatusFilter,
} from "@/lib/dashboard/filter";
import { getCustomerHealth } from "@/lib/dashboard/health";
import { useDashboardStore } from "@/lib/dashboard/store";
import type { BillingStatus, DashboardCustomer } from "@/lib/dashboard/types";
import { selectClassName } from "./select-class";
import { OpticalRx } from "@/components/dashboard/optical-badge";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { useCustomerLiveStatus } from "@/lib/dashboard/use-customer-live-status";
import type { CustomerLiveStatus } from "@/lib/dashboard/customer-live";
import { BillingBadge, HealthBadge } from "./status-badge";
import { CustomerCpeDialog } from "./customer-cpe-dialog";
import { DashboardEmptyView } from "./dashboard-empty-view";
import { resolveDashboardEmptyState } from "@/lib/dashboard/dashboard-empty-state";

// Pelanggan tiruan (mode demo) tidak punya baris database, jadi tidak punya halaman detail.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Semua status" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "weak", label: "Sinyal lemah" },
  { value: "los", label: "LOS (Kabel putus)" },
];

// Objek pelanggan hanya diganti saat statusnya berubah, jadi baris lain
// tidak digambar ulang.
const CustomerRow = memo(function CustomerRow({
  customer,
  routerName,
  live,
}: {
  customer: DashboardCustomer;
  routerName: string;
  live: CustomerLiveStatus | undefined;
}) {
  // Redaman: bila LOS maka null; modem (GenieACS) atau OLT dari data langsung; nilai di tabel pelanggan hanya cadangan.
  const optical = {
    dbm: live?.onuLos
      ? null
      : (live?.rxDbm ??
        (customer.isOnline ? (customer.opticalPowerDbm ?? null) : null)),
  };
  const staleTitle =
    live?.informAt && !live.modemOnline
      ? `Bacaan terakhir modem, ${new Date(live.informAt * 1000).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })}`
      : undefined;
  return (
    <tr className="border-t">
      <td className="px-4 py-3">
        {UUID.test(customer.id) ? (
          <Link
            href={`/app/pelanggan/${customer.id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {customer.name}
          </Link>
        ) : (
          <div className="font-medium">{customer.name}</div>
        )}
        <div className="font-mono text-xs text-muted-foreground">
          {customer.pppoeUsername}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{routerName}</td>
      <td className="px-4 py-3">
        {live?.onuLos ? (
          <span
            title="Kabel optik putus / Loss of Signal di OLT"
            className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive animate-pulse"
          >
            <span className="size-1.5 rounded-full bg-destructive" />
            LOS (Putus)
          </span>
        ) : (
          <HealthBadge health={getCustomerHealth(customer)} />
        )}
      </td>
      <td className="px-4 py-3">
        {live?.ip && IPV4.test(live.ip) ? (
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs">{live.ip}</span>
            <a
              href={`http://${live.ip}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Buka ${live.ip} di tab baru`}
              title="Buka di tab baru"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td
        className={`px-4 py-3 text-xs tabular-nums ${live?.modemOnline ? "" : "text-muted-foreground"}`}
        title={staleTitle}
      >
        {live?.uptime ?? "—"}
        {live?.uptime && live.staleNote && (
          <div className="text-[10px] font-normal">{live.staleNote}</div>
        )}
      </td>
      <td className="px-4 py-3 text-xs">
        {live?.ssid ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td
        className={`px-4 py-3 text-xs tabular-nums ${live?.modemOnline ? "" : "text-muted-foreground"}`}
        title={staleTitle}
      >
        {live?.clients ?? "—"}
        {live?.clients != null && live.staleNote && (
          <div className="text-[10px] font-normal">{live.staleNote}</div>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums">
        {optical.dbm !== null ? (
          <div>
            <OpticalRx dbm={optical.dbm} />
            {live?.rxSource && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {live.rxSource === "genieacs" ? "dari modem" : "dari OLT"}
              </div>
            )}
          </div>
        ) : live?.onuLos ? (
          <div>
            <OpticalRx dbm={null} />
            <div className="mt-0.5 text-[10px] font-semibold text-destructive">
              Kabel Putus (LOS OLT)
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Belum ada data</span>
        )}
      </td>
      <td className="px-4 py-3">
        <BillingBadge status={customer.billingStatus} />
      </td>
      <td className="px-4 py-3 text-right">
        <CustomerCpeDialog customer={customer} />
      </td>
    </tr>
  );
});

export function CustomerTable() {
  const customers = useDashboardStore((state) => state.customers);
  const routers = useDashboardStore((state) => state.routers);
  const isDemo = useSession(selectPreviewEnabled);
  const live = useCustomerLiveStatus(!isDemo);
  const [filters, setFilters] = useState<CustomerFilters>(defaultFilters);
  const [isSyncingBilling, setIsSyncingBilling] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (customers.length === 0) {
      fetch("/api/customers")
        .then((res) => res.json())
        .then((json) => {
          if (
            active &&
            json.ok &&
            Array.isArray(json.data) &&
            json.data.length > 0
          ) {
            const list = json.data as DashboardCustomer[];
            useDashboardStore.setState({
              customers: list,
              onlineCount: list.filter((c) => c.isOnline).length,
              offlineCount: list.filter((c) => !c.isOnline).length,
              weakSignalCount: list.filter(
                (c) => getCustomerHealth(c) === "warning",
              ).length,
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [customers.length]);

  const handleSyncBillingNames = async () => {
    try {
      setIsSyncingBilling(true);
      setSyncFeedback(null);
      const res = await fetch("/api/customers/sync-billing-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pullFresh: false }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setSyncFeedback({
          type: "success",
          message:
            json.message ||
            "Nama pelanggan berhasil dicocokkan dan diperbarui dari billing.",
        });

        if (Array.isArray(json.data?.updatedCustomers)) {
          type SyncedCustomerItem = {
            id: string;
            newName: string;
            billingStatus: BillingStatus;
          };
          const items = json.data.updatedCustomers as SyncedCustomerItem[];
          const map = new Map<string, SyncedCustomerItem>(
            items.map((u) => [u.id, u]),
          );
          useDashboardStore.setState((prev) => ({
            customers: prev.customers.map((c) => {
              const u = map.get(c.id);
              if (u) {
                return {
                  ...c,
                  name: u.newName,
                  billingStatus: u.billingStatus,
                };
              }
              return c;
            }),
          }));
        }
      } else {
        setSyncFeedback({
          type: "error",
          message: json.error || "Gagal menarik nama pelanggan dari billing.",
        });
      }
    } catch (err) {
      setSyncFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Gagal terhubung ke server.",
      });
    } finally {
      setIsSyncingBilling(false);
    }
  };

  const routerNames = useMemo(
    () => new Map(routers.map((router) => [router.id, router.name])),
    [routers],
  );
  // Redaman langsung (modem atau OLT) dipakai untuk badge status dan filter "Sinyal lemah", supaya sama dengan kolom
  // Sinyal optik; nilai di tabel pelanggan hanya cadangan sampai poller menyalin redaman OLT ke sana.
  const withLive = useMemo(
    () =>
      live
        ? customers.map((c) => {
            const rx = live[c.id]?.rxDbm;
            const isLos = live[c.id]?.onuLos;
            return {
              ...c,
              ...(rx != null ? { opticalPowerDbm: rx } : {}),
              ...(isLos ? { isLos: true, isOnline: false } : {}),
            };
          })
        : customers,
    [customers, live],
  );
  const visible = useMemo(
    () => filterCustomers(withLive, filters),
    [withLive, filters],
  );
  const filtered = hasActiveFilters(filters);
  const resetFilters = () => setFilters(defaultFilters);

  // Benar-benar tanpa pelanggan di store (bukan sekadar filter kosong).
  if (customers.length === 0) {
    const empty = resolveDashboardEmptyState({
      customerCount: 0,
      routerCount: routers.length,
      visibleCount: 0,
      isConnected: true,
      hasActiveFilter: false,
    });
    if (empty) return <DashboardEmptyView config={empty} />;
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base font-semibold">
          Status pelanggan
        </CardTitle>
        <CardDescription role="status" className="text-xs">
          {filtered
            ? `Menampilkan ${formatInteger(visible.length)} dari ${formatInteger(customers.length)} pelanggan PPPoE`
            : `${formatInteger(customers.length)} pelanggan PPPoE`}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 flex flex-col gap-3.5">
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem_11rem_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-search">Cari pelanggan</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="customer-search"
                type="search"
                autoComplete="off"
                placeholder="Nama, username PPPoE, atau alamat"
                className="pl-9"
                value={filters.query}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    query: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-status">Status</Label>
            <select
              id="customer-status"
              className={selectClassName}
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as StatusFilter,
                }))
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customer-router">Router</Label>
            <select
              id="customer-router"
              className={selectClassName}
              value={filters.routerId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  routerId: event.target.value,
                }))
              }
            >
              <option value="all">Semua router</option>
              {routers.map((router) => (
                <option key={router.id} value={router.id}>
                  {router.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 sm:mb-0.5">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-emerald-500/40 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
              onClick={handleSyncBillingNames}
              disabled={isSyncingBilling}
              title="Cocokkan ID PPPoE dan tarik nama pelanggan riil dari RunsNet Billing"
            >
              <RefreshCw
                className={`size-3.5 ${isSyncingBilling ? "animate-spin" : ""}`}
              />
              {isSyncingBilling
                ? "Menarik dari Billing..."
                : "Tarik Nama dari Billing"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              disabled={!filtered}
            >
              Reset filter
            </Button>
          </div>
        </div>

        {syncFeedback && (
          <div
            role="status"
            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-mono transition-all ${
              syncFeedback.type === "success"
                ? "border-emerald-500/40 bg-emerald-950/20 text-emerald-300"
                : "border-rose-500/40 bg-rose-950/20 text-rose-300"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${syncFeedback.type === "success" ? "bg-emerald-400" : "bg-rose-400"}`}
              />
              <span>{syncFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setSyncFeedback(null)}
              className="text-muted-foreground hover:text-foreground text-xs px-1"
            >
              ✕
            </button>
          </div>
        )}
        <div
          // relative: teks sr-only di dalam sel bersifat absolute; tanpa penampung
          // berposisi ia lolos dari overflow dan melebarkan seluruh halaman.
          className="relative max-h-[32rem] overflow-auto rounded-lg border"
          tabIndex={0}
          role="region"
          aria-label="Daftar status pelanggan"
        >
          <table className="w-full min-w-[72rem] text-left text-sm">
            <caption className="sr-only">
              Status online, sinyal optik, dan tagihan tiap pelanggan
            </caption>
            <thead className="sticky top-0 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Pelanggan
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Router
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  IP
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Uptime
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Wi-Fi
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Perangkat
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Sinyal optik
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Tagihan
                </th>
                <th scope="col" className="px-4 py-3 font-medium text-right">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr className="border-t">
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    <p>Tidak ada pelanggan yang cocok dengan filter.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={resetFilters}
                    >
                      Tampilkan semua pelanggan
                    </Button>
                  </td>
                </tr>
              ) : (
                visible.map((customer) => (
                  <CustomerRow
                    key={customer.id}
                    customer={customer}
                    routerName={routerNames.get(customer.routerId) ?? "—"}
                    live={live?.[customer.id]}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
