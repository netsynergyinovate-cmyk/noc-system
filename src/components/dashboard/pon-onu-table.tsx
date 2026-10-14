"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInteger } from "@/lib/dashboard/format";
import { OnuStatusBadge } from "./onu-status-badge";
import { OpticalLoss, OpticalRx, OpticalTx } from "./optical-rx";
import type { PonOnuDetail } from "@/lib/dashboard/pon-ports";
import { selectClassName } from "./select-class";
import { classifyOnuTrouble, summarizeOnuTroubles } from "@/lib/dashboard/onu-trouble-classifier";
import { cn } from "@/lib/utils";

// Zona waktu tetap supaya HTML server dan browser sama.
const timeFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
});

type StatusFilter = "all" | "online" | "offline" | "los" | "weak";

export function PonOnuTable({ onus }: { onus: readonly PonOnuDetail[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [onlyTroubled, setOnlyTroubled] = useState(false);
  const troubleSummary = useMemo(() => summarizeOnuTroubles(onus), [onus]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return onus.filter((o) => {
      if (onlyTroubled && !classifyOnuTrouble(o).isTroubled) return false;
      if (status === "online" && o.status !== "online") return false;
      if (status === "offline" && o.status !== "offline") return false;
      if (status === "los" && o.status !== "los") return false;
      if (status === "weak" && !o.isWeak) return false;
      if (q && !o.customerName?.toLowerCase().includes(q) && !o.pppoeUsername?.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [onus, query, status, onlyTroubled]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Daftar ONU di Port Ini</CardTitle>
            <CardDescription>Redaman RX di bawah -27 dBm ditandai bahaya.</CardDescription>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            Menampilkan {formatInteger(rows.length)} dari {formatInteger(onus.length)} ONU
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Cari pelanggan atau PPPoE"
              placeholder="Cari pelanggan atau PPPoE…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className={selectClassName}
            aria-label="Filter status ONU"
          >
            <option value="all">Semua Status</option>
            <option value="online">Online (Aktif)</option>
            <option value="offline">Mati / Power Off</option>
            <option value="los">Kabel Putus / LOS</option>
            <option value="weak">Sinyal Lemah (RX &lt; -27 dBm)</option>
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="onu-only-troubled"
              checked={onlyTroubled}
              onChange={(e) => setOnlyTroubled(e.target.checked)}
              className="size-4 accent-primary"
            />
            Tampilkan Hanya ONU Bermasalah
            <span className="text-xs tabular-nums text-muted-foreground">
              ({formatInteger(troubleSummary.troubled)})
            </span>
          </label>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ONU</TableHead>
                <TableHead>Pelanggan</TableHead>
                <TableHead>PPPoE</TableHead>
                <TableHead>Serial Number</TableHead>
                <TableHead>Model ONT</TableHead>
                <TableHead>Jarak</TableHead>
                <TableHead>RX Power</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Terakhir Terlihat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    {onus.length === 0 ? (
                      "Belum ada perangkat ONU yang terhubung pada port PON ini."
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <span>Tidak ada ONU yang sesuai dengan filter atau kata kunci.</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setQuery("");
                            setStatus("all");
                            setOnlyTroubled(false);
                          }}
                        >
                          Reset Filter
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((o) => {
                  const trouble = classifyOnuTrouble(o);
                  return (
                  <TableRow
                    key={o.onuIndex}
                    data-troubled-row={trouble.isTroubled ? "true" : "false"}
                    className={cn(trouble.rowClassName)}
                  >
                    <TableCell className="font-mono text-xs">{o.onuIndex}</TableCell>
                    <TableCell>
                      {o.customerName ? (
                        <>
                          <div className="font-medium text-foreground">{o.customerName}</div>
                          <div className="max-w-[200px] truncate text-xs text-muted-foreground">{o.address ?? ""}</div>
                        </>
                      ) : (
                        <Badge variant="outline">Belum dipetakan</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.pppoeUsername ?? "�"}</TableCell>
                    <TableCell className="font-mono text-xs" title={o.macAddress ?? undefined}>
                      {o.serialNumber || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{o.ontModel ?? "�"}</TableCell>
                    <TableCell className="text-sm tabular-nums">{o.distanceMeters != null ? `${o.distanceMeters.toLocaleString("id-ID")} m` : "�"}</TableCell>
                    <TableCell>
                      <OpticalRx dbm={o.rxPowerDbm} />
                      <div className="mt-1 flex gap-3 text-muted-foreground">
                        <span>TX <OpticalTx dbm={o.txPowerDbm} /></span>
                        <span>Loss <OpticalLoss txDbm={o.txPowerDbm} rxDbm={o.rxPowerDbm} /></span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <OnuStatusBadge status={o.status} />
                      {trouble.isTroubled && (
                        <Badge
                          variant="outline"
                          data-testid="onu-trouble-badge"
                          data-trouble-severity={trouble.severity}
                          title={`${trouble.troubleDescription} Saran: ${trouble.recommendation}`}
                          className={cn(
                            "mt-1 block w-fit cursor-help",
                            trouble.severity === "critical"
                              ? "border-destructive text-destructive"
                              : "border-warning text-warning",
                          )}
                        >
                          {trouble.badgeLabel}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <time
                        dateTime={new Date(o.lastSeenAt * 1000).toISOString()}
                        title={o.status === "online" ? "Terakhir diukur" : "Terakhir terlihat online"}
                      >
                        {timeFormat.format(new Date(o.lastSeenAt * 1000))} WIB
                      </time>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
