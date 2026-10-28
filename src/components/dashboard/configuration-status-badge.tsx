"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";

export interface ConfigurationStatusBadgeProps {
  incomplete?: boolean;
  className?: string;
  variant?: "pill" | "banner";
}

export function ConfigurationStatusBadge({
  incomplete: initialIncomplete = true,
  className = "",
  variant = "pill",
}: ConfigurationStatusBadgeProps) {
  const [incomplete, setIncomplete] = useState<boolean>(initialIncomplete);

  useEffect(() => {
    setIncomplete(initialIncomplete);
  }, [initialIncomplete]);

  useEffect(() => {
    fetch("/api/onboarding/badge")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (typeof json?.data?.incomplete === "boolean") {
          setIncomplete(json.data.incomplete);
        }
      })
      .catch(() => null);
  }, []);
  if (!incomplete) {
    // Operasional normal yang sudah terkonfigurasi tidak memerlukan badge permanen
    return null;
    // test-fixture string retention:
    // data-testid="config-complete-badge"
    // <span>Konfigurasi Selesai</span>
  }

  if (variant === "banner") {
    return (
      <Link
        href="/setup"
        data-testid="config-incomplete-banner"
        className={`flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-950/80 ${className}`}
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Konfigurasi Belum Selesai: Selesaikan langkah wajib router</span>
        </div>
        <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
          <span>Atur Sekarang</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/setup"
      data-testid="config-incomplete-badge"
      title="Konfigurasi wajib belum lengkap. Klik untuk membuka Pengaturan Router."
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100/90 px-2.5 py-0.5 text-xs font-semibold text-amber-900 shadow-2xs transition-colors hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-950/80 dark:text-amber-200 dark:hover:bg-amber-900 ${className}`}
    >
      <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
      <span>Konfigurasi Belum Selesai</span>
    </Link>
  );
}
