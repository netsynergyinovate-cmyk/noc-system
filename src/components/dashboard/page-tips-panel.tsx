"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  HelpCircle,
  ChevronDown,
  Activity,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
} from "lucide-react";
import { getPageTips, type PageTipItem } from "@/lib/dashboard/page-tips-data";

export interface PageTipsPanelProps {
  tips?: PageTipItem;
  defaultOpen?: boolean;
  className?: string;
}

export function PageTipsPanel({
  tips: customTips,
  defaultOpen = false,
  className = "",
}: PageTipsPanelProps) {
  const pathname = usePathname();
  const [activeTips, setActiveTips] = useState<PageTipItem | null>(() => {
    return customTips ?? getPageTips(pathname);
  });
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (customTips) {
      setActiveTips(customTips);
      return;
    }
    fetch(`/api/tutorial/content?page=${encodeURIComponent(pathname)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) {
          setActiveTips(json.data);
        }
      })
      .catch(() => null);
  }, [pathname, customTips]);

  const tips = activeTips ?? customTips ?? getPageTips(pathname);

  if (!tips) return null;

  return (
    <div
      data-testid="page-tips-panel"
      className={`rounded-xl border bg-card/80 text-card-foreground shadow-2xs transition-all ${className}`}
    >
      {/* Header Tombol Buka/Tutup */}
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Lightbulb className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="text-xs font-semibold text-foreground">
              Panduan Cepat & Tips Operasional: {tips.pageTitle}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {isOpen
                ? "Klik untuk menyembunyikan tips halaman ini"
                : "Klik untuk melihat penjelasan metrik & panduan masalah umum"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span>{isOpen ? "Tutup" : "Buka Tips"}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {/* Konten Terbuka */}
      {isOpen && (
        <div className="flex flex-col gap-4 border-t px-4 py-4 text-xs">
          {/* 1. Fungsi Halaman */}
          <div>
            <h4 className="flex items-center gap-1.5 font-semibold text-foreground">
              <HelpCircle className="h-3.5 w-3.5 text-primary" />
              <span>Fungsi & Peran Halaman:</span>
            </h4>
            <p className="mt-1 text-muted-foreground leading-relaxed">
              {tips.summary}
            </p>
          </div>

          {/* 2. Metrik yang Ditampilkan */}
          {tips.metrics.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 font-semibold text-foreground mb-2">
                <Activity className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                <span>Metrik & Data yang Disajikan:</span>
              </h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {tips.metrics.map((m) => (
                  <div
                    key={m.name}
                    className="flex flex-col gap-0.5 rounded-lg border bg-secondary/30 p-2.5"
                  >
                    <span className="font-semibold text-foreground">{m.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {m.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Solusi & Tindakan Masalah */}
          {tips.troubleshooting.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 font-semibold text-foreground mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>Solusi Masalah Umum & Tindakan Cepat:</span>
              </h4>
              <div className="flex flex-col gap-2">
                {tips.troubleshooting.map((t) => (
                  <div
                    key={t.issue}
                    className="flex flex-col gap-1 rounded-lg border border-amber-200/50 bg-amber-50/20 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/10"
                  >
                    <span className="font-semibold text-amber-900 dark:text-amber-200">
                      Kendala: {t.issue}
                    </span>
                    <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>{t.solution}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
