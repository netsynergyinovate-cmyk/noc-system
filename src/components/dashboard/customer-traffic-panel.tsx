"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrafficChart, type HistoryWindow } from "./traffic-chart";
import { formatBitrate, formatBytes } from "@/lib/dashboard/routers";
import type { TrafficRangeId } from "@/lib/dashboard/ranges";

type Range = "live" | "24h" | "3d" | "7d" | "30d" | "90d";
// chart: rangeId TrafficChart yang format sumbu waktunya cocok.
const RANGES: {
  id: Range;
  label: string;
  chart: TrafficRangeId;
  seconds: number;
}[] = [
  { id: "live", label: "5 menit", chart: "1h", seconds: 300 },
  { id: "24h", label: "1 hari", chart: "24h", seconds: 86400 },
  { id: "3d", label: "3 hari", chart: "7d", seconds: 3 * 86400 },
  { id: "7d", label: "7 hari", chart: "7d", seconds: 7 * 86400 },
  { id: "30d", label: "1 bulan", chart: "7d", seconds: 30 * 86400 },
  { id: "90d", label: "3 bulan", chart: "7d", seconds: 90 * 86400 },
];
const LIVE_EVERY_MS = 3000;

interface Bytes {
  download: number;
  upload: number;
}
interface History extends HistoryWindow {
  usage: { today: Bytes; last7d: Bytes; thisMonth: Bytes };
  since: number | null;
}
interface Live {
  downloadBps: number;
  uploadBps: number;
  maxDownloadBps: number;
  maxUploadBps: number;
  sessionDownloadBytes: number;
  sessionUploadBytes: number;
  sampledAt: number;
}

async function getTraffic<T>(customerId: string, range: Range): Promise<T> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/traffic?range=${range}`,
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: unknown;
  };
  if (!res.ok) {
    throw new Error(
      typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
    );
  }
  return json.data as T;
}

const dateTime = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function Pair({ label, value }: { label: string; value: Bytes | null }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-sm font-semibold tabular-nums">
        <span className="inline-flex items-center gap-1">
          <ArrowDown
            className="size-3.5 text-[var(--chart-1)]"
            aria-label="Unduh"
          />
          {value ? formatBytes(value.download) : "—"}
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowUp
            className="size-3.5 text-[var(--chart-2)]"
            aria-label="Unggah"
          />
          {value ? formatBytes(value.upload) : "—"}
        </span>
      </div>
    </div>
  );
}

// Trafik satu pelanggan: laju sekarang (simple queue router, tiap 3 detik),
// grafik 5 menit dari laju itu sejak halaman dibuka, histori 24 jam/7 hari/
// 30 hari dari arsip 5 menit backend, dan pemakaian hari ini/7 hari/bulan ini.
export function CustomerTrafficPanel({ customerId }: { customerId: string }) {
  const [range, setRange] = useState<Range>("24h");
  const [history, setHistory] = useState<{
    range: Range;
    data: History;
  } | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [live, setLive] = useState<{
    current: Live | null;
    points: [number, number, number][];
  }>({
    current: null,
    points: [],
  });
  const [liveNote, setLiveNote] = useState<string>("Membaca laju dari router…");

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const current = await getTraffic<Live | null>(customerId, "live");
        if (!alive) return;
        const now = Math.floor(Date.now() / 1000);
        setLive((prev) => ({
          current,
          points: current
            ? [
                ...prev.points.filter(([t]) => t > now - 300),
                [
                  current.sampledAt,
                  current.downloadBps / 1e6,
                  current.uploadBps / 1e6,
                ],
              ]
            : prev.points,
        }));
        setLiveNote(
          current
            ? ""
            : "Sesi PPPoE tidak aktif: tidak ada queue pelanggan ini di router.",
        );
      } catch (err) {
        if (alive)
          setLiveNote(
            err instanceof Error ? err.message : "Laju gagal dibaca.",
          );
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), LIVE_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [customerId]);

  useEffect(() => {
    if (range === "live") return;
    let alive = true;
    getTraffic<History>(customerId, range).then(
      (data) => {
        if (!alive) return;
        setHistory({ range, data });
        setHistoryError(null);
      },
      (err: unknown) =>
        alive &&
        setHistoryError(
          err instanceof Error ? err.message : "Histori gagal dimuat.",
        ),
    );
    return () => {
      alive = false;
    };
  }, [customerId, range]);

  const spec = RANGES.find((r) => r.id === range)!;
  const now = live.current?.sampledAt ?? history?.data.to ?? 0;
  const chartWindow: HistoryWindow | null =
    range === "live"
      ? {
          series: {
            times: live.points.map((p) => p[0]),
            rx: live.points.map((p) => p[1]),
            tx: live.points.map((p) => p[2]),
          },
          from: now - 300,
          to: now,
        }
      : history?.range === range
        ? history.data
        : null;
  const usage = history?.data.usage ?? null;
  const cur = live.current;
  const noHistory =
    range !== "live" &&
    chartWindow !== null &&
    chartWindow.series.times.length === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Trafik &amp; pemakaian</CardTitle>
        <CardDescription>
          Dari simple queue PPPoE pelanggan di router. Histori dirangkum per 5
          menit oleh backend.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Laju sekarang</div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-sm font-semibold tabular-nums">
              <span className="inline-flex items-center gap-1">
                <ArrowDown
                  className="size-3.5 text-[var(--chart-1)]"
                  aria-label="Unduh"
                />
                {cur ? formatBitrate(cur.downloadBps) : "—"}
              </span>
              <span className="inline-flex items-center gap-1">
                <ArrowUp
                  className="size-3.5 text-[var(--chart-2)]"
                  aria-label="Unggah"
                />
                {cur ? formatBitrate(cur.uploadBps) : "—"}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Batas paket:{" "}
              {cur && (cur.maxDownloadBps || cur.maxUploadBps)
                ? `${formatBitrate(cur.maxDownloadBps)} / ${formatBitrate(cur.maxUploadBps)}`
                : "—"}
            </div>
          </div>
          <Pair
            label="Pemakaian sesi ini"
            value={
              cur
                ? {
                    download: cur.sessionDownloadBytes,
                    upload: cur.sessionUploadBytes,
                  }
                : null
            }
          />
          <Pair label="Hari ini (WIB)" value={usage?.today ?? null} />
          <Pair label="7 hari terakhir" value={usage?.last7d ?? null} />
          <Pair label="Bulan ini" value={usage?.thisMonth ?? null} />
        </div>
        {liveNote && (
          <p role="status" className="text-xs text-muted-foreground">
            {liveNote}
          </p>
        )}

        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            {RANGES.map((r) => (
              <TabsTrigger key={r.id} value={r.id}>
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex h-72 flex-col">
          {chartWindow ? (
            <TrafficChart
              key={range}
              rangeId={spec.chart}
              label={spec.label}
              history={chartWindow}
              incidents={[]}
              followLive={false}
            />
          ) : (
            <p role="status" className="m-auto text-sm text-muted-foreground">
              {historyError ?? "Memuat histori…"}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {range === "live"
            ? "Grafik 5 menit diisi dari laju router tiap 3 detik sejak halaman ini dibuka."
            : noHistory
              ? "Belum ada histori pada rentang ini. Backend mulai mencatat sejak fitur ini aktif."
              : null}{" "}
          {history?.data.since
            ? `Histori tersimpan sejak ${dateTime.format(new Date(history.data.since * 1000))}. `
            : ""}
          Pemakaian adalah perkiraan dari laju rata-rata, bukan angka tagihan.
        </p>
      </CardContent>
    </Card>
  );
}
