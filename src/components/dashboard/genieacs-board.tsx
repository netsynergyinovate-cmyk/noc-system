"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CpeDevice } from "@/lib/dashboard/cpe";
import { fetchLiveCpe } from "@/lib/dashboard/cpe-live";
import { formatAgo } from "@/lib/dashboard/customer-live";
import { formatDbm } from "@/lib/dashboard/format";
import { useDashboardStore } from "@/lib/dashboard/store";
import { GenieacsDeviceDialog } from "@/components/dashboard/genieacs-device-dialog";
import {
  GenieacsConfigPanel,
  type GenieacsConfigView,
  type NbiStatusView,
} from "@/components/dashboard/genieacs-config-panel";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function rxTone(dbm: number): string {
  return dbm >= -24
    ? "text-success"
    : dbm >= -27
      ? "text-warning"
      : "text-destructive";
}

export function GenieacsBoard() {
  const [nbi, setNbi] = useState<NbiStatusView | null>(null);
  const [config, setConfig] = useState<GenieacsConfigView | null>(null);
  const [configError, setConfigError] = useState(false);
  const [devices, setDevices] = useState<CpeDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // Pencocokan ke pelanggan di sini: service GenieACS hanya tahu username PPPoE.
  const customers = useDashboardStore((s) => s.customers);
  const byPppoe = useMemo(
    () =>
      new Map(customers.map((c) => [c.pppoeUsername.trim().toLowerCase(), c])),
    [customers],
  );
  const checkNbi = useCallback(async () => {
    try {
      const res = await fetch("/api/cpe/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data: {
        ok?: boolean;
        latencyMs?: number;
        deviceCount?: number;
        message?: string;
        error?: string;
      } | null = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setNbi({
          ok: true,
          latencyMs: data.latencyMs,
          deviceCount: data.deviceCount,
        });
        return;
      }
      // Uji koneksi hanya untuk admin (403); akun lain cukup bukti bahwa daftar modem terbaca.
      if (res.status === 403) {
        const probe = await fetch("/api/cpe?limit=1");
        setNbi(
          probe.ok
            ? { ok: true }
            : { ok: false, message: "GenieACS NBI tidak merespons" },
        );
        return;
      }
      setNbi({
        ok: false,
        message:
          data?.message ?? data?.error ?? "Gagal terhubung ke NBI GenieACS",
      });
    } catch {
      setNbi({
        ok: false,
        message: "Tidak dapat menghubungi API lokal aplikasi",
      });
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const cfg = fetch("/api/cpe/config", { cache: "no-store" })
      .then(async (r) => {
        const body: { data?: GenieacsConfigView } | null = await r
          .json()
          .catch(() => null);
        if (r.ok && body?.data) {
          setConfig(body.data);
          setConfigError(false);
        } else setConfigError(true);
      })
      .catch(() => setConfigError(true));
    const list = fetchLiveCpe().then(
      (r) => setDevices(r.devices),
      () => setDevices([]),
    );
    await Promise.all([checkNbi(), cfg, list]);
    setNow(Date.now());
    setLoading(false);
  }, [checkNbi]);

  useEffect(() => {
    // Ditunda satu tick supaya setState tidak dipanggil serempak di dalam efek.
    const t = setTimeout(() => void loadAll(), 0);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
  }, [loadAll]);

  const nowSec = Math.floor(now / 1000);
  const reporting = devices.filter((d) => d.isOnline).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) =>
        d.serialNumber.toLowerCase().includes(q) ||
        d.pppoeUsername.toLowerCase().includes(q) ||
        (byPppoe.get(d.pppoeUsername.trim().toLowerCase())?.name ?? "")
          .toLowerCase()
          .includes(q) ||
        d.model.toLowerCase().includes(q) ||
        d.macAddress.toLowerCase().includes(q) ||
        d.wanIp.toLowerCase().includes(q) ||
        d.wifi.ssid.toLowerCase().includes(q),
    );
  }, [devices, query, byPppoe]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">GenieACS</h1>
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            data-testid="genieacs-summary"
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                nbi === null
                  ? "bg-muted-foreground"
                  : nbi.ok
                    ? "bg-success"
                    : "bg-destructive",
              )}
            />
            {nbi === null
              ? "Memeriksa NBI…"
              : nbi.ok
                ? `NBI terhubung${nbi.latencyMs ? ` · ${nbi.latencyMs} ms` : ""} · ${devices.length} modem · ${reporting} melapor`
                : `NBI tidak terhubung: ${nbi.message ?? ""}`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Segarkan"
          title="Segarkan"
          onClick={() => void loadAll()}
          disabled={loading}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
      </div>

      <Tabs defaultValue="devices" className="w-full">
        <TabsList>
          <TabsTrigger value="devices">Perangkat</TabsTrigger>
          <TabsTrigger value="config">Konfigurasi</TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Modem terdaftar</CardTitle>
                  <CardDescription>
                    Status “Melapor” = modem mengirim inform TR-069 dalam 15
                    menit terakhir. Itu bukan status internet.
                  </CardDescription>
                </div>
                <div className="relative w-64">
                  <Search
                    aria-hidden="true"
                    className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                  />
                  <Input
                    placeholder="Cari serial, nama, IP…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading && devices.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Mengambil daftar modem dari GenieACS…
                </p>
              ) : rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {devices.length === 0
                    ? "Belum ada modem yang terdaftar di GenieACS."
                    : "Tidak ada modem yang cocok."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pelanggan</TableHead>
                        <TableHead>Modem</TableHead>
                        <TableHead>IP WAN</TableHead>
                        <TableHead>Redaman</TableHead>
                        <TableHead>Wi-Fi</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((d) => {
                        const customer = byPppoe.get(
                          d.pppoeUsername.trim().toLowerCase(),
                        );
                        const rx = d.isOnline ? d.optical.rxDbm : null;
                        const ageText =
                          d.lastInformAt > 0
                            ? formatAgo(nowSec - d.lastInformAt)
                            : "belum pernah";
                        return (
                          <TableRow key={d.deviceId}>
                            <TableCell>
                              <div className="text-sm font-medium">
                                {customer?.name ?? "Belum terpetakan"}
                              </div>
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {d.pppoeUsername || "—"}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              {[d.manufacturer, d.model]
                                .filter(Boolean)
                                .join(" ") || "—"}
                              <div className="font-mono text-[11px] text-muted-foreground">
                                {d.serialNumber}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {d.wanIp && IPV4.test(d.wanIp) ? (
                                <span className="inline-flex items-center gap-1.5">
                                  {d.wanIp}
                                  <a
                                    href={`http://${d.wanIp}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Buka ${d.wanIp} di tab baru`}
                                    title="Buka di tab baru"
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <ExternalLink
                                      className="size-3.5"
                                      aria-hidden="true"
                                    />
                                  </a>
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {rx != null ? (
                                <span className={rxTone(rx)}>
                                  {formatDbm(rx)}
                                  <div className="text-[10px] font-sans text-muted-foreground">
                                    GenieACS
                                  </div>
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {d.wifi.ssid || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  d.isOnline
                                    ? "border-success/40 text-success"
                                    : "border-warning/40 text-warning",
                                )}
                              >
                                {d.isOnline ? "Melapor" : "Tidak melapor"}
                              </Badge>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                inform {ageText}
                              </div>
                              {customer && (
                                <div
                                  className={cn(
                                    "text-[11px]",
                                    customer.isOnline
                                      ? "text-success"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  Internet{" "}
                                  {customer.isOnline ? "online" : "offline"}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <GenieacsDeviceDialog
                                deviceId={d.deviceId}
                                label={d.pppoeUsername || d.serialNumber}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <GenieacsConfigPanel
            config={config}
            configError={configError}
            nbi={nbi}
            devices={devices}
            nowSec={nowSec}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
