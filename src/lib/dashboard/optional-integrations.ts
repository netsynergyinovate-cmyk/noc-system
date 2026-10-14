// Sumber data & evaluasi Integrasi Opsional Terpandu (Fase 6 - Tutorial & Onboarding).
// Memantau status konfigurasi modul opsional (OLT, GenieACS, NetFlow, WhatsApp, Billing).
// Murni.

import type { DataSourceEntry } from "./setup-extended.ts";

export type OptionalIntegrationStatus =
  | "terkonfigurasi"
  | "belum-dikonfigurasi"
  | "dalam-pengujian";

export interface OptionalIntegrationItem {
  id: string;
  name: string;
  category: "akses" | "monitoring" | "notifikasi" | "billing";
  description: string;
  targetDeviceOrService: string;
  envKey: string;
  status: OptionalIntegrationStatus;
  mode: "simulator" | "real";
  routeUrl: string;
  routeLabel: string;
  benefit: string;
  requiredVars: readonly string[];
}

export interface OptionalIntegrationsOverview {
  total: number;
  configuredCount: number;
  unconfiguredCount: number;
  completionPercentage: number;
  items: readonly OptionalIntegrationItem[];
}

export const OPTIONAL_INTEGRATIONS_MOCK_ENTRY: DataSourceEntry = {
  id: "optional-integrations-mock",
  module: "Daftar Integrasi Opsional Terpandu",
  targetDevice: "Layanan Eksternal & Perangkat Tambahan ISP",
  status: "dummy",
  readPath: "src/lib/dashboard/optional-integrations.ts",
  writePath: "POST /api/devices/status",
  envKey: "DASHBOARD_DATA",
  notes:
    "Tiruan sementara daftar integrasi opsional terpandu; dievaluasi dari environment dan tabel database saat go-live.",
};

export const OPTIONAL_INTEGRATION_TEMPLATES: readonly OptionalIntegrationItem[] = [
  {
    id: "opt-olt-hsgq",
    name: "OLT HSGQ & Port PON",
    category: "akses",
    description:
      "Pemantauan status port optik PON, redaman RX/TX Power ONU, dan inventaris modem GPON/EPON.",
    targetDeviceOrService: "OLT HSGQ (SNMP / Telnet Management)",
    envKey: "OLT_HSGQ_HOST",
    status: "belum-dikonfigurasi",
    mode: "simulator",
    routeUrl: "/app/cpe",
    routeLabel: "Kelola OLT & PON",
    benefit: "Mendeteksi kabel fiber putus dan redaman drop sebelum pelanggan komplain.",
    requiredVars: ["OLT_HSGQ_HOST", "OLT_HSGQ_USER", "OLT_HSGQ_PASSWORD"],
  },
  {
    id: "opt-genieacs-nbi",
    name: "GenieACS NBI (TR-069 ACS)",
    category: "akses",
    description:
      "Diagnostik CPE/ONU pelanggan dari jarak jauh, reboot modem, dan baca parameter Wi-Fi.",
    targetDeviceOrService: "GenieACS NBI API (Port 7557)",
    envKey: "GENIEACS_NBI_URL",
    status: "belum-dikonfigurasi",
    mode: "simulator",
    routeUrl: "/app/pengaturan/perangkat",
    routeLabel: "Integrasi GenieACS",
    benefit: "Teknisi dapat troubleshooting Wi-Fi tanpa datang ke rumah pelanggan.",
    requiredVars: ["GENIEACS_NBI_URL"],
  },
  {
    id: "opt-netflow-collector",
    name: "NetFlow v5/v9 Collector",
    category: "monitoring",
    description:
      "Penerimaan aliran sampel trafik UDP port 2055 untuk analisis top talker, protokol, dan lonjakan anomali.",
    targetDeviceOrService: "Go NetFlow Engine (UDP 2055)",
    envKey: "NETFLOW_COLLECTOR_HOST",
    status: "belum-dikonfigurasi",
    mode: "simulator",
    routeUrl: "/app/netflow",
    routeLabel: "Papan NetFlow",
    benefit: "Mengetahui IP pelanggan yang menyedot bandwidth besar atau terindikasi DDoS.",
    requiredVars: ["NETFLOW_COLLECTOR_HOST"],
  },
  {
    id: "opt-whatsapp-gateway",
    name: "Gateway Notifikasi WhatsApp",
    category: "notifikasi",
    description:
      "Pengiriman otomatis tiket alert gangguan jaringan ke grup teknisi NOC atau nomor teknisi lapangan.",
    targetDeviceOrService: "WhatsApp API Gateway / Bot Service",
    envKey: "WHATSAPP_API_KEY",
    status: "belum-dikonfigurasi",
    mode: "simulator",
    routeUrl: "/app/alert/whatsapp",
    routeLabel: "Setup WhatsApp",
    benefit: "Eskalasi insiden otomatis dalam 5 detik saat terjadi link down.",
    requiredVars: ["WHATSAPP_API_KEY", "WHATSAPP_API_URL"],
  },
  {
    id: "opt-billing-sync",
    name: "Sinkronisasi Sistem Billing",
    category: "billing",
    description:
      "Rekonsiliasi berkala akun PPPoE dengan status pembayaran pelanggan (Lunas vs Isolir).",
    targetDeviceOrService: "Scraper HTML / REST API Billing ISP",
    envKey: "BILLING_URL",
    status: "belum-dikonfigurasi",
    mode: "simulator",
    routeUrl: "/app/billing",
    routeLabel: "Status Billing",
    benefit: "Mencegah pelanggan nunggak tetap menikmati internet aktif.",
    requiredVars: ["BILLING_URL", "BILLING_USERNAME", "BILLING_PASSWORD"],
  },
];

/**
 * Mengevaluasi status konfigurasi modul opsional berdasarkan environment atau mock state.
 */
export function evaluateOptionalIntegrations(
  envSource: Record<string, string | undefined> = process.env,
  customStates: Record<string, OptionalIntegrationStatus> = {},
): OptionalIntegrationsOverview {
  const items = OPTIONAL_INTEGRATION_TEMPLATES.map((tpl) => {
    // 1. Periksa apakah ada override custom state
    if (customStates[tpl.id]) {
      return {
        ...tpl,
        status: customStates[tpl.id],
      };
    }

    // 2. Evaluasi kelengkapan variabel env yang dibutuhkan
    const allVarsFilled = tpl.requiredVars.every(
      (v) => envSource[v] && envSource[v]?.trim().length > 0,
    );

    const isSim =
      envSource[`${tpl.envKey}_MODE`]?.toLowerCase() === "simulator" ||
      envSource.DEVICE_MODE?.toLowerCase() === "simulator";

    const status: OptionalIntegrationStatus = allVarsFilled
      ? "terkonfigurasi"
      : "belum-dikonfigurasi";

    return {
      ...tpl,
      status,
      mode: isSim ? ("simulator" as const) : ("real" as const),
    };
  });

  const configuredCount = items.filter((i) => i.status === "terkonfigurasi").length;
  const unconfiguredCount = items.length - configuredCount;
  const completionPercentage =
    items.length === 0 ? 0 : Math.round((configuredCount / items.length) * 100);

  return {
    total: items.length,
    configuredCount,
    unconfiguredCount,
    completionPercentage,
    items,
  };
}
