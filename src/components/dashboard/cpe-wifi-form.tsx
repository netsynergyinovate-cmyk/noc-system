"use client";

import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";

import { useCanDo } from "@/components/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseCpeWifiError, type CpeWifiErrorView } from "@/lib/dashboard/cpe-wifi-errors";
import { changeWifiSchema } from "@/validators/cpe";

type Errors = Partial<Record<"ssid" | "password", string>>;

export function CpeWifiForm({
  customerId,
  initialSsid,
  isOnline,
  onSuccess,
}: {
  customerId: string;
  initialSsid: string;
  isOnline: boolean;
  onSuccess?: () => void;
}) {
  const canManage = useCanDo("manageCpe");
  const [ssid, setSsid] = useState(initialSsid);
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<"WPA2-PSK" | "WPA3-SAE">("WPA2-PSK");
  const [enabled, setEnabled] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState("");
  const [errorView, setErrorView] = useState<CpeWifiErrorView | null>(null);

  const blockedReason = !canManage
    ? "Hanya admin yang dapat mengubah konfigurasi Wi-Fi."
    : !isOnline
      ? "CPE sedang offline."
      : "";
  const blocked = blockedReason !== "" || pending;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    return submit();
  }

  // Dipakai juga oleh "Coba lagi": isian SSID/password tetap utuh.
  async function submit() {
    if (blocked) return;
    setSuccess("");
    setErrorView(null);

    const parsed = changeWifiSchema.safeParse({ customerId, ssid, password, security, enabled });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === "ssid" || key === "password") && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});

    setPending(true);
    try {
      // Body datar sesuai changeWifiSchema yang divalidasi route /api/cpe/tasks.
      const res = await fetch("/api/cpe/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 202) {
        setSuccess("Perintah perubahan Wi-Fi masuk antrean (diproses dalam 1-2 menit).");
        setPassword("");
        onSuccess?.();
      } else {
        const body = await res.json().catch(() => null);
        setErrorView(parseCpeWifiError(res.status, body));
      }
    } catch {
      setErrorView(parseCpeWifiError(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" data-testid="cpe-wifi-form">
      <div className="space-y-2">
        <Label htmlFor="cpe-ssid">Nama WiFi (SSID)</Label>
        <Input
          id="cpe-ssid"
          value={ssid}
          maxLength={32}
          onChange={(e) => setSsid(e.target.value)}
          aria-invalid={errors.ssid ? true : undefined}
          aria-describedby={errors.ssid ? "cpe-ssid-error" : undefined}
        />
        <p className="text-xs text-muted-foreground">{ssid.length}/32 karakter</p>
        {errors.ssid && (
          <p id="cpe-ssid-error" role="alert" className="text-sm text-destructive">
            {errors.ssid}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="cpe-password">Password WiFi</Label>
        <div className="flex gap-2">
          <Input
            id="cpe-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Minimal 8 karakter"
            value={password}
            maxLength={64}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "cpe-password-error" : undefined}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Tampilkan kata sandi"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Perubahan password akan memutuskan koneksi perangkat yang sedang terhubung.
        </p>
        {errors.password && (
          <p id="cpe-password-error" role="alert" className="text-sm text-destructive">
            {errors.password}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cpe-security">Mode keamanan</Label>
          <select
            id="cpe-security"
            value={security}
            onChange={(e) => setSecurity(e.target.value as "WPA2-PSK" | "WPA3-SAE")}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="WPA2-PSK">WPA2-PSK</option>
            <option value="WPA3-SAE">WPA3-SAE</option>
          </select>
        </div>
        <div className="flex items-end gap-2 pb-2">
          <input
            id="cpe-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4"
          />
          <Label htmlFor="cpe-enabled">Radio Wi-Fi aktif</Label>
        </div>
      </div>

      {success && (
        <div role="status" className="flex items-start gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>{success}</p>
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
            <p>{errorView.hint}</p>
            {errorView.canRetry && (
              <Button type="button" variant="outline" size="sm" aria-disabled={pending} onClick={() => void submit()}>
                Coba lagi
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        {blockedReason && <span className="text-xs text-muted-foreground">{blockedReason}</span>}
        <Button type="submit" aria-disabled={blocked}>
          {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
          {pending ? "Mengirim…" : "Simpan"}
        </Button>
      </div>
    </form>
  );
}
