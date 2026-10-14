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
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { formatLastSeen } from "@/lib/dashboard/onu-status";
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
  cpe,
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
  const isDemo = useSession(selectPreviewEnabled);
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
  const hosts = cpe?.hosts ?? fallbackHosts;
  const canManage = useCanDo("manageCpe");

  function doReboot() {
    setConfirmReboot(false);
    if (!isDemo) {
      // Reboot modem dikirim lewat GenieACS (TR-069), belum tersambung: jangan pura-pura terkirim.
      setRebootMessage("Reboot modem butuh GenieACS yang belum tersambung. Tidak ada perintah yang dikirim.");
      return;
    }
    setRebooting(true);
    setRebootMessage("");
    setTimeout(() => {
      setRebooting(false);
      setRebootMessage("Perintah reboot terkirim ke CPE (antrean GenieACS). Perangkat mati sekitar 1-2 menit.");
    }, 2000);
  }

  const canReboot = (cpe?.isOnline ?? customer.isOnline) && !rebooting;
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
              <Row label="Manufacturer" value={cpe?.manufacturer ?? "Ã¢â‚¬â€"} />
              <Row label="Model" value={cpe?.model ?? opticalInfo.model} />
              <Row label="Serial Number" value={cpe?.serialNumber ?? opticalInfo.serialNumber} mono />
              <Row label="Device ID (GenieACS)" value={cpe?.deviceId ?? "Ã¢â‚¬â€"} mono />
              <Row label="Uptime" value={cpe?.uptimeText ?? "Ã¢â‚¬â€"} />
              <Row label="Software Version" value={cpe?.softwareVersion ?? "Ã¢â‚¬â€"} />
              <Row label="IP WAN" value={cpe?.wanIp ?? "Ã¢â‚¬â€"} mono />
              <Row label="IP LAN" value={cpe?.lanIp ?? "Ã¢â‚¬â€"} mono />
              <Row label="Inform Terakhir" value={cpe ? formatLastSeen(cpe.lastInformAt) : "Ã¢â‚¬â€"} />
            </dl>

            {rebootMessage && (
              <div role="status" className="flex items-start gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
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
                {rebooting ? "Mengirim perintahÃ¢â‚¬Â¦" : "Reboot CPE"}
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
              initialSsid={cpe?.wifi.ssid ?? "WIFI_" + customer.pppoeUsername}
              isOnline={cpe?.isOnline ?? customer.isOnline}
            />
            {cpe && (
              <p className="text-xs text-muted-foreground">
                Radio {cpe.wifi.radioFrequency} Â· kanal {cpe.wifi.channel} Â· {cpe.wifi.security} Â·{" "}
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
                ["Daya Terima (RX Power)", opticalInfo.rxPowerDbm != null ? `${opticalInfo.rxPowerDbm} dBm` : "Ã¢â‚¬â€"],
                ["Daya Pancar (TX Power)", txDbm != null ? `${txDbm} dBm` : "—"],
                ["Redaman Total (Loss)", opticalInfo.attenuationDb != null ? `${opticalInfo.attenuationDb} dB` : "Ã¢â‚¬â€"],
                ["Jarak Fiber", opticalInfo.distanceMeters === null ? "—" : `${opticalInfo.distanceMeters.toLocaleString("id-ID")} m`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
                </div>
              ))}
            </div>
            <dl className="space-y-2 rounded-md border p-3 text-sm">
              <Row label="OLT Induk & Port PON" value={`${opticalInfo.oltName} Ã‚Â· ${opticalInfo.ponPort}`} />
              <Row label="Serial Number" value={opticalInfo.serialNumber} mono />
              <Row label="Model ONT" value={opticalInfo.model} />
              <Row label="ODP / Titik Distribusi" value={customer.odpName || "Ã¢â‚¬â€"} />
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
