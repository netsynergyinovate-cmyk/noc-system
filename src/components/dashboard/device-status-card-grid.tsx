"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Router as RouterIcon, Server, Thermometer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeviceConnectionTestDialog } from "@/components/dashboard/device-connection-test-dialog";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { buildRouterDetails } from "@/lib/dashboard/routers";
import { MOCK_DEVICE_CONFIGS } from "@/lib/dashboard/device-config";
import {
  CPU_WARN_PERCENT,
  TEMP_WARN_CELSIUS,
  computeAggregateDeviceStatus,
  transformOltsToStatusCards,
  transformRoutersToStatusCards,
  type DeviceHardwareStatus,
} from "@/lib/dashboard/device-status-cards";

type Filter = "all" | "router" | "olt";

const DOT: Record<DeviceHardwareStatus["status"], string> = {
  online: "bg-success",
  offline: "bg-destructive",
  warning: "bg-warning",
};
const LABEL: Record<DeviceHardwareStatus["status"], string> = {
  online: "Online",
  offline: "Offline",
  warning: "Perlu perhatian",
};

// Ponytail: data OLT masih tiruan dari device-config; ganti dengan API OLT nyata.
const MOCK_OLTS = MOCK_DEVICE_CONFIGS.filter((d) => d.type === "olt").map((d) => ({
  id: d.id,
  name: d.name,
  host: d.host,
  brand: String(d.metadata.brand ?? "OLT"),
  ponPorts: d.metadata.ponPorts,
  activeOnus: d.metadata.activeOnus,
  temperature: 41,
  uptime: "35 hari",
  online: d.status === "connected",
}));

function isHot(card: DeviceHardwareStatus): boolean {
  const n = Number(/(\d+)/.exec(card.cpuOrTemp)?.[1]);
  if (!Number.isFinite(n)) return false;
  return card.type === "router" ? n > CPU_WARN_PERCENT : n > TEMP_WARN_CELSIUS;
}

function DeviceCard({ card }: { card: DeviceHardwareStatus }) {
  const [open, setOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  // Ponytail: port/username router belum ada di kartu; pakai bawaan REST MikroTik.
  const cfg = MOCK_DEVICE_CONFIGS.find((d) => d.id === card.id && d.type === card.type);

  const Icon = card.type === "router" ? RouterIcon : Server;
  const hot = isHot(card);

  return (
    <Card data-testid="device-card" data-type={card.type} data-status={card.status}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`size-2.5 shrink-0 rounded-full ${DOT[card.status]}`}
                aria-hidden="true"
              />
              <h3 className="truncate text-sm font-semibold">{card.name}</h3>
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {card.ipAddress} · <span className="sr-only">Status: </span>
              {LABEL[card.status]}
            </p>
          </div>
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Icon className="size-3" aria-hidden="true" />
            {card.type === "router" ? `Router ${card.brand}` : `OLT ${card.brand}`}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Uptime</dt>
            <dd className="font-medium">{card.uptime}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {card.type === "router" ? "CPU" : "Suhu"}
            </dt>
            <dd
              className={`flex items-center gap-1 font-mono font-semibold ${
                hot ? "text-warning" : ""
              }`}
              data-hot={hot}
            >
              {card.type === "olt" && <Thermometer className="size-3" aria-hidden="true" />}
              {card.cpuOrTemp}
              {hot && <span className="font-sans text-[10px] font-normal">(tinggi)</span>}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">
              {card.type === "router" ? "Beban PPPoE" : "Kapasitas PON / ONU"}
            </dt>
            <dd className="font-medium">{card.capacitySummary}</dd>
          </div>
        </dl>

        {open && (
          <div className="rounded-md border bg-muted/40 p-2 text-xs">
            <div>Terakhir terlihat: {card.lastSeenText}</div>
            <div>Trafik: {card.trafficSummary ?? "Belum ada data"}</div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            Rincian
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            onClick={() => setTestOpen(true)}
          >
            <Activity className="size-3" aria-hidden="true" />
            Uji Ping / Koneksi
          </Button>
        </div>
        {testOpen && (
          <DeviceConnectionTestDialog
            open={testOpen}
            onOpenChange={setTestOpen}
            initial={{
              type: card.type === "router" ? "mikrotik" : "olt",
              name: card.name,
              host: card.ipAddress,
              port: cfg?.port ?? (card.type === "router" ? 443 : 80),
              username: cfg?.username ?? "",
              mode: cfg?.mode ?? "simulator",
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function DeviceStatusCardGrid() {
  const isDemo = useSession(selectPreviewEnabled);
  const routers = useDashboardStore((s) => s.routers);
  const customers = useDashboardStore((s) => s.customers);
  const [filter, setFilter] = useState<Filter>("all");
  const [realOlts, setRealOlts] = useState<
    Array<{
      id: string;
      name: string;
      host: string;
      brand: string;
      ponPorts: number;
      activeOnus: number;
      temperature: number | null;
      uptime: string | null;
      online: boolean;
    }>
  >([]);

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    fetch("/api/olts")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat data OLT`);
        return res.json();
      })
      .then((json: { data?: Array<{ id: string; name: string; host: string; brand?: string; lastSeenAt?: string | null; ponPortCount?: number; onuOnline?: number }> }) => {
        if (!active || !Array.isArray(json?.data)) return;
        const mapped = json.data.map((o) => {
          const isFresh = o.lastSeenAt
            ? Date.now() - new Date(o.lastSeenAt).getTime() < 5 * 60 * 1000
            : false;
          return {
            id: o.id,
            name: o.name,
            host: o.host,
            brand: o.brand || "OLT",
            ponPorts: o.ponPortCount ?? 0,
            activeOnus: o.onuOnline ?? 0,
            temperature: null,
            uptime: null,
            online: isFresh,
          };
        });
        setRealOlts(mapped);
      })
      .catch((err: unknown) => {
        console.error("Gagal memuat OLT:", err instanceof Error ? err.message : err);
      });
    return () => {
      active = false;
    };
  }, [isDemo]);

  const currentOlts = isDemo ? MOCK_OLTS : realOlts;
  const routerCards = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of customers) counts[c.routerId] = (counts[c.routerId] ?? 0) + 1;
    return transformRoutersToStatusCards(buildRouterDetails(routers, counts), customers);
  }, [routers, customers]);
  const oltCards = useMemo(() => transformOltsToStatusCards(currentOlts), [currentOlts]);
  const agg = useMemo(
    () => computeAggregateDeviceStatus(routers, currentOlts, customers),
    [routers, customers, currentOlts],
  );
  const cards = [
    ...(filter !== "olt" ? routerCards : []),
    ...(filter !== "router" ? oltCards : []),
  ];

  if (cards.length === 0) {
    return (
      <Card className="border-dashed p-6 text-center text-muted-foreground">
        <p className="text-sm font-medium">Belum ada perangkat Router atau OLT fisik yang terhubung.</p>
        <p className="mt-1 text-xs">Tambahkan router MikroTik baru lewat tombol &ldquo;Tambah Router&rdquo; di atas.</p>
      </Card>
    );
  }

  return (
    <section
      aria-label="Status perangkat Router dan OLT"
      className="flex flex-col gap-3"
      data-testid="device-status-grid"
      data-healthy={agg.allHealthy}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span>
          Router Online{" "}
          <strong className="font-mono">
            {agg.onlineRouters}/{agg.totalRouters}
          </strong>
        </span>
        <span>
          OLT Online{" "}
          <strong className="font-mono">
            {agg.onlineOlts}/{agg.totalOlts}
          </strong>
        </span>
        <span className="text-muted-foreground">
          {agg.totalActiveOnus} ONU · {agg.totalActivePppoe} PPPoE
        </span>
        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          className="ml-auto"
        >
          <TabsList>
            <TabsTrigger value="all">Semua Perangkat</TabsTrigger>
            <TabsTrigger value="router">Router Saja</TabsTrigger>
            <TabsTrigger value="olt">OLT Saja</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada perangkat.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <DeviceCard key={`${c.type}-${c.id}`} card={c} />
          ))}
        </div>
      )}
    </section>
  );
}
