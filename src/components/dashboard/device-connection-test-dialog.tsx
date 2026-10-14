"use client";

import { useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEVICE_TYPE_LABEL,
  evaluateConnectionTestOutcome,
  formatDeviceEndpoint,
  getRecommendedActionForFailure,
  type DeviceTestRequest,
  type DeviceTestResultSummary,
  type TestableDeviceType,
} from "@/lib/dashboard/device-connection-modal";

const STATUS_LABEL: Record<DeviceTestResultSummary["status"], string> = {
  connected: "Terhubung",
  error: "Gagal",
  refused: "Ditolak",
  unauthorized: "Kredensial Salah",
  timeout: "Timeout",
};

const DETAIL_LABEL: Record<string, string> = {
  version: "Versi OS",
  uptime: "Uptime",
  cpuLoad: "CPU Load (%)",
  boardName: "Board",
  deviceCount: "Jumlah Perangkat",
  ponPorts: "Port PON",
  onuCount: "Jumlah ONU",
  info: "Info",
};

const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

function latencyClass(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 50) return "text-success";
  if (ms > 100) return "text-warning";
  return "";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Omit<DeviceTestRequest, "password">;
}

export function DeviceConnectionTestDialog({ open, onOpenChange, initial }: Props) {
  const [type, setType] = useState<TestableDeviceType>(initial.type);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"simulator" | "real">(initial.mode ?? "simulator");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceTestResultSummary | null>(null);
  const running = useRef(false);

  const portNum = Number(port);
  const portOk = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
  const canRun = host.trim() !== "" && portOk;

  async function run() {
    if (running.current || !canRun) return;
    running.current = true;
    setBusy(true);
    try {
      let raw: unknown;
      try {
        const res = await fetch("/api/devices/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            mode,
            host: host.trim(),
            port: portNum,
            username: username.trim() || undefined,
            password: password || undefined,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.success && json.data) raw = json.data;
        else if (res.status === 401) raw = { ok: false, message: "Sesi berakhir, silakan masuk lagi." };
        else if (res.status === 403)
          raw = { ok: false, message: "Akun ini tidak berhak menguji perangkat (butuh izin router:manage)." };
        else raw = { ok: false, message: json?.error?.message ?? `Server menjawab HTTP ${res.status}.` };
      } catch (e) {
        const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        raw = {
          ok: false,
          status: timeout ? "timeout" : "error",
          message: timeout ? "Batas waktu pengujian terlampaui." : "Server NOC tidak dapat dihubungi.",
        };
      }
      setResult(evaluateConnectionTestOutcome(raw, type));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const details = result ? Object.entries(result.details) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="device-connection-dialog" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Uji Koneksi Perangkat {initial.name}</DialogTitle>
          <DialogDescription>
            Ubahan di sini hanya untuk pengujian ini dan tidak disimpan.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          noValidate
        >
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="dct-type">Tipe Perangkat</Label>
            <select
              id="dct-type"
              className={selectClass}
              value={type}
              onChange={(e) => setType(e.target.value as TestableDeviceType)}
            >
              {(Object.keys(DEVICE_TYPE_LABEL) as TestableDeviceType[]).map((t) => (
                <option key={t} value={t}>
                  {DEVICE_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="dct-host">Host / IP Address</Label>
            <Input id="dct-host" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dct-port">Port</Label>
            <Input
              id="dct-port"
              inputMode="numeric"
              value={port}
              aria-invalid={!portOk}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dct-mode">Mode</Label>
            <select
              id="dct-mode"
              className={selectClass}
              value={mode}
              onChange={(e) => setMode(e.target.value as "simulator" | "real")}
            >
              <option value="simulator">Simulator</option>
              <option value="real">Real</option>
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dct-user">Username</Label>
            <Input
              id="dct-user"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dct-pass">Password (opsional)</Label>
            <Input
              id="dct-pass"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p className="col-span-2 break-all font-mono text-xs text-muted-foreground">
            {canRun ? formatDeviceEndpoint(type, host, portNum) : "Isi host dan port (1-65535)."}
          </p>
          <Button
            type="submit"
            data-testid="run-test-button"
            className="col-span-2 gap-1.5"
            aria-disabled={busy || !canRun}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {busy ? "Menguji…" : "Mulai Pengujian"}
          </Button>
        </form>

        <div role="status" aria-live="polite" data-testid="test-outcome-panel" className="grid gap-2">
          {result && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant={result.ok ? "secondary" : "destructive"}
                  data-testid="test-status"
                  data-status={result.status}
                >
                  {STATUS_LABEL[result.status]}
                </Badge>
                <span
                  className={`font-mono text-sm font-semibold ${latencyClass(result.latencyMs)}`}
                  data-testid="test-latency"
                >
                  {result.latencyMs !== null ? `${result.latencyMs} ms` : "— ms"}
                </span>
              </div>
              <p className="text-sm">{result.message}</p>
              {details.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-2 text-xs">
                  {details.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{DETAIL_LABEL[k] ?? k}</dt>
                      <dd className="font-mono">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!result.ok && (
                <div
                  className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs"
                  data-testid="test-guidance"
                >
                  <strong>Saran: </strong>
                  {getRecommendedActionForFailure(result.status)}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
