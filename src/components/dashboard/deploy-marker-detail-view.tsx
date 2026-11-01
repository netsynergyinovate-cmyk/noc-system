"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  HelpCircle,
  AlertCircle,
  Layers,
  Terminal,
  User,
  Clock,
  Code2,
  Compass,
  Cpu,
  Wrench,
  AlertTriangle,
  Send,
  Edit3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FeatureMarkerItem } from "./deploy-user-markers-tab";
import {
  generateTechnicalReport,
  type TechnicalReport,
} from "@/lib/deploy/feature-diagnostic-engine";
import type { FeatureMarkerStatus } from "@/validators/feature-markers";

const CATEGORY_MAP = {
  used_frequently: {
    label: "Sering Digunakan",
    color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    icon: Sparkles,
  },
  rarely_used: {
    label: "Jarang / Bingung",
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    icon: HelpCircle,
  },
  bug_issue: {
    label: "Kendala / Bug",
    color: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    icon: AlertCircle,
  },
  improvement: {
    label: "Usulan Perbaikan",
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    icon: Layers,
  },
};

const STATUS_MAP = {
  baru: {
    label: "Baru",
    color: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  },
  ditinjau: {
    label: "Ditinjau",
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  dikerjakan: {
    label: "Dikerjakan",
    color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  selesai: {
    label: "Selesai",
    color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
};

export function DeployMarkerDetailView({
  marker: initialMarker,
}: {
  marker: FeatureMarkerItem;
}) {
  const [marker, setMarker] = useState<FeatureMarkerItem>(initialMarker);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isCopiedPrompt, setIsCopiedPrompt] = useState(false);

  // Form State Developer Response
  const [status, setStatus] = useState<FeatureMarkerStatus>(marker.status);
  const [devNotes, setDevNotes] = useState(marker.developerNotes || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const report: TechnicalReport = generateTechnicalReport(marker);
  const CatIcon = CATEGORY_MAP[marker.category]?.icon || Sparkles;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(report.aiPrompt);
    setIsCopiedPrompt(true);
    setTimeout(() => setIsCopiedPrompt(false), 2500);
  };

  const handleSaveResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/feature-markers/${marker.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          developerNotes: devNotes.trim(),
        }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(errorJson?.error || `Gagal menyimpan (HTTP ${res.status})`);
      }

      const json = await res.json();
      if (json.data) {
        setMarker(json.data);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Gagal memperbarui status");
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* 1. Navigasi Kembali & Bar Aksi Cepat */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <Button
          variant="outline"
          size="sm"
          asChild
          className="text-xs h-8 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Link href="/app/deploy">
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke Deploy Dashboard
          </Link>
        </Button>

        <div className="flex items-center gap-2">
          {/* Tombol Salin Prompt Utama */}
          <Button
            type="button"
            size="sm"
            onClick={handleCopyPrompt}
            className={`text-xs h-8 gap-1.5 font-semibold transition-all shadow-md ${
              isCopiedPrompt
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-purple-600 text-white hover:bg-purple-700 animate-pulse"
            }`}
          >
            {isCopiedPrompt ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Prompt Perbaikan Tersalin!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Salin Prompt untuk Perbaikan
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="text-xs h-8 gap-1.5"
          >
            <Link href={marker.pagePath} target="_blank">
              <ExternalLink className="h-3.5 w-3.5 text-purple-500" />
              Buka Halaman Terkait
            </Link>
          </Button>
        </div>
      </div>

      {/* 2. Kartu Header Utama */}
      <div className="rounded-2xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant="outline"
              className={CATEGORY_MAP[marker.category]?.color || ""}
            >
              <CatIcon className="h-3 w-3 mr-1" />
              {CATEGORY_MAP[marker.category]?.label}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              📅 Frekuensi: {marker.frequency}
            </Badge>
            <Badge
              variant="outline"
              className={STATUS_MAP[marker.status]?.color || ""}
            >
              Status: {STATUS_MAP[marker.status]?.label}
            </Badge>
            <Badge variant="outline" className="bg-muted text-foreground">
              {report.context.featureDomain}
            </Badge>
            <Badge
              variant="outline"
              className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
            >
              {report.context.complexity}
            </Badge>
          </div>

          <span className="text-xs text-muted-foreground flex items-center gap-1.5 font-mono">
            <Clock className="h-3.5 w-3.5" />
            {formatDate(marker.createdAt)}
          </span>
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {marker.featureName}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 font-mono">
            <span>Rute Halaman:</span>
            <Link
              href={marker.pagePath}
              target="_blank"
              className="text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
            >
              {marker.pagePath}
              <ExternalLink className="h-2.5 w-2.5" />
            </Link>
            {marker.pageTitle && (
              <span>• {marker.pageTitle}</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Grid 2 Kolom: Masukan Pengguna & Diagnostik Elemen */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* Kolom 1: Catatan Pengguna */}
        <div className="rounded-xl border bg-card p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5 text-xs">
              <User className="h-4 w-4" />
              Masukan & Keluhan Pengguna
            </span>
            <span className="text-[11px] text-muted-foreground">
              {marker.userEmail} ({marker.userRole})
            </span>
          </div>

          <div className="rounded-xl border-l-4 border-purple-500 bg-purple-500/10 p-4">
            <p className="text-sm font-medium text-foreground italic leading-relaxed whitespace-pre-wrap">
              "{marker.notes || "(Pengguna tidak menyertakan catatan teks tambahan)"}"
            </p>
          </div>

          {marker.elementText && (
            <div className="rounded-lg bg-muted/30 border p-3">
              <span className="text-[10px] uppercase font-bold text-muted-foreground block mb-1">
                Cuplikan Teks Elemen yang Diklik:
              </span>
              <p className="font-mono text-xs text-foreground/90">
                "{marker.elementText}"
              </p>
            </div>
          )}
        </div>

        {/* Kolom 2: Diagnostik Elemen DOM */}
        <div className="rounded-xl border bg-card p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5 text-xs">
              <Code2 className="h-4 w-4" />
              Diagnostik Elemen DOM
            </span>
            <Badge variant="outline" className="text-xs">
              {report.context.elementType}
            </Badge>
          </div>

          <div className="space-y-2.5 font-mono text-xs">
            <div>
              <span className="text-muted-foreground font-sans block text-[11px]">
                Selector CSS Lengkap:
              </span>
              <div className="flex items-center justify-between rounded bg-muted/40 p-2 mt-0.5 border">
                <code className="text-xs text-purple-600 dark:text-purple-400 break-all font-semibold">
                  {marker.elementSelector || "(Seluruh Halaman)"}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(marker.elementSelector || "", "sel")}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  {copiedKey === "sel" ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>

            {report.context.modalName && (
              <div>
                <span className="text-muted-foreground font-sans block text-[11px]">
                  Konteks Pop-up / Dialog:
                </span>
                <div className="rounded bg-amber-500/10 border border-amber-500/20 p-2 text-amber-700 dark:text-amber-300 font-sans font-semibold mt-0.5">
                  {report.context.modalName}
                </div>
              </div>
            )}

            <div>
              <span className="text-muted-foreground font-sans block text-[11px]">
                Tingkat Kompleksitas Perbaikan:
              </span>
              <span className="font-sans text-xs text-foreground font-semibold">
                {report.context.complexity}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Bagian PETA BERKAS KODE (SOURCE MAP) */}
      <div className="rounded-2xl border bg-card p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b pb-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-2">
              <Compass className="h-4 w-4" />
              Peta Lokasi Berkas Kode (Source Map)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daftar file spesifik di repositori yang bertanggung jawab atas halaman, komponen, API, dan basis data fitur ini.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
          {/* File Halaman Utama */}
          <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">
              1. Berkas Halaman (Page Route):
            </span>
            <div className="flex items-center justify-between rounded-lg bg-background p-2.5 border">
              <code className="text-xs font-mono font-semibold text-foreground truncate">
                {report.sourceMap.pageFile}
              </code>
              <button
                type="button"
                onClick={() => handleCopy(report.sourceMap.pageFile, "page")}
                className="p-1 text-muted-foreground hover:text-foreground"
                title="Salin path file"
              >
                {copiedKey === "page" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Entrypoint Next.js App Router yang merender tampilan rute ini.
            </p>
          </div>

          {/* File Komponen UI */}
          <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">
              2. Berkas Komponen UI:
            </span>
            <div className="flex items-center justify-between rounded-lg bg-background p-2.5 border">
              <code className="text-xs font-mono font-semibold text-foreground truncate">
                {report.sourceMap.componentFiles[0] || "src/components/dashboard/..."}
              </code>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    report.sourceMap.componentFiles[0] || "",
                    "comp",
                  )
                }
                className="p-1 text-muted-foreground hover:text-foreground"
                title="Salin path file"
              >
                {copiedKey === "comp" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Komponen React yang menggambar tombol, tabel, atau dialog pop-up.
            </p>
          </div>

          {/* Endpoint API Backend */}
          <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">
              3. Endpoint API Backend:
            </span>
            <div className="flex items-center justify-between rounded-lg bg-background p-2.5 border">
              <code className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400 truncate">
                {report.sourceMap.apiEndpoints[0] || "/api/..."}
              </code>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    report.sourceMap.apiEndpoints[0] || "",
                    "api",
                  )
                }
                className="p-1 text-muted-foreground hover:text-foreground"
                title="Salin endpoint API"
              >
                {copiedKey === "api" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Route handler server-side yang menangani permintaan HTTP fetch.
            </p>
          </div>

          {/* File Service & Basis Data */}
          <div className="rounded-xl border bg-muted/20 p-3.5 space-y-1.5">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">
              4. Service & Database Layer:
            </span>
            <div className="flex items-center justify-between rounded-lg bg-background p-2.5 border">
              <code className="text-xs font-mono font-semibold text-foreground truncate">
                {report.sourceMap.serviceFiles[0] || "src/services/..."}
              </code>
              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    report.sourceMap.serviceFiles[0] || "",
                    "srv",
                  )
                }
                className="p-1 text-muted-foreground hover:text-foreground"
                title="Salin path service"
              >
                {copiedKey === "srv" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Fungsi backend Drizzle ORM / integrasi driver perangkat fisik.
            </p>
          </div>
        </div>

        {/* Callout Fungsi Runtime */}
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4 text-xs flex items-start gap-3">
          <Cpu className="h-5 w-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-purple-700 dark:text-purple-300">
              Fungsi Runtime yang Dieksekusi:
            </h4>
            <code className="font-mono text-xs text-foreground block bg-background/80 p-2 rounded border">
              {report.runtimeFunctionSummary}
            </code>
            {report.sourceMap.hardwareOrExternalSystem && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Sistem Terkait:{" "}
                <strong className="text-foreground">
                  {report.sourceMap.hardwareOrExternalSystem}
                </strong>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 5. Bagian PANDUAN LANGKAH PERBAIKAN TEKNIS (REMEDIATION CHECKLIST) */}
      <div className="rounded-2xl border bg-card p-6 shadow-xs space-y-4">
        <div className="border-b pb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Langkah-Langkah Investigasi & Cara Perbaikan Developer
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Checklist sistematis yang memandu developer memperbaiki bug atau mengoptimasi fitur ini.
          </p>
        </div>

        <div className="space-y-3">
          {report.remediationChecklist.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl border bg-muted/20 p-4 text-xs space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-sm text-foreground">
                  {item.step}
                </span>
                <code className="text-xs font-mono text-purple-600 dark:text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                  {item.targetFile}
                </code>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {item.action}
              </p>
              {item.codeHint && (
                <div className="relative rounded-lg bg-background p-3 border font-mono text-xs text-foreground/90 overflow-x-auto">
                  <pre>{item.codeHint}</pre>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Tips Khusus Kategori */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs space-y-2">
          <span className="font-bold text-sm text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            Rekomendasi Penanganan Spesifik:
          </span>
          <ul className="list-disc list-inside space-y-1.5 text-xs text-muted-foreground">
            {report.troubleshootingGuidance.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>

        {/* Perintah CLI Verifikasi Server */}
        {report.cliVerificationCommand && (
          <div className="rounded-xl bg-muted/40 border p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 truncate">
              <Terminal className="h-4 w-4 text-muted-foreground shrink-0" />
              <code className="font-mono text-xs text-foreground truncate">
                {report.cliVerificationCommand}
              </code>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleCopy(report.cliVerificationCommand || "", "cli")}
              className="text-xs h-7 gap-1"
            >
              {copiedKey === "cli" ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  Tersalin
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Salin CLI
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* 6. Bagian KOTAK PROMPT AI UNTUK PERBAIKAN (SIAP DITEMPEL KE AI) */}
      <div className="rounded-2xl border-2 border-purple-500/40 bg-purple-500/5 p-6 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-purple-500/20 pb-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Prompt AI Siap Salin untuk Perbaikan Otomatis
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Salin prompt lengkap ini dan tempelkan ke <strong>Claude Code</strong>, <strong>ChatGPT</strong>, atau <strong>Cursor</strong> untuk langsung memperbaiki kendala atau mengembangkan fitur ini.
            </p>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={handleCopyPrompt}
            className={`text-xs h-8 gap-1.5 font-semibold transition-all shrink-0 ${
              isCopiedPrompt
                ? "bg-emerald-600 text-white"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }`}
          >
            {isCopiedPrompt ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Prompt Berhasil Disalin!
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Salin Prompt Perbaikan
              </>
            )}
          </Button>
        </div>

        {/* Kotak Teks Prompt */}
        <div className="rounded-xl border border-border/80 bg-background/95 p-4 font-mono text-xs text-foreground/90 max-h-72 overflow-y-auto space-y-1">
          <pre className="whitespace-pre-wrap leading-relaxed">
            {report.aiPrompt}
          </pre>
        </div>
      </div>

      {/* 7. Bagian FORM TINDAK LANJUT DEVELOPER & PERBARUI STATUS */}
      <div className="rounded-2xl border bg-card p-6 shadow-xs space-y-4">
        <div className="border-b pb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
            <Edit3 className="h-4 w-4 text-purple-600" />
            Tindak Lanjut & Pembaruan Status Developer
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Perbarui status pengerjaan atau tambahkan respon catatan teknis developer untuk laporan ini.
          </p>
        </div>

        {saveSuccess && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>✓ Perubahan status dan catatan developer berhasil disimpan!</span>
          </div>
        )}

        <form onSubmit={handleSaveResponse} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold block mb-1.5">
                Ubah Status Alur Kerja
              </Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as FeatureMarkerStatus)}
                className="w-full text-xs h-9 rounded-md border border-input bg-background px-3 font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
              >
                <option value="baru">Baru</option>
                <option value="ditinjau">Ditinjau</option>
                <option value="dikerjakan">Dikerjakan</option>
                <option value="selesai">Selesai</option>
              </select>
            </div>

            <div>
              <Label className="text-xs font-semibold block mb-1.5">
                Status Saat Ini:
              </Label>
              <div className="h-9 flex items-center">
                <Badge
                  variant="outline"
                  className={`text-xs ${STATUS_MAP[marker.status]?.color || ""}`}
                >
                  {STATUS_MAP[marker.status]?.label}
                </Badge>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="devNotesFull" className="text-xs font-semibold block mb-1.5">
              Catatan Developer / Solusi yang Diterapkan
            </Label>
            <textarea
              id="devNotesFull"
              value={devNotes}
              onChange={(e) => setDevNotes(e.target.value)}
              rows={4}
              placeholder="Contoh: Sudah diperbaiki di commit #abc atau alur query dioptimasi pada versi v1.3.0..."
              className="w-full rounded-md border border-input bg-background p-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button
              type="submit"
              size="sm"
              disabled={isSaving}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5 font-semibold px-4 h-9"
            >
              <Send className="h-3.5 w-3.5" />
              {isSaving ? "Menyimpan..." : "Simpan Respon & Status"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
