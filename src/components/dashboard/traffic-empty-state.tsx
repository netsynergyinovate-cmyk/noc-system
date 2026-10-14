"use client";

import { Activity, AlertTriangle, SearchX, type LucideIcon } from "lucide-react";

export interface TrafficEmptyStateProps {
  variant: "no_data" | "no_match" | "collector_offline";
  title?: string;
  description?: string;
  onResetFilter?: () => void;
  onRetry?: () => void;
  cliHint?: string;
}

const DEFAULTS: Record<
  TrafficEmptyStateProps["variant"],
  { Icon: LucideIcon; title: string; description: string }
> = {
  no_data: {
    Icon: Activity,
    title: "Belum Ada Data Trafik",
    description: "Belum ada data trafik yang diterima dari router.",
  },
  no_match: {
    Icon: SearchX,
    title: "Tidak Ada Data yang Cocok",
    description:
      "Tidak ada data dengan kriteria saringan saat ini. Periksa kembali saringan atau rentang waktu.",
  },
  collector_offline: {
    Icon: AlertTriangle,
    title: "Kolektor Tidak Terhubung",
    description: "Kolektor data trafik tidak merespons. Periksa layanannya lalu coba lagi.",
  },
};

const btn =
  "h-9 rounded-md border px-3 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring";

export function TrafficEmptyState({
  variant,
  title,
  description,
  onResetFilter,
  onRetry,
  cliHint,
}: TrafficEmptyStateProps) {
  const d = DEFAULTS[variant];
  const Icon = d.Icon;
  const showHint = !!cliHint && variant !== "no_match";
  return (
    <div
      data-testid="traffic-empty-state"
      data-variant={variant}
      className="flex flex-col items-start gap-3 py-4"
    >
      <div className="flex items-center gap-2">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-lg font-semibold">{title ?? d.title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{description ?? d.description}</p>
      {showHint && (
        <pre className="w-full overflow-x-auto rounded-md border bg-secondary p-3 font-mono text-xs">
          <code>{cliHint}</code>
        </pre>
      )}
      {(onResetFilter || onRetry) && (
        <div className="flex flex-wrap gap-2">
          {onResetFilter && (
            <button
              type="button"
              data-testid="reset-filter-btn"
              className={btn}
              onClick={onResetFilter}
            >
              Reset Filter
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              data-testid="retry-traffic-btn"
              className={btn}
              onClick={onRetry}
            >
              Uji Ulang / Muat Ulang
            </button>
          )}
        </div>
      )}
    </div>
  );
}
