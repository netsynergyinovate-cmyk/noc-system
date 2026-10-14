"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Download, Eye, RotateCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { selectClassName } from "./select-class";
import {
  filterWhatsappLogs,
  getWhatsappLogFacetCounts,
  loadWhatsappLogs,
  summarizeWhatsappLogs,
  whatsappLogsToCsv,
  type WaDeliveryStatus,
  type WhatsappLogFilter,
  type WhatsappNotificationLog,
} from "@/lib/dashboard/whatsapp-log";

const statusLabel: Record<WaDeliveryStatus, string> = {
  delivered: "Diterima",
  sent: "Terkirim",
  failed: "Gagal",
};

const statusClass: Record<WaDeliveryStatus, string> = {
  delivered: "border-transparent bg-success/10 text-success",
  sent: "border-transparent bg-warning/10 text-warning",
  failed: "border-transparent bg-destructive/10 text-destructive",
};

const wibFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function formatWib(sec: number) {
  return `${wibFormat.format(new Date(sec * 1000))} WIB`;
}

const noopSubscribe = () => () => {};
let clientNow: number | null = null;
const getNow = () => (clientNow ??= Math.floor(Date.now() / 1000));

const initialFilter: WhatsappLogFilter = {
  status: "all",
  severity: "all",
  query: "",
  timeRange: "all",
};

export function WhatsappLogBoard() {
  // Waktu hanya ada di klien supaya HTML server dan render pertama sama.
  const now = useSyncExternalStore(noopSubscribe, getNow, () => null);
  const base = useMemo(() => (now === null ? [] : loadWhatsappLogs(now)), [now]);
  // Kirim ulang tiruan: id -> status baru.
  const [resent, setResent] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState(initialFilter);
  const [open, setOpen] = useState<WhatsappNotificationLog | null>(null);

  const logs = useMemo(
    () =>
      base.map((l) =>
        resent[l.id] !== undefined
          ? { ...l, status: "sent" as const, latencyMs: resent[l.id], errorReason: undefined }
          : l,
      ),
    [base, resent],
  );
  const summary = useMemo(() => summarizeWhatsappLogs(logs), [logs]);
  const rows = useMemo(() => filterWhatsappLogs(logs, filter, now ?? 0), [logs, filter, now]);
  const facets = useMemo(
    () => getWhatsappLogFacetCounts(logs, filter, now ?? 0),
    [logs, filter, now],
  );
  const active =
    filter.status !== "all" ||
    filter.severity !== "all" ||
    filter.timeRange !== "all" ||
    filter.query.trim() !== "";

  function exportCsv() {
    const blob = new Blob([whatsappLogsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "log-whatsapp.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (now === null) {
    return <p role="status" className="text-sm text-muted-foreground">Memuat riwayat…</p>;
  }

  const kpis = [
    { label: "Total Terkirim", value: String(summary.total - summary.failed) },
    { label: "Rasio Sukses", value: `${summary.successRate}%` },
    { label: "Pesan Gagal", value: String(summary.failed) },
    {
      label: "Rata-rata Latensi",
      value: summary.avgLatencyMs === null ? "-" : `${summary.avgLatencyMs} ms`,
    },
  ];

  return (
    <div className="space-y-4">
      <Badge
        variant="outline"
        data-testid="wa-log-mock-badge"
        className="border-warning/40 bg-warning/10 text-warning"
      >
        {"Log Tiruan (Fase 2) \u00b7 Wajib beralih ke DB nyata di Fase 5"}
      </Badge>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="wa-log-kpi">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3" role="search">
        <div className="w-40 space-y-1.5">
          <Label htmlFor="waLogStatus">Status</Label>
          <select
            id="waLogStatus"
            className={selectClassName}
            value={filter.status}
            onChange={(e) =>
              setFilter((f) => ({ ...f, status: e.target.value as WhatsappLogFilter["status"] }))
            }
          >
            <option value="all">Semua ({facets.status.all})</option>
            <option value="delivered">Diterima ({facets.status.delivered})</option>
            <option value="sent">Terkirim ({facets.status.sent})</option>
            <option value="failed">Gagal ({facets.status.failed})</option>
          </select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="waLogSeverity">Keparahan</Label>
          <select
            id="waLogSeverity"
            className={selectClassName}
            value={filter.severity}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                severity: e.target.value as WhatsappLogFilter["severity"],
              }))
            }
          >
            <option value="all">Semua ({facets.severity.all})</option>
            <option value="critical">Kritis ({facets.severity.critical})</option>
            <option value="warning">Peringatan ({facets.severity.warning})</option>
          </select>
        </div>
        <div className="w-48 space-y-1.5">
          <Label htmlFor="waLogTime">Waktu</Label>
          <select
            id="waLogTime"
            className={selectClassName}
            value={filter.timeRange}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                timeRange: e.target.value as WhatsappLogFilter["timeRange"],
              }))
            }
          >
            <option value="all">Semua Waktu ({facets.timeRange.all})</option>
            <option value="1h">1 Jam Terakhir ({facets.timeRange["1h"]})</option>
            <option value="24h">24 Jam Terakhir ({facets.timeRange["24h"]})</option>
            <option value="7d">7 Hari Terakhir ({facets.timeRange["7d"]})</option>
          </select>
        </div>
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="waLogQuery">Cari</Label>
          <Input
            id="waLogQuery"
            type="search"
            placeholder="Nama penerima, nomor, atau isi pesan"
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-disabled={rows.length === 0}
          onClick={() => rows.length > 0 && exportCsv()}
        >
          <Download className="size-4" />
          Ekspor CSV Log
        </Button>
        {active && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setFilter(initialFilter)}
          >
            <RotateCcw className="size-4" />
            Reset Filter
          </Button>
        )}
      </div>

      <p role="status" className="text-xs text-muted-foreground">
        {rows.length} dari {logs.length} pesan
      </p>

      {rows.length === 0 ? (
        <div
          data-testid="wa-log-empty"
          className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
        >
          Tidak ada pesan yang cocok dengan filter.
        </div>
      ) : (
        <div
          role="region"
          aria-label="Riwayat notifikasi WhatsApp"
          tabIndex={0}
          className="overflow-x-auto rounded-lg border"
        >
          <Table data-testid="wa-log-table">
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Penerima</TableHead>
                <TableHead>Keparahan</TableHead>
                <TableHead>Ringkasan Pesan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Latensi</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id} data-testid="wa-log-row">
                  <TableCell className="whitespace-nowrap text-xs">{formatWib(l.sentAt)}</TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{l.recipientName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{l.recipientPhone}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={l.severity === "critical" ? "destructive" : "secondary"}>
                      {l.severity === "critical" ? "Kritis" : "Peringatan"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm" title={l.kind}>
                    {l.kind}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusClass[l.status]} data-status={l.status}>
                      {statusLabel[l.status]}
                    </Badge>
                    {l.errorReason && (
                      <div className="mt-1 text-xs text-destructive">{l.errorReason}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.latencyMs === null ? "-" : `${l.latencyMs} ms`}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setOpen(l)}
                      >
                        <Eye className="size-4" />
                        Lihat Pesan
                      </Button>
                      {l.status === "failed" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() =>
                            setResent((r) => ({ ...r, [l.id]: 300 + (l.id.length % 5) * 100 }))
                          }
                        >
                          <Send className="size-4" />
                          Kirim Ulang
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pesan WhatsApp</DialogTitle>
            <DialogDescription>
              {open && `${open.recipientName} (${open.recipientPhone}) · ${formatWib(open.sentAt)}`}
            </DialogDescription>
          </DialogHeader>
          <pre
            data-testid="wa-log-message"
            className="whitespace-pre-wrap rounded-lg border bg-secondary/30 p-3 font-sans text-sm"
          >
            {open?.message}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
