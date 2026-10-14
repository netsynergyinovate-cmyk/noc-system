"use client";

import { useMemo, useState } from "react";
import { TrafficEmptyState } from "@/components/dashboard/traffic-empty-state";
import {
  formatBandwidthRate,
  formatDataVolume,
  formatPacketCount,
  formatTrafficDuration,
} from "@/lib/dashboard/traffic-format-helpers";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatAlertTime } from "@/lib/dashboard/alerts";
import { formatInteger } from "@/lib/dashboard/format";
import { mockRouters } from "@/lib/dashboard/mock-data";
import { NetflowTrendChart } from "@/components/dashboard/netflow-trend-chart";
import {
  buildNetflowTimeSeries,
  defaultFlowFilter,
  filterFlows,
  loadNetflow,
  summarizeNetflow,
  type FlowFilter,
  type FlowProtocol,
  type FlowRange,
  type NetflowRecord,
} from "@/lib/dashboard/netflow";
import {
  evaluateFlowAnomaly,
  sortFlows,
  type FlowSortOption,
} from "@/lib/dashboard/netflow-filter-sort";
import { NetflowDetailDialog } from "@/components/dashboard/netflow-detail-dialog";
import { usePolled } from "@/lib/dashboard/use-polled";

const REFRESH_MS = 30_000;
const ranges: { value: FlowRange; label: string }[] = [
  { value: "1h", label: "1 Jam" },
  { value: "6h", label: "6 Jam" },
  { value: "24h", label: "24 Jam" },
  { value: "7d", label: "7 Hari" },
];
const protocols: FlowProtocol[] = ["TCP", "UDP", "ICMP"];
const sortOptions: { value: string; label: string; sort: FlowSortOption }[] = [
  { value: "bytes-desc", label: "Ukuran Data (Terbesar)", sort: { field: "bytes", direction: "desc" } },
  { value: "bytes-asc", label: "Ukuran Data (Terkecil)", sort: { field: "bytes", direction: "asc" } },
  { value: "packets-desc", label: "Paket (Terbanyak)", sort: { field: "packets", direction: "desc" } },
  { value: "throughput-desc", label: "Laju Throughput (Tertinggi)", sort: { field: "throughput", direction: "desc" } },
  { value: "duration-desc", label: "Durasi (Terlama)", sort: { field: "duration", direction: "desc" } },
  { value: "startedAt-desc", label: "Waktu Terbaru", sort: { field: "startedAt", direction: "desc" } },
];
const selectClass =
  "h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1 text-sm text-muted-foreground">
        {label}
      </CardHeader>
      <CardContent className="text-2xl font-semibold tabular-nums">
        {value}
      </CardContent>
    </Card>
  );
}

export function NetflowBoard() {
  const { state, failed, retry } = usePolled(loadNetflow, REFRESH_MS);
  const [filter, setFilter] = useState<FlowFilter>(defaultFlowFilter);
  const [sortValue, setSortValue] = useState(sortOptions[0].value);
  const [selected, setSelected] = useState<NetflowRecord | null>(null);
  const set = (patch: Partial<FlowFilter>) =>
    setFilter((current) => ({ ...current, ...patch }));
  const sort = (sortOptions.find((o) => o.value === sortValue) ?? sortOptions[0]).sort;

  const hasActiveFilter =
    filter.routerId !== null ||
    filter.protocol !== null ||
    filter.query !== "" ||
    filter.clientIp !== "" ||
    filter.dstPort !== "";

  const view = useMemo(() => {
    if (!state) return null;
    const flows = filterFlows(state.data, filter, state.now);
    return {
      summary: summarizeNetflow(flows, filter.range),
      top: sortFlows(flows, sort.field, sort.direction).slice(0, 20),
      count: flows.length,
      trend: buildNetflowTimeSeries(flows, filter.range, state.now),
    };
  }, [state, filter, sort]);

  return (
    <div className="flex flex-col gap-6">
      <Badge
        variant="outline"
        className="h-auto gap-1.5 whitespace-normal py-1 text-xs font-normal"
        data-testid="netflow-mock-badge"
      >
        Data Tiruan NetFlow (Fase 2) · Wajib beralih ke Kolektor UDP 2055 nyata
        di Fase 5
      </Badge>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Gagal memuat NetFlow.{" "}
          <button type="button" className="underline" onClick={retry}>
            Coba lagi
          </button>
        </p>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Saring flow"
      >
        <div className="flex flex-col gap-1 text-sm">
          <span id="netflow-range-label">Waktu</span>
          <div
            role="group"
            aria-labelledby="netflow-range-label"
            className="inline-flex h-9 overflow-hidden rounded-md border"
          >
            {ranges.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={filter.range === r.value}
                onClick={() => set({ range: r.value })}
                className="border-l px-3 text-sm first:border-l-0 hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Router
          <select
            className={selectClass}
            value={filter.routerId ?? ""}
            onChange={(e) => set({ routerId: e.target.value || null })}
          >
            <option value="">Semua router</option>
            {mockRouters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Protokol
          <select
            className={selectClass}
            value={filter.protocol ?? ""}
            onChange={(e) =>
              set({ protocol: (e.target.value || null) as FlowProtocol | null })
            }
          >
            <option value="">Semua protokol</option>
            {protocols.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Aplikasi atau port
          <input
            type="text"
            className={selectClass}
            placeholder="YouTube, 443"
            value={filter.query}
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          IP Pelanggan
          <input
            type="text"
            className={selectClass}
            placeholder="Mis. 10.10.x.x"
            aria-label="IP Pelanggan atau IP Asal"
            autoComplete="off"
            value={filter.clientIp}
            onChange={(e) => set({ clientIp: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Port Tujuan
          <input
            type="text"
            inputMode="numeric"
            className={selectClass}
            placeholder="Mis. 443, 80, 53"
            aria-label="Port Tujuan"
            autoComplete="off"
            value={filter.dstPort}
            onChange={(e) => set({ dstPort: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Urutkan
          <select
            className={selectClass}
            data-testid="netflow-sort-select"
            value={sortValue}
            onChange={(e) => setSortValue(e.target.value)}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {hasActiveFilter && (
          <button
            type="button"
            className="h-9 rounded-md border px-3 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() =>
              setFilter((current) => ({
                ...defaultFlowFilter,
                range: current.range,
              }))
            }
          >
            Reset Filter
          </button>
        )}
      </form>

      {!view ? (
        <p className="text-sm text-muted-foreground" role="status">
          Memuat flow…
        </p>
      ) : state && state.data.length === 0 ? (
        <Card data-testid="netflow-empty-state">
          <CardContent className="py-2">
            <TrafficEmptyState
              variant="no_data"
              title="Belum Ada Data Aliran NetFlow"
              description="Server belum menerima paket NetFlow UDP pada port 2055 dari router. Pastikan fitur Traffic Flow di MikroTik sudah diaktifkan dan diarahkan ke port 2055."
              cliHint={
                "/ip traffic-flow set enabled=yes\n/ip traffic-flow target add dst-address=<IP_SERVER> port=2055 version=9"
              }
              onRetry={retry}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="netflow-kpi"
          >
            <Kpi
              label="Total throughput flow"
              value={formatBandwidthRate(view.summary.throughputBps)}
            />
            <Kpi
              label="Protokol teratas"
              value={view.summary.topProtocol ?? "-"}
            />
            <Kpi label="Aplikasi teratas" value={view.summary.topApp ?? "-"} />
            <Kpi
              label="Laju flow"
              value={`${view.summary.flowsPerSec.toFixed(3)} flow/detik`}
            />
          </div>

          <Card>
            <CardHeader className="text-sm text-muted-foreground">
              Tren throughput
            </CardHeader>
            <CardContent>
              <NetflowTrendChart series={view.trend} range={filter.range} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-sm text-muted-foreground">
              20 flow teratas ({sortOptions.find((o) => o.value === sortValue)?.label}) dari{" "}
              {formatInteger(view.count)} flow
            </CardHeader>
            <CardContent>
              {view.top.length === 0 ? (
                <div data-testid="netflow-no-match">
                  <TrafficEmptyState
                    variant="no_match"
                    title="Tidak Ada Flow yang Cocok"
                    description="Tidak ditemukan aliran trafik dengan kriteria saringan saat ini. Periksa kembali IP, port, atau rentang waktu."
                    onResetFilter={() => setFilter(defaultFlowFilter)}
                  />
                </div>
              ) : (
                <div
                  role="region"
                  aria-label="Tabel flow teratas"
                  tabIndex={0}
                  className="overflow-x-auto"
                >
                  <table
                    className="w-full text-left text-sm"
                    data-testid="netflow-table"
                  >
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3 font-medium">No</th>
                        <th className="py-2 pr-3 font-medium">Waktu Mulai</th>
                        <th className="py-2 pr-3 font-medium">Router</th>
                        <th className="py-2 pr-3 font-medium">
                          IP Asal:Port → IP Tujuan:Port
                        </th>
                        <th className="py-2 pr-3 font-medium">Protokol</th>
                        <th className="py-2 pr-3 font-medium">Aplikasi</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Bytes
                        </th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Paket
                        </th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Throughput
                        </th>
                        <th className="py-2 font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.top.map((f, i) => (
                        <tr
                          key={f.id}
                          className="border-t"
                          data-testid="netflow-row"
                        >
                          <td className="py-2 pr-3 tabular-nums">{i + 1}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {formatAlertTime(f.startedAt, state?.now ?? f.startedAt)}
                          </td>
                          <td className="py-2 pr-3">{f.routerName}</td>
                          <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                            {f.srcIp}:{f.srcPort} → {f.dstIp}:{f.dstPort}
                          </td>
                          <td className="py-2 pr-3">
                            <span className="rounded border px-1.5 py-0.5 text-xs font-medium">
                              {f.protocol}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            {f.app}
                            {evaluateFlowAnomaly(f).isAnomaly && (
                              <Badge
                                variant="outline"
                                className="ml-2"
                                data-testid="flow-anomaly-badge"
                                title={evaluateFlowAnomaly(f).reason}
                              >
                                Anomali
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatDataVolume(f.bytes)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatPacketCount(f.packets)}
                          </td>
                          <td
                            className="py-2 pr-3 text-right tabular-nums"
                            title={`Durasi ${formatTrafficDuration(f.durationSec)}`}
                          >
                            {formatBandwidthRate((f.bytes * 8) / Math.max(1, f.durationSec))}
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              data-testid="view-flow-detail-btn"
                              className="h-8 rounded-md border px-2 text-xs hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                              onClick={() => setSelected(f)}
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <NetflowDetailDialog
        flow={selected}
        now={state?.now ?? 0}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
