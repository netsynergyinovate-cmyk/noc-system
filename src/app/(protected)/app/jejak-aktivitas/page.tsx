import type { Metadata } from "next";
import { AuditBoard } from "@/components/dashboard/audit-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { AUDIT_WINDOW_DAYS } from "@/lib/dashboard/audit";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Jejak Aktivitas" };

export default async function AuditPage() {
  await requireSession();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Jejak Aktivitas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catatan siapa mengubah apa dan kapan dalam {AUDIT_WINDOW_DAYS} hari
            terakhir.
          </p>
        </div>
        <MockDataNotice source="log audit di backend" real />
      </div>
      <AuditBoard />
    </div>
  );
}
