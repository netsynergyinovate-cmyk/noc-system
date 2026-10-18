"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Crosshair,
  MapPin,
  MapPinOff,
  Radio,
  Search,
  User,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { NetworkCustomerPoint } from "@/services/network-map.service";

export interface CustomerCoordinatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: NetworkCustomerPoint[];
  onSelectCustomer: (customer: NetworkCustomerPoint) => void;
  prefilledCoord?: { lat: number; lng: number } | null;
}

export function CustomerCoordinatePickerModal({
  isOpen,
  onClose,
  customers,
  onSelectCustomer,
  prefilledCoord,
}: CustomerCoordinatePickerModalProps) {
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<"unmapped" | "all" | "mapped">("unmapped");

  const unmappedCount = useMemo(
    () => customers.filter((c) => c.latitude === null || c.longitude === null).length,
    [customers],
  );

  const mappedCount = useMemo(
    () => customers.filter((c) => c.latitude !== null && c.longitude !== null).length,
    [customers],
  );

  const filteredCustomers = useMemo(() => {
    let list = customers;

    if (filterMode === "unmapped") {
      list = list.filter((c) => c.latitude === null || c.longitude === null);
    } else if (filterMode === "mapped") {
      list = list.filter((c) => c.latitude !== null && c.longitude !== null);
    }

    if (!search.trim()) return list;

    const q = search.trim().toLowerCase();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.pppoeUsername.toLowerCase().includes(q) ||
        (c.odpName && c.odpName.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q)) ||
        c.id.toLowerCase().includes(q),
    );
  }, [customers, filterMode, search]);

  const handleSelect = (customer: NetworkCustomerPoint) => {
    onSelectCustomer(customer);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden"
        data-testid="customer-coordinate-picker-dialog"
      >
        <DialogHeader className="p-4 pb-3 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <MapPin className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                Tentukan Titik Koordinat Pelanggan
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Pilih pelanggan untuk menentukan atau mengubah posisi titik GPS di peta dan menyimpan langsung ke database PostgreSQL.
              </DialogDescription>
            </div>
          </div>

          {/* Banner jika koordinat sudah dipilih di peta sebelumnya */}
          {prefilledCoord && (
            <div className="mt-2.5 p-2 rounded-md bg-primary/10 border border-primary/30 flex items-center justify-between text-xs text-foreground">
              <span className="flex items-center gap-1.5 font-medium">
                <Crosshair className="size-3.5 text-primary animate-pulse" />
                <span>
                  Koordinat Terpilih:{" "}
                  <code className="font-mono text-primary font-semibold">
                    {prefilledCoord.lat.toFixed(6)}, {prefilledCoord.lng.toFixed(6)}
                  </code>
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                Pilih pelanggan di bawah untuk menetapkan
              </span>
            </div>
          )}
        </DialogHeader>

        {/* Search Bar & Filter Tabs */}
        <div className="p-3 border-b bg-card space-y-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Cari nama pelanggan, username PPPoE, atau ODP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-7 h-8 text-xs bg-background"
              data-testid="picker-search-input"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground hover:text-foreground flex items-center justify-center rounded"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant={filterMode === "unmapped" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterMode("unmapped")}
              className="h-7 text-xs px-2.5 gap-1.5 font-medium"
              data-testid="filter-unmapped-tab"
            >
              <MapPinOff className="size-3" />
              <span>Belum Ada GPS</span>
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px] h-4">
                {unmappedCount}
              </Badge>
            </Button>

            <Button
              type="button"
              variant={filterMode === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterMode("all")}
              className="h-7 text-xs px-2.5 gap-1.5 font-medium"
              data-testid="filter-all-tab"
            >
              <User className="size-3" />
              <span>Semua</span>
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px] h-4">
                {customers.length}
              </Badge>
            </Button>

            <Button
              type="button"
              variant={filterMode === "mapped" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterMode("mapped")}
              className="h-7 text-xs px-2.5 gap-1.5 font-medium"
              data-testid="filter-mapped-tab"
            >
              <CheckCircle2 className="size-3" />
              <span>Sudah Ada Titik</span>
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px] h-4">
                {mappedCount}
              </Badge>
            </Button>
          </div>
        </div>

        {/* Customer List Content */}
        <div
          className="flex-1 overflow-y-auto p-3 space-y-2 divide-y divide-border/40 min-h-[260px] max-h-[380px]"
          data-testid="customer-picker-list"
        >
          {filteredCustomers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground space-y-2">
              <MapPinOff className="size-8 text-muted-foreground/50" />
              <p className="text-xs font-medium">
                {search
                  ? `Tidak ditemukan pelanggan yang cocok dengan pencarian "${search}".`
                  : filterMode === "unmapped"
                    ? "Semua pelanggan sudah memiliki koordinat GPS di database!"
                    : "Belum ada data pelanggan yang sesuai kriteria."}
              </p>
              {search && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearch("")}
                  className="h-7 text-xs"
                >
                  Bersihkan Pencarian
                </Button>
              )}
            </div>
          ) : (
            filteredCustomers.map((cust) => {
              const hasGPS = cust.latitude !== null && cust.longitude !== null;
              return (
                <div
                  key={cust.id}
                  className="pt-2 first:pt-0 flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-muted/60 transition-colors cursor-pointer border border-transparent hover:border-border/60"
                  data-testid={`customer-picker-item-${cust.id}`}
                  onClick={() => handleSelect(cust)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelect(cust);
                    }
                  }}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-xs text-foreground truncate">
                        {cust.name}
                      </span>
                      {cust.isOnline ? (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px] h-4 px-1.5 gap-1"
                        >
                          <Wifi className="size-2.5" />
                          Online
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-muted text-muted-foreground border-border text-[10px] h-4 px-1.5 gap-1"
                        >
                          <WifiOff className="size-2.5" />
                          Offline
                        </Badge>
                      )}
                      {cust.billingStatus === "isolir" && (
                        <Badge
                          variant="destructive"
                          className="text-[10px] h-4 px-1.5"
                        >
                          Isolir
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono flex-wrap">
                      <span className="truncate">User: {cust.pppoeUsername}</span>
                      {cust.odpName && (
                        <span className="truncate flex items-center gap-1 font-sans">
                          <Radio className="size-3 text-cyan-500" />
                          {cust.odpName}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] flex items-center gap-1.5">
                      {hasGPS ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono text-[10px]">
                          <CheckCircle2 className="size-3" />
                          {cust.latitude?.toFixed(4)}, {cust.longitude?.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-[11px] font-medium">
                          <MapPinOff className="size-3" />
                          Belum ada koordinat GPS
                        </span>
                      )}
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={prefilledCoord ? "default" : hasGPS ? "secondary" : "default"}
                    onClick={() => handleSelect(cust)}
                    className="h-8 text-xs shrink-0 font-medium gap-1.5 px-3"
                    data-testid={`select-customer-plot-${cust.id}`}
                  >
                    <MapPin className="size-3.5" />
                    <span>
                      {prefilledCoord
                        ? "Tetapkan ke Pelanggan Ini"
                        : hasGPS
                          ? "Ganti Titik"
                          : "Tentukan di Peta"}
                    </span>
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

