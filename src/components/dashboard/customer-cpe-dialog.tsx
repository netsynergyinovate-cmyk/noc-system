"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Cable,
  CheckCircle2,
  Clock,
  Cpu,
  Factory,
  Fingerprint,
  Globe,
  HeartPulse,
  Hash,
  Info,
  Laptop,
  Loader2,
  MemoryStick,
  Network,
  Package,
  Power,
  Radio,
  RefreshCw,
  Router,
  Settings2,
  Thermometer,
  Timer,
  TrendingDown,
  Wifi,
} from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DashboardCustomer } from "@/lib/dashboard/types";
import {
  apiOnuToCustomerOptical,
  getCustomerOpticalInfo,
  type CustomerOpticalInfo,
  type LiveOnuItem,
} from "@/lib/dashboard/onus";
import { fetchCustomerOnu } from "@/lib/dashboard/olt-live";
import {
  fetchCpeByPppoe,
  rebootCpeLive,
  rebootOnuViaOlt,
} from "@/lib/dashboard/cpe-live";
import { formatAgo } from "@/lib/dashboard/customer-live";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { formatDbm, formatInteger } from "@/lib/dashboard/format";
import type { CpeDevice, CpeHostClient } from "@/lib/dashboard/cpe";
import { OpticalRx } from "@/components/dashboard/optical-badge";
import { CpeWifiForm } from "@/components/dashboard/cpe-wifi-form";
import { CpeWifiPassword } from "@/components/dashboard/cpe-wifi-password";
import { CpeHostsManager } from "@/components/dashboard/cpe-hosts-manager";
import { useCanDo } from "@/components/access";

// Fallback untuk pemanggil lama yang belum memberi data CPE.
const fallbackHosts: CpeHostClient[] = [];

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

// Setelah reboot, perangkat dipantau sampai terlihat menyala kembali (lewat GenieACS atau lewat OLT).
const REBOOT_POLL_MS = 6_000;
const REBOOT_WATCH_MS = 5 * 60_000;
// Lewat OLT: ONU yang tidak sempat terlihat mati di antara dua polling dianggap selesai setelah jeda ini.
const OLT_NO_DOWN_GRACE_MS = 90_000;

const whenFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "short",
});
const formatWhen = (epochSec: number) =>
  `${whenFormat.format(new Date(epochSec * 1000))} WIB`;

function Row({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: Icon;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <dt className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right font-medium",
          mono && "font-mono text-xs",
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
  testId,
}: {
  icon: Icon;
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="overflow-hidden rounded-lg border" data-testid={testId}>
      <h3 className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm font-medium">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: "info" | "warn" | "ok" | "error";
  icon: Icon;
  children: ReactNode;
}) {
  const styles = {
    info: "border-border bg-muted/30 text-muted-foreground",
    warn: "border-warning/40 bg-warning/10 text-warning",
    ok: "border-success/40 bg-success/10 text-success",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
  } as const;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
        styles[tone],
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-0.5">{children}</div>
    </div>
  );
}

type RebootVia = "genieacs" | "olt";
type RebootWatch = {
  sentAt: number;
  via: RebootVia;
  phase: "waiting" | "back" | "timeout";
  sawDown: boolean;
};

export function CustomerCpeDialog({
  customer,
  cpe: cpeProp,
  onQuickDiagnostic,
}: {
  customer: DashboardCustomer;
  cpe?: CpeDevice | null;
  onQuickDiagnostic?: (customerId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmReboot, setConfirmReboot] = useState<RebootVia | null>(null);
  const [rebooting, setRebooting] = useState(false);
  const [rebootMessage, setRebootMessage] = useState("");
  const [rebootFailed, setRebootFailed] = useState(false);
  const [watch, setWatch] = useState<RebootWatch | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Naik tiap Wi-Fi berhasil diubah: menyembunyikan lagi dan membuang password lama dari state.
  const [wifiVersion, setWifiVersion] = useState(0);
  const isDemo = useSession(selectPreviewEnabled);
  // Mode live: modem pelanggan ini dari GenieACS (dicocokkan lewat username PPPoE);
  // null = belum terdaftar di GenieACS. Demo memakai modem tiruan dari prop.
  const [liveCpe, setLiveCpe] = useState<
    { customerId: string; device: CpeDevice | null } | "failed" | null
  >(null);
  useEffect(() => {
    if (isDemo || !isOpen) return;
    let alive = true;
    fetchCpeByPppoe(customer.pppoeUsername).then(
      (device) => alive && setLiveCpe({ customerId: customer.id, device }),
      () => alive && setLiveCpe("failed"),
    );
    return () => {
      alive = false;
    };
  }, [isDemo, isOpen, customer.id, customer.pppoeUsername]);

  // Mode live: ONU pelanggan ini dari OLT (olt_onus); undefined = sedang dimuat,
  // null = belum ada ONU yang dipetakan. Demo memakai data tiruan.
  const [liveOnu, setLiveOnu] = useState<
    { customerId: string; onu: LiveOnuItem | null } | "failed" | null
  >(null);
  useEffect(() => {
    if (isDemo || !isOpen) return;
    let alive = true;
    fetchCustomerOnu(customer.id).then(
      (onu) => alive && setLiveOnu({ customerId: customer.id, onu }),
      () => alive && setLiveOnu("failed"),
    );
    return () => {
      alive = false;
    };
  }, [isDemo, isOpen, customer.id]);

  // Jam layar: tiap detik saat menunggu perangkat menyala, selain itu cukup tiap 30 detik.
  const watching = watch?.phase === "waiting";
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setNow(Date.now()), watching ? 1_000 : 30_000);
    return () => clearInterval(t);
  }, [isOpen, watching]);

  // Pantau perangkat setelah reboot. GenieACS: selesai bila inform lagi dengan uptime yang dimulai sejak perintah
  // dikirim. OLT: selesai bila ONU terlihat mati lalu online lagi (atau online lagi setelah jeda tanpa terlihat mati).
  const sentAt = watch?.sentAt;
  const via = watch?.via;
  useEffect(() => {
    if (!watching || sentAt === undefined || via === undefined || isDemo)
      return;
    let alive = true;
    const poll = async () => {
      if (Date.now() - sentAt > REBOOT_WATCH_MS) {
        setWatch((w) =>
          w && w.phase === "waiting" ? { ...w, phase: "timeout" } : w,
        );
        return;
      }
      try {
        if (via === "genieacs") {
          const device = await fetchCpeByPppoe(customer.pppoeUsername);
          if (!alive || !device) return;
          setLiveCpe({ customerId: customer.id, device });
          const elapsedSec = (Date.now() - sentAt) / 1000;
          if (
            device.isOnline &&
            device.lastInformAt * 1000 > sentAt &&
            device.uptimeSeconds <= elapsedSec + 30
          ) {
            setWatch((w) => (w ? { ...w, phase: "back" } : w));
          }
          return;
        }
        const onu = await fetchCustomerOnu(customer.id);
        if (!alive || !onu) return;
        setLiveOnu({ customerId: customer.id, onu });
        const seenAfterSend = Date.parse(onu.capturedAt) > sentAt;
        if (!seenAfterSend) return; // poller OLT belum membaca ulang sejak perintah dikirim
        if (onu.status !== "online") {
          setWatch((w) => (w && !w.sawDown ? { ...w, sawDown: true } : w));
        } else {
          setWatch((w) =>
            w && (w.sawDown || Date.now() - sentAt > OLT_NO_DOWN_GRACE_MS)
              ? { ...w, phase: "back" }
              : w,
          );
        }
      } catch {
        // sumber data sesaat tidak menjawab: coba lagi pada putaran berikutnya
      }
    };
    const t = setInterval(() => void poll(), REBOOT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [watching, sentAt, via, isDemo, customer.id, customer.pppoeUsername]);

  const liveCpeReady =
    liveCpe !== null &&
    liveCpe !== "failed" &&
    liveCpe.customerId === customer.id;
  const cpe: CpeDevice | null | undefined = isDemo
    ? cpeProp
    : liveCpeReady
      ? liveCpe.device
      : null;
  const cpeNote = isDemo
    ? null
    : liveCpe === "failed"
      ? "Data modem belum bisa dimuat dari GenieACS."
      : !liveCpeReady
        ? "Memuat data modem dari GenieACS…"
        : liveCpe.device === null
          ? "Modem pelanggan ini belum terdaftar di GenieACS (belum pernah melapor lewat TR-069)."
          : null;
  const liveReady =
    liveOnu !== null &&
    liveOnu !== "failed" &&
    liveOnu.customerId === customer.id;
  const noOnuNote = isDemo
    ? null
    : liveOnu === "failed"
      ? "Data ONU belum bisa dimuat dari server."
      : !liveReady
        ? "Memuat data ONU dari OLT…"
        : liveOnu.onu === null
          ? "Belum ada ONU yang dipetakan ke pelanggan ini. Petakan di halaman OLT & Optik."
          : null;
  const emptyOptical: CustomerOpticalInfo = {
    rxPowerDbm: null,
    txPowerDbm: null,
    attenuationDb: null,
    oltName: "—",
    ponPort: "—",
    distanceMeters: null,
    model: "—",
    serialNumber: "—",
    isOnline: customer.isOnline,
  };
  const opticalInfo: CustomerOpticalInfo = isDemo
    ? getCustomerOpticalInfo(customer)
    : liveReady && liveOnu.onu
      ? apiOnuToCustomerOptical(liveOnu.onu, customer.isOnline)
      : emptyOptical;
  const hosts = isDemo
    ? (cpe?.hosts ?? fallbackHosts)
    : (cpe?.hosts.filter((h) => h.active) ?? []);
  const canManage = useCanDo("manageCpe");
  const onu = !isDemo && liveReady ? liveOnu.onu : null;

  async function doReboot(mode: RebootVia) {
    setConfirmReboot(null);
    if (isDemo) {
      setRebooting(true);
      setRebootMessage("");
      setRebootFailed(false);
      setTimeout(() => {
        setRebooting(false);
        setRebootMessage(
          "Perintah reboot terkirim ke CPE (antrean GenieACS). Perangkat mati sekitar 1-2 menit.",
        );
      }, 2000);
      return;
    }
    setRebooting(true);
    setRebootMessage("");
    setRebootFailed(false);
    setWatch(null);
    const result =
      mode === "olt" && onu
        ? await rebootOnuViaOlt(onu)
        : await rebootCpeLive(customer.id);
    setRebooting(false);
    setRebootFailed(!result.ok);
    setRebootMessage(result.message);
    if (result.ok)
      setWatch({
        sentAt: Date.now(),
        via: mode,
        phase: "waiting",
        sawDown: false,
      });
  }

  // "Online" di GenieACS = modem mengirim inform TR-069 dalam 15 menit terakhir. Itu BUKAN status internet: modem yang
  // sedang online di jaringan (sesi PPPoE aktif) bisa saja tidak melapor ke GenieACS.
  const reportsToAcs = isDemo
    ? (cpe?.isOnline ?? customer.isOnline)
    : (cpe?.isOnline ?? false);
  const canRebootAcs = reportsToAcs && !rebooting && !watching;
  const canRebootOlt =
    canManage &&
    onu !== null &&
    onu.status === "online" &&
    !rebooting &&
    !watching;
  const txDbm = opticalInfo.txPowerDbm;
  const nowSec = Math.floor(now / 1000);
  const lastInform = cpe && cpe.lastInformAt > 0 ? cpe.lastInformAt : null;
  const acsSilence = lastInform
    ? `tidak melapor ke GenieACS sejak ${formatWhen(lastInform)} (${formatAgo(nowSec - lastInform)})`
    : "belum pernah melapor ke GenieACS";
  const elapsedSec = watch
    ? Math.max(0, Math.floor((now - watch.sentAt) / 1000))
    : 0;
  const watchSource = watch?.via === "olt" ? "OLT" : "GenieACS";

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Pengaturan CPE">
          <Settings2 className="size-4" />
          <span className="sr-only">Pengaturan CPE</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[96vh] overflow-y-auto sm:max-w-[920px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-primary/10 text-primary">
              <Router className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1 text-left">
              <DialogTitle>Pengaturan Perangkat Pelanggan</DialogTitle>
              <DialogDescription className="truncate">
                {customer.name} ·{" "}
                <span className="font-mono text-xs">
                  {customer.pppoeUsername}
                </span>
              </DialogDescription>
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
                    customer.isOnline
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-destructive/40 bg-destructive/10 text-destructive",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      customer.isOnline ? "bg-success" : "bg-destructive",
                    )}
                  />
                  {customer.isOnline
                    ? "Internet online (sesi PPPoE aktif)"
                    : "Internet offline"}
                </span>
                {cpe && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
                      reportsToAcs
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-warning/40 bg-warning/10 text-warning",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        reportsToAcs ? "bg-success" : "bg-warning",
                      )}
                    />
                    {reportsToAcs ? "TR-069 aktif" : "TR-069 tidak melapor"}
                    {lastInform
                      ? ` · inform ${formatAgo(nowSec - lastInform)}`
                      : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="info" className="mt-1">
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1">
            <TabsTrigger
              value="info"
              className="min-w-0 gap-1.5 px-2 py-2 text-xs sm:text-sm"
            >
              <Info className="size-4 shrink-0" />
              Info Perangkat
            </TabsTrigger>
            <TabsTrigger
              value="wifi"
              className="min-w-0 gap-1.5 px-2 py-2 text-xs sm:text-sm"
            >
              <Wifi className="size-4 shrink-0" />
              Wi-Fi
            </TabsTrigger>
            <TabsTrigger
              value="hosts"
              className="min-w-0 gap-1.5 px-2 py-2 text-xs sm:text-sm"
            >
              <Laptop className="size-4 shrink-0" />
              Perangkat Terhubung
            </TabsTrigger>
            <TabsTrigger
              value="optical"
              className="min-w-0 gap-1.5 px-2 py-2 text-xs sm:text-sm"
            >
              <Activity className="size-4 shrink-0" />
              Sinyal Optik
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-3 pt-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Section icon={Cpu} title="Perangkat" testId="cpe-info">
                <dl className="divide-y px-4">
                  <Row
                    icon={Factory}
                    label="Manufacturer"
                    value={cpe?.manufacturer ?? "—"}
                  />
                  <Row
                    icon={Boxes}
                    label="Model"
                    value={cpe?.model ?? opticalInfo.model}
                  />
                  <Row
                    icon={Hash}
                    label="Serial Number"
                    value={cpe?.serialNumber ?? opticalInfo.serialNumber}
                    mono
                  />
                  <Row
                    icon={Fingerprint}
                    label="Device ID"
                    value={cpe?.deviceId ?? "—"}
                    mono
                  />
                  <Row
                    icon={Package}
                    label="Software"
                    value={cpe?.softwareVersion ?? "—"}
                  />
                  <Row
                    icon={Timer}
                    label="Uptime"
                    value={cpe?.uptimeText ?? "—"}
                  />
                </dl>
              </Section>
              <Section icon={Network} title="Jaringan">
                <dl className="divide-y px-4">
                  <Row
                    icon={Globe}
                    label="IP WAN"
                    value={cpe?.wanIp ?? "—"}
                    mono
                  />
                  <Row
                    icon={Network}
                    label="IP LAN"
                    value={cpe?.lanIp ?? "—"}
                    mono
                  />
                  <Row
                    icon={Fingerprint}
                    label="MAC Modem"
                    value={cpe?.macAddress || "—"}
                    mono
                  />
                  <Row
                    icon={Clock}
                    label="Inform Terakhir"
                    value={lastInform ? formatWhen(lastInform) : "—"}
                  />
                </dl>
              </Section>
            </div>

            <Section
              icon={HeartPulse}
              title="Kesehatan & Optik Modem (lewat GenieACS, bukan OLT)"
              testId="cpe-health"
            >
              <dl className="grid gap-x-8 px-4 sm:grid-cols-2">
                <Row
                  icon={Cpu}
                  label="CPU"
                  value={
                    cpe?.health.cpuPercent != null
                      ? `${formatInteger(cpe.health.cpuPercent)}%`
                      : "—"
                  }
                />
                <Row
                  icon={MemoryStick}
                  label="Memori Bebas"
                  value={
                    cpe?.health.memoryFreeKb != null &&
                    cpe.health.memoryTotalKb != null
                      ? `${formatInteger(cpe.health.memoryFreeKb)} / ${formatInteger(cpe.health.memoryTotalKb)} KB`
                      : "—"
                  }
                />
                <Row
                  icon={Thermometer}
                  label="Suhu"
                  value={
                    cpe && cpe.health.temperatures.length > 0
                      ? cpe.health.temperatures
                          .map((t) => `${t.name} ${formatInteger(t.celsius)}°C`)
                          .join(", ")
                      : "—"
                  }
                />
                <div className="grid grid-cols-2 gap-x-4">
                  <Row
                    icon={ArrowDownToLine}
                    label="RX"
                    value={
                      cpe?.optical.rxDbm != null
                        ? formatDbm(cpe.optical.rxDbm)
                        : "—"
                    }
                  />
                  <Row
                    icon={ArrowUpFromLine}
                    label="TX"
                    value={
                      cpe?.optical.txDbm != null
                        ? formatDbm(cpe.optical.txDbm)
                        : "—"
                    }
                  />
                </div>
              </dl>
            </Section>

            {cpeNote && (
              <p
                role="status"
                data-testid="cpe-live-note"
                className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
              >
                {cpeNote}
              </p>
            )}

            {/* Reboot: alasan bila lewat GenieACS tidak bisa, lalu kemajuan sampai perangkat menyala lagi */}
            {cpe && !reportsToAcs && !rebooting && !watching && (
              <Notice tone="warn" icon={AlertTriangle}>
                <p className="font-medium">
                  {customer.isOnline
                    ? "Modem online di internet, tapi tidak melapor ke GenieACS"
                    : "Modem tidak melapor ke GenieACS"}
                </p>
                <p>
                  Modem {acsSilence}. Reboot dan ubah Wi-Fi lewat GenieACS butuh
                  modem melapor (TR-069)
                  {onu ? "; alternatifnya Reboot via OLT." : "."}
                </p>
              </Notice>
            )}
            {rebootMessage && !watch && (
              <Notice
                tone={rebootFailed ? "error" : "ok"}
                icon={rebootFailed ? AlertTriangle : CheckCircle2}
              >
                <p>{rebootMessage}</p>
              </Notice>
            )}
            {watch?.phase === "waiting" && (
              <Notice tone="info" icon={RefreshCw}>
                <p className="font-medium">
                  Reboot terkirim lewat {watchSource}, menunggu perangkat
                  menyala kembali…
                </p>
                <p>
                  {elapsedSec} detik berlalu. Status diperiksa tiap{" "}
                  {REBOOT_POLL_MS / 1000} detik lewat {watchSource}
                  {watch.via === "olt"
                    ? watch.sawDown
                      ? "; ONU sudah terlihat mati, menunggu online lagi."
                      : "; menunggu ONU terlihat mati."
                    : "."}
                </p>
              </Notice>
            )}
            {watch?.phase === "back" && (
              <Notice tone="ok" icon={CheckCircle2}>
                <p className="font-medium">
                  {watch.via === "olt"
                    ? "ONU sudah online kembali di OLT"
                    : "Modem sudah menyala kembali"}
                </p>
                <p>
                  {watch.via === "olt"
                    ? `${opticalInfo.oltName} · ${opticalInfo.ponPort}${opticalInfo.rxPowerDbm != null ? ` · RX ${opticalInfo.rxPowerDbm} dBm` : ""}`
                    : `Uptime ${cpe?.uptimeText ?? "—"} · IP WAN ${cpe?.wanIp || "—"}${cpe?.optical.rxDbm != null ? ` · RX ${formatDbm(cpe.optical.rxDbm)}` : ""}`}
                </p>
              </Notice>
            )}
            {watch?.phase === "timeout" && (
              <Notice tone="warn" icon={AlertTriangle}>
                <p className="font-medium">
                  Perangkat belum kembali online setelah{" "}
                  {REBOOT_WATCH_MS / 60_000} menit
                </p>
                <p>
                  Periksa listrik dan kabel di lokasi pelanggan, lalu cek lagi
                  statusnya.
                </p>
              </Notice>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {onQuickDiagnostic && (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="quick-diag-btn"
                  onClick={() => {
                    setIsOpen(false);
                    onQuickDiagnostic(customer.id);
                  }}
                >
                  <Activity className="mr-2 size-4" />
                  Jalankan Diagnostik Cepat
                </Button>
              )}
              {onu && (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="reboot-via-olt-btn"
                  aria-disabled={!canRebootOlt}
                  title={
                    canRebootOlt
                      ? `Reboot ONU PON ${onu.ponIndex} / ONU ${onu.onuIndex} lewat ${onu.oltName}`
                      : !canManage
                        ? "Hanya admin yang boleh me-reboot perangkat."
                        : onu.status !== "online"
                          ? "ONU tidak online di OLT, tidak ada yang bisa di-reboot."
                          : "Reboot sedang berjalan"
                  }
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => canRebootOlt && setConfirmReboot("olt")}
                >
                  <Cable className="mr-2 size-4" />
                  Reboot via OLT
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                aria-disabled={!canRebootAcs}
                title={
                  canRebootAcs
                    ? undefined
                    : reportsToAcs
                      ? "Reboot sedang berjalan"
                      : `Modem ${acsSilence}`
                }
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                onClick={() => canRebootAcs && setConfirmReboot("genieacs")}
              >
                {rebooting || watching ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Power className="mr-2 size-4" />
                )}
                {rebooting
                  ? "Mengirim perintah…"
                  : watching
                    ? "Menunggu perangkat…"
                    : "Reboot CPE"}
              </Button>
            </div>
            <AlertDialog
              open={confirmReboot !== null}
              onOpenChange={(open) => !open && setConfirmReboot(null)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {confirmReboot === "olt"
                      ? "Reboot ONU lewat OLT"
                      : "Reboot CPE"}{" "}
                    {customer.name}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {confirmReboot === "olt" && onu
                      ? `Perintah dikirim ke ${onu.oltName} untuk ONU PON ${onu.ponIndex} / ONU ${onu.onuIndex}. `
                      : ""}
                    Internet pelanggan terputus sekitar 1-2 menit selama
                    perangkat menyala ulang.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      confirmReboot && void doReboot(confirmReboot)
                    }
                  >
                    Ya, reboot
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          <TabsContent value="wifi" className="space-y-3 pt-3">
            <Section icon={Wifi} title="Wi-Fi saat ini">
              <div className="space-y-3 p-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Radio className="size-3.5" aria-hidden />
                    Nama WiFi (SSID)
                  </div>
                  <div className="text-lg font-semibold">
                    {cpe?.wifi.ssid || "—"}
                  </div>
                  {cpe && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
                      {[
                        cpe.wifi.radioFrequency,
                        cpe.wifi.channel > 0
                          ? `kanal ${cpe.wifi.channel}`
                          : "kanal otomatis",
                        cpe.wifi.security,
                        reportsToAcs
                          ? `${cpe.wifi.clientCount} klien aktif`
                          : `${cpe.wifi.clientCount} klien (bacaan terakhir)`,
                      ].map((t) => (
                        <span
                          key={t}
                          className="rounded-full border px-2 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <CpeWifiPassword
                  key={wifiVersion}
                  deviceId={cpe?.deviceId ?? null}
                  canManage={canManage}
                  ssid={cpe?.wifi.ssid}
                />
              </div>
            </Section>
            <Section
              icon={Settings2}
              title="Ubah nama dan password Wi-Fi (lewat GenieACS)"
            >
              <div className="p-4">
                <CpeWifiForm
                  deviceId={cpe?.deviceId ?? null}
                  initialSsid={
                    cpe?.wifi.ssid ??
                    (isDemo ? "WIFI_" + customer.pppoeUsername : "")
                  }
                  isOnline={reportsToAcs}
                  onSuccess={() => setWifiVersion((v) => v + 1)}
                  offlineNote={
                    cpe
                      ? `Modem ${acsSilence}; perubahan lewat GenieACS tidak bisa dikirim.`
                      : undefined
                  }
                />
              </div>
            </Section>
          </TabsContent>

          <TabsContent value="hosts" className="pt-3">
            <CpeHostsManager hosts={hosts} canManage={canManage} />
          </TabsContent>
          <TabsContent value="optical" className="space-y-3 pt-3">
            {noOnuNote && (
              <p
                role="status"
                data-testid="optical-live-note"
                className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
              >
                {noOnuNote}
              </p>
            )}
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="size-4" aria-hidden />
                Sinyal optik
              </span>
              <OpticalRx
                dbm={opticalInfo.rxPowerDbm ?? cpe?.optical?.rxDbm ?? null}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(
                [
                  [
                    ArrowDownToLine,
                    "Terima OLT",
                    opticalInfo.rxPowerDbm != null
                      ? `${opticalInfo.rxPowerDbm} dBm`
                      : "—",
                  ],
                  [
                    ArrowDownToLine,
                    "Terima Modem",
                    cpe?.optical?.rxDbm != null
                      ? `${cpe.optical.rxDbm} dBm`
                      : "—",
                  ],
                  [
                    ArrowUpFromLine,
                    "Pancar Modem (TX)",
                    (cpe?.optical?.txDbm ?? txDbm) != null
                      ? `${cpe?.optical?.txDbm ?? txDbm} dBm`
                      : "—",
                  ],
                  [
                    TrendingDown,
                    "Redaman Total",
                    opticalInfo.attenuationDb != null
                      ? `${opticalInfo.attenuationDb} dB`
                      : cpe?.optical?.rxDbm != null &&
                          cpe?.optical?.txDbm != null
                        ? `${Math.round((cpe.optical.txDbm - cpe.optical.rxDbm) * 100) / 100} dB`
                        : "—",
                  ],
                ] as [Icon, string, string][]
              ).map(([TileIcon, label, value]) => (
                <div key={label} className="rounded-lg border px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <TileIcon className="size-3.5" aria-hidden />
                    {label}
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums">
                    {value}
                  </div>
                </div>
              ))}
            </div>
            <Section icon={Network} title="Jalur OLT">
              <dl className="grid gap-x-8 px-4 sm:grid-cols-2">
                <Row
                  icon={Router}
                  label="OLT & Port PON"
                  value={`${opticalInfo.oltName} · ${opticalInfo.ponPort}`}
                />
                <Row
                  icon={Hash}
                  label="Serial Number"
                  value={opticalInfo.serialNumber}
                  mono
                />
                <Row icon={Boxes} label="Model ONT" value={opticalInfo.model} />
                <Row
                  icon={Network}
                  label="ODP / Titik Distribusi"
                  value={customer.odpName || "—"}
                />
                <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <dt className="flex items-center gap-2 text-muted-foreground">
                    <Activity className="size-4" aria-hidden />
                    Status Koneksi
                  </dt>
                  <dd
                    className={cn(
                      "font-medium",
                      opticalInfo.isOnline
                        ? "text-success"
                        : "text-muted-foreground",
                    )}
                  >
                    {opticalInfo.isOnline ? "Online" : "Offline"}
                  </dd>
                </div>
              </dl>
            </Section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
