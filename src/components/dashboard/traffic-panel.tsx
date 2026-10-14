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

function summarize(values: number[]) {
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

// Warna garis sama dengan di grafik, jadi tidak perlu legenda
// terpisah.
function SeriesStat({
  label,
  latestLabel,
  testId,
  swatchColor,
  values,
}: {
  label: string;
  latestLabel: string;
  testId: string;
  swatchColor: string;
  values: number[];
}) {
  const stats = summarize(values);
  const show = (value: number | undefined) =>
    value === undefined ? "—" : formatMbps(value);
  return (
    <section aria-label={`Traffic ${label.toLowerCase()}`}>
      <h3 className="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className="w-5 border-t-[3px] border-solid"
          style={{ borderColor: swatchColor }}
        />
        {label}
        <span className="text-xs">{latestLabel}</span>
      </h3>
      <p
        data-testid={testId}
        className="mt-1 text-2xl font-semibold tracking-tight tabular-nums"
      >
        {show(stats?.now)}
      </p>
      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>Puncak</dt>
          <dd className="font-medium text-foreground tabular-nums">
            {show(stats?.peak)}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>Rata-rata</dt>
          <dd className="font-medium text-foreground tabular-nums">
            {show(stats?.average)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function StatsGrid({
  rx,
  tx,
  latestLabel,
}: {
  rx: number[];
  tx: number[];
  latestLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      <SeriesStat
        label="Unduh"
        latestLabel={latestLabel}
        testId="download-now"
        swatchColor="var(--chart-1)"
        values={rx}
      />
      <SeriesStat
        label="Unggah"
        latestLabel={latestLabel}
        testId="upload-now"
        swatchColor="var(--chart-2)"
        values={tx}
      />
    </div>
  );
}

// Satu-satunya bagian yang digambar ulang tiap detik, karena hanya ia yang
// membaca deret traffic langsung.
function LiveStats() {
  const { rx, tx } = useDashboardStore((state) => state.traffic);
  return <StatsGrid rx={rx} tx={tx} latestLabel="sekarang" />;
}

type HistoryState =
  | { range: TrafficRangeId; status: "ready"; data: TrafficHistory }
  | { range: TrafficRangeId; status: "error" };

// Memuat histori untuk rentang yang dipilih. Hasil untuk rentang yang sudah
// ditinggalkan dibuang, jadi berpindah rentang dengan cepat tidak menampilkan
// grafik yang salah.
function useTrafficHistory(range: TrafficRangeId) {
  const [state, setState] = useState<HistoryState | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (range === DEFAULT_RANGE) return;
    let cancelled = false;
    loadTrafficHistory(range)
      .then((data) => {
        if (!cancelled) setState({ range, status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ range, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [range, attempt]);

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
function useLiveIncidents(active: boolean) {
  const [state, setState] = useState<{ incidents: Incident[]; now: number }>({
    incidents: [],
    now: 0,
  });
  useEffect(() => {
    if (!active) return;
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
  }, [active]);
  return state;
}

function describe(range: TrafficRangeId) {
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
  const history = useTrafficHistory(range);
  const live = useLiveIncidents(range === DEFAULT_RANGE);

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
  const incidents = isLive ? live.incidents : (history.data?.incidents ?? []);
  const now = isLive ? live.now : (history.data?.to ?? 0);
  const ready = isLive || history.data !== null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Traffic jaringan</CardTitle>
        <CardDescription>{describe(range)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <RangePicker value={range} onChange={setRange} />

        {isLive ? (
          <LiveStats />
        ) : (
          <StatsGrid
            rx={history.data?.series.rx ?? []}
            tx={history.data?.series.tx ?? []}
            latestLabel="terakhir"
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
        ) : (
          <TrafficChart
            rangeId={range}
            history={historyWindow ?? undefined}
            incidents={incidents}
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
