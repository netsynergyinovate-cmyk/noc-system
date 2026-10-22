"use client";

import { useEffect, useState } from "react";
import { Wifi } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchCpeByPppoe } from "@/lib/dashboard/cpe-live";
import type { CpeDevice } from "@/lib/dashboard/cpe-mock";
import type { DashboardCustomer } from "@/lib/dashboard/types";
import { formatLastSeen } from "@/lib/dashboard/onu-status";
import { CustomerCpeDialog } from "./customer-cpe-dialog";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

// Modem pelanggan dari GenieACS (dicocokkan lewat username PPPoE): Wi-Fi,
// perangkat terhubung, dan info modem. Ganti Wi-Fi/reboot lewat dialog CPE.
export function CustomerCpeSummary({ customer }: { customer: DashboardCustomer }) {
  const [state, setState] = useState<{ device: CpeDevice | null } | "loading" | "failed">("loading");

  useEffect(() => {
    let alive = true;
    fetchCpeByPppoe(customer.pppoeUsername).then(
      (device) => alive && setState({ device }),
      () => alive && setState("failed"),
    );
    return () => {
      alive = false;
    };
  }, [customer.pppoeUsername]);

  const cpe = typeof state === "object" ? state.device : null;
  const activeHosts = cpe?.hosts.filter((h) => h.active) ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 pb-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">Modem (CPE) &amp; Wi-Fi</CardTitle>
          <CardDescription>Dari GenieACS (TR-069).</CardDescription>
        </div>
        <CustomerCpeDialog customer={customer} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {state === "loading" && <p role="status" className="text-muted-foreground">Memuat data modem…</p>}
        {state === "failed" && (
          <p role="status" className="text-muted-foreground">Data modem belum bisa dimuat dari GenieACS.</p>
        )}
        {typeof state === "object" && !cpe && (
          <p role="status" className="text-muted-foreground">
            Modem pelanggan ini belum terdaftar di GenieACS (belum pernah melapor lewat TR-069).
          </p>
        )}
        {cpe && (
          <>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Wifi className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <div className="truncate font-semibold">{cpe.wifi.ssid || "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {cpe.wifi.enabled ? "Aktif" : "Mati"} · {cpe.wifi.radioFrequency} · kanal{" "}
                  {cpe.wifi.channel || "—"} · {cpe.wifi.security || "—"} · {cpe.wifi.clientCount} klien
                </div>
              </div>
            </div>
            <dl className="space-y-1.5">
              <Row label="Status modem" value={cpe.isOnline ? "Online" : "Offline"} />
              <Row label="Model" value={[cpe.manufacturer, cpe.model].filter(Boolean).join(" ") || "—"} />
              <Row label="Serial Number" value={cpe.serialNumber || "—"} mono />
              <Row label="Firmware" value={cpe.softwareVersion || "—"} />
              <Row label="Uptime" value={cpe.uptimeText || "—"} />
              <Row label="IP WAN" value={cpe.wanIp || "—"} mono />
              <Row label="Inform terakhir" value={formatLastSeen(cpe.lastInformAt)} />
            </dl>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Perangkat terhubung ({activeHosts.length} aktif dari {cpe.hosts.length})
              </div>
              {cpe.hosts.length === 0 ? (
                <p className="text-muted-foreground">Modem tidak melaporkan daftar perangkat.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-auto">
                  {cpe.hosts.map((h) => (
                    <li key={h.mac} className="flex justify-between gap-3 text-xs">
                      <span className={h.active ? "" : "text-muted-foreground"}>{h.hostname || h.mac}</span>
                      <span className="font-mono text-muted-foreground">{h.ip || "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
