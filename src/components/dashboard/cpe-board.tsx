"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Cpu, Network, Radio, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiOltToDashboard, getOltStats, mockOlts, oltLinkState, type ApiOlt, type DashboardOlt } from "@/lib/dashboard/olts";
import { ConnectionErrorNotice } from "./connection-error-notice";
import { CpeInventory } from "./cpe-inventory";
import { OnuCustomerMappingPanel } from "./onu-customer-mapping-panel";
import { OltWizardDialog } from "./olt-wizard-dialog";
import { PonPortsDialog } from "./pon-ports-dialog";
import { OltDeleteDialog } from "./olt-delete-dialog";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { fetchLiveOlts } from "@/lib/dashboard/olt-live";
import { formatInteger } from "@/lib/dashboard/format";
import { CpeDiagnosticsPanel } from "./cpe-diagnostics-panel";
import { MetricCard } from "./metric-card";

// Zona waktu tetap supaya HTML server dan browser sama.
const oltTimeFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
});

export function CpeBoard() {

  const [tab, setTab] = useState("olt");
  const isDemoMode = useSession(selectPreviewEnabled);
  // Mode live: hanya OLT dari database; tidak pernah jatuh ke daftar tiruan.
  const [olts, setOlts] = useState<readonly DashboardOlt[]>(isDemoMode ? mockOlts : []);
  const [oltsFromApi, setOltsFromApi] = useState(!isDemoMode);
  const [oltsFailed, setOltsFailed] = useState(false);
  const [selectedOltForPon, setSelectedOltForPon] = useState<DashboardOlt | null>(null);
  const [oltToDelete, setOltToDelete] = useState<DashboardOlt | null>(null);

  // OLT nyata dari GET /api/devices; gagal atau kosong -> tetap data tiruan.
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!isDemoMode) {
      let alive = true;
      const load = async () => {
        try {
          const next = await fetchLiveOlts();
          if (alive) {
            setOlts(next);
            setOltsFailed(false);
          }
        } catch {
          if (alive) setOltsFailed(true);
        }
      };
      const first = setTimeout(() => void load(), 0);
      const timer = setInterval(() => void load(), 30_000);
      return () => {
        alive = false;
        clearTimeout(first);
        clearInterval(timer);
      };
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/devices");
        if (!res.ok) return;
        const json = await res.json();
        const rows: ApiOlt[] = Array.isArray(json?.data?.olts) ? json.data.olts : [];
        if (cancelled || rows.length === 0) return;
        setOlts(rows.map(apiOltToDashboard));
        setOltsFromApi(true);
      } catch {
        // jaringan putus: pertahankan daftar yang sedang tampil
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, isDemoMode]);


  const oltStats = getOltStats(olts);
  // Demo: data tiruan punya last_seen_at tetap, jadi jangan dinilai basi terhadap jam sungguhan.
  const nowSec = isDemoMode ? 0 : Math.floor(now / 1000);
  const oltTerputus = olts.find((o) => ["down", "stale"].includes(oltLinkState(o, nowSec)));

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="olt">Daftar OLT</TabsTrigger>
        <TabsTrigger value="onus">Perangkat CPE/ONT</TabsTrigger>
        <TabsTrigger value="mapping">Kelola Pemetaan ONU</TabsTrigger>
        <TabsTrigger value="diagnostics">Tugas Diagnostik &amp; Riwayat</TabsTrigger>
      </TabsList>

      <TabsContent value="diagnostics" className="flex flex-col gap-6">
        {isDemoMode ? (
          <CpeDiagnosticsPanel />
        ) : (
          <p
            data-testid="diagnostics-live-note"
            className="rounded-md border border-dashed p-6 text-sm text-muted-foreground"
          >
            Panel diagnostik massal (ping, traceroute) belum memakai data modem nyata, jadi tidak ditampilkan di mode
            live. Reboot dan ubah Wi-Fi modem satu pelanggan sudah nyata: buka ikon pengaturan (roda gigi) pada baris
            pelanggan di halaman Pelanggan.
          </p>
        )}
      </TabsContent>

      <TabsContent value="mapping" className="flex flex-col gap-6">
        <OnuCustomerMappingPanel />
      </TabsContent>

      <TabsContent value="onus" className="flex flex-col gap-6">
        <CpeInventory />
      </TabsContent>

      <TabsContent value="olt" className="flex flex-col gap-6">
        <section
          aria-label="Ringkasan OLT"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <MetricCard
            label="Total OLT"
            value={formatInteger(oltStats.total)}
            hint="Perangkat OLT terdaftar"
            Icon={Cpu}
          />
          <MetricCard
            label="OLT Aktif"
            value={formatInteger(oltStats.active)}
            hint={`${oltStats.total - oltStats.active} nonaktif`}
            Icon={CheckCircle2}
            tone="success"
          />
          <MetricCard
            label="Total Port PON"
            value={formatInteger(oltStats.totalPon)}
            hint="Seluruh OLT"
            Icon={Network}
          />
          <MetricCard
            label="Total ONU Terdaftar"
            value={formatInteger(oltStats.totalOnu)}
            hint="ONU aktif di semua OLT"
            Icon={Radio}
          />
        </section>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-lg">Daftar OLT</CardTitle>
              <CardDescription>
                {oltsFromApi
                  ? "Data dari database; jumlah port dan ONU dari hasil polling OLT oleh backend."
                  : "Data tiruan; belum ada OLT terdaftar."}
              </CardDescription>
            </div>
            <OltWizardDialog onSaved={() => setReloadKey((k) => k + 1)} />
          </CardHeader>
          <CardContent>
            {oltTerputus && (
              <ConnectionErrorNotice
                deviceType="olt"
                target={oltTerputus.host}
                message={`${oltTerputus.name} belum dapat dihubungi oleh backend.`}
                className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3"
              />
            )}
            <div className="rounded-md border">
              <Table data-testid="olt-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama &amp; Brand</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Driver/Protokol</TableHead>
                    <TableHead>Port PON</TableHead>
                    <TableHead>ONU Aktif</TableHead>
                    <TableHead>Suhu</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Terakhir Terlihat</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {olts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="h-28 text-center text-muted-foreground" data-testid="olt-empty">
                        {oltsFailed
                          ? "Daftar OLT belum bisa dimuat dari server."
                          : "Belum ada OLT terdaftar. Klik Tambah OLT untuk mendaftarkan OLT pertama."}
                      </TableCell>
                    </TableRow>
                  )}
                  {olts.map((olt, index) => (
                    <TableRow key={olt.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{olt.name}</div>
                        <Link
                          href={`/app/cpe/pon/${oltsFromApi ? `${olt.id}:1` : `olt-${index + 1}-pon-1`}`}
                          className="text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {oltsFromApi ? "Lihat detail PON 1" : "Lihat detail PON 1/1/1"}
                        </Link>
                        <div className="text-xs text-muted-foreground">{olt.brand}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{olt.host}</TableCell>
                      <TableCell className="font-mono text-xs">{olt.driver}</TableCell>
                      <TableCell className="tabular-nums">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="btn-view-pon-ports"
                          onClick={() => setSelectedOltForPon(olt)}
                        >
                          Lihat Port ({olt.totalPonPorts})
                        </Button>
                      </TableCell>
                      <TableCell className="tabular-nums">{formatInteger(olt.activeOnus)}</TableCell>
                      <TableCell className="tabular-nums">{olt.temperatureC}°C</TableCell>
                      <TableCell>
                        {oltLinkState(olt, nowSec) === "online" ? (
                          <Badge
                            variant="outline"
                            className="border-success/40 bg-success/10 text-success"
                          >
                            <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-success" />
                            Terhubung
                          </Badge>
                        ) : oltLinkState(olt, nowSec) === "waiting" ? (
                          // OLT baru disimpan: backend belum selesai polling pertama (beberapa detik sampai semenit).
                          <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning" title="Backend sedang menghubungi OLT untuk pertama kali; daftar disegarkan otomatis.">
                            <span aria-hidden="true" className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-warning" />
                            Menunggu polling pertama
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-destructive/40 bg-destructive/10 text-destructive"
                            title={olt.status === "aktif" ? "Backend tidak berhasil memoll OLT ini beberapa menit terakhir." : undefined}
                          >
                            <span aria-hidden="true" className="mr-1.5 inline-block size-2 rounded-full bg-destructive" />
                            Terputus
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {olt.lastSeenAt === null ? (
                          "Belum pernah"
                        ) : (
                          <time
                            dateTime={new Date(olt.lastSeenAt * 1000).toISOString()}
                            title="Terakhir berhasil dihubungi"
                          >
                            {oltTimeFormat.format(new Date(olt.lastSeenAt * 1000))} WIB
                          </time>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {oltsFromApi && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            data-testid="btn-delete-olt"
                            aria-label={`Hapus OLT ${olt.name}`}
                            onClick={() => setOltToDelete(olt)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <PonPortsDialog
          olt={selectedOltForPon}
          open={selectedOltForPon !== null}
          onOpenChange={(o) => !o && setSelectedOltForPon(null)}
        />
        {oltToDelete && (
          <OltDeleteDialog
            olt={oltToDelete}
            onClose={() => setOltToDelete(null)}
            onDeleted={() => {
              setOltToDelete(null);
              setOlts((list) => list.filter((o) => o.id !== oltToDelete.id));
              setReloadKey((k) => k + 1);
            }}
          />
        )}
      </TabsContent>

    </Tabs>
  );
}
