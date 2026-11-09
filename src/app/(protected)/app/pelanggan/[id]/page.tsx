import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BillingBadge, HealthBadge } from "@/components/dashboard/status-badge";
import { OpticalRx } from "@/components/dashboard/optical-badge";
import { CustomerTrafficPanel } from "@/components/dashboard/customer-traffic-panel";
import { CustomerEvidencePanel } from "@/components/dashboard/customer-evidence-panel";
import { CustomerLiveCapturePanel } from "@/components/dashboard/customer-live-capture-panel";
import { CustomerCpeSummary } from "@/components/dashboard/customer-cpe-summary";
import { DiagnoseButton } from "@/components/dashboard/diagnose-button";
import { DiagnosticHistory } from "@/components/dashboard/diagnostic-history";
import { requireSession } from "@/lib/session";
import { getCustomerHealth } from "@/lib/dashboard/health";
import { mapFocusHref } from "@/lib/dashboard/map-focus";
import {
  alertKindLabel,
  incidentSeverityLabels,
} from "@/lib/dashboard/incidents";
import type {
  DashboardCustomer,
  IncidentKind,
  IncidentSeverity,
} from "@/lib/dashboard/types";
import { getCustomerMapDetail } from "@/services/customer-location.service";
import { getRunsnetCustomerDetail } from "@/services/runsnet-billing.service";
import { listCustomerAlerts } from "@/services/alerts.service";

export const metadata: Metadata = { title: "Detail Pelanggan" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});
const when = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Jakarta",
});
const invoiceStatus: Record<string, string> = {
  paid: "Lunas",
  unpaid: "Belum bayar",
  partial: "Sebagian",
};

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const detail = await getCustomerMapDetail(id);
  if (!detail) notFound();

  // ID billing RunsNet = username PPPoE tanpa "@domain" (aturan sinkron nama billing).
  const billingId = detail.pppoeUsername.split("@")[0].trim();
  const [billing, alerts] = await Promise.all([
    getRunsnetCustomerDetail(billingId),
    listCustomerAlerts(detail.id, 10),
  ]);
  const onu = detail.onuDetails;
  const customer: DashboardCustomer = {
    id: detail.id,
    name: detail.name,
    pppoeUsername: detail.pppoeUsername,
    routerId: detail.routerId,
    address: detail.address ?? "",
    odpName: detail.odpName ?? "",
    latitude: detail.latitude ?? 0,
    longitude: detail.longitude ?? 0,
    billingStatus: detail.billingStatus,
    opticalPowerDbm: detail.opticalPower ?? Number.NaN,
    isOnline: detail.isOnline,
    planMbps: 0,
  };
  const mapHref = detail.latitude !== null ? mapFocusHref(detail.id) : null;
  const lastPayment = billing.payments[0];

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/app/pelanggan"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Daftar Pelanggan
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {detail.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {detail.pppoeUsername}
              </span>
              <HealthBadge health={getCustomerHealth(customer)} />
              <BillingBadge status={detail.billingStatus} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <DiagnoseButton
              customerId={detail.id}
              customerName={detail.name}
              className="h-8 gap-1.5 text-xs"
            />
            {mapHref && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
              >
                <Link href={mapHref}>
                  <MapPin className="size-3.5 text-primary" />
                  Lihat di Peta
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Layanan &amp; lokasi</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              <Row label="Router" value={detail.routerName ?? "—"} />
              <Row label="ODP" value={detail.odpName ?? "—"} />
              <Row label="Alamat" value={detail.address ?? "—"} />
              <Row
                label="Koordinat"
                value={
                  detail.latitude !== null && detail.longitude !== null
                    ? `${detail.latitude}, ${detail.longitude}`
                    : "—"
                }
                mono
              />
              <Row
                label="Status diperbarui"
                value={when.format(new Date(detail.lastUpdatedAt))}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ONU &amp; sinyal optik</CardTitle>
            <CardDescription>Dari OLT.</CardDescription>
          </CardHeader>
          <CardContent>
            {onu ? (
              <dl className="space-y-1.5 text-sm">
                <Row label="Rx" value={<OpticalRx dbm={onu.opticalLevel} />} />
                <Row
                  label="Tx"
                  value={onu.txPower != null ? `${onu.txPower} dBm` : "—"}
                />
                <Row
                  label="Redaman"
                  value={
                    onu.attenuation != null ? `${onu.attenuation} dB` : "—"
                  }
                />
                <Row label="Status ONU" value={onu.status ?? "—"} />
                <Row
                  label="OLT · PON/ONU"
                  value={`${onu.oltName ?? "—"} · ${onu.ponIndex ?? "?"}/${onu.onuIndex ?? "?"}`}
                />
                <Row label="Model" value={onu.model ?? "—"} />
                <Row
                  label="Serial Number"
                  value={onu.serialNumber ?? "—"}
                  mono
                />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                Belum ada ONU yang dipetakan ke pelanggan ini. Petakan di
                halaman OLT &amp; Optik.
              </p>
            )}
          </CardContent>
        </Card>

        <CustomerCpeSummary customer={customer} />
      </div>

      <CustomerTrafficPanel customerId={detail.id} />
      <CustomerEvidencePanel
        customerId={detail.id}
        customerName={detail.name}
        pppoeUsername={detail.pppoeUsername}
      />
      <CustomerLiveCapturePanel
        customerId={detail.id}
        customerName={detail.name}
        pppoeUsername={detail.pppoeUsername}
      />

      <DiagnosticHistory customerId={detail.id} alerts={alerts} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Billing</CardTitle>
            <CardDescription>RunsNet, ID {billingId}.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {billing.customer ? (
              <dl className="space-y-1.5">
                <Row label="Nama di billing" value={billing.customer.name} />
                <Row
                  label="Paket"
                  value={billing.customer.serviceProfile ?? "—"}
                />
                <Row label="Jenis" value={billing.customer.type ?? "—"} />
                <Row label="Status" value={billing.customer.status} />
                <Row
                  label="Koneksi"
                  value={billing.customer.connectivity ?? "—"}
                />
                <Row
                  label="Aktif sejak"
                  value={billing.customer.activeDate || "—"}
                />
                <Row
                  label="Berlaku sampai"
                  value={billing.customer.expiredDate || "—"}
                />
                <Row
                  label="Bayar terakhir"
                  value={
                    lastPayment
                      ? `${rupiah.format(lastPayment.amount)} · ${lastPayment.payDate ?? "—"} · ${lastPayment.method ?? "—"}`
                      : "—"
                  }
                />
              </dl>
            ) : (
              <p className="text-muted-foreground">
                Belum ada data billing untuk ID {billingId}. Jalankan sinkron
                RunsNet di halaman Billing.
              </p>
            )}
            {billing.invoices.length > 0 && (
              <div className="overflow-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Tagihan terbaru</caption>
                  <thead className="text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Periode
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Jatuh tempo
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        Tagihan
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-right font-medium"
                      >
                        Sisa
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.invoices.slice(0, 6).map((inv) => (
                      <tr key={inv.invoiceCode} className="border-t">
                        <td className="px-3 py-2">{inv.periode ?? "—"}</td>
                        <td className="px-3 py-2">{inv.dueDate ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {rupiah.format(inv.amount)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {rupiah.format(inv.remainingAmount)}
                        </td>
                        <td className="px-3 py-2">
                          {invoiceStatus[inv.status] ?? inv.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Riwayat alert</CardTitle>
            <CardDescription>10 alert terbaru pelanggan ini.</CardDescription>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada alert untuk pelanggan ini.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  >
                    <span>
                      {alertKindLabel({
                        kind: a.type as IncidentKind,
                        customerId: a.customerId,
                      })}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {incidentSeverityLabels[
                          a.severity as IncidentSeverity
                        ] ?? a.severity}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {when.format(new Date(a.startedAt * 1000))}
                      {" – "}
                      {a.endedAt
                        ? when.format(new Date(a.endedAt * 1000))
                        : "masih aktif"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
