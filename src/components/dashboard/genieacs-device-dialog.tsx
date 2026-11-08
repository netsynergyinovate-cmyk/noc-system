"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, Info, KeyRound, Pencil, RefreshCw, Shuffle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDbm } from "@/lib/dashboard/format";
import type { CpeDetail, DetailWlan, DeviceSecrets } from "@/lib/genieacs/device-detail";
import { changeDeviceWifiSchema } from "@/validators/cpe";
import { formatMikrotikConnReqRule } from "@/lib/genieacs/mikrotik-firewall";

// Sandi disembunyikan lagi setelah ini, dan dibuang dari memori halaman.
const SECRET_VISIBLE_MS = 60_000;

type DetailState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: CpeDetail };
type SecretState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "shown"; data: DeviceSecrets };

function uptimeText(seconds: number | null): string {
  if (seconds === null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d}h ${two(h)}:${two(m)}:${two(Math.floor(seconds % 60))}`;
}

const timeFmt = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "medium" });
function timeText(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? timeFmt.format(t) : "—";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1 text-xs last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-right font-medium">{children || "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-3">
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function SecretValue({ value, id }: { value: string; id: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  if (value === "") return <span className="text-muted-foreground">(kosong)</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <code data-testid={`secret-${id}`} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {visible ? value : "•".repeat(Math.min(value.length, 12))}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={visible ? "Sembunyikan sandi" : "Tampilkan sandi"}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Salin sandi"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </Button>
    </span>
  );
}

// Huruf/angka tanpa yang mudah tertukar (0/O, 1/l/I), dari pengacak kriptografis.
function randomPassword(length = 12): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join("");
}

type WifiVerified = { ssid: boolean | null; password: boolean | null };
type WifiPhase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; status: "applied" | "queued"; message: string; verified: WifiVerified }
  | { kind: "failed"; message: string };

// Ubah nama dan/atau sandi satu SSID. Hanya yang berubah yang dikirim; sandi kosong = tidak diubah.
function WifiEditor({
  deviceId,
  wlan,
  onClose,
  onApplied,
}: {
  deviceId: string;
  wlan: DetailWlan;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [ssid, setSsid] = useState(wlan.ssid);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [phase, setPhase] = useState<WifiPhase>({ kind: "idle" });
  const saving = phase.kind === "saving";

  const ssidChanged = ssid !== wlan.ssid;
  const body = {
    index: wlan.index,
    ...(ssidChanged ? { ssid } : {}),
    ...(password !== "" ? { password } : {}),
  };
  const parsed = changeDeviceWifiSchema.safeParse(body);
  const problem =
    !ssidChanged && password === ""
      ? "Ubah nama atau isi sandi baru."
      : !parsed.success
        ? (parsed.error.issues[0]?.message ?? "Isian tidak valid.")
        : null;
  const blocked = problem ?? (!understood ? "Centang pernyataan di atas untuk melanjutkan." : null);

  async function submit() {
    if (saving || blocked !== null) return;
    setPhase({ kind: "saving" });
    try {
      const res = await fetch(`/api/cpe/${encodeURIComponent(deviceId)}/wifi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        status?: "applied" | "queued";
        message?: string;
        verified?: WifiVerified;
        error?: string | { message?: string };
      } | null;
      if (res.ok && json?.ok && json.status) {
        setPhase({
          kind: "done",
          status: json.status,
          message: json.message ?? "Wi-Fi diubah.",
          verified: json.verified ?? { ssid: null, password: null },
        });
        setPassword("");
        if (json.status === "applied") onApplied();
        return;
      }
      const err = json?.error;
      setPhase({
        kind: "failed",
        message:
          res.status === 403
            ? "Hanya admin (izin kelola CPE) yang boleh mengubah Wi-Fi."
            : ((typeof err === "string" ? err : err?.message) ?? "Gagal mengubah Wi-Fi."),
      });
    } catch {
      setPhase({ kind: "failed", message: "Server aplikasi tidak terjangkau." });
    }
  }

  const inputId = `wifi-${wlan.index}`;
  return (
    <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3" data-testid={`wifi-editor-${wlan.index}`}>
      <h5 className="text-xs font-semibold">Ubah Wi-Fi #{wlan.index}</h5>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-ssid`}>Nama Wi-Fi (SSID)</Label>
          <Input
            id={`${inputId}-ssid`}
            value={ssid}
            maxLength={64}
            disabled={saving}
            autoComplete="off"
            onChange={(e) => setSsid(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${inputId}-pass`}>Sandi baru (kosong = tidak diubah)</Label>
          <div className="flex gap-1.5">
            <Input
              id={`${inputId}-pass`}
              type={showPassword ? "text" : "password"}
              value={password}
              disabled={saving}
              autoComplete="new-password"
              placeholder="8-63 karakter"
              className="font-mono"
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label={showPassword ? "Sembunyikan sandi" : "Tampilkan sandi"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              aria-label="Buat sandi acak"
              title="Buat sandi acak"
              disabled={saving}
              onClick={() => {
                setPassword(randomPassword());
                setShowPassword(true);
              }}
            >
              <Shuffle className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={understood}
          disabled={saving}
          data-testid="wifi-understood"
          onChange={(e) => setUnderstood(e.target.checked)}
        />
        <span>
          Saya paham: semua perangkat yang terhubung ke Wi-Fi ini akan <strong>terputus</strong> dan harus memakai
          nama/sandi yang baru. Pelanggan perlu diberi tahu.
        </span>
      </label>

      {phase.kind === "done" && (
        <p role="status" className={phase.status === "applied" ? "text-xs text-success" : "text-xs text-warning"}>
          {phase.message}
          {phase.status === "applied" && phase.verified.ssid === true && " Nama terverifikasi dari modem."}
          {phase.status === "applied" && phase.verified.password === true && " Sandi terverifikasi dari modem."}
        </p>
      )}
      {phase.kind === "failed" && (
        <p role="alert" className="text-xs text-destructive">
          {phase.message}
        </p>
      )}
      {blocked !== null && phase.kind !== "done" && <p className="text-xs text-muted-foreground">{blocked}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          {phase.kind === "done" ? "Tutup" : "Batal"}
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="wifi-submit"
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          aria-disabled={saving || blocked !== null}
          onClick={() => void submit()}
        >
          {saving ? "Menerapkan… (sampai 40 detik)" : phase.kind === "failed" ? "Coba lagi" : "Terapkan"}
        </Button>
      </div>
    </div>
  );
}

function Body({ deviceId }: { deviceId: string }) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [secrets, setSecrets] = useState<SecretState>({ kind: "hidden" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingWlan, setEditingWlan] = useState<number | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal, forceRefresh = false) => {
      if (forceRefresh) {
        setIsRefreshing(true);
      } else {
        setState({ kind: "loading" });
      }
      try {
        const url = `/api/cpe/${encodeURIComponent(deviceId)}/detail${forceRefresh ? "?refresh=true" : ""}`;
        const res = await fetch(url, { signal, cache: "no-store" });
        const json = (await res.json().catch(() => null)) as {
          data?: CpeDetail;
          refreshed?: boolean;
          error?: string | { message?: string };
        } | null;
        if (res.ok && json?.data) {
          setState({ kind: "ready", data: json.data });
          if (forceRefresh) {
            setRefreshFailed(!json.refreshed);
            setRefreshNote(
              json.refreshed
                ? "Data segar berhasil dibaca langsung dari modem via TR-069."
                : `Modem tidak merespons connection request (perintah masuk antrean GenieACS). Menampilkan data tersimpan; terakhir melapor ${timeText(json.data.lastInform)}, ACS di modem: ${json.data.acs.url || "—"}.`,
            );
          }
        } else {
          const err = json?.error;
          setState({
            kind: "error",
            message:
              (typeof err === "string" ? err : err?.message) ??
              (res.status === 404 ? "Perangkat tidak ditemukan di GenieACS." : "Rincian modem tidak bisa dimuat."),
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ kind: "error", message: "Server aplikasi tidak terjangkau." });
      } finally {
        setIsRefreshing(false);
      }
    },
    [deviceId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    // Ditunda satu tick (pola yang sama dengan halaman ini) supaya setState tidak dipanggil
    // serempak di dalam efek.
    const t = setTimeout(() => void load(ctrl.signal), 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [load]);

  const hideSecrets = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setSecrets({ kind: "hidden" });
  }, []);

  // Sandi dibuang saat dialog ditutup (komponen ini dilepas).
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  async function revealSecrets() {
    if (secrets.kind === "loading") return;
    setSecrets({ kind: "loading" });
    try {
      const res = await fetch(`/api/cpe/${encodeURIComponent(deviceId)}/secrets`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { data?: DeviceSecrets; error?: string | { message?: string } } | null;
      if (res.ok && json?.data) {
        setSecrets({ kind: "shown", data: json.data });
        hideTimer.current = setTimeout(hideSecrets, SECRET_VISIBLE_MS);
        return;
      }
      const err = json?.error;
      setSecrets({
        kind: "error",
        message:
          res.status === 403
            ? "Hanya admin (izin kelola CPE) yang boleh melihat sandi."
            : ((typeof err === "string" ? err : err?.message) ?? "Sandi tidak bisa dimuat."),
      });
    } catch {
      setSecrets({ kind: "error", message: "Server aplikasi tidak terjangkau." });
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        <RefreshCw className="mx-auto mb-2 size-5 animate-spin" />
        Memuat rincian dari GenieACS…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="space-y-3 py-6 text-center">
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setState({ kind: "loading" });
            void load();
          }}
        >
          Coba lagi
        </Button>
      </div>
    );
  }

  const d = state.data;
  const rxClass =
    d.optical.rxDbm === null
      ? "text-muted-foreground"
      : d.optical.rxDbm >= -24
        ? "text-success"
        : d.optical.rxDbm >= -27
          ? "text-warning"
          : "text-destructive";

  const connectedHosts = d.hosts.filter((h) => h.active);
  const wifiHostCount = connectedHosts.filter((h) => /802\.11|wifi|wlan/i.test(h.interfaceType)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px] bg-background">
            Realtime TR-069
          </Badge>
          <span className="text-muted-foreground">
            {refreshNote ?? "Data konfigurasi dan pembacaan optik modem."}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isRefreshing}
          onClick={() => void load(undefined, true)}
          className="h-7 gap-1.5 text-xs font-medium"
          data-testid="btn-refresh-realtime"
        >
          <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-primary" : ""}`} />
          {isRefreshing ? "Membaca modem…" : "Segarkan Realtime"}
        </Button>
      </div>
      {refreshFailed && (() => {
        const ontIpMatch = /^https?:\/\/([^:/]+)(?::(\d+))?/i.exec(d.acs.connectionRequestUrl || "");
        const ontHost = ontIpMatch ? ontIpMatch[1] : d.wanIp;
        const ontPort = ontIpMatch && ontIpMatch[2] ? Number(ontIpMatch[2]) : 7547;
        const srvMatch = /^https?:\/\/([^:/]+)/i.exec(d.acs.url || "");
        const srvHost = srvMatch ? srvMatch[1] : "";
        const mikrotikCmd = formatMikrotikConnReqRule({
          serverIp: srvHost,
          ontIp: ontHost,
          port: ontPort,
        });

        return (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
            <div className="flex items-center justify-between font-medium">
              <span>ONT tidak merespons Connection Request Port {ontPort}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px] bg-background text-foreground"
                onClick={() => {
                  void navigator.clipboard.writeText(mikrotikCmd);
                  setCopiedCmd(true);
                  setTimeout(() => setCopiedCmd(false), 2000);
                }}
              >
                {copiedCmd ? "Tersalin!" : "Salin Perintah MikroTik"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Paket wake-up HTTP port {ontPort} dari server NOC tertahan di router. Jalankan perintah aman ini di Terminal MikroTik (hanya membuka akses dari Server NOC ke ONT):
            </p>
            <code className="block select-all rounded bg-background p-2 font-mono text-[10px] text-foreground border border-border">
              {mikrotikCmd}
            </code>
          </div>
        );
      })()}
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Identitas">
          <dl>
            <Field label="ID PPPoE">{d.pppoeUsername}</Field>
            <Field label="Serial Number">{d.serialNumber}</Field>
            <Field label="Produsen / Model">{[d.manufacturer, d.productClass].filter(Boolean).join(" ")}</Field>
            <Field label="OUI">{d.oui}</Field>
            <Field label="Versi (HW / SW)">{[d.hardwareVersion, d.softwareVersion].filter(Boolean).join(" / ")}</Field>
            <Field label="Jenis PON">{d.ponType}</Field>
            <Field label="MAC">{d.macAddress}</Field>
          </dl>
        </Section>
        <Section title="Jaringan & ACS">
          <dl>
            <Field label="IP PPPoE">{d.wanIp}</Field>
            <Field label="IP WAN/TR069">{d.tr069Ip}</Field>
            <Field label="Uptime">{uptimeText(d.uptimeSeconds)}</Field>
            <Field label="URL ACS di modem">{d.acs.url}</Field>
            <Field label="Periodic inform">
              {d.acs.informEnabled ? `${d.acs.informInterval ?? "?"} detik` : "mati"}
            </Field>
            <Field label="Terdaftar">{timeText(d.registered)}</Field>
            <Field label="Komunikasi terakhir">{timeText(d.lastInform)}</Field>
          </dl>
        </Section>
        <Section title="Optik">
          <dl>
            <Field label="RX">
              <span className={rxClass}>{d.optical.rxDbm !== null ? formatDbm(d.optical.rxDbm) : "—"}</span>
            </Field>
            <Field label="TX">{d.optical.txDbm !== null ? formatDbm(d.optical.txDbm) : "—"}</Field>
            <Field label="Redaman (TX − RX)">{d.optical.lossDb !== null ? `${d.optical.lossDb} dB` : "—"}</Field>
            <Field label="Suhu modul">{d.optical.temperatureC !== null ? `${d.optical.temperatureC} °C` : "—"}</Field>
            <Field label="Arus bias">{d.optical.biasMa !== null ? `${d.optical.biasMa} mA` : "—"}</Field>
            <Field label="Tegangan">{d.optical.voltageV !== null ? `${d.optical.voltageV} V` : "—"}</Field>
          </dl>
        </Section>
        <Section title="Kesehatan modem">
          <dl>
            <Field label="CPU">{d.health.cpuPercent !== null ? `${d.health.cpuPercent}%` : "—"}</Field>
            <Field label="Memori bebas / total">
              {d.health.memoryTotalKb !== null
                ? `${d.health.memoryFreeKb ?? "?"} / ${d.health.memoryTotalKb} KB`
                : "—"}
            </Field>
            {d.health.temperatures.length === 0 ? (
              <Field label="Suhu">—</Field>
            ) : (
              d.health.temperatures.map((t) => (
                <Field key={t.name} label={`Suhu ${t.name}`}>
                  {t.celsius} °C
                </Field>
              ))
            )}
            <Field label="Perangkat terhubung">{String(d.activeClients)}</Field>
          </dl>
        </Section>
      </div>

      <Section title={`Koneksi WAN (${d.wans.length})`}>
        {d.wans.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada data WAN.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Akun PPPoE</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>MAC</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.wans.map((w, i) => (
                  <TableRow key={`${w.name}-${i}`} className="text-xs">
                    <TableCell className="font-mono">{w.name || "—"}</TableCell>
                    <TableCell>{w.kind}</TableCell>
                    <TableCell className="font-mono">{w.username || "—"}</TableCell>
                    <TableCell>{w.status || "—"}</TableCell>
                    <TableCell className="font-mono">{w.ip || "—"}</TableCell>
                    <TableCell className="font-mono">{w.mac || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title={`Wi-Fi (${d.wlans.length} SSID)`}>
        {d.wlans.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada data Wi-Fi.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>SSID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Kanal</TableHead>
                  <TableHead>Klien</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.wlans.map((w) => (
                  <TableRow key={w.index} className="text-xs">
                    <TableCell>{w.index}</TableCell>
                    <TableCell className="font-medium">{w.ssid || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={w.enabled ? "default" : "secondary"} className="text-[10px]">
                        {w.enabled ? "Aktif" : "Mati"}
                      </Badge>
                    </TableCell>
                    <TableCell>{w.channel ?? "—"}</TableCell>
                    <TableCell>{w.clients}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        data-testid={`btn-edit-wifi-${w.index}`}
                        aria-pressed={editingWlan === w.index}
                        onClick={() => setEditingWlan(editingWlan === w.index ? null : w.index)}
                      >
                        <Pencil className="size-3" />
                        Ubah
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {editingWlan !== null && d.wlans.some((w) => w.index === editingWlan) && (
          <WifiEditor
            key={editingWlan}
            deviceId={deviceId}
            wlan={d.wlans.find((w) => w.index === editingWlan)!}
            onClose={() => setEditingWlan(null)}
            onApplied={() => {
              // Sandi yang sedang ditampilkan sudah basi, dan rincian perlu dimuat ulang.
              hideSecrets();
              void load();
            }}
          />
        )}
      </Section>

      <Section title={`Perangkat terhubung (${connectedHosts.length} aktif · Wi-Fi ${wifiHostCount} · Ethernet ${connectedHosts.length - wifiHostCount})`}>
        {d.ethernet.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]" data-testid="ethernet-ports">
            {d.ethernet.map((p) => (
              <span
                key={p.index}
                className={`rounded-full border px-2 py-0.5 ${p.linkUp ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "text-muted-foreground"}`}
              >
                {p.name}: {p.linkUp ? `link${p.speedMbps ? ` ${p.speedMbps} Mbps` : ""}` : p.enabled ? "tidak ada kabel" : "nonaktif"}
              </span>
            ))}
          </div>
        )}
        {connectedHosts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Tidak ada perangkat yang sedang terhubung ke modem saat ini.</p>
        ) : (
          <div className="max-h-56 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>Antarmuka</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectedHosts.slice(0, 100).map((h, i) => (
                  <TableRow key={`${h.mac}-${i}`} className="text-xs">
                    <TableCell className="font-medium">{h.hostname || "—"}</TableCell>
                    <TableCell className="font-mono">{h.ip || "—"}</TableCell>
                    <TableCell className="font-mono">{h.mac || "—"}</TableCell>
                    <TableCell>{[h.interfaceType, h.band].filter(Boolean).join(" ") || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                        Aktif saat ini
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Sandi modem">
        <div className="space-y-2.5">
          {secrets.kind === "hidden" || secrets.kind === "loading" || secrets.kind === "error" ? (
            <>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Sandi admin web modem dan Wi-Fi dibaca dari modem lewat TR-069. Hanya admin yang boleh melihatnya, dan setiap
                pembukaan dicatat di jejak aktivitas.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="btn-show-secrets"
                aria-disabled={secrets.kind === "loading"}
                onClick={() => void revealSecrets()}
              >
                <KeyRound className="size-3.5" />
                {secrets.kind === "loading" ? "Memuat…" : "Tampilkan sandi"}
              </Button>
              {secrets.kind === "error" && (
                <p role="alert" className="text-xs text-destructive">
                  {secrets.message}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Disembunyikan otomatis dalam {SECRET_VISIBLE_MS / 1000} detik. Klik ikon mata untuk melihat.
                </p>
                <Button type="button" size="sm" variant="outline" onClick={hideSecrets}>
                  Sembunyikan
                </Button>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Akun</TableHead>
                      <TableHead>Nama pengguna</TableHead>
                      <TableHead>Sandi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {secrets.data.accounts.map((a) => (
                      <TableRow key={a.source} className="text-xs">
                        <TableCell>
                          <div className="font-medium">{a.label}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {a.source}
                            {a.usedByApp ? " · dipakai aplikasi" : ""}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono">{a.username || "—"}</TableCell>
                        <TableCell>
                          <SecretValue value={a.password} id={a.source} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {secrets.data.wifi.map((w) => (
                      <TableRow key={`wifi-${w.index}`} className="text-xs">
                        <TableCell>
                          <div className="font-medium">Wi-Fi #{w.index}</div>
                          <div className="text-[10px] text-muted-foreground">X_CMS_KeyPassphrase</div>
                        </TableCell>
                        <TableCell>{w.ssid || "—"}</TableCell>
                        <TableCell>
                          <SecretValue value={w.passphrase} id={`wifi-${w.index}`} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {secrets.data.accounts.length === 0 && secrets.data.wifi.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">
                          Modem ini tidak melaporkan sandi lewat TR-069.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}

export function GenieacsDeviceDialog({ deviceId, label }: { deviceId: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" data-testid="btn-device-detail">
          Rincian
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl" data-testid="device-detail-dialog">
        <DialogHeader>
          <DialogTitle>Rincian modem</DialogTitle>
          <DialogDescription className="font-mono text-xs">{label}</DialogDescription>
        </DialogHeader>
        {/* Dipasang hanya saat terbuka: tutup dialog = state (termasuk sandi) dibuang. */}
        {open && <Body deviceId={deviceId} />}
      </DialogContent>
    </Dialog>
  );
}
