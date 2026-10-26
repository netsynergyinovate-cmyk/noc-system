"use client";

import Link from "next/link";
import { Lock, ArrowRight, ShieldAlert, Sparkles } from "lucide-react";

export interface ConfigurationGateBannerProps {
  reason?: string;
  onboardingUrl?: string;
}

export function ConfigurationGateBanner({
  reason = "Fungsi utama dasbor, alert, dan analisis ditahan hingga Router MikroTik wajib lulus uji koneksi.",
  onboardingUrl = "/setup",
}: ConfigurationGateBannerProps) {
  return (
    <aside
      data-testid="config-gate-banner"
      aria-label="Gerbang Konfigurasi Wajib"
      className="flex flex-col justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/90 p-4 shadow-xs dark:border-amber-900/60 dark:bg-amber-950/40 sm:flex-row sm:items-center"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white dark:bg-amber-600">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Gerbang Konfigurasi Wajib Aktif (Fungsi Utama Ditahan)
            </h4>
            <span className="rounded-full bg-amber-200/80 px-2 py-0.2 text-[10px] font-bold text-amber-900 uppercase dark:bg-amber-900 dark:text-amber-300">
              Wajib
            </span>
          </div>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300/90">
            {reason}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
        <Link
          href={onboardingUrl}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
        >
          <span>Selesaikan Langkah Wajib</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </aside>
  );
}
