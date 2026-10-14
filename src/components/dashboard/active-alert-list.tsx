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
import {
  AnomalySubject,
  subjectLabel,
  useSubjectLookup,
} from "./anomaly-subject";
import { SeverityBadge } from "./status-badge";

// Dipakai di halaman Alert dan di rincian kartu insiden; `label` dan
// `caption` membedakan keduanya bagi pembaca layar, dan `maxHeight` membatasi
// tingginya. Tombol "Tandai ditangani" hanya ada bila `onHandle` diberikan:
// halaman Alert memberikannya, rincian kartu insiden tidak. Tombolnya di bawah
// jenis dan tingkat alert, bukan di kolom sendiri di ujung kanan: tabel ini sudah
// perlu digulir mendatar di banyak layar, dan tindakan utama tidak boleh
// tersembunyi di balik gulir.
export function AlertTable({
  alerts,
  now,
  label = "Daftar alert aktif",
  caption = "Alert yang masih berjalan, dari yang paling genting dan paling baru; waktu mulai ditulis sampai detik beserta sumber waktunya",
  maxHeight = "max-h-[36rem]",
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
      // relative: teks sr-only di dalam sel bersifat absolute; tanpa penampung
      // berposisi ia lolos dari overflow dan melebarkan seluruh halaman.
      className={cn("relative overflow-auto rounded-lg border", maxHeight)}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <table className="w-full min-w-[58rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Waktu mulai
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Alert
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Subjek
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Keterangan
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Lokasi
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Peta
            </th>
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 ? (
            <tr className="border-t">
              <td
                colSpan={6}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                <CircleCheck
                  className="mx-auto mb-2 size-6 text-success"
                  aria-hidden="true"
                />
                Tidak ada alert aktif. Semua jaringan normal.
              </td>
            </tr>
          ) : (
            alerts.map((alert) => (
              <tr
                key={alert.id}
                data-testid="alert-row"
                data-alert-id={alert.id}
                data-severity={alert.severity}
                className={cn(
                  "border-t",
                  alert.severity === "critical" && "bg-destructive/5",
                )}
              >
                <td className="px-4 py-3 whitespace-nowrap">
                  <AlertTime alert={alert} now={now} />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {alertKindLabel(alert)}
                  </div>
                  <div className="mt-1">
                    <SeverityBadge severity={alert.severity} />
                  </div>
                  {onHandle && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      data-testid="handle-alert"
                      // Namanya memuat tulisan yang terlihat, ditambah alert yang
                      // mana (jenis, subjek, dan waktu mulai sampai detik, supaya dua
                      // alert sejenis pada subjek yang sama tetap bisa dibedakan):
                      // tombol yang sama muncul di setiap baris.
                      aria-label={`Tandai ditangani: ${alertKindLabel(alert)}, ${subjectLabel(alert, lookup)}, mulai ${formatAlertTime(alert.startedAt, now)}`}
                      onClick={() => onHandle(alert)}
                    >
                      <CircleCheckBig aria-hidden="true" />
                      Tandai ditangani
                    </Button>
                  )}
                  {onRespond && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 ml-2"
                      data-testid="respond-alert"
                      aria-label={`Tanggapi tiket: ${alertKindLabel(alert)}, ${subjectLabel(alert, lookup)}, mulai ${formatAlertTime(alert.startedAt, now)}`}
                      onClick={() => onRespond(alert)}
                    >
                      <MessageSquarePlus aria-hidden="true" />
                      Tanggapi / Tiket
                    </Button>
                  )}
                  {tickets?.[alert.id] && (
                    <div
                      data-testid="ticket-status-chip"
                      data-status={tickets[alert.id].status}
                      className="mt-2 inline-flex rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium"
                    >
                      {alertTicketStatusLabels[tickets[alert.id].status]}
                      {tickets[alert.id].technicianName
                        ? ` - ${tickets[alert.id].technicianName}`
                        : ""}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AnomalySubject anomaly={alert} lookup={lookup} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {describeAnomaly(alert)}
                </td>
                <td className="px-4 py-3">
                  <AlertPlace location={alert.location} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <HighlightOnMap alert={alert} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
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
      className="flex flex-wrap gap-2"
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
  return (
    <Card
      data-testid="active-alerts"
      data-count={summary?.total}
      data-critical={summary?.critical}
      data-warning={summary?.warning}
      data-tone={summary?.tone}
    >
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex flex-col gap-2">
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
        {alerts ? (
          <AlertTable
            alerts={alerts}
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
