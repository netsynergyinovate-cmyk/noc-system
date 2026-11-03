import type { Metadata } from "next";
import { DiagnosticRunHistory } from "@/components/dashboard/diagnostic-run-history";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Riwayat Diagnosa" };

export default async function DiagnosticHistoryPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-4">
      <DiagnosticRunHistory />
    </div>
  );
}
