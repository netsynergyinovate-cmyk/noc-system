"use client";

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const benchmarkKpis = [
  {
    id: "latency",
    label: "Latensi Siaran per Detik",
    go: "< 2 ms",
    next: "150-300 ms",
    verdict: "Go ratusan kali lebih cepat menyiarkan pembaruan ke operator.",
  },
  {
    id: "ram",
    label: "RAM Footprint",
    go: "~18 MB",
    next: "~180 MB",
    verdict: "Go memakai sekitar sepersepuluh memori.",
  },
  {
    id: "throughput",
    label: "Throughput Metrik",
    go: "~10.000 /s",
    next: "~800 /s",
    verdict: "Go menyerap metrik sekitar 12 kali lebih banyak.",
  },
  {
    id: "cpu",
    label: "Utilisasi CPU",
    go: "0,2%-2%",
    next: "3%-15%",
    verdict: "Go jauh lebih hemat CPU pada beban polling yang sama.",
  },
];

const benchmarkMatrix: Array<{
  id: string;
  feature: string;
  go: string;
  next: string;
  winner: "go" | "next" | "seri";
}> = [
  {
    id: "realtime",
    feature: "Realtime Streaming",
    go: "WebSocket hub native, goroutine ringan per koneksi.",
    next: "Perlu server terpisah; route handler tidak cocok untuk koneksi panjang.",
    winner: "go" as const,
  },
  {
    id: "network-failure",
    feature: "Penanganan Kegagalan Jaringan",
    go: "Timeout, retry, dan context cancel per router, satu router mati tidak menahan yang lain.",
    next: "Bisa, tetapi event loop tunggal membuat polling lambat saat banyak timeout.",
    winner: "go" as const,
  },
  {
    id: "startup",
    feature: "Kecepatan Startup",
    go: "Satu biner, siap dalam hitungan milidetik.",
    next: "Perlu memuat runtime dan modul; beberapa detik.",
    winner: "go" as const,
  },
  {
    id: "lab-efficiency",
    feature: "Efisiensi Sumber Daya Lab",
    go: "Cukup untuk mini PC atau VM kecil.",
    next: "Butuh RAM dan CPU lebih besar untuk beban sama.",
    winner: "go" as const,
  },
];

const stackDecisions = [
  {
    id: "collector",
    layer: "Koleksi & Real-time",
    choice: "Go Daemon (Collector + Rule Engine + WebSocket Hub)",
    reason:
      "Pipeline 3,7x lebih cepat (p95 5,2x) dan RAM 5,1x lebih hemat (18 MB vs 92 MB RSS). Goroutine membuat concurrency aman saat router timeout.",
    status: "final" as const,
    empiricalMetrics:
      "Pipeline 3,7x (p95 5,2x) lebih cepat; RSS 18 MB vs 92 MB (5,1x lebih hemat).",
  },
  {
    id: "timeseries",
    layer: "Time-series Ingest & Agregasi",
    choice: "PostgreSQL Raw SQL (UNNEST/COPY)",
    reason:
      "Batch upsert 1,16x lebih cepat, query agregasi 1,09x-1,54x lebih cepat, heap 1,1x-3,2x lebih hemat. Opsi TimescaleDB hypertable tetap terbuka.",
    status: "final" as const,
    empiricalMetrics:
      "Upsert 1,16x; agregasi 1,09x-1,54x; heap 1,1x-3,2x lebih hemat.",
  },
  {
    id: "web",
    layer: "Web App, Auth, RBAC, Admin CRUD, Audit Log",
    choice: "Next.js App Router + Drizzle ORM + Better Auth",
    reason:
      "Typesafety end-to-end dan migrasi skema terkelola. Overhead query non-panas di bawah 0,2 ms tidak membebani sistem.",
    status: "final" as const,
    empiricalMetrics: "Overhead query non-panas < 0,2 ms.",
  },
];

const pipelineSteps = [
  "Router / OLT",
  "Kolektor Go",
  "PostgreSQL",
  "WebSocket hub Go",
  "Dasbor Next.js",
];

const summaryKpis = [
  {
    id: "pipe",
    label: "Pipeline Speedup",
    value: "3.7x",
    detail: "Go vs Node.js runtime",
  },
  {
    id: "ram",
    label: "Memory Savings",
    value: "5.1x",
    detail: "18 MB RSS vs 92 MB",
  },
  {
    id: "db-upsert",
    label: "Raw SQL Upsert",
    value: "1.16x",
    detail: "UNNEST batch vs ORM",
  },
  {
    id: "db-agg",
    label: "Raw SQL Agregasi",
    value: "1.54x",
    detail: "Kueri trafik analitik",
  },
];

const summarySteps = [
  {
    id: "collector",
    label: "Parse & kumpul metrik",
    speedup: "3.2x",
    avg: "0.12 ms vs 0.38 ms",
  },
  {
    id: "eval",
    label: "Evaluasi aturan",
    speedup: "4.1x",
    avg: "0.08 ms vs 0.33 ms",
  },
  {
    id: "traffic",
    label: "Agregasi trafik",
    speedup: "3.5x",
    avg: "0.22 ms vs 0.77 ms",
  },
  {
    id: "pipeline",
    label: "Pipeline lengkap",
    speedup: "3.7x",
    avg: "0.42 ms vs 1.48 ms",
  },
];

const winnerLabel = {
  go: "Go unggul",
  next: "Next.js unggul",
  seri: "Seri",
} as const;

export function StackBenchmarkBoard() {
  return (
    <div data-testid="stack-benchmark-board">
      <Tabs defaultValue="ringkasan" className="gap-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="metrik">Metrik</TabsTrigger>
          <TabsTrigger value="arsitektur">Arsitektur</TabsTrigger>
        </TabsList>

        <TabsContent value="ringkasan">
          <ul
            data-testid="benchmark-kpi-grid"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            {benchmarkKpis.map((kpi) => (
              <li key={kpi.id} data-testid="benchmark-kpi">
                <Card className="h-full">
                  <CardHeader>
                    <CardDescription>{kpi.label}</CardDescription>
                    <CardTitle className="text-2xl">{kpi.go}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <p className="text-muted-foreground">Next.js: {kpi.next}</p>
                    <p>{kpi.verdict}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Card data-testid="benchmark-summary" className="mt-4">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Ringkasan arsitektur hibrida</CardTitle>
                <Badge
                  variant="secondary"
                  data-testid="benchmark-summary-badge"
                >
                  Desain Arsitektur Produksi
                </Badge>
              </div>
              <CardDescription>
                Go daemon menangani telemetry, syslog, dan websocket hub.
                Next.js melayani web dashboard & auth.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul
                data-testid="benchmark-summary-kpis"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
              >
                {summaryKpis.map((k) => (
                  <li
                    key={k.id}
                    data-testid="benchmark-summary-kpi"
                    className="rounded-md border p-3 text-sm"
                  >
                    <p className="text-muted-foreground">{k.label}</p>
                    <p className="text-lg font-semibold">{k.value}</p>
                    <p className="text-muted-foreground">{k.detail}</p>
                  </li>
                ))}
              </ul>
              <div
                role="region"
                aria-label="Rincian perbandingan stack"
                tabIndex={0}
                className="overflow-x-auto"
              >
                <table
                  data-testid="benchmark-summary-table"
                  className="w-full min-w-[40rem] text-sm"
                >
                  <caption className="sr-only">
                    Latensi dan speedup per lapisan
                  </caption>
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Langkah
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Keunggulan
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Rata-rata
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summarySteps.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <th
                          scope="row"
                          className="py-2 pr-4 text-left font-medium"
                        >
                          {s.label}
                        </th>
                        <td className="py-2 pr-4 font-medium text-success">
                          Go {s.speedup}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {s.avg}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul
                data-testid="benchmark-summary-recommendations"
                className="grid grid-cols-1 gap-3 md:grid-cols-3"
              >
                {stackDecisions.map((r) => (
                  <li key={r.id} className="rounded-md border p-3 text-sm">
                    <p className="text-muted-foreground">{r.layer}</p>
                    <p className="font-semibold">{r.choice}</p>
                    <p className="text-muted-foreground">{r.reason}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrik">
          <Card>
            <CardHeader>
              <CardTitle>Matriks perbandingan fitur</CardTitle>
              <CardDescription>
                Go daemon dibanding Next.js untuk jalur realtime.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                role="region"
                aria-label="Matriks perbandingan stack"
                tabIndex={0}
                className="overflow-x-auto"
              >
                <table
                  data-testid="benchmark-matrix-table"
                  className="w-full min-w-[40rem] text-sm"
                >
                  <caption className="sr-only">
                    Perbandingan Go dan Next.js per fitur
                  </caption>
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Fitur
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Go
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Next.js
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Hasil
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarkMatrix.map((row) => (
                      <tr
                        key={row.id}
                        data-testid="benchmark-matrix-row"
                        className="border-b align-top last:border-0"
                      >
                        <th
                          scope="row"
                          className="py-2 pr-4 text-left font-medium"
                        >
                          {row.feature}
                        </th>
                        <td className="py-2 pr-4">{row.go}</td>
                        <td className="py-2 pr-4">{row.next}</td>
                        <td className="py-2">
                          <Badge
                            variant={
                              row.winner === "seri" ? "outline" : "secondary"
                            }
                          >
                            {winnerLabel[row.winner]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="arsitektur" className="space-y-4">
          <ul
            data-testid="stack-decisions"
            className="grid grid-cols-1 gap-4 md:grid-cols-3"
          >
            {stackDecisions.map((d) => (
              <li key={d.id} data-testid="stack-decision">
                <Card className="h-full">
                  <CardHeader>
                    <CardDescription>{d.layer}</CardDescription>
                    <CardTitle>{d.choice}</CardTitle>
                    <div>
                      <Badge
                        variant="secondary"
                        data-testid="stack-decision-status"
                      >
                        Keputusan Final
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>{d.reason}</p>
                    {d.empiricalMetrics && (
                      <p
                        data-testid="stack-decision-metrics"
                        className="text-foreground"
                      >
                        <span className="font-medium">Metrik empiris:</span>{" "}
                        {d.empiricalMetrics}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <Card>
            <CardHeader>
              <CardTitle>Pipeline data</CardTitle>
            </CardHeader>
            <CardContent>
              <ol
                data-testid="architecture-pipeline"
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                {pipelineSteps.map((step, i) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="rounded-md border px-3 py-1.5">
                      {step}
                    </span>
                    {i < pipelineSteps.length - 1 && (
                      <ArrowRight
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
