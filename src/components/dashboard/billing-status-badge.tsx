import {
  Ban,
  CircleCheck,
  CircleQuestionMark,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import {
  billingBadge,
  type BillingBadgeIcon,
  type BillingBadgeTone,
} from "@/lib/dashboard/billing-badge";
import type { BillingStatus } from "@/lib/dashboard/types";

const icons: Record<BillingBadgeIcon, LucideIcon> = {
  check: CircleCheck,
  ban: Ban,
  help: CircleQuestionMark,
};

// Warna hanya pelengkap: tulisan dan bentuk ikonnya sudah membedakan ketiganya.
// Yang netral memakai latar abu-abu, bukan hijau atau merah.
const tones: Record<BillingBadgeTone, string> = {
  success: "bg-success/10 text-success",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-foreground",
};

// Untuk permukaan yang selalu terang apa pun temanya, seperti kotak tooltip
// Leaflet (putih juga di tema gelap). Warna token tema tidak boleh dipakai di
// sana: di tema gelap hijau dan merahnya diterangkan untuk latar gelap, dan di
// atas putih tidak terbaca. Warna palet Tailwind tidak ikut tema.
const lightTones: Record<BillingBadgeTone, string> = {
  success: "bg-green-800/10 text-green-800",
  danger: "bg-red-700/10 text-red-700",
  neutral: "bg-neutral-100 text-neutral-900",
};

// Penanda status pembayaran: Lunas, Isolir, atau netral ("Belum ada data") bila
// statusnya belum diketahui. Hanya menggambar; artinya ditentukan billingBadge,
// jadi bisa dipasang di tabel, peta, atau dialog dengan tampilan yang sama.
// `surface` "light" untuk permukaan yang selalu terang (tooltip peta); bawaannya
// "theme" mengikuti tema.
export function BillingStatusBadge({
  status,
  surface = "theme",
  className,
}: {
  status: BillingStatus | null | undefined;
  surface?: "theme" | "light";
  className?: string;
}) {
  const model = billingBadge(status);
  const Icon = icons[model.icon];
  return (
    <span
      data-testid="billing-badge"
      data-status={model.state}
      data-tone={model.tone}
      data-surface={surface}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        (surface === "light" ? lightTones : tones)[model.tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {model.label}
    </span>
  );
}
