"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { anomalyRules } from "@/lib/dashboard/anomalies";
import { ALERT_HISTORY_SECONDS } from "@/lib/dashboard/alerts";
import { formatInteger } from "@/lib/dashboard/format";
import {
  incidentLabels,
  incidentSeverityLabels,
} from "@/lib/dashboard/incidents";
import {
  defaultResolvedFilters,
  hasActiveResolvedFilters,
  type ResolvedFacetCounts,
  type ResolvedFilters,
  type ResolvedWindow,
} from "@/lib/dashboard/resolved-filter";
import type {
  DashboardRouter,
  IncidentKind,
  IncidentSeverity,
} from "@/lib/dashboard/types";
import { selectClassName } from "./select-class";

const severities: IncidentSeverity[] = ["critical", "warning", "info"];
const windowLabels: Record<Exclude<ResolvedWindow, "all">, string> = {
  "1h": "1 jam terakhir",
  "6h": "6 jam terakhir",
  "24h": "24 jam terakhir",
};
const days = ALERT_HISTORY_SECONDS / 86_400;

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

// Pencarian dan saringan riwayat alert. Angka di tiap pilihan adalah banyaknya
// alert yang akan tampil bila pilihan itu dipilih (saringan lain tetap berlaku),
// jadi petugas tahu sebelum memilih apakah ada isinya.
export function ResolvedFilterBar({
  filters,
  counts,
  routers,
  onChange,
}: {
  filters: ResolvedFilters;
  counts: ResolvedFacetCounts;
  routers: DashboardRouter[];
  onChange: (filters: ResolvedFilters) => void;
}) {
  const n = formatInteger;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const kindTotal = sum(anomalyRules.map((rule) => counts.kind[rule.kind]));
  const severityTotal = sum(severities.map((s) => counts.severity[s]));
  const routerTotal = sum(
    routers.map((router) => counts.router[router.id] ?? 0),
  );

  return (
    // Enter di kolom cari tidak boleh mengirim formulir dan memuat ulang halaman.
    <form
      role="search"
      aria-label="Cari dan saring riwayat alert"
      onSubmit={(event) => event.preventDefault()}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end"
    >
      {/* Kolom cari satu baris penuh; pilihan di bawahnya cukup lebar untuk
          tulisan dan angkanya. */}
      <div className="sm:col-span-2 lg:col-span-5">
        <Field id="resolved-search" label="Cari alert">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="resolved-search"
              type="search"
              autoComplete="off"
              placeholder="Nama pelanggan, username PPPoE, router, ODP, alamat, atau petugas"
              className="pl-9"
              value={filters.query}
              onChange={(event) =>
                onChange({ ...filters, query: event.target.value })
              }
            />
          </div>
        </Field>
      </div>
      <Field id="resolved-kind" label="Jenis">
        <select
          id="resolved-kind"
          className={selectClassName}
          value={filters.kind}
          onChange={(event) =>
            onChange({
              ...filters,
              kind: event.target.value as IncidentKind | "all",
            })
          }
        >
          <option value="all">Semua jenis ({n(kindTotal)})</option>
          {anomalyRules.map((rule) => (
            <option key={rule.kind} value={rule.kind}>
              {incidentLabels[rule.kind]} ({n(counts.kind[rule.kind])})
            </option>
          ))}
        </select>
      </Field>
      <Field id="resolved-severity" label="Tingkat">
        <select
          id="resolved-severity"
          className={selectClassName}
          value={filters.severity}
          onChange={(event) =>
            onChange({
              ...filters,
              severity: event.target.value as IncidentSeverity | "all",
            })
          }
        >
          <option value="all">Semua tingkat ({n(severityTotal)})</option>
          {severities.map((severity) => (
            <option key={severity} value={severity}>
              {incidentSeverityLabels[severity]} ({n(counts.severity[severity])}
              )
            </option>
          ))}
        </select>
      </Field>
      <Field id="resolved-router" label="Router">
        <select
          id="resolved-router"
          className={selectClassName}
          value={filters.routerId}
          onChange={(event) =>
            onChange({ ...filters, routerId: event.target.value })
          }
        >
          <option value="all">Semua router ({n(routerTotal)})</option>
          {routers.map((router) => (
            <option key={router.id} value={router.id}>
              {router.name} ({n(counts.router[router.id] ?? 0)})
            </option>
          ))}
        </select>
      </Field>
      <Field id="resolved-window" label="Selesai dalam">
        <select
          id="resolved-window"
          className={selectClassName}
          value={filters.window}
          onChange={(event) =>
            onChange({
              ...filters,
              window: event.target.value as ResolvedWindow,
            })
          }
        >
          <option value="all">
            Semua, {days} hari ({n(counts.window.all)})
          </option>
          {(["1h", "6h", "24h"] as const).map((option) => (
            <option key={option} value={option}>
              {windowLabels[option]} ({n(counts.window[option])})
            </option>
          ))}
        </select>
      </Field>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="lg:mb-0.5"
        onClick={() => onChange(defaultResolvedFilters)}
        disabled={!hasActiveResolvedFilters(filters)}
      >
        Reset filter
      </Button>
    </form>
  );
}
