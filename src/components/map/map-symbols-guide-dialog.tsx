"use client";

import React, { useState } from "react";
import {
  HelpCircle,
  Info,
  Layers,
  Move,
  Network,
  Radio,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface MapSymbolsGuideDialogProps {
  triggerButton?: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Panel dialog modal panduan singkat simbol peta, arti kode warna status perangkat,
 * kapasitas kabel serat optik, dan panduan gestur interaksi operasional jaringan.
 */
export function MapSymbolsGuideDialog({
  triggerButton,
  defaultOpen = false,
  onOpenChange,
}: MapSymbolsGuideDialogProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [activeTab, setActiveTab] = useState<"nodes" | "cables" | "gestures">("nodes");

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {triggerButton ?? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium bg-card/95 backdrop-blur-md shadow-xs"
            data-testid="open-map-symbols-guide"
            title="Buka panduan singkat simbol dan navigasi peta"
          >
            <HelpCircle className="size-4 sm:size-3.5 text-primary" />
            <span className="hidden sm:inline">Panduan Simbol</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto p-5"
        data-testid="map-symbols-guide-dialog"
      >
        <DialogHeader className="pb-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
              <Info className="size-4" />
            </span>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Panduan Simbol & Interaksi Peta Jaringan
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Referensi arti kode warna status perangkat, kapasitas serat optik, dan navigasi operasional NOC.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Tab Pemilih Topik Panduan */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60 text-xs mt-3">
          <button
            type="button"
            onClick={() => setActiveTab("nodes")}
            className={`flex-1 py-1.5 px-3 rounded-md font-medium transition-all text-center ${
              activeTab === "nodes"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="guide-tab-nodes"
          >
            Simbol Titik & Status
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("cables")}
            className={`flex-1 py-1.5 px-3 rounded-md font-medium transition-all text-center ${
              activeTab === "cables"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="guide-tab-cables"
          >
            Kapasitas Kabel Optik
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("gestures")}
            className={`flex-1 py-1.5 px-3 rounded-md font-medium transition-all text-center ${
              activeTab === "gestures"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="guide-tab-gestures"
          >
            Interaksi & Aksi Peta
          </button>
        </div>

        {/* SEKSI 1: SIMBOL TITIK & STATUS */}
        {activeTab === "nodes" && (
          <div className="space-y-4 pt-2" data-testid="guide-section-nodes">
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Radio className="size-3.5 text-primary" />
                <span>Titik Pelanggan FTTH</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-full bg-emerald-500 shrink-0 mt-0.5 shadow-xs" />
                  <div>
                    <span className="font-semibold text-foreground block">Pelanggan Online (Normal)</span>
                    <span className="text-[11px] text-muted-foreground">
                      Sesi PPPoE aktif di Router Mikrotik dengan redaman optik sehat (&gt; -23.0 dBm).
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-full bg-amber-500 ring-2 ring-amber-400/50 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-amber-600 dark:text-amber-400 block">Redaman Optik Kritis</span>
                    <span className="text-[11px] text-muted-foreground">
                      Daya terima RX $\le -24.5$ dBm. Potensi koneksi lambat/drop akibat tekukan serat atau konektor kotor.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-full bg-rose-500 ring-2 ring-rose-400/50 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-rose-600 dark:text-rose-400 block">Status Terisolir</span>
                    <span className="text-[11px] text-muted-foreground">
                      Tagihan bulanan belum diselesaikan; trafik dialihkan ke halaman peringatan isolir.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-full bg-red-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-red-600 dark:text-red-400 block">Offline / LOS</span>
                    <span className="text-[11px] text-muted-foreground">
                      Sinyal optik putus (*Loss of Signal*) atau ONT mati listrik.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Network className="size-3.5 text-primary" />
                <span>Perangkat Fisik Infrastruktur</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-full bg-purple-500 ring-2 ring-purple-300 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-foreground block">Core Router Gateway</span>
                    <span className="text-[11px] text-muted-foreground">
                      Router induk pengelolaan bandwidth, antrian (*queues*), dan server PPPoE.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-full bg-cyan-500 ring-2 ring-cyan-300 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-foreground block">OLT (Optical Line Terminal)</span>
                    <span className="text-[11px] text-muted-foreground">
                      Perangkat laser pusat pengirim paket data melalui port GPON/EPON menuju jaringan distribusi.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-xs bg-blue-500 ring-2 ring-blue-300 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-foreground block">ODC (Optical Distribution Cabinet)</span>
                    <span className="text-[11px] text-muted-foreground">
                      Kabinet pembagi pasif primer (*feeder splitter*) berkapasitas besar di pusat area perumahan.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card">
                  <span className="size-3.5 rounded-xs bg-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-foreground block">ODP (Optical Distribution Point)</span>
                    <span className="text-[11px] text-muted-foreground">
                      Kotak splitter distribusi tiang (1:8 atau 1:16) tempat sambungan kabel drop pelanggan.
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/60 bg-card sm:col-span-2">
                  <span className="size-3 rounded-full bg-slate-500 ring-2 ring-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-foreground block">Tiang Tumpu Fiber</span>
                    <span className="text-[11px] text-muted-foreground">
                      Titik tumpu penahan kabel udara antar-segmen jalan (*pole span*).
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SEKSI 2: KAPASITAS KABEL FIBER */}
        {activeTab === "cables" && (
          <div className="space-y-2.5 pt-2" data-testid="guide-section-cables">
            {/* 1. Backbone Utama */}
            <div className="p-2.5 rounded-lg border border-border/60 bg-card space-y-1.5" data-testid="guide-cable-tier-backbone">
              <div className="flex items-center gap-2">
                <span className="w-8 h-[5px] rounded-full bg-purple-500 shrink-0 shadow-xs ring-1 ring-purple-400/50" />
                <span className="font-bold text-foreground text-xs">Jalur Backbone Optik (48 - 96 Core)</span>
                <Badge variant="outline" className="text-[10px] ml-auto border-purple-500/30 text-purple-600 dark:text-purple-400">Backbone Utama (5.0px)</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-10">
                Kabel serat optik kapasitas tinggi penghubung Core Router BGP ke OLT Sentral dan Kabinet ODC.
                Dilengkapi efek halo tebal saat di-zoom pada peta.
              </p>
            </div>

            {/* 2. Feeder Utama */}
            <div className="p-2.5 rounded-lg border border-border/60 bg-card space-y-1.5" data-testid="guide-cable-tier-feeder-main">
              <div className="flex items-center gap-2">
                <span className="w-8 h-[4px] rounded-full bg-indigo-500 shrink-0 shadow-xs" />
                <span className="font-bold text-foreground text-xs">Jalur Feeder Utama (24 Core)</span>
                <Badge variant="outline" className="text-[10px] ml-auto border-indigo-500/30 text-indigo-600 dark:text-indigo-400">Feeder Utama (4.0px)</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-10">
                Kabel pengumpan utama penghubung OLT menuju kabinet pasif primer ODC di tiap pusat wilayah pemukiman.
              </p>
            </div>

            {/* 3. Feeder Distribusi */}
            <div className="p-2.5 rounded-lg border border-border/60 bg-card space-y-1.5" data-testid="guide-cable-tier-feeder-dist">
              <div className="flex items-center gap-2">
                <span className="w-8 h-[3px] rounded-full bg-cyan-500 shrink-0 shadow-xs" />
                <span className="font-bold text-foreground text-xs">Jalur Feeder Distribusi (16 - 24 Core)</span>
                <Badge variant="outline" className="text-[10px] ml-auto border-cyan-500/30 text-cyan-600 dark:text-cyan-400">Distribusi Tiang (3.2px)</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-10">
                Kabel feeder distribusi penghubung dari ODC menuju kotak-kotak pembagi ODP yang terpasang di tiang jalan.
              </p>
            </div>

            {/* 4. Distribusi Cabang */}
            <div className="p-2.5 rounded-lg border border-border/60 bg-card space-y-1.5" data-testid="guide-cable-tier-branch">
              <div className="flex items-center gap-2">
                <span className="w-8 h-[2px] rounded-full bg-amber-500 shrink-0" />
                <span className="font-bold text-foreground text-xs">Jalur Distribusi Cabang (4 - 8 Core)</span>
                <Badge variant="outline" className="text-[10px] ml-auto border-amber-500/30 text-amber-600 dark:text-amber-400">Antar Tiang (2.5px)</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-10">
                Kabel penghubung sambungan loop percabangan antar-ODP sekunder atau tiang tumpu fiber optik di tingkat lorong/gang.
              </p>
            </div>

            {/* 5. Drop Core Pelanggan */}
            <div className="p-2.5 rounded-lg border border-border/60 bg-card space-y-1.5" data-testid="guide-cable-tier-drop">
              <div className="flex items-center gap-2">
                <span className="w-8 h-[1.5px] rounded-full bg-emerald-500 shrink-0" />
                <span className="font-bold text-foreground text-xs">Kabel Drop Core Pelanggan (1 - 2 Core)</span>
                <Badge variant="outline" className="text-[10px] ml-auto border-emerald-500/30 text-emerald-600 dark:text-emerald-400">Drop (1.8px)</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-10">
                Kabel drop udara berpelindung kawat baja (*messenger wire*) dari port ODP menuju roset rumah pelanggan.
                Warna otomatis berubah merah terang bila status pelanggan offline atau mengalami Loss of Signal.
              </p>
            </div>

            {/* 6. Jalur Disorot (Highlight) */}
            <div className="p-2.5 rounded-lg border border-cyan-500/30 bg-cyan-500/5 space-y-1.5" data-testid="guide-cable-tier-highlight">
              <div className="flex items-center gap-2">
                <span className="w-8 h-[3.5px] rounded-full bg-cyan-400 shrink-0 ring-2 ring-cyan-300/60 shadow-xs animate-pulse" />
                <span className="font-bold text-cyan-600 dark:text-cyan-400 text-xs">Jalur Disorot (Koneksi Aktif Terpilih)</span>
                <Badge variant="outline" className="text-[10px] ml-auto border-cyan-500/40 text-cyan-600 dark:text-cyan-400">Halo +3.5px</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed pl-10">
                Menyala terang dengan pulsa biru kehijauan untuk menandai jalur transmisi dari sentral hingga titik perangkat/pelanggan yang sedang diinspeksi.
              </p>
            </div>
          </div>
        )}

        {/* SEKSI 3: PANDUAN AKSI & NAVIGASI PETA */}
        {activeTab === "gestures" && (
          <div className="space-y-3 pt-2 text-xs" data-testid="guide-section-actions">
            <div className="flex items-start gap-3 p-2.5 rounded-lg border border-border/60 bg-card">
              <span className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                <Search className="size-3.5" />
              </span>
              <div>
                <span className="font-semibold text-foreground block">Pencarian & Penyorotan Otomatis</span>
                <span className="text-[11px] text-muted-foreground">
                  Gunakan kolom pencarian di kiri atas untuk menemukan pelanggan berdasarkan nama, nomor telepon, atau ODP.
                  Peta akan otomatis menggeser fokus kamera tanpa tertutup oleh panel detail.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3 p-2.5 rounded-lg border border-border/60 bg-card">
              <span className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                <Move className="size-3.5" />
              </span>
              <div>
                <span className="font-semibold text-foreground block">Koreksi Titik GPS Pelanggan</span>
                <span className="text-[11px] text-muted-foreground">
                  Buka detail pelanggan, klik tombol <strong>Ubah Posisi</strong>, geser pin biru ke lokasi rumah yang akurat,
                  lalu klik <strong>Simpan</strong> untuk memperbarui database PostgreSQL secara langsung.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3 p-2.5 rounded-lg border border-border/60 bg-card">
              <span className="flex items-center justify-center size-7 rounded-md bg-primary/10 text-primary shrink-0">
                <Layers className="size-3.5" />
              </span>
              <div>
                <span className="font-semibold text-foreground block">Optimasi Performa Spasial (Viewport & LOD)</span>
                <span className="text-[11px] text-muted-foreground">
                  Peta menyembunyikan titik dan ribuan kabel di luar batas layar secara otomatis. Pada zoom jauh, kabel drop
                  pelanggan disederhanakan agar performa rendering tetap responsif pada perangkat teknisi lapangan.
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-border/60 flex justify-end">
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs font-medium"
              data-testid="close-map-symbols-guide"
            >
              Mengerti & Tutup
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
