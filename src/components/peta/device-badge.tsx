import type { MapDevice } from "@/services/map/types";
import { CustomerIcon, DEVICE_TYPE_STYLE } from "./map-style";

const SIZES = {
  sm: { box: "w-5 h-5 rounded-md", icon: "w-3 h-3" },
  md: { box: "w-8 h-8 rounded-lg", icon: "w-4.5 h-4.5" },
} as const;

/** Lencana ikon perangkat/pelanggan, sama dengan penanda di peta */
export function DeviceBadge({
  type,
  size = "sm",
  color,
}: {
  type: MapDevice["type"] | "customer";
  size?: keyof typeof SIZES;
  /** Warna pelanggan (status layanan); perangkat memakai warna jenisnya */
  color?: string;
}) {
  const style =
    type === "customer"
      ? null
      : (DEVICE_TYPE_STYLE[type] ?? DEVICE_TYPE_STYLE.odp);
  const Icon = style?.Icon ?? CustomerIcon;
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={`${s.box} ${type === "customer" ? "rounded-full" : ""} shrink-0 inline-flex items-center justify-center text-white shadow-sm`}
      style={{ background: color ?? style?.color ?? "#94a3b8" }}
    >
      <Icon className={s.icon} strokeWidth={2.25} />
    </span>
  );
}
