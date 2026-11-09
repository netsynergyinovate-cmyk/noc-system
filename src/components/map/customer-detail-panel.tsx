"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Crosshair,
  HardDrive,
  Loader2,
  MapPin,
  Move,
  Navigation,
  Receipt,
  RotateCcw,
  Save,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { NetworkCustomerPoint } from "@/services/network-map.service";

export interface CustomerDetailPanelProps {
  customer: NetworkCustomerPoint;
  onClose: () => void;
  onFocus?: (lat: number, lng: number) => void;
  className?: string;
  "data-testid"?: string;

  // Mode Geser & Simpan Posisi Titik
  isEditingLocation?: boolean;
  onToggleEditLocation?: () => void;
  draftCoordinates?: { lat: number; lng: number } | null;
  onSaveLocation?: () => Promise<void> | void;
  onCancelEditLocation?: () => void;
  isSavingLocation?: boolean;
  saveSuccessMessage?: string | null;
  saveErrorMessage?: string | null;

  // Hapus Titik dari Peta
  onDelete?: () => Promise<void> | void;
  isDeleting?: boolean;
}

export function CustomerDetailPanel({
  customer,
  onClose,
  onFocus,
  className,
  isEditingLocation = false,
  onToggleEditLocation,
  draftCoordinates,
  onSaveLocation,
  onCancelEditLocation,
  isSavingLocation = false,
  saveSuccessMessage,
  saveErrorMessage,
  onDelete,
  isDeleting = false,
}: CustomerDetailPanelProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const hasCoords =
    customer.latitude !== null &&
    customer.longitude !== null &&
    Number.isFinite(customer.latitude) &&
    Number.isFinite(customer.longitude);

  const isCriticalOptic =
    customer.opticalPower !== null && customer.opticalPower <= -24.5;
  const isWarningOptic =
    customer.opticalPower !== null &&
    customer.opticalPower > -24.5 &&
    customer.opticalPower <= -23.0;

  const handleCopyCoordinates = () => {
    if (!hasCoords || customer.latitude === null || customer.longitude === null)
      return;
    const text = `${customer.latitude.toFixed(6)}, ${customer.longitude.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const gmapsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${customer.latitude},${customer.longitude}`
    : null;

  return (
    <Card
      className={cn(
        "absolute bottom-4 right-4 z-[1000] w-80 sm:w-88 md:w-96 max-w-[calc(100vw-2rem)]",
        "shadow-2xl border-border/80 bg-card/95 backdrop-blur-md rounded-xl overflow-hidden",
        "animate-in fade-in slide-in-from-bottom-2 duration-200",
        className,
      )}
      data-testid="customer-detail-panel"
    >
      <CardContent className="p-4 space-y-3.5 max-h-[calc(100vh-180px)] overflow-y-auto">
        {/* Header: Status badges, Nama, Username, dan Tombol Tutup */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={customer.isOnline ? "default" : "destructive"}
                className={cn(
                  "text-[11px] sm:text-[10px] px-2 py-0.5 h-5.5 sm:h-5 font-semibold gap-1",
                  customer.isOnline
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                    : "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20",
                )}
                data-testid="customer-status-badge"
              >
                {customer.isOnline ? (
                  <>
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="size-3" />
                    <span>Offline</span>
                  </>
                )}
              </Badge>

              <Badge
                variant="outline"
                className={cn(
                  "text-[11px] sm:text-[10px] px-2 py-0.5 h-5.5 sm:h-5 font-medium uppercase",
                  customer.billingStatus === "lunas"
                    ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                    : "text-rose-600 dark:text-rose-400 border-rose-500/30 bg-rose-500/5",
                )}
                data-testid="customer-billing-badge"
              >
                {customer.billingStatus === "lunas" ? "Lunas" : "Isolir"}
              </Badge>

              {customer.opticalPower !== null && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[11px] sm:text-[10px] px-1.5 py-0.5 h-5.5 sm:h-5 font-medium",
                    isCriticalOptic
                      ? "text-destructive border-destructive/40 bg-destructive/10"
                      : isWarningOptic
                        ? "text-amber-500 border-amber-500/40 bg-amber-500/10"
                        : "text-muted-foreground border-border",
                  )}
                  data-testid="customer-optic-status-badge"
                >
                  {isCriticalOptic
                    ? "Optik Kritis"
                    : isWarningOptic
                      ? "Optik Waspada"
                      : "Optik Normal"}
                </Badge>
              )}
            </div>

            <h3
              className="font-bold text-sm sm:text-base text-foreground leading-tight truncate mt-1"
              data-testid="customer-name"
              title={customer.name}
            >
              {customer.name}
            </h3>
            <p
              className="font-mono text-xs text-muted-foreground truncate"
              data-testid="customer-pppoe"
            >
              {customer.pppoeUsername}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-muted p-2 sm:p-1.5 rounded-md transition-colors shrink-0 size-8 sm:size-7 flex items-center justify-center"
            data-testid="close-customer-panel"
            aria-label="Tutup panel detail"
            title="Tutup panel detail"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Notifikasi Sukses / Galat Penyimpanan Lokasi */}
        {saveSuccessMessage && (
          <div
            className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs animate-in fade-in duration-150"
            data-testid="location-save-success"
          >
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="font-medium leading-tight">
              {saveSuccessMessage}
            </span>
          </div>
        )}

        {saveErrorMessage && (
          <div
            className="flex items-center gap-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs animate-in fade-in duration-150"
            data-testid="location-save-error"
          >
            <AlertTriangle className="size-4 shrink-0" />
            <span className="font-medium leading-tight">
              {saveErrorMessage}
            </span>
          </div>
        )}

        {/* Mode Geser & Simpan Posisi Titik Pelanggan */}
        {isEditingLocation && (
          <div
            className="bg-primary/5 dark:bg-primary/10 border border-primary/30 p-2.5 rounded-lg space-y-2 animate-in fade-in duration-150"
            data-testid="edit-location-mode-container"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-primary flex items-center gap-1.5">
                <Move className="size-3.5 animate-pulse" />
                <span>Mode Geser Posisi Aktif</span>
              </span>
              <Badge
                variant="outline"
                className="text-[9px] px-1 py-0 border-primary/40 text-primary"
              >
                Seret Pin
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Tarik penanda pin di peta atau klik lokasi baru pada peta untuk
              menentukan koordinat pelanggan ini.
            </p>

            <div className="bg-background/80 px-2 py-1.5 rounded border border-border/80 flex items-center justify-between text-xs">
              <span className="text-muted-foreground text-[10px] font-medium uppercase">
                Koordinat Baru:
              </span>
              <span
                className="font-mono text-[11px] font-semibold text-primary"
                data-testid="draft-coordinates-display"
              >
                {draftCoordinates
                  ? `${draftCoordinates.lat.toFixed(6)}, ${draftCoordinates.lng.toFixed(6)}`
                  : "Menunggu pemilihan..."}
              </span>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                variant="default"
                size="sm"
                className="w-1/2 text-xs h-9 sm:h-8 gap-1.5 font-semibold"
                data-testid="save-location-button"
                onClick={onSaveLocation}
                disabled={isSavingLocation || !draftCoordinates}
                title="Simpan koordinat baru ke database PostgreSQL"
              >
                {isSavingLocation ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Save className="size-3.5" />
                    <span>Simpan Posisi</span>
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-1/2 text-xs h-9 sm:h-8 gap-1.5 font-medium"
                data-testid="cancel-location-button"
                onClick={onCancelEditLocation || onToggleEditLocation}
                disabled={isSavingLocation}
                title="Batal menggeser posisi titik"
              >
                <RotateCcw className="size-3.5 text-muted-foreground" />
                <span>Batal</span>
              </Button>
            </div>
          </div>
        )}

        {/* Alamat (Jika ada) */}
        {customer.address && (
          <div
            className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-1.5 rounded-md"
            data-testid="customer-address"
          >
            <MapPin className="size-3.5 text-primary shrink-0 mt-0.5" />
            <span className="line-clamp-2 leading-relaxed">
              {customer.address}
            </span>
          </div>
        )}

        {/* Grid Informasi Metrik & Distribusi Jaringan */}
        <div className="grid grid-cols-2 gap-2 text-xs border-y border-border/80 py-2.5">
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
              Redaman Optik
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "font-bold tabular-nums text-sm",
                  isCriticalOptic
                    ? "text-destructive"
                    : isWarningOptic
                      ? "text-amber-500"
                      : "text-foreground",
                )}
                data-testid="customer-optical-power"
              >
                {customer.opticalPower !== null
                  ? `${customer.opticalPower} dBm`
                  : "—"}
              </span>
              {isCriticalOptic && (
                <AlertTriangle className="size-3.5 text-destructive shrink-0 animate-bounce" />
              )}
            </div>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
              ODP Distribusi
            </span>
            <span
              className="font-semibold text-foreground truncate block"
              data-testid="customer-odp"
              title={customer.odpName || "Belum Dipetakan"}
            >
              {customer.odpName || "Belum Dipetakan"}
            </span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
              Router Gateway
            </span>
            <span
              className="font-semibold text-foreground truncate block"
              data-testid="customer-router"
              title={customer.routerName || "Core CIARA"}
            >
              {customer.routerName || "Core CIARA"}
            </span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
              Koordinat Fisik
            </span>
            <span
              className="font-mono text-[11px] text-foreground truncate block"
              data-testid="customer-coordinates"
            >
              {hasCoords &&
              customer.latitude !== null &&
              customer.longitude !== null
                ? `${customer.latitude.toFixed(4)}, ${customer.longitude.toFixed(4)}`
                : "Belum Ada"}
            </span>
          </div>
        </div>

        {/* Informasi Hardware ONU / ONT */}
        {customer.onuDetails && (
          <div
            className="text-[11px] bg-muted/40 p-2.5 rounded-lg border border-border/60 space-y-1"
            data-testid="customer-onu-section"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                <HardDrive className="size-3 text-primary" />
                <span>Perangkat ONT (ONU)</span>
              </span>
              {customer.onuDetails.opticalLevel !== null && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  Rx: {customer.onuDetails.opticalLevel} dBm
                </span>
              )}
            </div>
            <p
              className="font-mono text-foreground font-medium"
              data-testid="customer-onu-sn"
            >
              SN: {customer.onuDetails.serialNumber || "—"}
            </p>
            <p
              className="text-muted-foreground text-[10px]"
              data-testid="customer-onu-port"
            >
              PON Port: {customer.onuDetails.ponIndex ?? "—"} • Index ONU:{" "}
              {customer.onuDetails.onuIndex ?? "—"}
            </p>
          </div>
        )}

        {/* Kontrol Navigasi, Peta & Geser Posisi */}
        <div className="space-y-2 pt-0.5">
          {/* Baris Tombol Geser Posisi Titik */}
          {onToggleEditLocation && (
            <Button
              type="button"
              variant={isEditingLocation ? "secondary" : "default"}
              size="sm"
              className={cn(
                "w-full text-xs h-8 gap-1.5 font-semibold transition-all",
                isEditingLocation
                  ? "border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                  : "bg-primary text-primary-foreground shadow-xs",
              )}
              data-testid="edit-location-button"
              onClick={onToggleEditLocation}
              title={
                hasCoords
                  ? "Aktifkan mode geser titik pelanggan di peta"
                  : "Tetapkan titik koordinat pelanggan ini di peta"
              }
            >
              <Move className="size-3.5" />
              <span>
                {isEditingLocation
                  ? "Tutup Mode Geser"
                  : hasCoords
                    ? "Geser / Ubah Posisi Titik"
                    : "Tetapkan Titik di Peta"}
              </span>
            </Button>
          )}

          <div className="flex items-center gap-2">
            {hasCoords &&
              onFocus &&
              customer.latitude !== null &&
              customer.longitude !== null && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-1/2 text-xs h-7.5 gap-1.5 font-medium"
                  data-testid="focus-customer-button"
                  onClick={() =>
                    onFocus(customer.latitude!, customer.longitude!)
                  }
                  title="Pusatkan kamera peta ke titik koordinat pelanggan ini"
                >
                  <Crosshair className="size-3.5 text-primary" />
                  <span>Pusatkan</span>
                </Button>
              )}

            {hasCoords &&
              customer.latitude !== null &&
              customer.longitude !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs h-9 sm:h-8 gap-1.5 font-medium",
                    onFocus ? "w-1/2" : "w-full",
                  )}
                  data-testid="copy-coordinates-button"
                  onClick={handleCopyCoordinates}
                  title="Salin koordinat GPS ke clipboard"
                >
                  {isCopied ? (
                    <>
                      <Check className="size-3.5 text-emerald-500" />
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Tersalin!
                      </span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5 text-muted-foreground" />
                      <span>Salin GPS</span>
                    </>
                  )}
                </Button>
              )}
          </div>

          {gmapsUrl && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full text-xs h-9 sm:h-8 gap-1.5 border-primary/20 hover:border-primary/40 text-muted-foreground hover:text-foreground font-medium"
              data-testid="open-gmaps-button"
            >
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Buka rute navigasi Google Maps ke titik pelanggan"
              >
                <Navigation className="size-3.5 text-blue-500" />
                <span>Buka Rute Navigasi Google Maps</span>
              </a>
            </Button>
          )}
        </div>

        {/* Hapus Titik Pelanggan dari Peta */}
        {hasCoords && onDelete && !isEditingLocation && (
          <div className="pt-1 border-t border-border/60">
            {!showDeleteConfirm ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs h-8 gap-1.5 border-rose-500/20 hover:border-rose-500/40 text-rose-600 dark:text-rose-400 font-medium hover:bg-rose-500/10"
                data-testid="delete-customer-location-button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={isDeleting}
              >
                <Trash2 className="size-3.5 text-rose-500" />
                <span>Hapus Titik dari Peta</span>
              </Button>
            ) : (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg space-y-2 animate-in fade-in">
                <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold text-xs">
                  <AlertTriangle className="size-4" />
                  <span>Hapus titik {customer.name}?</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Koordinat GPS pelanggan ini akan dihapus dari peta. Data
                  pelanggan tidak ikut terhapus.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-1/2 text-xs h-8 font-medium"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="w-1/2 text-xs h-8 font-medium gap-1.5"
                    data-testid="confirm-delete-customer-location-button"
                    onClick={() => {
                      onDelete?.();
                      setShowDeleteConfirm(false);
                    }}
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    <span>Ya, Hapus</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pintasan Terpadu: Pelanggan, CPE, dan Billing */}
        <div
          className="space-y-1.5 pt-2 border-t border-border/80"
          data-testid="customer-shortcuts-container"
        >
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Pintasan Operasional
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {/* Pintasan Pelanggan */}
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-9 sm:h-8 px-2 sm:px-1.5 text-xs sm:text-[11px] gap-1 font-medium bg-background hover:bg-muted"
              data-testid="shortcut-customer-link"
            >
              <Link
                href={`/app/pelanggan?search=${encodeURIComponent(customer.pppoeUsername)}`}
                title="Buka data dan riwayat profil pelanggan"
                data-testid="view-customer-link"
              >
                <Users className="size-3 text-primary shrink-0" />
                <span className="truncate">Pelanggan</span>
              </Link>
            </Button>

            {/* Pintasan CPE */}
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-9 sm:h-8 px-2 sm:px-1.5 text-xs sm:text-[11px] gap-1 font-medium bg-background hover:bg-muted"
              data-testid="shortcut-cpe-link"
            >
              <Link
                href={`/app/cpe?search=${encodeURIComponent(customer.onuDetails?.serialNumber || customer.pppoeUsername)}`}
                title="Buka manajemen modem CPE dan optik ONT"
              >
                <HardDrive className="size-3 text-blue-500 shrink-0" />
                <span className="truncate">CPE / ONT</span>
              </Link>
            </Button>

            {/* Pintasan Billing */}
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-9 sm:h-8 px-2 sm:px-1.5 text-xs sm:text-[11px] gap-1 font-medium bg-background hover:bg-muted"
              data-testid="shortcut-billing-link"
            >
              <Link
                href={`/app/billing?search=${encodeURIComponent(customer.pppoeUsername)}`}
                title="Buka status tagihan dan riwayat invoice"
              >
                <Receipt className="size-3 text-emerald-500 shrink-0" />
                <span className="truncate">Billing</span>
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
