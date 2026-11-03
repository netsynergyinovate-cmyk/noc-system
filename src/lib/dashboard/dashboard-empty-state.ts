// Murni: memutuskan layar kosong mana yang dipakai dashboard, dan kapan data basi.

export type DashboardEmptyReason =
  | "no_router_connected"
  | "no_customers_found"
  | "filtered_empty"
  | "connection_lost";

export interface DashboardEmptyStateConfig {
  reason: DashboardEmptyReason;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  isActionExternal?: boolean;
  guidanceTips: string[];
}

export function resolveDashboardEmptyState(params: {
  customerCount: number;
  routerCount: number;
  visibleCount: number;
  isConnected: boolean;
  hasActiveFilter: boolean;
}): DashboardEmptyStateConfig | null {
  if (!params.isConnected) {
    return {
      reason: "connection_lost",
      title: "Koneksi stream terputus",
      description:
        "Dashboard tidak menerima pembaruan. Data yang tampil bisa sudah usang.",
      actionLabel: "Sambungkan Ulang",
      guidanceTips: [
        "Periksa koneksi internet atau jaringan ke server NOC.",
        "Pastikan layanan backend NOC berjalan.",
      ],
    };
  }
  if (params.routerCount === 0) {
    return {
      reason: "no_router_connected",
      title: "Belum ada router terhubung",
      description:
        "Tambahkan minimal satu router MikroTik agar data pelanggan bisa dibaca.",
      actionLabel: "Buka Setup Perangkat",
      actionHref: "/setup",
      isActionExternal: false,
      guidanceTips: [
        "Aktifkan layanan API/REST pada router MikroTik.",
        "Buat akun router dengan hak baca untuk NOC.",
        "Pastikan alamat IP router terjangkau dari server NOC.",
      ],
    };
  }
  if (params.customerCount === 0) {
    return {
      reason: "no_customers_found",
      title: "Belum ada pelanggan PPPoE terdeteksi",
      description:
        "Router sudah terhubung, tetapi belum ada pelanggan PPPoE yang terbaca.",
      actionLabel: "Buka Setup Perangkat",
      actionHref: "/setup",
      isActionExternal: false,
      guidanceTips: [
        "Pastikan secret PPPoE aktif di router.",
        "Pastikan router tetap terhubung dan sinkron berhasil.",
      ],
    };
  }
  if (params.visibleCount === 0 && params.hasActiveFilter) {
    return {
      reason: "filtered_empty",
      title: "Tidak ada pelanggan yang cocok dengan filter",
      description: "Tidak ada hasil untuk kombinasi pencarian dan filter ini.",
      actionLabel: "Reset filter",
      guidanceTips: [
        "Periksa ejaan kata kunci pencarian.",
        "Longgarkan filter status atau router.",
      ],
    };
  }
  return null;
}
