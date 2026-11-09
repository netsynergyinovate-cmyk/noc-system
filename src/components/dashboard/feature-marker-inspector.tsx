"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Crosshair,
  MapPin,
  X,
  Send,
  CheckCircle2,
  Sparkles,
  AlertCircle,
  HelpCircle,
  Layers,
} from "lucide-react";
import { selectRole, selectUser } from "@/lib/session-store";
import { useSession } from "@/components/session-provider";
import { roleLabel } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  FeatureMarkerCategory,
  FeatureMarkerFrequency,
} from "@/validators/feature-markers";

interface HoveredBox {
  top: number;
  left: number;
  width: number;
  height: number;
  tag: string;
  label: string;
}

export function FeatureMarkerInspector() {
  const sessionUser = useSession(selectUser);
  const sessionRole = useSession(selectRole);

  const [mounted, setMounted] = useState(false);
  const [isInspectorActive, setIsInspectorActive] = useState(false);
  const [hoveredBox, setHoveredBox] = useState<HoveredBox | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Form State
  const [pagePath, setPagePath] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [elementSelector, setElementSelector] = useState("");
  const [elementText, setElementText] = useState("");
  const [featureName, setFeatureName] = useState("");
  const [category, setCategory] =
    useState<FeatureMarkerCategory>("used_frequently");
  const [frequency, setFrequency] = useState<FeatureMarkerFrequency>("daily");
  const [notes, setNotes] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hoveredElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper untuk membuat selector CSS ringkas yang mudah dibaca
  const getCleanSelector = (el: HTMLElement): string => {
    let selector = el.tagName.toLowerCase();
    if (el.id) {
      selector += `#${el.id}`;
    } else if (el.classList && el.classList.length > 0) {
      const meaningfulClasses = Array.from(el.classList).filter(
        (cls) =>
          !cls.includes(":") &&
          !cls.startsWith("data-") &&
          !cls.startsWith("lucide") &&
          cls.length < 24,
      );
      if (meaningfulClasses.length > 0) {
        selector += `.${meaningfulClasses.slice(0, 2).join(".")}`;
      }
    }
    return selector;
  };

  // Helper untuk mengambil nama label/teks ringkas dari elemen
  const getElementLabel = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();

    const title = el.getAttribute("title");
    if (title) return title.trim();

    const inner = (el.innerText || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (inner && inner.length <= 40) return inner;
    if (inner && inner.length > 40) return `${inner.slice(0, 37)}...`;

    return el.tagName.toLowerCase();
  };

  const handleOpenMarkerModal = useCallback((targetEl?: HTMLElement | null) => {
    const currentPath = window.location.pathname || "/app";
    const currentTitle = document.title || "Aplikasi NOC";

    setPagePath(currentPath);
    setPageTitle(currentTitle);
    setErrorMsg(null);

    if (targetEl) {
      const selector = getCleanSelector(targetEl);
      const label = getElementLabel(targetEl);
      const rawText = (targetEl.innerText || targetEl.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

      setElementSelector(selector);
      setElementText(rawText);

      const tag = targetEl.tagName.toLowerCase();
      let defaultName = label;
      if (tag === "button" || targetEl.getAttribute("role") === "button") {
        defaultName = `Tombol ${label}`;
      } else if (tag === "table" || targetEl.closest("table")) {
        defaultName = `Tabel ${currentTitle}`;
      } else if (tag === "form") {
        defaultName = `Formulir ${currentTitle}`;
      }

      // Deteksi jika elemen berada di dalam pop-up / dialog yang sedang terbuka
      const dialogParent = targetEl.closest(
        "[role='dialog'], [data-slot='dialog-content'], .dialog-content",
      );
      if (dialogParent) {
        const dialogHeading = dialogParent.querySelector(
          "h1, h2, h3, [data-slot='dialog-title'], [role='heading']",
        );
        const popupTitle = dialogHeading?.textContent?.trim();
        if (popupTitle) {
          defaultName = `[Pop-up: ${popupTitle}] ${defaultName}`;
        } else {
          defaultName = `[Pop-up] ${defaultName}`;
        }
      }

      setFeatureName(defaultName || `Fungsi pada ${currentPath}`);
    } else {
      // Mode tandai seluruh halaman
      setElementSelector("halaman-penuh");
      setElementText(
        `Halaman ${currentTitle} (${currentPath}) secara keseluruhan`,
      );
      setFeatureName(`Halaman ${currentTitle}`);
    }

    setIsInspectorActive(false);
    setHoveredBox(null);
    setIsDialogOpen(true);
  }, []);

  // Shortcut keyboard global: Ctrl + ~ (atau Ctrl + `)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "~" || e.key === "`" || e.code === "Backquote")
      ) {
        e.preventDefault();
        e.stopPropagation();
        setIsInspectorActive((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, []);

  // Listener jika tombol Tandai Fitur diklik dari menu sidebar
  useEffect(() => {
    const handleTrigger = () => {
      setIsInspectorActive(true);
    };
    window.addEventListener("open-feature-marker-inspector", handleTrigger);
    return () => {
      window.removeEventListener(
        "open-feature-marker-inspector",
        handleTrigger,
      );
    };
  }, []);

  // Listener saat mode inspeksi aktif
  useEffect(() => {
    if (!isInspectorActive) {
      setHoveredBox(null);
      return;
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Abaikan elemen UI milik inspector sendiri
      if (target.closest("[data-feature-inspector]")) {
        setHoveredBox(null);
        return;
      }

      hoveredElementRef.current = target;
      const rect = target.getBoundingClientRect();
      const label = getElementLabel(target);

      setHoveredBox({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        tag: target.tagName.toLowerCase(),
        label,
      });
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      if (target.closest("[data-feature-inspector]")) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      handleOpenMarkerModal(target);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsInspectorActive(false);
        setHoveredBox(null);
      }
    };

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isInspectorActive, handleOpenMarkerModal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!featureName.trim()) {
      setErrorMsg("Nama fitur atau fungsi wajib diisi.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/feature-markers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pagePath,
          pageTitle,
          elementSelector,
          elementText,
          featureName: featureName.trim(),
          category,
          frequency,
          notes: notes.trim(),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          errorData?.message ||
            errorData?.error ||
            `Gagal mengirim tanda (HTTP ${res.status})`,
        );
      }

      setIsDialogOpen(false);
      setNotes("");
      setSuccessToast(
        "✓ Tanda fitur berhasil dikirim ke developer di halaman deploy!",
      );
      setTimeout(() => setSuccessToast(null), 6000);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Terjadi kesalahan saat menyimpan.";
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <>
      {/* 1. TOAST SUKSES RINGKAS */}
      {successToast && (
        <div
          data-feature-inspector="toast"
          className="fixed bottom-6 right-6 z-[999999] flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-3 text-sm font-medium text-emerald-200 shadow-2xl backdrop-blur-md transition-all animate-in fade-in-0 slide-in-from-bottom-2"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{successToast}</span>
          <button
            type="button"
            onClick={() => setSuccessToast(null)}
            className="ml-2 text-emerald-400 hover:text-emerald-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 2. BANNER AKTIF DI ATAS VIEWPORT (Selalu di atas modal/pop-up) */}
      {isInspectorActive && (
        <div
          data-feature-inspector="banner"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[999999] flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-purple-500 bg-background/95 px-5 py-3 shadow-[0_10px_35px_rgba(0,0,0,0.7)] backdrop-blur-md text-foreground max-w-[95vw] md:max-w-2xl animate-in fade-in-0 slide-in-from-top-3"
        >
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-600" />
            </span>
            <div className="text-xs">
              <p className="font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                Mode Penandaan Fitur Aktif
                <span className="rounded bg-purple-500/20 px-1 py-0.5 font-mono text-[10px] text-purple-600 dark:text-purple-300">
                  Ctrl + ~
                </span>
              </p>
              <p className="text-muted-foreground text-[11px]">
                Arahkan kursor & klik elemen, badge, atau pop-up apa saja yang
                ingin ditandai untuk developer.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => handleOpenMarkerModal(null)}
              className="text-xs h-8 gap-1.5"
            >
              <Layers className="h-3.5 w-3.5 text-purple-500" />
              Tandai Seluruh Halaman
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsInspectorActive(false);
                setHoveredBox(null);
              }}
              className="text-xs h-8 text-muted-foreground hover:text-foreground"
            >
              Batal (Esc)
            </Button>
          </div>
        </div>
      )}

      {/* 3. VISUAL BOX SOROTAN ELEMEN (Render di atas pop-up mana saja) */}
      {isInspectorActive && hoveredBox && (
        <div
          data-feature-inspector="box"
          style={{
            position: "fixed",
            top: `${hoveredBox.top}px`,
            left: `${hoveredBox.left}px`,
            width: `${hoveredBox.width}px`,
            height: `${hoveredBox.height}px`,
            pointerEvents: "none",
            zIndex: 999998,
          }}
          className="border-2 border-dashed border-purple-500 bg-purple-500/20 rounded shadow-[0_0_20px_rgba(168,85,247,0.6)] transition-all duration-75"
        >
          <span className="absolute -top-6 left-0 bg-purple-600 text-white text-[11px] font-mono px-2 py-0.5 rounded shadow-lg whitespace-nowrap">
            {`<${hoveredBox.tag}> ${hoveredBox.label}`}
          </span>
        </div>
      )}

      {/* 4. MODAL FORM PENANDAAN FITUR (Portal Mandiri z-[999999], tidak berbenturan dengan fokus dialog bawahnya) */}
      {isDialogOpen && (
        <div
          data-feature-inspector="modal-backdrop"
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs animate-in fade-in-0"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsDialogOpen(false);
          }}
        >
          <div
            data-feature-inspector="modal"
            className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xl animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-border/60 pb-3 mb-4">
              <div>
                <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 mb-1">
                  <MapPin className="h-5 w-5" />
                  <h3 className="text-lg font-bold">
                    Tandai Fitur untuk Developer
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Beri tahu tim pengembang bagaimana fitur/fungsi ini digunakan
                  di lapangan, seberapa sering dipakai, kendala, atau saran
                  perbaikan Anda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDialogOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMsg && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Lokasi Halaman & Selektor Terdeteksi */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    Lokasi Halaman
                  </Label>
                  <div className="mt-1 rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] truncate">
                    {pagePath}
                  </div>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">
                    Elemen Terdeteksi
                  </Label>
                  <div className="mt-1 rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] truncate">
                    {elementSelector || "(Seluruh Halaman)"}
                  </div>
                </div>
              </div>

              {/* Cuplikan Teks Elemen */}
              {elementText && (
                <div className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
                  <span className="text-[10px] text-muted-foreground block mb-0.5 font-semibold">
                    Cuplikan Elemen:
                  </span>
                  <p className="text-[11px] text-foreground/80 line-clamp-2 italic">
                    "{elementText}"
                  </p>
                </div>
              )}

              {/* Nama Fitur / Fungsi */}
              <div>
                <Label htmlFor="featureName" className="text-xs font-semibold">
                  Nama Fitur / Fungsi <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="featureName"
                  value={featureName}
                  onChange={(e) => setFeatureName(e.target.value)}
                  placeholder="Contoh: Tombol Reboot CPE di Pop-up Pengaturan"
                  required
                  className="mt-1.5 text-xs h-9"
                />
              </div>

              {/* Kategori Penggunaan */}
              <div>
                <Label className="text-xs font-semibold block mb-1.5">
                  Kategori Tanda Fitur
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCategory("used_frequently")}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                      category === "used_frequently"
                        ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/50"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <Sparkles className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        Sering Digunakan
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Fitur andalan operasional harian
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategory("rarely_used")}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                      category === "rarely_used"
                        ? "border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/50"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <HelpCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        Jarang / Bingung
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Jarang terpakai atau membingungkan
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategory("bug_issue")}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                      category === "bug_issue"
                        ? "border-red-500 bg-red-500/10 ring-1 ring-red-500/50"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                        Kendala / Bug
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Ada error atau hasil tidak sesuai
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategory("improvement")}
                    className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                      category === "improvement"
                        ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/50"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <Layers className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        Usulan Perbaikan
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Saran penambahan atau penyempurnaan
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Frekuensi Penggunaan */}
              <div>
                <Label className="text-xs font-semibold block mb-1.5">
                  Frekuensi Penggunaan Anda
                </Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: "daily", label: "Setiap Hari" },
                    { id: "weekly", label: "Mingguan" },
                    { id: "monthly", label: "Bulanan" },
                    { id: "occasional", label: "Jarang / Kasus Tertentu" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setFrequency(item.id as FeatureMarkerFrequency)
                      }
                      className={`rounded-md border py-1.5 px-2 text-center text-[11px] transition-all ${
                        frequency === item.id
                          ? "border-purple-500 bg-purple-500/15 font-semibold text-purple-600 dark:text-purple-300"
                          : "border-border text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Catatan / Keterangan Pengguna */}
              <div>
                <Label htmlFor="notes" className="text-xs font-semibold">
                  Catatan & Masukan Anda untuk Developer
                </Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Jelaskan kebutuhan, cara penggunaan Anda, atau perbaikan yang diharapkan..."
                  className="mt-1.5 w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>

              {/* Informasi Pengirim */}
              <div className="rounded-lg bg-muted/30 border border-border/40 p-2.5 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Dikirim sebagai:</span>
                <span className="font-medium text-foreground">
                  {sessionUser?.email || "Pengguna"}{" "}
                  <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400 font-semibold uppercase">
                    ({roleLabel(sessionRole)})
                  </span>
                </span>
              </div>

              {/* Tombol Aksi */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDialogOpen(false)}
                  disabled={isSubmitting}
                  className="text-xs"
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5 font-medium"
                >
                  <Send className="h-3.5 w-3.5" />
                  {isSubmitting ? "Mengirim..." : "Kirim Tanda ke Developer"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
