"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAlertTime } from "@/lib/dashboard/alerts";
import { formatInteger } from "@/lib/dashboard/format";
import { formatBps, formatBytes, type NetflowRecord } from "@/lib/dashboard/netflow";
import {
  evaluateFlowAnomaly,
  flowThroughputBps,
} from "@/lib/dashboard/netflow-filter-sort";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-t py-1.5 text-sm first:border-t-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function formatDuration(sec: number): string {
  return `${formatInteger(sec)} detik (${(sec / 60).toFixed(1)} menit)`;
}

export function NetflowDetailDialog({
  flow,
  now,
  onClose,
}: {
  flow: NetflowRecord | null;
  now: number;
  onClose: () => void;
}) {
  const anomaly = flow ? evaluateFlowAnomaly(flow) : null;
  return (
    <Dialog open={flow !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="flow-detail-dialog" className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Rincian Aliran Trafik NetFlow</DialogTitle>
          <DialogDescription>
            Atribut lengkap satu aliran yang dicatat router.
          </DialogDescription>
        </DialogHeader>
        {flow && anomaly && (
          <dl className="max-h-[60vh] overflow-y-auto">
            <Row label="ID Aliran">
              <span className="font-mono text-xs">{flow.id}</span>
            </Row>
            <Row label="Router Asal">{flow.routerName}</Row>
            <Row label="Waktu Mulai">{formatAlertTime(flow.startedAt, now)}</Row>
            <Row label="Waktu Selesai">{formatAlertTime(flow.endedAt, now)}</Row>
            <Row label="Durasi">{formatDuration(flow.durationSec)}</Row>
            <Row label="Endpoint">
              <span className="font-mono text-xs">
                {flow.srcIp}:{flow.srcPort} → {flow.dstIp}:{flow.dstPort}
              </span>
            </Row>
            <Row label="Protokol">{flow.protocol}</Row>
            <Row label="Layanan Aplikasi">{flow.app}</Row>
            <Row label="Total Volume">
              {formatInteger(flow.bytes)} bytes ({formatBytes(flow.bytes)})
            </Row>
            <Row label="Total Paket">{formatInteger(flow.packets)}</Row>
            <Row label="Rata-rata Throughput">
              {formatBps(flowThroughputBps(flow))}
            </Row>
            <Row label="Evaluasi Anomali">
              <span data-testid="flow-detail-anomaly">
                {anomaly.isAnomaly ? (
                  <Badge variant="outline">
                    Anomali ({anomaly.severity}): {anomaly.reason}
                  </Badge>
                ) : (
                  "Normal"
                )}
              </span>
            </Row>
          </dl>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid="flow-detail-close"
            onClick={onClose}
          >
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
