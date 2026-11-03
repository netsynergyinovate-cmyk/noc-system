"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { anomalyRules } from "@/lib/dashboard/anomalies";
import {
  defaultAnomalyFilters,
  hasActiveAnomalyFilters,
  type AnomalyFilters,
  type AnomalyStatusFilter,
  type FacetCounts,
} from "@/lib/dashboard/anomaly-filter";
import { formatInteger } from "@/lib/dashboard/format";
import {
  incidentLabels,
  incidentSeverityLabels,
} from "@/lib/dashboard/incidents";
import type { IncidentKind, IncidentSeverity } from "@/lib/dashboard/types";
import { selectClassName } from "./select-class";

const severities: IncidentSeverity[] = ["critical", "warning", "info"];

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className ?? "flex flex-col gap-1"}>
      <Label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

// Saringan daftar anomali. Angka di tiap pilihan adalah banyaknya anomali yang
// akan tampil bila pilihan itu dipilih (saringan lain tetap berlaku).
export function AnomalyFilterBar({
  filters,
  counts,
  routers = [],
  onChange,
}: {
  filters: AnomalyFilters;
  counts: FacetCounts;
  routers?: { id: string; name: string }[];
  onChange: (filters: AnomalyFilters) => void;
}) {
  const n = formatInteger;
  const kindTotal = anomalyRules.reduce(
    (sum, rule) => sum + counts.kind[rule.kind],
    0,
  );
  const severityTotal = severities.reduce(
    (sum, severity) => sum + counts.severity[severity],
    0,
  );
  const statusTotal = counts.status.active + counts.status.resolved;
  const statusTabs: { value: AnomalyStatusFilter; label: string; count: number }[] = [
    { value: "all", label: "Semua", count: statusTotal },
    { value: "active", label: "Aktif", count: counts.status.active },
    { value: "unreviewed", label: "Belum selesai", count: counts.status.unreviewed },
    { value: "resolved", label: "Selesai", count: counts.status.resolved },
  ];

  return (
    <div className="flex flex-col gap-1.5 bg-muted/40 p-2 rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Status"
          className="inline-flex rounded-md border border-border bg-background p-0.5"
        >
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={filters.status === tab.value}
              title={
                tab.value === "unreviewed"
                  ? "Aktif dan belum ditandai ditinjau. Tanda ditinjau tersimpan per peramban."
                  : undefined
              }
              data-testid={`anomaly-status-${tab.value}`}
              onClick={() => onChange({ ...filters, status: tab.value })}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                filters.status === tab.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span className="font-mono tabular-nums opacity-80">{n(tab.count)}</span>
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => onChange(defaultAnomalyFilters)}
          disabled={!hasActiveAnomalyFilters(filters)}
          title="Reset filter"
        >
          Reset filter
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-1.5 items-end">
      <Field id="anomaly-search" label="Cari" className="lg:col-span-5 flex flex-col gap-1">
        <Input
          id="anomaly-search"
          type="search"
          data-testid="anomaly-search-input"
          placeholder="Pelanggan, router, ODP, keterangan"
          className="h-8 text-[11px] bg-background"
          value={filters.query ?? ""}
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
        />
      </Field>
      <Field id="anomaly-router" label="Router" className="lg:col-span-3 flex flex-col gap-1">
        <select
          id="anomaly-router"
          className={`${selectClassName} h-8 py-1 px-2 text-[11px] bg-background`}
          value={filters.routerId ?? "all"}
          onChange={(event) =>
            onChange({ ...filters, routerId: event.target.value })
          }
        >
          <option value="all">Semua router</option>
          {routers.map((router) => (
            <option key={router.id} value={router.id}>
              {router.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="anomaly-kind" label="Jenis" className="lg:col-span-2 flex flex-col gap-1">
        <select
          id="anomaly-kind"
          className={`${selectClassName} h-8 py-1 px-2 text-[11px] bg-background`}
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
      <Field id="anomaly-severity" label="Tingkat" className="lg:col-span-2 flex flex-col gap-1">
        <select
          id="anomaly-severity"
          className={`${selectClassName} h-8 py-1 px-2 text-[11px] bg-background`}
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
      </div>
    </div>
  );
}
