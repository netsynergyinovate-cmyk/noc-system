"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ChevronLeft, Loader2 } from "lucide-react";

import { DeviceOutcomeAlert } from "@/components/dashboard/device-outcome-alert";
import { DeviceStatusBadge } from "@/components/dashboard/device-status-badge";
import { RouterHardwareCards } from "@/components/dashboard/router-hardware-cards";
import { SecretCredentialInput } from "@/components/dashboard/secret-credential-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MOCK_DEVICE_CONFIGS, type DeviceConfig, type TestOutcome } from "@/lib/dashboard/device-config";
import {
  DEFAULT_ROUTER_TEST_FORM,
  routerResourceFromOutcome,
  runRouterTest,
  toTestEntry,
  type RouterTestEntry,
  type RouterTestForm,
} from "@/lib/dashboard/router-test";
import { useDashboardStore } from "@/lib/dashboard/store";

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function RouterTestBoard() {
  const routers = useDashboardStore((s) => s.routers);
  const [source, setSource] = useState<"saved" | "manual">("manual");
  const [savedId, setSavedId] = useState("");
  const [form, setForm] = useState<RouterTestForm>(DEFAULT_ROUTER_TEST_FORM);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ device: DeviceConfig; outcome: TestOutcome } | null>(null);
  const [history, setHistory] = useState<RouterTestEntry[]>([]);

  const set = <K extends keyof RouterTestForm>(k: K, v: RouterTestForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function pickSaved(id: string) {
    setSavedId(id);
    const r = routers.find((x) => x.id === id);
    if (r) {
      setForm((f) => ({ ...f, host: r.host, port: "443", username: MOCK_DEVICE_CONFIGS[0].username }));
      setErrors({});
    }
  }

  async function onTest() {
    setTesting(true);
    setErrors({});
    try {
      const r = await runRouterTest(form);
      if (!r.ok) {
        setErrors(r.errors);
        return;
      }
      setResult({ device: r.device, outcome: r.outcome });
      setHistory((h) => [toTestEntry(h.length + 1, r.device, r.outcome), ...h]);
    } finally {
      setTesting(false);
    }
  }

  const resource = result ? routerResourceFromOutcome(result.outcome, result.device) : null;
  const status = result ? (result.outcome.status ?? (result.outcome.ok ? "connected" : "error")) : "untested";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/app/router">
            <ChevronLeft className="size-5" />
            <span className="sr-only">Kembali ke Kelola Router</span>
          </Link>
        </Button>
        <div>
          <Link href="/app/router" className="text-xs text-muted-foreground hover:underline">
            Kembali ke Kelola Router
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Uji Koneksi Router MikroTik</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Periksa jangkauan, kredensial, dan endpoint REST RouterOS sebelum router disimpan. Kata sandi hanya dipakai
            untuk pengujian ini dan tidak ditampilkan di riwayat.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parameter Pengujian</CardTitle>
          <CardDescription>Pilih router tersimpan atau isi manual.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!testing) void onTest();
            }}
          >
            <fieldset className="flex flex-wrap gap-4">
              <legend className="sr-only">Sumber router</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="source" checked={source === "saved"} onChange={() => setSource("saved")} />
                Pilih router yang sudah ada
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="source" checked={source === "manual"} onChange={() => setSource("manual")} />
                Input router manual
              </label>
            </fieldset>

            {source === "saved" && (
              <div className="space-y-1.5">
                <Label htmlFor="rt-saved">Router tersimpan</Label>
                <select id="rt-saved" className={SELECT_CLS} value={savedId} onChange={(e) => pickSaved(e.target.value)}>
                  <option value="">Pilih router...</option>
                  {routers.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.host})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="rt-host">Host / IP</Label>
                <Input
                  id="rt-host"
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="10.10.0.1"
                  aria-invalid={errors.host ? true : undefined}
                />
                {errors.host && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.host}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-port">Port</Label>
                <Input
                  id="rt-port"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => set("port", e.target.value)}
                  aria-invalid={errors.port ? true : undefined}
                />
                {errors.port && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.port}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-user">Username</Label>
                <Input
                  id="rt-user"
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                  autoComplete="off"
                  aria-invalid={errors.username ? true : undefined}
                />
                {errors.username && (
                  <p role="alert" className="text-xs text-destructive">
                    {errors.username}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <SecretCredentialInput
                  id="rt-pass"
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Masukkan kata sandi"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rt-mode">Mode</Label>
                <select
                  id="rt-mode"
                  className={SELECT_CLS}
                  value={form.mode}
                  onChange={(e) => set("mode", e.target.value as RouterTestForm["mode"])}
                >
                  <option value="real">Real (REST Endpoint)</option>
                  <option value="simulator">Simulator</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.https} onChange={(e) => set("https", e.target.checked)} />
                Gunakan HTTPS / TLS
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.forceLocal}
                  onChange={(e) => set("forceLocal", e.target.checked)}
                />
                Paksa Simulasi Lokal (Offline Safe)
              </label>
            </div>

            <Button type="submit" aria-disabled={testing} className="gap-2">
              {testing ? <Loader2 className="size-4 animate-spin" /> : <Activity className="size-4" />}
              {testing ? "Menguji..." : "Mulai Pengujian Router"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {(result || testing) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              Hasil Pengujian
              <DeviceStatusBadge status={status} latencyMs={result?.outcome.latencyMs ?? null} isTesting={testing} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result && !testing && <DeviceOutcomeAlert outcome={result.outcome} device={result.device} />}
            {resource && !testing && (
              <div className="space-y-3" data-testid="router-resource">
                <RouterHardwareCards
                  cpuLoad={resource.cpuPct}
                  memoryUsage={resource.memoryPct}
                  uptime={resource.uptime}
                  temperature={resource.temperature}
                  boardModel={resource.board}
                  rosVersion={resource.version}
                  active
                />
                <dl className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["Latensi", resource.latency],
                      ["Endpoint diuji", resource.endpoint],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="rounded-md border p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="break-words text-sm font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Sesi</CardTitle>
          <CardDescription>Pengujian pada sesi ini; hilang saat halaman dimuat ulang.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="region" aria-label="Riwayat pengujian" tabIndex={0} className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latensi (ms)</TableHead>
                  <TableHead>Pesan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      Belum ada pengujian.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((h) => (
                    <TableRow key={h.id} data-testid="router-test-row">
                      <TableCell className="whitespace-nowrap">{new Date(h.at * 1000).toLocaleTimeString("id-ID")}</TableCell>
                      <TableCell>{h.host}</TableCell>
                      <TableCell>{h.port}</TableCell>
                      <TableCell>
                        <DeviceStatusBadge status={h.status} showLatency={false} />
                      </TableCell>
                      <TableCell>{h.latencyMs ?? "-"}</TableCell>
                      <TableCell className="max-w-xs break-words whitespace-normal">{h.message}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
