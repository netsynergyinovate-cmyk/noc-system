"use client";

import { X, HelpCircle, Server, Cable, Users, Navigation } from "lucide-react";
import { DeviceBadge } from "./device-badge";

interface QuickGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QuickGuideModal({ isOpen, onClose }: QuickGuideModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card text-card-foreground border border-border shadow-2xl rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-base">
              Panduan Membaca Peta NOC
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          <div>
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-primary" />
              Simbol & Jenis Perangkat
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded-lg bg-muted/50 border border-border flex items-center gap-2">
                <DeviceBadge type="server" />
                <div>
                  <div className="font-medium">Server / OLT</div>
                  <div className="text-[10px] text-muted-foreground">Pusat distribusi utama</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-muted/50 border border-border flex items-center gap-2">
                <DeviceBadge type="odc" />
                <div>
                  <div className="font-medium">ODC</div>
                  <div className="text-[10px] text-muted-foreground">Lemari terminasi serat</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-muted/50 border border-border flex items-center gap-2">
                <DeviceBadge type="odp" />
                <div>
                  <div className="font-medium">ODP</div>
                  <div className="text-[10px] text-muted-foreground">Kotak pembagi pelanggan</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-muted/50 border border-border flex items-center gap-2">
                <DeviceBadge type="pole" />
                <div>
                  <div className="font-medium">Tiang / Pole</div>
                  <div className="text-[10px] text-muted-foreground">Titik lintasan tiang</div>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-muted/50 border border-border flex items-center gap-2 col-span-2">
                <DeviceBadge type="customer" color="#22c55e" />
                <div>
                  <div className="font-medium">Pelanggan</div>
                  <div className="text-[10px] text-muted-foreground">
                    Rumah berwarna status layanan (zoom dekat); titik saat zoom jauh
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-primary" />
              Titik Pelanggan & Warna Layanan
            </h4>
            <p className="text-muted-foreground mb-2">
              Setiap pelanggan digambarkan dengan lingkaran vektor yang warnanya menunjukkan status operasional nyata:
            </p>
            <ul className="space-y-1.5 list-disc list-inside text-muted-foreground">
              <li>
                <strong className="text-emerald-500">Hijau (Terhubung)</strong>: Pelanggan aktif normal dan sinyal optik baik.
              </li>
              <li>
                <strong className="text-amber-500">Kuning (Isolir)</strong>: Layanan dinonaktifkan sementara karena tagihan.
              </li>
              <li>
                <strong className="text-rose-500">Merah (Loss)</strong>: Gangguan kabel optik putus atau modem mati.
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Cable className="w-4 h-4 text-primary" />
              Jalur Kabel & Road Snapping
            </h4>
            <p className="text-muted-foreground leading-relaxed">
              Jalur kabel tidak ditarik lurus di atas gedung, melainkan otomatis menempel lekukan jalan nyata (<em>road snapping</em>) dengan titik sampling tiap ±50 meter. Panjang kabel dihitung secara geodesik di server.
            </p>
          </div>

          <div>
            <h4 className="font-medium text-foreground mb-2 flex items-center gap-1.5">
              <Navigation className="w-4 h-4 text-primary" />
              Interaksi & Pengelolaan Panel
            </h4>
            <p className="text-muted-foreground leading-relaxed">
              Klik titik mana pun untuk membuka panel data lengkap di samping tanpa meninggalkan peta. Tombol pintasan di dalam panel membuka panel bertumpuk (maksimal 2 lapis). Tekan tombol <strong>Esc</strong> atau tombol tutup untuk kembali.
            </p>
          </div>
        </div>

        <div className="p-3 border-t border-border flex justify-end bg-muted/30">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 transition-opacity"
          >
            Mengerti
          </button>
        </div>
      </div>
    </div>
  );
}
