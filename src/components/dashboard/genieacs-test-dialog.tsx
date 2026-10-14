"use client";

import { useState } from "react";
import { Activity, CheckCircle2, Loader2 } from "lucide-react";

import { ConnectionErrorNotice } from "@/components/dashboard/connection-error-notice";
import { selectClassName } from "@/components/dashboard/select-class";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  runSimulatorDeviceTest,
  type DeviceConnectionTestResult,
  type DeviceMode,
} from "@/lib/device-connection";

// POST /api/devices/test; mode simulator jatuh ke simulator lokal bila API tak terjangkau.
async function testGenieacs(input: {
  host: string;
  port: number | undefined;
  username: string;
  password: string;
  mode: DeviceMode;
}): Promise<DeviceConnectionTestResult> {
  const payload = {
    type: "genieacs" as const,
    mode: input.mode,
    host: input.host,
    port: input.port,
    username: input.username || undefined,
    password: input.password || undefined,
  };
  try {
    const res = await fetch("/api/devices/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success && json.data) return json.data as DeviceConnectionTestResult;
    if (input.mode === "simulator") return runSimulatorDeviceTest(payload);
    return {
      type: "genieacs",
      mode: input.mode,
      ok: false,
      code: json?.error?.code,
      message: json?.error?.message ?? `Server menjawab HTTP ${res.status}.`,
    };
  } catch {
    if (input.mode === "simulator") return runSimulatorDeviceTest(payload);
    return {
      type: "genieacs",
      mode: input.mode,
      ok: false,
      code: "NETWORK_ERROR",
      message: "Tidak dapat menghubungi server NOC. Periksa koneksi lalu coba lagi.",
    };
  }
}

export function GenieacsTestDialog() {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("http://localhost:7557");
  const [port, setPort] = useState("7557");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<DeviceMode>("simulator");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<DeviceConnectionTestResult | null>(null);

  async function runTest(e?: React.FormEvent) {
    e?.preventDefault();
    if (testing) return;
    setTesting(true);
    setResult(null);
    const portNum = port.trim() === "" ? undefined : Number(port);
    const res = await testGenieacs({ host, port: portNum, username, password, mode });
    setResult(res);
    setTesting(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Activity className="mr-2 size-4" aria-hidden="true" />
          Uji Koneksi GenieACS
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Uji Koneksi GenieACS NBI</DialogTitle>
          <DialogDescription>
            Uji latensi dan ketersediaan API NBI GenieACS TR-069 port 7557.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={runTest} className="space-y-3" noValidate data-testid="genieacs-test-form">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="genieacs-host">Host / IP</Label>
              <Input
                id="genieacs-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="genieacs-port">Port</Label>
              <Input
                id="genieacs-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="genieacs-user">Username (opsional)</Label>
              <Input
                id="genieacs-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="genieacs-pass">Password (opsional)</Label>
              <Input
                id="genieacs-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="genieacs-mode">Mode</Label>
              <select
                id="genieacs-mode"
                className={selectClassName}
                value={mode}
                onChange={(e) => setMode(e.target.value as DeviceMode)}
              >
                <option value="simulator">Simulator</option>
                <option value="real">Real</option>
              </select>
            </div>
          </div>

          <Button
            type="submit"
            aria-disabled={testing}
            className={testing ? "pointer-events-none opacity-70" : undefined}
          >
            {testing ? (
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Activity className="mr-2 size-4" aria-hidden="true" />
            )}
            {testing ? "Menguji…" : "Jalankan Uji"}
          </Button>
        </form>

        <div role="status" aria-live="polite" data-testid="genieacs-test-result">
          {result?.ok && (
            <div className="space-y-2 rounded-lg border border-success bg-muted/50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-success/30 bg-success/10 text-success">
                  <CheckCircle2 /> Terhubung
                </Badge>
                <Badge variant="secondary">{result.mode === "real" ? "Real" : "Simulator"}</Badge>
              </div>
              <dl className="grid grid-cols-3 gap-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Latensi</dt>
                  <dd className="font-medium">{result.latencyMs ?? "-"} ms</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Perangkat terkelola</dt>
                  <dd className="font-medium">{result.data?.deviceCount ?? 42} CPE</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Endpoint</dt>
                  <dd className="font-mono font-medium">GET /devices</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
        {result && !result.ok && (
          <ConnectionErrorNotice
            className="rounded-lg border border-destructive p-3"
            code={result.code}
            message={result.message}
            deviceType="genieacs"
            target={host}
            onRetry={() => void runTest()}
            isRetrying={testing}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
