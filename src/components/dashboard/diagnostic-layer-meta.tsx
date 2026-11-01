import {
  Activity,
  Cable,
  Globe,
  Radar,
  Receipt,
  Router,
  ScrollText,
  ShieldHalf,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { DiagnosticLayer } from "@/lib/diagnostics";

// Satu ikon per lapisan diagnosa, dipakai di hasil diagnosa, kesimpulan, dan
// riwayat supaya lapisan yang sama selalu terlihat sama. Ikon sengaja berbeda
// dari ikon jenis anomali (queue/cpu/port/optical/offline) di anomaly-kind-visual.
export const layerIcons: Record<DiagnosticLayer, LucideIcon> = {
  hulu: Globe,
  mikrotik: Router,
  log: ScrollText,
  firewall: ShieldHalf,
  optik: Cable,
  ont: Wifi,
  trafik: Activity,
  aktif: Radar,
  billing: Receipt,
};
