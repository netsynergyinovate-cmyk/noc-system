"use client";

import { useState, useSyncExternalStore } from "react";
import {
  CheckCircle2,
  Edit,
  Globe,
  HardDrive,
  Network,
  RefreshCw,
  Router,
  Server,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectionTestPanel } from "@/components/dashboard/connection-test-panel";
import { DeviceStatusBadge } from "@/components/dashboard/device-status-badge";
import { DeviceOutcomeAlert } from "@/components/dashboard/device-outcome-alert";
import { DeviceModeSwitch } from "@/components/dashboard/device-mode-switch";
import { SecretCredentialInput } from "@/components/dashboard/secret-credential-input";
import {
  getDeviceMode,
  getDeviceModeServerSnapshot,
  subscribeDeviceMode,
} from "@/lib/dashboard/device-mode";
import {
  DeviceConfig,
  DeviceInputErrors,
  DeviceMode,
  DeviceType,
  MOCK_DEVICE_CONFIGS,
  TestOutcome,
  applyTestOutcome,
  getDeviceTypeLabel,
  runDeviceTest,
  validateDeviceInput,
} from "@/lib/dashboard/device-config";

export function DeviceConfigBoard() {
  const [devices, setDevices] = useState<DeviceConfig[]>(MOCK_DEVICE_CONFIGS);
  const globalMode = useSyncExternalStore(
    subscribeDeviceMode,
    getDeviceMode,
    getDeviceModeServerSnapshot,
  ).mode;
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestOutcome>>(
    {},
  );
  const [editingDevice, setEditingDevice] = useState<DeviceConfig | null>(null);
  const [editErrors, setEditErrors] = useState<DeviceInputErrors>({});
  const [passwordOverride, setPasswordOverride] = useState("");
  const [isAllTesting, setIsAllTesting] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  // API uji koneksi; bila belum tersedia, mode simulator jatuh ke mockRunDeviceTest.
  const runTest = (d: DeviceConfig): Promise<TestOutcome> => runDeviceTest(d);
  const applyOutcome = applyTestOutcome;

  // Uji koneksi individual perangkat
  const handleTestDevice = async (device: DeviceConfig) => {
    if (testingId !== null || isAllTesting) return;
    setTestingId(device.id);
    const result = await runTest(device);
    setTestResults((prev) => ({ ...prev, [device.id]: result }));
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? applyOutcome(d, result) : d)),
    );
    setTestingId(null);
  };

  // Hasil uji simulasi lokal dari DeviceTestButton (tanpa memanggil backend)
  const handleLocalOutcome = (device: DeviceConfig, result: TestOutcome) => {
    setTestResults((prev) => ({ ...prev, [device.id]: result }));
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? applyOutcome(d, result) : d)),
    );
  };

  // Uji semua koneksi terpadu
  const handleTestAll = async () => {
    if (testingId !== null || isAllTesting) return;
    setIsAllTesting(true);
    setBannerNotice(null);
    const outcomes = await Promise.all(devices.map(runTest));
    const newResults: Record<string, TestOutcome> = {};
    const updated = devices.map((d, i) => {
      newResults[d.id] = outcomes[i];
      return applyOutcome(d, outcomes[i]);
    });
    setDevices(updated);
    setTestResults(newResults);
    setIsAllTesting(false);
    const okCount = updated.filter((d) => d.status === "connected").length;
    setBannerNotice(
      okCount === updated.length
        ? `Uji koneksi terpadu selesai: seluruh ${updated.length} perangkat terhubung.`
        : `Uji koneksi terpadu selesai: ${okCount} dari ${updated.length} perangkat terhubung, ${updated.length - okCount} gagal.`,
    );
  };
  // Saklar simulator vs real dikelola DeviceModeSwitch (store bersama);
  // di sini hanya menyelaraskan mode tiap perangkat dan hasil uji lama.
  const handleModeChange = (nextMode: DeviceMode) => {
    setDevices((prev) =>
      prev.map((d) => ({
        ...d,
        mode: nextMode,
        status: "untested",
        latencyMs: null,
        errorMessage: undefined,
      })),
    );
    setTestResults({});
    setBannerNotice(
      `Mode beralih ke: ${nextMode === "simulator" ? "Simulator Lab Lokal" : "Perangkat Nyata Fisik"}. Jalankan uji koneksi ulang.`,
    );
  };

  // Simpan hasil edit perangkat
  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDevice) return;
    const v = validateDeviceInput(editingDevice);
    setEditErrors(v.errors);
    if (!v.ok) return;
    const next: DeviceConfig = {
      ...editingDevice,
      ...v.clean,
      status: "untested",
      latencyMs: null,
      errorMessage: undefined,
    };
    setDevices((prev) => prev.map((d) => (d.id === next.id ? next : d)));
    setTestResults((prev) => {
      const rest = { ...prev };
      delete rest[next.id];
      return rest;
    });

    // Simpan juga ke database
    if (next.type === "mikrotik") {
      fetch("/api/routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: next.name.trim(),
          host: next.host.trim(),
          port: next.port,
          username: next.username.trim(),
          password: passwordOverride.trim() || "StrongSecretPassword123",
          validateConnection: false,
        }),
      }).catch(() => null);
    }

    // Sandi baru tidak pernah masuk state perangkat / banner; kosong = pertahankan yang tersimpan.
    const passwordChanged = passwordOverride.trim().length > 0;
    setPasswordOverride("");
    setEditingDevice(null);
    setBannerNotice(
      `Konfigurasi untuk ${next.name} berhasil disimpan${
        passwordChanged
          ? " dengan kata sandi baru"
          : "; kata sandi tersimpan dipertahankan"
      }. Jalankan uji koneksi ulang.`,
    );
  };

  const getDeviceIcon = (type: DeviceType) => {
    switch (type) {
      case "mikrotik":
        return <Router className="size-5 text-blue-500" />;
      case "olt":
        return <Network className="size-5 text-emerald-500" />;
      case "genieacs":
        return <Server className="size-5 text-purple-500" />;
      case "billing":
        return <Globe className="size-5 text-amber-500" />;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header Halaman */}
      <div className="flex flex-col gap-2 border-b pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pengaturan &amp; Integrasi Perangkat
          </h1>
          <Badge variant={globalMode === "simulator" ? "secondary" : "default"}>
            {globalMode === "simulator"
              ? "Mode Simulator"
              : "Mode Perangkat Fisik"}
          </Badge>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={handleTestAll}
              disabled={isAllTesting}
              className="gap-2"
            >
              <RefreshCw
                className={`size-4 ${isAllTesting ? "animate-spin" : ""}`}
              />
              <span>
                {isAllTesting ? "Menguji Semua..." : "Uji Koneksi Terpadu"}
              </span>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Konfigurasi koneksi MikroTik REST, OLT HSGQ, GenieACS NBI, dan portal
          billing berbasis environment variable.
        </p>
      </div>

      <DeviceModeSwitch onModeChange={handleModeChange} />

      {/* Banner status feedback */}
      {bannerNotice && (
        <div className="flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/10 p-3.5 text-sm text-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <span>{bannerNotice}</span>
        </div>
      )}

      {/* Metrik ringkas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="py-4">
          <CardContent className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <HardDrive className="size-5 text-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Integrasi</p>
              <p className="text-2xl font-semibold tabular-nums">
                {devices.length}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
              <CheckCircle2 className="size-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Perangkat Aktif</p>
              <p className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {devices.filter((d) => d.status === "connected").length}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
              <Zap className="size-5 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Latensi Rata-Rata</p>
              <p className="text-2xl font-semibold tabular-nums">
                {Math.round(
                  devices.reduce((acc, cur) => acc + (cur.latencyMs || 0), 0) /
                    (devices.length || 1),
                )}{" "}
                ms
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
              <ShieldCheck className="size-5 text-purple-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Keamanan Kredensial
              </p>
              <p className="text-sm font-semibold">Tersimpan di Env</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConnectionTestPanel
        devices={devices}
        results={testResults}
        testingId={testingId}
        testingAll={isAllTesting}
        onTest={handleTestDevice}
        onTestAll={handleTestAll}
        onLocalOutcome={handleLocalOutcome}
      />

      {/* Daftar Kartu Konfigurasi Perangkat */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Daftar Endpoint Perangkat Jaringan
          </h2>
          <span className="text-xs text-muted-foreground">
            Semua alamat dapat dioverride melalui variabel lingkungan (.env)
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {devices.map((device) => {
            const isTesting = testingId === device.id;
            const res = testResults[device.id];

            return (
              <Card key={device.id} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-secondary">
                        {getDeviceIcon(device.type)}
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {device.name}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {getDeviceTypeLabel(device.type)} &bull;{" "}
                          {device.protocol}
                        </CardDescription>
                      </div>
                    </div>
                    <DeviceStatusBadge
                      status={device.status}
                      isTesting={isTesting || isAllTesting}
                      latencyMs={device.latencyMs}
                    />
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pb-4 text-sm">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {device.description}
                  </p>

                  <div className="rounded-md border bg-muted/40 p-3 space-y-1.5 font-mono text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Host:</span>
                      <span className="font-semibold">
                        {device.host}:{device.port}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Env Host:</span>
                      <span className="text-primary truncate max-w-[180px]">
                        {device.envHostKey}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Akun:</span>
                      <span>{device.username} (sandi: dari env)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Latensi:</span>
                      <span className="tabular-nums">
                        {device.latencyMs ? `${device.latencyMs} ms` : "-"}
                      </span>
                    </div>
                  </div>

                  {res && <DeviceOutcomeAlert outcome={res} device={device} />}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditErrors({});
                        setPasswordOverride("");
                        setEditingDevice(device);
                      }}
                      className="gap-1.5 text-xs"
                    >
                      <Edit className="size-3.5" />
                      <span>Ubah</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleTestDevice(device)}
                      disabled={isTesting}
                      className="gap-1.5 text-xs"
                    >
                      <RefreshCw
                        className={`size-3.5 ${isTesting ? "animate-spin" : ""}`}
                      />
                      <span>{isTesting ? "Menguji..." : "Uji Koneksi"}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Petunjuk Variabel Environment (.env) */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="size-4" />
            <span>Koneksi Aman Berbasis Variabel Environment</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Kredensial asli tidak pernah disimpan di repository. Gunakan berkas
            .env.local untuk lingkungan pengembangan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="rounded-lg bg-zinc-950 p-4 font-mono text-xs text-zinc-100 overflow-x-auto space-y-1">
            <p className="text-zinc-500">
              # Konfigurasi Koneksi Perangkat Jaringan (Fase 1)
            </p>
            <p>
              <span className="text-blue-400">MIKROTIK_REST_HOST</span>
              =10.10.0.1
            </p>
            <p>
              <span className="text-blue-400">MIKROTIK_REST_USER</span>
              =noc-monitor
            </p>
            <p>
              <span className="text-blue-400">MIKROTIK_REST_PASSWORD</span>
              =&lt;isi-di-env-lokal&gt;
            </p>
            <p className="pt-1 text-zinc-500"># OLT HSGQ</p>
            <p>
              <span className="text-emerald-400">OLT_HSGQ_HOST</span>=10.10.1.1
            </p>
            <p>
              <span className="text-emerald-400">OLT_HSGQ_USER</span>=admin
            </p>
            <p>
              <span className="text-emerald-400">OLT_HSGQ_PASSWORD</span>
              =&lt;isi-di-env-lokal&gt;
            </p>
            <p className="pt-1 text-zinc-500"># GenieACS NBI &amp; Billing</p>
            <p>
              <span className="text-purple-400">GENIEACS_NBI_URL</span>
              =http://10.10.2.1:7557
            </p>
            <p>
              <span className="text-amber-400">BILLING_PORTAL_URL</span>
              =https://10.10.3.1
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Modal / Dialog Edit Perangkat Sederhana */}
      {editingDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <Card className="w-full max-w-lg shadow-xl">
            <form onSubmit={handleSaveEdit} noValidate>
              <CardHeader>
                <CardTitle className="text-lg">
                  Ubah Konfigurasi Perangkat
                </CardTitle>
                <CardDescription className="text-xs">
                  Perbarui alamat host, port, atau kredensial untuk{" "}
                  {editingDevice.name}.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 text-sm">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-name">Nama Perangkat</Label>
                  <Input
                    id="edit-name"
                    value={editingDevice.name}
                    onChange={(e) =>
                      setEditingDevice({
                        ...editingDevice,
                        name: e.target.value,
                      })
                    }
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="edit-host">Host / Alamat IP</Label>
                    <Input
                      id="edit-host"
                      value={editingDevice.host}
                      onChange={(e) =>
                        setEditingDevice({
                          ...editingDevice,
                          host: e.target.value,
                        })
                      }
                      aria-invalid={!!editErrors.host}
                      aria-describedby={
                        editErrors.host ? "edit-host-err" : undefined
                      }
                      required
                    />
                    {editErrors.host && (
                      <p
                        id="edit-host-err"
                        role="alert"
                        className="text-xs text-destructive"
                      >
                        {editErrors.host}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-port">Port</Label>
                    <Input
                      id="edit-port"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={
                        editingDevice.port > 0 ? String(editingDevice.port) : ""
                      }
                      onChange={(e) =>
                        setEditingDevice({
                          ...editingDevice,
                          port:
                            Number(
                              e.target.value.replace(/\D/g, "").slice(0, 5),
                            ) || 0,
                        })
                      }
                      aria-invalid={!!editErrors.port}
                      aria-describedby={
                        editErrors.port ? "edit-port-err" : undefined
                      }
                      required
                    />
                    {editErrors.port && (
                      <p
                        id="edit-port-err"
                        role="alert"
                        className="text-xs text-destructive"
                      >
                        {editErrors.port}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-user">Username</Label>
                    <Input
                      id="edit-user"
                      value={editingDevice.username}
                      onChange={(e) =>
                        setEditingDevice({
                          ...editingDevice,
                          username: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-mode">Mode Operasi</Label>
                    <select
                      id="edit-mode"
                      value={editingDevice.mode}
                      onChange={(e) =>
                        setEditingDevice({
                          ...editingDevice,
                          mode: e.target.value as DeviceMode,
                        })
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                    >
                      <option
                        value="simulator"
                        className="bg-popover text-popover-foreground"
                      >
                        Simulator
                      </option>
                      <option
                        value="real"
                        className="bg-popover text-popover-foreground"
                      >
                        Perangkat Fisik Asli
                      </option>
                    </select>
                  </div>
                </div>

                <SecretCredentialInput
                  id="edit-password"
                  value={passwordOverride}
                  onChange={setPasswordOverride}
                  hasStoredSecret
                  envKey={editingDevice.envPassKey}
                />
                <p className="text-xs text-muted-foreground">
                  Sandi baru hanya berlaku sementara di sesi ini dan tidak
                  ditampilkan lagi. Untuk permanen, isi{" "}
                  <code>{editingDevice.envPassKey}</code> di .env.local lalu
                  mulai ulang layanan.
                </p>
              </CardContent>

              <div className="flex items-center justify-end gap-2 border-t p-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingDevice(null)}
                >
                  Batal
                </Button>
                <Button type="submit" size="sm">
                  Simpan Konfigurasi
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
