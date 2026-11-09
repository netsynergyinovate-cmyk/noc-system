"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DashboardOnu } from "@/lib/dashboard/onus";
import {
  OntWebSettingsPanel,
  type OntWebSettings,
} from "./ont-web-settings-panel";

type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; message: string; host: string | null; wanNote: string }
  | { kind: "failed"; message: string };

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function Body({ onu, onClose }: { onu: DashboardOnu; onClose: () => void }) {
  // Lanjutan (semua opsional): IP manual dan admin web modem khusus modem ini.
  const [host, setHost] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Bawaan aktif: tanpa WAN pembawa TR-069 modem tidak punya jalur ke ACS.
  const [ensureWan, setEnsureWan] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Pengaturan GenieACS dari database; null = sedang dimuat, "error" = gagal dimuat.
  const [settings, setSettings] = useState<OntWebSettings | "error" | null>(
    null,
  );
  // 403 dari GET pengaturan = akun ini bukan admin (izin kelola CPE).
  const [forbidden, setForbidden] = useState(false);
  const saving = phase.kind === "saving";
  const hostTyped = host.trim() !== "";
  const hostOk = !hostTyped || IPV4.test(host.trim());
  const mapped = onu.customerId !== null;
  // Klik yang ditolak harus terlihat: alasannya ditampilkan mencolok, bukan diam.
  const [attempted, setAttempted] = useState(false);

  // Satu-satunya alasan tombol tidak bisa dipakai; selalu ditulis di layar supaya
  // klik yang ditolak tidak terasa "tidak ada respons".
  let blockReason: string | null = null;
  if (forbidden)
    blockReason = "Hanya admin (izin kelola CPE) yang boleh memasang GenieACS.";
  else if (settings === null) blockReason = "Memuat pengaturan…";
  else if (settings !== "error" && !settings.configured)
    blockReason = "Isi dan simpan Pengaturan GenieACS dulu.";
  else if (!hostOk) blockReason = "IP manual harus IPv4, mis. 172.16.15.248.";
  const canSubmit = !saving && blockReason === null;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/ont-web/settings", { signal: ctrl.signal, cache: "no-store" })
      .then((r) => {
        if (r.status === 403) setForbidden(true);
        return r.ok
          ? (r.json() as Promise<OntWebSettings>)
          : Promise.reject(new Error(String(r.status)));
      })
      .then(setSettings)
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError"))
          setSettings("error");
      });
    return () => ctrl.abort();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Satu permintaan sekali jalan: tiap login yang gagal dihitung modem.
    if (!canSubmit) {
      setAttempted(true);
      return;
    }
    setPhase({ kind: "saving" });
    try {
      const res = await fetch("/api/ont-web/tr069", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onuId: onu.id,
          ensureWan,
          ...(hostTyped ? { host: host.trim() } : {}),
          ...(username.trim() || password
            ? { username: username.trim(), password }
            : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        host?: string | null;
        wanNote?: string;
        error?: { message?: string };
      } | null;
      if (res.ok && json?.ok) {
        setPhase({
          kind: "done",
          message: json.message ?? "TR-069 dipasang di modem.",
          host: json.host ?? null,
          wanNote: json.wanNote ?? "",
        });
        setPassword("");
      } else {
        setPhase({
          kind: "failed",
          message: json?.error?.message ?? "Gagal memasang TR-069 di modem.",
        });
      }
    } catch {
      setPhase({
        kind: "failed",
        message: "Server aplikasi tidak terjangkau.",
      });
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Pasang GenieACS lewat web ONT</DialogTitle>
        <DialogDescription>
          Server mencari IP modem dari sesi PPPoE pelanggan, login ke halaman
          admin modem, membuka Settings &gt; TR-069, lalu mengisi alamat
          GenieACS. Tidak perlu mengetik apa pun bila pengaturan sudah ada.
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Pelanggan</dt>
        <dd>
          {mapped ? (
            <>
              {onu.customerName}{" "}
              <span className="font-mono text-xs text-muted-foreground">
                ({onu.pppoeUsername})
              </span>
            </>
          ) : (
            "Belum dipetakan (IP dicari dari MAC ONU)"
          )}
        </dd>
        <dt className="text-muted-foreground">Serial Number</dt>
        <dd className="font-mono">{onu.serialNumber}</dd>
        <dt className="text-muted-foreground">Model</dt>
        <dd>{onu.model}</dd>
      </dl>

      {settings === "error" && !forbidden && (
        <p role="alert" className="text-sm text-destructive">
          Pengaturan GenieACS tidak bisa dimuat. Pemasangan tetap dicoba memakai
          yang tersimpan di server.
        </p>
      )}
      {settings !== null && settings !== "error" && (
        <OntWebSettingsPanel settings={settings} onSaved={setSettings} />
      )}

      <form onSubmit={submit} noValidate className="space-y-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={ensureWan}
            disabled={saving}
            data-testid="ont-web-ensure-wan"
            onChange={(e) => setEnsureWan(e.target.checked)}
          />
          <span>
            Sambungkan TR-069 ke WAN internet bila perlu
            <span className="block text-xs text-muted-foreground">
              Modem hanya melapor ke GenieACS lewat WAN bertipe TR069. Bila
              modem ini hanya punya WAN INTERNET, tipenya diubah jadi
              TR069_INTERNET dan PPPoE pelanggan tersambung ulang sekitar 30
              detik. Pada GGCLink (ZICG GM22) WAN pelanggan tidak diubah:
              aplikasi menambahkan WAN TR-069 baru (DHCP, tanpa VLAN) yang
              dilayani router.
            </span>
          </span>
        </label>

        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Lanjutan (opsional)
          </summary>
          <fieldset disabled={saving} className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ont-web-host">
                IP web modem (kosong = otomatis dari PPPoE)
              </Label>
              <Input
                id="ont-web-host"
                inputMode="decimal"
                autoComplete="off"
                placeholder="mis. 172.16.15.248"
                value={host}
                aria-invalid={!hostOk}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Admin web modem khusus modem ini. Kosongkan untuk memakai yang
              tersimpan di database. Tidak disimpan dan tidak dicatat.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ont-web-user">Nama pengguna</Label>
                <Input
                  id="ont-web-user"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ont-web-pass">Kata sandi</Label>
                <Input
                  id="ont-web-pass"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
          </fieldset>
        </details>

        {blockReason !== null && phase.kind !== "done" && (
          <p
            id="ont-web-block"
            data-testid="ont-web-block"
            role={attempted ? "alert" : undefined}
            className={
              attempted
                ? "text-sm font-medium text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {blockReason}
          </p>
        )}
        {phase.kind === "done" && (
          <p
            role="status"
            data-testid="ont-web-result"
            className="text-sm text-success"
          >
            {phase.message}
            {phase.host ? ` (modem ${phase.host})` : ""}
            {phase.wanNote ? ` ${phase.wanNote}` : ""}
          </p>
        )}
        {phase.kind === "failed" && (
          <p
            role="alert"
            data-testid="ont-web-result"
            className="text-sm text-destructive"
          >
            {phase.message}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {phase.kind === "done" ? "Tutup" : "Batal"}
          </Button>
          <Button
            type="submit"
            data-testid="btn-ont-web-submit"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={!canSubmit}
            aria-describedby={
              blockReason !== null ? "ont-web-block" : undefined
            }
            onClick={(e) => {
              if (!canSubmit) {
                e.preventDefault();
                setAttempted(true);
              }
            }}
          >
            {saving
              ? "Memasang…"
              : phase.kind === "failed"
                ? "Coba lagi"
                : "Pasang TR-069"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function OntWebDialog({
  onu,
  open,
  onOpenChange,
}: {
  onu: DashboardOnu | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="ont-web-dialog">
        {/* key: formulir (termasuk kata sandi) dibuang setiap ONU berganti atau dialog ditutup */}
        {onu && (
          <Body key={onu.id} onu={onu} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
