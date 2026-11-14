"use client";

import { useState, type FormEvent } from "react";
import { Settings } from "lucide-react";
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

// Bentuk jawaban GET/PUT /api/ont-web/settings (tanpa kata sandi).
export type OntWebSettings = {
  configured: boolean;
  acsUrl: string;
  acsUsername: string;
  hasAcsPassword: boolean;
  informInterval: number;
  webUsername: string;
  hasWebPassword: boolean;
  zimlinkUsername: string;
  hasZimlinkPassword: boolean;
  ggclinkUsername: string;
  hasGgclinkPassword: boolean;
  f609Username: string;
  hasF609Password: boolean;
};

type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

export function OntWebSettingsPanel({
  settings,
  onSaved,
  standalone = false,
}: {
  settings: OntWebSettings;
  onSaved: (next: OntWebSettings) => void;
  // true: formulir saja (di dialog Pengaturan), tanpa lipatan <details>.
  standalone?: boolean;
}) {
  const [acsUrl, setAcsUrl] = useState(settings.acsUrl);
  const [interval, setIntervalText] = useState(String(settings.informInterval));
  // Bawaan GenieACS: admin/admin (terisi otomatis sampai disimpan).
  const [acsUser, setAcsUser] = useState(
    settings.configured ? settings.acsUsername : "admin",
  );
  const [acsPass, setAcsPass] = useState(settings.configured ? "" : "admin");
  const [webUser, setWebUser] = useState(settings.webUsername);
  const [webPass, setWebPass] = useState("");
  const [zlUser, setZlUser] = useState(settings.zimlinkUsername);
  const [zlPass, setZlPass] = useState("");
  const [ggUser, setGgUser] = useState(settings.ggclinkUsername);
  const [ggPass, setGgPass] = useState("");
  const [f6User, setF6User] = useState(settings.f609Username);
  const [f6Pass, setF6Pass] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const saving = phase.kind === "saving";

  const seconds = /^\d{1,6}$/.test(interval.trim()) ? Number(interval) : NaN;
  const intervalOk =
    Number.isInteger(seconds) && seconds >= 30 && seconds <= 86400;
  const urlOk = /^https?:\/\/[^\s/@]+(?::\d{1,5})?(?:\/\S*)?$/i.test(
    acsUrl.trim(),
  );
  const valid = urlOk && intervalOk;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    // Klik yang ditolak harus terlihat: placeholder abu-abu mudah dikira sudah terisi.
    if (!valid) {
      setPhase({
        kind: "failed",
        message: !urlOk
          ? "Isi Alamat ACS lengkap, mis. http://172.16.0.1:7547 (teks abu-abu hanya contoh)."
          : "Interval lapor harus 30–86400 detik.",
      });
      return;
    }
    setPhase({ kind: "saving" });
    try {
      const res = await fetch("/api/ont-web/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acsUrl: acsUrl.trim(),
          informInterval: seconds,
          acsUsername: acsUser.trim(),
          webUsername: webUser.trim(),
          zimlinkUsername: zlUser.trim(),
          ggclinkUsername: ggUser.trim(),
          f609Username: f6User.trim(),
          // Kata sandi hanya dikirim bila diketik; kosong = biarkan yang tersimpan.
          ...(acsPass ? { acsPassword: acsPass } : {}),
          ...(webPass ? { webPassword: webPass } : {}),
          ...(zlPass ? { zimlinkPassword: zlPass } : {}),
          ...(ggPass ? { ggclinkPassword: ggPass } : {}),
          ...(f6Pass ? { f609Password: f6Pass } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        (OntWebSettings & { error?: { message?: string } }) | null;
      if (res.ok && json && typeof json.acsUrl === "string") {
        setAcsPass("");
        setWebPass("");
        setZlPass("");
        setGgPass("");
        setF6Pass("");
        setPhase({ kind: "saved" });
        onSaved(json);
      } else {
        setPhase({
          kind: "failed",
          message: json?.error?.message ?? "Gagal menyimpan pengaturan.",
        });
      }
    } catch {
      setPhase({
        kind: "failed",
        message: "Server aplikasi tidak terjangkau.",
      });
    }
  }

  const form = (
    <form
      onSubmit={save}
      noValidate
      className={standalone ? "space-y-3 text-sm" : "mt-3 space-y-3"}
    >
      {!standalone && (
        <p className="text-xs text-muted-foreground">
          Disimpan di database (kata sandi terenkripsi) dan dipakai untuk semua
          modem.
        </p>
      )}
      <fieldset disabled={saving} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ont-set-acs">Alamat ACS yang dipakai modem</Label>
          <Input
            id="ont-set-acs"
            autoComplete="off"
            placeholder="http://172.16.0.1:7547"
            value={acsUrl}
            aria-invalid={acsUrl !== "" && !urlOk}
            onChange={(e) => setAcsUrl(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-interval">Interval lapor (detik)</Label>
          <Input
            id="ont-set-interval"
            inputMode="numeric"
            value={interval}
            aria-invalid={!intervalOk}
            onChange={(e) => setIntervalText(e.target.value)}
          />
        </div>
        <div />
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-acs-user">Nama pengguna ACS (opsional)</Label>
          <Input
            id="ont-set-acs-user"
            autoComplete="off"
            value={acsUser}
            onChange={(e) => setAcsUser(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-acs-pass">Kata sandi ACS (opsional)</Label>
          <Input
            id="ont-set-acs-pass"
            type="password"
            autoComplete="new-password"
            placeholder={
              settings.hasAcsPassword ? "tersimpan; ketik untuk mengganti" : ""
            }
            value={acsPass}
            onChange={(e) => setAcsPass(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-web-user">
            Admin web C-Data FD511GW: nama pengguna
          </Label>
          <Input
            id="ont-set-web-user"
            autoComplete="off"
            value={webUser}
            onChange={(e) => setWebUser(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-web-pass">
            Admin web C-Data FD511GW: kata sandi
          </Label>
          <Input
            id="ont-set-web-pass"
            type="password"
            autoComplete="new-password"
            placeholder={
              settings.hasWebPassword ? "tersimpan; ketik untuk mengganti" : ""
            }
            value={webPass}
            onChange={(e) => setWebPass(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-zl-user">
            Admin web ZIMLINK (H113): nama pengguna
          </Label>
          <Input
            id="ont-set-zl-user"
            autoComplete="off"
            value={zlUser}
            onChange={(e) => setZlUser(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-zl-pass">
            Admin web ZIMLINK (H113): kata sandi
          </Label>
          <Input
            id="ont-set-zl-pass"
            type="password"
            autoComplete="new-password"
            placeholder={
              settings.hasZimlinkPassword
                ? "tersimpan; ketik untuk mengganti"
                : ""
            }
            value={zlPass}
            onChange={(e) => setZlPass(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-gg-user">
            Admin web GGCLink (ZICG GM22): nama pengguna
          </Label>
          <Input
            id="ont-set-gg-user"
            autoComplete="off"
            value={ggUser}
            onChange={(e) => setGgUser(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-gg-pass">
            Admin web GGCLink (ZICG GM22): kata sandi
          </Label>
          <Input
            id="ont-set-gg-pass"
            type="password"
            autoComplete="new-password"
            placeholder={
              settings.hasGgclinkPassword
                ? "tersimpan; ketik untuk mengganti"
                : ""
            }
            value={ggPass}
            onChange={(e) => setGgPass(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-f6-user">
            Admin web ZTE F609 (MTKc): nama pengguna
          </Label>
          <Input
            id="ont-set-f6-user"
            autoComplete="off"
            value={f6User}
            onChange={(e) => setF6User(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ont-set-f6-pass">
            Admin web ZTE F609 (MTKc): kata sandi
          </Label>
          <Input
            id="ont-set-f6-pass"
            type="password"
            autoComplete="new-password"
            placeholder={
              settings.hasF609Password ? "tersimpan; ketik untuk mengganti" : ""
            }
            value={f6Pass}
            onChange={(e) => setF6Pass(e.target.value)}
          />
        </div>
      </fieldset>
      {phase.kind === "saved" && (
        <p role="status" className="text-sm text-success">
          Pengaturan disimpan.
        </p>
      )}
      {phase.kind === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          {phase.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          variant="outline"
          data-testid="btn-ont-settings-save"
          aria-disabled={saving}
        >
          {saving ? "Menyimpan…" : "Simpan pengaturan"}
        </Button>
      </div>
    </form>
  );
  if (standalone) return form;
  return (
    <details
      open={!settings.configured}
      className="rounded-md border p-3 text-sm"
      data-testid="ont-web-settings"
    >
      <summary className="cursor-pointer font-medium">
        Pengaturan GenieACS{" "}
        <span className="font-normal text-muted-foreground">
          {settings.configured ? `(${settings.acsUrl})` : "(belum diatur)"}
        </span>
      </summary>
      {form}
    </details>
  );
}

/** Ikon ⚙ di halaman GenieACS: pengaturan ACS + admin web modem, terpisah dari dialog per-ONT. */
export function OntWebSettingsDialog({
  onSaved,
}: {
  onSaved?: (next: OntWebSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<OntWebSettings | "error" | null>(
    null,
  );

  async function load() {
    setSettings(null);
    try {
      const res = await fetch("/api/ont-web/settings", { cache: "no-store" });
      setSettings(res.ok ? ((await res.json()) as OntWebSettings) : "error");
    } catch {
      setSettings("error");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Pengaturan GenieACS"
          title="Pengaturan GenieACS"
          data-testid="btn-genieacs-settings"
        >
          <Settings className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pengaturan GenieACS</DialogTitle>
          <DialogDescription>
            Alamat ACS yang dipasang ke modem dan akun admin web modem. Disimpan
            di database (kata sandi terenkripsi) dan dipakai untuk semua modem.
          </DialogDescription>
        </DialogHeader>
        {settings === null ? (
          <p className="text-sm text-muted-foreground">Memuat pengaturan…</p>
        ) : settings === "error" ? (
          <p role="alert" className="text-sm text-destructive">
            Pengaturan tidak bisa dimuat.
          </p>
        ) : (
          // key: formulir dibuat ulang dari data terbaru setiap dialog dibuka.
          <OntWebSettingsPanel
            key={settings.acsUrl + settings.informInterval}
            settings={settings}
            standalone
            onSaved={(next) => {
              setSettings(next);
              onSaved?.(next);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
