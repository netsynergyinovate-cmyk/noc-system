"use client";

import type { LucideIcon } from "lucide-react";
import { Clock, Cpu, HardDrive, Thermometer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getCpuStatus,
  getMemoryStatus,
  getThermalStatus,
  getUptimeStatus,
  type ResourceTone,
} from "@/lib/dashboard/router-resources";

export interface RouterHardwareCardsProps {
  // null = router tidak mengirim angka; tampilkan "—" (jangan 0 palsu).
  cpuLoad: number | null;
  memoryUsage: number | null;
  uptime: string;
  temperature?: number | null;
  boardModel?: string;
  rosVersion?: string;
  active?: boolean;
  className?: string;
}

const TONE_TEXT: Record<ResourceTone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/50 bg-warning/10 text-warning",
  destructive: "border-destructive/50 bg-destructive/10 text-destructive",
  muted: "text-muted-foreground",
};

const TONE_BAR: Record<ResourceTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/30",
};

function clampPct(n: number) {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
}

function StatusBadge({ tone, label }: { tone: ResourceTone; label: string }) {
  return (
    <Badge variant="outline" className={cn("text-[11px]", TONE_TEXT[tone])}>
      {label}
    </Badge>
  );
}

function Card({
  title,
  Icon,
  value,
  testId,
  children,
}: {
  title: string;
  Icon: LucideIcon;
  value: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3" data-testid={testId}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{title}</span>
      </div>
      <strong className="block font-mono text-lg font-semibold tabular-nums">
        {value}
      </strong>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

function Bar({
  label,
  pct,
  tone,
  active,
}: {
  label: string;
  pct: number;
  tone: ResourceTone;
  active: boolean;
}) {
  const v = active ? clampPct(pct) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-valuetext={active ? `${v}%` : "Tidak tersedia"}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full", TONE_BAR[tone])}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function RouterHardwareCards({
  cpuLoad,
  memoryUsage,
  uptime,
  temperature,
  boardModel,
  rosVersion,
  active = true,
  className,
}: RouterHardwareCardsProps) {
  const cpuAvailable = active && cpuLoad !== null;
  const memAvailable = active && memoryUsage !== null;
  const cpu = getCpuStatus(cpuLoad ?? 0, cpuAvailable);
  const mem = getMemoryStatus(memoryUsage ?? 0, memAvailable);
  const up = getUptimeStatus(uptime, active);
  const thermal = getThermalStatus(temperature ?? undefined, active);

  return (
    <section
      aria-label="Resource hardware router"
      className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}
    >
      <Card
        title="Penggunaan CPU"
        Icon={Cpu}
        value={cpuAvailable ? `${cpuLoad}%` : "—"}
        testId="hw-card-cpu"
      >
        <StatusBadge tone={cpu.tone} label={cpu.label} />
        <Bar
          label="Utilitas CPU"
          pct={cpuLoad ?? 0}
          tone={cpu.tone}
          active={cpuAvailable}
        />
      </Card>
      <Card
        title="Penggunaan RAM"
        Icon={HardDrive}
        value={memAvailable ? `${memoryUsage}%` : "—"}
        testId="hw-card-ram"
      >
        <StatusBadge tone={mem.tone} label={mem.label} />
        <Bar
          label="Utilitas RAM"
          pct={memoryUsage ?? 0}
          tone={mem.tone}
          active={memAvailable}
        />
      </Card>
      <Card
        title="Uptime Sistem"
        Icon={Clock}
        value={active && uptime ? uptime : "—"}
        testId="hw-card-uptime"
      >
        <StatusBadge tone={up.tone} label={up.label} />
        <p className="text-[11px] text-muted-foreground">
          Sejak boot/reboot terakhir
        </p>
      </Card>
      <Card
        title="Suhu & Hardware"
        Icon={Thermometer}
        value={active && temperature ? `${temperature}°C` : "—"}
        testId="hw-card-thermal"
      >
        <StatusBadge tone={thermal.tone} label={thermal.label} />
        {(boardModel || rosVersion) && (
          <p className="text-[11px] text-muted-foreground">
            {[boardModel, rosVersion].filter(Boolean).join(" · ")}
          </p>
        )}
      </Card>
    </section>
  );
}
