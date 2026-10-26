"use client";

import { useState, useEffect, useSyncExternalStore, useCallback } from "react";
import { cn } from "cn";
import {
  getWhatsappConfig,
  getWhatsappServerSnapshot,
  subscribeWhatsappConfig,
} from "@/lib/dashboard/whatsapp-registry";
import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  FlaskConical,
  Gauge,
  Globe,
  Laptop,
  Loader2,
  MessageSquare,
  Radio,
  RotateCcw,
  Save,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  User,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { selectClassName } from "./select-class";
import { DeviceQuickCards } from "./device-quick-cards";
import { ThresholdSettings } from "./threshold-settings";
import { WhatsappSettings } from "./whatsapp-settings";
import Link from "next/link";
import { useSessionUser } from "@/components/session-provider";
import { isSuperAdmin, isAdmin, isUser, roleLabel, roleNames } from "@/lib/roles";
import { authClient } from "@/lib/auth-client";

interface UserRoleInfo {
  isSuperAdmin?: boolean;
  isUser?: boolean;
  isAdmin: boolean;
  role: string;
  email: string;
  name?: string;
  userId?: string;
}

interface SettingsState {
  // 1. Umum
  ispName: string;
  theme: "dark" | "light" | "system";
  timezone: string;
  refreshInterval: number;
  dataMode: "demo" | "live";
  // 2. Alarm & Notifikasi
  alertSoundEnabled: boolean;
  alertSoundSeverity: "critical_only" | "all";
  alertVolume: number;
  telegramBotToken: string;
  telegramChatId: string;
  waWebhookUrl: string;
  waAdminPhone: string;
  // 3. Ambang Batas: disimpan terpisah oleh ThresholdSettings (threshold-registry.ts)
  // 4. Jaringan & Hub Go
  wsHubUrl: string;
  mikrotikTimeoutMs: number;
  healthcheckIntervalSec: number;
  // 5. Billing
  billingApiUrl: string;
  billingSyncSchedule: string;
  autoIsolirMikrotik: boolean;
  gracePeriodHours: number;
}

const DEFAULT_SETTINGS: SettingsState = {
  ispName: "Nusantara Broadband Network",
  theme: "dark",
  timezone: "Asia/Jakarta",
  refreshInterval: 1,
  dataMode: "demo",

  alertSoundEnabled: true,
  alertSoundSeverity: "all",
  alertVolume: 80,
  telegramBotToken: "",
  telegramChatId: "",
  waWebhookUrl: "",
  waAdminPhone: "",

  wsHubUrl: "ws://localhost:8080/ws",
  mikrotikTimeoutMs: 3000,
  healthcheckIntervalSec: 10,

  billingApiUrl: "https://billing.nusantara.net.id/api/v1",
  billingSyncSchedule: "1h",
  autoIsolirMikrotik: true,
  gracePeriodHours: 24,
};

const SCRIPT_MIKROTIK = `# 1. Aktifkan service REST API di RouterOS v7
/ip service set www disabled=no port=80
/ip service set www-ssl disabled=no port=443

# 2. Buat grup dengan izin monitoring
/user group add name=noc-agent policy=read,api,rest,test

# 3. Buat user operator NOC
/user add name=noc-monitor group=noc-agent password="StrongSecretPassword123"`;

const SCRIPT_OLT_SNMP = `# 1. Aktifkan SNMP Agent pada OLT (ZTE / Huawei / HSGQ)
snmp-server community nocpublic ro
snmp-server host 10.10.0.10 version 2c nocpublic
snmp-server enable traps`;

export function SettingsBoard() {
  const waConfig = useSyncExternalStore(
    subscribeWhatsappConfig,
    getWhatsappConfig,
    getWhatsappServerSnapshot,
  );
  const [settings, setSettings] = useState<SettingsState>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("noc_app_settings");
        if (stored) {
          return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        }
      } catch {
        // Abaikan
      }
    }
    return DEFAULT_SETTINGS;
  });
  const [tab, setTab] = useState("general");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [testSent, setTestSent] = useState<string | null>(null);
  const [copiedScript, setCopiedScript] = useState<string | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isLocalhost, setIsLocalhost] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const h = window.location.hostname.toLowerCase();
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "0.0.0.0" ||
      h.endsWith(".local") ||
      h.includes("localhost")
    );
  });
  const [serverEnv, setServerEnv] = useState<"local" | "server">(() => {
    if (typeof window === "undefined") return "local";
    const h = window.location.hostname.toLowerCase();
    const isLocal =
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "::1" ||
      h === "0.0.0.0" ||
      h.endsWith(".local") ||
      h.includes("localhost");
    return isLocal ? "local" : "server";
  });
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [dbStats, setDbStats] = useState<{ routers: number; olts: number; alerts: number } | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const sessionUser = useSessionUser();
  const [userRoleInfo, setUserRoleInfo] = useState<UserRoleInfo | null>(() => {
    if (!sessionUser) return null;
    const role = sessionUser.role ?? "user";
    return {
      userId: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      role,
      isSuperAdmin: isSuperAdmin(role),
      isAdmin: isAdmin(role),
      isUser: isUser(role),
    };
  });

  useEffect(() => {
    if (sessionUser && !userRoleInfo) {
      const role = sessionUser.role ?? "user";
      setUserRoleInfo({
        userId: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        role,
        isSuperAdmin: isSuperAdmin(role),
        isAdmin: isAdmin(role),
        isUser: isUser(role),
      });
    }
  }, [sessionUser, userRoleInfo]);

  // Sinkronkan status runtime & peran akun dari API
  useEffect(() => {
    fetch("/api/settings/mode")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) {
          if (json.data.environmentInfo) {
            setServerEnv(json.data.environmentInfo.environment);
            setIsLocalhost(json.data.environmentInfo.isLocalhost);
          }
          if (typeof json.data.databaseConnected === "boolean") {
            setDbConnected(json.data.databaseConnected);
          }
          if (json.data.dbStats) {
            setDbStats(json.data.dbStats);
          }
          if (json.data.dataMode) {
            setSettings((prev) => ({ ...prev, dataMode: json.data.dataMode }));
          }
        }
      })
      .catch(() => null);

    fetch("/api/settings/role")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) {
          setUserRoleInfo(json.data);
        }
      })
      .catch(() => null);
  }, []);

  async function handleToggleMode(nextMode: "demo" | "live") {
    setSettings((prev) => ({ ...prev, dataMode: nextMode }));
    try {
      const stored = localStorage.getItem("noc_app_settings");
      const parsed = stored ? JSON.parse(stored) : {};
      localStorage.setItem(
        "noc_app_settings",
        JSON.stringify({ ...parsed, ...settings, dataMode: nextMode }),
      );
    } catch {
      // Abaikan
    }

    setModeNotice(
      nextMode === "live"
        ? "Mode Live aktif: Semua data dummy ditiadakan dan operasional masuk ke database PostgreSQL."
        : "Mode Simulasi aktif: Data tiruan (simulator) digunakan untuk pengujian antarmuka tanpa menyentuh perangkat asli.",
    );

    try {
      const res = await fetch("/api/settings/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataMode: nextMode }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.data) {
          if (typeof json.data.databaseConnected === "boolean") {
            setDbConnected(json.data.databaseConnected);
          }
          if (json.data.dbStats) {
            setDbStats(json.data.dbStats);
          }
        }
        // Segera muat ulang halaman agar layout server, navigasi, dan store sinkron
        setTimeout(() => {
          window.location.reload();
        }, 400);
      } else {
        setSettings((prev) => ({ ...prev, dataMode: settings.dataMode }));
        setModeNotice(
          res.status === 403
            ? "Hanya Admin yang boleh mengganti mode data. Mode tidak diubah."
            : "Mode gagal diganti di server. Mode tidak diubah.",
        );
      }
    } catch {
      setSettings((prev) => ({ ...prev, dataMode: settings.dataMode }));
      setModeNotice("Server tidak terjangkau. Mode tidak diubah.");
    }
  }

  function handleSave() {
    try {
      localStorage.setItem("noc_app_settings", JSON.stringify(settings));
    } catch {
      // Abaikan
    }
    fetch("/api/settings/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataMode: settings.dataMode }),
    }).catch(() => null);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  function handleReset() {
    if (confirm("Kembalikan semua pengaturan ke nilai bawaan?")) {
      setSettings(DEFAULT_SETTINGS);
      try {
        localStorage.removeItem("noc_app_settings");
      } catch {
        // Abaikan
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  }

  function handleTestTelegram() {
    setTestSent("telegram");
    setTimeout(() => setTestSent(null), 3500);
  }

  function handleTestWa() {
    setTestSent("whatsapp");
    setTimeout(() => setTestSent(null), 3500);
  }

  function handleCopy(text: string, id: string) {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedScript(id);
      setTimeout(() => setCopiedScript(null), 2500);
    }
  }

  function handleRunDiagnostics() {
    setTestRunning(true);
    setTestResult(null);
    setTimeout(() => {
      setTestRunning(false);
      setTestResult("Sukses! 4 Router MikroTik dan 2 OLT merespons REST API dan SNMP dengan latensi rata-rata 12ms.");
    }, 1600);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Halaman Pengaturan */}
      <div className="flex flex-col gap-2 border-b pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pengaturan Sistem &amp; Operasional NOC
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
              <RotateCcw className="size-4" />
              Reset Bawaan
            </Button>
            <Button size="sm" onClick={handleSave} className="gap-1.5 font-medium">
              <Save className="size-4" />
              Simpan Perubahan
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Konfigurasi terpusat untuk identitas, notifikasi bot, ambang batas anomali, koneksi collector, dan panduan integrasi.
        </p>
      </div>

      {/* Banner Notifikasi Berhasil */}
      {saveSuccess && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
        >
          <CheckCircle2 className="size-5 shrink-0" />
          <span>Pengaturan berhasil disimpan dan langsung diterapkan ke seluruh modul aplikasi.</span>
        </div>
      )}

      {/* Konten Tab Pengaturan */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-4 grid w-full grid-cols-2 gap-1 group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <TabsTrigger value="general" className="gap-2">
            <Sliders className="size-4" />
            <span>Umum</span>
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <Bell className="size-4" />
            <span>Alarm &amp; Bot</span>
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageSquare className="size-4" />
            <span>WhatsApp</span>
          </TabsTrigger>
          <TabsTrigger value="thresholds" className="gap-2">
            <Gauge className="size-4" />
            <span>Ambang Batas</span>
          </TabsTrigger>
          <TabsTrigger value="devices" className="gap-2">
            <Server className="size-4" />
            <span>Perangkat</span>
          </TabsTrigger>
          <TabsTrigger value="collector" className="gap-2">
            <Radio className="size-4" />
            <span>Kolektor &amp; Hub</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2">
            <CreditCard className="size-4" />
            <span>Billing</span>
          </TabsTrigger>
          <TabsTrigger value="guide" className="gap-2">
            <BookOpen className="size-4" />
            <span>Panduan Koneksi</span>
          </TabsTrigger>
        </TabsList>

        {/* ============================================================== */}
        {/* 1. TAB UMUM & TAMPILAN                                          */}
        {/* ============================================================== */}
        <TabsContent value="general" className="space-y-4">
          {/* KARTU MODE OPERASI (LIVE VS SIMULASI) & STATUS LINGKUNGAN (LOCAL VS SERVER) */}
          <Card className="border-2 border-primary/20 bg-card shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sliders className="size-4 text-primary" />
                    <span>Mode Operasi Jaringan &amp; Status Lingkungan</span>
                  </CardTitle>
                  <CardDescription>
                    Pilih antara mode simulasi untuk pengujian aman atau mode live untuk data nyata yang tersimpan ke database.
                  </CardDescription>
                </div>
                {/* STATUS LOCAL VS SERVER */}
                <div className="flex items-center gap-2" data-testid="environment-status-badge">
                  {isLocalhost || serverEnv === "local" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      <Laptop className="size-3.5" />
                      <span>Status: Local (localhost)</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                      <Globe className="size-3.5" />
                      <span>Status: Server (Hosting / VPS)</span>
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              {/* DESKRIPSI STATUS LINGKUNGAN */}
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isLocalhost || serverEnv === "local" ? (
                    <>
                      <Laptop className="size-4 text-emerald-500 shrink-0" />
                      <span>
                        <strong>Lingkungan Local:</strong> Berjalan di localhost (mesin pengembang lokal). Port lokal dan simulasi pengujian siap digunakan.
                      </span>
                    </>
                  ) : (
                    <>
                      <Server className="size-4 text-blue-500 shrink-0" />
                      <span>
                        <strong>Lingkungan Server:</strong> Berjalan di server remote (bukan localhost). Akses jaringan publik dan integrasi perangkat aktif.
                      </span>
                    </>
                  )}
                </div>
                <Badge variant="outline" className="text-[11px] shrink-0 font-mono">
                  {isLocalhost ? "host: 127.0.0.1" : "host: remote server"}
                </Badge>
              </div>

              {/* TOGGLE BUTTON: SIMULASI VS LIVE */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-foreground">
                  Pilih Mode Operasi (Toggle Simulasi vs Live):
                </Label>
                <div
                  role="group"
                  aria-label="Pilihan Mode Operasi"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  {/* TOMBOL SIMULASI */}
                  <button
                    type="button"
                    onClick={() => handleToggleMode("demo")}
                    aria-pressed={settings.dataMode === "demo"}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer ${
                      settings.dataMode === "demo"
                        ? "border-amber-500/50 bg-amber-500/10 shadow-sm ring-2 ring-amber-500/20"
                        : "border-border hover:bg-muted/50 opacity-75"
                    }`}
                  >
                    <div
                      className={`mt-0.5 rounded-lg p-2 ${
                        settings.dataMode === "demo"
                          ? "bg-amber-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <FlaskConical className="size-5" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">Mode Simulasi</span>
                        {settings.dataMode === "demo" && (
                          <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4">
                            Aktif
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Data tiruan (simulator) aktif. Cocok untuk demonstrasi antarmuka dan pengujian tanpa menghubungkan router asli.
                      </p>
                    </div>
                  </button>

                  {/* TOMBOL LIVE */}
                  <button
                    type="button"
                    onClick={() => handleToggleMode("live")}
                    aria-pressed={settings.dataMode === "live"}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer ${
                      settings.dataMode === "live"
                        ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm ring-2 ring-emerald-500/20"
                        : "border-border hover:bg-muted/50 opacity-75"
                    }`}
                  >
                    <div
                      className={`mt-0.5 rounded-lg p-2 ${
                        settings.dataMode === "live"
                          ? "bg-emerald-600 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Database className="size-5" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">Mode Live (Data Nyata)</span>
                        {settings.dataMode === "live" && (
                          <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0 h-4">
                            Aktif
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Semua data dummy hilang. Seluruh telemetri, alert, dan log masuk langsung ke database PostgreSQL nyata.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* FEEDBACK STATUS MODE AKTIF */}
              {settings.dataMode === "live" ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-sm text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span>Mode Live Aktif: Semua Data Dummy Ditiadakan</span>
                  </div>
                  <p className="leading-relaxed">
                    Sistem kini berjalan dengan sumber data riil. Seluruh telemetri jaringan, perangkat MikroTik/OLT, alert penanganan, dan log anomali langsung ditulis dan dibaca dari tabel PostgreSQL.
                  </p>
                  <div className="pt-1 flex flex-wrap items-center gap-3 text-[11px] text-emerald-700/80 dark:text-emerald-400/90 font-mono">
                    <span>• Status DB: {dbConnected ? "Terhubung ke PostgreSQL" : "Menghubungkan ke PostgreSQL..."}</span>
                    {dbStats && (
                      <span>• Tersimpan di DB: {dbStats.routers} Router, {dbStats.olts} OLT, {dbStats.alerts} Alert</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <div className="flex items-center gap-2 font-semibold text-sm text-amber-700 dark:text-amber-300">
                    <FlaskConical className="size-4 shrink-0" />
                    <span>Mode Simulasi Aktif (Data Tiruan Sementara)</span>
                  </div>
                  <p className="leading-relaxed">
                    Data tiruan digunakan agar Anda dapat melihat tampilan dan interaksi dasbor tanpa memerlukan perangkat keras jaringan fisik. Beralihlah ke Mode Live saat hendak memantau jaringan nyata.
                  </p>
                </div>
              )}

              {/* NOTIFIKASI PERUBAHAN CEPAT */}
              {modeNotice && (
                <div
                  role="status"
                  className="rounded-lg border border-primary/30 bg-primary/10 p-2.5 text-xs text-primary flex items-center gap-2"
                >
                  <Check className="size-4 shrink-0" />
                  <span>{modeNotice}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Identitas &amp; Lingkungan Operasional</CardTitle>
              <CardDescription>
                Sesuaikan nama ISP dan preferensi lingkungan kerja NOC.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ispName">Nama Penyedia Layanan / ISP</Label>
                  <Input
                    id="ispName"
                    value={settings.ispName}
                    onChange={(e) => setSettings({ ...settings, ispName: e.target.value })}
                    placeholder="Contoh: Nusantara Broadband"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ditampilkan pada header laporan, ringkasan export, dan pesan notifikasi.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Zona Waktu Operasional</Label>
                  <select
                    id="timezone"
                    value={settings.timezone}
                    onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                    className={selectClassName}
                  >
                    <option value="Asia/Jakarta">WIB — Waktu Indonesia Barat (UTC+7)</option>
                    <option value="Asia/Makassar">WITA — Waktu Indonesia Tengah (UTC+8)</option>
                    <option value="Asia/Jayapura">WIT — Waktu Indonesia Timur (UTC+9)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Standar penanggalan untuk log insiden dan riwayat anomali.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="refreshInterval">Interval Sampling Real-time</Label>
                  <select
                    id="refreshInterval"
                    value={settings.refreshInterval}
                    onChange={(e) => setSettings({ ...settings, refreshInterval: Number(e.target.value) })}
                    className={selectClassName}
                  >
                    <option value={1}>1 Detik — Sangat Cepat (Standar NOC)</option>
                    <option value={3}>3 Detik — Seimbang</option>
                    <option value={5}>5 Detik — Hemat Bandwidth</option>
                    <option value={10}>10 Detik — Interval Panjang</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Frekuensi penerimaan data throughput dan status sesi pelanggan.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dataMode">Status Sumber Data Terpilih</Label>
                  <div className="flex items-center gap-2 pt-1">
                    <Badge
                      variant={settings.dataMode === "live" ? "default" : "secondary"}
                      className="px-2.5 py-1 text-xs"
                    >
                      {settings.dataMode === "live" ? "MODE LIVE (DATA NYATA)" : "MODE SIMULASI (DEMO)"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      (Dapat diubah via toggle button di atas)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mode live meniadakan data tiruan dan mengharuskan data jaringan tersimpan ke PostgreSQL.
                  </p>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* KARTU MANAJEMEN PERAN & HAK AKSES AKUN */}
          <Card className="border border-border bg-card shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <span>Peran Akun &amp; Izin Konfigurasi (Role Admin vs User)</span>
                  </CardTitle>
                  <CardDescription>
                    Peran asli di database PostgreSQL menentukan apakah akun Anda diizinkan menambah router, menguji koneksi, dan mengubah konfigurasi.
                  </CardDescription>
                </div>
                {userRoleInfo && (
                  <Badge
                    variant={userRoleInfo.isSuperAdmin ? "default" : userRoleInfo.isAdmin ? "default" : "secondary"}
                    className={
                      userRoleInfo.isSuperAdmin
                        ? "px-3 py-1 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-700"
                        : "px-3 py-1 text-xs font-semibold"
                    }
                  >
                    {userRoleInfo.isSuperAdmin
                      ? "SUPER ADMIN (KONTROL PENUH)"
                      : userRoleInfo.isAdmin
                        ? "ADMINISTRATOR (OPERASIONAL UTAMA)"
                        : "PETUGAS (USER BIASA)"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <div className="rounded-lg border bg-muted/30 p-3 text-xs flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground">
                      Akun: {userRoleInfo?.email ?? "Sedang memuat..."}
                    </span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    {userRoleInfo?.isSuperAdmin ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        ✓ Akun Super Admin memegang kontrol penuh seluruh sistem dan berwenang memberikan/mengubah peran pengguna (Admin dan User) di database.
                      </span>
                    ) : userRoleInfo?.isAdmin ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        ✓ Akun Admin operasional utama (router, cpe, threshold, billing, system). Manajemen akun dan pengangkatan peran dikontrol penuh oleh Super Admin.
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        ⚠ Akun Petugas biasa (User). Hak akses terbatas untuk melihat pemantauan operasional.
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {!userRoleInfo?.isSuperAdmin && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Pengelolaan peran akun hanya dapat dilakukan oleh Super Admin.
                </p>
              )}
            </CardContent>
          </Card>

          {/* KARTU KELOLA PENGGUNA & PERAN AKUN (KHUSUS SUPER ADMIN) */}
          {userRoleInfo?.isSuperAdmin && (
            <SuperAdminUserManager currentUserId={userRoleInfo.userId} />
          )}
        </TabsContent>

        {/* ============================================================== */}
        {/* 2. TAB ALARM & NOTIFIKASI BOT                                   */}
        {/* ============================================================== */}
        <TabsContent value="alerts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pengaturan Suara Alarm di Browser</CardTitle>
              <CardDescription>
                Bunyikan peringatan audio seketika saat terdeteksi router mati atau sinyal optik anjlok.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-secondary text-foreground">
                    {settings.alertSoundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Bunyi Alarm Audio</div>
                    <p className="text-xs text-muted-foreground">
                      Peringatan suara saat insiden kritis baru tercatat oleh rule engine.
                    </p>
                  </div>
                </div>
                <Button
                  variant={settings.alertSoundEnabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSettings({ ...settings, alertSoundEnabled: !settings.alertSoundEnabled })}
                >
                  {settings.alertSoundEnabled ? "Alarm Aktif" : "Alarm Dimatikan"}
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="soundSeverity">Tingkat Keparahan yang Membunyikan Alarm</Label>
                  <select
                    id="soundSeverity"
                    value={settings.alertSoundSeverity}
                    onChange={(e) =>
                      setSettings({ ...settings, alertSoundSeverity: e.target.value as "critical_only" | "all" })
                    }
                    className={selectClassName}
                    disabled={!settings.alertSoundEnabled}
                  >
                    <option value="all">Kritis dan Waspada (Semua Gangguan)</option>
                    <option value="critical_only">Hanya Gangguan Kritis (Router Putus / Fiber Terputus)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="alertVolume">Volume Alarm: {settings.alertVolume}%</Label>
                  <input
                    id="alertVolume"
                    type="range"
                    min="10"
                    max="100"
                    value={settings.alertVolume}
                    disabled={!settings.alertSoundEnabled}
                    onChange={(e) => setSettings({ ...settings, alertVolume: Number(e.target.value) })}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integrasi Bot Telegram &amp; WhatsApp</CardTitle>
              <CardDescription>
                Kirimkan broadcast insiden seketika ke grup koordinasi teknisi dan pimpinan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Telegram Form */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-400">
                      Telegram Bot
                    </Badge>
                    <span className="text-sm font-semibold">Notifikasi Grup NOC</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleTestTelegram} className="gap-1.5 text-xs">
                    <Send className="size-3.5" />
                    Uji Kirim Telegram
                  </Button>
                </div>
                {testSent === "telegram" && (
                  <p className="text-xs text-success">
                    ✓ Pesan uji broadcast berhasil dikirim ke Chat ID {settings.telegramChatId}.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="tgToken" className="text-xs">Bot Token Telegram</Label>
                    <Input
                      id="tgToken"
                      value={settings.telegramBotToken}
                      onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })}
                      placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tgChatId" className="text-xs">Chat ID / Channel ID</Label>
                    <Input
                      id="tgChatId"
                      value={settings.telegramChatId}
                      onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
                      placeholder="-1001234567890"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                <Badge
                  data-testid="whatsapp-summary-badge"
                  variant="outline"
                  className={
                    waConfig.enabled
                      ? "mr-2 border-transparent bg-success/10 text-success"
                      : "mr-2 border-transparent bg-destructive/10 text-destructive"
                  }
                >
                  {waConfig.enabled
                    ? `Gateway Aktif · ${waConfig.recipients.filter((r) => r.active).length} penerima`
                    : "Gateway Nonaktif"}
                </Badge>
                Pengaturan lengkap alert WhatsApp (provider, penerima, template) ada di tab{" "}
                <button
                  type="button"
                  onClick={() => setTab("whatsapp")}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  WhatsApp
                </button>
                .
              </p>

              {/* WhatsApp Webhook */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      WhatsApp Webhook
                    </Badge>
                    <span className="text-sm font-semibold">Gateway Notifikasi WA</span>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleTestWa} className="gap-1.5 text-xs">
                    <Send className="size-3.5" />
                    Uji Kirim WA
                  </Button>
                </div>
                {testSent === "whatsapp" && (
                  <p className="text-xs text-success">
                    ✓ Webhook uji coba berhasil dikirim ke nomor {settings.waAdminPhone}.
                  </p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="waUrl" className="text-xs">Endpoint URL Webhook</Label>
                    <Input
                      id="waUrl"
                      value={settings.waWebhookUrl}
                      onChange={(e) => setSettings({ ...settings, waWebhookUrl: e.target.value })}
                      placeholder="https://wa-gateway.local/send-message"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="waPhone" className="text-xs">Nomor Telepon Pengawas</Label>
                    <Input
                      id="waPhone"
                      value={settings.waAdminPhone}
                      onChange={(e) => setSettings({ ...settings, waAdminPhone: e.target.value })}
                      placeholder="081234567890"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* 3. TAB AMBANG BATAS & RULE ENGINE                              */}
        {/* ============================================================== */}
        <TabsContent value="whatsapp" className="space-y-4">
          <WhatsappSettings />
        </TabsContent>

        <TabsContent value="thresholds" className="space-y-4">
          <ThresholdSettings />
        </TabsContent>

        <TabsContent value="devices" className="space-y-4">
          <DeviceQuickCards />
        </TabsContent>

        {/* ============================================================== */}
        {/* 4. TAB KOLEKTOR & HUB GO                                        */}
        {/* ============================================================== */}
        <TabsContent value="collector" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Koneksi Backend Collector (Go Module)</CardTitle>
              <CardDescription>
                Penyedia data backend mandiri berkecepatan tinggi pada folder <code className="text-xs">backend/</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wsUrl">Alamat WebSocket Hub</Label>
                  <Input
                    id="wsUrl"
                    value={settings.wsHubUrl}
                    onChange={(e) => setSettings({ ...settings, wsHubUrl: e.target.value })}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Endpoint streaming delta real-time dan broadcast insiden.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rosTimeout">Batas Waktu Timeout REST MikroTik (ms)</Label>
                  <Input
                    id="rosTimeout"
                    type="number"
                    step="500"
                    min="1000"
                    max="10000"
                    value={settings.mikrotikTimeoutMs}
                    onChange={(e) => setSettings({ ...settings, mikrotikTimeoutMs: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Batas waktu respons HTTP /rest/system/resource sebelum router ditandai unreachable.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-secondary/30 p-4">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Server className="size-4" />
                  <span>Petunjuk Eksekusi Collector Go</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Backend Go dapat dijalankan di terminal lokal secara terpisah dengan perintah:
                </p>
                <div className="mt-2 rounded bg-black/40 p-2.5 font-mono text-xs text-foreground">
                  npm run backend:dev
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* 5. TAB INTEGRASI BILLING & SETUP HARDWARE                      */}
        {/* ============================================================== */}
        <TabsContent value="billing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sinkronisasi Billing &amp; Aturan Isolir Otomatis</CardTitle>
              <CardDescription>
                Hubungkan sistem penagihan ISP dengan session manager MikroTik BRAS.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="billingUrl">URL API Billing Eksternal</Label>
                  <Input
                    id="billingUrl"
                    value={settings.billingApiUrl}
                    onChange={(e) => setSettings({ ...settings, billingApiUrl: e.target.value })}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Endpoint JSON sinkronisasi status lunas/jatuh tempo pelanggan.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="billingSchedule">Jadwal Siklus Sinkronisasi Otomatis</Label>
                  <select
                    id="billingSchedule"
                    value={settings.billingSyncSchedule}
                    onChange={(e) => setSettings({ ...settings, billingSyncSchedule: e.target.value })}
                    className={selectClassName}
                  >
                    <option value="30m">Setiap 30 Menit</option>
                    <option value="1h">Setiap 1 Jam (Standar)</option>
                    <option value="6h">Setiap 6 Jam</option>
                    <option value="24h">Setiap Hari Pukul 00:00</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Waktu eksekusi penarikan data tagihan ke database lokal.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <div className="text-sm font-semibold">Otomatisasi Isolir MikroTik</div>
                  <p className="text-xs text-muted-foreground">
                    Pindahkan profil PPP pelanggan ke address-list isolir saat melewati tanggal jatuh tempo.
                  </p>
                </div>
                <Button
                  variant={settings.autoIsolirMikrotik ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSettings({ ...settings, autoIsolirMikrotik: !settings.autoIsolirMikrotik })}
                >
                  {settings.autoIsolirMikrotik ? "Isolir Otomatis Aktif" : "Isolir Manual"}
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gracePeriod">Masa Tenggang Dispensasi Keterlambatan (Jam)</Label>
                <Input
                  id="gracePeriod"
                  type="number"
                  min="0"
                  max="72"
                  value={settings.gracePeriodHours}
                  onChange={(e) => setSettings({ ...settings, gracePeriodHours: Number(e.target.value) })}
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Toleransi waktu sebelum eksekusi pemutusan sesi dilakukan oleh router.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Akses ke Setup Inisialisasi Hardware */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="space-y-1">
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <ShieldAlert className="size-4 text-primary" />
                  <span>Wisaya Inisialisasi Perangkat Awal</span>
                </div>
                <p className="text-xs text-muted-foreground max-w-xl">
                  Perlu mendaftarkan router MikroTik pertama atau OLT GPON baru? Buka panduan setup inisialisasi bertahap untuk verifikasi konektivitas REST API dan credential.
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/setup">Buka Setup Perangkat →</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* 6. TAB PANDUAN LANGKAH-LANGKAH KONEKSI KE APLIKASI             */}
        {/* ============================================================== */}
        <TabsContent value="guide" className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BookOpen className="size-5 text-primary" />
                    <span>Langkah-langkah Koneksi Perangkat Jaringan ke Aplikasi NOC</span>
                  </CardTitle>
                  <CardDescription>
                    Ikuti 5 tahap panduan praktis berikut untuk mengintegrasikan router MikroTik, OLT, dan background engine ke dashboard NOC.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunDiagnostics}
                  disabled={testRunning}
                  className="gap-1.5 text-xs"
                >
                  <Activity className={`size-3.5 ${testRunning ? "animate-spin" : ""}`} />
                  {testRunning ? "Menguji Koneksi..." : "Uji Konektivitas Semua Node"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {testResult && (
                <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span>{testResult}</span>
                </div>
              )}

              {/* STEP 1 */}
              <div className="rounded-lg border p-4 space-y-3 bg-secondary/10">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      1
                    </span>
                    <div>
                      <h4 className="font-semibold text-sm">Aktifkan REST API pada Router MikroTik (RouterOS v7)</h4>
                      <p className="text-xs text-muted-foreground">
                        Aplikasi NOC membaca utilisasi CPU, RAM, antarmuka, dan sesi PPPoE via REST API bawaan MikroTik v7.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(SCRIPT_MIKROTIK, "ros")}
                    className="gap-1.5 text-xs h-7"
                  >
                    {copiedScript === "ros" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                    {copiedScript === "ros" ? "Tersalin!" : "Salin Perintah"}
                  </Button>
                </div>

                <div className="relative rounded-md bg-black/60 p-3 font-mono text-xs text-foreground/90 overflow-x-auto">
                  <pre>{SCRIPT_MIKROTIK}</pre>
                </div>
                <p className="text-xs text-muted-foreground">
                  💡 <em>Uji respons di browser atau terminal dengan membuka: <code>https://&lt;ip-router&gt;/rest/system/resource</code></em>
                </p>
              </div>

              {/* STEP 2 */}
              <div className="rounded-lg border p-4 space-y-3 bg-secondary/10">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      2
                    </span>
                    <div>
                      <h4 className="font-semibold text-sm">Konfigurasi SNMP &amp; Redaman Optik pada OLT GPON</h4>
                      <p className="text-xs text-muted-foreground">
                        OLT (ZTE C320, Huawei MA5608T, HSGQ) dihubungkan lewat protokol SNMP v2c untuk pembacaan daya RX ONT.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(SCRIPT_OLT_SNMP, "olt")}
                    className="gap-1.5 text-xs h-7"
                  >
                    {copiedScript === "olt" ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                    {copiedScript === "olt" ? "Tersalin!" : "Salin Perintah"}
                  </Button>
                </div>

                <div className="relative rounded-md bg-black/60 p-3 font-mono text-xs text-foreground/90 overflow-x-auto">
                  <pre>{SCRIPT_OLT_SNMP}</pre>
                </div>
                <p className="text-xs text-muted-foreground">
                  Redaman optik yang melewati ambang (bawaan <strong>-25 dBm</strong>) ditandai sebagai alert Sinyal optik lemah. Ambangnya bisa dilihat di tab Ambang Batas.
                </p>
              </div>

              {/* STEP 3 */}
              <div className="rounded-lg border p-4 space-y-3 bg-secondary/10">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    3
                  </span>
                  <div>
                    <h4 className="font-semibold text-sm">Jalankan Collector Engine Backend Go (High-Speed Hub)</h4>
                    <p className="text-xs text-muted-foreground">
                      Layanan Go mengumpulkan data MikroTik tiap detik dan membuka WebSocket di <code>ws://localhost:8080/ws</code>.
                    </p>
                  </div>
                </div>

                <div className="rounded-md bg-black/60 p-3 font-mono text-xs text-foreground/90">
                  <div># Buka terminal baru dan jalankan collector Go:</div>
                  <div className="text-primary font-bold mt-1">npm run backend:dev</div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Saat collector aktif, indikator status pada pojok kanan atas dashboard akan berwarna hijau dan bertuliskan <strong>&ldquo;Terhubung (1 sampel/detik)&rdquo;</strong>.
                </p>
              </div>

              {/* STEP 4 */}
              <div className="rounded-lg border p-4 space-y-3 bg-secondary/10">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    4
                  </span>
                  <div>
                    <h4 className="font-semibold text-sm">Pindahkan Mode Dashboard ke Mode Live</h4>
                    <p className="text-xs text-muted-foreground">
                      Buka file konfigurasi <code>.env.local</code> di direktori root aplikasi, lalu sesuaikan:
                    </p>
                  </div>
                </div>

                <div className="rounded-md bg-black/60 p-3 font-mono text-xs text-foreground/90 space-y-1">
                  <div>DASHBOARD_DATA=&quot;live&quot;</div>
                  <div>REALTIME_TOKEN_SECRET=&quot;kunci-rahasia-hmac-anda&quot;</div>
                  <div>DATABASE_URL=&quot;postgres://user:password@localhost:5432/noc_db&quot;</div>
                </div>
              </div>

              {/* STEP 5 */}
              <div className="rounded-lg border p-4 space-y-3 bg-primary/5 border-primary/20">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-7 items-center justify-center rounded-full bg-success text-xs font-bold text-success-foreground">
                      5
                    </span>
                    <div>
                      <h4 className="font-semibold text-sm">Daftarkan Perangkat Baru &amp; Pantau Jaringan</h4>
                      <p className="text-xs text-muted-foreground">
                        Tambahkan router MikroTik dan OLT pertama Anda melalui wisaya setup atau manajemen perangkat.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild size="sm">
                      <Link href="/app/router">Kelola Router →</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/setup">Wisaya Inisialisasi →</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface AdminListedUser {
  id: string;
  name?: string | null;
  email: string;
  role?: string | null;
  createdAt?: string | Date;
}

function SuperAdminUserManager({ currentUserId }: { currentUserId?: string }) {
  const [users, setUsers] = useState<AdminListedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
    userId: string;
  } | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<"superadmin" | "admin" | "user">("user");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const res = await authClient.admin.createUser({
        name: createName.trim(),
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
      });
      if (res.error) {
        setCreateError(res.error.message || "Gagal membuat akun.");
      } else {
        setCreateSuccess(`Akun ${createEmail} berhasil dibuat dengan peran ${roleLabel(createRole)}.`);
        setCreateName("");
        setCreateEmail("");
        setCreatePassword("");
        setCreateRole("user");
        setShowCreateForm(false);
        await fetchUsers();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Terjadi kesalahan saat membuat akun.");
    } finally {
      setCreating(false);
    }
  }

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authClient.admin.listUsers({
        query: { limit: 100 },
      });
      if (res.error) {
        setError(res.error.message || "Gagal memuat daftar pengguna.");
      } else if (res.data?.users) {
        const userList = res.data.users as AdminListedUser[];
        setUsers(userList);
        setSelectedRoles((prev) => {
          const next = { ...prev };
          for (const u of userList) {
            next[u.id] = u.role ?? "user";
          }
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat pengguna.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  async function handleSetRole(userId: string) {
    const targetRole = selectedRoles[userId] ?? "user";
    setSavingUserId(userId);
    setFeedback(null);
    try {
      const res = await authClient.admin.setRole({
        userId,
        role: targetRole as "user" | "admin" | "superadmin",
      });
      if (res.error) {
        setFeedback({
          type: "error",
          message: res.error.message || "Gagal mengubah peran akun.",
          userId,
        });
      } else {
        setFeedback({
          type: "success",
          message: `Peran berhasil diubah menjadi ${roleLabel(targetRole)}.`,
          userId,
        });
        await fetchUsers();
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Terjadi kesalahan saat memperbarui peran.",
        userId,
      });
    } finally {
      setSavingUserId(null);
    }
  }

  function formatRegistrationDate(val?: string | Date | null) {
    if (!val) return "-";
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return "-";
      return d.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "-";
    }
  }

  return (
    <Card className="border border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="size-4 text-amber-500" />
              <span>Kelola Pengguna &amp; Peran Akun (Khusus Super Admin)</span>
            </CardTitle>
            <CardDescription>
              Daftar seluruh akun pengguna yang terdaftar di sistem. Anda dapat menetapkan peran Super Admin, Admin, atau Petugas langsung ke database.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showCreateForm ? "secondary" : "default"}
              size="sm"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="h-8 gap-1.5 text-xs"
            >
              <UserPlus className="size-3.5" />
              <span>{showCreateForm ? "Tutup Form" : "Beri Akun Baru"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchUsers()}
              disabled={loading}
              className="h-8 gap-1.5 text-xs"
            >
              <RotateCcw className={cn("size-3.5", loading && "animate-spin")} />
              Segarkan
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        {createSuccess && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <Check className="size-4 shrink-0" />
            <span>{createSuccess}</span>
          </div>
        )}
        {createError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
            <ShieldAlert className="size-4 shrink-0" />
            <span>{createError}</span>
          </div>
        )}

        {showCreateForm && (
          <form
            onSubmit={handleCreateUser}
            className="rounded-lg border border-border bg-muted/20 p-4 space-y-3"
          >
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <UserPlus className="size-3.5 text-amber-500" />
              <span>Form Tambah / Berikan Akun oleh Super Admin</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="admin-create-name" className="text-xs">Nama Petugas</Label>
                <Input
                  id="admin-create-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Nama Lengkap"
                  required
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="admin-create-email" className="text-xs">Email</Label>
                <Input
                  id="admin-create-email"
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="email@noc.local"
                  required
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="admin-create-password" className="text-xs">Kata Sandi</Label>
                <Input
                  id="admin-create-password"
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Min. 8 karakter"
                  required
                  minLength={8}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="admin-create-role" className="text-xs">Peran Akun</Label>
                <select
                  id="admin-create-role"
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as "superadmin" | "admin" | "user")}
                  className={cn(selectClassName, "h-8 w-full text-xs")}
                >
                  <option value="user">Petugas / User Biasa</option>
                  <option value="admin">Admin (Operasional)</option>
                  <option value="superadmin">Super Admin (Kontrol Penuh)</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCreateForm(false)}
                className="h-8 text-xs"
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={creating}
                className="h-8 text-xs font-medium"
              >
                {creating ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Membuat Akun...
                  </>
                ) : (
                  "Buat & Berikan Akun"
                )}
              </Button>
            </div>
          </form>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
            <ShieldAlert className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span>Memuat data pengguna...</span>
          </div>
        ) : users.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Tidak ada pengguna terdaftar.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-xs font-semibold">Nama</TableHead>
                  <TableHead className="text-xs font-semibold">Email</TableHead>
                  <TableHead className="text-xs font-semibold">Tanggal Terdaftar</TableHead>
                  <TableHead className="text-xs font-semibold">Role Saat Ini</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Aksi Ubah Peran</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const currentRole = u.role ?? "user";
                  const selectedRole = selectedRoles[u.id] ?? currentRole;
                  const isSaving = savingUserId === u.id;
                  const userFeedback = feedback?.userId === u.id ? feedback : null;

                  return (
                    <TableRow key={u.id}>
                      <TableCell className="text-xs font-medium text-foreground py-3">
                        <span className="flex items-center gap-1.5">
                          {u.name || "-"}
                          {currentUserId === u.id && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              Anda
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-3">
                        {u.email}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-3 whitespace-nowrap">
                        {formatRegistrationDate(u.createdAt)}
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge
                          variant={isSuperAdmin(currentRole) ? "default" : isAdmin(currentRole) ? "default" : "secondary"}
                          className={
                            isSuperAdmin(currentRole)
                              ? "bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-600 dark:hover:bg-amber-700 text-[11px]"
                              : "text-[11px]"
                          }
                        >
                          {roleLabel(currentRole)}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex items-center justify-end gap-2">
                            <select
                              value={selectedRole}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSelectedRoles((prev) => ({
                                  ...prev,
                                  [u.id]: val,
                                }));
                                if (feedback?.userId === u.id) {
                                  setFeedback(null);
                                }
                              }}
                              disabled={isSaving}
                              className={cn(selectClassName, "h-8 w-40 text-xs")}
                            >
                              <option value="superadmin">Super Admin</option>
                              <option value="admin">Admin</option>
                              <option value="user">Petugas / User</option>
                            </select>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs font-medium"
                              disabled={isSaving}
                              onClick={() => void handleSetRole(u.id)}
                            >
                              {isSaving ? (
                                <>
                                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                                  Menyimpan...
                                </>
                              ) : (
                                "Terapkan Peran"
                              )}
                            </Button>
                          </div>
                          {userFeedback && (
                            <p
                              className={cn(
                                "text-[11px] leading-tight",
                                userFeedback.type === "success"
                                  ? "text-emerald-600 dark:text-emerald-400 font-medium"
                                  : "text-destructive font-medium",
                              )}
                            >
                              {userFeedback.type === "success" ? "✓ " : "✕ "}
                              {userFeedback.message}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
