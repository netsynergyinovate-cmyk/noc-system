import {
  Activity,
  AlertCircle,
  Server,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

export type AlertCategoryKey = "all" | "customer" | "optical" | "core" | "other";

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
  const title = (alert.title || "").toLowerCase().trim();

  // 1. Optik
  if (k === "optical" || title.includes("optik") || title.includes("redaman")) {
    return "optical";
  }

  // 2. Offline: bedakan apakah pelanggan atau router core
  if (k === "offline") {
    // Jika customerId ada nilainya -> pelanggan offline
    if (alert.customerId) {
      return "customer";
    }
    // Jika customerId eksplisit null atau title menyebut router -> router core
    if (
      alert.customerId === null ||
      title.includes("router") ||
      title.includes("core")
    ) {
      return "core";
    }
    if (title.includes("pelanggan")) {
      return "customer";
    }
    // Default offline tanpa penanda router dianggap customer
    return "customer";
  }

  // 3. Perangkat Core
  if (
    k === "cpu" ||
    k === "queue" ||
    k === "port" ||
    k === "router_unreachable" ||
    title.includes("router") ||
    title.includes("cpu") ||
    title.includes("antrean") ||
    title.includes("port") ||
    title.includes("traffic")
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
