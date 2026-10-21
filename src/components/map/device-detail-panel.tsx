"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  Check,
  Copy,
  Crosshair,
  HardDrive,
  Loader2,
  MapPin,
  Move,
  Navigation,
  Network,
  Router,
  Save,
  Server,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  NetworkCustomerPoint,
  NetworkInfrastructurePoint,
} from "@/services/network-map.service";

export interface DeviceDetailPanelProps {
  device: NetworkInfrastructurePoint;
  customers?: NetworkCustomerPoint[];
  onClose: () => void;
  onFocus?: (lat: number, lng: number) => void;
  onStartMove?: () => void;
  isMoving?: boolean;
  draftCoords?: { lat: number; lng: number } | null;
  onCancelMove?: () => void;
  onSaveMove?: () => void;
  isSavingMove?: boolean;
  onDelete?: () => void;
  isDeleting?: boolean;
  infraList?: { id: string; name: string; type: string }[];
  onSetParent?: (parentId: string | null) => Promise<void>;
  isSettingParent?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function DeviceDetailPanel({
  device,
  customers = [],
  onClose,
  onFocus,
  onStartMove,
  isMoving = false,
  draftCoords,
  onCancelMove,
  onSaveMove,
  isSavingMove = false,
  onDelete,
  isDeleting = false,
  infraList = [],
  onSetParent,
  isSettingParent = false,
  className,
}: DeviceDetailPanelProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showParentSelector, setShowParentSelector] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string>(device.parentId || "");

  const isRouter = device.type === "router";
  const isOlt = device.type === "olt";
  const isOdp = device.type === "odp";
  const isOdc = device.type === "odc";

  const typeColor = isRouter
    ? "#8b5cf6"
    : isOlt
      ? "#06b6d4"
      : isOdp
        ? "#f59e0b"
        : isOdc
          ? "#3b82f6"
          : "#64748b";

  const typeIcon = isRouter
    ? Router
    : isOlt
      ? Network
      : isOdp
        ? Boxes
        : isOdc
          ? Server
          : MapPin;

  const TypeIconComponent = typeIcon;

  // Pelanggan yang tersambung ke ODP ini (data nyata dari database PostgreSQL)
  const connectedCustomers = isOdp
    ? customers.filter(
        (c) => c.odpName && c.odpName.toLowerCase() === device.name.toLowerCase(),
      )
    : [];

  const onlineConnected = connectedCustomers.filter((c) => c.isOnline).length;
  const offlineConnected = connectedCustomers.length - onlineConnected;

  const handleCopyCoordinates = () => {
    if (!Number.isFinite(device.latitude) || !Number.isFinite(device.longitude)) return;
    const text = `${device.latitude.toFixed(6)}, ${device.longitude.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const gmapsUrl =
    Number.isFinite(device.latitude) && Number.isFinite(device.longitude)
      ? `https://www.google.com/maps/dir/?api=1&destination=${device.latitude},${device.longitude}`
      : null;

  return (
    <Card
      className={cn(
        "absolute bottom-4 right-4 z-[1000] w-80 sm:w-88 md:w-96 max-w-[calc(100vw-2rem)]",
        "shadow-2xl border-border/80 bg-card/95 backdrop-blur-md rounded-xl overflow-hidden",
        "animate-in fade-in slide-in-from-bottom-2 duration-150",
        className,
      )}
      data-testid="infra-detail-panel"
    >
      <CardContent className="p-4 space-y-3.5 max-h-[calc(100vh-180px)] overflow-y-auto">
        {/* Header: Badge Jenis, Nama Perangkat, Host, dan Tombol Tutup */}
        <div className="flex items-start justify-between gap-2.5">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className="text-[11px] sm:text-[10px] px-2 py-0.5 h-5.5 sm:h-5 font-semibold gap-1 uppercase"
                style={{
                  color: typeColor,
                  borderColor: `${typeColor}40`,
                  backgroundColor: `${typeColor}15`,
                }}
                data-testid="device-type-badge"
              >
                <TypeIconComponent className="size-3" />
                <span>{device.type}</span>
              </Badge>

              <Badge
                variant="outline"
                className={cn(
                  "text-[11px] sm:text-[10px] px-2 py-0.5 h-5.5 sm:h-5 font-semibold uppercase",
                  device.status === "active" || device.status === "aktif"
                    ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                    : "text-rose-600 dark:text-rose-400 border-rose-500/30 bg-rose-500/10",
                )}
                data-testid="device-status-badge"
              >
                {device.status === "active" || device.status === "aktif" ? (
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Aktif</span>
                  </span>
                ) : (
                  <span>Nonaktif</span>
                )}
              </Badge>
            </div>

            <h3
              className="font-bold text-sm sm:text-base text-foreground leading-tight truncate mt-1"
              data-testid="device-name"
              title={device.name}
            >
              {device.name}
            </h3>

            {device.host ? (
              <p className="font-mono text-xs text-muted-foreground truncate" data-testid="device-host">
                Host: {device.host}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">Infrastruktur Distribusi Fisik</p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground hover:bg-muted p-2 sm:p-1.5 rounded-md transition-colors shrink-0 size-8 sm:size-7 flex items-center justify-center"
            data-testid="close-infra-panel"
            aria-label="Tutup panel perangkat"
            title="Tutup panel perangkat"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Kontrol Mode Pindah Lokasi Perangkat */}
        {isMoving && (
          <div
            className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2 animate-in fade-in"
            data-testid="infra-move-controls"
          >
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold text-xs">
              <Move className="size-4 animate-bounce" />
              <span>Mode Pindah Lokasi Aktif</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Geser pin di peta atau klik lokasi baru untuk menentukan koordinat baru perangkat.
            </p>
            {draftCoords && (
              <div
                className="font-mono text-xs text-foreground bg-background/80 px-2 py-1 rounded border border-border/60"
                data-testid="infra-draft-coords"
              >
                📍 Koordinat Baru: {draftCoords.lat.toFixed(6)}, {draftCoords.lng.toFixed(6)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-1/2 text-xs h-9 sm:h-8 font-medium"
                data-testid="cancel-move-infra-button"
                onClick={onCancelMove}
                disabled={isSavingMove}
              >
                Batal
              </Button>
              <Button
                type="button"
                size="sm"
                className="w-1/2 text-xs h-9 sm:h-8 bg-amber-600 hover:bg-amber-700 text-white font-medium gap-1"
                data-testid="save-infra-location-button"
                onClick={onSaveMove}
                disabled={isSavingMove || !draftCoords}
              >
                {isSavingMove ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Save className="size-3.5" />
                    <span>Simpan Posisi</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Grid Informasi Metrik & Koordinat Perangkat */}
        <div className="grid grid-cols-2 gap-2 text-xs border-y border-border/80 py-2.5">
          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
              Peran / Kategori
            </span>
            <span className="font-semibold text-foreground truncate block">
              {isRouter
                ? "Core BGP Gateway"
                : isOlt
                  ? "Optical Line Terminal"
                  : isOdp
                    ? "Kotak Distribusi Fiber"
                    : isOdc
                      ? "Kabinet Feeder Sentral"
                      : "Tiang Lintasan Kabel"}
            </span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
              Koordinat GPS
            </span>
            <span
              className="font-mono text-[11px] text-foreground truncate block"
              data-testid="device-coordinates"
            >
              {device.latitude.toFixed(4)}, {device.longitude.toFixed(4)}
            </span>
          </div>

          {/* Rincian Tambahan jika ODP Distribusi */}
          {isOdp && (
            <>
              <div className="space-y-0.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
                  Pelanggan Terhubung
                </span>
                <span
                  className="font-bold text-foreground text-sm flex items-center gap-1.5"
                  data-testid="odp-connected-customers"
                >
                  <Users className="size-3.5 text-primary" />
                  <span>{connectedCustomers.length} Titik</span>
                </span>
              </div>

              <div className="space-y-0.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
                  Status Sesi
                </span>
                <span className="text-[11px] font-medium text-foreground block">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">{onlineConnected}</span> Online •{" "}
                  <span className="text-rose-600 dark:text-rose-400 font-bold">{offlineConnected}</span> Offline
                </span>
              </div>
            </>
          )}

          {/* Rincian OLT */}
          {isOlt && (
            <>
              <div className="space-y-0.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
                  Merek / Brand
                </span>
                <span className="font-semibold text-cyan-600 dark:text-cyan-400 block uppercase">
                  {typeof device.details?.brand === "string" ? device.details.brand : "HSGQ GPON"}
                </span>
              </div>

              <div className="space-y-0.5">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block">
                  Antarmuka PON
                </span>
                <span className="font-semibold text-foreground block">
                  Port PON Aktif (SFP C++)
                </span>
              </div>
            </>
          )}

          {/* Metadata Details Tambahan jika ada */}
          {device.details &&
            Object.entries(device.details)
              .filter(([k]) => !["brand", "connectedCustomers"].includes(k))
              .slice(0, 2)
              .map(([key, val]) => (
                <div key={key} className="space-y-0.5">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block capitalize">
                    {key}
                  </span>
                  <span className="font-medium text-foreground truncate block">{String(val)}</span>
                </div>
              ))}
        </div>

        {/* Daftar Pelanggan Terhubung ke ODP Ini (Data Nyata PostgreSQL) */}
        {isOdp && connectedCustomers.length > 0 && (
          <div
            className="text-[11px] bg-muted/40 p-2.5 rounded-lg border border-border/60 space-y-1.5"
            data-testid="odp-customer-list-section"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                <Users className="size-3 text-primary" />
                <span>Pelanggan pada {device.name} ({connectedCustomers.length})</span>
              </span>
            </div>
            <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
              {connectedCustomers.map((cust) => (
                <div
                  key={cust.id}
                  className="flex items-center justify-between gap-1 p-1 rounded bg-background/80 border border-border/40 text-[10px]"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-foreground truncate block">{cust.name}</span>
                    <span className="font-mono text-muted-foreground text-[9px] block">
                      {cust.pppoeUsername}
                    </span>
                  </div>
                  <div className="shrink-0 flex items-center gap-1">
                    <span
                      className={cn("size-1.5 rounded-full", cust.isOnline ? "bg-emerald-500" : "bg-rose-500")}
                      title={cust.isOnline ? "Online" : "Offline"}
                    />
                    {cust.opticalPower !== null && (
                      <span className="font-mono text-muted-foreground">{cust.opticalPower} dBm</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tombol Aksi Navigasi & Peta */}
        <div className="space-y-2 pt-0.5">
          <div className="flex items-center gap-2">
            {onFocus && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-1/2 text-xs h-7.5 gap-1.5 font-medium"
                data-testid="focus-infra-button"
                onClick={() => onFocus(device.latitude, device.longitude)}
                title={`Pusatkan kamera peta ke ${device.name}`}
              >
                <Crosshair className="size-3.5 text-primary" />
                <span>Pusatkan</span>
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("text-xs h-9 sm:h-8 gap-1.5 font-medium", onFocus ? "w-1/2" : "w-full")}
              data-testid="copy-device-coordinates-button"
              onClick={handleCopyCoordinates}
              title="Salin koordinat GPS perangkat ke clipboard"
            >
              {isCopied ? (
                <>
                  <Check className="size-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Tersalin!</span>
                </>
              ) : (
                <>
                  <Copy className="size-3.5 text-muted-foreground" />
                  <span>Salin GPS</span>
                </>
              )}
            </Button>
          </div>

          {gmapsUrl && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="w-full text-xs h-9 sm:h-8 gap-1.5 border-primary/20 hover:border-primary/40 text-muted-foreground hover:text-foreground font-medium"
              data-testid="open-device-gmaps-button"
            >
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Buka navigasi Google Maps ke lokasi ${device.name}`}
              >
                <Navigation className="size-3.5 text-blue-500" />
                <span>Buka Rute Navigasi Google Maps</span>
              </a>
            </Button>
          )}

          {/* Tombol Pindah Lokasi & Hapus Titik Perangkat */}
          {!isMoving && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/60">
              {onStartMove && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-1/2 text-xs h-9 sm:h-8 gap-1.5 border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400"
                  data-testid="move-infra-button"
                  onClick={onStartMove}
                  title={`Pindahkan lokasi koordinat ${device.name}`}
                >
                  <Move className="size-3.5 text-amber-500" />
                  <span>Pindah Lokasi</span>
                </Button>
              )}

              {onDelete && !showDeleteConfirm && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "text-xs h-9 sm:h-8 gap-1.5 border-rose-500/20 hover:border-rose-500/40 text-rose-600 dark:text-rose-400 font-medium hover:bg-rose-500/10",
                    onStartMove ? "w-1/2" : "w-full",
                  )}
                  data-testid="delete-infra-button"
                  onClick={() => setShowDeleteConfirm(true)}
                  title={`Hapus perangkat ${device.name} dari peta`}
                >
                  <Trash2 className="size-3.5 text-rose-500" />
                  <span>Hapus Titik</span>
                </Button>
              )}
            </div>
          )}

          {/* Konfirmasi Hapus Perangkat */}
          {showDeleteConfirm && (
            <div
              className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg space-y-2 animate-in fade-in"
              data-testid="delete-infra-confirm-dialog"
            >
              <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold text-xs">
                <AlertTriangle className="size-4" />
                <span>Hapus {device.name}?</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Perangkat ini akan dihapus dari peta infrastruktur NOC. Tindakan ini tidak dapat dibatalkan.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-1/2 text-xs h-9 sm:h-8 font-medium"
                  data-testid="cancel-delete-infra-button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="w-1/2 text-xs h-9 sm:h-8 font-medium gap-1"
                  data-testid="confirm-delete-infra-button"
                  onClick={() => {
                    onDelete?.();
                    setShowDeleteConfirm(false);
                  }}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      <span>Menghapus...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="size-3.5" />
                      <span>Ya, Hapus</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Set Parent Infrastruktur (untuk ODP dan ODC) */}
        {(isOdp || isOdc) && onSetParent && (
          <div className="pt-2 border-t">
            {!showParentSelector ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setShowParentSelector(true)}
                className="h-7 text-xs gap-1.5 w-full"
              >
                <Network className="size-3 text-primary" />
                {device.parentId ? "Ubah Parent" : "Set Parent Infra"}
                {device.parentId && <span className="text-muted-foreground ml-1 text-[10px]">({device.parentId.slice(0, 8)}...)</span>}
              </Button>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">Pilih parent ({isOdp ? "ODC/OLT" : "OLT/Router"}):</p>
                <select
                  value={selectedParentId}
                  onChange={(e) => setSelectedParentId(e.target.value)}
                  className="w-full h-7 text-xs rounded border border-border bg-background px-2"
                >
                  <option value="">— Tidak ada parent —</option>
                  {infraList
                    .filter((i) => i.id !== device.id && (isOdp ? ["odc", "olt", "router"] : ["olt", "router"]).includes(i.type))
                    .map((i) => (
                      <option key={i.id} value={i.id}>{i.name} ({i.type.toUpperCase()})</option>
                    ))}
                </select>
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => setShowParentSelector(false)} className="h-6 text-[10px] flex-1" disabled={isSettingParent}>Batal</Button>
                  <Button
                    type="button" size="sm" variant="default"
                    onClick={async () => { await onSetParent(selectedParentId || null); setShowParentSelector(false); }}
                    className="h-6 text-[10px] flex-1 gap-1" disabled={isSettingParent}
                  >
                    {isSettingParent ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                    Simpan
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pintasan Cepat ke Modul Manajemen Terkait */}
        <div
          className="space-y-1.5 pt-2 border-t border-border/80"
          data-testid="device-shortcuts-container"
        >
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Pintasan Operasional
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {isRouter ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-9 sm:h-8 px-2.5 text-xs sm:text-[11px] gap-1.5 font-medium col-span-2 bg-background hover:bg-muted"
                data-testid="shortcut-manage-router"
              >
                <Link href="/app/router" title="Buka konfigurasi router MikroTik">
                  <Router className="size-3.5 text-primary shrink-0" />
                  <span>Kelola Router MikroTik</span>
                </Link>
              </Button>
            ) : isOlt ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-9 sm:h-8 px-2.5 text-xs sm:text-[11px] gap-1.5 font-medium col-span-2 bg-background hover:bg-muted"
                data-testid="shortcut-manage-olt"
              >
                <Link href="/app/cpe" title="Buka manajemen OLT dan status optik PON">
                  <Network className="size-3.5 text-cyan-500 shrink-0" />
                  <span>Kelola OLT &amp; Optik PON</span>
                </Link>
              </Button>
            ) : isOdp ? (
              <>
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-9 sm:h-8 px-2 text-xs sm:text-[11px] gap-1 font-medium bg-background hover:bg-muted"
                  data-testid="shortcut-odp-customers"
                >
                  <Link
                    href={`/app/pelanggan?search=${encodeURIComponent(device.name)}`}
                    title="Buka daftar pelanggan di ODP ini"
                  >
                    <Users className="size-3 text-primary shrink-0" />
                    <span className="truncate">Pelanggan ({connectedCustomers.length})</span>
                  </Link>
                </Button>

                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-9 sm:h-8 px-2 text-xs sm:text-[11px] gap-1 font-medium bg-background hover:bg-muted"
                  data-testid="shortcut-odp-cpe"
                >
                  <Link href="/app/cpe" title="Buka data optik dan ONU">
                    <HardDrive className="size-3 text-cyan-500 shrink-0" />
                    <span className="truncate">CPE / OLT</span>
                  </Link>
                </Button>
              </>
            ) : (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="h-9 sm:h-8 px-2.5 text-xs sm:text-[11px] gap-1.5 font-medium col-span-2 bg-background hover:bg-muted"
              >
                <Link href="/app/peta">
                  <MapPin className="size-3.5 text-primary shrink-0" />
                  <span>Lihat di Peta Sebaran</span>
                </Link>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
