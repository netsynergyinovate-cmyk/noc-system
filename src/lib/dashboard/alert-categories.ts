import {
  Activity,
  AlertCircle,
  Server,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

export type AlertCategoryKey =
  "all" | "customer" | "optical" | "core" | "other";

export interface AlertCategoryMeta {
  key: Exclude<AlertCategoryKey, "all">;
  label: string;
  shortLabel: string;
  description: string;
  Icon: LucideIcon;
  badgeClass: string;
}

export const ALERT_CATEGORY_MAP: Record<
  Exclude<AlertCategoryKey, "all">,
  AlertCategoryMeta
> = {
  core: {
    key: "core",
    label: "Perangkat Core",
    shortLabel: "Core",
    description: "Router core, beban CPU, antrean traffic, port error",
    Icon: Server,
    badgeClass:
      "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-300",
  },
  optical: {
    key: "optical",
    label: "Optik & PON",
    shortLabel: "Optik",
    description: "Sinyal optik redaman lemah atau abnormal",
    Icon: Activity,
    badgeClass:
      "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  },
  customer: {
    key: "customer",
    label: "Pelanggan Offline",
    shortLabel: "Pelanggan",
    description: "Pelanggan PPPoE atau ONU terputus",
    Icon: WifiOff,
    badgeClass:
      "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  },
  other: {
    key: "other",
    label: "Lainnya",
    shortLabel: "Lainnya",
    description: "Anomali dan status operasional lainnya",
    Icon: AlertCircle,
    badgeClass: "border-border bg-muted/80 text-muted-foreground",
  },
};

/**
 * Mengelompokkan alert ke dalam 4 kategori definitif:
 * 1. optical: sinyal optik / redaman
 * 2. core: router core unreachable, CPU, queue, port error
 * 3. customer: pelanggan PPPoE / ONU offline
 * 4. other: anomali lainnya
 */
export function classifyAlertCategory(alert: {
  kind?: string | null;
  type?: string | null;
  customerId?: string | null;
  routerId?: string | null;
  title?: string | null;
}): Exclude<AlertCategoryKey, "all"> {
  const k = (alert.kind || alert.type || "").toLowerCase().trim();

  // 1. Optik: langsung dari jenis alert optical
  if (k === "optical") {
    return "optical";
  }

  // 2. Offline: bedakan apakah pelanggan atau router core
  if (k === "offline") {
    if (alert.customerId) {
      return "customer";
    }
    if (alert.customerId === null) {
      return "core";
    }
    // customerId === undefined (mis. baris telemetri dasbor): pakai title
    const title = (alert.title || "").toLowerCase().trim();
    if (title.includes("router") || title.includes("core")) {
      return "core";
    }
    return "customer";
  }

  // 3. Perangkat Core: cpu, queue, port, router_unreachable
  if (
    k === "cpu" ||
    k === "queue" ||
    k === "port" ||
    k === "router_unreachable"
  ) {
    return "core";
  }

  return "other";
}

export function summarizeAlertCategories<
  T extends {
    kind?: string | null;
    type?: string | null;
    customerId?: string | null;
    routerId?: string | null;
    title?: string | null;
  },
>(alerts: readonly T[]): Record<AlertCategoryKey, number> {
  const counts: Record<AlertCategoryKey, number> = {
    all: alerts.length,
    core: 0,
    optical: 0,
    customer: 0,
    other: 0,
  };

  for (const a of alerts) {
    const cat = classifyAlertCategory(a);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }

  return counts;
}
