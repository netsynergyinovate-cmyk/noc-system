"use client";

import Link from "next/link";
import { MapPinOff, SearchX, Settings, Users, Router } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface MapEmptyStateProps {
  variant?: "global" | "search" | "card";
  title?: string;
  description?: string;
  totalDevices?: number;
  totalCustomers?: number;
  totalGeocoded?: number;
  searchQuery?: string;
  onResetSearch?: () => void;
  className?: string;
}

export function MapEmptyState({
  variant = "global",
  title,
  description,
  totalDevices = 0,
  totalCustomers = 0,
  totalGeocoded = 0,
  searchQuery,
  onResetSearch,
  className = "",
}: MapEmptyStateProps) {
  // Mode 1: Search Empty State (Filter pencarian tidak menemukan hasil)
  if (variant === "search") {
    return (
      <div
        className={`flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150 ${className}`}
        data-testid="search-empty-state"
      >
        <div className="size-10 rounded-full bg-muted/80 flex items-center justify-center text-muted-foreground mb-2">
          <SearchX className="size-5" />
        </div>
        <h4 className="text-xs font-semibold text-foreground">
          {title || "Tidak Ditemukan Titik yang Cocok"}
        </h4>
        <p className="text-[11px] text-muted-foreground max-w-xs mt-1 mb-3">
          {description ||
            (searchQuery
              ? `Tidak ada perangkat atau pelanggan dengan kata kunci "${searchQuery}".`
              : "Sesuaikan filter atau kata kunci pencarian Anda.")}
        </p>
        {onResetSearch && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onResetSearch}
            className="h-7 text-xs px-2.5"
            data-testid="reset-search-button"
          >
            Reset Pencarian
          </Button>
        )}
      </div>
    );
  }

  // Mode 2: Global Empty State (Database operasional belum memiliki titik jaringan/pelanggan)
  const defaultTitle =
    totalDevices === 0 && totalCustomers === 0
      ? "Belum Ada Perangkat atau Titik Terdaftar"
      : totalGeocoded === 0
        ? "Perangkat Tersedia Namun Belum Memiliki Koordinat Geografis"
        : "Belum Ada Titik Infrastruktur atau Pelanggan";

  const defaultDesc =
    totalDevices === 0 && totalCustomers === 0
      ? "Peta dasar satelit siap digunakan. Daftarkan router MikroTik atau OLT pada menu Setup agar topologi jaringan dan pelanggan dapat dipetakan secara nyata tanpa data dummy."
      : "Data tersimpan di database PostgreSQL, namun belum ada koordinat latitude dan longitude yang disematkan. Konfigurasikan koordinat pada pengaturan perangkat atau pelanggan.";

  return (
    <Card
      className={`border-dashed p-6 text-center bg-card/75 backdrop-blur-xs ${className}`}
      data-testid="map-empty-state"
    >
      <div
        className="flex flex-col items-center justify-center gap-2"
        data-testid="empty-map-state"
      >
        <div className="size-12 rounded-full bg-muted border flex items-center justify-center text-muted-foreground mb-1 shadow-xs">
          <MapPinOff className="size-6 text-muted-foreground/80" />
        </div>

        <h3 className="text-sm font-semibold text-foreground">
          {title || defaultTitle}
        </h3>

        <p className="text-xs text-muted-foreground max-w-lg leading-relaxed">
          {description || defaultDesc}
        </p>

        <p className="text-[11px] text-muted-foreground/80 italic max-w-md">
          Prinsip <strong>zero-dummy</strong>: Sistem menolak menghasilkan koordinat buatan secara diam-diam.
        </p>

        {/* Tautan Aksi Navigasi Cepat */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2.5">
          <Button asChild size="sm" variant="default" className="text-xs h-7.5 gap-1.5 shadow-xs">
            <Link href="/setup" title="Buka wizard penyiapan perangkat">
              <Settings className="size-3.5" />
              <span>Buka Setup Perangkat</span>
            </Link>
          </Button>

          <Button asChild size="sm" variant="outline" className="text-xs h-7.5 gap-1.5">
            <Link href="/app/router" title="Buka modul manajemen router">
              <Router className="size-3.5 text-primary" />
              <span>Kelola Router</span>
            </Link>
          </Button>

          <Button asChild size="sm" variant="outline" className="text-xs h-7.5 gap-1.5">
            <Link href="/app/pelanggan" title="Buka data pelanggan dan geocoding">
              <Users className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Buka Data Pelanggan</span>
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
