"use client";

import { useMemo, useState } from "react";
import {
  CircleCheck,
  CircleCheckBig,
  Info,
  MessageSquarePlus,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import {
  alertTicketStatusLabels,
  getTicketResponses,
  type AlertTicketResponseRecord,
} from "@/lib/dashboard/alert-ticket-actions";
import { AlertTicketDialog } from "./alert-ticket-dialog";
import { cn } from "cn";
import {
  ALERT_CATEGORY_MAP,
  classifyAlertCategory,
  summarizeAlertCategories,
  type AlertCategoryKey,
} from "@/lib/dashboard/alert-categories";
import { AlertCategoryBadge } from "./alert-category-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { describeAnomaly } from "@/lib/dashboard/anomalies";
import {
  formatAlertTime,
  summarizeAlertSeverity,
  type ActiveAlert,
  type SeveritySummary,
} from "@/lib/dashboard/alerts";
import { formatInteger } from "@/lib/dashboard/format";
import {
  alertKindLabel,
  incidentSeverityLabels,
} from "@/lib/dashboard/incidents";
import { AlertPlace } from "./alert-place";
import { AlertTime } from "./alert-time";
import {
  HandledNotice,
  HandleAlertDialog,
  useHandleAlert,
} from "./handle-alert-dialog";
import { HighlightOnMap } from "./highlight-on-map";
import { AlertTrafficEvidence } from "./alert-traffic-evidence";
import {
  AnomalySubject,
  subjectLabel,
  useSubjectLookup,
} from "./anomaly-subject";
import { SeverityBadge } from "./status-badge";

// Gaya panel dan tabel alert yang rapat (acuan ref-folder/Alert  Designn):
// kelas dipasang pada pembungkus, jadi sel dan kepala tabel tidak diulang satu
// per satu. Dipakai juga oleh riwayat alert selesai.
export const alertPanelClass =
  "gap-2 rounded py-3 shadow-none [&_[data-slot=card-header]]:px-3 [&_[data-slot=card-content]]:px-3 [&_[data-slot=card-title]]:text-sm [&_[data-slot=card-description]]:text-xs";

export const alertTableClass = (minWidth: string) =>
  `w-full ${minWidth} text-left text-xs [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-mono [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_td]:px-3 [&_td]:py-2`;

// Kartu alert aktif (acuan ref-folder/Alert  Designn): satu kartu per alert,
// garis tepi kiri menurut tingkatnya. Hanya isian yang memang dimiliki alert
// yang tampil; tidak ada angka telemetri yang dikarang. `label` dan `caption`
// untuk pembaca layar, `maxHeight` membatasi tingginya. Tombol "Tandai
// ditangani" ada di kartu, di samping tombol tiket dan Sorot, jadi tindakan
// utama tidak tersembunyi di balik gulir.
export function AlertCardList({
  alerts,
  now,
  label = "Daftar alert aktif",
  caption = "Alert yang masih berjalan, dari yang paling genting dan paling baru; waktu mulai ditulis sampai detik beserta sumber waktunya",
  maxHeight = "lg:max-h-[calc(100vh-18rem)]",
  onHandle,
  onRespond,
  tickets,
  regionRef,
}: {
  alerts: ActiveAlert[];
  now: number;
  label?: string;
  caption?: string;
  maxHeight?: string;
  onHandle?: (alert: ActiveAlert) => void;
  // Tombol tiket dan chip statusnya; hanya di halaman Alert.
  onRespond?: (alert: ActiveAlert) => void;
  tickets?: Record<string, AlertTicketResponseRecord>;
  // Untuk memindahkan fokus ke daftar setelah barisnya hilang.
  regionRef?: React.Ref<HTMLDivElement>;
}) {
  const lookup = useSubjectLookup();
  return (
    <div
      ref={regionRef}
      className={cn("relative overflow-y-auto", maxHeight)}
      tabIndex={0}
      role="region"
      aria-label={label}
      aria-describedby="alert-cards-caption"
    >
      <p id="alert-cards-caption" className="sr-only">
        {caption}
      </p>
      {alerts.length === 0 ? (
        <div
          data-testid="alert-empty"
          className="rounded border px-3 py-8 text-center text-xs text-muted-foreground"
        >
          <CircleCheck
            className="mx-auto mb-2 size-6 text-success"
            aria-hidden="true"
          />
          Tidak ada alert aktif. Semua jaringan normal.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((alert) => {
            const category = classifyAlertCategory(alert);
            return (
              <li
                key={alert.id}
                data-testid="alert-row"
                data-alert-id={alert.id}
                data-severity={alert.severity}
                data-category={category}
                className={cn(
                  "rounded border bg-card p-2 text-xs",
                  alert.severity === "critical" &&
                    "border-destructive/30 bg-destructive/5 shadow-[inset_2px_0_0_var(--destructive)]",
                  alert.severity === "warning" &&
                    "border-warning/30 shadow-[inset_2px_0_0_var(--warning)]",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b pb-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={alert.severity} />
                    <AlertCategoryBadge category={category} />
                    <span className="font-mono font-semibold">
                      {alertKindLabel(alert)}
                    </span>
                  </div>
                  <AlertTime alert={alert} now={now} />
                </div>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  <div className="min-w-0">
                    <AnomalySubject anomaly={alert} lookup={lookup} />
                  </div>
                  <div className="min-w-0 rounded border bg-muted/30 p-1.5 font-mono text-[11px]">
                    <p className="text-muted-foreground">
                      {describeAnomaly(alert)}
                    </p>
                    <div className="mt-0.5">
                      <AlertPlace location={alert.location} />
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t pt-1.5">
                  <div className="min-w-0">
                    {tickets?.[alert.id] && (
                      <div
                        data-testid="ticket-status-chip"
                        data-status={tickets[alert.id].status}
                        className="inline-flex rounded border bg-secondary px-2 py-0.5 font-mono text-[11px] font-medium"
                      >
                        {alertTicketStatusLabels[tickets[alert.id].status]}
                        {tickets[alert.id].technicianName
                          ? ` - ${tickets[alert.id].technicianName}`
                          : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <HighlightOnMap alert={alert} />
                    <AlertTrafficEvidence alert={alert} />
                    {onRespond && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="respond-alert"
                        aria-label={`Tanggapi tiket: ${alertKindLabel(alert)}, ${subjectLabel(alert, lookup)}, mulai ${formatAlertTime(alert.startedAt, now)}`}
                        onClick={() => onRespond(alert)}
                      >
                        <MessageSquarePlus aria-hidden="true" />
                        Tanggapi / Tiket
                      </Button>
                    )}
                    {onHandle && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="handle-alert"
                        // Namanya memuat tulisan yang terlihat, ditambah alert yang
                        // mana (jenis, subjek, dan waktu mulai sampai detik, supaya dua
                        // alert sejenis pada subjek yang sama tetap bisa dibedakan):
                        // tombol yang sama muncul di setiap kartu.
                        aria-label={`Tandai ditangani: ${alertKindLabel(alert)}, ${subjectLabel(alert, lookup)}, mulai ${formatAlertTime(alert.startedAt, now)}`}
                        onClick={() => onHandle(alert)}
                      >
                        <CircleCheckBig aria-hidden="true" />
                        Tandai ditangani
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const chipTones = {
  critical: {
    Icon: OctagonAlert,
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  warning: {
    Icon: TriangleAlert,
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  info: {
    Icon: Info,
    className: "border-border bg-secondary text-foreground",
  },
  ok: {
    Icon: CircleCheck,
    className: "border-success/40 bg-success/10 text-success",
  },
} as const;

function SeverityChip({
  tone,
  children,
}: {
  tone: keyof typeof chipTones;
  children: React.ReactNode;
}) {
  const { Icon, className } = chipTones[tone];
  return (
    <span
      data-testid="severity-chip"
      data-severity={tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

// Berapa alert di tiap tingkat, ditulis dengan angka dan kata (bukan hanya
// warna). Hanya tingkat yang ada isinya; tanpa alert sama sekali: "Semua normal".
function SeverityChips({ summary }: { summary: SeveritySummary }) {
  return (
    <div
      role="group"
      aria-label="Jumlah alert aktif menurut tingkatnya"
      className="flex w-full flex-wrap gap-2"
    >
      {summary.total === 0 ? (
        <SeverityChip tone="ok">Semua normal</SeverityChip>
      ) : (
        (["critical", "warning", "info"] as const)
          .filter((severity) => summary[severity] > 0)
          .map((severity) => (
            <SeverityChip key={severity} tone={severity}>
              {formatInteger(summary[severity])}{" "}
              {incidentSeverityLabels[severity].toLowerCase()}
            </SeverityChip>
          ))
      )}
    </div>
  );
}

// Kartu daftar pertama di halaman Alert: yang masih berjalan, dengan hitungan
// per tingkat di kepalanya. Datanya datang dari AlertBoard, yang memuatnya
// bersama riwayat; `alerts` null berarti belum termuat. `operator` adalah nama
// petugas yang masuk: atas namanya alert ditandai ditangani.
export function ActiveAlertList({
  alerts,
  now,
  operator,
}: {
  alerts: ActiveAlert[] | null;
  now: number;
  operator: string;
}) {
  const summary = alerts ? summarizeAlertSeverity(alerts) : null;
  const handle = useHandleAlert(operator);
  const [ticketAlert, setTicketAlert] = useState<ActiveAlert | null>(null);
  // Dinaikkan tiap tanggapan tersimpan agar chip membaca ulang penyimpanan.
  const [ticketVersion, setTicketVersion] = useState(0);
  const tickets = useMemo(() => {
    void ticketVersion;
    const map: Record<string, AlertTicketResponseRecord> = {};
    for (const record of getTicketResponses()) map[record.alertId] = record;
    return map;
  }, [ticketVersion, alerts]);
  const [categoryFilter, setCategoryFilter] = useState<AlertCategoryKey>("all");
  const categoryCounts = useMemo(
    () => (alerts ? summarizeAlertCategories(alerts) : null),
    [alerts],
  );
  const displayedAlerts = useMemo(() => {
    if (!alerts) return null;
    if (categoryFilter === "all") return alerts;
    return alerts.filter((a) => classifyAlertCategory(a) === categoryFilter);
  }, [alerts, categoryFilter]);
  return (
    <Card
      className={alertPanelClass}
      data-testid="active-alerts"
      data-count={summary?.total}
      data-critical={summary?.critical}
      data-warning={summary?.warning}
      data-tone={summary?.tone}
    >
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <CardTitle>Daftar alert aktif</CardTitle>
          <CardDescription role="status">
            {alerts
              ? `${formatInteger(alerts.length)} alert sedang berjalan`
              : "Memuat alert…"}
            {handle.done && <HandledNotice alert={handle.done} now={now} />}
          </CardDescription>
        </div>
        {summary && <SeverityChips summary={summary} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {alerts && alerts.length > 0 && categoryCounts && (
          <div
            role="tablist"
            aria-label="Filter kategori alert"
            className="flex flex-wrap items-center gap-1.5 border-b pb-2 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={categoryFilter === "all"}
              data-testid="filter-cat-all"
              onClick={() => setCategoryFilter("all")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors border cursor-pointer",
                categoryFilter === "all"
                  ? "bg-secondary text-foreground border-border font-semibold shadow-2xs"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground",
              )}
            >
              <span>Semua Kategori</span>
              <span className="rounded-full bg-background/80 px-1.5 py-0.2 font-mono text-[10px] text-foreground border border-border/50">
                {formatInteger(categoryCounts.all)}
              </span>
            </button>
            {(["core", "optical", "customer", "other"] as const).map((key) => {
              const meta = ALERT_CATEGORY_MAP[key];
              const count = categoryCounts[key];
              const Icon = meta.Icon;
              const isSelected = categoryFilter === key;
              if (count === 0 && !isSelected) return null;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`filter-cat-${key}`}
                  onClick={() => setCategoryFilter(key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors border cursor-pointer",
                    isSelected
                      ? "bg-secondary text-foreground border-border font-semibold shadow-2xs"
                      : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{meta.label}</span>
                  <span className="rounded-full bg-background/80 px-1.5 py-0.2 font-mono text-[10px] text-foreground border border-border/50">
                    {formatInteger(count)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {displayedAlerts ? (
          <AlertCardList
            alerts={displayedAlerts}
            now={now}
            onHandle={handle.request}
            onRespond={setTicketAlert}
            tickets={tickets}
            regionRef={handle.regionRef}
          />
        ) : (
          <div
            role="status"
            aria-label="Memuat daftar alert"
            className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        )}
        <p className="text-xs text-muted-foreground">
          Waktu mulai ditulis sampai detik. <strong>dari router</strong>:
          dicatat router saat kejadian. <strong>polling ±N</strong>: backend
          baru mengetahuinya lewat polling, jadi kejadian sebenarnya bisa sampai
          N lebih awal. <strong>Tandai ditangani</strong> memindahkan alert ke
          riwayat setelah Anda mengonfirmasi.
        </p>
      </CardContent>
      <AlertTicketDialog
        alert={ticketAlert}
        operator={operator}
        now={now}
        onOpenChange={(open) => {
          if (!open) setTicketAlert(null);
        }}
        onSaved={() => setTicketVersion((v) => v + 1)}
      />
      <HandleAlertDialog
        controller={handle}
        alerts={alerts}
        operator={operator}
        now={now}
      />
    </Card>
  );
}
