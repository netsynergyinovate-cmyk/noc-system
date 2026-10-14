"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  billingMatchLabels,
  billingStatusLabels,
  type BillingMatch,
} from "@/lib/dashboard/billing";
import {
  defaultBillingFilters,
  hasActiveBillingFilters,
  type BillingFacetCounts,
  type BillingFilters,
} from "@/lib/dashboard/billing-filter";
import { formatInteger } from "@/lib/dashboard/format";
import type { BillingStatus } from "@/lib/dashboard/types";
import { selectClassName } from "./select-class";

const statuses: BillingStatus[] = ["lunas", "isolir"];
const matches: BillingMatch[] = ["exact", "normalized", "none"];

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

// Pencarian dan saringan tabel status billing. Angka di tiap pilihan adalah
// banyaknya pelanggan yang akan tampil bila pilihan itu dipilih (saringan lain
// tetap berlaku), jadi petugas tahu sebelum memilih apakah ada isinya.
export function BillingFilterBar({
  filters,
  counts,
  routers,
  onChange,
}: {
  filters: BillingFilters;
  counts: BillingFacetCounts;
  routers: { id: string; name: string }[];
  onChange: (filters: BillingFilters) => void;
}) {
  const n = formatInteger;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const statusTotal = sum(statuses.map((status) => counts.status[status]));
  const matchTotal = sum(matches.map((match) => counts.match[match]));
  const routerTotal = sum(routers.map((router) => counts.router[router.id]));

  return (
    // Enter di kolom cari tidak boleh mengirim formulir dan memuat ulang halaman.
    <form
      role="search"
      aria-label="Cari dan saring status billing"
      onSubmit={(event) => event.preventDefault()}
      className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[2fr_repeat(3,minmax(0,1fr))_auto] lg:items-end"
    >
      <div className="sm:col-span-3 lg:col-span-1">
        <Field id="billing-search" label="Cari pelanggan">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="billing-search"
              type="search"
              autoComplete="off"
              placeholder="Nama, username PPPoE, router, atau kode tagihan"
              className="pl-9"
              value={filters.query}
              onChange={(event) =>
                onChange({ ...filters, query: event.target.value })
              }
            />
          </div>
        </Field>
      </div>
      <Field id="billing-status" label="Status tagihan">
        <select
          id="billing-status"
          className={selectClassName}
          value={filters.status}
          onChange={(event) =>
            onChange({
              ...filters,
              status: event.target.value as BillingStatus | "all",
            })
          }
        >
          <option value="all">Semua status ({n(statusTotal)})</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {billingStatusLabels[status]} ({n(counts.status[status])})
            </option>
          ))}
        </select>
      </Field>
      <Field id="billing-match" label="Pencocokan">
        <select
          id="billing-match"
          className={selectClassName}
          value={filters.match}
          onChange={(event) =>
            onChange({
              ...filters,
              match: event.target.value as BillingMatch | "all",
            })
          }
        >
          <option value="all">Semua ({n(matchTotal)})</option>
          {matches.map((match) => (
            <option key={match} value={match}>
              {billingMatchLabels[match]} ({n(counts.match[match])})
            </option>
          ))}
        </select>
      </Field>
      <Field id="billing-router" label="Router">
        <select
          id="billing-router"
          className={selectClassName}
          value={filters.routerId}
          onChange={(event) =>
            onChange({ ...filters, routerId: event.target.value })
          }
        >
          <option value="all">Semua router ({n(routerTotal)})</option>
          {routers.map((router) => (
            <option key={router.id} value={router.id}>
              {router.name} ({n(counts.router[router.id])})
            </option>
          ))}
        </select>
      </Field>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="lg:mb-0.5"
        onClick={() => onChange(defaultBillingFilters)}
        disabled={!hasActiveBillingFilters(filters)}
      >
        Reset filter
      </Button>
    </form>
  );
}
