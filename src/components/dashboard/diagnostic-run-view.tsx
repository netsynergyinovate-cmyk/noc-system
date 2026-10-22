"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Loader2,
  XOctagon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OPTICAL_TONE_CLASS } from "@/lib/dashboard/optical";
import {
  diagnosticLayers,
  layerLabel,
  triggerReasonLabels,
  type DiagnosticRunDto,
  type FindingDto,
  type FindingStatus,
} from "@/lib/diagnostics";

export async function errorMessage(res: Response, fallback: string) {
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return json?.error?.message ?? `${fallback} (HTTP ${res.status}).`;
}

const when = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Jakarta",
});
export const formatWhen = (iso: string | null) => (iso ? when.format(new Date(iso)) : "—");

const statusView: Record<
  FindingStatus,
  { label: string; tone: keyof typeof OPTICAL_TONE_CLASS; Icon: typeof CheckCircle2 }
> = {
  ok: { label: "Normal", tone: "success", Icon: CheckCircle2 },
  warn: { label: "Peringatan", tone: "warning", Icon: AlertTriangle },
  fail: { label: "Bermasalah", tone: "danger", Icon: XOctagon },
  unchecked: { label: "Tidak dapat diperiksa", tone: "neutral", Icon: CircleHelp },
};

export function FindingStatusPill({ status }: { status: FindingStatus }) {
  const v = statusView[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        OPTICAL_TONE_CLASS[v.tone],
      )}
    >
      <v.Icon aria-hidden="true" className="size-3" />
      {v.label}
    </span>
  );
}

export const isRunActive = (run: Pick<DiagnosticRunDto, "status">) =>
  run.status === "queued" || run.status === "running";

// Asal diagnosa: manual (siapa) atau otomatis (pemicu), plus penggabungan.
export function RunOrigin({ run }: { run: DiagnosticRunDto }) {
  const reason = triggerReasonLabels[run.triggerReason] ?? run.triggerReason;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={run.triggerMode === "manual" ? "default" : "secondary"}>
        {run.triggerMode === "manual" ? "Manual" : "Otomatis"}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {run.triggerMode === "manual" ? `oleh ${run.triggeredBy ?? "—"}` : reason}
        {run.mergedCount > 0 && ` · digabung ${run.mergedCount} kejadian`}
      </span>
    </span>
  );
}

// Memuat satu run dan memperbaruinya tiap detik selama masih berjalan.
// Pasang dengan key={runId} supaya keadaan mulai bersih untuk run lain.
function useDiagnosticRun(runId: string) {
  const [run, setRun] = useState<DiagnosticRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const res = await fetch(`/api/anomalies/diagnostics/${encodeURIComponent(runId)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Gagal memuat diagnosa"));
        const { data } = (await res.json()) as { data: DiagnosticRunDto };
        if (stopped) return;
        setRun(data);
        setError(null);
        if (isRunActive(data)) timer = setTimeout(load, 1000);
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : "Gagal memuat diagnosa.");
        timer = setTimeout(load, 3000);
      }
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);
  return { run, error };
}

function FindingRow({ f }: { f: FindingDto }) {
  return (
    <li className="flex flex-col gap-1 py-2" data-testid="diagnostic-finding" data-status={f.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{f.label}</span>
        <FindingStatusPill status={f.status} />
      </div>
      {f.value !== null && (
        <div className="text-sm">
          <span className="font-mono tabular-nums">{f.value}</span>
          {f.threshold !== null && (
            <span className="text-muted-foreground">
              {" "}
              · ambang {f.comparator} {f.threshold}
            </span>
          )}
        </div>
      )}
      <p className="text-sm text-muted-foreground">{f.detail}</p>
      {(f.sourceRef || f.sampledAt) && (
        <p className="text-xs text-muted-foreground">
          Sumber: {f.sourceRef ?? "—"}
          {f.sampledAt && ` · sampel ${formatWhen(f.sampledAt)}`}
        </p>
      )}
    </li>
  );
}

const eventTone: Record<string, string> = {
  log_logout: "text-destructive",
  log_no_address: "text-destructive",
  log_auth_fail: "text-destructive",
  log_link_down: "text-destructive",
  log_addr_conflict: "text-warning",
  log_firewall: "text-warning",
  alert: "text-warning",
  log_login: "text-success",
  log_link_up: "text-success",
  alert_end: "text-success",
};

function relative(ms: number) {
  const sec = Math.round(Math.abs(ms) / 1000);
  if (sec < 30) return "saat keluhan";
  const text = sec < 3600 ? `${Math.round(sec / 60)} mnt` : `${(sec / 3600).toFixed(1)} jam`;
  return ms < 0 ? `${text} sebelum` : `${text} sesudah`;
}

// Kejadian log dan alert diurut waktu, dengan penanda keluhan di posisinya.
function Timeline({ run }: { run: DiagnosticRunDto }) {
  const anchorIso = run.complaintAt ?? run.createdAt;
  const anchor = new Date(anchorIso).getTime();
  const items = run.timeline ?? [];
  const before = items.filter((e) => new Date(e.at).getTime() <= anchor);
  const after = items.filter((e) => new Date(e.at).getTime() > anchor);
  const row = (e: DiagnosticRunDto["timeline"][number], i: number) => (
    <li key={`${e.at}-${i}`} className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3" data-testid="timeline-event">
      <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
        {formatWhen(e.at)}
        <span className="block">{relative(new Date(e.at).getTime() - anchor)}</span>
      </span>
      <span className="min-w-0">
        <span className={cn("font-medium", eventTone[e.kind])}>{e.label}</span>
        <span className="block break-words text-xs text-muted-foreground">
          {e.detail} · {e.source}
        </span>
      </span>
    </li>
  );
  return (
    <section aria-labelledby={`timeline-${run.id}`} className="rounded-md border px-3 py-2">
      <h3 id={`timeline-${run.id}`} className="text-sm font-semibold">
        Garis waktu terhadap keluhan
      </h3>
      {items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Tidak ada kejadian log atau alert pelanggan di sekitar keluhan (lihat cakupan log di lapisan Log).
        </p>
      ) : (
        <ol className="divide-y text-sm">
          {before.map(row)}
          <li className="py-1.5 text-xs font-semibold text-primary" data-testid="timeline-complaint">
            ▶ Keluhan · {formatWhen(anchorIso)}
          </li>
          {after.map(row)}
        </ol>
      )}
    </section>
  );
}

export function DiagnosticRunView({ runId }: { runId: string }) {
  const { run, error } = useDiagnosticRun(runId);

  if (!run) {
    return (
      <div className="text-sm text-muted-foreground" role="status">
        {error ? <span className="text-destructive">{error}</span> : "Memuat diagnosa…"}
      </div>
    );
  }

  const findings = run.findings ?? [];
  const byLayer = new Map<string, FindingDto[]>();
  for (const f of findings) byLayer.set(f.layer, [...(byLayer.get(f.layer) ?? []), f]);
  const layers = run.isSharedFault
    ? diagnosticLayers.filter((l) => byLayer.has(l.id))
    : diagnosticLayers;
  const active = isRunActive(run);

  return (
    <div className="flex flex-col gap-4" data-testid="diagnostic-run" data-status={run.status}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {run.isSharedFault ? "Gangguan bersama" : (run.customerName ?? "Pelanggan terhapus")}
          </span>
          {run.pppoeUsername && (
            <span className="font-mono text-xs text-muted-foreground">{run.pppoeUsername}</span>
          )}
        </div>
        <RunOrigin run={run} />
        <p className="text-xs text-muted-foreground">
          Keluhan {formatWhen(run.complaintAt ?? run.createdAt)} · diminta {formatWhen(run.createdAt)} · mulai{" "}
          {formatWhen(run.startedAt)} · selesai{" "}
          {formatWhen(run.finishedAt)}
        </p>
      </div>

      <div
        role="status"
        aria-live="polite"
        className={cn(
          "rounded-md border p-3 text-sm",
          run.status === "failed" && "border-destructive/40 bg-destructive/10 text-destructive",
          run.status === "done" && run.verdictLayer && "border-destructive/30 bg-destructive/5",
        )}
      >
        {run.status === "queued" && (
          <span className="inline-flex items-center gap-2">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Menunggu antrean pemeriksaan router…
          </span>
        )}
        {run.status === "running" && (
          <span className="inline-flex items-center gap-2">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Memeriksa lapisan {Math.min(byLayer.size + 1, diagnosticLayers.length)} dari{" "}
            {diagnosticLayers.length}…
          </span>
        )}
        {run.status === "failed" && <>Diagnosa gagal: {run.error ?? "alasan tidak diketahui"}</>}
        {run.status === "done" && (
          <>
            <span className="font-medium">
              Kesimpulan{run.verdictLayer ? `: ${layerLabel(run.verdictLayer)}` : ""}.
            </span>{" "}
            {run.verdictDetail}
          </>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <ol className="flex flex-col gap-3">
        {layers.map((layer, i) => {
          const list = byLayer.get(layer.id);
          return (
            <li key={layer.id} className="rounded-md border px-3 py-2" data-testid="diagnostic-layer" data-layer={layer.id}>
              <h3 className="text-sm font-semibold">
                {i + 1}. {layer.label}
              </h3>
              {list ? (
                <ul className="divide-y text-sm">
                  {list.map((f) => (
                    <FindingRow key={f.id} f={f} />
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  {active ? "Menunggu giliran…" : "Tidak ada data untuk lapisan ini."}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {!active && !run.isSharedFault && <Timeline run={run} />}
    </div>
  );
}
