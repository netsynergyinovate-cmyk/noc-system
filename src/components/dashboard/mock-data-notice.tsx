"use client";

import { FlaskConical, Radio } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";

// Pengingat status sumber data: data tiruan (demo) vs live (data nyata database).
export function MockDataNotice({
  source = "router atau OLT",
}: {
  source?: string;
}) {
  const isDemo = useSession(selectPreviewEnabled);
  if (!isDemo) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        <Radio className="size-3.5" aria-hidden="true" />
        Mode Live (Database PostgreSQL)
      </p>
    );
  }

  return (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
      <FlaskConical className="size-3.5" aria-hidden="true" />
      Data tiruan, belum terhubung ke {source}
    </p>
  );
}
