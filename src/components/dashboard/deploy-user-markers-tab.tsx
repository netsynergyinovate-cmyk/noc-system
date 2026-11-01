"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  BookmarkPlus,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Sparkles,
  Layers,
  Clock,
  User,
  ExternalLink,
  MessageSquare,
  Trash2,
  Edit3,
  AlertTriangle,
  FileCode,
  Wrench,
  Code2,
  Terminal,
  Check,
  Copy,
  Cpu,
  FileText,
  Compass,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  FeatureMarkerCategory,
  FeatureMarkerFrequency,
  FeatureMarkerStatus,
} from "@/validators/feature-markers";
import {
  generateTechnicalReport,
  type TechnicalReport,
} from "@/lib/deploy/feature-diagnostic-engine";

export interface FeatureMarkerItem {
  id: string;
  userId: string;
  userEmail: string;
  userRole: string;
  pagePath: string;
  pageTitle: string;
  elementSelector: string;
  elementText: string;
  featureName: string;
  category: FeatureMarkerCategory;
  frequency: FeatureMarkerFrequency;
  notes: string;
  status: FeatureMarkerStatus;
  developerNotes: string;
  createdAt: string;
  updatedAt: string;
}

interface FeatureMarkerStats {
  total: number;
  frequentlyUsed: number;
  rarelyUsed: number;
  bugIssues: number;
  improvements: number;
  unreviewed: number;
}

interface DeployUserMarkersTabProps {
  serverUrl?: string;
  monitorToken?: string;
  onCountChange?: (count: number) => void;
}

const CATEGORY_MAP: Record<
  FeatureMarkerCategory,
  { label: string; color: string; icon: typeof Sparkles }
> = {
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

const FREQUENCY_LABELS: Record<FeatureMarkerFrequency, string> = {
  daily: "Setiap Hari",
  weekly: "Mingguan",
  monthly: "Bulanan",
  occasional: "Situasional",
};

const STATUS_MAP: Record<
  FeatureMarkerStatus,
  { label: string; color: string }
> = {
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

export function DeployUserMarkersTab({
  serverUrl = "",
  monitorToken = "",
  onCountChange,
}: DeployUserMarkersTabProps) {
  const [markers, setMarkers] = useState<FeatureMarkerItem[]>([]);
  const [stats, setStats] = useState<FeatureMarkerStats>({
    total: 0,
    frequentlyUsed: 0,
    rarelyUsed: 0,
    bugIssues: 0,
    improvements: 0,
    unreviewed: 0,
  });
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [selectedPage, setSelectedPage] = useState<string>("all");

  // Modal Laporan Teknis Lengkap & Rekomendasi
  const [selectedReportMarker, setSelectedReportMarker] =
    useState<FeatureMarkerItem | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  const handleDirectCopyPrompt = (m: FeatureMarkerItem) => {
    const rep = generateTechnicalReport(m);
    navigator.clipboard.writeText(rep.aiPrompt);
    setCopiedPromptId(m.id);
    setTimeout(() => setCopiedPromptId(null), 2500);
  };

  // Dialog Edit Catatan Developer & Status
  const [editMarker, setEditMarker] = useState<FeatureMarkerItem | null>(null);
  const [editStatus, setEditStatus] = useState<FeatureMarkerStatus>("baru");
  const [editDevNotes, setEditDevNotes] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Alert Dialog Hapus
  const [deleteTarget, setDeleteTarget] = useState<FeatureMarkerItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchMarkers = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      let url = "/api/deploy/feature-markers?limit=200";
      if (serverUrl) {
        url += `&url=${encodeURIComponent(serverUrl)}`;
        if (monitorToken) {
          url += `&token=${encodeURIComponent(monitorToken)}`;
        }
      }

      const res = await fetch(url);
      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(
          errorJson?.error ||
            `Gagal memuat tanda fitur pengguna (HTTP ${res.status})`,
        );
      }

      const json = await res.json();
      const loadedMarkers: FeatureMarkerItem[] = json.data || [];
      const loadedStats: FeatureMarkerStats = json.stats || {
        total: loadedMarkers.length,
        frequentlyUsed: 0,
        rarelyUsed: 0,
        bugIssues: 0,
        improvements: 0,
        unreviewed: 0,
      };

      setMarkers(loadedMarkers);
      setStats(loadedStats);
      if (onCountChange) {
        onCountChange(loadedStats.total);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Kesalahan memuat tanda fitur.";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, monitorToken, onCountChange]);

  useEffect(() => {
    fetchMarkers();
  }, [fetchMarkers]);

  // Unique list of page paths for filtering
  const uniquePages = useMemo(() => {
    const set = new Set<string>();
    markers.forEach((m) => {
      if (m.pagePath) set.add(m.pagePath);
    });
    return Array.from(set).sort();
  }, [markers]);

  // Filtered markers
  const filteredMarkers = useMemo(() => {
    return markers.filter((m) => {
      if (selectedCategory !== "all" && m.category !== selectedCategory) {
        return false;
      }
      if (selectedStatus !== "all" && m.status !== selectedStatus) {
        return false;
      }
      if (selectedRole !== "all" && m.userRole !== selectedRole) {
        return false;
      }
      if (selectedPage !== "all" && m.pagePath !== selectedPage) {
        return false;
      }
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchName = m.featureName.toLowerCase().includes(query);
        const matchNotes = m.notes.toLowerCase().includes(query);
        const matchEmail = m.userEmail.toLowerCase().includes(query);
        const matchElement = m.elementText.toLowerCase().includes(query);
        const matchDev = m.developerNotes.toLowerCase().includes(query);
        if (!matchName && !matchNotes && !matchEmail && !matchElement && !matchDev) {
          return false;
        }
      }
      return true;
    });
  }, [markers, selectedCategory, selectedStatus, selectedRole, selectedPage, search]);

  // Diagnostic Report untuk marker yang sedang dibuka detailnya
  const diagnosticReport: TechnicalReport | null = useMemo(() => {
    if (!selectedReportMarker) return null;
    return generateTechnicalReport(selectedReportMarker);
  }, [selectedReportMarker]);

  const handleOpenEdit = (marker: FeatureMarkerItem) => {
    setEditMarker(marker);
    setEditStatus(marker.status);
    setEditDevNotes(marker.developerNotes || "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMarker) return;

    setIsUpdating(true);
    try {
      let url = `/api/deploy/feature-markers?id=${encodeURIComponent(editMarker.id)}`;
      if (serverUrl) {
        url += `&url=${encodeURIComponent(serverUrl)}`;
        if (monitorToken) {
          url += `&token=${encodeURIComponent(monitorToken)}`;
        }
      }

      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: editStatus,
          developerNotes: editDevNotes,
        }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(
          errorJson?.error || `Gagal menyimpan pembaruan (HTTP ${res.status})`,
        );
      }

      // Update locally
      setMarkers((prev) =>
        prev.map((m) =>
          m.id === editMarker.id
            ? { ...m, status: editStatus, developerNotes: editDevNotes }
            : m,
        ),
      );
      if (selectedReportMarker?.id === editMarker.id) {
        setSelectedReportMarker({
          ...selectedReportMarker,
          status: editStatus,
          developerNotes: editDevNotes,
        });
      }
      setEditMarker(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal memperbarui status";
      alert(msg);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      let url = `/api/deploy/feature-markers?id=${encodeURIComponent(deleteTarget.id)}`;
      if (serverUrl) {
        url += `&url=${encodeURIComponent(serverUrl)}`;
        if (monitorToken) {
          url += `&token=${encodeURIComponent(monitorToken)}`;
        }
      }

      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(
          errorJson?.error || `Gagal menghapus tanda (HTTP ${res.status})`,
        );
      }

      setMarkers((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      if (selectedReportMarker?.id === deleteTarget.id) {
        setSelectedReportMarker(null);
      }
      setDeleteTarget(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menghapus";
      alert(msg);
    } finally {
      setIsDeleting(false);
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Deskripsi Tab */}
      <div className="rounded-xl border bg-card p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
              >
                Telemetri Lapangan & Diagnostik Kode
              </Badge>
              {serverUrl && (
                <span className="text-[11px] font-mono text-muted-foreground truncate max-w-xs">
                  Proxy: {serverUrl}
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold mt-2">
              Tanda Fitur, Fungsi & Diagnostik Teknis
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-3xl">
              Memantau fitur dan fungsi yang aktif digunakan di lapangan. Dilengkapi <strong>Source Mapping Otomatis</strong>: memetakan lokasi berkas komponen, endpoint API, fungsi runtime yang berjalan, serta langkah perbaikan terperinci untuk developer meskipun catatan pengguna singkat.
            </p>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={fetchMarkers}
            className="text-xs h-8 gap-1.5 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Segarkan Data
          </Button>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchMarkers}
              className="text-xs h-7"
            >
              Coba Lagi
            </Button>
          </div>
        )}

        {/* 2. Empat Kartu Metrik Ringkas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="rounded-lg border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>Total Tanda Masuk</span>
              <BookmarkPlus className="h-4 w-4 text-purple-500" />
            </div>
            <p className="text-2xl font-bold mt-1.5">{stats.total}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Elemen & fungsi ditandai
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>Sering Digunakan</span>
              <Sparkles className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold mt-1.5 text-emerald-600 dark:text-emerald-400">
              {stats.frequentlyUsed}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Fitur rutin operasional
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>Kendala / Bug</span>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-2xl font-bold mt-1.5 text-red-600 dark:text-red-400">
              {stats.bugIssues}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Laporan kendala fungsi
            </p>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3.5">
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>Belum Ditinjau</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold mt-1.5 text-amber-600 dark:text-amber-400">
              {stats.unreviewed}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Menunggu respon developer
            </p>
          </div>
        </div>

        {/* 3. Toolbar Pencarian & Filter */}
        <div className="mt-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 border-t pt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama fitur, catatan pengguna, cuplikan teks elemen, atau email..."
              className="text-xs pl-8 h-9 bg-background"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="text-xs h-9 rounded-md border border-input bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              <option value="all">Semua Kategori</option>
              <option value="used_frequently">Sering Digunakan</option>
              <option value="rarely_used">Jarang / Bingung</option>
              <option value="bug_issue">Kendala / Bug</option>
              <option value="improvement">Usulan Perbaikan</option>
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="text-xs h-9 rounded-md border border-input bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              <option value="all">Semua Status</option>
              <option value="baru">Baru</option>
              <option value="ditinjau">Ditinjau</option>
              <option value="dikerjakan">Dikerjakan</option>
              <option value="selesai">Selesai</option>
            </select>

            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="text-xs h-9 rounded-md border border-input bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              <option value="all">Semua Peran</option>
              <option value="superadmin">Super Admin</option>
              <option value="admin">Admin</option>
              <option value="user">Petugas / User</option>
            </select>

            {uniquePages.length > 0 && (
              <select
                value={selectedPage}
                onChange={(e) => setSelectedPage(e.target.value)}
                className="text-xs h-9 rounded-md border border-input bg-background px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500 max-w-[150px] truncate"
              >
                <option value="all">Semua Halaman</option>
                {uniquePages.map((page) => (
                  <option key={page} value={page}>
                    {page}
                  </option>
                ))}
              </select>
            )}

            {(search ||
              selectedCategory !== "all" ||
              selectedStatus !== "all" ||
              selectedRole !== "all" ||
              selectedPage !== "all") && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setSelectedCategory("all");
                  setSelectedStatus("all");
                  setSelectedRole("all");
                  setSelectedPage("all");
                }}
                className="text-xs h-9 text-muted-foreground hover:text-foreground"
              >
                Reset Filter
              </Button>
            )}
          </div>
        </div>

        {/* 4. Daftar Kartu Tanda Fitur */}
        <div className="mt-4 space-y-3">
          {loading && markers.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-purple-500" />
              <span>Memuat data tanda fitur dari database...</span>
            </div>
          ) : filteredMarkers.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-xs text-muted-foreground">
              <BookmarkPlus className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
              <p className="font-semibold text-foreground">
                {markers.length === 0
                  ? "Belum ada tanda fitur yang dikirim pengguna."
                  : "Tidak ada tanda fitur yang cocok dengan filter pencarian."}
              </p>
              <p className="text-[11px] mt-1 text-muted-foreground max-w-md mx-auto">
                Pengguna dengan peran Super Admin, Admin, dan User dapat menandai tombol atau alur kerja di aplikasi menggunakan shortcut <strong>Ctrl + ~</strong>.
              </p>
            </div>
          ) : (
            filteredMarkers.map((marker) => {
              const catInfo = CATEGORY_MAP[marker.category] || CATEGORY_MAP.used_frequently;
              const statusInfo = STATUS_MAP[marker.status] || STATUS_MAP.baru;
              const CatIcon = catInfo.icon;

              return (
                <div
                  key={marker.id}
                  className="rounded-xl border bg-background/50 hover:bg-background/80 transition-all p-4.5 shadow-xs flex flex-col gap-3"
                >
                  {/* Baris Atas: Nama Fitur & Badges */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] gap-1 font-semibold ${catInfo.color}`}
                      >
                        <CatIcon className="h-3 w-3" />
                        {catInfo.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        📅 {FREQUENCY_LABELS[marker.frequency] || marker.frequency}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-semibold ${statusInfo.color}`}
                      >
                        Status: {statusInfo.label}
                      </Badge>
                    </div>

                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(marker.createdAt)}
                    </span>
                  </div>

                  {/* Judul Fitur & Tautan Halaman */}
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      {marker.featureName}
                    </h4>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 font-mono">
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

                  {/* Cuplikan Elemen */}
                  {(marker.elementSelector || marker.elementText) && (
                    <div className="rounded-lg bg-muted/30 border border-border/50 p-2 text-xs">
                      {marker.elementSelector && (
                        <div className="font-mono text-[10px] text-purple-600 dark:text-purple-400 font-semibold mb-0.5 truncate">
                          Selector: {marker.elementSelector}
                        </div>
                      )}
                      {marker.elementText && (
                        <div className="text-[11px] text-foreground/80 italic line-clamp-2">
                          "{marker.elementText}"
                        </div>
                      )}
                    </div>
                  )}

                  {/* Catatan / Keterangan Pengguna */}
                  {marker.notes && (
                    <div className="rounded-lg border-l-2 border-purple-500 bg-purple-500/5 px-3 py-2 text-xs">
                      <span className="text-[10px] font-semibold uppercase text-purple-600 dark:text-purple-400 block mb-0.5">
                        Catatan Pengguna:
                      </span>
                      <p className="text-foreground whitespace-pre-wrap text-xs">
                        {marker.notes}
                      </p>
                    </div>
                  )}

                  {/* Catatan Balasan Developer (jika ada) */}
                  {marker.developerNotes && (
                    <div className="rounded-lg border-l-2 border-emerald-500 bg-emerald-500/5 px-3 py-2 text-xs">
                      <span className="text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400 block mb-0.5 flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        Tanggapan Developer:
                      </span>
                      <p className="text-foreground whitespace-pre-wrap text-xs">
                        {marker.developerNotes}
                      </p>
                    </div>
                  )}

                  {/* Baris Bawah: Pengirim & Tombol Aksi Lengkap */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                      <User className="h-3 w-3" />
                      <span>{marker.userEmail}</span>
                      <span className="font-semibold uppercase text-[10px] px-1.5 py-0.2 rounded bg-muted">
                        {marker.userRole}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Tombol Utama: Buka Halaman Laporan Detail Sendiri */}
                      <Button
                        size="sm"
                        asChild
                        className="text-xs h-7 gap-1.5 bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-xs"
                      >
                        <Link href={`/app/deploy/markers/${marker.id}`}>
                          <FileCode className="h-3.5 w-3.5" />
                          Halaman Laporan Detail
                        </Link>
                      </Button>

                      {/* Tombol Salin Prompt Langsung */}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleDirectCopyPrompt(marker)}
                        className={`text-xs h-7 gap-1 font-medium transition-all ${
                          copiedPromptId === marker.id
                            ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                            : "border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
                        }`}
                        title="Salin Prompt AI untuk Perbaikan"
                      >
                        {copiedPromptId === marker.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-500" />
                            Prompt Tersalin!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Salin Prompt
                          </>
                        )}
                      </Button>

                      {/* Tombol Pratinjau Cepat */}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedReportMarker(marker)}
                        className="text-xs h-7 text-muted-foreground hover:text-foreground"
                        title="Pratinjau modal ringkas"
                      >
                        Pratinjau
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenEdit(marker)}
                        className="text-xs h-7 gap-1"
                      >
                        <Edit3 className="h-3 w-3 text-purple-500" />
                        {marker.developerNotes ? "Ubah Tanggapan" : "Respon & Status"}
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(marker)}
                        title="Hapus tanda fitur"
                        className="text-xs h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 5. MODAL DIALOG: LAPORAN TEKNIS LENGKAP & REKOMENDASI CARA PERBAIKAN */}
      <Dialog
        open={Boolean(selectedReportMarker)}
        onOpenChange={(open) => !open && setSelectedReportMarker(null)}
      >
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          {diagnosticReport && selectedReportMarker && (
            <div className="space-y-5">
              <DialogHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                    <Wrench className="h-5 w-5" />
                    <DialogTitle className="text-lg">
                      Pratinjau Laporan Teknis: {diagnosticReport.featureName}
                    </DialogTitle>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      asChild
                      className="text-xs h-7 gap-1.5 bg-purple-600 hover:bg-purple-700 text-white font-medium"
                    >
                      <Link href={`/app/deploy/markers/${selectedReportMarker.id}`}>
                        <ExternalLink className="h-3 w-3" />
                        Buka Halaman Penuh
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(diagnosticReport.aiPrompt);
                        setCopiedPromptId("modal");
                        setTimeout(() => setCopiedPromptId(null), 2500);
                      }}
                      className="text-xs h-7 gap-1 border-purple-500/30 text-purple-600 dark:text-purple-400"
                    >
                      {copiedPromptId === "modal" ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-500" />
                          Prompt Tersalin!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Salin Prompt AI
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <DialogDescription className="text-xs">
                  Diagnostik otomatis sistem: memetakan lokasi berkas, fungsi yang berjalan, dan panduan teknis perbaikan developer berdasarkan konteks aplikasi.
                </DialogDescription>
              </DialogHeader>

              {/* Status & Badges Bar */}
              <div className="flex flex-wrap items-center gap-2 border-b pb-3 text-xs">
                <Badge
                  variant="outline"
                  className={CATEGORY_MAP[diagnosticReport.category]?.color || ""}
                >
                  {CATEGORY_MAP[diagnosticReport.category]?.label}
                </Badge>
                <Badge variant="outline" className="text-muted-foreground">
                  📅 Frekuensi: {FREQUENCY_LABELS[diagnosticReport.frequency]}
                </Badge>
                <Badge
                  variant="outline"
                  className={STATUS_MAP[diagnosticReport.status]?.color || ""}
                >
                  Status: {STATUS_MAP[diagnosticReport.status]?.label}
                </Badge>
                <Badge variant="outline" className="bg-muted text-foreground">
                  {diagnosticReport.context.featureDomain}
                </Badge>
                <Badge
                  variant="outline"
                  className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                >
                  {diagnosticReport.context.complexity}
                </Badge>
              </div>

              {/* Grid 2 Kolom: Masukan Pengguna & Elemen DOM */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Kolom Kiri: Catatan Pengguna */}
                <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-muted-foreground font-semibold">
                    <span className="flex items-center gap-1.5 text-foreground">
                      <User className="h-3.5 w-3.5 text-purple-500" />
                      Masukan Pengguna
                    </span>
                    <span className="text-[11px]">
                      {selectedReportMarker.userEmail} ({selectedReportMarker.userRole})
                    </span>
                  </div>
                  <div className="rounded-lg bg-background p-3 border border-border/60">
                    <p className="text-xs text-foreground italic whitespace-pre-wrap">
                      "{diagnosticReport.userNotes}"
                    </p>
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Dikirim pada {formatDate(selectedReportMarker.createdAt)}
                  </div>
                </div>

                {/* Kolom Kanan: Diagnostik Elemen & DOM */}
                <div className="rounded-xl border bg-muted/20 p-3.5 space-y-2 font-mono">
                  <div className="flex items-center justify-between text-muted-foreground font-sans font-semibold">
                    <span className="flex items-center gap-1.5 text-foreground">
                      <Code2 className="h-3.5 w-3.5 text-purple-500" />
                      Diagnostik Elemen
                    </span>
                    <Badge variant="outline" className="text-[10px] font-sans">
                      {diagnosticReport.context.elementType}
                    </Badge>
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    <div>
                      <span className="text-muted-foreground font-sans block text-[10px]">
                        Lokasi Halaman:
                      </span>
                      <span className="text-purple-600 dark:text-purple-400">
                        {selectedReportMarker.pagePath}
                      </span>
                    </div>
                    {diagnosticReport.context.modalName && (
                      <div>
                        <span className="text-muted-foreground font-sans block text-[10px]">
                          Konteks Pop-up:
                        </span>
                        <span className="text-amber-600 dark:text-amber-400">
                          {diagnosticReport.context.modalName}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground font-sans block text-[10px]">
                        Selector Elemen:
                      </span>
                      <span className="text-foreground break-all">
                        {selectedReportMarker.elementSelector || "(Seluruh Halaman)"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bagian PETA BERKAS & ARSITEKTUR KODE (Source Map) */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                    <Compass className="h-4 w-4" />
                    Peta Berkas Kode & Fungsi yang Berjalan (Source Map)
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    Lokasi file yang harus diperiksa developer
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* File Halaman Utama */}
                  <div className="rounded-lg border bg-muted/30 p-2.5">
                    <span className="text-[10px] text-muted-foreground font-semibold block uppercase">
                      1. Berkas Halaman (Page Route):
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <code className="text-xs text-foreground font-mono truncate">
                        {diagnosticReport.sourceMap.pageFile}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            diagnosticReport.sourceMap.pageFile,
                            "pageFile",
                          )
                        }
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="Salin path file"
                      >
                        {copiedText === "pageFile" ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* File Komponen UI */}
                  <div className="rounded-lg border bg-muted/30 p-2.5">
                    <span className="text-[10px] text-muted-foreground font-semibold block uppercase">
                      2. Berkas Komponen UI:
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <code className="text-xs text-foreground font-mono truncate">
                        {diagnosticReport.sourceMap.componentFiles[0] ||
                          "src/components/dashboard/..."}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            diagnosticReport.sourceMap.componentFiles[0] || "",
                            "compFile",
                          )
                        }
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="Salin path file"
                      >
                        {copiedText === "compFile" ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Endpoint API */}
                  <div className="rounded-lg border bg-muted/30 p-2.5">
                    <span className="text-[10px] text-muted-foreground font-semibold block uppercase">
                      3. Endpoint API Backend:
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <code className="text-xs text-emerald-600 dark:text-emerald-400 font-mono truncate">
                        {diagnosticReport.sourceMap.apiEndpoints[0] || "/api/..."}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            diagnosticReport.sourceMap.apiEndpoints[0] || "",
                            "apiEndpoint",
                          )
                        }
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="Salin endpoint"
                      >
                        {copiedText === "apiEndpoint" ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Service & Database Layer */}
                  <div className="rounded-lg border bg-muted/30 p-2.5">
                    <span className="text-[10px] text-muted-foreground font-semibold block uppercase">
                      4. Service & Database / Drizzle:
                    </span>
                    <div className="flex items-center justify-between mt-1">
                      <code className="text-xs text-foreground font-mono truncate">
                        {diagnosticReport.sourceMap.serviceFiles[0] || "src/services/..."}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            diagnosticReport.sourceMap.serviceFiles[0] || "",
                            "serviceFile",
                          )
                        }
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="Salin path service"
                      >
                        {copiedText === "serviceFile" ? (
                          <Check className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Ringkasan Fungsi Runtime yang Berjalan */}
                <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 text-xs flex items-start gap-2.5">
                  <Cpu className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-purple-700 dark:text-purple-300 block">
                      Fungsi Runtime yang Dieksekusi:
                    </span>
                    <code className="font-mono text-[11px] text-foreground block mt-0.5">
                      {diagnosticReport.runtimeFunctionSummary}
                    </code>
                    {diagnosticReport.sourceMap.hardwareOrExternalSystem && (
                      <span className="text-[11px] text-muted-foreground block mt-1">
                        Sistem Terhubung:{" "}
                        <strong className="text-foreground">
                          {diagnosticReport.sourceMap.hardwareOrExternalSystem}
                        </strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Bagian PANDUAN LANGKAH PERBAIKAN TEKNIS (Remediation Checklist) */}
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4" />
                    Langkah Investigasi & Cara Perbaikan Developer
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    Checklist pengerjaan terarah
                  </span>
                </div>

                <div className="space-y-2.5">
                  {diagnosticReport.remediationChecklist.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border bg-muted/20 p-3 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground">
                          {item.step}
                        </span>
                        <code className="text-[10px] font-mono text-purple-600 dark:text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                          {item.targetFile}
                        </code>
                      </div>
                      <p className="text-muted-foreground text-[11px]">
                        {item.action}
                      </p>
                      {item.codeHint && (
                        <div className="relative rounded bg-background p-2.5 border font-mono text-[11px] text-foreground/90 overflow-x-auto">
                          <pre>{item.codeHint}</pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Troubleshooting Khusus */}
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1.5">
                  <span className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Rekomendasi Penanganan Kasus:
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-[11px] text-muted-foreground">
                    {diagnosticReport.troubleshootingGuidance.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                </div>

                {/* Perintah CLI Verifikasi Server */}
                {diagnosticReport.cliVerificationCommand && (
                  <div className="rounded-lg bg-muted/40 border p-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <Terminal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <code className="font-mono text-[11px] text-foreground truncate">
                        {diagnosticReport.cliVerificationCommand}
                      </code>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        copyToClipboard(
                          diagnosticReport.cliVerificationCommand || "",
                          "cliCmd",
                        )
                      }
                      className="text-xs h-7 gap-1"
                    >
                      {copiedText === "cliCmd" ? (
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

              {/* Bagian Tindak Lanjut Developer Cepat */}
              <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Edit3 className="h-4 w-4 text-purple-600" />
                  Perbarui Status & Beri Respon Developer
                </h4>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Status Pengerjaan:</span>
                    <select
                      value={selectedReportMarker.status}
                      onChange={(e) => {
                        const newStatus = e.target.value as FeatureMarkerStatus;
                        setEditMarker(selectedReportMarker);
                        setEditStatus(newStatus);
                        setEditDevNotes(selectedReportMarker.developerNotes || "");
                      }}
                      className="text-xs h-8 rounded-md border border-input bg-background px-2 font-semibold"
                    >
                      <option value="baru">Baru</option>
                      <option value="ditinjau">Ditinjau</option>
                      <option value="dikerjakan">Dikerjakan</option>
                      <option value="selesai">Selesai</option>
                    </select>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenEdit(selectedReportMarker)}
                    className="text-xs h-8 gap-1.5"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-purple-500" />
                    Tulis Catatan / Solusi Developer
                  </Button>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedReportMarker(null)}
                  className="text-xs"
                >
                  Tutup Laporan
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 6. Dialog Edit Tanggapan Developer & Status */}
      <Dialog
        open={Boolean(editMarker)}
        onOpenChange={(open) => !open && setEditMarker(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Edit3 className="h-4 w-4 text-purple-600" />
              Tindak Lanjut Fitur: {editMarker?.featureName}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ubah status pengerjaan atau tambahkan catatan respon developer untuk tanda fitur ini.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEdit} className="space-y-4 pt-2">
            <div>
              <Label className="text-xs font-semibold block mb-1">
                Status Alur Kerja
              </Label>
              <div className="grid grid-cols-4 gap-2">
                {(["baru", "ditinjau", "dikerjakan", "selesai"] as FeatureMarkerStatus[]).map(
                  (st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setEditStatus(st)}
                      className={`rounded-md border py-1.5 px-2 text-center text-xs capitalize transition-all ${
                        editStatus === st
                          ? "border-purple-500 bg-purple-500/15 font-semibold text-purple-600 dark:text-purple-300"
                          : "border-border text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      {STATUS_MAP[st]?.label || st}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="devNotes" className="text-xs font-semibold">
                Catatan Developer / Solusi
              </Label>
              <textarea
                id="devNotes"
                value={editDevNotes}
                onChange={(e) => setEditDevNotes(e.target.value)}
                rows={3}
                placeholder="Contoh: Fitur ini sudah kami optimasi pada rilis v1.2.0 atau akan diprioritaskan di sprint selanjutnya."
                className="mt-1.5 w-full rounded-md border border-input bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditMarker(null)}
                disabled={isUpdating}
                className="text-xs"
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isUpdating}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1"
              >
                {isUpdating ? "Menyimpan..." : "Simpan Perubahan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 7. Alert Dialog Hapus Tanda */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base text-red-600 flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Hapus Tanda Fitur Ini?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Tanda fitur <strong>"{deleteTarget?.featureName}"</strong> akan dihapus secara permanen dari basis data telemetri.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting} className="text-xs">
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white text-xs"
            >
              {isDeleting ? "Menghapus..." : "Hapus Permanen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
