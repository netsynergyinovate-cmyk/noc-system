import { billingStatusLabels } from "./billing";
import type { BillingStatus } from "./types";

// Penanda status pembayaran (badge Lunas, Isolir, dan netral). Murni, supaya
// artinya bisa diuji tanpa layar: komponennya hanya menggambar apa yang
// dikatakan model ini. Tiap keadaan dibedakan oleh tulisan DAN bentuk ikon, jadi
// warna hanyalah pelengkap.
//
//   lunas    tagihan sudah dibayar.
//   isolir   layanan dibatasi karena tagihan belum dibayar.
//   unknown  netral: status belum diketahui (belum ada nilainya, atau bukan salah
//            satu dari dua di atas), misalnya sebelum sinkron billing pertama
//            berhasil. Sengaja tidak berwarna hijau atau merah, karena belum
//            ada yang bisa dibenarkan atau dipersalahkan.

export type BillingBadgeState = BillingStatus | "unknown";
export type BillingBadgeTone = "success" | "danger" | "neutral";
export type BillingBadgeIcon = "check" | "ban" | "help";

// Tidak bisa diubah: model yang sama dibagikan ke semua pemanggil.
export interface BillingBadgeModel {
  readonly state: BillingBadgeState;
  readonly tone: BillingBadgeTone;
  readonly icon: BillingBadgeIcon;
  // Tulisan di badge.
  readonly label: string;
  // Arti penanda dalam satu kalimat, untuk legenda dan keterangan.
  readonly hint: string;
}

export const unknownBillingLabel = "Belum ada data";

const models: Readonly<Record<BillingBadgeState, BillingBadgeModel>> =
  Object.freeze({
    lunas: Object.freeze({
      state: "lunas",
      tone: "success",
      icon: "check",
      label: billingStatusLabels.lunas,
      hint: "Tagihan sudah dibayar.",
    } as const),
    isolir: Object.freeze({
      state: "isolir",
      tone: "danger",
      icon: "ban",
      label: billingStatusLabels.isolir,
      hint: "Layanan dibatasi karena tagihan belum dibayar.",
    } as const),
    unknown: Object.freeze({
      state: "unknown",
      tone: "neutral",
      icon: "help",
      label: unknownBillingLabel,
      hint: "Status pembayaran belum diketahui, misalnya sebelum sinkron billing pertama berhasil.",
    } as const),
  });

// Urutan penanda di legenda.
export const billingBadgeLegend: readonly (BillingStatus | null)[] = [
  "lunas",
  "isolir",
  null,
];

// Nilai selain lunas dan isolir (kosong, atau teks yang tidak dikenal dari
// backend yang lebih baru) menjadi netral, bukan salah satu dari keduanya dan
// bukan galat: halaman tetap tergambar dan jujur bahwa statusnya tidak diketahui.
export function billingBadge(
  status: BillingStatus | null | undefined,
): BillingBadgeModel {
  return status === "lunas" || status === "isolir"
    ? models[status]
    : models.unknown;
}
