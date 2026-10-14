"use client";

import { memo, useCallback, useId, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleCheck, MapPin } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatInteger } from "@/lib/dashboard/format";
import {
  causeLabels,
  confidenceLabels,
  rootSourceLabels,
  summarizeIncidentCards,
  type IncidentCard,
} from "@/lib/dashboard/incident-cards";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { mapFocusHref } from "@/lib/dashboard/map-focus";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useNowMinute } from "@/lib/dashboard/use-now";
import { AlertTable } from "./active-alert-list";
import { AlertTime } from "./alert-time";
import { RunningDuration } from "./running-duration";
import { SeverityBadge } from "./status-badge";

// Garis tepi kiri menandai tingkat; tulisan tingkatnya tetap ada di lencana.
const edgeClass = {
  critical: "border-l-destructive",
  warning: "border-l-warning",
  info: "border-l-border",
} as const;

function impactText(card: IncidentCard) {
  const served = formatInteger(card.servedCustomers);
  return card.affectedCustomers > 0
    ? `${formatInteger(card.affectedCustomers)} pelanggan terbukti terdampak, dari ${served} yang dilayani`
    : `Belum ada pelanggan terbukti terdampak; melayani ${served} pelanggan`;
}

function CardDetails({ card, now }: { card: IncidentCard; now: number }) {
  return (
    <div
      className="mt-4 flex flex-col gap-4 border-t pt-4"
      data-testid="incident-details"
    >
      <section aria-label="Alasan pengelompokan">
        <h4 className="text-sm font-medium">Mengapa dikelompokkan</h4>
        {card.reasons.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
            {card.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Tidak ada alert lain yang berkaitan dengan yang ini.
          </p>
        )}
      </section>
      <AlertTable
        alerts={card.alerts}
        now={now}
        label={`Alert dalam insiden ${card.title}`}
        caption={`Alert anggota insiden ${card.title}, dari yang paling dulu mulai; waktu mulai sampai detik beserta sumber waktunya`}
        maxHeight="max-h-80"
      />
    </div>
  );
}

// Dimemoisasi: kartu yang isinya tidak berubah (objek yang sama dari store) dan
// tidak dibuka atau ditutup tidak digambar ulang saat kartu lain berubah.
const IncidentCardView = memo(function IncidentCardView({
  card,
  now,
  open,
  onToggle,
}: {
  card: IncidentCard;
  now: number;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const base = useId();
  const titleId = `${base}-title`;
  const panelId = `${base}-panel`;
  const focusHref =
    card.focusCustomerId === null ? null : mapFocusHref(card.focusCustomerId);

  return (
    <article
      aria-labelledby={titleId}
      data-testid="incident-card"
      data-card-id={card.id}
      data-cause={card.cause}
      data-severity={card.severity}
      data-alert-count={card.alertCount}
      data-affected={card.affectedCustomers}
      data-served={card.servedCustomers}
      data-expanded={open}
      className={cn(
        "min-w-0 rounded-xl border border-l-4 bg-card p-5 text-card-foreground shadow-sm",
        edgeClass[card.severity],
        // Yang terbuka melebar ke dua kolom supaya tabel rinciannya lega.
        open && "lg:col-span-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={card.severity} />
        <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium">
          {causeLabels[card.cause]}
        </span>
        {card.confidence && (
          <span className="text-xs text-muted-foreground">
            {confidenceLabels[card.confidence]}
          </span>
        )}
      </div>
      <h3 id={titleId} className="mt-2 text-base font-semibold">
        {card.title}
      </h3>

      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Sumber akar</dt>
          <dd data-testid="incident-root">
            {rootSourceLabels[card.rootSource.kind]}: {card.rootSource.name}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Terdampak</dt>
          <dd data-testid="incident-impact">{impactText(card)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {formatInteger(card.alertCount)} alert
          </dt>
          <dd data-testid="incident-kinds">
            {card.kinds
              .map(
                ({ kind, count }) =>
                  `${formatInteger(count)} ${incidentLabels[kind].toLowerCase()}`,
              )
              .join(", ")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Mulai</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3">
            <AlertTime alert={card} now={now} />
            <span className="text-xs text-muted-foreground">
              <RunningDuration
                startedAt={card.startedAt}
                testId="incident-duration"
              />
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          data-testid="incident-toggle"
          onClick={() => onToggle(card.id)}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          />
          {open ? "Sembunyikan rincian" : "Lihat rincian"}
        </Button>
        {focusHref ? (
          <Button variant="outline" size="sm" asChild>
            <Link
              href={focusHref}
              aria-label={`Sorot insiden ${card.title} di peta`}
              data-testid="incident-focus"
            >
              <MapPin aria-hidden="true" />
              Sorot di peta
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Tidak ada titik</span>
        )}
      </div>

      <div id={panelId}>{open && <CardDetails card={card} now={now} />}</div>
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
    <section aria-labelledby="incident-heading" className="flex flex-col gap-3">
      <div>
        <h2
          id="incident-heading"
          className="text-lg font-semibold tracking-tight"
        >
          Insiden aktif
        </h2>
        <p
          role="status"
          className="text-sm text-muted-foreground"
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
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Koneksi data terputus.
          {cards
            ? " Yang tampil adalah insiden terakhir yang diterima."
            : " Insiden belum bisa dimuat."}
        </div>
      )}

      {cards ? (
        cards.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border bg-card px-5 py-6 text-sm text-muted-foreground">
            <CircleCheck className="size-5 text-success" aria-hidden="true" />
            Tidak ada insiden aktif. Semua jaringan normal.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {cards.map((card) => (
              <IncidentCardView
                key={card.id}
                card={card}
                now={now}
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
            className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
          />
        )
      )}
    </section>
  );
}
