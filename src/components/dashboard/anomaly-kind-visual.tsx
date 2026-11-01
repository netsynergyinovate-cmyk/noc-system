"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Cpu,
  EthernetPort,
  Gauge,
  Info,
  Signal,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  anomalyRules,
  isActive,
  type Anomaly,
} from "@/lib/dashboard/anomalies";
import { formatElapsed } from "@/lib/dashboard/format";
import { incidentLabels } from "@/lib/dashboard/incidents";
import type { IncidentKind } from "@/lib/dashboard/types";
import { RunningDuration } from "./running-duration";

import {
  anomalyKindInfo,
  formatSource,
  mikrotikSources,
  type SourceInfo,
  type SourceSystem,
} from "@/lib/diagnostic-sources";

export {
  anomalyKindInfo,
  formatSource,
  mikrotikSources,
  type SourceInfo,
  type SourceSystem,
};

export interface KindMetaItem {
  label: string;
  Icon: LucideIcon;
  accent: string;
  chip: string;
}

export const kindMeta: Record<IncidentKind, KindMetaItem> = {
  queue: {
    label: incidentLabels.queue,
    Icon: Gauge,
    accent: "text-chart-1",
    chip: "bg-chart-1/10 text-chart-1 border-chart-1/30",
  },
  cpu: {
    label: incidentLabels.cpu,
    Icon: Cpu,
    accent: "text-warning",
    chip: "bg-warning/10 text-warning border-warning/30",
  },
  port: {
    label: incidentLabels.port,
    Icon: EthernetPort,
    accent: "text-chart-2",
    chip: "bg-chart-2/10 text-chart-2 border-chart-2/30",
  },
  optical: {
    label: incidentLabels.optical,
    Icon: Signal,
    accent: "text-warning",
    chip: "bg-warning/10 text-warning border-warning/30",
  },
  offline: {
    label: incidentLabels.offline,
    Icon: WifiOff,
    accent: "text-destructive",
    chip: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

export function KindIcon({
  kind,
  className,
}: {
  kind: IncidentKind;
  className?: string;
}) {
  const meta = kindMeta[kind] ?? kindMeta.queue;
  const Icon = meta.Icon;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />;
}

// Chip kecil yang selalu terlihat di kartu insiden dan jenis gangguan
export function MikroTikSourceChip({ kind }: { kind: IncidentKind }) {
  const info = anomalyKindInfo[kind];
  const mSources = mikrotikSources(info);
  const primarySource = mSources[0] ?? info.sources[0];
  if (!primarySource) return null;

  return (
    <span
      title={`Sumber data: ${formatSource(primarySource)}`}
      className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground border border-border/70"
    >
      <span className="font-sans font-medium text-foreground">
        {primarySource.system === "MikroTik" ? "Sumber MikroTik:" : `Sumber ${primarySource.system}:`}
      </span>
      <span>{primarySource.path}</span>
    </span>
  );
}

// Tombol info 'Apa ini?' disclosure yang berisi penjelasan + sumber data
export function KindInfoDisclosure({ kind }: { kind: IncidentKind }) {
  const [open, setOpen] = useState(false);
  const info = anomalyKindInfo[kind];

  return (
    <div className="w-full">
      <button
        type="button"
        data-testid="kind-info"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline decoration-dotted transition-colors"
        aria-expanded={open}
      >
        <Info className="size-3" aria-hidden="true" />
        <span>{open ? "Tutup penjelasan" : "Apa ini?"}</span>
      </button>

      {open && (
        <div className="mt-1.5 rounded-md border border-border bg-muted/40 p-2 space-y-1.5 text-[11px] leading-relaxed animate-in fade-in-50 duration-150">
          <div>
            <span className="font-medium text-foreground block">Penjelasan Gangguan:</span>
            <p className="text-muted-foreground">{info.explain}</p>
          </div>
          <div className="pt-1 border-t border-border/60">
            <span className="font-medium text-foreground block mb-1">Sumber Data:</span>
            <div className="space-y-1">
              {info.sources.map((s, idx) => (
                <div key={idx} className="flex flex-wrap items-baseline gap-1 text-[11px]">
                  <span
                    className={cn(
                      "px-1 py-0.2 rounded font-sans font-medium text-[10px] border",
                      s.system === "MikroTik"
                        ? "bg-primary/10 text-primary border-primary/30"
                        : s.system === "OLT"
                          ? "bg-chart-1/10 text-chart-1 border-chart-1/30"
                          : "bg-muted text-foreground border-border",
                    )}
                  >
                    {s.system}
                  </span>
                  <span className="font-mono text-foreground font-medium">{s.path}</span>
                  <span className="text-muted-foreground">({s.via})</span>
                  {s.fields && s.fields.length > 0 && (
                    <span className="text-muted-foreground/80 font-mono text-[10px]">
                      [{s.fields.join(", ")}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Visualisasi spesifik per jenis anomali sesuai Ambang Batas Rule Engine.
// Menampilkan elemen visual yang jelas berbeda per jenis tanpa angka buatan:
// jika anomaly.measured bernilai null, menampilkan teks status netral.
export function KindElement({ anomaly }: { anomaly: Anomaly }) {
  const kind = anomaly.kind;
  const rule = anomalyRules.find((r) => r.kind === kind)!;
  const threshold = rule.threshold;

  if (kind === "queue") {
    const val = anomaly.measured;
    const thresh = threshold ?? 95;
    if (val === null || typeof val !== "number") {
      return (
        <div className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
          Data utilisasi antrean tidak terukur
        </div>
      );
    }
    const pct = Math.min(100, Math.max(0, val));
    return (
      <div className="flex flex-col gap-1 w-full text-[11px]" data-kind-element="queue">
        <div className="flex justify-between items-center text-[11px] font-mono">
          <span className="text-muted-foreground">Utilisasi Antrean</span>
          <span className="font-semibold text-foreground">{val}%</span>
        </div>
        <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", val >= thresh ? "bg-destructive" : "bg-chart-1")}
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-destructive z-10"
            style={{ left: `${thresh}%` }}
            title={`Ambang batas ${thresh}%`}
          />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
          <span>0%</span>
          <span className="text-destructive font-mono">{rule.limit}</span>
          <span>100%</span>
        </div>
      </div>
    );
  }

  if (kind === "cpu") {
    const val = anomaly.measured;
    const thresh = threshold ?? 85;
    if (val === null || typeof val !== "number") {
      return (
        <div className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
          Data CPU tidak terukur
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1 w-full text-[11px]" data-kind-element="cpu">
        <div className="flex justify-between items-center text-[11px] font-mono">
          <span className="text-muted-foreground">Beban CPU Router</span>
          <span className="font-semibold text-foreground">{val}%</span>
        </div>
        <div className="grid grid-cols-10 gap-0.5 h-2 w-full">
          {Array.from({ length: 10 }).map((_, i) => {
            const segMax = (i + 1) * 10;
            const filled = val >= segMax - 5;
            const isCritical = segMax >= thresh;
            return (
              <div
                key={i}
                className={cn(
                  "rounded-xs h-full transition-colors",
                  filled
                    ? isCritical
                      ? "bg-destructive"
                      : "bg-warning"
                    : "bg-muted",
                )}
                title={`Segmen ${(i + 1) * 10}%`}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
          <span>0%</span>
          <span className="text-destructive font-mono">{rule.limit}</span>
          <span>100%</span>
        </div>
      </div>
    );
  }

  if (kind === "port") {
    const val = anomaly.measured;
    const thresh = threshold ?? 20;
    if (val === null || typeof val !== "number") {
      return (
        <div className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
          Data error port tidak terukur
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1 w-full text-[11px]" data-kind-element="port">
        <div className="flex justify-between items-center text-[11px] font-mono">
          <span className="text-muted-foreground">Laju Error Port</span>
          <span className="font-semibold text-destructive">{val} err/menit</span>
        </div>
        <div className="flex items-center gap-0.5 h-2 w-full">
          {Array.from({ length: 20 }).map((_, i) => {
            const tickVal = (i + 1) * 2;
            const active = val >= tickVal;
            const isThreshold = tickVal >= thresh && tickVal - 2 < thresh;
            return (
              <div
                key={i}
                className={cn(
                  "h-full flex-1 rounded-[1px] transition-colors",
                  isThreshold ? "bg-destructive/80" : active ? "bg-chart-2" : "bg-muted",
                )}
                title={`Level ${tickVal} err/min`}
              />
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
          <span>0</span>
          <span className="text-destructive font-mono">{rule.limit}</span>
          <span>40+</span>
        </div>
      </div>
    );
  }

  if (kind === "optical") {
    const val = anomaly.measured;
    const thresh = threshold ?? -25;
    if (val === null || typeof val !== "number") {
      return (
        <div className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
          Data sinyal optik tidak terukur
        </div>
      );
    }
    // Scale: -35 to -10 dBm (span = 25 dBm)
    const threshPct = Math.min(100, Math.max(0, ((thresh - -35) / 25) * 100));
    const markerPct = Math.min(100, Math.max(0, ((val - -35) / 25) * 100));
    return (
      <div className="flex flex-col gap-1 w-full text-[11px]" data-kind-element="optical">
        <div className="flex justify-between items-center text-[11px] font-mono">
          <span className="text-muted-foreground">Sinyal Optik ONU (Rx)</span>
          <span className="font-semibold text-warning">{val} dBm</span>
        </div>
        <div className="relative h-2 w-full rounded-full bg-muted overflow-visible">
          {/* Critical zone */}
          <div
            className="absolute top-0 bottom-0 left-0 rounded-l-full bg-destructive/30"
            style={{ width: `${threshPct}%` }}
          />
          {/* Threshold tick */}
          <div
            className="absolute -top-0.5 bottom-[-2px] w-0.5 bg-destructive z-10"
            style={{ left: `${threshPct}%` }}
            title={`Ambang batas ${thresh} dBm`}
          />
          {/* Measured value indicator dot */}
          <div
            className="absolute -top-1 size-3.5 -ml-1.5 rounded-full border-2 border-card bg-warning z-20 shadow-xs"
            style={{ left: `${markerPct}%` }}
            title={`Terukur: ${val} dBm`}
          />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
          <span>-35 dBm</span>
          <span className="text-destructive font-mono">{rule.limit}</span>
          <span>-10 dBm</span>
        </div>
      </div>
    );
  }

  // offline
  return (
    <div className="flex flex-col gap-1 w-full text-[11px]" data-kind-element="offline">
      <div className="flex justify-between items-center text-[11px]">
        <span className="text-muted-foreground">Sesi PPPoE</span>
        <span className="font-medium text-destructive">Terputus (Dead)</span>
      </div>
      <div className="flex items-center justify-between rounded bg-muted/60 px-2 py-1 border border-border/50 font-mono text-[11px]">
        <span className="text-muted-foreground">Durasi putus:</span>
        <span className="font-semibold text-foreground">
          {isActive(anomaly) ? (
            <RunningDuration startedAt={anomaly.startedAt} />
          ) : (
            <span>selama {formatElapsed((anomaly.endedAt ?? anomaly.startedAt) - anomaly.startedAt)}</span>
          )}
        </span>
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Sesi: Terputus</span>
        <span className="text-destructive font-mono">Batas &gt;30s</span>
      </div>
    </div>
  );
}

// Mini visual untuk kartu 'Per jenis gangguan'
// Selalu menampilkan skala spesifik tiap jenis, baik saat aktif maupun saat idle (0 aktif)
export function KindMiniVisual({
  kind,
  worstAnomaly,
}: {
  kind: IncidentKind;
  worstAnomaly?: Anomaly | null;
}) {
  const rule = anomalyRules.find((r) => r.kind === kind);
  const limitText = rule?.limit ?? "";

  // Saat tidak ada insiden aktif (idle/normal), selalu tampilkan elemen skala jenis bersangkutan
  if (!worstAnomaly || !isActive(worstAnomaly)) {
    if (kind === "queue") {
      const thresh = rule?.threshold ?? 95;
      return (
        <div className="mt-1 pt-1 border-t border-border/70 space-y-1">
          <div className="space-y-0.5 text-[11px]">
            <div className="text-muted-foreground font-mono leading-tight">{limitText}</div>
            <div className="text-muted-foreground/80 font-sans text-[11px] leading-tight">belum ada pengukuran</div>
          </div>
          <div className="relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-destructive z-10"
              style={{ left: `${thresh}%` }}
              title={`Ambang batas ${thresh}%`}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground/75 font-mono">
            <span>0%</span>
            <span className="text-destructive">Batas {thresh}%</span>
            <span>100%</span>
          </div>
        </div>
      );
    }

    if (kind === "cpu") {
      const thresh = rule?.threshold ?? 85;
      return (
        <div className="mt-1 pt-1 border-t border-border/70 space-y-1">
          <div className="space-y-0.5 text-[11px]">
            <div className="text-muted-foreground font-mono leading-tight">{limitText}</div>
            <div className="text-muted-foreground/80 font-sans text-[11px] leading-tight">belum ada pengukuran</div>
          </div>
          <div className="grid grid-cols-10 gap-0.5 h-1.5 w-full">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-xs h-full bg-muted",
                  (i + 1) * 10 >= thresh && i * 10 < thresh && "border-r border-destructive",
                )}
                title={`Segmen ${(i + 1) * 10}%`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground/75 font-mono">
            <span>0%</span>
            <span className="text-destructive">Batas {thresh}%</span>
            <span>100%</span>
          </div>
        </div>
      );
    }

    if (kind === "port") {
      const thresh = rule?.threshold ?? 20;
      return (
        <div className="mt-1 pt-1 border-t border-border/70 space-y-1">
          <div className="space-y-0.5 text-[11px]">
            <div className="text-muted-foreground font-mono leading-tight">{limitText}</div>
            <div className="text-muted-foreground/80 font-sans text-[11px] leading-tight">belum ada pengukuran</div>
          </div>
          <div className="flex items-center gap-0.5 h-1.5 w-full">
            {Array.from({ length: 20 }).map((_, i) => {
              const tickVal = (i + 1) * 2;
              const isThresh = tickVal >= thresh && tickVal - 2 < thresh;
              return (
                <div
                  key={i}
                  className={cn(
                    "h-full flex-1 rounded-[1px] bg-muted",
                    isThresh && "border-r border-destructive",
                  )}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground/75 font-mono">
            <span>0</span>
            <span className="text-destructive">Batas {thresh}/min</span>
            <span>40+</span>
          </div>
        </div>
      );
    }
    if (kind === "optical") {
      const thresh = rule?.threshold ?? -25;
      const threshPct = Math.min(100, Math.max(0, ((thresh - -35) / 25) * 100));
      return (
        <div className="mt-1 pt-1 border-t border-border/70 space-y-1">
          <div className="space-y-0.5 text-[11px]">
            <div className="text-muted-foreground font-mono leading-tight">{limitText}</div>
            <div className="text-muted-foreground/80 font-sans text-[11px] leading-tight">belum ada pengukuran</div>
          </div>
          <div className="relative h-1.5 w-full rounded-full bg-muted overflow-visible">
            <div
              className="absolute top-0 bottom-0 left-0 rounded-l-full bg-destructive/20"
              style={{ width: `${threshPct}%` }}
            />
            <div
              className="absolute -top-0.5 bottom-[-2px] w-0.5 bg-destructive z-10"
              style={{ left: `${threshPct}%` }}
              title={`Ambang batas ${thresh} dBm`}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground/75 font-mono">
            <span>-35 dBm</span>
            <span className="text-destructive">Batas {thresh} dBm</span>
            <span>-10 dBm</span>
          </div>
        </div>
      );
    }
    // offline
    return (
      <div className="mt-1 pt-1 border-t border-border/70 space-y-1">
        <div className="space-y-0.5 text-[11px]">
          <div className="text-muted-foreground font-mono leading-tight">{limitText}</div>
          <div className="text-muted-foreground/80 font-sans text-[11px] leading-tight">tidak ada putus aktif</div>
        </div>
        <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-0.5 border border-border/50 text-[11px]">
          <span className="text-success font-medium flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-success" />
            Semua sesi PPPoE aktif
          </span>
          <span className="text-muted-foreground font-mono">Batas &gt;30s</span>
        </div>
      </div>
    );
  }

  // Saat ada anomali aktif, tampilkan KindElement dengan nilai terukur terburuk
  return (
    <div className="mt-1 pt-1 border-t border-border/70 text-[11px] space-y-1">
      <div className="text-muted-foreground text-[11px] font-mono leading-tight">{limitText}</div>
      <KindElement anomaly={worstAnomaly} />
    </div>
  );
}
