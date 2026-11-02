"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Server } from "lucide-react";

import { ConnectionErrorNotice } from "@/components/dashboard/connection-error-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DeviceConnectionTestResult } from "@/lib/device-connection";

type Props = {
  host: string;
  port?: number;
  // Tidak diisi = server menyimpulkan dari skema host / port (443, 8443).
  useSsl?: boolean;
  username?: string;
  password?: string;
  onTestComplete?: (result: DeviceConnectionTestResult) => void;
  compact?: boolean;
};

export function RouterTestPanel({
  host,
  port,
  useSsl,
  username,
  password,
  onTestComplete,
  compact = false,
}: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<DeviceConnectionTestResult | null>(null);

  async function runTest() {
    if (testing) return;
    setTesting(true);
    setResult(null);

    try {
      const res = await fetch("/api/routers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          port,
          username,
          password,
          useSsl,
          mode: "real",
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const testData = json.data;
        const testRes: DeviceConnectionTestResult = {
          ok: Boolean(testData?.ok),
          type: "mikrotik",
          mode: "real",
          code: testData?.ok ? undefined : testData?.code,
          latencyMs: testData?.latencyMs,
          message: testData?.message ?? (testData?.ok ? "Terhubung ke MikroTik" : "Gagal terhubung"),
          data: {
            version: testData?.version,
            boardName: testData?.["board-name"],
            cpuLoad: testData?.["cpu-load"],
            uptime: testData?.uptime,
            sourceIp: testData?.sourceIp ?? undefined,
          },
        };
        setResult(testRes);
        onTestComplete?.(testRes);
      } else {
        const json = await res.json().catch(() => null);
        const failRes: DeviceConnectionTestResult = {
          ok: false,
          type: "mikrotik",
          mode: "real",
          message:
            json?.error?.message ||
            (res.status === 403
              ? "Akun Anda tidak memiliki izin untuk menguji router (Perlu peran admin)."
              : "Uji koneksi gagal."),
        };
        setResult(failRes);
        onTestComplete?.(failRes);
      }
    } catch {
      // Aplikasi sendiri tidak terjangkau: lapor apa adanya, jangan pura-pura terhubung.
      const failRes: DeviceConnectionTestResult = {
        ok: false,
        type: "mikrotik",
        mode: "real",
        code: "NETWORK_ERROR",
        message: "Server aplikasi tidak menjawab permintaan uji. Periksa koneksi lalu coba lagi.",
      };
      setResult(failRes);
      onTestComplete?.(failRes);
    } finally {
      setTesting(false);
    }
  }

  const metrics = result?.ok
    ? [
        ["Latensi", result.latencyMs !== undefined ? `${result.latencyMs} ms` : "-"],
        ["Versi RouterOS", String(result.data?.version ?? "-")],
        ["Model Board", String(result.data?.boardName ?? "-")],
        ["Beban CPU", result.data?.cpuLoad !== undefined ? `${result.data.cpuLoad}%` : "-"],
        ["Uptime", String(result.data?.uptime ?? "-")],
      ]
    : [];

  return (
    <div
      data-testid="router-test-panel"
      className={cn(
        "rounded-lg border bg-muted/50",
        compact ? "p-3" : "p-4",
        result?.ok && "border-success",
        result && !result.ok && "border-destructive",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={runTest}
          aria-disabled={testing}
          className={testing ? "pointer-events-none opacity-70" : undefined}
        >
          {testing ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Server className="mr-2 size-4" />
          )}
          Uji Koneksi Router
        </Button>
        {testing && (
          <span role="status" className="text-sm text-muted-foreground">
            Menguji koneksi RouterOS...
          </span>
        )}
        {result?.ok && (
          <span role="status" className="flex items-center gap-2 text-sm">
            <Badge className="border-success/30 bg-success/10 text-success">
              <CheckCircle2 /> Terhubung
            </Badge>
          </span>
        )}
      </div>

      {result && !result.ok && (
        <ConnectionErrorNotice
          className="mt-3"
          code={result.code}
          message={result.message}
          deviceType="mikrotik"
          target={host}
          sourceIp={typeof result.data?.sourceIp === "string" ? result.data.sourceIp : undefined}
          onRetry={runTest}
          isRetrying={testing}
          compact={compact}
        />
      )}

      {result?.ok && (
        <dl
          className={cn(
            "mt-3 grid gap-x-6 gap-y-2 text-sm",
            compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3",
          )}
        >
          {metrics.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
