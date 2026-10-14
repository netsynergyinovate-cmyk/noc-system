"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, History, SearchX } from "lucide-react";
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
  ALERT_HISTORY_PAGE_SIZE,
  ALERT_HISTORY_SECONDS,
  type ResolvedAlert,
} from "@/lib/dashboard/alerts";
import {
  formatElapsed,
  formatInteger,
  isoDuration,
} from "@/lib/dashboard/format";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { paginate } from "@/lib/dashboard/paging";
import {
  defaultResolvedFilters,
  filterResolvedAlerts,
  hasActiveResolvedFilters,
  resolvedFacetCounts,
  type ResolvedFilters,
  type SubjectDirectory,
} from "@/lib/dashboard/resolved-filter";
import { useDashboardStore } from "@/lib/dashboard/store";
import { AlertPlace } from "./alert-place";
import { AlertEndTime, AlertTime } from "./alert-time";
import { AnomalySubject, useSubjectLookup } from "./anomaly-subject";
import { HighlightOnMap } from "./highlight-on-map";
import { ResolvedFilterBar } from "./resolved-filters";
import { SeverityBadge } from "./status-badge";

const days = ALERT_HISTORY_SECONDS / 86_400;

function ResolvedAlertTable({
  alerts,
  now,
}: {
  alerts: ResolvedAlert[];
  now: number;
}) {
  const lookup = useSubjectLookup();
  return (
    <div
      // relative: teks sr-only di dalam sel bersifat absolute; tanpa penampung
      // berposisi ia lolos dari overflow dan melebarkan seluruh halaman.
      className="relative overflow-x-auto rounded-lg border"
      tabIndex={0}
      role="region"
      aria-label="Riwayat alert selesai"
    >
      <table className="w-full min-w-[64rem] text-left text-sm">
        <caption className="sr-only">
          Alert yang sudah selesai, yang paling akhir selesai di atas; waktu
          mulai dan waktu selesai ditulis sampai detik beserta sumber waktunya,
          dengan lamanya di bawah waktu selesai
        </caption>
        <thead className="bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Waktu mulai
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Selesai
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
          {alerts.map((alert) => {
            const lasted = alert.endedAt - alert.startedAt;
            return (
              <tr
                key={alert.id}
                data-testid="resolved-alert-row"
                data-alert-id={alert.id}
                data-severity={alert.severity}
                data-handled={alert.handledBy !== null}
                className="border-t"
              >
                <td className="px-4 py-3 whitespace-nowrap">
                  <AlertTime alert={alert} now={now} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex flex-col">
                    <AlertEndTime alert={alert} now={now} />
                    <span className="text-xs text-muted-foreground">
                      selama{" "}
                      <time
                        dateTime={isoDuration(lasted)}
                        data-testid="resolved-lasted"
                        className="tabular-nums"
                      >
                        {formatElapsed(lasted)}
                      </time>
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    {incidentLabels[alert.kind]}
                  </div>
                  <div className="mt-1">
                    <SeverityBadge severity={alert.severity} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <AnomalySubject anomaly={alert} lookup={lookup} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {describeAnomaly(alert)}
                </td>
                <td className="min-w-40 px-4 py-3">
                  <AlertPlace location={alert.location} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <HighlightOnMap alert={alert} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Tombol halaman memakai aria-disabled, bukan disabled: tombol yang menjadi
// nonaktif sesudah ditekan membuang fokus papan ketik.
function PageButton({
  direction,
  enabled,
  onPress,
}: {
  direction: "previous" | "next";
  enabled: boolean;
  onPress: () => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={!enabled}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      onClick={() => {
        if (enabled) onPress();
      }}
    >
      {direction === "previous" && <Icon aria-hidden="true" />}
      {direction === "previous" ? "Sebelumnya" : "Berikutnya"}
      {direction === "next" && <Icon aria-hidden="true" />}
    </Button>
  );
}

// Daftar kosong yang sama setiap render, supaya memo tidak dihitung ulang.
const noAlerts: ResolvedAlert[] = [];

// Daftar kedua di halaman Alert: yang sudah selesai, paling akhir selesai di
// atas, dengan pencarian dan saringan. Datanya dibaca dari store yang sama dengan
// daftar aktif (AlertBoard); `alerts` null berarti belum termuat. `now` (awal
// menit sekarang) menentukan "selesai dalam 1 jam" dan seterusnya.
export function ResolvedAlertList({
  alerts,
  now,
}: {
  alerts: ResolvedAlert[] | null;
  now: number;
}) {
  const lookup = useSubjectLookup();
  const routers = useDashboardStore((state) => state.routers);
  const directory = useMemo<SubjectDirectory>(
    () => ({
      routerName: (routerId) => lookup.routerNames.get(routerId),
      customer: (customerId) => lookup.customerById.get(customerId),
    }),
    [lookup],
  );
  // Saringan dan halaman yang dipilih adalah satu keadaan: mengubah saringan
  // selalu kembali ke halaman pertama, bukan ke halaman yang mungkin tak ada lagi.
  const [view, setView] = useState({
    filters: defaultResolvedFilters,
    page: 1,
  });
  const all = alerts ?? noAlerts;
  const visible = useMemo(
    () => filterResolvedAlerts(all, view.filters, now, directory),
    [all, view.filters, now, directory],
  );
  const counts = useMemo(
    () =>
      resolvedFacetCounts(
        all,
        view.filters,
        now,
        directory,
        routers.map((router) => router.id),
      ),
    [all, view.filters, now, directory, routers],
  );
  const filtered = hasActiveResolvedFilters(view.filters);
  const shown = paginate(visible, view.page, ALERT_HISTORY_PAGE_SIZE);
  const setFilters = (filters: ResolvedFilters) =>
    setView({ filters, page: 1 });
  const setPage = (page: number) =>
    setView((current) => ({ ...current, page }));
  const resetFilters = () => setFilters(defaultResolvedFilters);

  return (
    <Card
      data-testid="resolved-alerts"
      data-total={alerts?.length}
      data-visible={alerts ? visible.length : undefined}
    >
      <CardHeader>
        <CardTitle>Riwayat alert selesai</CardTitle>
        <CardDescription role="status">
          {alerts
            ? filtered
              ? `Menampilkan ${formatInteger(visible.length)} dari ${formatInteger(alerts.length)} alert selesai dalam ${days} hari terakhir`
              : `${formatInteger(alerts.length)} alert selesai dalam ${days} hari terakhir`
            : "Memuat riwayat…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {alerts === null ? (
          <div
            role="status"
            aria-label="Memuat riwayat alert"
            className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ) : alerts.length === 0 ? (
          <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
            <History className="mx-auto mb-2 size-6" aria-hidden="true" />
            Belum ada alert yang selesai dalam {days} hari terakhir.
          </div>
        ) : (
          <>
            <ResolvedFilterBar
              filters={view.filters}
              counts={counts}
              routers={routers}
              onChange={setFilters}
            />
            {visible.length === 0 ? (
              <div
                data-testid="resolved-no-match"
                className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground"
              >
                <SearchX className="mx-auto mb-2 size-6" aria-hidden="true" />
                <p>Tidak ada alert selesai yang cocok dengan filter.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={resetFilters}
                >
                  Tampilkan semua alert selesai
                </Button>
              </div>
            ) : (
              <>
                <ResolvedAlertTable alerts={shown.items} now={now} />
                <nav
                  aria-label="Halaman riwayat alert"
                  className="flex flex-wrap items-center justify-between gap-3"
                >
                  <p
                    role="status"
                    data-testid="resolved-page-status"
                    className="text-sm text-muted-foreground"
                  >
                    {`Halaman ${formatInteger(shown.page)} dari ${formatInteger(shown.pageCount)}, alert ${formatInteger(shown.from)}–${formatInteger(shown.to)} dari ${formatInteger(shown.total)}`}
                  </p>
                  <div className="flex gap-2">
                    <PageButton
                      direction="previous"
                      enabled={shown.page > 1}
                      onPress={() => setPage(shown.page - 1)}
                    />
                    <PageButton
                      direction="next"
                      enabled={shown.page < shown.pageCount}
                      onPress={() => setPage(shown.page + 1)}
                    />
                  </div>
                </nav>
              </>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Alert yang sudah tidak berjalan lagi. Waktu mulai dan waktu selesai
          sama-sama ditulis sampai detik, masing-masing dengan penanda sumber
          waktunya seperti di daftar aktif (sumber keduanya bisa berbeda). Di
          bawah waktu selesai tertulis <strong>lamanya</strong>, dihitung dari
          waktu mulai sampai selesai. <strong>ditangani oleh N</strong>: alert
          ditutup petugas dengan &quot;Tandai ditangani&quot;; waktu selesainya
          adalah saat petugas mengonfirmasi, bukan saat jaringan terbukti pulih.
        </p>
      </CardContent>
    </Card>
  );
}
