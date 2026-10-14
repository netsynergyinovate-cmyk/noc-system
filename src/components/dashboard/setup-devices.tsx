"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  mockSetupDevices,
  mockTestConnection,
  validateDevice,
  type DeviceErrors,
  type DeviceInput,
  type DeviceKind,
  type SetupDevice,
  type TestResult,
} from "@/lib/dashboard/devices";
import {
  DEVICE_KIND_OPTIONS,
  DEVICE_KIND_SHORT,
  evaluateSetupProgress,
} from "@/lib/dashboard/setup-extended";

type DeviceMode = "simulator" | "asli";

// UTC tetap supaya HTML server dan klien sama (tanpa kedip hydration).
const seenFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});
const formatSeen = (s: number) => `${seenFormat.format(new Date(s * 1000))} UTC`;

const empty: DeviceInput = {
  kind: "router",
  name: "",
  host: "",
  username: "",
  password: "",
};

export function SetupDevices() {
  const uid = useId();
  const [devices, setDevices] = useState<readonly SetupDevice[]>(mockSetupDevices);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<DeviceInput>(empty);
  const [errors, setErrors] = useState<DeviceErrors>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [lastAddedDevice, setLastAddedDevice] = useState<SetupDevice | null>(null);
  const [mode, setMode] = useState<DeviceMode>("simulator");
  const progress = evaluateSetupProgress(devices);

  const set = (k: keyof DeviceInput, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setResult(null);
  };

  const validateStep1 = (): boolean => {
    const errs = validateDevice(form);
    const step1Errors: DeviceErrors = {};
    if (errs.name) step1Errors.name = errs.name;
    if (errs.host) step1Errors.host = errs.host;
    setErrors(step1Errors);
    return Object.keys(step1Errors).length === 0;
  };

  const validateStep2 = (): boolean => {
    const errs = validateDevice(form);
    const step2Errors: DeviceErrors = {};
    if (errs.username) step2Errors.username = errs.username;
    if (errs.password) step2Errors.password = errs.password;
    setErrors(step2Errors);
    return Object.keys(step2Errors).length === 0;
  };

  const handleNextToStep2 = () => {
    if (validateStep1()) {
      setStep(2);
    }
  };

  const handleNextToStep3 = () => {
    if (validateStep2()) {
      setStep(3);
    }
  };

  const handleFinalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allErrors = validateDevice(form);
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      if (allErrors.name || allErrors.host) setStep(1);
      else if (allErrors.username || allErrors.password) setStep(2);
      return;
    }

    const res = mockTestConnection(form);
    setResult(res);
    if (!res.ok) return;

    const added: SetupDevice = {
      id: crypto.randomUUID(),
      kind: form.kind,
      name: form.name.trim(),
      host: form.host.trim(),
      status: "aktif",
      lastSeenAt: Math.floor(Date.now() / 1000),
    };
    setDevices((d) => [...d, added]);
    setLastAddedDevice(added);

    // Simpan ke PostgreSQL database
    if (form.kind === "router") {
      fetch("/api/routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          host: form.host.trim(),
          username: form.username.trim(),
          password: form.password,
          validateConnection: false,
        }),
      }).catch(() => null);
    } else if (form.kind === "olt") {
      fetch("/api/olts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          host: form.host.trim(),
          brand: "ZTE",
          driver: "c320",
          username: form.username.trim(),
          password: form.password,
        }),
      }).catch(() => null);
    }

    setForm(empty);
    setStep(1);
  };

  return (
    <div className="flex flex-col gap-6">
      {progress.pendingNotice && (
        <div
          role="status"
          data-testid="gate-pending-notice"
          className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <Badge variant="outline" className="mr-2">
            Gerbang belum lulus
          </Badge>
          {progress.pendingNotice}
        </div>
      )}
      {lastAddedDevice && (
        <div
          role="status"
          data-testid="new-device-summary"
          className="flex flex-col gap-3 rounded-xl border-2 border-success bg-success/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-semibold">Perangkat baru ditambahkan</p>
            <p>
              <span className="font-medium">{lastAddedDevice.name}</span>
              {" · "}
              {DEVICE_KIND_SHORT[lastAddedDevice.kind]}
              {" · "}
              <span className="font-mono text-xs">{lastAddedDevice.host}</span>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <Badge>Aktif</Badge>
              <span className="tabular-nums text-muted-foreground">
                Uji koneksi:{" "}
                {lastAddedDevice.lastSeenAt === null
                  ? "Belum pernah"
                  : formatSeen(lastAddedDevice.lastSeenAt)}
              </span>
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLastAddedDevice(null)}
          >
            Tutup
          </Button>
        </div>
      )}

      <section aria-label="Daftar perangkat" className="rounded-xl border">
        <Table data-testid="device-table">
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Terakhir terlihat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((d) => (
              <TableRow key={d.id} data-testid="device-row">
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>{DEVICE_KIND_SHORT[d.kind]}</TableCell>
                <TableCell className="font-mono text-xs">{d.host}</TableCell>
                <TableCell>
                  <Badge variant={d.status === "aktif" ? "default" : "outline"}>
                    {d.status === "aktif" ? "Aktif" : "Nonaktif"}
                  </Badge>
                </TableCell>
                <TableCell className="tabular-nums">
                  {d.lastSeenAt === null ? "Belum pernah" : formatSeen(d.lastSeenAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section
        aria-label="Wizard tambah perangkat"
        className="flex flex-col gap-5 rounded-xl border p-5"
      >
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Wizard Tambah Perangkat</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground sm:gap-4">
            <span
              className={`flex items-center gap-1 font-medium ${
                step === 1 ? "text-primary font-semibold" : ""
              }`}
            >
              <span className="flex size-5 items-center justify-center rounded-full border text-xs">
                1
              </span>
              Identitas
            </span>
            <span>&rarr;</span>
            <span
              className={`flex items-center gap-1 font-medium ${
                step === 2 ? "text-primary font-semibold" : ""
              }`}
            >
              <span className="flex size-5 items-center justify-center rounded-full border text-xs">
                2
              </span>
              Kredensial
            </span>
            <span>&rarr;</span>
            <span
              className={`flex items-center gap-1 font-medium ${
                step === 3 ? "text-primary font-semibold" : ""
              }`}
            >
              <span className="flex size-5 items-center justify-center rounded-full border text-xs">
                3
              </span>
              Uji &amp; Simpan
            </span>
          </div>
        </div>

        <form noValidate onSubmit={handleFinalSubmit} className="flex flex-col gap-4">
          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor={`${uid}-kind`}>Jenis Perangkat</Label>
                <select
                  id={`${uid}-kind`}
                  value={form.kind}
                  onChange={(e) => set("kind", e.target.value as DeviceKind)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  {DEVICE_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor={`${uid}-mode`}>Mode Perangkat</Label>
                <select
                  id={`${uid}-mode`}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as DeviceMode)}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="simulator">Mode Simulator</option>
                  <option value="asli">Perangkat Asli</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-name`}>Nama Perangkat</Label>
                <Input
                  id={`${uid}-name`}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="mis. RTR-Utara-01"
                  aria-invalid={errors.name ? true : undefined}
                />
                {errors.name && (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.name}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-host`}>Alamat Host / IP</Label>
                <Input
                  id={`${uid}-host`}
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  placeholder="mis. 10.10.0.1"
                  aria-invalid={errors.host ? true : undefined}
                />
                {errors.host && (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.host}
                  </p>
                )}
              </div>

              <div className="flex justify-end pt-2 sm:col-span-2">
                <Button type="button" onClick={handleNextToStep2}>
                  Lanjut ke Kredensial &rarr;
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-username`}>Username API / Login</Label>
                <Input
                  id={`${uid}-username`}
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                  placeholder="Username akses"
                  aria-invalid={errors.username ? true : undefined}
                  autoComplete="off"
                />
                {errors.username && (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.username}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${uid}-password`}>Password</Label>
                <Input
                  id={`${uid}-password`}
                  type="password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="Password akses"
                  aria-invalid={errors.password ? true : undefined}
                  autoComplete="off"
                />
                {errors.password && (
                  <p role="alert" className="text-sm text-destructive">
                    {errors.password}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  &larr; Kembali
                </Button>
                <Button type="button" onClick={handleNextToStep3}>
                  Lanjut ke Uji Koneksi &rarr;
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg bg-secondary/50 p-4 text-sm">
                <p className="font-semibold mb-2">Ringkasan Konfigurasi:</p>
                <ul className="space-y-1 text-muted-foreground">
                  <li>
                    Jenis:{" "}
                    <span className="font-medium text-foreground">
                      {DEVICE_KIND_OPTIONS.find((o) => o.value === form.kind)?.label}
                    </span>
                  </li>
                  <li>
                    Mode:{" "}
                    <span className="font-medium text-foreground">
                      {mode === "simulator" ? "Mode Simulator" : "Perangkat Asli"}
                    </span>
                  </li>
                  <li>
                    Nama:{" "}
                    <span className="font-medium text-foreground">{form.name}</span>
                  </li>
                  <li>
                    Host / IP:{" "}
                    <span className="font-medium text-foreground font-mono">
                      {form.host}
                    </span>
                  </li>
                  <li>
                    Username:{" "}
                    <span className="font-medium text-foreground">
                      {form.username}
                    </span>
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(2)}
                >
                  &larr; Kembali
                </Button>
                <Button type="submit">
                  Uji Koneksi &amp; Simpan Perangkat
                </Button>
              </div>
            </div>
          )}

          {result && (
            <section
              role="region"
              aria-label="Hasil Uji Koneksi"
              data-testid="connection-test-panel"
              className="flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={result.ok ? "default" : "destructive"}>
                  {result.ok ? "Koneksi Berhasil (HTTP 200)" : "Koneksi Gagal"}
                </Badge>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Protokol</dt>
                  <dd className="font-medium">{result.diagnostics.protocol}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Latensi</dt>
                  <dd className="font-medium tabular-nums">
                    {result.diagnostics.latencyMs} ms
                  </dd>
                </div>
                {result.ok && result.diagnostics.firmware && (
                  <div>
                    <dt className="text-muted-foreground">Versi Firmware/OS</dt>
                    <dd className="font-medium">{result.diagnostics.firmware}</dd>
                  </div>
                )}
                {result.ok && result.diagnostics.cpuLoad !== undefined && (
                  <div>
                    <dt className="text-muted-foreground">CPU Load</dt>
                    <dd className="font-medium tabular-nums">
                      {result.diagnostics.cpuLoad}%
                    </dd>
                  </div>
                )}
              </dl>
              <p
                role="status"
                data-testid="test-result"
                className={
                  result.ok
                    ? "text-sm text-success font-medium"
                    : "text-sm text-destructive font-medium"
                }
              >
                {result.ok
                  ? "Koneksi berhasil. Perangkat ditambahkan."
                  : result.reason}
              </p>
            </section>
          )}
        </form>
      </section>
    </div>
  );
}
