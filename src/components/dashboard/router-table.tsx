"use client";

import { useMemo, useReducer, useState } from "react";
import {
  initialRefresh,
  mockRefresh,
  refreshReducer,
} from "@/lib/dashboard/refresh-state";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { RouterResourceCards } from "./router-resource-cards";
import { RouterHardwareCards } from "./router-hardware-cards";
import { RouterQueueTable } from "./router-queue-table";
import { RouterTrafficCard } from "./router-traffic-card";
import { RouterStatusBadge } from "./router-status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Cpu,
  Radio,
  AlertCircle,
  Terminal,
  Layers,
  RefreshCw,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  buildRouterDetails,
  filterRouterDetails,
  isCpuWarning,
  type MockRouterDetail,
  type RouterStatusFilter,
} from "@/lib/dashboard/routers";

export function RouterTable() {
  const routers = useDashboardStore((state) => state.routers);
  const customers = useDashboardStore((state) => state.customers);

  const [selectedRouter, setSelectedRouter] = useState<MockRouterDetail | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RouterStatusFilter>("all");
  const [pingRunning, setPingRunning] = useState(false);
  const [pingLog, setPingLog] = useState<string[]>([]);
  const [refresh, dispatch] = useReducer(refreshReducer, initialRefresh);
  const isRefreshing = refresh.status === "loading";
  const refreshError = refresh.status === "error" ? refresh.message : null;

  async function handleRefresh() {
    if (isRefreshing) return;
    dispatch({ type: "start" });
    try {
      await mockRefresh(navigator.onLine);
      dispatch({ type: "success" });
    } catch (e) {
      dispatch({ type: "fail", message: e instanceof Error ? e.message : "Gagal menyegarkan data router." });
    }
  }

  // Hitung jumlah pelanggan PPPoE per router
  const sessionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of customers) {
      counts[c.routerId] = (counts[c.routerId] || 0) + 1;
    }
    return counts;
  }, [customers]);

  const details = useMemo(
    () => buildRouterDetails(routers, sessionCounts),
    [routers, sessionCounts],
  );
  const visible = useMemo(
    () => filterRouterDetails(details, query, statusFilter),
    [details, query, statusFilter],
  );

  function handleOpenDetail(router: MockRouterDetail) {
    setSelectedRouter(router);
    setPingLog([
      `PING ${router.host} (${router.host}) 56(84) bytes of data.`,
      `64 bytes from ${router.host}: icmp_seq=1 ttl=64 time=1.42 ms`,
      `64 bytes from ${router.host}: icmp_seq=2 ttl=64 time=1.18 ms`,
      `64 bytes from ${router.host}: icmp_seq=3 ttl=64 time=1.35 ms`,
      `--- ${router.host} ping statistics: 0% packet loss, rtt min/avg/max = 1.18/1.31/1.42 ms ---`,
    ]);
  }

  function handleRunPing() {
    if (!selectedRouter) return;
    setPingRunning(true);
    setTimeout(() => {
      setPingRunning(false);
      setPingLog((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] PING check: ${selectedRouter.host} responded in 1.25 ms (REST API OK)`,
      ]);
    }, 1200);
  }

  return (
    <>
      <RouterResourceCards routers={details} />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama, host, atau model…"
          aria-label="Cari router"
          className="h-9 max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RouterStatusFilter)}
          aria-label="Filter status router"
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Semua</option>
          <option value="active">Aktif</option>
          <option value="disconnected">Terputus</option>
        </select>
        <span className="text-xs text-muted-foreground" role="status">
          {visible.length} dari {details.length} router
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          aria-disabled={isRefreshing}
          className="ml-auto h-9 gap-1.5 text-xs"
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          {isRefreshing ? "Menyegarkan..." : "Segarkan"}
        </Button>
      </div>

      {refreshError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{refreshError}</span>
          <Button type="button" variant="outline" size="sm" onClick={handleRefresh} className="h-8 text-xs">
            Coba lagi
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px] px-2 text-center">
                  <Server className="inline-block size-4 text-muted-foreground" aria-hidden="true" />
                </TableHead>
                <TableHead>Nama Router &amp; Host</TableHead>
                <TableHead>Peran &amp; Model</TableHead>
                <TableHead>Versi RouterOS</TableHead>
                <TableHead>CPU / RAM</TableHead>
                <TableHead>Sesi PPPoE</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>Status REST</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isRefreshing ? (
                [0, 1, 2].map((i) => (
                  <TableRow key={`skeleton-${i}`} aria-hidden="true">
                    <TableCell colSpan={9}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-28 text-center text-muted-foreground">
                    {routers.length === 0
                      ? "Belum ada router yang ditambahkan."
                      : "Tidak ada router yang cocok dengan pencarian."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((router) => {
                  const pppoeCount = router.pppoeCount;

                  return (
                    <TableRow key={router.id}>
                      <TableCell className="px-2 text-center">
                        <div
                          className={`mx-auto size-2 rounded-full ${
                            router.active ? "bg-success" : "bg-destructive"
                          }`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-foreground">{router.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{router.host}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{router.role}</div>
                        <div className="text-xs text-muted-foreground">{router.boardModel}</div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {router.rosVersion}
                        </span>
                      </TableCell>
                      <TableCell>
                        {router.active ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`font-mono text-xs font-semibold ${
                                isCpuWarning(router) ? "text-warning" : "text-foreground"
                              }`}
                            >
                              CPU {router.cpuLoad}%
                            </span>
                            {isCpuWarning(router) && (
                              <Badge
                                variant="outline"
                                className="border-warning/50 bg-warning/10 text-warning"
                              >
                                <AlertCircle className="mr-1 size-3" aria-hidden="true" />
                                Beban tinggi
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              · RAM {router.memoryUsage}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs font-medium tabular-nums">
                          {pppoeCount} sesi
                        </span>
                      </TableCell>
                      <TableCell>
                        {router.active ? (
                          <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                            <Layers className="mr-1 size-3" aria-hidden="true" />
                            {router.queueCount} queue
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RouterStatusBadge active={router.active} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenDetail(router)}
                          className="h-8 text-xs font-medium"
                        >
                          Rincian
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Dialog Rincian Router MikroTik */}
      {selectedRouter && (
        <Dialog open={!!selectedRouter} onOpenChange={(open) => !open && setSelectedRouter(null)}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <div className="flex items-center justify-between gap-3 pr-6">
                <div>
                  <DialogTitle className="flex items-center gap-2 text-lg">
                    {selectedRouter.name}
                    <RouterStatusBadge active={selectedRouter.active} />
                  </DialogTitle>
                  <DialogDescription className="font-mono text-xs mt-1">
                    {selectedRouter.host} · {selectedRouter.boardModel} · {selectedRouter.rosVersion}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <Tabs defaultValue="hardware" className="mt-2">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="hardware" className="gap-1.5 text-xs">
                  <Cpu className="size-3.5" />
                  Hardware &amp; Sistem
                </TabsTrigger>
                <TabsTrigger value="traffic" className="gap-1.5 text-xs">
                  <Activity className="size-3.5" />
                  Trafik Live
                </TabsTrigger>
                <TabsTrigger value="queues" className="gap-1.5 text-xs">
                  <Layers className="size-3.5" />
                  Simple Queue
                </TabsTrigger>
                <TabsTrigger value="pppoe" className="gap-1.5 text-xs">
                  <Radio className="size-3.5" />
                  Sesi PPPoE
                </TabsTrigger>
                <TabsTrigger value="ping" className="gap-1.5 text-xs">
                  <Terminal className="size-3.5" />
                  Tool Ping ICMP
                </TabsTrigger>
              </TabsList>

              <TabsContent value="hardware" className="space-y-4 pt-3">
                <RouterHardwareCards
                  cpuLoad={selectedRouter.cpuLoad}
                  memoryUsage={selectedRouter.memoryUsage}
                  uptime={selectedRouter.uptime}
                  temperature={selectedRouter.temperature}
                  boardModel={selectedRouter.boardModel}
                  rosVersion={selectedRouter.rosVersion}
                  active={selectedRouter.active}
                />
                <div className="grid grid-cols-1 gap-3 text-xs">
                  <div className="rounded-lg border p-3">
                    <span className="text-muted-foreground block mb-1">Simple Queue</span>
                    <strong className="text-lg font-mono font-semibold">
                      {selectedRouter.active ? selectedRouter.queueCount : "—"}
                    </strong>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Jumlah queue aktif di router ini
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="traffic" className="pt-3">
                <RouterTrafficCard
                  key={selectedRouter.id}
                  routerId={selectedRouter.id}
                  routerName={selectedRouter.name}
                  active={selectedRouter.active}
                />
              </TabsContent>

              <TabsContent value="queues" className="pt-3">
                <RouterQueueTable routerId={selectedRouter.id} routerName={selectedRouter.name} />
              </TabsContent>

              <TabsContent value="pppoe" className="space-y-3 pt-3">
                <div className="rounded-md border p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold">Sesi PPPoE yang Dilayani</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {selectedRouter.pppoeCount} aktif
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Daftar klien PPPoE yang terkoneksi melalui interface router ini.
                  </p>
                  <div className="max-h-48 overflow-y-auto divide-y text-xs">
                    {customers
                      .filter((c) => c.routerId === selectedRouter.id)
                      .slice(0, 8)
                      .map((c) => (
                        <div key={c.id} className="flex items-center justify-between py-2">
                          <div>
                            <span className="font-medium text-foreground">{c.name}</span>
                            <span className="text-muted-foreground ml-2 font-mono text-[11px]">
                              {c.pppoeUsername}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              c.isOnline
                                ? "border-success/40 bg-success/10 text-success text-[10px]"
                                : "text-[10px] text-muted-foreground"
                            }
                          >
                            {c.isOnline ? "Online" : "Offline"}
                          </Badge>
                        </div>
                      ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="ping" className="space-y-3 pt-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    Verifikasi latensi ICMP ke host {selectedRouter.host}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRunPing}
                    disabled={pingRunning}
                    className="h-7 text-xs"
                  >
                    {pingRunning ? "Memeriksa…" : "Jalankan Ping"}
                  </Button>
                </div>
                <div className="rounded-md bg-zinc-950 p-3 font-mono text-xs text-zinc-200">
                  {pingLog.map((line, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {line}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
