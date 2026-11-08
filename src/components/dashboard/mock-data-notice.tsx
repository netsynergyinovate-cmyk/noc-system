"use client";

import { FlaskConical } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";

// Pengingat status sumber data. Mode live TIDAK otomatis berarti halaman ini
// memakai data nyata: halaman yang belum terhubung menampilkan peringatan jujur.
export function MockDataNotice({
  source = "router atau OLT",
  real = false,
}: {
  source?: string;
  real?: boolean;
}) {
  const isDemo = useSession(selectPreviewEnabled);
  if (!isDemo && !real) {
    return (
      <p
        data-testid="live-mock-notice"
        className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
      >
        <FlaskConical className="size-3.5" aria-hidden="true" />
        Halaman ini masih data tiruan: belum terhubung ke {source}
      </p>
    );
  }
  if (!isDemo) {
    return null;
  }

  return (
    <p className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
      <FlaskConical className="size-3.5" aria-hidden="true" />
      Data tiruan, belum terhubung ke {source}
    </p>
  );
}
