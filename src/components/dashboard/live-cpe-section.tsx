"use client";

import { useMemo } from "react";
import { Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInteger } from "@/lib/dashboard/format";
import { formatLastSeen } from "@/lib/dashboard/onu-status";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useLiveCpe } from "@/lib/dashboard/use-live-cpe";

// Daftar modem pelanggan dari GenieACS (TR-069). Seluruhnya data nyata: GenieACS
// kosong tampil sebagai kosong dengan langkah yang harus dilakukan, bukan modem
// tiruan. Pelanggan dicocokkan lewat username PPPoE yang dilaporkan modem.
export function LiveCpeSection() {
  const cpe = useLiveCpe(true);
  const customers = useDashboardStore((s) => s.customers);
  const byPppoe = useMemo(
    () => new Map(customers.map((c) => [c.pppoeUsername.trim().toLowerCase(), c])),
    [customers],
  );
  const devices = useMemo(() => cpe.devices ?? [], [cpe.devices]);
  const stats = useMemo(() => {
    const online = devices.filter((d) => d.isOnline).length;
    const mapped = devices.filter((d) => byPppoe.has(d.pppoeUsername.trim().toLowerCase())).length;
    return { total: devices.length, online, offline: devices.length - online, unmapped: devices.length - mapped };
  }, [devices, byPppoe]);

  return (
    <Card data-testid="live-cpe-section">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wifi className="size-5" aria-hidden="true" />
          Modem Pelanggan (GenieACS / TR-069)
        </CardTitle>
        <CardDescription>
          {cpe.loaded
            ? `${formatInteger(stats.total)} modem terdaftar, ${formatInteger(stats.online)} online, ${formatInteger(stats.unmapped)} belum cocok ke pelanggan.`
            : "Memuat modem dari GenieACS…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cpe.error && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {cpe.error}
          </p>
        )}
        {cpe.truncated && (
          <p role="status" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
            Hanya {formatInteger(devices.length)} dari {formatInteger(cpe.total)} modem yang dimuat.
          </p>
        )}
        <div className="rounded-md border">
          <Table data-testid="live-cpe-table">
            <TableHeader>
              <TableRow>
                <TableHead>Pelanggan / PPPoE</TableHead>
                <TableHead>Modem</TableHead>
                <TableHead>Serial</TableHead>
                <TableHead>Wi-Fi</TableHead>
                <TableHead>IP WAN</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Inform Terakhir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-muted-foreground" data-testid="live-cpe-empty">
                    {!cpe.loaded
                      ? cpe.error
                        ? "Tidak ada data."
                        : "Memuat…"
                      : "Belum ada modem yang melapor ke GenieACS. Arahkan modem ke ACS lewat profil TR-069 di OLT (URL ACS port 7547), atau isi ACS URL di modem; modem muncul di sini setelah melapor (Inform) pertama."}
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((d) => {
                  const c = byPppoe.get(d.pppoeUsername.trim().toLowerCase());
                  return (
                    <TableRow key={d.deviceId}>
                      <TableCell>
                        <div className="font-medium text-foreground">{c ? c.name : d.pppoeUsername || "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {c ? c.pppoeUsername : d.pppoeUsername ? "belum cocok ke pelanggan" : "tanpa PPPoE"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {[d.manufacturer, d.model].filter(Boolean).join(" ") || "—"}
                        <div className="text-xs text-muted-foreground">{d.softwareVersion || ""}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.serialNumber || "—"}</TableCell>
                      <TableCell className="text-sm">
                        {d.wifi.ssid || "—"}
                        {d.wifi.ssid && (
                          <div className="text-xs text-muted-foreground">
                            {d.wifi.radioFrequency} · {formatInteger(d.wifi.clientCount)} klien
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.wanIp || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            d.isOnline
                              ? "border-success/40 bg-success/10 text-success"
                              : "border-destructive/40 bg-destructive/10 text-destructive"
                          }
                        >
                          {d.isOnline ? "Online" : "Offline"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.lastInformAt > 0 ? formatLastSeen(d.lastInformAt) : "belum pernah"}
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
