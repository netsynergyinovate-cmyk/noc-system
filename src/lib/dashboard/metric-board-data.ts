// Metrik ringkasan papan dashboard. TIRUAN SEMENTARA: wajib dialihkan ke
// agregator backend nyata saat go-live (Fase 5). Murni, tanpa impor lain.

export interface DashboardKpiMetrics {
  onlineCount: number;
  offlineCount: number;
  totalCustomers: number;
  percentOnline: number;
  weakSignalCount: number;
  criticalSignalCount: number;
  activeRouterCount: number;
  totalRouters: number;
  routerCpuAverage: number;
  totalBandwidthInMbps: number;
  totalBandwidthOutMbps: number;
  activeAlertsCount: number;
  criticalAlertsCount: number;
  warningAlertsCount: number;
  billingPaidCount: number;
  billingIsolatedCount: number;
  sourceStatus: "dummy" | "nyata";
  generatedAt: string;
}

export const DASHBOARD_METRICS_MOCK_ENTRY = {
  id: "dashboard-kpi-metrics",
  module: "Papan Metrik Dashboard",
  targetDevice: "Router & OLT & Billing Aggregator",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/metric-board-data.ts (generateMockDashboardMetrics)",
  writePath: "-",
  envKey: "DASHBOARD_DATA",
  notes:
    "Tiruan sementara metrik ringkasan NOC; wajib dialihkan ke agregator backend nyata saat go-live Fase 5",
};

// Sama dengan WEAK_OPTICAL_DBM di health.ts; diulang agar modul ini tanpa impor.
const WEAK_DBM = -25;
const CRITICAL_DBM = -28;

const round1 = (n: number) => Math.round(n * 10) / 10;
const percent = (part: number, total: number) =>
  total === 0 ? 0 : Math.round((part / total) * 100);

// Fungsi waktu per menit saja: menit yang sama selalu memberi angka yang sama.
export function generateMockDashboardMetrics(
  now: Date = new Date(),
): DashboardKpiMetrics {
  const minute = Math.floor(now.getTime() / 60000);
  const wave = (period: number, phase: number) =>
    (Math.sin((minute + phase) / period) + 1) / 2; // 0..1

  const totalCustomers = 120;
  const offlineCount = 3 + Math.round(wave(17, 1) * 9);
  const onlineCount = totalCustomers - offlineCount;
  const weakSignalCount = 4 + Math.round(wave(23, 2) * 6);
  const criticalSignalCount = Math.min(
    weakSignalCount,
    Math.round(wave(29, 3) * 3),
  );
  const totalRouters = 6;
  const activeRouterCount = totalRouters - (wave(41, 4) > 0.9 ? 1 : 0);
  const criticalAlertsCount = Math.round(wave(19, 5) * 2);
  const warningAlertsCount = 1 + Math.round(wave(13, 6) * 4);
  const billingIsolatedCount = 8 + Math.round(wave(53, 7) * 4);

  return {
    onlineCount,
    offlineCount,
    totalCustomers,
    percentOnline: percent(onlineCount, totalCustomers),
    weakSignalCount,
    criticalSignalCount,
    activeRouterCount,
    totalRouters,
    routerCpuAverage: round1(15 + wave(11, 8) * 35),
    totalBandwidthInMbps: round1(180 + wave(7, 9) * 140),
    totalBandwidthOutMbps: round1(60 + wave(9, 10) * 60),
    activeAlertsCount: criticalAlertsCount + warningAlertsCount,
    criticalAlertsCount,
    warningAlertsCount,
    billingPaidCount: totalCustomers - billingIsolatedCount,
    billingIsolatedCount,
    sourceStatus: "dummy",
    generatedAt: now.toISOString(),
  };
}

interface StoreCustomer {
  isOnline: boolean;
  opticalPowerDbm: number;
  billingStatus: string;
}
interface StoreRouter {
  active: boolean;
  // Opsional: store belum membawa CPU router; kosong dihitung sebagai tidak ada data.
  cpuPercent?: number;
}
interface StoreAlert {
  severity: "info" | "warning" | "critical";
}
interface StoreTraffic {
  rx: readonly number[];
  tx: readonly number[];
}

// Dihitung dari data yang sudah dipegang store. Tanpa pelanggan dan router
// jatuh ke data tiruan. `sourceStatus` bawaan "dummy" karena store masih diisi
// feed tiruan; ganti "nyata" saat feed backend nyata (Fase 5).
export function computeMetricsFromStore(params: {
  customers: readonly StoreCustomer[];
  routers: readonly StoreRouter[];
  alertStore?: { active: readonly StoreAlert[] | null } | null;
  traffic?: StoreTraffic | null;
  sourceStatus?: "dummy" | "nyata";
  now?: Date;
}): DashboardKpiMetrics {
  const { customers, routers, alertStore, traffic } = params;
  const now = params.now ?? new Date();
  if (customers.length === 0 && routers.length === 0) {
    if (params.sourceStatus === "nyata") {
      return {
        onlineCount: 0,
        offlineCount: 0,
        totalCustomers: 0,
        percentOnline: 0,
        weakSignalCount: 0,
        criticalSignalCount: 0,
        activeRouterCount: 0,
        totalRouters: 0,
        routerCpuAverage: 0,
        totalBandwidthInMbps: 0,
        totalBandwidthOutMbps: 0,
        activeAlertsCount: 0,
        criticalAlertsCount: 0,
        warningAlertsCount: 0,
        billingPaidCount: 0,
        billingIsolatedCount: 0,
        sourceStatus: "nyata",
        generatedAt: now.toISOString(),
      };
    }
    return generateMockDashboardMetrics(now);
  }

  let onlineCount = 0;
  let weak = 0;
  let critical = 0;
  let paid = 0;
  let isolated = 0;
  for (const c of customers) {
    if (c.isOnline) {
      onlineCount += 1;
      if (c.opticalPowerDbm < WEAK_DBM) weak += 1;
      if (c.opticalPowerDbm < CRITICAL_DBM) critical += 1;
    }
    if (c.billingStatus === "lunas") paid += 1;
    else if (c.billingStatus === "isolir") isolated += 1;
  }

  const cpus = routers
    .map((r) => r.cpuPercent)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const alerts = alertStore?.active ?? [];
  const last = (values?: readonly number[]) =>
    values && values.length > 0 ? values[values.length - 1] : 0;

  return {
    onlineCount,
    offlineCount: customers.length - onlineCount,
    totalCustomers: customers.length,
    percentOnline: percent(onlineCount, customers.length),
    weakSignalCount: weak,
    criticalSignalCount: critical,
    activeRouterCount: routers.filter((r) => r.active).length,
    totalRouters: routers.length,
    routerCpuAverage:
      cpus.length === 0
        ? 0
        : round1(cpus.reduce((a, b) => a + b, 0) / cpus.length),
    totalBandwidthInMbps: round1(last(traffic?.rx)),
    totalBandwidthOutMbps: round1(last(traffic?.tx)),
    activeAlertsCount: alerts.length,
    criticalAlertsCount: alerts.filter((a) => a.severity === "critical").length,
    warningAlertsCount: alerts.filter((a) => a.severity === "warning").length,
    billingPaidCount: paid,
    billingIsolatedCount: isolated,
    sourceStatus: params.sourceStatus ?? "dummy",
    generatedAt: now.toISOString(),
  };
}

export function isMetricBoardMockActive(
  status?: "dummy" | "nyata",
): boolean {
  return status === "dummy";
}
