"use client";

import { useState } from "react";
import {
  Router,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Lock,
  Server,
  Activity,
  Cpu,
  Clock,
  HardDrive,
  Sparkles,
} from "lucide-react";
import {
  DEFAULT_ONBOARDING_MIKROTIK,
  defaultRestPort,
  splitHostInput,
  validateOnboardingMikrotikInput,
  type OnboardingMikrotikInput,
  type OnboardingMikrotikTestResult,
} from "@/lib/dashboard/onboarding-mikrotik";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { RouterSetupGuide } from "@/components/dashboard/router-setup-guide";

interface OnboardingMikrotikFormProps {
  onSuccess?: () => void;
}

export function OnboardingMikrotikForm({ onSuccess }: OnboardingMikrotikFormProps) {
  const [form, setForm] = useState<OnboardingMikrotikInput>({
    ...DEFAULT_ONBOARDING_MIKROTIK,
    name: "",
    host: "",
    username: "",
    mode: "real",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<OnboardingMikrotikTestResult | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const handleFieldChange = (field: keyof OnboardingMikrotikInput, value: unknown) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setTestResult(null);
  };

  // Isian ala "203.0.113.10:2024" atau "https://host" dipecah saat keluar dari kolom host
  // (bukan saat mengetik, supaya "…:2" tidak langsung memotong "2024").
  const normalizeHostField = () => {
    const parsed = splitHostInput(form.host);
    if (parsed.host === form.host.trim() && parsed.port === undefined && parsed.useTls === undefined) return;
    setForm((prev) => ({
      ...prev,
      host: parsed.host,
      ...(parsed.port !== undefined && { port: parsed.port }),
      ...(parsed.useTls !== undefined && { useTls: parsed.useTls }),
    }));
    setTestResult(null);
  };

  // Host dan port final: skema/port di kolom host menang; port kosong = bawaan layanan.
  const resolveTarget = () => {
    const parsed = splitHostInput(form.host);
    const useTls = parsed.useTls ?? form.useTls;
    return {
      host: parsed.host,
      useTls,
      port: parsed.port ?? (form.port > 0 ? form.port : defaultRestPort(useTls)),
    };
  };

  const handleRunTest = async () => {
    const target = resolveTarget();
    const payload = { ...form, ...target };

    const val = validateOnboardingMikrotikInput(payload);
    if (!val.valid) {
      setErrors(val.errors);
      return;
    }

    setTesting(true);
    setTestResult(null);
    setSavedNotice(null);

    try {
      const res = await fetch("/api/onboarding/mikrotik", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.data) {
        setTestResult(json.data);
      } else {
        // Jangan pernah pura-pura berhasil: tampilkan alasan sebenarnya.
        setTestResult({
          ok: false,
          latencyMs: 0,
          testedAt: new Date().toISOString(),
          message:
            json?.error?.message ??
            (res.status === 403
              ? "Akun Anda tidak memiliki izin menguji router (butuh peran admin)."
              : "Server aplikasi menolak permintaan uji koneksi."),
        });
      }
    } catch {
      setTestResult({
        ok: false,
        latencyMs: 0,
        testedAt: new Date().toISOString(),
        message: "Server aplikasi tidak menjawab permintaan uji. Periksa koneksi lalu coba lagi.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndConfirm = async () => {
    if (!testResult?.ok || saving) return;
    setSaving(true);
    setSavedNotice(null);

    const { host: cleanHost, port: cleanPort, useTls } = resolveTarget();

    try {
      const res = await fetch("/api/routers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim() || "Router Core",
          host: cleanHost,
          port: cleanPort,
          username: form.username.trim(),
          password: form.password,
          useSsl: useTls,
          mode: form.mode,
          // Tombol simpan hanya muncul setelah uji sukses; server menguji ulang dan
          // mengisi last_seen_at, yang dibaca gerbang onboarding sebagai "terverifikasi".
          validateConnection: true,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        setErrors((prev) => ({
          ...prev,
          save: errJson?.error?.message || "Gagal menyimpan router ke database.",
        }));
        setSaving(false);
        return;
      }

      setSavedNotice("Konfigurasi Router tersimpan di database! Mengalihkan ke dasbor...");
      if (onSuccess) {
        onSuccess();
      }
      setTimeout(() => {
        window.location.href = "/app";
      }, 1000);
    } catch {
      setErrors((prev) => ({
        ...prev,
        save: "Terjadi kesalahan jaringan saat menyimpan konfigurasi router.",
      }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-testid="onboarding-mikrotik-form"
      className="flex flex-col gap-5 rounded-2xl border bg-card p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Router className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Form Konfigurasi & Uji Koneksi Router MikroTik
            </h3>
            <p className="text-xs text-muted-foreground">
              Langkah gerbang wajib (Fase 1 / 6): Daftarkan REST API RouterOS v7 sebelum membuka modul lain.
            </p>
          </div>
        </div>

        {form.mode === "simulator" && (
          <MockDataNotice source="simulator REST v7 MikroTik" />
        )}
      </div>

      {savedNotice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{savedNotice}</span>
        </div>
      )}
      <RouterSetupGuide
        host={form.host}
        port={form.port > 0 ? String(form.port) : ""}
        onUseRouter={(address, restPort, tls) => {
          handleFieldChange("host", address);
          handleFieldChange("useTls", tls === true);
          if (restPort) handleFieldChange("port", restPort);
        }}
      />

      {/* Field Isian Form */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Nama Router */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-semibold text-foreground">
            Nama Router Identifikasi
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleFieldChange("name", e.target.value)}
            placeholder="Nama Router"
            className="rounded-lg border bg-background px-3 py-2 text-xs text-foreground shadow-xs transition-colors focus:border-primary focus:outline-hidden"
          />
          {errors.name && (
            <span className="text-[11px] font-medium text-destructive">
              {errors.name}
            </span>
          )}
        </div>

        {/* IP Host / Domain */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">
            IP Host / Domain REST API
          </label>
          <input
            type="text"
            value={form.host}
            onChange={(e) => handleFieldChange("host", e.target.value)}
            onBlur={normalizeHostField}
            placeholder="IP atau Domain"
            className="rounded-lg border bg-background px-3 py-2 text-xs text-foreground shadow-xs transition-colors focus:border-primary focus:outline-hidden"
          />
          {errors.host && (
            <span className="text-[11px] font-medium text-destructive">
              {errors.host}
            </span>
          )}
        </div>

        {/* Port REST */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">
            Port REST (www 80 / www-ssl 443, kosong = bawaan)
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={form.port > 0 ? String(form.port) : ""}
            onChange={(e) =>
              handleFieldChange("port", Number(e.target.value.replace(/\D/g, "").slice(0, 5)) || 0)
            }
            placeholder={String(defaultRestPort(form.useTls))}
            className="rounded-lg border bg-background px-3 py-2 text-xs text-foreground shadow-xs transition-colors focus:border-primary focus:outline-hidden"
          />
          {errors.port && (
            <span className="text-[11px] font-medium text-destructive">
              {errors.port}
            </span>
          )}
        </div>

        {/* Username */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">
            Username REST API
          </label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => handleFieldChange("username", e.target.value)}
            placeholder="Username"
            className="rounded-lg border bg-background px-3 py-2 text-xs text-foreground shadow-xs transition-colors focus:border-primary focus:outline-hidden"
          />
          {errors.username && (
            <span className="text-[11px] font-medium text-destructive">
              {errors.username}
            </span>
          )}
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-foreground">
            Password REST API (Tersimpan Terenkripsi)
          </label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => handleFieldChange("password", e.target.value)}
            placeholder="••••••••••••"
            className="rounded-lg border bg-background px-3 py-2 text-xs text-foreground shadow-xs transition-colors focus:border-primary focus:outline-hidden"
          />
        </div>
      </div>

      {/* Opsi TLS & Mode */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-secondary/30 p-3 text-xs">
        <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground">
          <input
            type="checkbox"
            checked={form.useTls}
            onChange={(e) => handleFieldChange("useTls", e.target.checked)}
            className="rounded border-muted text-primary focus:ring-primary"
          />
          <span>Gunakan Enkripsi TLS / HTTPS (Disarankan untuk RouterOS v7)</span>
        </label>

        <div className="flex items-center gap-2">
          <span className="font-medium text-muted-foreground">Mode:</span>
          <select
            value={form.mode}
            onChange={(e) =>
              handleFieldChange("mode", e.target.value as "real" | "simulator")
            }
            className="rounded border bg-background px-2 py-1 text-xs font-medium text-foreground"
          >
            <option value="real">Perangkat Nyata (Koneksi Langsung)</option>
            <option value="simulator">Simulator (Uji Lokal)</option>
          </select>
        </div>
      </div>

      {/* Tombol Uji Koneksi */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRunTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {testing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Menguji Sambungan ke MikroTik...</span>
            </>
          ) : (
            <>
              <Server className="h-4 w-4" />
              <span>Jalankan Uji Koneksi MikroTik</span>
            </>
          )}
        </button>
      </div>

      {/* Hasil Uji Koneksi */}
      {testResult && (
        <div
          data-testid="onboarding-mikrotik-test-result"
          className={`flex flex-col gap-3 rounded-xl border p-4 text-xs ${
            testResult.ok
              ? "border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/50 dark:bg-emerald-950/20"
              : "border-destructive/30 bg-destructive/10"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              )}
              <span className="font-semibold text-foreground">
                {testResult.ok ? "Uji Koneksi Berhasil" : "Uji Koneksi Gagal"}
              </span>
            </div>
            {testResult.ok && (
              <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                Latensi: {testResult.latencyMs} ms
              </span>
            )}
          </div>

          <p className="text-muted-foreground">{testResult.message}</p>

          {testResult.details && (
            <div className="grid grid-cols-2 gap-2.5 rounded-lg border bg-background/60 p-3 sm:grid-cols-4">
              <div className="flex flex-col">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Activity className="h-3 w-3" /> Versi RouterOS
                </span>
                <span className="font-semibold text-foreground">
                  {testResult.details.version}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Server className="h-3 w-3" /> Board Hardware
                </span>
                <span className="font-semibold text-foreground">
                  {testResult.details.boardName}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Cpu className="h-3 w-3" /> Beban CPU
                </span>
                <span className="font-semibold text-foreground">
                  {testResult.details.cpuLoad}%
                </span>
              </div>
              <div className="flex flex-col">
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" /> Uptime Perangkat
                </span>
                <span className="font-semibold text-foreground">
                  {testResult.details.uptime}
                </span>
              </div>
            </div>
          )}

          {testResult.errors && testResult.errors.length > 0 && (
            <div className="mt-1 flex flex-col gap-1 text-destructive">
              {testResult.errors.map((err) => (
                <span key={err}>• {err}</span>
              ))}
            </div>
          )}


          {testResult.ok && (
            <div className="mt-2 flex items-center justify-end border-t pt-3">
              <button
                type="button"
                onClick={handleSaveAndConfirm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Simpan & Buka Gerbang Wajib Onboarding</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
