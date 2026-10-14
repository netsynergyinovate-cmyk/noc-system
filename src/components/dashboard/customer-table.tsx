"use client";

import { memo, useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
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
import type { DashboardCustomer } from "@/lib/dashboard/types";
import { selectClassName } from "./select-class";
import { OpticalRx } from "@/components/dashboard/optical-badge";
import { BillingBadge, HealthBadge } from "./status-badge";
import { CustomerCpeDialog } from "./customer-cpe-dialog";
import { DashboardEmptyView } from "./dashboard-empty-view";
import { resolveDashboardEmptyState } from "@/lib/dashboard/dashboard-empty-state";

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Semua status" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "weak", label: "Sinyal lemah" },
];

// Objek pelanggan hanya diganti saat statusnya berubah, jadi baris lain
// tidak digambar ulang.
const CustomerRow = memo(function CustomerRow({
  customer,
  routerName,
}: {
  customer: DashboardCustomer;
  routerName: string;
}) {
  return (
    <tr className="border-t">
      <td className="px-4 py-3">
        <div className="font-medium">{customer.name}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {customer.pppoeUsername}
        </div>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{routerName}</td>
      <td className="px-4 py-3">
        <HealthBadge health={getCustomerHealth(customer)} />
      </td>
      <td className="px-4 py-3 tabular-nums">
        <OpticalRx dbm={customer.isOnline ? customer.opticalPowerDbm : null} />
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
  const [filters, setFilters] = useState<CustomerFilters>(defaultFilters);
  const routerNames = useMemo(
    () => new Map(routers.map((router) => [router.id, router.name])),
    [routers],
  );
  const visible = useMemo(
    () => filterCustomers(customers, filters),
    [customers, filters],
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
      <CardHeader>
        <CardTitle>Status pelanggan</CardTitle>
        <CardDescription role="status">
          {filtered
            ? `Menampilkan ${formatInteger(visible.length)} dari ${formatInteger(customers.length)} pelanggan PPPoE`
            : `${formatInteger(customers.length)} pelanggan PPPoE`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
              className="gap-2"
              onClick={() => alert("Sinkronisasi tagihan dimulai...")}
            >
              <RefreshCw className="size-3.5" />
              Sinkron Tagihan
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
        <div
          // relative: teks sr-only di dalam sel bersifat absolute; tanpa penampung
          // berposisi ia lolos dari overflow dan melebarkan seluruh halaman.
          className="relative max-h-[32rem] overflow-auto rounded-lg border"
          tabIndex={0}
          role="region"
          aria-label="Daftar status pelanggan"
        >
          <table className="w-full min-w-[40rem] text-left text-sm">
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
                    colSpan={6}
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
