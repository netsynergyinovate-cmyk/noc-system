import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getNetworkMapData } from "@/services/network-map.service";
import { NetworkMapLeafletLoader } from "@/components/map/network-map-leaflet-loader";
import { readFocusId } from "@/lib/dashboard/map-focus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Database,
  HardDrive,
  MapPin,
  MapPinOff,
  Radio,
  Receipt,
  Users,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Peta Sebaran Pelanggan",
  description: "Pemetaan geografis persebaran pelanggan PPPoE aktif dan terisolir dengan data nyata dari backend.",
};

export default async function PelangganPetaPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireSession();
  const focusId = readFocusId((await searchParams).focus);
  const mapData = await getNetworkMapData();

  const total = mapData.summary.totalCustomers;
  const geocoded = mapData.summary.geocodedCustomers;
  const unmapped = Math.max(0, total - geocoded);
  const online = mapData.summary.onlineCustomers;
  const critical = mapData.summary.criticalOpticsCount;

  return (
    <div className="flex w-full flex-col gap-3.5" data-testid="pelanggan-peta-page">
      {/* Header Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            >
              <Link href="/app/pelanggan">
                <ArrowLeft className="size-3.5" />
                <span>Kembali</span>
              </Link>
            </Button>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl text-foreground flex items-center gap-2">
              <MapPin className="size-5 text-primary" />
              Peta Sebaran Pelanggan
            </h1>
            {mapData.dataSource.isRealData ? (
              <Badge
                variant="outline"
                className="text-xs gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5"
                data-testid="data-source-badge"
              >
                <Database className="size-3" />
                PostgreSQL Live
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium"
                data-testid="data-source-badge"
              >
                <Database className="size-3" />
                Data Mock Lokal
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pemantauan koordinat fisik pelanggan PPPoE, redaman optik ONU, status koneksi, dan relasi ODP lapangan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Pintasan Cepat Navigasi Modul */}
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs" data-testid="page-shortcut-pelanggan">
            <Link href="/app/pelanggan">
              <Users className="size-3.5 text-primary" />
              <span>Tabel Pelanggan</span>
            </Link>
          </Button>

          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs" data-testid="page-shortcut-cpe">
            <Link href="/app/cpe">
              <HardDrive className="size-3.5 text-blue-500" />
              <span>CPE &amp; OLT</span>
            </Link>
          </Button>

          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs" data-testid="page-shortcut-billing">
            <Link href="/app/billing">
              <Receipt className="size-3.5 text-emerald-500" />
              <span>Billing</span>
            </Link>
          </Button>

          <div className="hidden xl:flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md border">
            <span>Area Operasional:</span>
            <span className="font-semibold text-foreground">Mukomuko & Teras Terunjam</span>
          </div>
        </div>
      </div>

      {/* Ringkasan Status Persebaran Pelanggan */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Card className="p-3 bg-card/60 backdrop-blur-xs">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Users className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Total Pelanggan</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">{total}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <MapPin className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Terpetakan (GPS)</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none mt-0.5">
                {geocoded}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-muted text-muted-foreground">
              <MapPinOff className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Belum Berkoordinat</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">{unmapped}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Radio className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Pelanggan Online</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400 leading-none mt-0.5">
                {online}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs col-span-2 sm:col-span-1">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Redaman Kritis</p>
              <p className="text-lg font-bold text-destructive leading-none mt-0.5">{critical}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Komponen Peta Interaktif Leaflet */}
      <NetworkMapLeafletLoader
        initialData={mapData}
        initialFocusId={focusId ?? undefined}
      />
    </div>
  );
}
