"use client";

import { formatElapsed, isoDuration } from "@/lib/dashboard/format";
import { useNowSeconds } from "@/lib/dashboard/use-now";

// Lama yang masih berjalan, bertambah tiap detik. Hanya komponen ini yang
// berlangganan jam bersama, jadi hanya ia yang digambar ulang tiap detik, bukan
// daftar atau tabel di sekitarnya.
export function RunningDuration({
  startedAt,
  testId = "anomaly-duration",
}: {
  startedAt: number;
  testId?: string;
}) {
  const now = useNowSeconds();
  const elapsed = Math.max(0, now - startedAt);
  return (
    <time dateTime={isoDuration(elapsed)} data-testid={testId}>
      sudah {formatElapsed(elapsed)}
    </time>
  );
}
