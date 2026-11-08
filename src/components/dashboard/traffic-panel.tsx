"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMbps } from "@/lib/dashboard/format";
import {
  loadIncidents,
  loadTrafficHistory,
  type TrafficHistory,
} from "@/lib/dashboard/history";
import { loadLiveTrafficHistory } from "@/lib/dashboard/history-live";
import {
  DEFAULT_RANGE,
  getRange,
  type TrafficRangeId,
} from "@/lib/dashboard/ranges";
import { useDashboardStore } from "@/lib/dashboard/store";
import type { Incident } from "@/lib/dashboard/types";
import { IncidentList } from "./incident-list";
import { RangePicker } from "./range-picker";
import { TrafficChart } from "./traffic-chart";

const LIVE_INCIDENT_REFRESH_MS = 30_000;

export function summarize(values: number[]) {
  if (values.length === 0) return null;
  let peak = values[0];
  let sum = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    sum += value;
  }
  return {
    now: values[values.length - 1],
    peak,
    average: sum / values.length,
  };
}

import type { InspectedTrafficPoint } from "./traffic-chart";

// Warna garis sama dengan di grafik, jadi tidak perlu legenda
// terpisah.
export function SeriesStat({
  label,
  latestLabel,
  labelSuffix,
  testId,
  swatchColor,
  values,
  activeValue,
  isInspecting,
}: {
  label: string;
  latestLabel: string;
  labelSuffix?: string;
  testId: string;
  swatchColor: string;
  values: number[];
  activeValue?: number;
  isInspecting?: boolean;
}) {
  const stats = summarize(values);
  const show = (value: number | undefined) =>
    value === undefined ? "—" : formatMbps(value);
  const displayVal = activeValue !== undefined ? activeValue : stats?.now;

  return (
    <section
      aria-label={`Traffic ${label.toLowerCase()}`}
      className={`flex items-center justify-between bg-muted/40 px-3 py-2 rounded border transition-colors ${
        isInspecting
          ? "border-emerald-500/50 bg-emerald-950/20 shadow-sm shadow-emerald-500/10"
          : "border-border"
      }`}
    >
      <div>
        <h3 className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="w-4 border-t-[3px] border-solid rounded-full"
            style={{ borderColor: swatchColor }}
          />
          {label}
          <span className="flex items-center gap-1 text-[10px]">
            <span
              className={
                isInspecting ? "text-emerald-400 font-semibold" : "text-muted-foreground"
              }
            >
              {latestLabel}
            </span>
            {labelSuffix && (
              <span className="font-mono text-muted-foreground text-[9px]">
                {labelSuffix}
              </span>
            )}
          </span>
        </h3>
        <p
          data-testid={testId}
          id={testId === "download-now" ? "traffic-download-val" : "traffic-upload-val"}
          className="mt-0.5 text-lg font-bold text-foreground tracking-tight tabular-nums font-mono"
        >
          {show(displayVal)}
        </p>
      </div>
      <dl className="text-right text-[11px] text-muted-foreground space-y-0.5 font-mono">
        <div className="flex justify-end gap-1.5">
          <dt>Puncak</dt>
          <dd className="font-medium text-foreground tabular-nums">
            {show(stats?.peak)}
          </dd>
        </div>
        <div className="flex justify-end gap-1.5">
          <dt>Rata-rata</dt>
          <dd className="font-medium text-foreground/90 tabular-nums">
            {show(stats?.average)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function StatsGrid({
  rx,
  tx,
  times,
  latestLabel,
  inspectedPoint,
}: {
  rx: number[];
  tx: number[];
  times?: number[];
  latestLabel: string;
  inspectedPoint?: InspectedTrafficPoint | null;
}) {
  const isInspecting = Boolean(inspectedPoint);
  let effectiveLabel = latestLabel;
  let labelSuffix = "";

  if (inspectedPoint) {
    effectiveLabel = "titik";
    const inspectedTime = new Intl.DateTimeFormat("id-ID", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(inspectedPoint.time * 1000));
    labelSuffix = `(${inspectedTime} WIB)`;
  } else if (times && times.length > 0) {
    const latestTime = times[times.length - 1];
    const clock = new Intl.DateTimeFormat("id-ID", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(latestTime * 1000));
    labelSuffix = `(${clock} WIB)`;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <SeriesStat
        label="Unduh"
        latestLabel={effectiveLabel}
        labelSuffix={labelSuffix}
        testId="download-now"
        swatchColor="var(--chart-1)"
        values={rx}
        activeValue={inspectedPoint ? inspectedPoint.rx : undefined}
        isInspecting={isInspecting}
      />
      <SeriesStat
        label="Unggah"
        latestLabel={effectiveLabel}
        labelSuffix={labelSuffix}
        testId="upload-now"
        swatchColor="var(--chart-2)"
        values={tx}
        activeValue={inspectedPoint ? inspectedPoint.tx : undefined}
        isInspecting={isInspecting}
      />
    </div>
  );
}

// Satu-satunya bagian yang digambar ulang tiap detik, karena hanya ia yang
// membaca deret traffic langsung.
export function LiveStats({
  inspectedPoint,
}: {
  inspectedPoint?: InspectedTrafficPoint | null;
} = {}) {
  const { rx, tx, times } = useDashboardStore((state) => state.traffic);
  return (
    <StatsGrid
      rx={rx}
      tx={tx}
      times={times}
      latestLabel="sekarang"
      inspectedPoint={inspectedPoint}
    />
  );
}

export type HistoryState =
  | { range: TrafficRangeId; status: "ready"; data: TrafficHistory }
  | { range: TrafficRangeId; status: "error" };

// Memuat histori untuk rentang yang dipilih. Hasil untuk rentang yang sudah
// ditinggalkan dibuang, jadi berpindah rentang dengan cepat tidak menampilkan
// grafik yang salah.
export function useTrafficHistory(range: TrafficRangeId, demo: boolean, poll = true) {
  const [state, setState] = useState<HistoryState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (range === DEFAULT_RANGE) return;
    let cancelled = false;

    const fetchHistory = () => {
      (demo ? loadTrafficHistory(range) : loadLiveTrafficHistory(range))
        .then((data) => {
          if (!cancelled) setState({ range, status: "ready", data });
        })
        .catch(() => {
          if (!cancelled) setState({ range, status: "error" });
        });
    };

    fetchHistory();

    // `poll` false: histori dimuat sekali per rentang; ujung grafik digerakkan titik
    // live dari WebSocket (TrafficChart followLive), bukan permintaan berulang.
    if (!poll) {
      return () => {
        cancelled = true;
      };
    }

    // Auto-refresh berkala agar grafik histori (1 jam, 6 jam, 24 jam, 7 hari)
    // terus BERJALAN ("jalan") mengikuti waktu dan telemetri riil database.
    const refreshMs =
      range === "1h"
        ? 5_000
        : range === "6h"
          ? 15_000
          : range === "24h"
            ? 30_000
            : 60_000;

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      (demo ? loadTrafficHistory(range) : loadLiveTrafficHistory(range))
        .then((data) => {
          if (!cancelled) setState({ range, status: "ready", data });
        })
        .catch(() => {});
    }, refreshMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [range, attempt, demo, poll]);

  const current = state?.range === range ? state : null;
  return {
    loading: range !== DEFAULT_RANGE && current === null,
    failed: current?.status === "error",
    data: current?.status === "ready" ? current.data : null,
    retry: () => {
      setState(null);
      setAttempt((value) => value + 1);
    },
  };
}

// Insiden pada jendela 5 menit terakhir, disegarkan berkala.
// Mode live belum punya sumber insiden nyata di sini (menunggu langkah Alert), jadi
// tidak memuat apa pun: data tiruan tidak boleh tampil sebagai kejadian jaringan.
export function useLiveIncidents(active: boolean, demo: boolean) {
  const [state, setState] = useState<{ incidents: Incident[]; now: number }>({
    incidents: [],
    now: 0,
  });
  useEffect(() => {
    if (!active || !demo) return;
    let cancelled = false;
    const refresh = () => {
      const now = Math.floor(Date.now() / 1000);
      loadIncidents(now - getRange("live").seconds, now, now).then(
        (incidents) => {
          if (!cancelled) setState({ incidents, now });
        },
        () => {},
      );
    };
    refresh();
    const timer = setInterval(refresh, LIVE_INCIDENT_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, demo]);
  return state;
}

export function describe(range: TrafficRangeId) {
  if (range === DEFAULT_RANGE)
    return "Total semua router, 1 sampel per detik, 5 menit terakhir";
  const { label, stepSeconds = 1 } = getRange(range);
  const step =
    stepSeconds < 60
      ? `${stepSeconds} detik`
      : stepSeconds < 3600
        ? `${stepSeconds / 60} menit`
        : `${stepSeconds / 3600} jam`;
  return `Total semua router, rata-rata tiap ${step}, ${label} terakhir`;
}

export function TrafficPanel({ className }: { className?: string }) {
  const [range, setRange] = useState<TrafficRangeId>(DEFAULT_RANGE);
  const history = useTrafficHistory(range, false);
  const live = useLiveIncidents(range === DEFAULT_RANGE, false);

  const historyWindow = useMemo(
    () =>
      history.data && {
        series: history.data.series,
        from: history.data.from,
        to: history.data.to,
      },
    [history.data],
  );

  const isLive = range === DEFAULT_RANGE;
  const trafficTimes = useDashboardStore((state) => state.traffic.times);

  // Preload histori 5 menit awal dari database saat refresh jika buffer store masih kosong
  useEffect(() => {
    let active = true;
    if (isLive && trafficTimes.length === 0) {
      loadLiveTrafficHistory("live")
        .then((hist) => {
          if (active && hist.series.times.length > 0) {
            useDashboardStore.setState((prev) => {
              if (prev.traffic.times.length === 0) {
                return { traffic: hist.series };
              }
              return {};
            });
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [isLive, trafficTimes.length]);

  const incidents = isLive ? live.incidents : (history.data?.incidents ?? []);
  const now = isLive ? live.now : (history.data?.to ?? 0);
  const ready = isLive || history.data !== null;

  const [inspected, setInspected] = useState<InspectedTrafficPoint | null>(null);

  return (
    <Card className={className}>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base font-semibold">Traffic jaringan</CardTitle>
        <CardDescription className="text-xs">{describe(range)}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 flex flex-1 flex-col gap-4">
        <RangePicker value={range} onChange={setRange} />

        {isLive ? (
          <LiveStats inspectedPoint={inspected} />
        ) : (
          <StatsGrid
            rx={history.data?.series.rx ?? []}
            tx={history.data?.series.tx ?? []}
            times={history.data?.series.times}
            latestLabel="terakhir"
            inspectedPoint={inspected}
          />
        )}

        {history.failed ? (
          <div
            role="alert"
            className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center"
          >
            <p className="text-sm text-muted-foreground">
              Histori traffic belum bisa dimuat.
            </p>
            <Button variant="outline" size="sm" onClick={history.retry}>
              Coba lagi
            </Button>
          </div>
        ) : history.loading ? (
          <div
            role="status"
            aria-label="Memuat histori traffic"
            className="min-h-64 flex-1 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ) : !isLive && history.data && history.data.series.times.length === 0 ? (
          <div
            role="status"
            data-testid="traffic-history-empty"
            className="flex min-h-64 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-center"
          >
            <p className="text-sm font-medium">Belum ada histori untuk rentang ini</p>
            <p className="text-sm text-muted-foreground">
              Backend merekam traffic setiap detik sejak router terhubung. Grafik
              terisi bertahap; coba rentang yang lebih pendek.
            </p>
          </div>
        ) : (
          <TrafficChart
            rangeId={range}
            history={historyWindow ?? undefined}
            incidents={incidents}
            onInspect={setInspected}
          />
        )}

        {ready && (
          <IncidentList
            incidents={incidents}
            now={now}
            multiDay={getRange(range).seconds > 24 * 3600}
          />
        )}
      </CardContent>
    </Card>
  );
}
