"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2, Server } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeviceOutcomeAlert } from "@/components/dashboard/device-outcome-alert";
import { DeviceStatusBadge } from "@/components/dashboard/device-status-badge";
import { DeviceTestButton } from "@/components/dashboard/device-test-button";
import {
  type DeviceConfig,
  type TestOutcome,
  applyTestOutcome,
  getDeviceTypeLabel,
  summarizeDeviceStatuses,
} from "@/lib/dashboard/device-config";

interface ApiDeviceResponse {
  data?: {
    routers?: Array<{
      id: string;
      name: string;
      host: string;
      username: string;
      status: string;
    }>;
    olts?: Array<{
      id: string;
      name: string;
      host: string;
      brand: string;
      driver: string;
      username: string;
      status: string;
    }>;
  };
}

// Kartu ringkas perangkat untuk tab "Perangkat" di /app/pengaturan.
export function DeviceQuickCards() {
  const [devices, setDevices] = useState<DeviceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingIds, setTestingIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Record<string, TestOutcome>>({});

  useEffect(() => {
    fetch("/api/devices")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: ApiDeviceResponse | null) => {
        if (!json?.data) return;
        const routerList = json.data.routers ?? [];
        const oltList = json.data.olts ?? [];

        const realDevices: DeviceConfig[] = [
          ...routerList.map((r) => ({
            id: r.id,
            name: r.name,
            type: "mikrotik" as const,
            host: r.host,
            port: 443,
            protocol: "REST API v7",
            username: r.username,
            status: r.status === "online" ? ("connected" as const) : r.status === "offline" ? ("error" as const) : ("untested" as const),
            mode: "real" as const,
            description: `MikroTik RouterOS REST API • Operator: ${r.username}`,
            envHostKey: "MIKROTIK_REST_HOST",
            envUserKey: "MIKROTIK_REST_USER",
            envPassKey: "MIKROTIK_REST_PASSWORD",
            lastTestedAt: null,
            latencyMs: null,
            metadata: {},
          })),
          ...oltList.map((o) => ({
            id: o.id,
            name: o.name,
            type: "olt" as const,
            host: o.host,
            port: 161,
            protocol: "SNMP / Telnet",
            username: o.username,
            status: o.status === "online" ? ("connected" as const) : o.status === "offline" ? ("error" as const) : ("untested" as const),
            mode: "real" as const,
            description: `OLT ${o.brand} (${o.driver}) • Akun: ${o.username}`,
            envHostKey: "OLT_HOST",
            envUserKey: "OLT_USER",
            envPassKey: "OLT_PASSWORD",
            lastTestedAt: null,
            latencyMs: null,
            metadata: {},
          })),
        ];
        setDevices(realDevices);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  function onOutcome(d: DeviceConfig, r: TestOutcome) {
    setDevices((prev) => prev.map((x) => (x.id === d.id ? applyTestOutcome(x, r) : x)));
    setMessages((prev) => ({ ...prev, [d.id]: r }));
  }

  function setTesting(id: string, busy: boolean) {
    setTestingIds((prev) => (busy ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  }

  async function runRealDeviceTest(d: DeviceConfig): Promise<TestOutcome> {
    const endpoint = d.type === "mikrotik" ? `/api/routers/${d.id}/test` : `/api/olts/${d.id}/test`;
    const res = await fetch(endpoint, { method: "POST" });
    const json = await res.json();
    if (json?.data) {
      return {
        ok: Boolean(json.data.ok),
        message: json.data.message || (json.data.ok ? "Koneksi perangkat berhasil" : "Koneksi perangkat gagal"),
        latencyMs: json.data.latencyMs ?? null,
        statusCode: json.data.statusCode,
        code: json.data.code,
        endpointTested: json.data.endpointTested,
        status: json.data.ok ? "connected" : "error",
      };
    }
    return {
      ok: res.ok,
      message: json?.message || (res.ok ? "Uji koneksi berhasil" : "Uji koneksi gagal"),
      latencyMs: null,
      status: res.ok ? "connected" : "error",
    };
  }
  const sum = summarizeDeviceStatuses(devices, testingIds);

  return (
    <div className="space-y-4" data-testid="device-quick-cards">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Server className="size-3.5 text-primary" />
          <span>
            {loading
              ? "Memeriksa perangkat terdaftar di PostgreSQL..."
              : devices.length > 0
                ? `${devices.length} perangkat terdaftar di database PostgreSQL.`
                : "Belum ada perangkat terdaftar."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/router"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <span>Kelola Router</span>
            <ArrowRight className="size-3" />
          </Link>
          <span className="text-muted-foreground">•</span>
          <Link
            href="/setup"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <span>Wisaya Setup</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-8 text-xs text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>Memuat data perangkat riil...</span>
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-3 bg-muted/10">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
            <Server className="size-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-sm">Belum Ada Perangkat Terdaftar</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Daftarkan router MikroTik atau OLT GPON pertama Anda untuk mulai memantau dan menguji konektivitas jaringan secara langsung.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button asChild size="sm" className="h-8 text-xs gap-1.5">
              <Link href="/app/router">
                <span>Tambah Router Baru</span>
                <ArrowRight className="size-3" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
              <Link href="/setup">Wisaya Inisialisasi</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div
            role="status"
            aria-live="polite"
            data-testid="device-status-summary"
            className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-xs"
          >
            <span className="font-medium">
              {sum.connected} dari {sum.total} perangkat terhubung
            </span>
            {sum.testing > 0 && <span data-testid="summary-testing">{sum.testing} sedang diuji</span>}
            {sum.error > 0 && <span data-testid="summary-error">{sum.error} gagal</span>}
            {sum.timeout > 0 && <span data-testid="summary-timeout">{sum.timeout} timeout</span>}
            {sum.untested > 0 && <span data-testid="summary-untested">{sum.untested} belum diuji</span>}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {devices.map((d) => {
              const msg = messages[d.id];
              return (
                <Card key={d.id} data-testid="device-quick-card" data-device-type={d.type}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{d.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {getDeviceTypeLabel(d.type)} &bull; {d.host}
                        </CardDescription>
                      </div>
                      <DeviceStatusBadge status={d.status} isTesting={testingIds.includes(d.id)} latencyMs={d.latencyMs} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">{d.description}</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Latensi</span>
                      <span className="tabular-nums">{d.latencyMs ? `${d.latencyMs} ms` : "-"}</span>
                    </div>
                    <div aria-live="polite">
                      {msg && <DeviceOutcomeAlert outcome={msg} device={d} />}
                    </div>
                    <DeviceTestButton
                      device={d}
                      onOutcome={(r) => onOutcome(d, r)}
                      onTestingChange={(b) => setTesting(d.id, b)}
                      customTest={runRealDeviceTest}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
