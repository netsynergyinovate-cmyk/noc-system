"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Network,
  Radio,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiOltToDashboard, getOltStats, mockOlts, type ApiOlt, type DashboardOlt } from "@/lib/dashboard/olts";
import { ConnectionErrorNotice } from "./connection-error-notice";
import { GenieacsTestDialog } from "./genieacs-test-dialog";
import { CpeInventory } from "./cpe-inventory";
import { OnuCustomerMappingPanel } from "./onu-customer-mapping-panel";
import { OltWizardDialog } from "./olt-wizard-dialog";
import { LiveOntPanel } from "./live-ont-panel";
import { PonPortsDialog } from "./pon-ports-dialog";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { fetchLiveOlts } from "@/lib/dashboard/olt-live";
import { formatInteger } from "@/lib/dashboard/format";
import { selectClassName } from "./select-class";
import { CustomerCpeDialog } from "./customer-cpe-dialog";
import { CpeDiagnosticsPanel } from "./cpe-diagnostics-panel";
import { MetricCard } from "./metric-card";
import { OpticalRx } from "./optical-rx";
import { getOpticalSignalStatus } from "@/lib/dashboard/optical";
import { generateMockCpeDevices, summarizeCpeMetrics, type CpeDevice } from "@/lib/dashboard/cpe-mock";

// Zona waktu tetap supaya HTML server dan browser sama.
const oltTimeFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
});

export function CpeBoard() {
  const customers = useDashboardStore((state) => state.customers);
  const routers = useDashboardStore((state) => state.routers);

  const [tab, setTab] = useState("olt");
  const [diagCustomerId, setDiagCustomerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "offline" | "weak" | "out">("all");
  const [routerFilter, setRouterFilter] = useState<string>("all");
  const isDemoMode = useSession(selectPreviewEnabled);
  // Mode live: hanya OLT dari database; tidak pernah jatuh ke daftar tiruan.
  const [olts, setOlts] = useState<readonly DashboardOlt[]>(isDemoMode ? mockOlts : []);
  const [oltsFromApi, setOltsFromApi] = useState(!isDemoMode);
  const [oltsFailed, setOltsFailed] = useState(false);
  const [selectedOltForPon, setSelectedOltForPon] = useState<DashboardOlt | null>(null);

  // OLT nyata dari GET /api/devices; gagal atau kosong -> tetap data tiruan.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!isDemoMode) {
      let alive = true;
      const load = async () => {
        try {
          const next = await fetchLiveOlts();
          if (alive) {
            setOlts(next);
            setOltsFailed(false);
          }
        } catch {
          if (alive) setOltsFailed(true);
        }
      };
      const first = setTimeout(() => void load(), 0);
      const timer = setInterval(() => void load(), 30_000);
      return () => {
        alive = false;
        clearTimeout(first);
        clearInterval(timer);
      };
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/devices");
        if (!res.ok) return;
        const json = await res.json();
        const rows: ApiOlt[] = Array.isArray(json?.data?.olts) ? json.data.olts : [];
        if (cancelled || rows.length === 0) return;
        setOlts(rows.map(apiOltToDashboard));
        setOltsFromApi(true);
      } catch {
        // jaringan putus: pertahankan daftar yang sedang tampil
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, isDemoMode]);

  // Data CPE tiruan deterministik per pelanggan (nanti dari GenieACS NBI).
  const cpeDevices = useMemo(() => generateMockCpeDevices(customers), [customers]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const totals = useMemo(() => summarizeCpeMetrics(cpeDevices), [cpeDevices]);

  // Filter perangkat CPE
  const filteredDevices = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cpeDevices.filter((d: CpeDevice) => {
      if (statusFilter === "online" && !d.isOnline) return false;
      if (statusFilter === "offline" && d.isOnline) return false;
      if (statusFilter === "weak" && d.opticalPowerDbm >= -27) return false;
      if (statusFilter === "out" && !getOpticalSignalStatus(d.opticalPowerDbm).isOutOfThreshold) return false;
      if (routerFilter !== "all" && d.routerId !== routerFilter) return false;
      if (q) {
        const hay = [d.customerName, d.pppoeUsername, d.odpName, d.address, d.deviceId, d.model, d.serialNumber, d.wifi.ssid]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cpeDevices, statusFilter, routerFilter, query]);
  const hasFilter = query !== "" || statusFilter !== "all" || routerFilter !== "all";

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setRouterFilter("all");
  }

  const oltStats = getOltStats(olts);
  const oltTerputus = olts.find((o) => o.status === "nonaktif");

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="olt">Daftar OLT</TabsTrigger>
        <TabsTrigger value="ont">Modem ONT &amp; Redaman Fiber</TabsTrigger>
        <TabsTrigger value="onus">Perangkat CPE/ONT</TabsTrigger>
        <TabsTrigger value="mapping">Kelola Pemetaan ONU</TabsTrigger>
        <TabsTrigger value="diagnostics">Tugas Diagnostik &amp; Riwayat</TabsTrigger>
      </TabsList>

      <TabsContent value="diagnostics" className="flex flex-col gap-6">
        {isDemoMode ? (
          <CpeDiagnosticsPanel key={diagCustomerId ?? "none"} presetCustomerId={diagCustomerId} />
        ) : (
          <p
            data-testid="diagnostics-live-note"
            className="rounded-md border border-dashed p-6 text-sm text-muted-foreground"
          >
            Panel diagnostik massal (ping, traceroute) belum memakai data modem nyata, jadi tidak ditampilkan di mode
            live. Reboot dan ubah Wi-Fi modem satu pelanggan sudah nyata: buka ikon pengaturan (roda gigi) pada baris
            pelanggan di halaman Pelanggan.
          </p>
        )}
      </TabsContent>

      <TabsContent value="mapping" className="flex flex-col gap-6">
        <OnuCustomerMappingPanel />
      </TabsContent>

      <TabsContent value="onus" className="flex flex-col gap-6">
        <CpeInventory />
      </TabsContent>

      <TabsContent value="olt" className="flex flex-col gap-6">
        <section
          aria-label="Ringkasan OLT"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <MetricCard
            label="Total OLT"
            value={formatInteger(oltStats.total)}
            hint="Perangkat OLT terdaftar"
            Icon={Cpu}
          />
          <MetricCard
            label="OLT Aktif"
            value={formatInteger(oltStats.active)}
            hint={`${oltStats.total - oltStats.active} nonaktif`}
            Icon={CheckCircle2}
            tone="success"
          />
          <MetricCard
            label="Total Port PON"
            value={formatInteger(oltStats.totalPon)}
            hint="Seluruh OLT"
            Icon={Network}
          />
          <MetricCard
            label="Total ONU Terdaftar"
            value={formatInteger(oltStats.totalOnu)}
            hint="ONU aktif di semua OLT"
            Icon={Radio}
          />
        </section>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-lg">Daftar OLT</CardTitle>
              <CardDescription>
                {oltsFromApi
                  ? "Data dari database; jumlah port dan ONU dari hasil polling OLT oleh backend."
                  : "Data tiruan; belum ada OLT terdaftar."}
              </CardDescription>
            </div>
            <OltWizardDialog onSaved={() => setReloadKey((k) => k + 1)} />
          </CardHeader>
          <CardContent>
            {oltTerputus && (
              <ConnectionErrorNotice
                code="TIMEOUT"
                deviceType="olt"
                target={oltTerputus.host}
                message={`${oltTerputus.name} nonaktif atau terputus.`}
                className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3"
              />
            )}
            <div className="rounded-md border">
              <Table data-testid="olt-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama &amp; Brand</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Driver/Protokol</TableHead>
                    <TableHead>Port PON</TableHead>
                    <TableHead>ONU Aktif</TableHead>
                    <TableHead>Suhu</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Terakhir Terlihat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {olts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="h-28 text-center text-muted-foreground" data-testid="olt-empty">
                        {oltsFailed
                          ? "Daftar OLT belum bisa dimuat dari server."
                          : "Belum ada OLT terdaftar. Klik Tambah OLT untuk mendaftarkan OLT pertama."}
                      </TableCell>
                    </TableRow>
                  )}
                  {olts.map((olt, index) => (
                    <TableRow key={olt.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{olt.name}</div>
                        <Link
                          href={`/app/cpe/pon/${oltsFromApi ? `${olt.id}:1` : `olt-${index + 1}-pon-1`}`}
                          className="text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {oltsFromApi ? "Lihat detail PON 1" : "Lihat detail PON 1/1/1"}
                        </Link>
                        <div className="text-xs text-muted-foreground">{olt.brand}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{olt.host}</TableCell>
                      <TableCell className="font-mono text-xs">{olt.driver}</TableCell>
                      <TableCell className="tabular-nums">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="btn-view-pon-ports"
                          onClick={() => setSelectedOltForPon(olt)}
                        >
                          Lihat Port ({olt.totalPonPorts})
                        </Button>
                      </TableCell>
                      <TableCell className="tabular-nums">{formatInteger(olt.activeOnus)}</TableCell>
                      <TableCell className="tabular-nums">{olt.temperatureC}°C</TableCell>
                      <TableCell>
                        {olt.status === "aktif" && olt.lastSeenAt !== null ? (
                          <Badge
                            variant="outline"
                            className="border-success/40 bg-success/10 text-success"
                          >
                            <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-success" />
                            Terhubung
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 bg-destructive/10 text-destructive"
                          >
                            <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-destructive" />
                            Terputus
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {olt.lastSeenAt === null ? (
                          "Belum pernah"
                        ) : (
                          <time
                            dateTime={new Date(olt.lastSeenAt * 1000).toISOString()}
                            title="Terakhir berhasil dihubungi"
                          >
                            {oltTimeFormat.format(new Date(olt.lastSeenAt * 1000))} WIB
                          </time>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <PonPortsDialog
          olt={selectedOltForPon}
          open={selectedOltForPon !== null}
          onOpenChange={(o) => !o && setSelectedOltForPon(null)}
        />
      </TabsContent>

      <TabsContent value="ont" className="flex flex-col gap-6">
      {!isDemoMode ? (
        <LiveOntPanel />
      ) : (
      <>
      {/* 1. Ringkasan Metrik KPI */}
      <section
        aria-label="Ringkasan Perangkat CPE & OLT"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        <MetricCard
          label="Total ONT Terpasang"
          value={formatInteger(totals.total)}
          hint="Modem ONT aktif terdata"
          Icon={Radio}
        />
        <MetricCard
          label="ONT Online"
          value={formatInteger(totals.online)}
          hint={`${totals.total > 0 ? Math.round((totals.online / totals.total) * 100) : 0}% terhubung ke OLT`}
          Icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label="Sinyal Lemah / Kritis"
          value={formatInteger(totals.weakSignal)}
          hint="Redaman optik < -27.0 dBm"
          Icon={AlertTriangle}
          tone={totals.weakSignal > 0 ? "danger" : "neutral"}
        />
        <MetricCard
          label="ONT Offline"
          value={formatInteger(totals.offline)}
          hint="Tidak inform ke ACS"
          Icon={Activity}
          tone={totals.offline > 0 ? "danger" : "neutral"}
        />
        <MetricCard
          label="Klien Terhubung"
          value={formatInteger(totals.totalClients)}
          hint="Perangkat aktif di Wi-Fi/LAN pelanggan"
          Icon={Users}
        />      </section>

      {/* 2. Banner Informasi OLT Utama */}
      <Card className="border-border bg-card">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border bg-secondary/50 text-foreground">
              <Cpu className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">OLT-GPON-CORE-01</span>
                <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                  Online (GPON)
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                HSGQ-G008 · Host: 10.10.0.10 · 8 Port PON aktif · 128 ONU terdaftar
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div>
              Suhu: <strong className="text-foreground">41°C</strong>
            </div>
            <div>·</div>
            <div>
              Uptime: <strong className="text-foreground">42 hari 6 jam</strong>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Toolbar Pencarian & Filter */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Daftar Modem ONT &amp; Sinyal Pelanggan</CardTitle>
              <CardDescription>
                Pantau redaman sinyal optik fiber (RX Power) dan akses pengaturan WiFi CPE langsung.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                Menampilkan {formatInteger(filteredDevices.length)} dari {formatInteger(cpeDevices.length)} perangkat
              </span>
              <GenieacsTestDialog />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Cari pelanggan, PPPoE, ODP…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className={selectClassName}
              aria-label="Filter status ONT"
            >
              <option value="all">Semua Status</option>
              <option value="online">Online Saja</option>
              <option value="offline">Offline Saja</option>
              <option value="weak">Sinyal Lemah (&lt; -27 dBm)</option>
              <option value="out">Sinyal di Luar Ambang</option>
            </select>

            <select
              value={routerFilter}
              onChange={(e) => setRouterFilter(e.target.value)}
              className={selectClassName}
              aria-label="Filter router"
            >
              <option value="all">Semua Router</option>
              {routers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5">
                <RefreshCw className="size-3.5" />
                Reset
              </Button>
            )}
          </div>

          {/* 4. Tabel Monitoring ONT */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Device ID &amp; Model</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Inform Terakhir</TableHead>
                  <TableHead>SSID &amp; Klien</TableHead>
                  <TableHead>Redaman Optik (RX)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDevices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
                      Tidak ada perangkat ONT yang sesuai dengan filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDevices.map((cpe) => {
                    const customer = customerById.get(cpe.customerId);
                    return (
                      <TableRow key={cpe.id} data-testid="cpe-row">
                        <TableCell>
                          <div className="font-medium text-foreground">{cpe.customerName}</div>
                          <div className="font-mono text-xs text-muted-foreground">{cpe.pppoeUsername}</div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">{cpe.model}</div>
                          <div className="font-mono text-xs text-muted-foreground break-all">{cpe.deviceId}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>WAN {cpe.wanIp}</div>
                          <div className="text-muted-foreground">LAN {cpe.lanIp}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <time
                            dateTime={new Date(cpe.lastInformAt * 1000).toISOString()}
                            title="Inform terakhir ke ACS"
                          >
                            {oltTimeFormat.format(new Date(cpe.lastInformAt * 1000))} WIB
                          </time>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{cpe.wifi.ssid}</div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {cpe.wifi.clientCount} klien aktif
                          </div>
                        </TableCell>
                        <TableCell>
                          <OpticalRx dbm={cpe.isOnline ? cpe.opticalPowerDbm : null} />
                        </TableCell>
                        <TableCell>
                          {cpe.isOnline ? (
                            <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                              <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-success" />
                              Online
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                              <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-destructive" />
                              Offline
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {customer && (
                            <CustomerCpeDialog
                              customer={customer}
                              cpe={cpe}
                              onQuickDiagnostic={(id) => {
                                setDiagCustomerId(id);
                                setTab("diagnostics");
                              }}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </>
      )}
      </TabsContent>
    </Tabs>
  );
}
