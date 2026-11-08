"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  CircleDot,
  Clock,
  ListChecks,
  RefreshCw,
  Siren,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { useSessionUser } from "@/components/session-provider";
import {
  loadLiveAnomalies,
  subscribeAnomalyWs,
} from "@/lib/dashboard/anomaly-feed-live";
import {
  anomalyRangeInfo,
  anomalyRangeStart,
  anomalyRanges,
  initialAnomalyRange,
  type AnomalyRange,
  type AnomalyRangeInfo,
} from "@/lib/dashboard/anomaly-range";
import { usePolled } from "@/lib/dashboard/use-polled";
import type { IncidentKind } from "@/lib/dashboard/types";
import { AnomalyFilterBar } from "./anomaly-filters";
import { AnomalyDetailDialog } from "./anomaly-detail-dialog";
import { IncidentCardList } from "./incident-card-list";
import { CustomerIncidentList } from "./customer-incident-list";
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
import {
  KindIcon,
  KindInfoDisclosure,
  KindMiniVisual,
  anomalyKindInfo,
  kindMeta,
} from "./anomaly-kind-visual";

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
  // Yang tampil: aktif ditambah riwayat dalam periode.
  anomalies: Anomaly[];
  // Seluruh yang dimuat (paling sedikit 24 jam terakhir), untuk kartu 24 jam.
  recent: Anomaly[];
  // Total anomali selesai pada periode menurut database, atau null bila tidak diketahui.
  resolvedTotal: number | null;
  now: number;
}

// Memuat daftar anomali dan menyegarkannya berkala, supaya anomali yang baru
// muncul dan lamanya yang masih berjalan ikut bertambah.
function useAnomalies(range: AnomalyRange) {
  // Selalu membaca data live dari tabel alerts (rule engine Go)
  const load = useMemo(
    () => async (nowSec: number) => ({
      ...(await loadLiveAnomalies(nowSec, range)),
      range,
    }),
    [range],
  );
  const { state, failed, retry } = usePolled(load, REFRESH_MS);
  const loaded: Loaded | null = useMemo(() => {
    // Data periode sebelumnya tidak ditampilkan sebagai periode ini.
    if (!state || state.data.range !== range) return null;
    // Riwayat dimuat paling sedikit 24 jam; yang di luar periode dibuang dari
    // daftar, tetapi tetap dipakai untuk kartu 24 jam. Yang aktif selalu ikut.
    const start = anomalyRangeStart(range, state.now);
    const anomalies =
      start === null
        ? state.data.anomalies
        : // Sama dengan API: yang selesai dihitung dari waktu selesainya.
          state.data.anomalies.filter(
            (a) => isActive(a) || (a.endedAt ?? a.startedAt) >= start,
          );
    return {
      anomalies,
      recent: state.data.anomalies,
      resolvedTotal: state.data.resolvedTotal,
      now: state.now,
    };
  }, [state, range]);
  useEffect(() => {
    return subscribeAnomalyWs(() => {
      retry();
    });
  }, [retry]);

  return { loaded, failed, retry };
}

function SummaryCards({
  anomalies,
  recent,
  resolvedTotal,
  now,
  range,
}: Loaded & { range: AnomalyRangeInfo }) {
  const summary = useMemo(
    () => summarizeAnomalies(anomalies, now),
    [anomalies, now],
  );
  // Kartu 24 jam tidak ikut periode: "hari ini" tetap menghitung 24 jam utuh.
  const last24 = useMemo(() => summarizeAnomalies(recent, now), [recent, now]);
  const loadedResolved = anomalies.filter((a) => !isActive(a)).length;
  // Angka selesai dari database bila diketahui; selain itu yang dimuat.
  const resolved = resolvedTotal ?? loadedResolved;
  const truncated = resolvedTotal !== null && loadedResolved < resolvedTotal;
  const total = summary.active + resolved;
  const topTitle = summary.topKind
    ? anomalyRules.find((rule) => rule.kind === summary.topKind!.kind)!.title
    : null;
  const n = formatInteger;

  return (
    <section
      aria-label="Ringkasan anomali"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2"
    >
      <MetricCard
        label="Anomali aktif"
        value={n(summary.active)}
        hint={`${n(summary.activeCritical)} kritis, ${n(summary.activeWarning)} peringatan`}
        title="Alert yang saat ini masih berjalan (belum pulih dan belum ditandai ditangani), dari tabel alerts. Tidak ikut periode."
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
        label="Selesai"
        value={n(resolved)}
        hint={
          truncated
            ? `${range.phrase}; ${n(loadedResolved)} terbaru dimuat`
            : range.phrase
        }
        title="Anomali yang sudah pulih atau ditandai ditangani, dihitung dari waktu selesainya pada periode yang dipilih (total dari database)"
        Icon={CircleCheck}
        tone="success"
      />
      <MetricCard
        label={`Tercatat ${range.phrase}`}
        value={n(total)}
        hint={`${n(summary.active)} aktif · ${n(resolved)} selesai`}
        title="Aktif ditambah selesai pada periode yang dipilih; sama dengan baris di Daftar anomali. Pelanggan tanpa gangguan tidak dihitung."
        Icon={ListChecks}
      />
      <MetricCard
        label="24 jam terakhir"
        value={n(last24.last24h)}
        hint={`${n(last24.last24hResolved)} selesai · ${n(last24.last24h - last24.last24hResolved)} masih aktif`}
        title="Anomali yang mulai dalam 24 jam terakhir, dari tabel alerts; tidak ikut periode yang dipilih"
        Icon={Clock}
      />
      <MetricCard
        label={topTitle ? `Tersering: ${topTitle}` : "Anomali tersering"}
        value={summary.topKind ? n(summary.topKind.count) : "—"}
        hint={`kejadian ${range.phrase}`}
        title="Jenis anomali dengan kejadian terbanyak pada periode yang dipilih"
        Icon={TrendingUp}
      />
    </section>
  );
}

// Satu kartu per jenis gangguan, selalu lengkap walau belum pernah muncul,
// supaya petugas melihat sekilas jenis mana yang sedang bermasalah.
function KindCards({
  anomalies,
  recent,
  now,
  range,
  selected,
  onToggle,
}: Loaded & {
  range: AnomalyRangeInfo;
  selected: IncidentKind | "all";
  onToggle: (kind: IncidentKind) => void;
}) {
  const kinds = useMemo(() => {
    // "24 jam" tidak ikut periode: dihitung dari data 24 jam terakhir yang utuh.
    const last24h = new Map(
      summarizeByKind(recent, now).map((item) => [item.kind, item.last24h]),
    );
    return summarizeByKind(anomalies, now).map((item) => ({
      ...item,
      last24h: last24h.get(item.kind) ?? item.last24h,
    }));
  }, [anomalies, recent, now]);

  return (
    <section aria-labelledby="kind-heading" className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h2
          id="kind-heading"
          className="text-xs font-semibold uppercase tracking-wider text-foreground"
        >
          Per jenis gangguan
        </h2>
        <span className="text-[11px] text-muted-foreground font-mono">
          Evaluasi real-time threshold parameter
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {kinds.map((summary) => {
          const rule = anomalyRules.find(
            (candidate) => candidate.kind === summary.kind,
          )!;
          const meta = kindMeta[summary.kind];
          const activeOfKind = anomalies.filter(
            (a) => a.kind === summary.kind && isActive(a),
          );
          // Cari anomali aktif dengan nilai terburuk untuk ditampilkan di mini visual
          const worstActiveAnomaly =
            activeOfKind.length > 0
              ? activeOfKind.reduce((prev, curr) => {
                  if (summary.kind === "optical") {
                    return (curr.measured ?? 0) < (prev.measured ?? 0)
                      ? curr
                      : prev;
                  }
                  return (curr.measured ?? 0) > (prev.measured ?? 0)
                    ? curr
                    : prev;
                }, activeOfKind[0])
              : summary.latest;

          return (
            <div
              key={summary.kind}
              data-testid="kind-card"
              data-kind={summary.kind}
              data-active={summary.active}
              data-last24h={summary.last24h}
              data-total={summary.total}
              data-selected={selected === summary.kind}
              className={cn(
                "rounded-lg border bg-card p-3 flex flex-col justify-between shadow-2xs hover:border-border/80 transition-all gap-2",
                selected === summary.kind &&
                  "ring-2 ring-ring border-primary/50",
              )}
            >
              <div>
                <div className="flex items-start justify-between gap-1.5">
                  <div className="min-w-0">
                    <span className="text-[11px] text-muted-foreground font-medium block truncate">
                      {rule.title}
                    </span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-xl font-bold font-mono tracking-tight text-foreground leading-none">
                        {formatInteger(summary.active)}
                      </span>
                      {summary.worstActive ? (
                        <SeverityBadge severity={summary.worstActive} />
                      ) : (
                        <span className="text-[11px] text-success font-medium">
                          normal
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "size-7 rounded-md border flex items-center justify-center shrink-0",
                      meta.chip,
                    )}
                  >
                    <KindIcon kind={summary.kind} className={meta.accent} />
                  </div>
                </div>

                <KindMiniVisual
                  kind={summary.kind}
                  worstAnomaly={worstActiveAnomaly}
                />

                <div className="mt-1.5 pt-1.5 border-t border-border/60 space-y-0.5 text-[11px] text-muted-foreground font-mono">
                  <div className="flex justify-between items-center">
                    <span>24 jam</span>
                    <span className="text-foreground font-medium">
                      {formatInteger(summary.last24h)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>{range.short}</span>
                    <span className="text-foreground font-medium">
                      {formatInteger(summary.total)}
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-col gap-1">
                  <KindInfoDisclosure kind={summary.kind} />
                </div>
              </div>

              <Button
                type="button"
                variant={selected === summary.kind ? "default" : "outline"}
                size="sm"
                className="w-full h-7 text-[11px] font-medium mt-1"
                aria-pressed={selected === summary.kind}
                data-testid="kind-filter"
                onClick={() => onToggle(summary.kind)}
              >
                {selected === summary.kind
                  ? "Menyaring jenis ini"
                  : "Saring jenis ini"}
              </Button>
            </div>
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
        <span className="inline-flex items-center gap-1.5 font-medium text-destructive text-[11px]">
          <CircleDot
            className="size-3 animate-ping motion-reduce:animate-none"
            aria-hidden="true"
          />
          Aktif
        </span>
        <div className="text-[11px] text-muted-foreground">
          <RunningDuration startedAt={anomaly.startedAt} />
        </div>
      </div>
    );
  }
  // Yang sudah selesai: lama tetap, dihitung dari awal dan akhirnya.
  const elapsed = (anomaly.endedAt ?? anomaly.startedAt) - anomaly.startedAt;
  return (
    <div>
      <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground text-[11px]">
        <CircleCheck className="size-3 text-success" aria-hidden="true" />
        Selesai
      </span>
      <div className="text-[11px] text-muted-foreground">
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
  range,
  onReset,
  lookup,
  reviewed,
  onDetail,
}: {
  anomalies: Anomaly[];
  total: number;
  range: AnomalyRangeInfo;
  onReset: () => void;
  lookup: SubjectLookup;
  reviewed: Record<string, ReviewedEntry>;
  onDetail: (anomaly: Anomaly) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="max-h-[36rem] overflow-auto rounded-lg border border-border"
        tabIndex={0}
        role="region"
        aria-label="Daftar anomali"
      >
        <table className="w-full min-w-[48rem] text-left text-xs border-collapse">
          <caption className="sr-only">
            Anomali jaringan {range.phrase}: yang masih aktif di atas, lalu yang
            sudah selesai
          </caption>
          <thead className="sticky top-0 bg-muted/90 backdrop-blur text-muted-foreground border-b border-border text-[11px] uppercase tracking-wider font-medium z-10">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Mulai
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Anomali
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Subjek
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Keterangan
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 font-medium text-center">
                Aksi
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 text-card-foreground">
            {anomalies.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {total === 0 ? (
                    <>Tidak ada anomali {range.phrase}.</>
                  ) : (
                    <>
                      <p>Tidak ada anomali yang cocok dengan filter.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 h-8 text-xs"
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
                const meta = kindMeta[anomaly.kind];
                return (
                  <tr
                    key={anomaly.id}
                    data-testid="anomaly-row"
                    data-anomaly-id={anomaly.id}
                    data-active={isActive(anomaly)}
                    className={cn(
                      "hover:bg-muted/30 transition-colors",
                      isActive(anomaly) && "bg-muted/20",
                    )}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground font-mono text-[11px]">
                      {timeFormat.format(new Date(anomaly.startedAt * 1000))}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-medium text-foreground text-[12px]">
                        <KindIcon
                          kind={anomaly.kind}
                          className={cn("size-3.5", meta.accent)}
                        />
                        <span>{incidentLabels[anomaly.kind]}</span>
                      </div>
                      <div className="mt-0.5">
                        <SeverityBadge severity={anomaly.severity} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <AnomalySubject anomaly={anomaly} lookup={lookup} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-[11px]">
                      <div className="text-foreground/90">
                        {describeAnomaly(anomaly)}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusCell anomaly={anomaly} />
                      {reviewed[anomaly.id] && (
                        <Badge
                          variant="secondary"
                          className="mt-1 text-[11px]"
                          data-testid="anomaly-reviewed-badge"
                        >
                          Ditinjau
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          data-testid="view-anomaly-detail-btn"
                          onClick={() => onDetail(anomaly)}
                        >
                          Rincian
                        </Button>
                        {anomaly.customerId && (
                          <DiagnoseButton
                            customerId={anomaly.customerId}
                            customerName={subjectLabel(anomaly, lookup)}
                            size="sm"
                            className="h-7 px-2 text-[11px]"
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

      {/* Pager strip matching reference */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground px-1 pt-0.5 gap-1.5">
        <div className="text-[11px]">
          Menampilkan{" "}
          <span className="font-mono text-foreground font-medium">
            1 - {formatInteger(anomalies.length)}
          </span>{" "}
          dari{" "}
          <span className="font-mono text-foreground font-semibold">
            {formatInteger(total)}
          </span>{" "}
          anomali
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span>Halaman 1 / 1</span>
          <div className="inline-flex rounded border border-border shadow-2xs overflow-hidden">
            <button
              type="button"
              className="px-2 py-0.5 bg-muted/40 text-muted-foreground text-[11px] disabled:opacity-40"
              disabled
              aria-label="Halaman sebelumnya"
            >
              &lt;
            </button>
            <button
              type="button"
              className="px-2 py-0.5 bg-muted/40 text-muted-foreground text-[11px] border-l border-border disabled:opacity-40"
              disabled
              aria-label="Halaman selanjutnya"
            >
              &gt;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RulesCard() {
  return (
    <section
      aria-label="Aturan deteksi"
      className="bg-card/70 border border-border rounded-lg p-3 text-[11px] flex flex-col md:flex-row md:items-start justify-between gap-3 shadow-2xs"
      data-purpose="rule-engine-specs"
    >
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <h3 className="font-semibold text-foreground text-[11px] uppercase tracking-wider">
          Aturan Deteksi
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
          {anomalyRules.length} Active
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 w-full text-[11px]">
        {anomalyRules.map((rule) => {
          const s = anomalyKindInfo[rule.kind]?.sources[0];
          return (
            <div
              key={rule.kind}
              data-testid="anomaly-rule"
              className="bg-muted/40 p-2.5 rounded border border-border flex flex-col min-w-0 gap-1"
            >
              <div className="flex flex-col">
                <span className="font-medium text-foreground">
                  {rule.title}:
                </span>
                <span className="text-muted-foreground font-mono text-[11px]">
                  {rule.limit}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground/90 leading-tight">
                {rule.description}
              </p>
              {s && (
                <span className="text-muted-foreground/75 font-mono text-[10px] truncate mt-auto pt-1 border-t border-border/50">
                  {s.system}: {s.path}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
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

export function AnomalyBoard({
  conclusion,
  diagnostic,
}: {
  conclusion?: ReactNode;
  diagnostic?: ReactNode;
}) {
  const [range, setRange] = useState<AnomalyRange>(initialAnomalyRange);
  const rangeInfo = anomalyRangeInfo(range);
  const { loaded, failed, retry } = useAnomalies(range);
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
    () =>
      loaded
        ? filterAnomalies(loaded.anomalies, filters, lookup, reviewed)
        : [],
    [loaded, filters, lookup, reviewed],
  );

  const counts = useMemo(
    () =>
      loaded ? facetCounts(loaded.anomalies, filters, lookup, reviewed) : null,
    [loaded, filters, lookup, reviewed],
  );

  const detail =
    (detailId && loaded?.anomalies.find((a) => a.id === detailId)) || null;

  const markReviewed = (anomaly: Anomaly) => {
    markAnomalyReviewed(anomaly.id, user?.name || user?.email || "Operator");
    setReviewed(getReviewedAnomalies());
  };

  const filtered = hasActiveAnomalyFilters(filters);
  // Total menurut database bila diketahui; selain itu yang dimuat. Bila yang
  // dimuat lebih sedikit dari totalnya, daftar dipotong ke yang terbaru.
  const activeLoaded = loaded ? loaded.anomalies.filter(isActive).length : 0;
  const listTotal =
    loaded && loaded.resolvedTotal !== null
      ? activeLoaded + loaded.resolvedTotal
      : (loaded?.anomalies.length ?? 0);
  const listTruncated =
    loaded !== null &&
    loaded.resolvedTotal !== null &&
    loaded.anomalies.length - activeLoaded < loaded.resolvedTotal;
  const resetFilters = () => setFilters(defaultAnomalyFilters);
  const toggleKind = (kind: IncidentKind) =>
    setFilters((current) => ({
      ...current,
      kind: current.kind === kind ? "all" : kind,
    }));

  return (
    <div className="flex flex-col gap-4 font-sans" data-testid="anomaly-board">
      {/* 1. Header Ringkas (sesuai referensi screen.png dan code.html) */}
      <header className="rounded-lg border border-border bg-card/90 p-3 shadow-2xs backdrop-blur">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                <span className="inline-flex size-2 rounded-full bg-primary animate-pulse motion-reduce:animate-none" />
                Deteksi Anomali
              </h1>
            </div>
            <p className="text-[12px] text-muted-foreground leading-tight">
              Gangguan terdeteksi: jalur penuh, router terbebani, error port,
              sinyal optik lemah, dan pelanggan offline.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-center">
            <div
              role="group"
              aria-label="Periode"
              className="inline-flex rounded-md border border-border bg-background p-0.5"
            >
              {anomalyRanges.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={range === item.value}
                  data-testid={`anomaly-range-${item.value}`}
                  onClick={() => setRange(item.value)}
                  className={cn(
                    "rounded px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    range === item.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.tab}
                </button>
              ))}
            </div>
            <div
              title="Polling otomatis setiap 30 detik ke endpoint/database untuk mendeteksi anomali baru dan durasi yang berjalan"
              aria-label="Polling otomatis setiap 30 detik"
              className="px-2 py-1 rounded bg-muted/60 border border-border text-[11px] text-muted-foreground flex items-center gap-1 font-mono"
            >
              <span className="text-muted-foreground">Polling:</span>
              <span className="text-foreground font-semibold">±30 detik</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={retry}
              className="h-7 px-2.5 text-[11px] font-medium gap-1 text-foreground"
            >
              <RefreshCw className="size-3 text-primary" />
              Segarkan Data
            </Button>
          </div>
        </div>
      </header>

      {/* 2. KPI Stat Widgets */}
      {loaded ? (
        <SummaryCards {...loaded} range={rangeInfo} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      )}

      {/* 3. Slot Diagnosa Pelanggan */}
      {diagnostic}

      {/* Gangguan per pelanggan */}
      <CustomerIncidentList />

      {/* 4. Insiden Aktif (kartu insiden terkelompok dari store hub) */}
      <IncidentCardList />

      {/* 5. Slot Kesimpulan & Inferensi */}
      {conclusion}

      {/* 6. Per Jenis Gangguan (5 kartu) */}
      {loaded ? (
        <KindCards
          {...loaded}
          range={rangeInfo}
          selected={filters.kind}
          onToggle={toggleKind}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-44" />
          ))}
        </div>
      )}

      {/* 7. Log Riwayat / Daftar Anomali */}
      <Card className="min-w-0 gap-2 py-3 shadow-2xs">
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Daftar anomali
              </CardTitle>
              <CardDescription
                role="status"
                className="text-[11px] text-muted-foreground mt-0.5"
              >
                {loaded
                  ? `${
                      filtered
                        ? `Menampilkan ${formatInteger(visible.length)} dari ${formatInteger(listTotal)}`
                        : formatInteger(listTotal)
                    } anomali ${rangeInfo.phrase}${
                      listTruncated
                        ? `; hanya ${formatInteger(loaded.anomalies.length - activeLoaded)} selesai terbaru yang dimuat`
                        : ""
                    }`
                  : "Memuat anomali…"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 flex flex-col gap-3">
          {failed && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <span>
                {loaded
                  ? "Pembaruan terakhir gagal; yang tampil adalah data sebelumnya."
                  : "Anomali belum bisa dimuat."}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={retry}
              >
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
              range={rangeInfo}
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

      {/* 8. Aturan Deteksi (Footer strip) */}
      <RulesCard />

      {/* Dialog Detail Anomali */}
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
