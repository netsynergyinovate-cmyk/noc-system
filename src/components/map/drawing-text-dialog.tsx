"use client";

import React, { useState } from "react";
import { Type, Sparkles, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export interface DrawingTextDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (textData: {
    text: string;
    fontSize: number;
    color: string;
    fillColor?: string;
  }) => void;
  initialText?: string;
  initialFontSize?: number;
  initialColor?: string;
  initialFillColor?: string;
  isEditing?: boolean;
}

export const ISP_TEXT_PRESETS = [
  "ODP Baru",
  "Kabel Fiber Putus",
  "Tiang Distribusi",
  "Redaman Tinggi (-27 dBm)",
  "Jalur Drop Fiber",
  "Pelanggan VIP",
];

export const FONT_SIZE_OPTIONS = [
  { size: 12, label: "Kecil (12px)" },
  { size: 14, label: "Standar (14px)" },
  { size: 18, label: "Besar (18px)" },
  { size: 24, label: "Judul (24px)" },
];

export type BadgeStyleType = "dark" | "accent" | "none";

/**
 * Dialog Input & Pengeditan Label Catatan Teks Lapangan (Fase 5 - Lapisan Gambar LeaferJS)
 * Menyediakan input teks dengan tag preset lapangan ISP, ukuran font, gaya background badge,
 * dan pratinjau langsung yang kontras untuk peta satelit.
 */
export function DrawingTextDialog({
  isOpen,
  onClose,
  onSave,
  initialText = "",
  initialFontSize = 14,
  initialColor = "#ffffff",
  initialFillColor = "rgba(15, 23, 42, 0.85)",
  isEditing = false,
}: DrawingTextDialogProps) {
  const [text, setText] = useState<string>(initialText);
  const [fontSize, setFontSize] = useState<number>(initialFontSize);
  const [color, setColor] = useState<string>(initialColor);
  const [badgeStyle, setBadgeStyle] = useState<BadgeStyleType>(
    initialFillColor === "transparent"
      ? "none"
      : initialFillColor?.includes("22")
      ? "accent"
      : "dark",
  );

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [prevInitialText, setPrevInitialText] = useState(initialText);

  if (prevIsOpen !== isOpen || prevInitialText !== initialText) {
    setPrevIsOpen(isOpen);
    setPrevInitialText(initialText);
    if (isOpen) {
      setText(initialText);
      setFontSize(initialFontSize || 14);
      setColor(initialColor || "#ffffff");
      setBadgeStyle(
        initialFillColor === "transparent"
          ? "none"
          : initialFillColor?.includes("22")
          ? "accent"
          : "dark",
      );
    }
  }

  const handleSelectPreset = (preset: string) => {
    setText(preset);
  };

  const getComputedFillColor = (): string => {
    if (badgeStyle === "none") return "transparent";
    if (badgeStyle === "accent") return `${color}33`;
    return "rgba(15, 23, 42, 0.85)"; // dark background box
  };

  const handleSave = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    onSave({
      text: trimmed,
      fontSize,
      color,
      fillColor: getComputedFillColor(),
    });
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md p-5 bg-card/95 backdrop-blur-md border shadow-xl"
        data-testid="drawing-text-dialog"
      >
        <DialogHeader className="gap-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Type className="size-4" />
            </div>
            <DialogTitle className="text-base font-bold">
              {isEditing ? "Edit Label Catatan Teks" : "Tambah Label Catatan Teks"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Beri penanda teks untuk ODP, kabel putus, redaman tinggi, atau catatan operasional lapangan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Tag Preset Lapangan ISP */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="size-3 text-amber-500" />
              <span>Tag Cepat Operasional:</span>
            </Label>
            <div
              className="flex flex-wrap gap-1.5"
              data-testid="text-preset-tags"
            >
              {ISP_TEXT_PRESETS.map((preset) => {
                const slug = preset.toLowerCase().replace(/[^a-z0-9]/g, "-");
                return (
                  <Badge
                    key={preset}
                    variant="outline"
                    className="cursor-pointer text-[11px] px-2 py-0.5 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                    onClick={() => handleSelectPreset(preset)}
                    data-testid={`preset-tag-${slug}`}
                  >
                    {preset}
                  </Badge>
                );
              })}
            </div>
          </div>

          {/* Input Teks Catatan */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="text-input" className="text-xs font-semibold">
                Teks Label Anotasi
              </Label>
              <span className="text-[10px] text-muted-foreground">
                {text.length}/100 karakter
              </span>
            </div>
            <Input
              id="text-input"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 100))}
              onKeyDown={handleKeyDown}
              placeholder="Contoh: ODP-03 8 Core / Kabel Fiber Putus..."
              autoFocus
              className="h-9 text-xs"
              data-testid="text-annotation-input"
            />
          </div>

          {/* Pilihan Ukuran Font */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold">Ukuran Font</Label>
            <div
              className="grid grid-cols-4 gap-1.5"
              data-testid="text-font-size-group"
            >
              {FONT_SIZE_OPTIONS.map((opt) => (
                <Button
                  key={opt.size}
                  type="button"
                  variant={fontSize === opt.size ? "default" : "outline"}
                  size="sm"
                  className={`h-7 px-2 text-[11px] font-medium ${
                    fontSize === opt.size
                      ? "bg-primary text-primary-foreground"
                      : ""
                  }`}
                  onClick={() => setFontSize(opt.size)}
                  data-testid={`font-size-${opt.size}`}
                >
                  {opt.size}px
                </Button>
              ))}
            </div>
          </div>

          {/* Pilihan Gaya Latar Belakang (Badge Style) */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold">Gaya Kotak / Latar Badge</Label>
            <div
              className="grid grid-cols-3 gap-1.5"
              data-testid="text-bg-style-group"
            >
              <Button
                type="button"
                variant={badgeStyle === "dark" ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setBadgeStyle("dark")}
                data-testid="bg-style-dark"
                title="Kotak gelap transparan, paling kontras di atas peta satelit"
              >
                Kotak Gelap
              </Button>
              <Button
                type="button"
                variant={badgeStyle === "accent" ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setBadgeStyle("accent")}
                data-testid="bg-style-accent"
                title="Kotak transparan dengan aksen warna teks"
              >
                Kotak Aksen
              </Button>
              <Button
                type="button"
                variant={badgeStyle === "none" ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setBadgeStyle("none")}
                data-testid="bg-style-none"
                title="Teks murni tanpa kotak latar"
              >
                Transparan
              </Button>
            </div>
          </div>

          {/* Pratinjau Tampilan Nyata di Kanvas */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              Pratinjau Label Peta
            </Label>
            <div
              className="w-full min-h-[50px] p-3 rounded-lg border bg-neutral-900 flex items-center justify-center relative overflow-hidden"
              data-testid="text-live-preview"
            >
              <div
                className="px-2.5 py-1 rounded-sm border inline-flex items-center transition-all shadow-md"
                style={{
                  backgroundColor: getComputedFillColor(),
                  borderColor:
                    badgeStyle === "none"
                      ? "transparent"
                      : badgeStyle === "accent"
                      ? color
                      : "rgba(255,255,255,0.2)",
                  color,
                  fontSize: `${fontSize}px`,
                  fontWeight: "bold",
                }}
              >
                {text.trim() || "Pratinjau Catatan Teks"}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 text-xs"
            data-testid="cancel-text-btn"
          >
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!text.trim()}
            className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
            data-testid="save-text-btn"
          >
            <Check className="size-3.5" />
            <span>{isEditing ? "Perbarui Teks" : "Tambahkan ke Peta"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
