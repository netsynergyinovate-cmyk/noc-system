import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Cpu,
  EthernetPort,
  Gauge,
  ServerOff,
  SignalLow,
  Unplug,
  WifiOff,
} from "lucide-react";
import type { IncidentVariantId } from "@/lib/dashboard/incident-variant";

// Warna dan ikon tiap jenis insiden. Kelas ditulis utuh (bukan disusun dari
// potongan) supaya Tailwind menemukannya. Tema ini hanya punya token primary,
// destructive, warning, success, dan muted, jadi jenis lain memakai palet bawaan
// Tailwind: gelap untuk mode terang (kontras teks kecil), terang untuk mode gelap.
export interface IncidentVariantStyle {
  Icon: LucideIcon;
  // Garis tepi kiri kartu.
  edge: string;
  // Teks nama jenis dan ikon.
  text: string;
}

export const incidentVariantStyle: Record<
  IncidentVariantId,
  IncidentVariantStyle
> = {
  los: {
    Icon: Unplug,
    edge: "border-l-destructive",
    text: "text-destructive",
  },
  router: {
    Icon: ServerOff,
    edge: "border-l-primary",
    text: "text-primary",
  },
  redaman: {
    Icon: SignalLow,
    edge: "border-l-warning",
    text: "text-warning",
  },
  // Rx tidak sampai ke halaman: tetap sinyal optik lemah, jadi tampilannya sama
  // dengan redaman, bukan tanda tanya "tidak diketahui".
  noread: {
    Icon: SignalLow,
    edge: "border-l-warning",
    text: "text-warning",
  },
  isolir: {
    Icon: Ban,
    edge: "border-l-violet-500",
    text: "text-violet-700 dark:text-violet-400",
  },
  offline: {
    Icon: WifiOff,
    edge: "border-l-sky-500",
    text: "text-sky-700 dark:text-sky-400",
  },
  queue: {
    Icon: Gauge,
    edge: "border-l-blue-500",
    text: "text-blue-700 dark:text-blue-400",
  },
  cpu: {
    Icon: Cpu,
    edge: "border-l-fuchsia-500",
    text: "text-fuchsia-700 dark:text-fuchsia-400",
  },
  port: {
    Icon: EthernetPort,
    edge: "border-l-teal-500",
    text: "text-teal-700 dark:text-teal-400",
  },
};
