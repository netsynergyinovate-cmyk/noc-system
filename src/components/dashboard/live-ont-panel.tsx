"use client";

import { useMemo } from "react";
import { Activity, AlertTriangle, CheckCircle2, Info, Radio, Unplug } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OpticalLoss, OpticalRx, OpticalTx } from "@/components/dashboard/optical-rx";
import { OnuStatusBadge } from "@/components/dashboard/onu-status-badge";
import { formatInteger } from "@/lib/dashboard/format";
import { WEAK_RX_DBM } from "@/lib/dashboard/onus";
import { useLiveOnus } from "@/lib/dashboard/use-live-onus";
import { LiveCpeSection } from "./live-cpe-section";
import { MetricCard } from "./metric-card";

// Daftar yang paling perlu dilihat saja; seluruh ONU ada di tab Inventaris ONU.
const WORST_LIMIT = 30;

// Tab "Modem ONT & Redaman Fiber" untuk mode live: seluruhnya dari OLT (hasil
// polling backend). Rincian modem seperti Wi-Fi dan klien terhubung berasal dari
// GenieACS (TR-069), bukan dari OLT, dan belum terhubung: dikatakan terus terang
// di bawah, tidak diisi data tiruan.
export function LiveOntPanel() {
  const live = useLiveOnus(true);
  const onus = useMemo(() => live.onus ?? [], [live.onus]);

  const stats = useMemo(() => {
    const online = onus.filter((o) => o.status === "online");
    return {
      total: onus.length,
      online: online.length,
      weak: online.filter((o) => o.rxPowerDbm !== null && o.rxPowerDbm < WEAK_RX_DBM).length,
      los: onus.filter((o) => o.status === "los").length,
      offline: onus.filter((o) => o.status === "offline").length,
    };
  }, [onus]);

  // Online dengan sinyal terlemah di atas, lalu LOS, lalu offline.
  const worst = useMemo(() => {
    const rank = (o: (typeof onus)[number]) =>
      o.status === "online" ? (o.rxPowerDbm ?? 0) : o.status === "los" ? 1 : 2;
    return [...onus]
      .filter((o) => o.status !== "online" || (o.rxPowerDbm !== null && o.rxPowerDbm < WEAK_RX_DBM))
      .sort((a, b) => rank(a) - rank(b) || a.serialNumber.localeCompare(b.serialNumber))
      .slice(0, WORST_LIMIT);
  }, [onus]);

  return (
    <div className="flex flex-col gap-6" data-testid="live-ont-panel">
      <section aria-label="Ringkasan ONT dari OLT" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total ONU" value={formatInteger(stats.total)} hint="Terdaftar di OLT" Icon={Radio} />
        <MetricCard
          label="ONU Online"
          value={formatInteger(stats.online)}
          hint={`${stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0}% dari total`}
          Icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label="Sinyal Lemah"
          value={formatInteger(stats.weak)}
          hint="RX di bawah -27 dBm"
          Icon={AlertTriangle}
          tone={stats.weak > 0 ? "danger" : "neutral"}
        />
        <MetricCard
          label="LOS"
          value={formatInteger(stats.los)}
          hint="Kabel putus / tanpa sinyal"
          Icon={Unplug}
          tone={stats.los > 0 ? "danger" : "neutral"}
        />
        <MetricCard
          label="ONU Offline"
          value={formatInteger(stats.offline)}
          hint="Mati / tidak terdeteksi"
          Icon={Activity}
          tone={stats.offline > 0 ? "danger" : "neutral"}
        />
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">ONU yang Perlu Diperhatikan</CardTitle>
          <CardDescription>
            Sinyal lemah, LOS, dan offline, diurutkan dari yang paling buruk. Data dari OLT, bukan data tiruan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {live.failed && (
            <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Data ONU belum bisa dimuat dari server.
            </p>
          )}
          <div className="rounded-md border">
            <Table data-testid="live-ont-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Serial</TableHead>
                  <TableHead>OLT &amp; Port</TableHead>
                  <TableHead>Redaman</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pelanggan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {worst.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      {live.onus === null
                        ? live.failed
                          ? "Tidak ada data."
                          : "Memuat ONU dari server…"
                        : stats.total === 0
                          ? "Belum ada ONU. ONU muncul setelah backend berhasil memoll OLT."
                          : "Tidak ada ONU bermasalah. Semua sinyal dalam batas."}
                    </TableCell>
                  </TableRow>
                ) : (
                  worst.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.serialNumber}</TableCell>
                      <TableCell>
                        <div className="text-sm">{o.oltName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{o.ponPort}</div>
                      </TableCell>
                      <TableCell>
                        <OpticalRx dbm={o.status === "online" ? o.rxPowerDbm : null} />
                        <div className="mt-1 flex gap-3 text-muted-foreground">
                          <span>
                            TX <OpticalTx dbm={o.txPowerDbm} />
                          </span>
                          <span>
                            Loss <OpticalLoss txDbm={o.txPowerDbm} rxDbm={o.status === "online" ? o.rxPowerDbm : null} />
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <OnuStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{o.customerName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{o.pppoeUsername}</div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p
            data-testid="live-ont-genieacs-note"
            className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground"
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Redaman optik di atas berasal dari OLT. Wi-Fi, klien terhubung, dan reboot modem berasal dari
              GenieACS (TR-069); daftarnya ada di bawah.
            </span>
          </p>
        </CardContent>
      </Card>

      <LiveCpeSection />
    </div>
  );
}
