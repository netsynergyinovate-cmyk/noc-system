"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Layers, Info } from "lucide-react";
import { CAPACITY_TIERS } from "./map-style";

export function MapLegends() {
  // Hanya satu legenda terbuka: status dan kapasitas tidak bertumpuk di layar kecil
  const [open, setOpen] = useState<"status" | "capacity" | null>(null);
  const openStatus = open === "status";
  const openCapacity = open === "capacity";
  const toggleStatus = () => setOpen(openStatus ? null : "status");
  const toggleCapacity = () => setOpen(openCapacity ? null : "capacity");

  return (
    <div className="flex flex-col gap-2 pointer-events-auto max-w-[280px]">
      {/* Legenda Status Sambungan */}
      <div className="bg-card/95 backdrop-blur-md border border-border shadow-lg rounded-xl overflow-hidden transition-all text-card-foreground text-xs">
        <button
          onClick={toggleStatus}
          className="w-full flex items-center justify-between px-3 py-2 font-medium hover:bg-muted/50 transition-colors"
          type="button"
        >
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <Info className="w-3.5 h-3.5 text-primary" />
            Status Layanan Pelanggan
          </span>
          {openStatus ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>

        {openStatus && (
          <div className="p-3 border-t border-border flex flex-col gap-2 bg-card/60">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shrink-0" />
              <div className="flex flex-col">
                <span className="font-medium text-foreground">Terhubung</span>
                <span className="text-[10px] text-muted-foreground">Layanan aktif normal</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-400 shadow-sm shrink-0" />
              <div className="flex flex-col">
                <span className="font-medium text-foreground">Isolir</span>
                <span className="text-[10px] text-muted-foreground">Pembayaran tertunda</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-rose-500 shadow-sm shrink-0" />
              <div className="flex flex-col">
                <span className="font-medium text-foreground">Loss / Gangguan</span>
                <span className="text-[10px] text-muted-foreground">Sinyal optik putus/LOS</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-zinc-400 shadow-sm shrink-0" />
              <div className="flex flex-col">
                <span className="font-medium text-foreground">Offline / Belum Aktif</span>
                <span className="text-[10px] text-muted-foreground">Perangkat mati</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border pt-2">
              Garis ODP → pelanggan memakai warna yang sama. Garis bergerak =
              layanan mengalir; garis titik-titik diam = terputus / status belum
              tersedia.
            </p>
          </div>
        )}
      </div>

      {/* Legenda Kapasitas Kabel (Palet non-kuning/merah/hijau) */}
      <div className="bg-card/95 backdrop-blur-md border border-border shadow-lg rounded-xl overflow-hidden transition-all text-card-foreground text-xs">
        <button
          onClick={toggleCapacity}
          className="w-full flex items-center justify-between px-3 py-2 font-medium hover:bg-muted/50 transition-colors"
          type="button"
        >
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <Layers className="w-3.5 h-3.5 text-primary" />
            Kapasitas Serat Kabel
          </span>
          {openCapacity ? (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>

        {openCapacity && (
          <div className="p-3 border-t border-border flex flex-col gap-2 bg-card/60">
            <p className="text-[10px] text-muted-foreground mb-1 italic">
              Warna khusus kapasitas (tidak memakai warna status).
            </p>
            {CAPACITY_TIERS.map((t) => (
              <div key={t.label} className="flex items-center gap-2.5">
                <span
                  className="w-6 shrink-0 rounded-sm border border-black/20"
                  style={{ height: t.weight, backgroundColor: t.color }}
                />
                <span className="text-foreground">{t.label}</span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border pt-2">
              Jalur yang diberi warna sendiri memakai warna itu; ketebalan garis
              tetap menunjukkan kapasitas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
