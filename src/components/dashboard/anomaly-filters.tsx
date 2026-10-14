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

  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
      <Field id="anomaly-search" label="Cari">
        <Input
          id="anomaly-search"
          type="search"
          data-testid="anomaly-search-input"
          placeholder="Pelanggan, router, ODP, keterangan"
          value={filters.query ?? ""}
          onChange={(event) =>
            onChange({ ...filters, query: event.target.value })
          }
        />
      </Field>
      <Field id="anomaly-router" label="Router">
        <select
          id="anomaly-router"
          className={selectClassName}
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
      <Field id="anomaly-kind" label="Jenis">
        <select
          id="anomaly-kind"
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
      <Field id="anomaly-severity" label="Tingkat">
        <select
          id="anomaly-severity"
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
      <Field id="anomaly-status" label="Status">
        <select
          id="anomaly-status"
          className={selectClassName}
          value={filters.status}
          onChange={(event) =>
            onChange({
              ...filters,
              status: event.target.value as AnomalyStatusFilter,
            })
          }
        >
          <option value="all">Semua status ({n(statusTotal)})</option>
          <option value="active">Aktif ({n(counts.status.active)})</option>
          <option value="resolved">
            Selesai ({n(counts.status.resolved)})
          </option>
        </select>
      </Field>
      <Button
        variant="ghost"
        size="sm"
        className="lg:mb-0.5"
        onClick={() => onChange(defaultAnomalyFilters)}
        disabled={!hasActiveAnomalyFilters(filters)}
      >
        Reset filter
      </Button>
    </div>
  );
}
