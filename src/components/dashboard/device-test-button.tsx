"use client";

import { useRef, useState } from "react";
import { Info, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeviceOutcomeAlert } from "@/components/dashboard/device-outcome-alert";
import {
  type DeviceConfig,
  type TestOutcome,
  runDeviceTest,
  statusLabel,
} from "@/lib/dashboard/device-config";

// UTC tetap supaya HTML server dan klien sama.
const timeFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "UTC",
});

interface Props {
  device: DeviceConfig;
  onOutcome?: (outcome: TestOutcome) => void;
  /** Dipanggil true saat uji mulai dan false saat selesai (blok finally). */
  onTestingChange?: (busy: boolean) => void;
  /** Paksa simulasi lokal tanpa memanggil endpoint backend. */
  forceLocal?: boolean;
  /** Tampilkan pilihan mode: "Uji Simulasi Lokal" vs "Uji Endpoint Nyata". */
  showDropdownOrToggle?: boolean;
  /** Matikan tombol dari luar (mis. pengujian lain sedang berjalan). */
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  variant?: "default" | "outline" | "ghost";
}

export function DeviceTestButton({
  device,
  onOutcome,
  onTestingChange,
  forceLocal = false,
  showDropdownOrToggle = false,
  disabled = false,
  label = "Uji Koneksi",
  ariaLabel,
  variant = "outline",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(forceLocal);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [open, setOpen] = useState(false);
  const running = useRef(false);

  const useLocal = forceLocal || local;
  const blocked = busy || disabled;

  async function run() {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    onTestingChange?.(true);
    try {
      const r = await runDeviceTest(device, { forceLocal: useLocal });
      const full: TestOutcome = { ...r, timestamp: r.timestamp ?? Math.floor(Date.now() / 1000) };
      setOutcome(full);
      onOutcome?.(full);
    } finally {
      running.current = false;
      setBusy(false);
      onTestingChange?.(false);
    }
  }

  const status = outcome ? (outcome.status ?? (outcome.ok ? "connected" : "error")) : null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="device-test-button">
      {showDropdownOrToggle && !forceLocal && (
        <select
          aria-label={`Mode uji untuk ${device.name}`}
          value={local ? "local" : "real"}
          onChange={(e) => setLocal(e.target.value === "local")}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          <option value="local">Uji Simulasi Lokal</option>
          <option value="real">Uji Endpoint Nyata</option>
        </select>
      )}
      <Button
        type="button"
        size="sm"
        variant={variant}
        aria-disabled={blocked}
        aria-label={ariaLabel}
        onClick={() => {
          if (!blocked) void run();
        }}
        className="gap-1.5 text-xs"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="size-3.5" aria-hidden="true" />
        )}
        <span>{busy ? "Menguji..." : label}</span>
      </Button>
      {outcome && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(true)}
          aria-label={`Rincian uji ${device.name}`}
          className="gap-1.5 text-xs"
        >
          <Info className="size-3.5" aria-hidden="true" />
          <span>Rincian</span>
        </Button>
      )}
      {outcome && status && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent data-testid="device-test-detail">
            <DialogHeader>
              <DialogTitle>Rincian Uji: {device.name}</DialogTitle>
              <DialogDescription>{outcome.message}</DialogDescription>
            </DialogHeader>
            <DeviceOutcomeAlert outcome={outcome} device={device} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd data-testid="detail-status">{statusLabel(status)}</dd>
              <dt className="text-muted-foreground">Latensi</dt>
              <dd className="tabular-nums" data-testid="detail-latency">
                {outcome.latencyMs != null ? `${outcome.latencyMs} ms` : "-"}
              </dd>
              <dt className="text-muted-foreground">Kode status</dt>
              <dd data-testid="detail-code">
                {outcome.statusCode ?? "-"}
                {outcome.code ? ` (${outcome.code})` : ""}
              </dd>
              <dt className="text-muted-foreground">Endpoint diuji</dt>
              <dd className="break-all font-mono text-xs" data-testid="detail-endpoint">
                {outcome.endpointTested ?? "-"}
              </dd>
              <dt className="text-muted-foreground">Waktu uji</dt>
              <dd data-testid="detail-time">
                {outcome.timestamp ? `${timeFormat.format(new Date(outcome.timestamp * 1000))} UTC` : "-"}
              </dd>
            </dl>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
