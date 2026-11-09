"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Loader2,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useNowSeconds } from "@/lib/dashboard/use-now";
import {
  MOCK_DEVICE_CONFIGS,
  runDeviceTest,
  type DeviceConfig,
  type DeviceType,
} from "@/lib/dashboard/device-config";
import {
  computeRetryPolicy,
  diagnoseUnreachableDevice,
  formatDowntime,
  type UnreachableDeviceType,
} from "@/lib/dashboard/unreachable-device-logic";

type Scope = "router" | "olt";
interface Target {
  id: string;
  name: string;
  type: UnreachableDeviceType;
  config: DeviceConfig;
}
interface RetryState {
  failures: number;
  lastRetry: number;
  code?: string;
  recovered?: boolean;
}

const TYPE_MAP: Record<DeviceType, UnreachableDeviceType> = {
  mikrotik: "router",
  olt: "olt",
  genieacs: "genieacs",
  billing: "billing",
};

function endpointOf(c: DeviceConfig): string {
  return c.type === "mikrotik"
    ? `${c.host}:${c.port}/rest/system/resource`
    : `${c.host}:${c.port}`;
}

function routerConfig(id: string, name: string, host: string): DeviceConfig {
  const known = MOCK_DEVICE_CONFIGS.find(
    (d) => d.id === id && d.type === "mikrotik",
  );
  if (known) return known;
  return {
    id,
    type: "mikrotik",
    name,
    description: "",
    host,
    port: 443,
    protocol: "https",
    username: "",
    mode: "simulator",
    status: "disconnected",
    envHostKey: "",
    envUserKey: "",
    envPassKey: "",
    lastTestedAt: null,
    latencyMs: null,
    metadata: {},
  };
}

function Card({ target, scope }: { target: Target; scope: Scope }) {
  const now = useNowSeconds();
  const [st, setSt] = useState<RetryState>({ failures: 1, lastRetry: 0 });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const report = diagnoseUnreachableDevice({
    deviceId: target.id,
    deviceName: target.name,
    deviceType: target.type,
    endpoint: endpointOf(target.config),
    lastSeenEpoch: target.config.lastTestedAt,
    nowSec: now,
    errorCode:
      st.code ?? (target.config.status === "timeout" ? "TIMEOUT" : undefined),
    consecutiveFailures: st.failures,
  });
  const policy = computeRetryPolicy(st.failures, st.lastRetry, now);
  const wait = Math.max(0, policy.nextRetryEpoch - now);

  if (st.recovered) {
    return (
      <div
        role="status"
        className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm"
      >
        {target.name} kembali terjangkau.
      </div>
    );
  }

  async function retry() {
    if (busy || !policy.canRetryNow) return;
    setBusy(true);
    const at = Math.floor(Date.now() / 1000);
    const r = await runDeviceTest(target.config).catch(() => ({
      ok: false,
      code: "UNKNOWN" as const,
    }));
    setSt((p) =>
      r.ok
        ? { ...p, recovered: true }
        : { failures: p.failures + 1, lastRetry: at, code: r.code ?? p.code },
    );
    setBusy(false);
  }

  async function copy() {
    if (!report.suggestedCliCommand) return;
    try {
      await navigator.clipboard.writeText(report.suggestedCliCommand);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const blocked = busy || !policy.canRetryNow;
  return (
    <section
      data-testid="unreachable-device-banner"
      data-scope={scope}
      data-device-id={target.id}
      data-code={report.failureCode}
      aria-label={`Perangkat tak terjangkau: ${target.name}`}
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-sm font-semibold">
              {report.deviceName} tidak terjangkau
            </h2>
            <p
              className="text-xs text-muted-foreground"
              data-testid="unreachable-downtime"
            >
              {target.config.lastTestedAt === null
                ? "Lama mati belum diketahui"
                : `Mati selama ${formatDowntime(report.downtimeSeconds)}`}
              {" · "}
              {report.failureReason}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            data-testid="retry-connection-btn"
            aria-disabled={blocked}
            onClick={retry}
          >
            {busy ? (
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            {busy
              ? "Menguji…"
              : !policy.canRetryNow
                ? `Uji ulang dalam ${wait} dtk`
                : "Uji Ulang Koneksi Sekarang"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            asChild
          >
            <Link href="/setup">
              <Settings className="size-4" aria-hidden="true" />
              Buka Setup Perangkat
            </Link>
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Alamat endpoint</dt>
          <dd className="font-mono break-all">{report.endpoint}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Kode galat</dt>
          <dd className="font-mono">{report.failureCode}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Gagal beruntun</dt>
          <dd className="font-mono">{report.consecutiveFailures}×</dd>
        </div>
      </dl>

      <div className="mt-3">
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
          Panduan solusi cepat
        </button>
        {open && (
          <div className="mt-2 space-y-2 text-xs">
            <ol className="list-decimal space-y-1 pl-5">
              {report.troubleshootingSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {report.suggestedCliCommand && (
              <div className="rounded-md border bg-muted/40 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Perintah CLI</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={copy}
                  >
                    <Copy className="size-3" aria-hidden="true" />
                    {copied ? "Tersalin" : "Salin"}
                  </Button>
                </div>
                <pre className="overflow-x-auto font-mono">
                  {report.suggestedCliCommand}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function UnreachableDeviceBanner({ scope }: { scope: Scope }) {
  const routers = useDashboardStore((s) => s.routers);
  const targets: Target[] =
    scope === "router"
      ? routers
          .filter((r) => !r.active)
          .map((r) => ({
            id: r.id,
            name: r.name,
            type: "router",
            config: routerConfig(r.id, r.name, r.host),
          }))
      : MOCK_DEVICE_CONFIGS.filter(
          (d) =>
            d.type === "olt" &&
            d.status !== "connected" &&
            d.status !== "untested",
        ).map((d) => ({
          id: d.id,
          name: d.name,
          type: TYPE_MAP[d.type],
          config: d,
        }));

  if (targets.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="unreachable-device-list">
      {targets.map((t) => (
        <Card key={t.id} target={t} scope={scope} />
      ))}
    </div>
  );
}
