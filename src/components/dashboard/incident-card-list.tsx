"use client";

import { memo, useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleCheck, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatInteger } from "@/lib/dashboard/format";
import {
  causeLabels,
  confidenceLabels,
  rootSourceLabels,
  summarizeIncidentCards,
  type IncidentCard,
} from "@/lib/dashboard/incident-cards";
import { alertKindLabel, incidentLabels } from "@/lib/dashboard/incidents";
import { mapFocusHref } from "@/lib/dashboard/map-focus";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useNowMinute } from "@/lib/dashboard/use-now";
import { describeAnomaly } from "@/lib/dashboard/anomalies";
import { subjectLabel, useSubjectLookup } from "./anomaly-subject";
import { AlertTime } from "./alert-time";
import { RunningDuration } from "./running-duration";
import { SeverityBadge } from "./status-badge";
import {
  KindInfoDisclosure,
  MikroTikSourceChip,
} from "./anomaly-kind-visual";
import { incidentVariantStyle } from "./incident-variant-meta";
import {
  classifyIncident,
  type VariantCustomer,
} from "@/lib/dashboard/incident-variant";
function impactText(card: IncidentCard) {
  const served = formatInteger(card.servedCustomers);
  return card.affectedCustomers > 0
    ? `${formatInteger(card.affectedCustomers)} pelanggan terbukti terdampak, dari ${served} yang dilayani`
    : `Belum ada pelanggan terbukti terdampak; melayani ${served} pelanggan`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h4>
  );
}

// Teks ambang untuk satu alert. Alert optik dari backend belum membawa nilai Rx,
// jadi tidak ditulis "0,0 dBm" seolah terukur.
function alertReading(alert: IncidentCard["alerts"][number]) {
  return alert.kind === "optical" && alert.measured === null
    ? "Rx di bawah batas -25,0 dBm"
    : describeAnomaly(alert);
}

// Alert anggota insiden, satu baris per alert: waktu mulai sampai detik beserta
// sumbernya, jenis dan subjek, bacaan, dan tingkatnya.
function IncidentAlertList({
  card,
  now,
}: {
  card: IncidentCard;
  now: number;
}) {
  const lookup = useSubjectLookup();
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={`Alert dalam insiden ${card.title}`}
      className="max-h-72 divide-y divide-border/50 overflow-auto rounded-md border border-border/60"
    >
      {card.alerts.map((alert) => {
        const username = alert.customerId
          ? lookup.customerById.get(alert.customerId)?.pppoeUsername
          : undefined;
        const router = lookup.routerNames.get(alert.routerId);
        return (
          <div
            key={alert.id}
            data-testid="alert-row"
            data-alert-id={alert.id}
            data-severity={alert.severity}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-start gap-x-3 px-2.5 py-1.5 text-[11px]"
          >
            <div className="font-mono text-foreground [&>span]:flex-row [&>span]:items-baseline [&>span]:gap-2 [&_[data-time-source]]:text-muted-foreground">
              <AlertTime alert={alert} now={now} compact />
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-foreground">
                  {alertKindLabel(alert)}
                </span>
                <span className="text-foreground">{subjectLabel(alert, lookup)}</span>
                {username && (
                  <span className="font-mono text-muted-foreground">{username}</span>
                )}
              </div>
              <div className="text-muted-foreground">
                {alertReading(alert)}
                {router && ` · ${router}`}
                {alert.location.odpName && ` · ${alert.location.odpName}`}
              </div>
            </div>
            <SeverityBadge severity={alert.severity} />
          </div>
        );
      })}
    </div>
  );
}

function CardDetails({
  card,
  now,
  action,
}: {
  card: IncidentCard;
  now: number;
  action: string;
}) {
  const primaryKind = card.kinds[0]?.kind;
  return (
    <div
      className="mt-2 flex flex-col gap-2.5 border-t border-border/70 pt-2.5"
      data-testid="incident-details"
    >
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <div className="space-y-0.5">
          <SectionLabel>Saran</SectionLabel>
          <p className="text-[11px] text-foreground">{action}</p>
        </div>
        {primaryKind && (
          <div className="space-y-0.5">
            <SectionLabel>Sumber data</SectionLabel>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <MikroTikSourceChip kind={primaryKind} />
              <KindInfoDisclosure kind={primaryKind} />
            </div>
          </div>
        )}
      </div>
      {card.reasons.length > 0 && (
        <section aria-label="Alasan pengelompokan" className="space-y-0.5">
          <SectionLabel>Mengapa dikelompokkan</SectionLabel>
          <ul className="list-disc pl-5 text-[11px] text-muted-foreground space-y-0.5">
            {card.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="space-y-1">
        <SectionLabel>
          {card.alertCount > 1 ? `Alert (${formatInteger(card.alertCount)})` : "Alert"}
        </SectionLabel>
        <IncidentAlertList card={card} now={now} />
      </div>
    </div>
  );
}

// Dimemoisasi: kartu yang isinya tidak berubah (objek yang sama dari store) dan
// tidak dibuka atau ditutup tidak digambar ulang saat kartu lain berubah.
const IncidentCardView = memo(function IncidentCardView({
  card,
  now,
  customers,
  open,
  onToggle,
}: {
  card: IncidentCard;
  now: number;
  customers: ReadonlyMap<string, VariantCustomer>;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const base = useId();
  const titleId = `${base}-title`;
  const panelId = `${base}-panel`;
  const focusHref =
    card.focusCustomerId === null ? null : mapFocusHref(card.focusCustomerId);
  const showRoot =
    card.alertCount > 1 || !card.title.includes(card.rootSource.name);
  const variant = useMemo(
    () => classifyIncident(card, customers),
    [card, customers],
  );
  const style = incidentVariantStyle[variant.id];
  const VariantIcon = style.Icon;

  return (
    <article
      aria-labelledby={titleId}
      data-testid="incident-card"
      data-card-id={card.id}
      data-cause={card.cause}
      data-severity={card.severity}
      data-variant={variant.id}
      data-alert-count={card.alertCount}
      data-affected={card.affectedCustomers}
      data-served={card.servedCustomers}
      data-expanded={open}
      className={cn(
        "min-w-0 rounded-md border border-l-2 bg-card px-2.5 py-1.5 text-card-foreground hover:border-border/80 transition-colors flex flex-col gap-1",
        style.edge,
        // Yang terbuka melebar ke dua kolom supaya tabel rinciannya lega (diuji di e2e).
        open && "lg:col-span-2",
      )}
    >
      <div className="flex items-center gap-2">
        <VariantIcon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", style.text)}
        />
        <h3
          id={titleId}
          title={card.title}
          className="min-w-0 flex-1 truncate text-xs font-semibold leading-tight text-foreground"
        >
          {card.title}
        </h3>
        <SeverityBadge severity={card.severity} />
        <span className="shrink-0 font-mono text-muted-foreground text-[11px]">
          <RunningDuration
            startedAt={card.startedAt}
            testId="incident-duration"
          />
        </span>
      </div>

      <p
        data-testid="incident-conclusion"
        title={`${variant.conclusion} Saran: ${variant.action}`}
        className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground"
      >
        <span
          data-testid="incident-variant"
          className={cn("shrink-0 font-medium", style.text)}
        >
          {variant.label}
        </span>
        {variant.metric && (
          <span className="shrink-0 font-mono">{variant.metric}</span>
        )}
        {card.correlationId !== null && (
          <span className="shrink-0 rounded-full border border-border px-1.5 text-[11px] text-foreground">
            {causeLabels[card.cause]}
          </span>
        )}
        {card.confidence && (
          <span className="shrink-0">{confidenceLabels[card.confidence]}</span>
        )}
        <span className="min-w-0 basis-full truncate sm:basis-0 sm:flex-1">
          <span className="hidden sm:inline">· </span>
          {variant.conclusion}
        </span>
      </p>

      <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px] text-muted-foreground">
        {/* Hanya yang belum ada di judul/lencana: akar bila bukan judulnya, dampak bila melayani >1 pelanggan, jenis bila >1 alert. */}
        <dl className="flex flex-wrap gap-x-3">
          {showRoot && (
            <div className="flex gap-1">
              <dt>Akar</dt>
              <dd data-testid="incident-root" className="text-foreground">
                {rootSourceLabels[card.rootSource.kind]}: {card.rootSource.name}
              </dd>
            </div>
          )}
          {card.servedCustomers > 1 && (
            <div className="flex gap-1">
              <dt>Terdampak</dt>
              <dd data-testid="incident-impact" className="text-foreground">
                {impactText(card)}
              </dd>
            </div>
          )}
          {card.alertCount > 1 && (
            <div className="flex gap-1">
              <dt>{formatInteger(card.alertCount)} alert</dt>
              <dd data-testid="incident-kinds" className="text-foreground">
                {card.kinds
                  .map(
                    ({ kind, count }) =>
                      `${formatInteger(count)} ${incidentLabels[kind].toLowerCase()}`,
                  )
                  .join(", ")}
              </dd>
            </div>
          )}
          <div className="flex gap-1">
            <dt>Mulai</dt>
            <dd className="font-mono text-foreground [&>span]:flex-row [&>span]:items-baseline [&>span]:gap-2 [&_[data-time-source]]:text-muted-foreground">
              <AlertTime alert={card} now={now} compact />
            </dd>
          </div>
        </dl>

        <div className="flex items-center">
          {focusHref && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[11px]" asChild>
              <Link
                href={focusHref}
                aria-label={`Sorot insiden ${card.title} di peta`}
                data-testid="incident-focus"
              >
                <MapPin aria-hidden="true" className="size-3" />
                Sorot di peta
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[11px] font-medium"
            aria-expanded={open}
            aria-controls={panelId}
            data-testid="incident-toggle"
            onClick={() => onToggle(card.id)}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn("size-3 transition-transform", open && "rotate-180")}
            />
            {open ? "Sembunyikan rincian" : "Lihat rincian"}
          </Button>
        </div>
      </div>

      <div id={panelId}>
        {open && <CardDetails card={card} now={now} action={variant.action} />}
      </div>
    </article>
  );
});

// Satu kartu per masalah yang kemungkinan satu penyebab, dengan rincian alert
// anggotanya yang bisa dibuka. Kartu datang dari pesan "incidents" hub lewat
// store (lihat incident-sync.ts), bukan ditarik berkala. Yang terbuka diingat
// per id kartu, supaya pesan baru tidak menutupnya kembali.
export function IncidentCardList() {
  const cards = useDashboardStore((state) => state.incidentCards);
  const connection = useDashboardStore((state) => state.connection);
  const now = useNowMinute();
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const summary = useMemo(
    () => (cards ? summarizeIncidentCards(cards) : null),
    [cards],
  );
  const customers = useDashboardStore((state) => state.customers);
  const customerIndex = useMemo(
    () =>
      new Map(
        customers.map((customer) => [
          customer.id,
          {
            billingStatus: customer.billingStatus,
            opticalPowerDbm: customer.opticalPowerDbm,
          },
        ]),
      ),
    [customers],
  );

  const toggle = useCallback(
    (id: string) =>
      setOpenIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  return (
    <section aria-labelledby="incident-heading" className="space-y-1.5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <h2
          id="incident-heading"
          className="text-xs font-semibold uppercase tracking-wider text-foreground"
        >
          Insiden aktif
        </h2>
        <p
          role="status"
          className="text-[11px] text-muted-foreground font-mono"
          data-testid="incident-summary"
          data-cards={summary?.cards}
          data-alerts={summary?.alerts}
          data-grouped={summary?.grouped}
          data-saved={summary?.saved}
        >
          {summary
            ? summary.cards === 0
              ? "Tidak ada insiden aktif"
              : `${formatInteger(summary.cards)} insiden dari ${formatInteger(summary.alerts)} alert aktif${summary.saved > 0 ? `; pengelompokan menghemat ${formatInteger(summary.saved)} baris` : ""}`
            : "Memuat insiden…"}
        </p>
      </div>

      {connection === "disconnected" && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          Koneksi data terputus.
          {cards
            ? " Yang tampil adalah insiden terakhir yang diterima."
            : " Insiden belum bisa dimuat."}
        </div>
      )}

      {cards ? (
        cards.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border bg-card px-4 py-4 text-xs text-muted-foreground">
            <CircleCheck className="size-4 text-success" aria-hidden="true" />
            Tidak ada insiden aktif. Semua jaringan normal.
          </p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {cards.map((card) => (
              <IncidentCardView
                key={card.id}
                card={card}
                now={now}
                customers={customerIndex}
                open={openIds.has(card.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        )
      ) : (
        connection !== "disconnected" && (
          <div
            role="status"
            aria-label="Memuat insiden"
            className="h-32 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        )
      )}
    </section>
  );
}
