import type { Metadata } from "next";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Radio, TrendingDown, Zap } from "lucide-react";
import { requireSession } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/dashboard/metric-card";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { PonOnuTable } from "@/components/dashboard/pon-onu-table";
import { formatDbm } from "@/lib/dashboard/format";
import { getPonPortOpticalStatus } from "@/lib/dashboard/optical";
import { resolvePonPortDetail } from "@/lib/dashboard/pon-port-resolver";
import { buttonVariants } from "@/components/ui/button";

const syncFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
});

export const metadata: Metadata = { title: "Detail Port PON" };

export default async function PonPortPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const pon = await resolvePonPortDetail(id);
  if (!pon) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
        <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">Port PON Tidak Ditemukan</h1>
        <p className="text-sm text-muted-foreground">
          ID port PON tidak valid atau port tidak terdaftar pada OLT mana pun.
        </p>
        <Link href="/app/cpe" className={buttonVariants({ variant: "outline" })}>
          Kembali ke OLT &amp; CPE
        </Link>
      </div>
    );
  }
  const port = getPonPortOpticalStatus(pon.rxPowerDbm, pon.txPowerDbm);
  const ratio = pon.totalOnu > 0 ? Math.round((pon.onlineOnu / pon.totalOnu) * 100) : 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <Link
        href="/app/cpe"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Kembali ke OLT &amp; CPE
      </Link>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Detail Port PON 1/1/{pon.ponIndex}
          </h1>
          <Badge
            variant="outline"
            className={
              pon.status === "up"
                ? "border-success/40 bg-success/10 text-success"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            }
          >
            {pon.status === "up" ? "UP" : "DOWN"}
          </Badge>
          {pon.source !== "db" && <MockDataNotice source="sensor optik OLT" />}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{pon.oltName}</span>
          <span className="font-mono text-xs">Host: {pon.oltHost}</span>
          <span className="text-xs">
            Waktu sinkronisasi data:{" "}
            <time dateTime={new Date(pon.syncedAt * 1000).toISOString()} className="font-medium text-foreground">
              {syncFormat.format(new Date(pon.syncedAt * 1000))} WIB
            </time>
          </span>
        </div>
      </div>

      {pon.status === "down" && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Port PON sedang nonaktif (down). Data optik dan ONU mungkin tidak terbaru.
        </div>
      )}

      <section aria-label="Ringkasan port PON" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="TX Power OLT"
          value={pon.txPowerDbm != null ? formatDbm(pon.txPowerDbm) : "�"}
          hint={port.isTxNormal ? "Daya pancar port" : "Di luar ambang (normal +1.5 s/d +5.0 dBm)"}
          Icon={port.isTxNormal ? Zap : AlertTriangle}
          tone={port.isTxNormal ? "neutral" : "danger"}
        />
        <MetricCard
          label="RX Power SFP"
          value={pon.rxPowerDbm != null ? formatDbm(pon.rxPowerDbm) : "�"}
          hint={port.isRxNormal ? "Rata-rata dari ONU online" : "Di luar ambang (normal -28.0 s/d -8.0 dBm)"}
          Icon={port.isRxNormal ? Activity : AlertTriangle}
          tone={port.isRxNormal ? "neutral" : "danger"}
        />
        <MetricCard
          label="Redaman Rata-rata"
          value={pon.attenuationDb != null ? `${pon.attenuationDb.toFixed(1)} dB` : "�"}
          hint="TX dikurangi RX"
          Icon={TrendingDown}
        />
        <MetricCard
          label="Rasio ONU Online"
          value={`${pon.onlineOnu}/${pon.totalOnu}`}
          hint={`${ratio}% terhubung (Kapasitas: ${pon.totalOnu}/${pon.capacity})`}
          Icon={ratio >= 90 ? CheckCircle2 : Radio}
          tone={ratio >= 90 ? "success" : "warning"}
        />
      </section>

      <PonOnuTable onus={pon.onus} />
    </div>
  );
}
