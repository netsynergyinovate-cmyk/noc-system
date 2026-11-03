import type { Metadata } from "next";
import { AnomalyBoard } from "@/components/dashboard/anomaly-board";
import { AnomalyConclusion } from "@/components/dashboard/anomaly-conclusion";
import { DiagnosticPanel } from "@/components/dashboard/diagnostic-panel";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Deteksi Anomali" };

export default async function AnomalyPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-4">
      <AnomalyBoard
        conclusion={<AnomalyConclusion />}
        diagnostic={<DiagnosticPanel />}
      />
    </div>
  );
}
