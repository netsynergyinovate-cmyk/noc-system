// Status hidup/mati ONU: satu sumber label, warna dan penjelasan untuk semua tampilan.

export type OnuStatus = "online" | "offline" | "los";

export interface OnuStatusMeta {
  label: string;
  variant: "success" | "warning" | "destructive";
  dotClass: string;
  badgeClass: string;
  description: string;
}

const META: Readonly<Record<OnuStatus, OnuStatusMeta>> = {
  online: {
    label: "Online",
    variant: "success",
    dotClass: "bg-success",
    badgeClass: "border-success/40 bg-success/10 text-success",
    description: "ONU hidup dan terhubung ke OLT.",
  },
  offline: {
    label: "Mati / Power Off",
    variant: "warning",
    dotClass: "bg-warning",
    badgeClass: "border-warning/40 bg-warning/10 text-warning",
    description: "ONU tidak merespons; kemungkinan listrik pelanggan mati atau perangkat dimatikan.",
  },
  los: {
    label: "Kabel Putus (LOS)",
    variant: "destructive",
    dotClass: "bg-destructive",
    badgeClass: "border-destructive/40 bg-destructive/10 text-destructive",
    description: "Sinyal optik hilang (LOS); periksa kabel fiber atau konektor.",
  },
};

const UNKNOWN: OnuStatusMeta = {
  label: "Tidak diketahui",
  variant: "warning",
  dotClass: "bg-muted-foreground",
  badgeClass: "border-border bg-muted text-muted-foreground",
  description: "Status ONU belum dikenali.",
};

// Object.hasOwn: nama seperti "constructor" tidak boleh lolos sebagai status.
export function getOnuStatusMeta(status: OnuStatus | string): OnuStatusMeta {
  return Object.hasOwn(META, status) ? META[status as OnuStatus] : UNKNOWN;
}

// Zona waktu tetap supaya HTML server dan browser sama.
const lastSeenFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
});

export function formatLastSeen(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds)) return "-";
  const d = new Date(epochSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "-";
  return `${lastSeenFormat.format(d)} WIB`;
}
