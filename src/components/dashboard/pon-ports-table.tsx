"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EMPTY_PON_FILTER,
  computePonSummary,
  filterPonPorts,
  generateMockPonPortOverview,
  type PonPortFilter,
} from "@/lib/dashboard/pon-port-table-data";
import { formatInteger } from "@/lib/dashboard/format";
import { selectClassName } from "./select-class";

const OPTICAL_LABEL = { normal: "Normal", warning: "Peringatan", critical: "Kritis" } as const;
const OPTICAL_CLASS = {
  normal: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  critical: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

const dbm = (v: number | null) => (v == null ? "-" : `${v.toFixed(1)} dBm`);

export function PonPortsTable() {
  const all = useMemo(() => generateMockPonPortOverview(), []);
  const [filter, setFilter] = useState<PonPortFilter>(EMPTY_PON_FILTER);
  const rows = useMemo(() => filterPonPorts(all, filter), [all, filter]);
  const summary = useMemo(() => computePonSummary(rows), [rows]);
  const olts = useMemo(
    () => Array.from(new Map(all.map((p) => [p.oltId, p.oltName])).entries()),
    [all],
  );
  const set = <K extends keyof PonPortFilter>(key: K, value: PonPortFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  return (
    <Card data-testid="pon-ports-table">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Seluruh Port PON</CardTitle>
            <CardDescription>
              {formatInteger(summary.totalPorts)} port ({formatInteger(summary.upPorts)} UP) ·{" "}
              {formatInteger(summary.onlineOnu)}/{formatInteger(summary.totalOnu)} ONU online ·{" "}
              {formatInteger(summary.weakOnu)} redaman lemah · {formatInteger(summary.losOnu)} LOS
            </CardDescription>
          </div>
          <Badge variant="outline" data-testid="pon-onu-mock-badge">
            Data Tiruan PON (Fase 2) · Wajib beralih ke OLT nyata di Fase 5
          </Badge>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              className="pl-8"
              placeholder="Cari port atau OLT"
              aria-label="Cari port atau OLT"
              value={filter.query}
              onChange={(e) => set("query", e.target.value)}
            />
          </div>
          <select
            className={selectClassName}
            aria-label="Filter OLT"
            value={filter.oltId}
            onChange={(e) => set("oltId", e.target.value)}
          >
            <option value="all">Semua OLT</option>
            {olts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={selectClassName}
            aria-label="Filter status port"
            value={filter.status}
            onChange={(e) => set("status", e.target.value as PonPortFilter["status"])}
          >
            <option value="all">Semua status port</option>
            <option value="up">UP</option>
            <option value="down">DOWN</option>
          </select>
          <select
            className={selectClassName}
            aria-label="Filter status optik"
            value={filter.opticalStatus}
            onChange={(e) => set("opticalStatus", e.target.value as PonPortFilter["opticalStatus"])}
          >
            <option value="all">Semua status optik</option>
            <option value="normal">Normal</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Port PON</TableHead>
              <TableHead>OLT Induk</TableHead>
              <TableHead>Status Port</TableHead>
              <TableHead>Kapasitas &amp; ONU</TableHead>
              <TableHead>Status ONU</TableHead>
              <TableHead>Daya Optik Port</TableHead>
              <TableHead>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  Tidak ada port PON yang cocok dengan saringan.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.portId} data-testid="pon-port-row" data-port-id={p.portId}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Indeks {p.ponIndex}</div>
                  </TableCell>
                  <TableCell>{p.oltName}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        p.status === "up"
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-destructive/30 bg-destructive/10 text-destructive"
                      }
                    >
                      {p.status === "up" ? "UP" : "DOWN"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div
                      className="h-2 w-28 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={`Kapasitas ${p.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, p.capacityPercent)}
                    >
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.min(100, p.capacityPercent)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {p.capacityPercent.toFixed(1)}% · {formatInteger(p.totalOnu)} ONU terdaftar
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 text-xs">
                      <span className="text-success">{formatInteger(p.onlineOnu)} online</span>
                      <span className="text-destructive">{formatInteger(p.losOnuCount)} LOS</span>
                      <span className="text-warning">{formatInteger(p.weakOnuCount)} lemah</span>
                    </div>
                    <Badge variant="outline" className={`mt-1 ${OPTICAL_CLASS[p.opticalStatus]}`}>
                      Optik {OPTICAL_LABEL[p.opticalStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>TX {dbm(p.txPowerDbm)}</div>
                    <div>RX {dbm(p.rxPowerDbm)}</div>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/app/cpe/pon/${p.portId}`}
                      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Buka Rincian Port
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
