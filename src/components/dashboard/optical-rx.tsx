"use client";

import { calculateOpticalLoss, getOnuTxStatus } from "@/lib/dashboard/optical";

export { OpticalRx } from "./optical-badge";

/** Redaman total (dB) = TX - RX. "-" bila tidak dapat dihitung. */
export function OpticalLoss({
  txDbm,
  rxDbm,
}: {
  txDbm: number | null | undefined;
  rxDbm: number | null | undefined;
}) {
  const loss = calculateOpticalLoss(txDbm, rxDbm);
  return (
    <span className="tabular-nums font-mono text-xs" data-testid="optical-loss" title="Redaman = TX ONU - RX OLT">
      {loss == null ? "-" : `${loss} dB`}
    </span>
  );
}

/** Daya pancar ONU (dBm); ditandai bila di luar 1.0..3.5 dBm. */
export function OpticalTx({ dbm }: { dbm: number | null | undefined }) {
  const s = getOnuTxStatus(dbm);
  return (
    <span
      className={`tabular-nums font-mono text-xs ${s.ok || dbm == null ? "text-muted-foreground" : "text-warning"}`}
      data-testid="optical-tx"
      data-ok={s.ok}
      title={s.label}
    >
      {dbm == null ? "-" : `${dbm} dBm`}
    </span>
  );
}
