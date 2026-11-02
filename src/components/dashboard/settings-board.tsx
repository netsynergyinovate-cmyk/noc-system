"use client";

import { useState, useEffect, useSyncExternalStore, useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Database,
  Gauge,
  Globe,
  KeyRound,
  Laptop,
  Loader2,
  MessageSquare,
  Radio,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  User,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeviceQuickCards } from "./device-quick-cards";
import { ThresholdSettings } from "./threshold-settings";
import { WhatsappSettings } from "./whatsapp-settings";
import { useSessionUser } from "@/components/session-provider";
import { isSuperAdmin, isAdmin, isDeveloper, isUser } from "@/lib/roles";
import { authClient } from "@/lib/auth-client";
import { soundEngine, type SoundSnapshot } from "@/lib/dashboard/sound-engine";
import { cn } from "cn";

interface UserRoleInfo {
  isSuperAdmin?: boolean;
  isDeveloper?: boolean;
  isUser?: boolean;
  isAdmin: boolean;
  role: string;
  email: string;
  name?: string;
  userId?: string;
}

interface RuntimeStatus {
  databaseConnected: boolean;
  databaseDestination: string;
  environmentInfo: {
    environment: "local" | "server";
    isLocalhost: boolean;
    host: string;
    label: string;
  };
  dbStats: {
    routers: number;
    olts: number;
    alerts: number;
  };
}

const SCRIPT_MIKROTIK = `# 1. Cek layanan REST dan PORT yang berlaku. JANGAN mengubah port: router bisa memakai port lain (mis. 8081)
# dan layanan lain bisa bergantung padanya. Isi port itu di form Router.
/ip service print where name~"www"
/ip service enable www
# HTTPS (www-ssl) butuh sertifikat valid: /ip service set www-ssl disabled=no certificate=<nama-sertifikat>
# Kolom address layanan harus memuat IP server NOC (TAMBAHKAN ke daftar yang ada, jangan mengganti).

# 2. Buat grup dengan izin monitoring
/user group add name=noc-agent policy=read,api,rest,test

# 3. Buat user operator NOC
/user add name=noc-monitor group=noc-agent password="StrongSecretPassword123"`;

const SCRIPT_OLT_SNMP = `# 1. Aktifkan SNMP Agent pada OLT (ZTE / Huawei / HSGQ)
snmp-server community nocpublic ro
snmp-server host 10.10.0.10 version 2c nocpublic
snmp-server enable traps`;

const serverSoundSnapshot: SoundSnapshot = { enabled: true, unlocked: false };

export function SettingsBoard() {
  const [tab, setTab] = useState("general");
  const [copiedScript, setCopiedScript] = useState<string | null>(null);

  // Status sistem riil dari backend & database
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);

  // Audio Alarm browser riil (terhubung langsung ke soundEngine)
  const soundSnapshot = useSyncExternalStore(
    soundEngine.subscribe,
    soundEngine.getSnapshot,
    () => serverSoundSnapshot,
  );

  // Peran akun login
  const sessionUser = useSessionUser();
  const [apiRoleInfo, setApiRoleInfo] = useState<UserRoleInfo | null>(null);

  const userRoleInfo = useMemo<UserRoleInfo | null>(() => {
    if (apiRoleInfo) return apiRoleInfo;
    if (!sessionUser) return null;
    const role = sessionUser.role ?? "user";
    return {
      userId: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      role,
      isSuperAdmin: isSuperAdmin(role),
      isAdmin: isAdmin(role),
      isDeveloper: isDeveloper(role),
      isUser: isUser(role),
    };
  }, [apiRoleInfo, sessionUser]);
  // Muat status runtime riil
  useEffect(() => {
    fetch("/api/settings/mode")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) {
          setRuntimeStatus(json.data);
        }
      })
      .catch(() => null);

    fetch("/api/settings/role")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) {
          setApiRoleInfo(json.data);
        }
      })
      .catch(() => null);
  }, []);

  // Form ganti kata sandi mandiri
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [changePasswordMsg, setChangePasswordMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleChangeOwnPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setChangePasswordMsg({
        type: "error",
        text: "Konfirmasi kata sandi baru tidak cocok.",
      });
      return;
    }
    setChangingPassword(true);
    setChangePasswordMsg(null);
    try {
      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (res.error) {
        setChangePasswordMsg({
          type: "error",
          text: res.error.message || "Gagal mengubah kata sandi.",
        });
      } else {
        setChangePasswordMsg({
          type: "success",
          text: "Kata sandi Anda berhasil diperbarui.",
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setTimeout(() => {
          setShowChangePassword(false);
          setChangePasswordMsg(null);
        }, 2000);
      }
    } catch (err) {
      setChangePasswordMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Terjadi kesalahan.",
      });
    } finally {
      setChangingPassword(false);
    }
  }

  function handleCopy(text: string, id: string) {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedScript(id);
      setTimeout(() => setCopiedScript(null), 2500);
    }
  }

  const isLocal = runtimeStatus?.environmentInfo?.isLocalhost ?? true;

  return (
    <div className="flex flex-col gap-5 max-w-7xl mx-auto">
      {/* Header Halaman Pengaturan Minimalis */}
      <div className="flex flex-col gap-2.5 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              Pengaturan Sistem NOC
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Konfigurasi operasional, ambang batas anomali, dan panduan perangkat.
            </p>
          </div>

          {/* Status Bar Minimalis */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "text-xs px-2.5 py-1 font-medium flex items-center gap-1.5",
                isLocal
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
              )}
            >
              {isLocal ? <Laptop className="size-3" /> : <Globe className="size-3" />}
              <span>{isLocal ? "Localhost" : "Server Remote"}</span>
            </Badge>
          </div>
        </div>
      </div>

      {/* Tabs Pengaturan Minimalis */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-4 grid w-full grid-cols-2 gap-1 group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-4 lg:grid-cols-8">
          <TabsTrigger value="general" className="gap-1.5 text-xs py-2">
            <Sliders className="size-3.5" />
            <span>Umum</span>
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5 text-xs py-2">
            <Bell className="size-3.5" />
            <span>Alarm &amp; Bot</span>
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5 text-xs py-2">
            <MessageSquare className="size-3.5" />
            <span>WhatsApp</span>
          </TabsTrigger>
          <TabsTrigger value="thresholds" className="gap-1.5 text-xs py-2">
            <Gauge className="size-3.5" />
            <span>Ambang Batas</span>
          </TabsTrigger>
          <TabsTrigger value="devices" className="gap-1.5 text-xs py-2">
            <Server className="size-3.5" />
            <span>Perangkat</span>
          </TabsTrigger>
          <TabsTrigger value="collector" className="gap-1.5 text-xs py-2">
            <Radio className="size-3.5" />
            <span>Kolektor &amp; Hub</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5 text-xs py-2">
            <CreditCard className="size-3.5" />
            <span>Billing</span>
          </TabsTrigger>
          <TabsTrigger value="guide" className="gap-1.5 text-xs py-2">
            <BookOpen className="size-3.5" />
            <span>Panduan</span>
          </TabsTrigger>
        </TabsList>

        {/* ============================================================== */}
        {/* 1. TAB UMUM                                                    */}
        {/* ============================================================== */}
        <TabsContent value="general" className="space-y-4">
          {/* Ringkasan Operasional Database PostgreSQL */}
          {runtimeStatus?.dbStats && (
            <Card className="border border-border/60 bg-card shadow-xs">
              <CardHeader className="pb-2.5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Database className="size-4 text-emerald-500" />
                  <span>Ringkasan Data Operasional</span>
                </CardTitle>
                <CardDescription className="text-xs">
                  Jumlah entitas jaringan aktif yang tersimpan dan terpantau di sistem.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border bg-muted/20 p-2.5 text-xs space-y-0.5">
                    <span className="text-muted-foreground text-[11px]">Router MikroTik</span>
                    <div className="text-base font-bold text-foreground font-mono">
                      {runtimeStatus.dbStats.routers}
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-2.5 text-xs space-y-0.5">
                    <span className="text-muted-foreground text-[11px]">OLT GPON</span>
                    <div className="text-base font-bold text-foreground font-mono">
                      {runtimeStatus.dbStats.olts}
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-2.5 text-xs space-y-0.5">
                    <span className="text-muted-foreground text-[11px]">Total Alert Sistem</span>
                    <div className="text-base font-bold text-foreground font-mono">
                      {runtimeStatus.dbStats.alerts}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Profil Akun & Hak Akses */}
          <Card className="border border-border/60 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <span>Akun Aktif &amp; Hak Akses</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Tingkat wewenang akun Anda dalam operasional dan konfigurasi sistem.
                  </CardDescription>
                </div>
                {userRoleInfo && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "px-2.5 py-0.5 text-xs font-semibold",
                      userRoleInfo.isSuperAdmin
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : userRoleInfo.isDeveloper
                          ? "border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-400"
                          : userRoleInfo.isAdmin
                            ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            : "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400",
                    )}
                  >
                    {userRoleInfo.isSuperAdmin
                      ? "SUPER ADMIN"
                      : userRoleInfo.isDeveloper
                        ? "DEVELOPER"
                        : userRoleInfo.isAdmin
                          ? "ADMINISTRATOR"
                          : "PETUGAS"}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <User className="size-4 text-muted-foreground" />
                  <span className="font-semibold text-foreground">
                    {userRoleInfo?.email ?? "Sedang memuat..."}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowChangePassword((prev) => !prev)}
                    className="h-7 text-xs gap-1.5"
                  >
                    <KeyRound className="size-3" />
                    <span>{showChangePassword ? "Tutup Form" : "Ganti Kata Sandi"}</span>
                  </Button>

                  <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                    <Link href="/app/pengaturan/akun">
                      <Users className="size-3 text-amber-500" />
                      <span>Manajemen Akun</span>
                      <ArrowRight className="size-3" />
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Form Ganti Kata Sandi */}
              {showChangePassword && (
                <form
                  onSubmit={handleChangeOwnPassword}
                  className="rounded-lg border bg-muted/20 p-3 space-y-3"
                >
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <KeyRound className="size-3.5 text-primary" />
                    <span>Perbarui Kata Sandi Akun</span>
                  </div>
                  {changePasswordMsg && (
                    <div
                      className={cn(
                        "rounded-md p-2 text-xs flex items-center gap-2",
                        changePasswordMsg.type === "success"
                          ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                    >
                      {changePasswordMsg.type === "success" ? (
                        <Check className="size-3.5 shrink-0" />
                      ) : (
                        <ShieldAlert className="size-3.5 shrink-0" />
                      )}
                      <span>{changePasswordMsg.text}</span>
                    </div>
                  )}
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="current-pass" className="text-xs">Sandi Saat Ini</Label>
                      <Input
                        id="current-pass"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Kata sandi aktif"
                        required
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="new-pass" className="text-xs">Sandi Baru</Label>
                      <Input
                        id="new-pass"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min. 8 karakter"
                        required
                        minLength={8}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="confirm-pass" className="text-xs">Ulangi Sandi Baru</Label>
                      <Input
                        id="confirm-pass"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Ulangi sandi baru"
                        required
                        minLength={8}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowChangePassword(false)}
                      className="h-7 text-xs"
                    >
                      Batal
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={changingPassword}
                      className="h-7 text-xs font-medium"
                    >
                      {changingPassword ? (
                        <>
                          <Loader2 className="mr-1.5 size-3 animate-spin" />
                          Menyimpan...
                        </>
                      ) : (
                        "Simpan Sandi"
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* 2. TAB ALARM & BOT                                             */}
        {/* ============================================================== */}
        <TabsContent value="alerts" className="space-y-4">
          {/* Suara Alarm Browser Riil */}
          <Card className="border border-border/60 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Volume2 className="size-4 text-primary" />
                <span>Pengaturan Suara Alarm Audio Browser</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Peringatan audio peramban saat terdeteksi gangguan kritis jaringan secara real-time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-secondary text-foreground">
                    {soundSnapshot.enabled ? (
                      <Volume2 className="size-4 text-emerald-500" />
                    ) : (
                      <VolumeX className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold">
                      Status Audio: {soundSnapshot.enabled ? "Aktif" : "Dimatikan"}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {soundSnapshot.enabled
                        ? soundSnapshot.unlocked
                          ? "Audio Web siap membunyikan peringatan saat alert kritis masuk."
                          : "Menunggu interaksi klik di halaman untuk izin audio browser."
                        : "Alarm audio browser saat ini dibisukan."}
                    </p>
                  </div>
                </div>

                <Button
                  variant={soundSnapshot.enabled ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void soundEngine.setEnabled(!soundSnapshot.enabled)}
                >
                  {soundSnapshot.enabled ? "Matikan Alarm" : "Aktifkan Alarm"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Telegram Bot - Coming Soon */}
          <Card className="border border-border/60 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Send className="size-4 text-sky-500" />
                    <span>Integrasi Bot Telegram NOC</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Broadcast insiden kritis ke channel atau grup koordinasi teknisi via Telegram.
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold px-2.5 py-0.5 text-xs flex items-center gap-1"
                >
                  <Clock className="size-3" />
                  <span>Coming Soon</span>
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-1">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3.5 text-xs text-muted-foreground leading-relaxed">
                Fitur integrasi bot Telegram untuk broadcast insiden dan eskalasi anomali jaringan sedang dalam tahap pengembangan (Coming Soon) dan akan dirilis pada pembaruan berikutnya bersamaan dengan integrasi WhatsApp.
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* 3. TAB WHATSAPP                                                */}
        {/* ============================================================== */}
        <TabsContent value="whatsapp" className="space-y-4">
          <WhatsappSettings />
        </TabsContent>

        {/* ============================================================== */}
        {/* 4. TAB AMBANG BATAS                                            */}
        {/* ============================================================== */}
        <TabsContent value="thresholds" className="space-y-4">
          <ThresholdSettings />
        </TabsContent>

        {/* ============================================================== */}
        {/* 5. TAB PERANGKAT                                               */}
        {/* ============================================================== */}
        <TabsContent value="devices" className="space-y-4">
          <DeviceQuickCards />
        </TabsContent>

        {/* ============================================================== */}
        {/* 6. TAB KOLEKTOR & HUB                                          */}
        {/* ============================================================== */}
        <TabsContent value="collector" className="space-y-4">
          <Card className="border border-border/60 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Radio className="size-4 text-primary" />
                <span>Koneksi Backend Collector (Go Module)</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Layanan pengumpul telemetri mandiri berkecepatan tinggi pada direktori <code className="text-xs font-mono">backend/</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <div className="rounded-lg border bg-muted/20 p-3.5 text-xs text-muted-foreground leading-relaxed space-y-2">
                <p>
                  Collector Go secara mandiri membaca utilisasi CPU/RAM MikroTik, traffic queue, port VLAN, dan SNMP OLT setiap detik, lalu mengalirkan delta data secara langsung melalui protokol WebSocket streaming.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] text-foreground">
                  <span className="text-muted-foreground">Perintah jalankan backend:</span>
                  <code className="bg-black/60 px-2 py-0.5 rounded text-primary font-bold">npm run backend:dev</code>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* 7. TAB BILLING                                                 */}
        {/* ============================================================== */}
        <TabsContent value="billing" className="space-y-4">
          <Card className="border border-border/60 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <CreditCard className="size-4 text-primary" />
                  <span>Sinkronisasi Billing &amp; Aturan Isolir Router</span>
                </CardTitle>
                <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <Link href="/app/pelanggan">
                    <span>Lihat Pelanggan</span>
                    <ArrowRight className="size-3" />
                  </Link>
                </Button>
              </div>
              <CardDescription className="text-xs">
                Integrasi status penagihan pelanggan dan pemutusan otomatis profil PPPoE.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-1">
              <div className="rounded-lg border bg-muted/20 p-3 text-xs space-y-2">
                <div className="font-semibold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  <span>Mekanisme Isolir: Router MikroTik Didahulukan</span>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Status isolir ditentukan secara real-time berdasarkan address-list <code>isolir</code> pada MikroTik BRAS yang diperiksa oleh poller Go setiap 5 detik. Data billing eksternal disinkronkan secara terjadwal melalui variabel lingkungan <code className="font-mono">BILLING_URL</code>.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================== */}
        {/* 8. TAB PANDUAN KONEKSI                                         */}
        {/* ============================================================== */}
        <TabsContent value="guide" className="space-y-4">
          <Card className="border border-border/60 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BookOpen className="size-4 text-primary" />
                <span>Panduan Cepat Integrasi Perangkat ke NOC</span>
              </CardTitle>
              <CardDescription className="text-xs">
                Perintah standar untuk mengaktifkan REST API MikroTik dan SNMP OLT GPON.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              {/* Langkah 1 */}
              <div className="rounded-lg border bg-muted/10 p-3.5 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      1
                    </span>
                    <span className="text-xs font-semibold">
                      Aktifkan REST API RouterOS v7 (MikroTik)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(SCRIPT_MIKROTIK, "ros")}
                    className="h-6 text-[11px] gap-1"
                  >
                    {copiedScript === "ros" ? (
                      <Check className="size-3 text-emerald-500" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    <span>{copiedScript === "ros" ? "Tersalin" : "Salin Script"}</span>
                  </Button>
                </div>
                <pre className="rounded bg-black/60 p-2.5 font-mono text-[11px] text-foreground/90 overflow-x-auto">
                  {SCRIPT_MIKROTIK}
                </pre>
              </div>

              {/* Langkah 2 */}
              <div className="rounded-lg border bg-muted/10 p-3.5 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      2
                    </span>
                    <span className="text-xs font-semibold">
                      Konfigurasi SNMP OLT GPON (HSGQ / ZTE / Huawei)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(SCRIPT_OLT_SNMP, "olt")}
                    className="h-6 text-[11px] gap-1"
                  >
                    {copiedScript === "olt" ? (
                      <Check className="size-3 text-emerald-500" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    <span>{copiedScript === "olt" ? "Tersalin" : "Salin Script"}</span>
                  </Button>
                </div>
                <pre className="rounded bg-black/60 p-2.5 font-mono text-[11px] text-foreground/90 overflow-x-auto">
                  {SCRIPT_OLT_SNMP}
                </pre>
              </div>

              {/* Langkah 3 */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-semibold">Daftarkan Perangkat Baru:</span>
                  <span className="text-muted-foreground ml-1.5">
                    Gunakan antarmuka manajemen untuk menambah router atau OLT.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" className="h-7 text-xs">
                    <Link href="/app/router">Kelola Router →</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                    <Link href="/setup">Wisaya Setup →</Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
