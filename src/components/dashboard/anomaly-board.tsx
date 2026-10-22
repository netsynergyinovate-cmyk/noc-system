"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  CircleDot,
  Clock,
  Cpu,
  EthernetPort,
  Gauge,
  ListChecks,
  Siren,
  SignalLow,
  TrendingUp,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ANOMALY_WINDOW_SECONDS,
  anomalyRules,
  describeAnomaly,
  isActive,
  summarizeAnomalies,
  summarizeByKind,
  type Anomaly,
} from "@/lib/dashboard/anomalies";
import {
  formatElapsed,
  formatInteger,
  isoDuration,
} from "@/lib/dashboard/format";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { loadAnomalies } from "@/lib/dashboard/anomaly-feed";
import {
  defaultAnomalyFilters,
  facetCounts,
  filterAnomalies,
  hasActiveAnomalyFilters,
  type AnomalyFilters,
} from "@/lib/dashboard/anomaly-filter";
import {
  getReviewedAnomalies,
  markAnomalyReviewed,
  type ReviewedEntry,
} from "@/lib/dashboard/anomaly-detail-logic";
import { useSession, useSessionUser } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { loadLiveAnomalies } from "@/lib/dashboard/anomaly-feed-live";
import { usePolled } from "@/lib/dashboard/use-polled";
import type { IncidentKind } from "@/lib/dashboard/types";
import { AnomalyFilterBar } from "./anomaly-filters";
import { AnomalyDetailDialog } from "./anomaly-detail-dialog";
import { IncidentCardList } from "./incident-card-list";
import {
  AnomalySubject,
  subjectLabel,
  useSubjectLookup,
  type SubjectLookup,
} from "./anomaly-subject";
import { DiagnoseButton } from "./diagnose-button";
import { MetricCard } from "./metric-card";
import { RunningDuration } from "./running-duration";
import { SeverityBadge } from "./status-badge";

const REFRESH_MS = 30_000;
const NO_REVIEWS: Record<string, ReviewedEntry> = {};

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

interface Loaded {
  anomalies: Anomaly[];
  now: number;
}

// Memuat daftar anomali dan menyegarkannya berkala, supaya anomali yang baru
// muncul dan lamanya yang masih berjalan ikut bertambah.
function useAnomalies() {
  // Mode live membaca tabel alerts (rule engine Go); demo memakai data tiruan.
  const isDemo = useSession(selectPreviewEnabled);
  const { state, failed, retry } = usePolled(
    isDemo ? loadAnomalies : loadLiveAnomalies,
    REFRESH_MS,
  );
  const loaded: Loaded | null = state
    ? { anomalies: state.data, now: state.now }
    : null;
  return { loaded, failed, retry };
}

function SummaryCards({ anomalies, now }: Loaded) {
  const summary = useMemo(
    () => summarizeAnomalies(anomalies, now),
    [anomalies, now],
  );
  const topTitle = summary.topKind
    ? anomalyRules.find((rule) => rule.kind === summary.topKind!.kind)!.title
    : null;
  const days = ANOMALY_WINDOW_SECONDS / 86400;
  return (
    <section
      aria-label="Ringkasan anomali"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <MetricCard
        label="Anomali aktif"
        value={formatInteger(summary.active)}
        hint={`${formatInteger(summary.activeCritical)} kritis, ${formatInteger(summary.activeWarning)} peringatan`}
        Icon={Siren}
        tone={
          summary.activeCritical > 0
            ? "danger"
            : summary.active > 0
              ? "warning"
              : "success"
        }
      />
      <MetricCard
        label="24 jam terakhir"
        value={formatInteger(summary.last24h)}
        hint={`${formatInteger(summary.last24hResolved)} sudah selesai`}
        Icon={Clock}
      />
      <MetricCard
        label={`${days} hari terakhir`}
        value={formatInteger(summary.total)}
        hint="Seluruh anomali yang tercatat"
        Icon={ListChecks}
      />
      <MetricCard
        label={topTitle ? `Tersering: ${topTitle}` : "Anomali tersering"}
        value={summary.topKind ? formatInteger(summary.topKind.count) : "—"}
        hint={`kejadian dalam ${days} hari`}
        Icon={TrendingUp}
      />
    </section>
  );
}

const kindIcons: Record<IncidentKind, LucideIcon> = {
  queue: Gauge,
  cpu: Cpu,
  port: EthernetPort,
  optical: SignalLow,
  offline: WifiOff,
};

// Satu kartu per jenis gangguan, selalu lengkap walau belum pernah muncul,
// supaya petugas melihat sekilas jenis mana yang sedang bermasalah.
function KindCards({
  anomalies,
  now,
  selected,
  onToggle,
}: Loaded & {
  selected: IncidentKind | "all";
  onToggle: (kind: IncidentKind) => void;
}) {
  const kinds = useMemo(
    () => summarizeByKind(anomalies, now),
    [anomalies, now],
  );
  const days = ANOMALY_WINDOW_SECONDS / 86400;
  return (
    <section aria-labelledby="kind-heading" className="flex flex-col gap-3">
      <h2 id="kind-heading" className="text-lg font-semibold tracking-tight">
        Per jenis gangguan
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {kinds.map((summary) => {
          const rule = anomalyRules.find(
            (candidate) => candidate.kind === summary.kind,
          )!;
          const latest = summary.latest;
          return (
            <MetricCard
              key={summary.kind}
              data-testid="kind-card"
              data-kind={summary.kind}
              data-active={summary.active}
              data-last24h={summary.last24h}
              data-total={summary.total}
              data-selected={selected === summary.kind}
              className={cn(selected === summary.kind && "ring-2 ring-ring")}
              label={rule.title}
              value={formatInteger(summary.active)}
              hint={summary.active > 0 ? "aktif sekarang" : "normal"}
              Icon={kindIcons[summary.kind]}
              tone={
                summary.worstActive === "critical"
                  ? "danger"
                  : summary.worstActive
                    ? "warning"
                    : "success"
              }
            >
              <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
                {summary.worstActive && (
                  <div>
                    <SeverityBadge severity={summary.worstActive} />
                  </div>
                )}
                <p>Batas: {rule.limit}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
                  <dt>24 jam</dt>
                  <dd className="text-right font-medium text-foreground tabular-nums">
                    {formatInteger(summary.last24h)}
                  </dd>
                  <dt>{days} hari</dt>
                  <dd className="text-right font-medium text-foreground tabular-nums">
                    {formatInteger(summary.total)}
                  </dd>
                </dl>
                <p>
                  {latest
                    ? `Terakhir ${timeFormat.format(new Date(latest.startedAt * 1000))}, ${isActive(latest) ? "masih aktif" : "selesai"}`
                    : "Belum pernah muncul"}
                </p>
                <Button
                  type="button"
                  variant={selected === summary.kind ? "default" : "outline"}
                  size="sm"
                  className="mt-1 h-8 w-full text-xs"
                  aria-pressed={selected === summary.kind}
                  data-testid="kind-filter"
                  onClick={() => onToggle(summary.kind)}
                >
                  {selected === summary.kind
                    ? "Menyaring jenis ini"
                    : "Saring jenis ini"}
                </Button>
              </div>
            </MetricCard>
          );
        })}
      </div>
    </section>
  );
}

function StatusCell({ anomaly }: { anomaly: Anomaly }) {
  if (isActive(anomaly)) {
    return (
      <div>
        <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
          <CircleDot className="size-3.5" aria-hidden="true" />
          Aktif
        </span>
        <div className="text-xs text-muted-foreground">
          <RunningDuration startedAt={anomaly.startedAt} />
        </div>
      </div>
    );
  }
  // Yang sudah selesai: lama tetap, dihitung dari awal dan akhirnya.
  const elapsed = (anomaly.endedAt ?? anomaly.startedAt) - anomaly.startedAt;
  return (
    <div>
      <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
        <CircleCheck className="size-3.5" aria-hidden="true" />
        Selesai
      </span>
      <div className="text-xs text-muted-foreground">
        <time dateTime={isoDuration(elapsed)} data-testid="anomaly-duration">
          selama {formatElapsed(elapsed)}
        </time>
      </div>
    </div>
  );
}

function AnomalyTable({
  anomalies,
  total,
  onReset,
  lookup,
  reviewed,
  onDetail,
}: {
  anomalies: Anomaly[];
  // Banyaknya anomali sebelum disaring.
  total: number;
  onReset: () => void;
  lookup: SubjectLookup;
  reviewed: Record<string, ReviewedEntry>;
  onDetail: (anomaly: Anomaly) => void;
}) {
  const days = ANOMALY_WINDOW_SECONDS / 86400;

  return (
    <div
      className="max-h-[36rem] overflow-auto rounded-lg border"
      tabIndex={0}
      role="region"
      aria-label="Daftar anomali"
    >
      <table className="w-full min-w-[48rem] text-left text-sm">
        <caption className="sr-only">
          Anomali jaringan {days} hari terakhir: yang masih aktif di atas, lalu
          yang sudah selesai
        </caption>
        <thead className="sticky top-0 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Mulai
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Anomali
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Subjek
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Keterangan
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody>
          {anomalies.length === 0 ? (
            <tr className="border-t">
              <td
                colSpan={6}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                {total === 0 ? (
                  <>Tidak ada anomali dalam {days} hari terakhir.</>
                ) : (
                  <>
                    <p>Tidak ada anomali yang cocok dengan filter.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={onReset}
                    >
                      Tampilkan semua anomali
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ) : (
            anomalies.map((anomaly) => {
              return (
                <tr
                  key={anomaly.id}
                  data-testid="anomaly-row"
                  data-anomaly-id={anomaly.id}
                  data-active={isActive(anomaly)}
                  className={cn("border-t", isActive(anomaly) && "bg-muted/40")}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                    {timeFormat.format(new Date(anomaly.startedAt * 1000))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {incidentLabels[anomaly.kind]}
                    </div>
                    <div className="mt-1">
                      <SeverityBadge severity={anomaly.severity} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <AnomalySubject anomaly={anomaly} lookup={lookup} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {describeAnomaly(anomaly)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusCell anomaly={anomaly} />
                    {reviewed[anomaly.id] && (
                      <Badge
                        variant="secondary"
                        className="mt-1"
                        data-testid="anomaly-reviewed-badge"
                      >
                        Ditinjau
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="view-anomaly-detail-btn"
                        onClick={() => onDetail(anomaly)}
                      >
                        Rincian
                      </Button>
                      {anomaly.customerId && (
                        <DiagnoseButton
                          customerId={anomaly.customerId}
                          customerName={subjectLabel(anomaly, lookup)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function RulesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aturan deteksi</CardTitle>
        <CardDescription>
          Backend memeriksa aturan ini terus-menerus; anomali dicatat saat mulai
          dan saat selesai.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
          {anomalyRules.map((rule) => (
            <li key={rule.kind} data-testid="anomaly-rule">
              <p className="text-sm font-medium">{rule.title}</p>
              <p className="text-sm text-muted-foreground">
                {rule.description}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Skeleton({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-lg bg-muted motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function AnomalyBoard() {
  const { loaded, failed, retry } = useAnomalies();
  const [filters, setFilters] = useState<AnomalyFilters>(defaultAnomalyFilters);
  const lookup = useSubjectLookup();
  const user = useSessionUser();
  // null = belum hidrasi; localStorage hanya ada di browser.
  const [reviewedState, setReviewed] = useState<Record<
    string,
    ReviewedEntry
  > | null>(null);
  const reviewed = reviewedState ?? NO_REVIEWS;
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReviewed(getReviewedAnomalies()));
    return () => cancelAnimationFrame(id);
  }, []);
  const routerOptions = useMemo(
    () => [...lookup.routerNames].map(([id, name]) => ({ id, name })),
    [lookup],
  );
  const visible = useMemo(
    () => (loaded ? filterAnomalies(loaded.anomalies, filters, lookup) : []),
    [loaded, filters, lookup],
  );
  const counts = useMemo(
    () => (loaded ? facetCounts(loaded.anomalies, filters, lookup) : null),
    [loaded, filters, lookup],
  );
  const detail =
    (detailId && loaded?.anomalies.find((a) => a.id === detailId)) || null;
  const markReviewed = (anomaly: Anomaly) => {
    markAnomalyReviewed(anomaly.id, user?.name || user?.email || "Operator");
    setReviewed(getReviewedAnomalies());
  };
  const filtered = hasActiveAnomalyFilters(filters);
  const resetFilters = () => setFilters(defaultAnomalyFilters);
  const toggleKind = (kind: IncidentKind) =>
    setFilters((current) => ({
      ...current,
      kind: current.kind === kind ? "all" : kind,
    }));

  return (
    <div className="flex flex-col gap-6" data-testid="anomaly-board">
      <Badge
        variant="outline"
        className="h-auto gap-1.5 whitespace-normal py-1 text-xs font-normal"
        data-testid="anomaly-mock-badge"
      >
        Data Tiruan Anomali (Fase 2) · Wajib beralih ke Rule Engine nyata di
        Fase 5
      </Badge>
      {loaded ? (
        <>
          <SummaryCards {...loaded} />
          <IncidentCardList />
          <KindCards
            {...loaded}
            selected={filters.kind}
            onToggle={toggleKind}
          />
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-32" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-52" />
            ))}
          </div>
        </>
      )}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Daftar anomali</CardTitle>
          <CardDescription role="status">
            {loaded
              ? filtered
                ? `Menampilkan ${formatInteger(visible.length)} dari ${formatInteger(loaded.anomalies.length)} anomali dalam ${ANOMALY_WINDOW_SECONDS / 86400} hari terakhir`
                : `${formatInteger(loaded.anomalies.length)} anomali dalam ${ANOMALY_WINDOW_SECONDS / 86400} hari terakhir`
              : "Memuat anomali…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {failed && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {loaded
                ? "Pembaruan terakhir gagal; yang tampil adalah data sebelumnya."
                : "Anomali belum bisa dimuat."}
              <Button variant="outline" size="sm" onClick={retry}>
                Coba lagi
              </Button>
            </div>
          )}
          {loaded && counts && (
            <AnomalyFilterBar
              filters={filters}
              counts={counts}
              routers={routerOptions}
              onChange={setFilters}
            />
          )}
          {loaded ? (
            <AnomalyTable
              anomalies={visible}
              total={loaded.anomalies.length}
              onReset={resetFilters}
              lookup={lookup}
              reviewed={reviewed}
              onDetail={(anomaly) => setDetailId(anomaly.id)}
            />
          ) : (
            !failed && (
              <div
                role="status"
                aria-label="Memuat daftar anomali"
                className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
              />
            )
          )}
        </CardContent>
      </Card>
      <RulesCard />
      <AnomalyDetailDialog
        anomaly={detail}
        lookup={lookup}
        review={detail ? (reviewed[detail.id] ?? null) : null}
        onMarkReviewed={markReviewed}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
