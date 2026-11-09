"use client";

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  benchmarkKpis,
  compileBenchmarkSummary,
  benchmarkMatrix,
  pipelineSteps,
  stackDecisions,
} from "@/lib/dashboard/stack-benchmark";

const summary = compileBenchmarkSummary();
const fmt = (n: number) => n.toFixed(3);

const winnerLabel = { go: "Go unggul", next: "Next.js unggul", seri: "Seri" } as const;

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
                <CardTitle>Ringkasan hasil uji banding</CardTitle>
                <Badge variant={summary.measured ? "secondary" : "outline"} data-testid="benchmark-summary-badge">
                  {summary.measured ? "Data Terukur Lab Docker" : "Angka perkiraan (belum diukur)"}
                </Badge>
              </div>
              <CardDescription>
                Uji 1: Go vs Node.js. Uji 2: Drizzle vs SQL langsung
                {summary.dbMode === "mock" ? " (klien DB tiruan: biaya lapisan akses saja)" : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul data-testid="benchmark-summary-kpis" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summary.kpis.map((k) => (
                  <li key={k.id} data-testid="benchmark-summary-kpi" className="rounded-md border p-3 text-sm">
                    <p className="text-muted-foreground">{k.label}</p>
                    <p className="text-lg font-semibold">{k.value}</p>
                    <p className="text-muted-foreground">{k.detail}</p>
                  </li>
                ))}
              </ul>
              <div role="region" aria-label="Rincian hasil uji banding" tabIndex={0} className="overflow-x-auto">
                <table data-testid="benchmark-summary-table" className="w-full min-w-[40rem] text-sm">
                  <caption className="sr-only">Latensi rata-rata, p50, dan p95 per langkah (ms)</caption>
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="py-2 pr-4 font-medium">Langkah</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Lebih cepat (avg)</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Avg</th>
                      <th scope="col" className="py-2 pr-4 font-medium">p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.runtime.steps.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium">Uji 1: {s.label}</th>
                        <td className="py-2 pr-4">Go {s.speedup.toFixed(2)}x</td>
                        <td className="py-2 pr-4">Go {fmt(s.goAvg)} / Node {fmt(s.nodeAvg)}</td>
                        <td className="py-2 pr-4">Go {fmt(s.goP95)} / Node {fmt(s.nodeP95)}</td>
                      </tr>
                    ))}
                    {summary.database.scenarios.map((s) => (
                      <tr key={s.id} className="border-b last:border-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium">Uji 2: {s.label}</th>
                        <td className="py-2 pr-4">SQL {s.speedup.toFixed(2)}x</td>
                        <td className="py-2 pr-4">SQL {fmt(s.rawAvg)} / Drizzle {fmt(s.drizzleAvg)}</td>
                        <td className="py-2 pr-4">SQL {fmt(s.rawP95)} / Drizzle {fmt(s.drizzleP95)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul data-testid="benchmark-summary-recommendations" className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {summary.recommendations.map((r) => (
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

        <TabsContent value="metrik">          <Card>
            <CardHeader>
              <CardTitle>Matriks perbandingan fitur</CardTitle>
              <CardDescription>Go daemon dibanding Next.js untuk jalur realtime.</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                role="region"
                aria-label="Matriks perbandingan stack"
                tabIndex={0}
                className="overflow-x-auto"
              >
                <table data-testid="benchmark-matrix-table" className="w-full min-w-[40rem] text-sm">
                  <caption className="sr-only">Perbandingan Go dan Next.js per fitur</caption>
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="py-2 pr-4 font-medium">Fitur</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Go</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Next.js</th>
                      <th scope="col" className="py-2 font-medium">Hasil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarkMatrix.map((row) => (
                      <tr key={row.id} data-testid="benchmark-matrix-row" className="border-b align-top last:border-0">
                        <th scope="row" className="py-2 pr-4 text-left font-medium">{row.feature}</th>
                        <td className="py-2 pr-4">{row.go}</td>
                        <td className="py-2 pr-4">{row.next}</td>
                        <td className="py-2">
                          <Badge variant={row.winner === "seri" ? "outline" : "secondary"}>
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
          <ul data-testid="stack-decisions" className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {stackDecisions.map((d) => (
              <li key={d.id} data-testid="stack-decision">
                <Card className="h-full">
                  <CardHeader>
                    <CardDescription>{d.layer}</CardDescription>
                    <CardTitle>{d.choice}</CardTitle>
                    <div>
                      <Badge variant="secondary" data-testid="stack-decision-status">
                        Keputusan Final
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>{d.reason}</p>
                    {d.empiricalMetrics && (
                      <p data-testid="stack-decision-metrics" className="text-foreground">
                        <span className="font-medium">Metrik empiris:</span> {d.empiricalMetrics}
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
                    <span className="rounded-md border px-3 py-1.5">{step}</span>
                    {i < pipelineSteps.length - 1 && (
                      <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
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
