"use client";

import { useEffect, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  Loader2,
  MapPin,
  Network,
  Plus,
  Router,
  Server,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { InfrastructureDeviceType } from "@/validators/infrastructure-placement";
export type { InfrastructureDeviceType };

export interface DeviceTypeOption {
  type: InfrastructureDeviceType;
  label: string;
  description: string;
  icon: typeof Router;
  color: string;
  badgeClass: string;
}

export const DEVICE_TYPE_OPTIONS: DeviceTypeOption[] = [
  {
    type: "router",
    label: "Core Router",
    description: "Gateway BGP, PPPoE Server, Routing Core",
    icon: Router,
    color: "#8b5cf6",
    badgeClass:
      "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
  },
  {
    type: "olt",
    label: "OLT Fiber",
    description: "Optical Line Terminal HSGQ GPON/EPON",
    icon: Network,
    color: "#06b6d4",
    badgeClass:
      "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  },
  {
    type: "odp",
    label: "ODP Kotak",
    description: "Optical Distribution Point Fiber to Home",
    icon: Boxes,
    color: "#f59e0b",
    badgeClass:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  {
    type: "odc",
    label: "ODC Kabinet",
    description: "Optical Distribution Cabinet Sentral Feeder",
    icon: Server,
    color: "#3b82f6",
    badgeClass:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  {
    type: "pole",
    label: "Tiang Fiber",
    description: "Tiang tumpu kabel aerial serat optik",
    icon: MapPin,
    color: "#64748b",
    badgeClass:
      "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30",
  },
];

export interface RouteOption {
  id: string;
  name: string;
  oltName: string | null;
  odcName: string | null;
}

export interface DeviceTypePickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedType: InfrastructureDeviceType | null;
  onSelectType: (type: InfrastructureDeviceType) => void;
  draftCoordinates: { lat: number; lng: number } | null;
  onConfirmPlacement: (point: {
    name: string;
    type: InfrastructureDeviceType;
    latitude: number;
    longitude: number;
    host?: string;
    routeId?: string;
  }) => Promise<void> | void;
  onCancelPlacement: () => void;
  isSaving?: boolean;
  successMessage?: string | null;
  errorMessage?: string | null;
  suggestedName?: string;
  routes?: RouteOption[];
  activeRouteId?: string | null;
}

export function DeviceTypePicker({
  isOpen,
  onClose,
  selectedType,
  onSelectType,
  draftCoordinates,
  onConfirmPlacement,
  onCancelPlacement,
  isSaving = false,
  successMessage,
  errorMessage,
  suggestedName,
  routes = [],
  activeRouteId = null,
}: DeviceTypePickerProps) {
  const [deviceName, setDeviceName] = useState(suggestedName ?? "");
  const [deviceHost, setDeviceHost] = useState("");
  useEffect(() => {
    setDeviceName(suggestedName ?? "");
  }, [suggestedName]);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string>(
    activeRouteId ?? "",
  );
  useEffect(() => {
    setSelectedRouteId(activeRouteId ?? "");
  }, [activeRouteId]);

  if (!isOpen && !draftCoordinates) return null;

  const activeOption =
    DEVICE_TYPE_OPTIONS.find((opt) => opt.type === selectedType) ??
    DEVICE_TYPE_OPTIONS[2]; // default ODP

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim()) {
      setFormError("Nama atau kode perangkat wajib diisi.");
      return;
    }
    if (!draftCoordinates) {
      setFormError("Pilih titik koordinat pada peta terlebih dahulu.");
      return;
    }

    setFormError(null);
    await onConfirmPlacement({
      name: deviceName.trim(),
      type: selectedType ?? "odp",
      latitude: draftCoordinates.lat,
      longitude: draftCoordinates.lng,
      host: deviceHost.trim() || undefined,
      routeId: selectedRouteId || undefined,
    });
    setDeviceName("");
    setDeviceHost("");
  };

  return (
    <>
      {/* 1. Modal/Drawer Pemilih Jenis Perangkat */}
      {isOpen && !draftCoordinates && (
        <Card
          className="absolute top-16 right-3 sm:right-6 z-[1010] w-80 max-w-[calc(100vw-2rem)] shadow-2xl border-border bg-card/95 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150"
          data-testid="device-type-picker"
        >
          <CardContent className="p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                  <Plus className="size-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs sm:text-sm text-foreground">
                    Pilih Jenis Perangkat
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Tentukan infrastruktur untuk ditempatkan di peta
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground rounded p-1"
                data-testid="close-device-picker"
                title="Tutup pemilih perangkat"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {DEVICE_TYPE_OPTIONS.filter(
                (o) => o.type === "odp" || o.type === "odc",
              ).map((opt) => {
                const IconComponent = opt.icon;
                const isSelected = selectedType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => onSelectType(opt.type)}
                    className={cn(
                      "w-full text-left p-2 rounded-lg border transition-all flex items-start gap-2.5",
                      isSelected
                        ? "border-primary bg-primary/10 shadow-xs"
                        : "border-border/60 hover:bg-muted/60",
                    )}
                    data-testid={
                      opt.type === "router"
                        ? "select-type-router"
                        : opt.type === "olt"
                          ? "select-type-olt"
                          : opt.type === "odp"
                            ? "select-type-odp"
                            : opt.type === "odc"
                              ? "select-type-odc"
                              : "select-type-pole"
                    }
                  >
                    <div
                      className="p-1.5 rounded-md text-white shrink-0 mt-0.5"
                      style={{ backgroundColor: opt.color }}
                    >
                      <IconComponent className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-xs text-foreground">
                          {opt.label}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] px-1 py-0 uppercase font-mono",
                            opt.badgeClass,
                          )}
                        >
                          {opt.type}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                        {opt.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Form Konfirmasi Penempatan Titik Perangkat */}
      {draftCoordinates && (
        <Card
          className="absolute bottom-4 right-4 z-[1010] w-88 max-w-[calc(100vw-2rem)] shadow-2xl border-primary/30 bg-card/95 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150"
          data-testid="device-placement-form"
        >
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between border-b pb-2">
              <div className="flex items-center gap-2">
                <div
                  className="p-1.5 rounded-md text-white shrink-0"
                  style={{ backgroundColor: activeOption.color }}
                >
                  <activeOption.icon className="size-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-foreground">
                    Konfirmasi Penempatan {activeOption.label}
                  </h3>
                  <p className="text-[10px] text-muted-foreground">
                    Lengkapi identitas perangkat pada titik yang dipilih
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancelPlacement}
                className="text-muted-foreground hover:text-foreground rounded p-1"
                data-testid="cancel-place-device-button"
                title="Batalkan penempatan"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Type switcher chips */}
            <div className="flex gap-1 flex-wrap">
              {DEVICE_TYPE_OPTIONS.filter(
                (o) => o.type === "odp" || o.type === "odc",
              ).map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => onSelectType(opt.type)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold border transition-colors ${
                    selectedType === opt.type
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-accent"
                  }`}
                >
                  <opt.icon className="size-2.5" />
                  {opt.type.toUpperCase()}
                </button>
              ))}
            </div>

            {successMessage && (
              <div
                className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs"
                data-testid="device-placement-success"
              >
                <CheckCircle2 className="size-4 shrink-0" />
                <span className="font-medium text-xs">{successMessage}</span>
              </div>
            )}

            {(errorMessage || formError) && (
              <div
                className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium"
                data-testid="device-placement-error"
              >
                {errorMessage || formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-2.5 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Nama Perangkat / Kode Titik *
                </label>
                <Input
                  type="text"
                  placeholder={
                    selectedType === "odp"
                      ? "Misal: ODP-09-TERAS"
                      : selectedType === "olt"
                        ? "Misal: OLT HSGQ Sentral"
                        : selectedType === "router"
                          ? "Misal: Core CIARA BGP"
                          : "Nama Perangkat"
                  }
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="h-8 text-xs bg-background"
                  data-testid="device-name-input"
                  autoFocus
                />
              </div>

              {(selectedType === "odp" || selectedType === null) &&
                routes.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      Jalur{" "}
                      <span className="text-muted-foreground">(opsional)</span>
                    </label>
                    <select
                      value={selectedRouteId}
                      onChange={(e) => setSelectedRouteId(e.target.value)}
                      disabled={!!activeRouteId}
                      className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                    >
                      <option value="">— Tanpa jalur —</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {r.odcName ? ` (${r.odcName})` : ""}
                        </option>
                      ))}
                    </select>
                    {activeRouteId && (
                      <p className="text-[10px] text-muted-foreground">
                        Jalur terkunci ke mode aktif.
                      </p>
                    )}
                  </div>
                )}

              {(selectedType === "router" || selectedType === "olt") && (
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Host / IP Perangkat (Opsional)
                  </label>
                  <Input
                    type="text"
                    placeholder="10.10.0.1:8728"
                    value={deviceHost}
                    onChange={(e) => setDeviceHost(e.target.value)}
                    className="h-8 text-xs font-mono bg-background"
                    data-testid="device-host-input"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase">
                    Latitude
                  </label>
                  <Input
                    type="text"
                    readOnly
                    value={draftCoordinates.lat.toFixed(6)}
                    className="h-7 text-[11px] font-mono bg-muted/60"
                    data-testid="device-lat-input"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase">
                    Longitude
                  </label>
                  <Input
                    type="text"
                    readOnly
                    value={draftCoordinates.lng.toFixed(6)}
                    className="h-7 text-[11px] font-mono bg-muted/60"
                    data-testid="device-lng-input"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1.5 border-t">
                <Button
                  type="submit"
                  size="sm"
                  className="w-1/2 text-xs h-8 gap-1.5 font-semibold"
                  disabled={isSaving || !deviceName.trim()}
                  data-testid="confirm-place-device-button"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="size-3.5" />
                      <span>Simpan Titik</span>
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-1/2 text-xs h-8"
                  onClick={onCancelPlacement}
                  disabled={isSaving}
                >
                  Batal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}
