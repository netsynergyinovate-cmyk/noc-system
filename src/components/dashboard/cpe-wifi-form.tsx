"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  TriangleAlert,
  Wifi,
} from "lucide-react";

import { useCanDo } from "@/components/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  parseCpeWifiError,
  type CpeWifiErrorView,
} from "@/lib/dashboard/cpe-wifi-errors";
import { changeDeviceWifiSchema } from "@/validators/cpe";

type Errors = Partial<Record<"ssid" | "password", string>>;
type Outcome = { tone: "applied" | "queued"; message: string };

// WLAN utama (2.4GHz) modem; sama dengan yang dipakai jalur perubahan Wi-Fi lain di aplikasi.
const WLAN_INDEX = 1;

export function CpeWifiForm({
  deviceId,
  initialSsid,
  isOnline,
  offlineNote,
  onSuccess,
}: {
  /** Id modem di GenieACS; null = belum terdaftar (form tidak bisa dipakai). */
  deviceId: string | null;
  initialSsid: string;
  isOnline: boolean;
  /** Alasan yang ditampilkan saat modem offline (mis. waktu inform terakhir). */
  offlineNote?: string;
  onSuccess?: () => void;
}) {
  const canManage = useCanDo("manageCpe");
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [errorView, setErrorView] = useState<CpeWifiErrorView | null>(null);
  const [errorDetail, setErrorDetail] = useState("");

  const blockedReason = !canManage
    ? "Hanya admin yang dapat mengubah konfigurasi Wi-Fi."
    : !deviceId
      ? "Modem belum terdaftar di GenieACS."
      : !isOnline
        ? (offlineNote ?? "CPE sedang offline.")
        : "";
  const blocked = blockedReason !== "" || pending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    return submit();
  }

  // Dipakai juga oleh "Coba lagi": isian SSID/password tetap utuh.
  async function submit() {
    if (blocked || !deviceId) return;
    setOutcome(null);
    setErrorView(null);
    setErrorDetail("");

    // Hanya kolom yang benar-benar diubah yang dikirim.
    const candidate = {
      index: WLAN_INDEX,
      ...(ssid !== initialSsid ? { ssid } : {}),
      ...(password !== "" ? { password } : {}),
    };
    const parsed = changeDeviceWifiSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === "ssid" || key === "password") && !next[key])
          next[key] = issue.message;
        if (key === undefined && !next.ssid)
          next.ssid = "Ubah nama WiFi atau isi password baru dulu.";
      }
      setErrors(next);
      return;
    }
    setErrors({});

    setPending(true);
    try {
      // Jalur yang menulis ke parameter modem lalu membaca ulang untuk memastikan hasilnya.
      const res = await fetch(`/api/cpe/${encodeURIComponent(deviceId)}/wifi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body: {
        status?: string;
        message?: string;
        error?: { message?: string };
      } | null = await res.json().catch(() => null);
      if (res.ok) {
        setOutcome({
          tone: body?.status === "applied" ? "applied" : "queued",
          message:
            body?.message ??
            (body?.status === "applied"
              ? "Wi-Fi diubah dan terverifikasi di modem."
              : "Perintah masuk antrean GenieACS."),
        });
        setPassword("");
        onSuccess?.();
      } else {
        setErrorView(parseCpeWifiError(res.status, body));
        setErrorDetail(body?.error?.message ?? "");
      }
    } catch {
      setErrorView(parseCpeWifiError(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-4"
      data-testid="cpe-wifi-form"
    >
      <div className="space-y-2">
        <Label htmlFor="cpe-ssid" className="flex items-center gap-1.5">
          <Wifi className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Nama WiFi (SSID)
        </Label>
        <Input
          id="cpe-ssid"
          value={ssid}
          maxLength={32}
          onChange={(e) => setSsid(e.target.value)}
          aria-invalid={errors.ssid ? true : undefined}
          aria-describedby={errors.ssid ? "cpe-ssid-error" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          {ssid.length}/32 karakter
        </p>
        {errors.ssid && (
          <p
            id="cpe-ssid-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.ssid}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cpe-password" className="flex items-center gap-1.5">
          <KeyRound
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          Password baru
        </Label>
        <div className="flex gap-2">
          <Input
            id="cpe-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Kosongkan bila password tidak diganti"
            value={password}
            maxLength={64}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={
              errors.password ? "cpe-password-error" : undefined
            }
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Tampilkan kata sandi"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Perubahan nama atau password akan memutuskan koneksi perangkat yang
          sedang terhubung.
        </p>
        {errors.password && (
          <p
            id="cpe-password-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {errors.password}
          </p>
        )}
      </div>

      {outcome && (
        <div
          role="status"
          data-testid="cpe-wifi-outcome"
          data-tone={outcome.tone}
          className={`flex items-start gap-2 rounded-md p-3 text-sm ${outcome.tone === "applied" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
        >
          {outcome.tone === "applied" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Clock className="mt-0.5 size-4 shrink-0" />
          )}
          <div className="space-y-0.5">
            <p className="font-medium">
              {outcome.tone === "applied"
                ? "Berhasil dan terverifikasi di modem"
                : "Masuk antrean, belum dijalankan"}
            </p>
            <p>{outcome.message}</p>
          </div>
        </div>
      )}
      {errorView && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="cpe-wifi-error"
          data-code={errorView.code}
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">{errorView.title}</p>
            <p>{errorDetail || errorView.hint}</p>
            {errorView.canRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={pending}
                onClick={() => void submit()}
              >
                Coba lagi
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        {blockedReason && (
          <span className="text-xs text-muted-foreground">{blockedReason}</span>
        )}
        <Button type="submit" aria-disabled={blocked}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {pending ? "Mengirim…" : "Simpan"}
        </Button>
      </div>
    </form>
  );
}
