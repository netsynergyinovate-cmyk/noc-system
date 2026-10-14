"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { DeviceStatusBadge } from "@/components/dashboard/device-status-badge";
import { DeviceTestButton } from "@/components/dashboard/device-test-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getDeviceTypeLabel,
  summarizeDeviceStatuses,
  type DeviceConfig,
  type TestOutcome,
} from "@/lib/dashboard/device-config";

// UTC tetap supaya HTML server dan klien sama.
const timeFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

interface Props {
  devices: DeviceConfig[];
  results: Record<string, { ok: boolean; message: string }>;
  testingId: string | null;
  testingAll: boolean;
  onTest: (device: DeviceConfig) => void;
  onTestAll: () => void;
  /** Hasil uji simulasi lokal per perangkat (tombol "Uji simulasi lokal"). */
  onLocalOutcome?: (device: DeviceConfig, outcome: TestOutcome) => void;
}

export function ConnectionTestPanel({
  devices,
  results,
  testingId,
  testingAll,
  onTest,
  onTestAll,
  onLocalOutcome,
}: Props) {
  const [localTestingIds, setLocalTestingIds] = useState<string[]>([]);
  const busy = testingAll || testingId !== null || localTestingIds.length > 0;
  const testingIds = testingAll
    ? devices.map((d) => d.id)
    : [...(testingId !== null ? [testingId] : []), ...localTestingIds];
  const sum = summarizeDeviceStatuses(devices, testingIds);
  const tested = sum.total - sum.untested - sum.testing;
  const setLocalTesting = (id: string, b: boolean) =>
    setLocalTestingIds((prev) => (b ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Panel Uji Koneksi Terpadu</CardTitle>
          <CardDescription className="text-xs">
            {sum.testing > 0
              ? `Sedang menguji ${sum.testing} perangkat...`
              : tested === 0
                ? "Belum ada perangkat yang diuji."
                : `${sum.connected} dari ${sum.total} perangkat terhubung (${tested} sudah diuji${
                    sum.error + sum.timeout > 0 ? `, ${sum.error} gagal, ${sum.timeout} timeout` : ""
                  }).`}
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onTestAll}
          aria-disabled={busy}
          className="gap-2"
        >
          <RefreshCw className={`size-4 ${testingAll ? "animate-spin" : ""}`} />
          <span>{testingAll ? "Menguji semua..." : "Uji semua"}</span>
        </Button>
      </CardHeader>
      <CardContent>
        <div
          role="region"
          tabIndex={0}
          aria-label="Hasil uji koneksi per perangkat"
          className="overflow-x-auto"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Perangkat</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Latensi</TableHead>
                <TableHead>Terakhir diuji</TableHead>
                <TableHead>Hasil</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => {
                const res = results[d.id];
                const testing = testingIds.includes(d.id);
                return (
                  <TableRow key={d.id} data-testid="connection-test-row" data-status={d.status}>
                    <TableCell>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {getDeviceTypeLabel(d.type)} · {d.host}:{d.port}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DeviceStatusBadge status={d.status} isTesting={testing} showLatency={false} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {d.latencyMs != null ? `${d.latencyMs} ms` : "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.lastTestedAt ? `${timeFormat.format(new Date(d.lastTestedAt * 1000))} UTC` : "-"}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs whitespace-normal">
                      {res ? res.message : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onTest(d)}
                        aria-disabled={busy}
                        aria-label={`Uji ulang ${d.name}`}
                        className="gap-1.5 text-xs"
                      >
                        <RefreshCw className="size-3.5" />
                        Uji ulang
                      </Button>
                      <div className="mt-1 flex justify-end">
                        <DeviceTestButton
                          device={d}
                          forceLocal
                          label="Uji simulasi lokal"
                          ariaLabel={`Uji simulasi lokal ${d.name}`}
                          variant="ghost"
                          disabled={busy}
                          onOutcome={(r) => onLocalOutcome?.(d, r)}
                          onTestingChange={(b) => setLocalTesting(d.id, b)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
