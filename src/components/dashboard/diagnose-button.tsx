"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DiagnosticRunView, errorMessage } from "./diagnostic-run-view";
import type { DiagnosticRunDto } from "@/lib/diagnostics";

export async function requestDiagnostic(
  customerId: string,
  complaintAt?: string,
) {
  const res = await fetch("/api/anomalies/diagnostics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId, complaintAt }),
  });
  if (!res.ok)
    throw new Error(await errorMessage(res, "Gagal memulai diagnosa"));
  return (await res.json()) as { data: DiagnosticRunDto; reused: boolean };
}

// Tombol diagnosa manual. Selalu aktif: tekan lagi saat pemeriksaan masih
// berjalan = server mengembalikan pemeriksaan yang sama, bukan yang baru.
export function DiagnoseButton({
  customerId,
  customerName,
  size = "sm",
  className,
}: {
  customerId: string;
  customerName: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setStarting(true);
    setError(null);
    try {
      const { data, reused } = await requestDiagnostic(customerId);
      setRunId(data.id);
      setReused(reused);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai diagnosa.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className}
        title={`Diagnosa ${customerName}`}
        aria-busy={starting}
        data-testid="diagnose-button"
        onClick={() => void start()}
      >
        <Stethoscope aria-hidden="true" className="size-3.5" />
        Diagnosa
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:max-w-3xl sm:p-5 [&>*]:min-w-0">
          <DialogHeader className="pb-2 border-b border-border/40">
            <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Stethoscope aria-hidden="true" className="size-4 text-primary" />
              Diagnosa pelanggan
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Pemeriksaan berlapis hulu ke hilir, hanya membaca perangkat.
            </DialogDescription>
          </DialogHeader>
          {starting && !runId && (
            <p className="text-sm text-muted-foreground" role="status">
              Memulai diagnosa…
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {reused && (
            <p className="text-sm text-muted-foreground">
              Diagnosa manual pelanggan ini masih berjalan; yang tampil adalah
              pemeriksaan tersebut.
            </p>
          )}
          {runId && <DiagnosticRunView key={runId} runId={runId} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
