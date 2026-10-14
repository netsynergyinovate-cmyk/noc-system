import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { type DeviceConfig, type TestOutcome, formatDeviceError } from "@/lib/dashboard/device-config";

interface Props {
  outcome: TestOutcome;
  device: DeviceConfig;
  className?: string;
}

// Hasil uji koneksi seragam untuk semua kartu perangkat.
export function DeviceOutcomeAlert({ outcome, device, className }: Props) {
  if (outcome.ok) {
    return (
      <div
        role="status"
        data-testid="device-outcome-alert"
        data-code={outcome.code || "OK"}
        data-tone="success"
        className={cn(
          "flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-800 dark:text-emerald-300",
          className,
        )}
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold">
            Koneksi berhasil{outcome.latencyMs != null ? ` (${outcome.latencyMs} ms)` : ""}
          </p>
          {outcome.message && <p className="break-words">{outcome.message}</p>}
        </div>
      </div>
    );
  }

  const err = formatDeviceError(outcome, device);
  const timeout = outcome.code === "TIMEOUT" || outcome.status === "timeout";
  const Icon = timeout ? Clock : AlertCircle;
  return (
    <div
      role="alert"
      data-testid="device-outcome-alert"
      data-code={outcome.code || "UNKNOWN"}
      data-tone={timeout ? "warning" : "destructive"}
      className={cn(
        "flex items-start gap-2 rounded-md border p-2.5 text-xs",
        timeout
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-destructive/20 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold" data-testid="device-outcome-title">
          {err.title}
        </p>
        <p className="break-words" data-testid="device-outcome-detail">
          {err.detail}
        </p>
        <p className="break-words text-foreground" data-testid="device-outcome-suggestion">
          Saran: {err.suggestion}
        </p>
      </div>
    </div>
  );
}
