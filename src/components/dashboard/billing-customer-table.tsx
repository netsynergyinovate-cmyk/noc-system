"use client";

import { memo, useMemo, useState } from "react";
import { CircleCheck, Info, SearchX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  billingMatchHints,
  billingMatchLabels,
  type BillingMatch,
  type BillingRow,
} from "@/lib/dashboard/billing";
import {
  billingFacetCounts,
  billingRouters,
  defaultBillingFilters,
  filterBillingRows,
  hasActiveBillingFilters,
  type BillingFilters,
} from "@/lib/dashboard/billing-filter";
import {
  billingBadge,
  billingBadgeLegend,
} from "@/lib/dashboard/billing-badge";
import { formatInteger } from "@/lib/dashboard/format";
import { BillingFilterBar } from "./billing-filters";
import { BillingStatusBadge } from "./billing-status-badge";

const matchIcons = {
  exact: { Icon: CircleCheck, className: "text-success" },
  normalized: { Icon: Info, className: "text-muted-foreground" },
  none: { Icon: TriangleAlert, className: "text-warning" },
} as const;

const matchOrder: BillingMatch[] = ["exact", "normalized", "none"];

// Apa yang terjadi pada baris ini waktu dicocokkan. Tulisan menyebut
// keadaannya; ikon dan warna hanya pelengkap.
function MatchCell({ row }: { row: BillingRow }) {
  const { Icon, className } = matchIcons[row.match];
  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Icon className={`size-3.5 shrink-0 ${className}`} aria-hidden="true" />
        {billingMatchLabels[row.match]}
      </span>
      {row.match === "normalized" && (
        <span className="text-xs text-muted-foreground">
          Di billing:{" "}
          <code
            data-testid="billing-name"
            className="font-mono whitespace-pre text-foreground"
          >
            {`“${row.billingName}”`}
          </code>
        </span>
      )}
      {row.match === "none" && (
        <span className="text-xs text-muted-foreground">
          Status belum diperbarui dari billing
        </span>
      )}
    </div>
  );
}

// Objek baris tidak berganti selama datanya tidak berubah, jadi baris lain tidak
// digambar ulang saat saringan atau jam berubah.
const BillingTableRow = memo(function BillingTableRow({
  row,
}: {
  row: BillingRow;
}) {
  return (
    <tr
      data-testid="billing-row"
      data-customer-id={row.customerId}
      data-status={row.status}
      data-match={row.match}
      className="border-t"
    >
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {row.pppoeUsername}
        </div>
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
        {row.routerName}
      </td>
      <td className="px-4 py-3">
        <BillingStatusBadge status={row.status} />
      </td>
      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
        {row.invoiceRef ?? "—"}
      </td>
      <td className="px-4 py-3">
        <MatchCell row={row} />
      </td>
    </tr>
  );
});

// Daftar kosong yang sama setiap render, supaya memo tidak dihitung ulang.
const noRows: BillingRow[] = [];

// Status tagihan tiap pelanggan: yang tampil adalah hasil sinkron berhasil
// terakhir, lengkap dengan cara tagihannya dicocokkan.
export function BillingCustomerTable({ rows }: { rows: BillingRow[] | null }) {
  const [filters, setFilters] = useState<BillingFilters>(defaultBillingFilters);
  const all = rows ?? noRows;
  const visible = useMemo(
    () => filterBillingRows(all, filters),
    [all, filters],
  );
  const counts = useMemo(
    () => billingFacetCounts(all, filters),
    [all, filters],
  );
  const routers = useMemo(() => billingRouters(all), [all]);
  const filtered = hasActiveBillingFilters(filters);
  const resetFilters = () => setFilters(defaultBillingFilters);

  return (
    <Card
      data-testid="billing-customers"
      data-total={rows?.length}
      data-visible={rows ? visible.length : undefined}
      className="min-w-0"
    >
      <CardHeader>
        <CardTitle>Status tagihan pelanggan</CardTitle>
        <CardDescription role="status">
          {rows
            ? filtered
              ? `Menampilkan ${formatInteger(visible.length)} dari ${formatInteger(rows.length)} pelanggan`
              : `${formatInteger(rows.length)} pelanggan`
            : "Memuat status billing…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows === null ? (
          <div
            role="status"
            aria-label="Memuat status billing"
            className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ) : (
          <>
            <BillingFilterBar
              filters={filters}
              counts={counts}
              routers={routers}
              onChange={setFilters}
            />
            <div
              // relative: teks sr-only di dalam sel bersifat absolute; tanpa
              // penampung berposisi ia lolos dari overflow dan melebarkan
              // seluruh halaman.
              className="relative max-h-[32rem] overflow-auto rounded-lg border"
              tabIndex={0}
              role="region"
              aria-label="Daftar status billing pelanggan"
            >
              <table className="w-full min-w-[44rem] text-left text-sm">
                <caption className="sr-only">
                  Status tagihan tiap pelanggan (Lunas atau Isolir), kode
                  tagihannya, dan cara tagihan itu dicocokkan dengan nama PPPoE
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
                      Status tagihan
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Kode tagihan
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Pencocokan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr className="border-t" data-testid="billing-no-match">
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-muted-foreground"
                      >
                        <SearchX
                          className="mx-auto mb-2 size-6"
                          aria-hidden="true"
                        />
                        <p>
                          {rows.length === 0
                            ? "Belum ada pelanggan."
                            : "Tidak ada pelanggan yang cocok dengan filter."}
                        </p>
                        {rows.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={resetFilters}
                          >
                            Tampilkan semua pelanggan
                          </Button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    visible.map((row) => (
                      <BillingTableRow key={row.customerId} row={row} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div
              role="group"
              aria-labelledby="billing-legend-status"
              data-testid="billing-badge-legend"
              className="grid gap-2 text-xs text-muted-foreground"
            >
              <p
                id="billing-legend-status"
                className="font-medium text-foreground"
              >
                Arti penanda status
              </p>
              <ul className="grid gap-3 sm:grid-cols-3">
                {billingBadgeLegend.map((status) => {
                  const model = billingBadge(status);
                  return (
                    <li
                      key={model.state}
                      data-testid="billing-legend-item"
                      data-state={model.state}
                      className="flex flex-col items-start gap-1"
                    >
                      <BillingStatusBadge status={status} />
                      <span>{model.hint}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {matchOrder.map((match) => (
                <li key={match}>
                  <strong className="font-medium text-foreground">
                    {billingMatchLabels[match]}:
                  </strong>{" "}
                  {billingMatchHints[match]}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
