"use client";

import { useState } from "react";
import { CheckCircle2, Camera, Globe, Laptop, Loader2, Smartphone, Tv, type LucideIcon } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import type { CpeHostClient, CpeInterfaceType } from "@/lib/dashboard/cpe-mock";

const INTERFACE_LABEL: Record<CpeInterfaceType, string> = {
  "wifi_2.4g": "Wi-Fi 2.4G",
  wifi_5g: "Wi-Fi 5G",
  ethernet: "Ethernet",
};

// Kategori ditebak dari hostname; tidak ada data kategori dari CPE.
function categoryOf(hostname: string): { Icon: LucideIcon; label: string } {
  const h = hostname.toLowerCase();
  if (/iphone|android|phone|galaxy|redmi|oppo|vivo|xiaomi|ipad/.test(h)) return { Icon: Smartphone, label: "Ponsel" };
  if (/laptop|pc|macbook|desktop|notebook/.test(h)) return { Icon: Laptop, label: "Komputer" };
  if (/tv|chromecast|firestick|stb/.test(h)) return { Icon: Tv, label: "TV" };
  if (/cam|cctv|dvr|nvr/.test(h)) return { Icon: Camera, label: "Kamera" };
  return { Icon: Globe, label: "Lainnya" };
}

export function CpeHostsManager({ hosts, canManage }: { hosts: CpeHostClient[]; canManage: boolean }) {
  const [target, setTarget] = useState<CpeHostClient | null>(null);
  const [kicking, setKicking] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  function doKick() {
    const host = target;
    if (!host) return;
    setTarget(null);
    setKicking(host.mac);
    setMessage("");
    // Tiruan: belum ada API putuskan klien; backend GenieACS menggantikan ini.
    setTimeout(() => {
      setKicking(null);
      setMessage(`Perintah putuskan ${host.hostname} (${host.mac}) masuk antrean.`);
    }, 1500);
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm" data-testid="cpe-hosts">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Perangkat</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">Koneksi</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {hosts.map((host) => {
              const { Icon, label } = categoryOf(host.hostname);
              const busy = kicking === host.mac;
              const disabled = !canManage || !host.active || kicking !== null;
              return (
                <tr key={host.mac}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-label={label} role="img" />
                      <div>
                        <div className="font-medium">{host.hostname}</div>
                        <div className="font-mono text-xs text-muted-foreground">{host.mac}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{host.ip}</td>
                  <td className="px-3 py-2 text-xs">{INTERFACE_LABEL[host.interfaceType]}</td>
                  <td className="px-3 py-2">
                    {host.active ? (
                      <span className="text-success">Aktif</span>
                    ) : (
                      <span className="text-muted-foreground">Offline</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-disabled={disabled}
                      title={!canManage ? "Hanya admin yang dapat memutuskan perangkat." : undefined}
                      onClick={() => !disabled && setTarget(host)}
                    >
                      {busy && <Loader2 className="mr-2 size-3 animate-spin" />}
                      {busy ? "Memutuskan…" : "Putuskan"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!canManage && (
        <p className="mt-3 text-xs text-muted-foreground">Hanya admin yang dapat memutuskan perangkat.</p>
      )}
      {message && (
        <div role="status" className="mt-3 flex items-start gap-2 rounded-md bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>{message}</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Menampilkan perangkat yang sedang atau pernah terhubung ke router rumah pelanggan.
      </p>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Putuskan {target?.hostname}?</AlertDialogTitle>
            <AlertDialogDescription>
              Perangkat {target?.mac} diputus dari router dan bisa tersambung lagi sendiri.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={doKick}>Ya, putuskan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
