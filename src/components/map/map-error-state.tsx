"use client";

import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface MapErrorStateProps {
  errorMessage: string | null;
  onRetry: () => void | Promise<void>;
  isLoading?: boolean;
  variant?: "banner" | "overlay" | "card";
  className?: string;
}

export function MapErrorState({
  errorMessage,
  onRetry,
  isLoading = false,
  variant = "banner",
  className = "",
}: MapErrorStateProps) {
  if (!errorMessage) return null;

  // Mode 1: Overlay / Fullscreen Error State (Kanvas peta gagal memuat data awal)
  if (variant === "overlay") {
    return (
      <div
        className={`absolute inset-0 z-[1050] flex flex-col items-center justify-center p-6 bg-background/90 backdrop-blur-sm text-center animate-in fade-in duration-200 ${className}`}
        data-testid="map-error-state"
        role="alert"
      >
        <div className="size-14 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive mb-3 shadow-inner">
          <WifiOff className="size-7" />
        </div>

        <h3 className="text-base font-bold text-foreground">
          Gagal Menghubungkan ke Backend Jaringan
        </h3>

        <p className="text-xs text-muted-foreground max-w-md mt-1 mb-2 leading-relaxed">
          {errorMessage}
        </p>

        <p className="text-[11px] text-muted-foreground/90 max-w-sm mb-4 italic">
          Sistem menolak menampilkan data tiruan palsu (*zero-dummy*) agar data operasional tidak tersamarkan.
        </p>

        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onRetry}
          disabled={isLoading}
          data-testid="map-error-retry-button"
          className="text-xs gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          <span>Coba Lagi</span>
        </Button>
      </div>
    );
  }

  // Mode 2: Banner Notifikasi Error (Di atas kanvas peta, tidak menutupi peta jika sudah ada data sebelumnya)
  return (
    <div
      role="alert"
      className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs shadow-xs animate-in fade-in duration-150 ${className}`}
      data-testid="map-error-state"
    >
      <div className="flex items-start sm:items-center gap-2 min-w-0">
        <AlertTriangle className="size-4 shrink-0 text-destructive mt-0.5 sm:mt-0" />
        <div className="min-w-0">
          <span className="font-semibold">Galat Penyegaran Peta: </span>
          <span>{errorMessage}.</span>{" "}
          <span className="opacity-80 italic hidden md:inline">
            Sistem menolak menampilkan data tiruan palsu (*zero-dummy*).
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isLoading}
          className="h-7 px-2.5 text-xs border-destructive/40 hover:bg-destructive/20 gap-1"
          data-testid="map-error-retry-button"
          title="Coba memuat ulang data telemetri peta dari backend"
        >
          <RefreshCw className={`size-3 ${isLoading ? "animate-spin" : ""}`} />
          <span>Coba Lagi</span>
        </Button>
      </div>
    </div>
  );
}
