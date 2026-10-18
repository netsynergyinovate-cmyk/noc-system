import type { Metadata } from "next";
import { AuditBoard } from "@/components/dashboard/audit-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { AUDIT_WINDOW_DAYS } from "@/lib/dashboard/audit";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Jejak Aktivitas" };

export default async function AuditPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Jejak Aktivitas
          </h1>
          <MockDataNotice source="log audit di backend" real />
        </div>
        <p className="text-sm text-muted-foreground">
          Catatan siapa mengubah apa dan kapan dalam {AUDIT_WINDOW_DAYS} hari
          terakhir.
        </p>
      </div>
      <AuditBoard />
    </div>
  );
}
