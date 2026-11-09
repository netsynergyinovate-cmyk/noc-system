import { AlertTriangle, CheckCircle2, XOctagon } from "lucide-react";
import {
  getOpticalSignalStatus,
  OPTICAL_SHORT_LABEL,
  OPTICAL_TONE_CLASS,
  OPTICAL_TEXT_CLASS,
} from "@/lib/dashboard/optical";
import { formatDbm } from "@/lib/dashboard/format";

/** Nilai RX + badge status sinyal. Teks dan ikon membedakan level, bukan hanya warna. */
export function OpticalRx({ dbm }: { dbm: number | null | undefined }) {
  const s = getOpticalSignalStatus(dbm);
  const Icon =
    s.tone === "success"
      ? CheckCircle2
      : s.tone === "danger"
        ? XOctagon
        : AlertTriangle;
  return (
    <div
      className="flex items-center gap-2"
      data-testid="optical-rx"
      data-level={s.level}
      data-out={s.isOutOfThreshold}
    >
      <span
        className={`font-mono text-sm font-semibold tabular-nums ${OPTICAL_TEXT_CLASS[s.tone]}`}
      >
        {dbm == null ? "—" : formatDbm(dbm)}
      </span>
      <span
        title={s.description}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${OPTICAL_TONE_CLASS[s.tone]}`}
      >
        <Icon aria-hidden="true" className="size-3" />
        {OPTICAL_SHORT_LABEL[s.level]}
      </span>
    </div>
  );
}
