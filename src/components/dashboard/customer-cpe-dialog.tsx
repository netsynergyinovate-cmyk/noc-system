"use client";

import { useEffect, useState } from "react";
import { Wifi, Laptop, Loader2, Settings2, CheckCircle2, Activity, Info, Power } from "lucide-react";

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
import { fetchCpeByPppoe, rebootCpeLive } from "@/lib/dashboard/cpe-live";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { formatLastSeen } from "@/lib/dashboard/onu-status";
import { formatDbm, formatInteger } from "@/lib/dashboard/format";
import type { CpeDevice, CpeHostClient } from "@/lib/dashboard/cpe-mock";
import { OpticalRx } from "@/components/dashboard/optical-badge";
import { CpeWifiForm } from "@/components/dashboard/cpe-wifi-form";
import { CpeHostsManager } from "@/components/dashboard/cpe-hosts-manager";
import { useCanDo } from "@/components/access";

// Fallback untuk pemanggil lama yang belum memberi data CPE.
const fallbackHosts: CpeHostClient[] = [
  { mac: "A1:B2:C3:D4:E5:F6", ip: "192.168.1.2", hostname: "iPhone-Budi", interfaceType: "wifi_2.4g" as const, active: true },
  { mac: "11:22:33:44:55:66", ip: "192.168.1.3", hostname: "Smart-TV", interfaceType: "ethernet" as const, active: true },
  { mac: "AA:BB:CC:DD:EE:FF", ip: "192.168.1.4", hostname: "Laptop-Kerja", interfaceType: "wifi_2.4g" as const, active: false },
];

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

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
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [rebootMessage, setRebootMessage] = useState("");
  const [rebootFailed, setRebootFailed] = useState(false);
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
  const liveCpeReady = liveCpe !== null && liveCpe !== "failed" && liveCpe.customerId === customer.id;
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
  // Mode live: ONU pelanggan ini dari OLT (olt_onus); undefined = sedang dimuat,
  // null = belum ada ONU yang dipetakan. Demo memakai data tiruan.
  const [liveOnu, setLiveOnu] = useState<{ customerId: string; onu: LiveOnuItem | null } | "failed" | null>(null);
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
  const liveReady = liveOnu !== null && liveOnu !== "failed" && liveOnu.customerId === customer.id;
  const noOnuNote =
    isDemo
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
  const hosts = isDemo ? (cpe?.hosts ?? fallbackHosts) : (cpe?.hosts ?? []);
  const canManage = useCanDo("manageCpe");

  async function doRebootLive() {
    setRebooting(true);
    setRebootMessage("");
    setRebootFailed(false);
    const result = await rebootCpeLive(customer.id);
    setRebooting(false);
    setRebootFailed(!result.ok);
    setRebootMessage(result.message);
  }

  function doReboot() {
    setConfirmReboot(false);
    if (!isDemo) {
      void doRebootLive();
      return;
    }
    setRebooting(true);
    setRebootMessage("");
    setRebootFailed(false);
    setTimeout(() => {
      setRebooting(false);
      setRebootMessage("Perintah reboot terkirim ke CPE (antrean GenieACS). Perangkat mati sekitar 1-2 menit.");
    }, 2000);
  }

  // Live: hanya bila modem benar-benar ada di GenieACS dan baru melapor.
  const canReboot = (isDemo ? (cpe?.isOnline ?? customer.isOnline) : (cpe?.isOnline ?? false)) && !rebooting;
  const txDbm = opticalInfo.txPowerDbm;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Pengaturan CPE">
          <Settings2 className="size-4" />
          <span className="sr-only">Pengaturan CPE</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Pengaturan Perangkat Pelanggan</DialogTitle>
          <DialogDescription>
            Router rumah: {customer.name} ({customer.pppoeUsername})
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="info" className="mt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info" className="gap-1.5">
              <Info className="size-4" />
              Info Perangkat
            </TabsTrigger>
            <TabsTrigger value="wifi" className="gap-1.5">
              <Wifi className="size-4" />
              Wi-Fi
            </TabsTrigger>
            <TabsTrigger value="hosts" className="gap-1.5">
              <Laptop className="size-4" />
              Perangkat Terhubung
            </TabsTrigger>
            <TabsTrigger value="optical" className="gap-1.5">
              <Activity className="size-4" />
              Sinyal Optik
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4 pt-4">
            <dl className="space-y-2 rounded-md border p-3 text-sm" data-testid="cpe-info">
              <Row label="Manufacturer" value={cpe?.manufacturer ?? "—"} />
              <Row label="Model" value={cpe?.model ?? opticalInfo.model} />
              <Row label="Serial Number" value={cpe?.serialNumber ?? opticalInfo.serialNumber} mono />
              <Row label="Device ID (GenieACS)" value={cpe?.deviceId ?? "—"} mono />
              <Row label="Uptime" value={cpe?.uptimeText ?? "—"} />
              <Row label="Software Version" value={cpe?.softwareVersion ?? "—"} />
              <Row label="IP WAN" value={cpe?.wanIp ?? "—"} mono />
              <Row label="IP LAN" value={cpe?.lanIp ?? "—"} mono />
              <Row label="Inform Terakhir" value={cpe ? formatLastSeen(cpe.lastInformAt) : "—"} />
              <Row label="MAC Modem" value={cpe?.macAddress || "—"} mono />
            </dl>

            <dl className="space-y-2 rounded-md border p-3 text-sm" data-testid="cpe-health">
              <div className="pb-1 text-xs font-medium text-muted-foreground">
                Kesehatan &amp; Optik Modem (lewat GenieACS, bukan OLT)
              </div>
              <Row label="CPU" value={cpe?.health.cpuPercent != null ? `${formatInteger(cpe.health.cpuPercent)}%` : "—"} />
              <Row
                label="Memori Bebas"
                value={
                  cpe?.health.memoryFreeKb != null && cpe.health.memoryTotalKb != null
                    ? `${formatInteger(cpe.health.memoryFreeKb)} / ${formatInteger(cpe.health.memoryTotalKb)} KB`
                    : "—"
                }
              />
              <Row
                label="Suhu"
                value={
                  cpe && cpe.health.temperatures.length > 0
                    ? cpe.health.temperatures.map((t) => `${t.name} ${formatInteger(t.celsius)}°C`).join(", ")
                    : "—"
                }
              />
              <Row label="RX Modem" value={cpe?.optical.rxDbm != null ? formatDbm(cpe.optical.rxDbm) : "—"} />
              <Row label="TX Modem" value={cpe?.optical.txDbm != null ? formatDbm(cpe.optical.txDbm) : "—"} />
            </dl>

            {cpeNote && (
              <p role="status" data-testid="cpe-live-note" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {cpeNote}
              </p>
            )}
            {rebootMessage && (
              <div
                role={rebootFailed ? "alert" : "status"}
                className={`flex items-start gap-2 rounded-md p-3 text-sm ${rebootFailed ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <p>{rebootMessage}</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
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
              {!canReboot && !rebooting && (
                <span className="text-xs text-muted-foreground">CPE offline, tidak bisa di-reboot.</span>
              )}
              <Button
                type="button"
                variant="outline"
                aria-disabled={!canReboot}
                onClick={() => canReboot && setConfirmReboot(true)}
              >
                {rebooting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Power className="mr-2 size-4" />}
                {rebooting ? "Mengirim perintah…" : "Reboot CPE"}
              </Button>
            </div>
            <AlertDialog open={confirmReboot} onOpenChange={setConfirmReboot}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reboot CPE {customer.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Internet pelanggan terputus sekitar 1-2 menit selama perangkat menyala ulang.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={doReboot}>Ya, reboot</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          <TabsContent value="wifi" className="space-y-4 pt-4">
            <CpeWifiForm
              customerId={customer.id}
              initialSsid={cpe?.wifi.ssid ?? (isDemo ? "WIFI_" + customer.pppoeUsername : "")}
              isOnline={isDemo ? (cpe?.isOnline ?? customer.isOnline) : (cpe?.isOnline ?? false)}
            />
            {cpe && (
              <p className="text-xs text-muted-foreground">
                Radio {cpe.wifi.radioFrequency} · kanal {cpe.wifi.channel} · {cpe.wifi.security} ·{" "}
                {cpe.wifi.clientCount} klien aktif
              </p>
            )}
          </TabsContent>

          <TabsContent value="hosts" className="pt-4">
            <CpeHostsManager hosts={hosts} canManage={canManage} />
          </TabsContent>
          <TabsContent value="optical" className="space-y-4 pt-4">
            {noOnuNote && (
              <p role="status" data-testid="optical-live-note" className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                {noOnuNote}
              </p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sinyal optik</span>
              <OpticalRx dbm={opticalInfo.rxPowerDbm} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["Daya Terima (RX Power)", opticalInfo.rxPowerDbm != null ? `${opticalInfo.rxPowerDbm} dBm` : "—"],
                ["Daya Pancar (TX Power)", txDbm != null ? `${txDbm} dBm` : "—"],
                ["Redaman Total (Loss)", opticalInfo.attenuationDb != null ? `${opticalInfo.attenuationDb} dB` : "—"],
                ["Jarak Fiber", opticalInfo.distanceMeters === null ? "—" : `${opticalInfo.distanceMeters.toLocaleString("id-ID")} m`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
                </div>
              ))}
            </div>
            <dl className="space-y-2 rounded-md border p-3 text-sm">
              <Row label="OLT Induk & Port PON" value={`${opticalInfo.oltName} · ${opticalInfo.ponPort}`} />
              <Row label="Serial Number" value={opticalInfo.serialNumber} mono />
              <Row label="Model ONT" value={opticalInfo.model} />
              <Row label="ODP / Titik Distribusi" value={customer.odpName || "—"} />
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Status Koneksi</dt>
                <dd className={opticalInfo.isOnline ? "text-success" : "text-muted-foreground"}>
                  {opticalInfo.isOnline ? "Online" : "Offline"}
                </dd>
              </div>
            </dl>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
