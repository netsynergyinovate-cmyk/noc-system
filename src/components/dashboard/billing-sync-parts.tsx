"use client";

import {
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { formatAlertTime } from "@/lib/dashboard/alerts";
import type {
  BillingSyncStatus,
  BillingSyncTone,
} from "@/lib/dashboard/billing";
import { formatElapsed, isoDuration } from "@/lib/dashboard/format";
import { useNowSeconds } from "@/lib/dashboard/use-now";

// Bagian kecil yang dipakai bersama oleh kartu sinkron di halaman Billing dan
// ringkasan sinkron di halaman Pelanggan.

// Waktu sampai detik (dengan tanggal bila bukan hari ini), dalam zona waktu browser.
export function SyncTime({
  seconds,
  now,
  testId,
}: {
  seconds: number;
  now: number;
  testId?: string;
}) {
  return (
    <time
      dateTime={new Date(seconds * 1000).toISOString()}
      data-testid={testId}
      className="font-medium tabular-nums"
    >
      {formatAlertTime(seconds, now)}
    </time>
  );
}

// "12 menit 5 detik lalu". Hanya komponen ini yang digambar ulang tiap detik.
export function SyncAge({ at, testId }: { at: number; testId?: string }) {
  const now = useNowSeconds();
  const elapsed = Math.max(0, now - at);
  return (
    <time dateTime={isoDuration(elapsed)} data-testid={testId}>
      {formatElapsed(elapsed)} lalu
    </time>
  );
}

// "dalam 47 menit 55 detik"; setelah waktunya lewat dan sebelum data baru tiba,
// "sebentar lagi".
export function SyncCountdown({ at }: { at: number }) {
  const now = useNowSeconds();
  const remaining = at - now;
  if (remaining <= 0) {
    return (
      <span data-testid="billing-countdown" data-due="true">
        sebentar lagi
      </span>
    );
  }
  return (
    <time
      dateTime={isoDuration(remaining)}
      data-testid="billing-countdown"
      data-due="false"
    >
      dalam {formatElapsed(remaining)}
    </time>
  );
}

const tones: Record<BillingSyncTone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-foreground",
};

const icons = {
  running: LoaderCircle,
  none: Clock,
  ok: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
} satisfies Record<string, LucideIcon>;

// Satu kegagalan hanya peringatan (segitiga); beruntun berarti silang.
function iconKey(status: BillingSyncStatus): keyof typeof icons {
  if (status.phase === "failed") {
    return status.tone === "danger" ? "danger" : "warning";
  }
  return status.phase;
}

// Ikon keadaan sinkron di dalam kotak berwarna. Warna hanya pelengkap: bentuk
// ikon dan kalimat di sebelahnya sudah menyebut keadaannya. Pemutar berhenti
// bila pengguna meminta gerak dikurangi.
export function SyncStateIcon({
  status,
  size = "md",
}: {
  status: BillingSyncStatus;
  size?: "sm" | "md";
}) {
  const Icon = icons[iconKey(status)];
  const spinning = status.phase === "running";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "md" ? "size-10" : "size-7",
        tones[status.tone],
      )}
    >
      <Icon
        data-testid={spinning ? "billing-spinner" : undefined}
        className={cn(
          size === "md" ? "size-5" : "size-4",
          spinning && "animate-spin motion-reduce:animate-none",
        )}
        aria-hidden="true"
      />
    </span>
  );
}
