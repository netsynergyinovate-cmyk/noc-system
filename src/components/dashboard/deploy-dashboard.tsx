"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Server,
  ShieldCheck,
  Terminal,
  RotateCcw,
  Play,
  Key,
  Network,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  Eye,
  Trash2,
  Lock,
  Layers,
  ArrowRight,
  Database,
  ExternalLink,
  ShieldAlert,
  Copy,
  Check,
} from "lucide-react";
import type { DeployTarget } from "@/db/schema/deploy-targets";
import type { NetworkDetectionResult } from "@/services/deploy-targets.service";
import type { SshCredentialMeta } from "@/services/ssh-credentials.service";
import type { DeployRun, DeployStep, DeployRelease, DeployWriteGuardLog } from "@/db/schema/deploy-runs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

interface DeployDashboardProps {
  initialTarget: DeployTarget | null;
  initialDetection: NetworkDetectionResult | null;
}

export function DeployDashboard({ initialTarget, initialDetection }: DeployDashboardProps) {
  const [target, setTarget] = useState<DeployTarget | null>(initialTarget);
  const [detection, setDetection] = useState<NetworkDetectionResult | null>(initialDetection);
  const [sshMeta, setSshMeta] = useState<SshCredentialMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  // Dialog Edit Target
  const [editTargetOpen, setEditTargetOpen] = useState(false);
  const [targetForm, setTargetForm] = useState({
    nama: target?.nama || "SERVER NATIVE",
    host: target?.host || "",
    port: target?.port || 22,
    sshUser: target?.sshUser || "ubuntu",
    mode: target?.mode || "lan",
    tailscaleHost: target?.tailscaleHost || "",
  });

  // Dialog Kunci SSH
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [sshKeyForm, setSshKeyForm] = useState({ privateKey: "", passphrase: "" });
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  }

  // Dialog Konfirmasi Hapus Kunci
  const [deleteKeyConfirmOpen, setDeleteKeyConfirmOpen] = useState(false);

  // Uji SSH
  const [testingSsh, setTestingSsh] = useState(false);
  const [sshTestResult, setSshTestResult] = useState<{
    success: boolean;
    message: string;
    category?: string;
  } | null>(null);

  // Dry Run State
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{
    ready: boolean;
    checks: Array<{ id: string; name: string; status: string; detail: string }>;
  } | null>(null);

  // Deploy Execution State
  const [deployConfirmOpen, setDeployConfirmOpen] = useState(false);
  const [deployRunning, setDeployRunning] = useState(false);
  const [activeDeploySteps, setActiveDeploySteps] = useState<DeployStep[]>([]);
  const [deployFinishedResult, setDeployFinishedResult] = useState<{
    success: boolean;
    message: string;
    autoRollbackTriggered?: boolean;
  } | null>(null);

  // Riwayat & Releases State
  const [runs, setRuns] = useState<DeployRun[]>([]);
  const [releases, setReleases] = useState<DeployRelease[]>([]);
  const [selectedRunDetail, setSelectedRunDetail] = useState<{
    run: DeployRun;
    steps: DeployStep[];
  } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Rollback Manual Dialog
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const [rollbackTargetVersion, setRollbackTargetVersion] = useState<string>("");
  const [rollbackExecuting, setRollbackExecuting] = useState(false);

  // Mode Akses Perangkat & Write Guard
  const [accessLevel, setAccessLevel] = useState<string>(target?.deviceAccessLevel || "simulator");
  const [writeGuardLogs, setWriteGuardLogs] = useState<DeployWriteGuardLog[]>([]);

  // HTTP Server Monitor State (tanpa SSH)
  const [serverUrl, setServerUrl] = useState(() => (target?.host ? `http://${target.host}:3000` : ""));
  const [monitorToken, setMonitorToken] = useState("");
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [serverData, setServerData] = useState<{
    ok: boolean;
    activeVersion?: string;
    rollbackTarget?: string | null;
    services?: { web: string; backend: string; postgres: string };
    recentRuns?: DeployRun[];
    recentErrors?: string[];
    updatedAt?: string;
  } | null>(null);

  async function fetchServerStatus(url = serverUrl, token = monitorToken, showNotice = true) {
    if (!url) return;
    setMonitoringLoading(true);
    try {
      const q = new URLSearchParams({ url });
      if (token) q.set("token", token);
      const res = await fetch(`/api/deploy/proxy-status?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setServerData(json);
      } else {
        const errJson = await res.json().catch(() => null);
        if (showNotice) {
          setNotice({ type: "error", msg: errJson?.error || `Server merespons status ${res.status}` });
        }
      }
    } catch (err: unknown) {
      if (showNotice) {
        setNotice({ type: "error", msg: `Gagal menghubungi server di ${url}: ${err instanceof Error ? err.message : String(err)}` });
      }
    } finally {
      setMonitoringLoading(false);
    }
  }

  useEffect(() => {
    try {
      const savedUrl = localStorage.getItem("noc_monitor_server_url");
      const savedToken = localStorage.getItem("noc_monitor_token");
      const effectiveUrl = savedUrl || (target?.host ? `http://${target.host}:3000` : "");
      if (savedUrl) setServerUrl(savedUrl);
      if (savedToken) setMonitorToken(savedToken);
      if (effectiveUrl && savedToken) {
        fetchServerStatus(effectiveUrl, savedToken, false);
      }
    } catch {
      // ignore
    }
  }, [target?.host]);
  // Muat data pendukung saat mount
  useEffect(() => {
    loadSshMeta();
    loadHistory();
    loadReleases();
    loadWriteGuardLogs();
  }, []);

  async function loadSshMeta() {
    try {
      const res = await fetch("/api/deploy/ssh/credentials");
      if (res.ok) {
        const json = await res.json();
        setSshMeta(json.data);
      }
    } catch {
      // ignore
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`/api/deploy/history?status=${filterStatus}`);
      if (res.ok) {
        const json = await res.json();
        setRuns(json.data.runs);
      }
    } catch {
      // ignore
    }
  }

  async function loadReleases() {
    try {
      const res = await fetch("/api/deploy/releases");
      if (res.ok) {
        const json = await res.json();
        setReleases(json.data.releases);
      }
    } catch {
      // ignore
    }
  }

  async function loadWriteGuardLogs() {
    try {
      const res = await fetch("/api/deploy/write-guard/logs");
      if (res.ok) {
        const json = await res.json();
        setWriteGuardLogs(json.data);
      }
    } catch {
      // ignore
    }
  }

  async function handleSaveTarget(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/deploy/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...targetForm,
          port: Number(targetForm.port),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan target");

      setTarget(json.data.target);
      setDetection(json.data.detection);
      setEditTargetOpen(false);
      setNotice({ type: "success", msg: "Konfigurasi target SERVER NATIVE berhasil disimpan." });
    } catch (err: unknown) {
      setNotice({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSshKey(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch("/api/deploy/ssh/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sshKeyForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan kunci SSH");

      setSshMeta(json.data);
      setKeyModalOpen(false);
      setSshKeyForm({ privateKey: "", passphrase: "" });
      setNotice({ type: "success", msg: "Kunci privat SSH terenkripsi AES-256-GCM berhasil disimpan." });
    } catch (err: unknown) {
      setNotice({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSshKey() {
    try {
      const res = await fetch("/api/deploy/ssh/credentials", { method: "DELETE" });
      if (res.ok) {
        setSshMeta(null);
        setDeleteKeyConfirmOpen(false);
        setNotice({ type: "info", msg: "Kunci SSH berhasil dihapus dari database localhost." });
      }
    } catch {
      // ignore
    }
  }

  async function handleTestSsh() {
    setTestingSsh(true);
    setSshTestResult(null);
    try {
      const res = await fetch("/api/deploy/ssh/test", { method: "POST" });
      const json = await res.json();
      if (json.data?.testResult) {
        setSshTestResult(json.data.testResult);
        if (json.data.detection) setDetection(json.data.detection);
      } else {
        setSshTestResult({
          success: false,
          message: json.error || "Uji koneksi gagal.",
        });
      }
    } catch (err: unknown) {
      setSshTestResult({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestingSsh(false);
    }
  }

  async function handleRunDryRun() {
    setDryRunRunning(true);
    setDryRunResult(null);
    try {
      const res = await fetch("/api/deploy/dry-run", { method: "POST" });
      const json = await res.json();
      if (json.data) {
        setDryRunResult(json.data);
      } else {
        setNotice({ type: "error", msg: json.error || "Gagal menjalankan dry-run" });
      }
    } catch (err: unknown) {
      setNotice({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDryRunRunning(false);
      loadHistory();
    }
  }

  async function handleExecuteDeploy() {
    setDeployConfirmOpen(false);
    setDeployRunning(true);
    setDeployFinishedResult(null);
    setActiveDeploySteps([]);

    try {
      const res = await fetch("/api/deploy/execute", { method: "POST" });
      const json = await res.json();
      if (!res.ok && res.status !== 202) {
        throw new Error(json.error || "Gagal memulai deploy");
      }

      const runId = json.data?.runId;
      if (runId) {
        while (true) {
          await new Promise((r) => setTimeout(r, 1500));
          const detRes = await fetch(`/api/deploy/history?runId=${runId}`);
          if (detRes.ok) {
            const detJson = await detRes.json();
            const detail = detJson.data;
            if (detail?.steps) {
              setActiveDeploySteps(detail.steps);
            }
            if (detail?.run && detail.run.status !== "berjalan") {
              setDeployFinishedResult({
                success: detail.run.status === "berhasil",
                message:
                  detail.run.status === "berhasil"
                    ? `Deploy versi ${detail.run.versi} berhasil terpasang di SERVER NATIVE!`
                    : `Deploy selesai dengan status: ${detail.run.status}`,
                autoRollbackTriggered: detail.run.otomatis,
              });
              break;
            }
          }
        }
      }
    } catch (err: unknown) {
      setDeployFinishedResult({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeployRunning(false);
      loadHistory();
      loadReleases();
    }
  }

  async function handleManualRollback() {
    if (!rollbackTargetVersion) return;
    setRollbackExecuting(true);
    try {
      const res = await fetch("/api/deploy/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetVersion: rollbackTargetVersion, confirm: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || "Rollback gagal");

      setRollbackModalOpen(false);
      setNotice({ type: "success", msg: json.message });
      loadHistory();
      loadReleases();
    } catch (err: unknown) {
      setNotice({ type: "error", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setRollbackExecuting(false);
    }
  }

  async function handleUpdateDeviceAccess(level: string) {
    try {
      const res = await fetch("/api/deploy/device-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      if (res.ok) {
        setAccessLevel(level);
        setNotice({ type: "success", msg: `Tingkat akses perangkat diubah ke: ${level}` });
      }
    } catch {
      // ignore
    }
  }

  async function handleClearWriteGuardLogs() {
    try {
      const res = await fetch("/api/deploy/write-guard/logs", { method: "DELETE" });
      if (res.ok) {
        setWriteGuardLogs([]);
        setNotice({ type: "info", msg: "Log penolakan penjaga tulis telah dibersihkan." });
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12">
      {/* Header Halaman */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Deploy & Rilis SERVER NATIVE</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Pusat rilis aplikasi native (Next.js & Go systemd) via SSH ke server mandiri Ubuntu.
            Halaman ini eksklusif hanya berjalan di <span className="font-semibold text-foreground">localhost</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1 px-3 bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Loopback Localhost Aktif
          </Badge>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl p-4 text-sm flex items-center justify-between ${
            notice.type === "success"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
              : notice.type === "error"
                ? "bg-destructive/10 text-destructive border border-destructive/30"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/30"
          }`}
        >
          <span>{notice.msg}</span>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)} className="h-7 text-xs">
            Tutup
          </Button>
        </div>
      )}

      {/* Grid Ringkasan Target & Kredensial SSH */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Kartu 1: Target SERVER NATIVE */}
        <div className="rounded-xl border bg-card p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Target SERVER NATIVE
              </span>
              <Badge variant="secondary" className="capitalize">
                {target?.mode || "lan"}
              </Badge>
            </div>

            <div>
              <h2 className="text-lg font-bold">{target?.nama || "SERVER NATIVE"}</h2>
              <div className="mt-1 space-y-1 text-sm font-mono text-muted-foreground">
                <div>Host: <span className="text-foreground">{target ? `${target.host}:${target.port}` : "Belum diatur"}</span></div>
                <div>User: <span className="text-foreground">{target?.sshUser || "-"}</span></div>
                {target?.tailscaleHost && (
                  <div>Tailscale: <span className="text-foreground">{target.tailscaleHost}</span></div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t">
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setEditTargetOpen(true)}>
              Ubah Konfigurasi Target
            </Button>
          </div>
        </div>

        {/* Kartu 2: Jalur Koneksi & Deteksi Jaringan */}
        <div className="rounded-xl border bg-card p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Jalur Koneksi Terpilih
              </span>
              <Network className="h-4 w-4 text-muted-foreground" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold uppercase text-primary">
                  {detection?.resolvedMode || target?.mode || "LAN"}
                </span>
                {detection?.isManualOverride && (
                  <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                    Paksaan Manual
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                {detection?.reason ||
                  (target
                    ? "Jalur dievaluasi otomatis: LAN diprioritaskan saat di jaringan yang sama; Tailscale hanya dipakai saat di luar LAN."
                    : "Simpan target server untuk mengaktifkan deteksi jaringan otomatis.")}
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
            <span>LAN: {detection?.lanReachable ? "✓ Terjangkau" : "✗ Tidak aktif"}</span>
            {target?.tailscaleHost && (
              <span>Tailscale: {detection?.tailscaleReachable ? "✓ Aktif" : "✗ Offline"}</span>
            )}
          </div>
        </div>

        {/* Kartu 3: Kunci Privat SSH */}
        <div className="rounded-xl border bg-card p-5 shadow-xs flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Kunci SSH (AES-256-GCM)
              </span>
              <Key className="h-4 w-4 text-muted-foreground" />
            </div>

            <div>
              {sshMeta ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Kunci Tersimpan
                  </div>
                  <div className="text-xs font-mono text-muted-foreground break-all">
                    {sshMeta.fingerprint}
                  </div>
                  {sshMeta.hasPassphrase && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Memakai passphrase terenkripsi
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> Kunci belum dipasang
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setKeyModalOpen(true)}
            >
              {sshMeta ? "Ganti Kunci" : "Pasang Kunci"}
            </Button>
            {sshMeta && (
              <Button
                variant="destructive"
                size="sm"
                className="px-2"
                title="Hapus Kunci SSH"
                onClick={() => setDeleteKeyConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="text-xs"
              disabled={!sshMeta || testingSsh}
              onClick={handleTestSsh}
            >
              {testingSsh ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : "Uji SSH"}
            </Button>
          </div>
        </div>
      </div>

      {/* Banner Hasil Uji SSH */}
      {sshTestResult && (
        <div
          className={`rounded-xl p-4 text-sm flex flex-col gap-1 ${
            sshTestResult.success
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
              : "bg-destructive/10 text-destructive border border-destructive/30"
          }`}
        >
          <div className="font-semibold flex items-center gap-2">
            {sshTestResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {sshTestResult.success ? "Uji Koneksi SSH Berhasil" : "Uji Koneksi SSH Gagal"}
            {sshTestResult.category && (
              <Badge variant="outline" className="text-xs ml-auto">
                {sshTestResult.category}
              </Badge>
            )}
          </div>
          <div className="text-xs opacity-90">{sshTestResult.message}</div>
        </div>
      )}

      {/* Tabs Menu Utama */}
      <Tabs defaultValue="cli" className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 w-full">
          <TabsTrigger value="cli" className="text-xs gap-1.5 font-semibold text-primary">
            <Terminal className="h-3.5 w-3.5" /> CLI noc-system
          </TabsTrigger>
          <TabsTrigger value="deploy" className="text-xs gap-1.5">
            <Play className="h-3.5 w-3.5" /> Deploy & Rilis
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Riwayat & Bug
          </TabsTrigger>
          <TabsTrigger value="preflight" className="text-xs gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Kesiapan Server
          </TabsTrigger>
          <TabsTrigger value="config" className="text-xs gap-1.5">
            <Database className="h-3.5 w-3.5" /> Konfigurasi
          </TabsTrigger>
          <TabsTrigger value="access" className="text-xs gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" /> Penjaga Tulis
          </TabsTrigger>
        </TabsList>

        {/* TAB 0: CLI noc-system & Server Instructions */}
        <TabsContent value="cli" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs">
            <div className="border-b pb-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  CLI Mandiri Server Native
                </Badge>
                <span className="text-xs text-muted-foreground">Node.js CLI + Go Backend + Docker PostgreSQL</span>
              </div>
              <h3 className="text-lg font-bold mt-2">Pemantau Rilis Server, Versi & Pelacak Bug</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Aplikasi memantau SERVER NATIVE secara langsung melalui HTTP tanpa memerlukan kunci SSH dari dalam kontainer Docker lokal.
                Jalankan perintah CLI <strong>noc-system</strong> di terminal server Ubuntu untuk instalasi dan deployment rilis.
              </p>
            </div>

            {/* Panel Input URL Server & Refresh */}
            {/* Panel Input URL Server, Token & Refresh */}
            <div className="mt-4 p-4 rounded-lg border bg-muted/20 flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Alamat / Domain SERVER NATIVE:</Label>
                  <Input
                    value={serverUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setServerUrl(val);
                      try { localStorage.setItem("noc_monitor_server_url", val); } catch {}
                    }}
                    placeholder="http://192.168.1.100:3000 atau https://noc.domain.com"
                    className="text-xs font-mono h-8 bg-background mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Token Monitor (Wajib untuk Server):</Label>
                  <Input
                    type="password"
                    value={monitorToken}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMonitorToken(val);
                      try { localStorage.setItem("noc_monitor_token", val); } catch {}
                    }}
                    placeholder="Salin MONITOR_TOKEN dari /srv/noc/shared/.env"
                    className="text-xs font-mono h-8 bg-background mt-1"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 self-end md:self-auto pt-2 md:pt-4">
                <Button
                  variant="default"
                  size="sm"
                  className="text-xs h-8 gap-1.5"
                  disabled={monitoringLoading}
                  onClick={() => fetchServerStatus(serverUrl, monitorToken, true)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${monitoringLoading ? "animate-spin" : ""}`} />
                  Perbarui Status Server
                </Button>
              </div>
            </div>

            {/* Kartu Ringkasan Real-Time Server */}
            {serverData && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Versi Aktif */}
                <div className="rounded-lg border bg-background p-4 shadow-xs">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Versi Rilis di Server</span>
                  <div className="mt-2 text-base font-bold text-primary font-mono truncate">
                    {serverData.activeVersion || "Belum ada rilis"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Rollback target: <span className="font-mono text-foreground">{serverData.rollbackTarget || "Tidak ada"}</span>
                  </div>
                </div>

                {/* Status Layanan Systemd */}
                <div className="rounded-lg border bg-background p-4 shadow-xs">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Kesehatan Layanan Server</span>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span>Web (Next.js):</span>
                      <Badge variant={serverData.services?.web === "active" ? "default" : "destructive"} className="text-[10px] py-0">
                        {serverData.services?.web?.toUpperCase() || "INACTIVE"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Backend (Go):</span>
                      <Badge variant={serverData.services?.backend === "active" ? "default" : "destructive"} className="text-[10px] py-0">
                        {serverData.services?.backend?.toUpperCase() || "INACTIVE"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Docker PostgreSQL:</span>
                      <Badge variant={serverData.services?.postgres === "active" ? "default" : "destructive"} className="text-[10px] py-0">
                        {serverData.services?.postgres?.toUpperCase() || "INACTIVE"}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Status Monitoring HTTP */}
                <div className="rounded-lg border bg-background p-4 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Koneksi Pemantau (HTTP)</span>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Terhubung & Memantau</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Terakhir diperbarui: {serverData.updatedAt ? new Date(serverData.updatedAt).toLocaleTimeString() : "-"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Panel Pelacak Bug & Log Error Journalctl */}
            <div className="mt-4 rounded-lg border bg-zinc-950 text-zinc-100 p-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-semibold text-zinc-200">Pelacak Bug & Log Galat Server (Journalctl Errors)</span>
                </div>
                <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                  {serverData?.recentErrors?.length || 0} entri galat
                </Badge>
              </div>

              <div className="font-mono text-xs max-h-48 overflow-y-auto space-y-1 text-zinc-300">
                {serverData?.recentErrors && serverData.recentErrors.length > 0 ? (
                  serverData.recentErrors.map((err, idx) => (
                    <div key={idx} className="p-1.5 rounded bg-zinc-900/60 border border-zinc-800/60 text-red-300 break-all">
                      {err}
                    </div>
                  ))
                ) : (
                  <div className="text-zinc-500 py-3 text-center">
                    Tidak ada log galat fatal terbaru di server. Sistem berjalan normal.
                  </div>
                )}
              </div>
            </div>

            {/* Banner Perintah Bootstrap 1-Baris */}
            <div className="mt-6 p-4 rounded-lg border bg-primary/5 border-primary/20 space-y-3">
              <div>
                <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <Terminal className="h-4 w-4" /> Perintah Pasang Awal 1-Baris di Server Ubuntu (Bootstrap)
                </span>
                <p className="text-xs text-muted-foreground mt-1">
                  Jalankan perintah ini di server Ubuntu baru untuk memasang Docker CE, Node.js 22 LTS, Go Compiler, dan CLI noc-system otomatis:
                </p>
              </div>

              {/* Opsi 1: Perintah Standar (Publik) */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span>1. Perintah Standar (Hanya bila Repositori disetel Publik di GitHub)</span>
                </div>
                <div className="p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                  <code className="break-all">curl -fsSL https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo bash</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 ml-2"
                    onClick={() => copyToClipboard("curl -fsSL https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo bash", "bootstrap-public")}
                  >
                    {copiedCmd === "bootstrap-public" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {/* Opsi 2: Dengan GITHUB_TOKEN (Repositori Privat) */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span>2. Dengan GITHUB_TOKEN (Wajib untuk Repositori Privat Saat Ini)</span>
                  <Badge variant="outline" className="text-[10px] text-amber-500 bg-amber-500/10 border-amber-500/20">Private Repo (Aktif)</Badge>
                </div>
                <div className="p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                  <code className="break-all">{`export GITHUB_TOKEN="ghp_xxx" && curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo --preserve-env=GITHUB_TOKEN bash`}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 ml-2"
                    onClick={() => copyToClipboard(`export GITHUB_TOKEN="ghp_xxx" && curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo --preserve-env=GITHUB_TOKEN bash`, "bootstrap-token")}
                  >
                    {copiedCmd === "bootstrap-token" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  *Ganti <code className="text-primary font-mono">ghp_xxx</code> dengan Personal Access Token (PAT) GitHub yang memiliki izin read repositori.
                </p>
              </div>
            </div>

            {/* Daftar Perintah CLI */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Perintah 1: Install */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">1. Instalasi Awal 1-Perintah</span>
                    <Badge variant="secondary" className="text-[10px]">Setup</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Membuat hierarki /srv/noc, menyalakan Docker PostgreSQL (noc-postgres), memasang unit systemd, dan menjalankan migrasi skema awal.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs install</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => copyToClipboard("node bin/noc-system.mjs install", "install")}
                    >
                      {copiedCmd === "install" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 2: Deploy */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">2. Rilis Versi Baru (Deploy)</span>
                    <Badge variant="default" className="text-[10px]">Rilis</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Backup database otomatis, kompilasi Go backend, build standalone Next.js, migrasi database, swap symlink /srv/noc/current, dan restart layanan.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs deploy</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => copyToClipboard("node bin/noc-system.mjs deploy", "deploy")}
                    >
                      {copiedCmd === "deploy" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 3: Status */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">3. Cek Status Kesehatan Server</span>
                    <Badge variant="secondary" className="text-[10px]">Monitoring</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Memeriksa versi rilis aktif, status unit systemd noc-web dan noc-backend, kesehatan kontainer Docker PostgreSQL, dan probe HTTP.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs status</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => copyToClipboard("node bin/noc-system.mjs status", "status")}
                    >
                      {copiedCmd === "status" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 4: Logs */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">4. Pantau Bug & Live Log</span>
                    <Badge variant="secondary" className="text-[10px]">Diagnostik</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Menampilkan live streaming log journalctl dari kedua layanan noc-web dan noc-backend untuk pelacakan galat dan bug sistem.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs logs -n 50</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => copyToClipboard("node bin/noc-system.mjs logs -n 50", "logs")}
                    >
                      {copiedCmd === "logs" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 5: Rollback */}
              <div className="rounded-lg border bg-muted/40 p-4 md:col-span-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-destructive">5. Pemulihan Cepat (Rollback)</span>
                    <Badge variant="destructive" className="text-[10px]">Emergency</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Memutar balik symlink /srv/noc/current ke direktori rilis sebelumnya secara instan dan me-restart layanan. Skema database tetap pada hasil migrasi terakhir.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs rollback</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => copyToClipboard("node bin/noc-system.mjs rollback", "rollback")}
                    >
                      {copiedCmd === "rollback" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* TAB 1: Deploy & Rilis */}
        <TabsContent value="deploy" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
              <div>
                <h3 className="text-lg font-bold">Rilis Versi Aplikasi ke SERVER NATIVE</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Eksekusi berurutan: Pre-flight → Backup Database → Migrasi Aman → Kirim Konfigurasi → Unggah Rilis → Tukar Symlink → Restart Layanan → Health Check.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!target || !sshMeta || dryRunRunning || deployRunning}
                  onClick={handleRunDryRun}
                  className="gap-1.5 text-xs"
                >
                  {dryRunRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  Uji Kesiapan (Dry-run)
                </Button>

                <Button
                  size="sm"
                  disabled={!target || !sshMeta || deployRunning}
                  onClick={() => setDeployConfirmOpen(true)}
                  className="gap-1.5 text-xs bg-primary font-semibold"
                >
                  {deployRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Jalankan Deploy
                </Button>
              </div>
            </div>

            {/* Hasil Uji Kesiapan (Dry Run) */}
            {dryRunResult && (
              <div className="mt-6 rounded-xl border p-4 bg-muted/30">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {dryRunResult.ready ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    Hasil Dry-run: {dryRunResult.ready ? "Server Siap untuk Deploy" : "Server Belum Siap"}
                  </div>
                  <Badge variant={dryRunResult.ready ? "default" : "destructive"}>
                    {dryRunResult.ready ? "LULUS" : "GAGAL"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {dryRunResult.checks.map((c) => (
                    <div key={c.id} className="rounded-lg border bg-card p-2.5">
                      <div className="font-medium flex items-center gap-1.5">
                        {c.status === "lulus" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                        {c.status === "peringatan" && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                        {c.status === "gagal" && <XCircle className="h-3 w-3 text-destructive" />}
                        {c.name}
                      </div>
                      <div className="text-muted-foreground mt-1 pl-4.5">{c.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progres Langkah Deploy Aktif */}
            {(deployRunning || activeDeploySteps.length > 0) && (
              <div className="mt-6 space-y-4">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" /> Progres Rantai Deploy Berurutan
                </h4>

                <div className="space-y-2">
                  {[
                    "Pre-flight & Koneksi SSH",
                    "Backup Database Server",
                    "Bangun Artefak Rilis & Unggah",
                    "Migrasi Skema Database",
                    "Pemindahan Konfigurasi Localhost -> Server",
                    "Pencatatan Titik Balik Versi",
                    "Penukaran Symlink current (Atomik)",
                    "Restart Layanan systemd",
                    "Health Check Pasca-Deploy",
                  ].map((name, idx) => {
                    const stepNum = idx + 1;
                    const match = activeDeploySteps.find((s) => s.urutan === stepNum);
                    const status = match ? match.status : deployRunning && activeDeploySteps.length === idx ? "berjalan" : "menunggu";

                    return (
                      <div
                        key={name}
                        className={`rounded-lg border p-3 text-xs flex items-center justify-between ${
                          status === "berhasil"
                            ? "bg-emerald-500/5 border-emerald-500/20"
                            : status === "berjalan"
                              ? "bg-primary/5 border-primary/30"
                              : status === "gagal"
                                ? "bg-destructive/10 border-destructive/30"
                                : "bg-card text-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-muted-foreground w-5">{stepNum}.</span>
                          <span className="font-medium text-foreground">{name}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {status === "berhasil" && <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10">Berhasil</Badge>}
                          {status === "berjalan" && <Badge variant="outline" className="text-primary bg-primary/10 animate-pulse">Sedang Berjalan...</Badge>}
                          {status === "gagal" && <Badge variant="destructive">Gagal</Badge>}
                          {status === "menunggu" && <Badge variant="secondary">Menunggu</Badge>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Banner Penyelesaian Deploy */}
            {deployFinishedResult && (
              <div
                className={`mt-6 rounded-xl p-4 text-sm ${
                  deployFinishedResult.success
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                    : "bg-destructive/10 text-destructive border border-destructive/30"
                }`}
              >
                <div className="font-bold flex items-center gap-2">
                  {deployFinishedResult.success ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                  {deployFinishedResult.success ? "Deploy Berhasil Terpasang!" : "Deploy Gagal"}
                </div>
                <p className="mt-1 text-xs opacity-90">{deployFinishedResult.message}</p>
                {deployFinishedResult.autoRollbackTriggered && (
                  <div className="mt-2 text-xs font-semibold underline">
                    Rollback otomatis ke titik balik versi sebelumnya telah dieksekusi secara otomatis oleh sistem.
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: Riwayat & Rollback */}
        <TabsContent value="history" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
              <div>
                <h3 className="text-lg font-bold">Riwayat Rilis & Rollback Manual</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Catatan seluruh eksekusi deploy, rollback otomatis/manual, dan uji kesiapan.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRollbackModalOpen(true)}
                  className="gap-1.5 text-xs text-amber-600 dark:text-amber-400 border-amber-500/30"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Rollback Manual
                </Button>
                <Button variant="ghost" size="sm" onClick={loadHistory} className="h-8 px-2">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Filter Status */}
            <div className="flex gap-2">
              {["all", "berhasil", "gagal"].map((st) => (
                <Button
                  key={st}
                  variant={filterStatus === st ? "default" : "outline"}
                  size="sm"
                  className="text-xs capitalize h-7 px-3"
                  onClick={() => {
                    setFilterStatus(st);
                    setTimeout(loadHistory, 50);
                  }}
                >
                  {st === "all" ? "Semua Status" : st}
                </Button>
              ))}
            </div>

            {/* Tabel Riwayat */}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">Waktu Mulai</th>
                    <th className="p-3 font-semibold">Versi</th>
                    <th className="p-3 font-semibold">Jenis</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold">Pelaku</th>
                    <th className="p-3 font-semibold">Titik Balik</th>
                    <th className="p-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        Belum ada catatan riwayat deploy.
                      </td>
                    </tr>
                  ) : (
                    runs.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="p-3 font-mono text-[11px]">
                          {new Date(r.mulai).toLocaleString("id-ID")}
                        </td>
                        <td className="p-3 font-mono font-semibold">{r.versi}</td>
                        <td className="p-3">
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {r.jenis} {r.otomatis && "(Otomatis)"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant={r.status === "berhasil" ? "default" : r.status === "gagal" ? "destructive" : "secondary"}
                            className="capitalize text-[10px]"
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{r.dijalankanOleh}</td>
                        <td className="p-3 font-mono text-[11px] text-muted-foreground">
                          {r.titikBalikVersi || "-"}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] px-2"
                            onClick={async () => {
                              const res = await fetch(`/api/deploy/history?runId=${r.id}`);
                              if (res.ok) {
                                const j = await res.json();
                                setSelectedRunDetail(j.data);
                              }
                            }}
                          >
                            Detail Log
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 3: Panel Pemeriksaan */}
        <TabsContent value="preflight" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <h3 className="text-lg font-bold">Pemeriksaan Kesiapan Sistem & Environment</h3>
            <p className="text-xs text-muted-foreground">
              Hasil evaluasi pra-syarat deploy lokal, variabel lingkungan wajib, dan kesehatan server.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="rounded-xl border p-4 bg-muted/20">
                <h4 className="text-sm font-semibold mb-2">Variabel Lingkungan Wajib</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Semua kunci wajib di .env.local telah diperiksa oleh validator. Variabel server-only tidak bocor ke client.
                </p>
                <div className="mt-3">
                  <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10">
                    ✓ Validasi Sukses
                  </Badge>
                </div>
              </div>

              <div className="rounded-xl border p-4 bg-muted/20">
                <h4 className="text-sm font-semibold mb-2">Penjaga Peran Runtime</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  DEPLOY_PAGE_ROLE bernilai local. Endpoint eksekusi /api/deploy/* menolak 404 pada SERVER NATIVE.
                </p>
                <div className="mt-3">
                  <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10">
                    ✓ Fail-Closed Aktif
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* TAB 4: Pemindahan Konfigurasi */}
        <TabsContent value="config" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <h3 className="text-lg font-bold">Pratinjau Sinkronisasi Konfigurasi Localhost → Server</h3>
            <p className="text-xs text-muted-foreground">
              Konfigurasi yang telah disetel di localhost ikut terbawa saat deploy secara idempoten.
              Tabel data bervolume besar (trafik, netflow, audit log) sengaja dikecualikan.
            </p>

            <div className="rounded-lg border overflow-hidden mt-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">Tabel Database</th>
                    <th className="p-3 font-semibold">Kategori</th>
                    <th className="p-3 font-semibold">Kunci Konflik Unik</th>
                    <th className="p-3 font-semibold">Kolom Aman yang Diperbarui</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="p-3 font-mono font-medium">routers</td>
                    <td className="p-3">Router MikroTik</td>
                    <td className="p-3 font-mono text-[11px]">host (unique)</td>
                    <td className="p-3 text-muted-foreground">name, username, password_enc, latitude, longitude</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">olts</td>
                    <td className="p-3">OLT HSGQ</td>
                    <td className="p-3 font-mono text-[11px]">host (unique)</td>
                    <td className="p-3 text-muted-foreground">name, brand, driver, username, password_enc, koordinat</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">alert_thresholds</td>
                    <td className="p-3">Ambang Batas Alert</td>
                    <td className="p-3 font-mono text-[11px]">rule_kind (unique)</td>
                    <td className="p-3 text-muted-foreground">threshold, for_seconds, updated_at</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">ont_web_settings</td>
                    <td className="p-3">Web Admin ONT</td>
                    <td className="p-3 font-mono text-[11px]">id = 'default'</td>
                    <td className="p-3 text-muted-foreground">acs_url, web_username, web_password_enc, dll</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">whatsapp_recipients</td>
                    <td className="p-3">Penerima WhatsApp</td>
                    <td className="p-3 font-mono text-[11px]">target (nomor HP)</td>
                    <td className="p-3 text-muted-foreground">name, type, is_active, updated_at</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">customers</td>
                    <td className="p-3">Pelanggan PPPoE</td>
                    <td className="p-3 font-mono text-[11px]">pppoe_username</td>
                    <td className="p-3 text-muted-foreground">name, address, latitude, longitude, odp_name</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 5: Akses & Penjaga Tulis */}
        <TabsContent value="access" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <h3 className="text-lg font-bold">Mode Pengembangan Berdampingan & Penjaga Tulis</h3>
            <p className="text-xs text-muted-foreground">
              Uji rilis baru di localhost dengan perangkat asli tanpa mengganggu SERVER NATIVE.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {[
                {
                  id: "simulator",
                  title: "Simulator (Bawaan)",
                  desc: "Tanpa menghubungi perangkat asli di jaringan lapangan.",
                },
                {
                  id: "baca-saja",
                  title: "Baca-Saja (Perangkat Asli)",
                  desc: "Membaca data riil; mutasi berbahaya (CPE task, billing, WA) ditolak penjaga.",
                },
                {
                  id: "penuh",
                  title: "Penuh (Tulis Diizinkan)",
                  desc: "Hanya aktif bila layanan server dihentikan sementara (satu penulis).",
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleUpdateDeviceAccess(opt.id)}
                  className={`text-left rounded-xl border p-4 transition-all ${
                    accessLevel === opt.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="font-semibold text-sm flex items-center justify-between">
                    {opt.title}
                    {accessLevel === opt.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>

            {/* Log Penjaga Tulis */}
            <div className="pt-4 border-t space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Log Upaya Mutasi yang Ditolak
                </h4>
                {writeGuardLogs.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={handleClearWriteGuardLogs} className="h-7 text-xs">
                    Bersihkan Log
                  </Button>
                )}
              </div>

              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b text-muted-foreground">
                    <tr>
                      <th className="p-3 font-semibold">Waktu Ditolak</th>
                      <th className="p-3 font-semibold">Endpoint</th>
                      <th className="p-3 font-semibold">Metode</th>
                      <th className="p-3 font-semibold">Alasan Penjagaan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {writeGuardLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-muted-foreground">
                          Belum ada mutasi yang ditolak oleh penjaga tulis.
                        </td>
                      </tr>
                    ) : (
                      writeGuardLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-muted/30">
                          <td className="p-3 font-mono text-[11px]">
                            {new Date(log.blockedAt).toLocaleTimeString("id-ID")}
                          </td>
                          <td className="p-3 font-mono font-medium">{log.endpoint}</td>
                          <td className="p-3"><Badge variant="outline">{log.method}</Badge></td>
                          <td className="p-3 text-destructive">{log.reason}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* DIALOG 1: Ubah Konfigurasi Target */}
      <Dialog open={editTargetOpen} onOpenChange={setEditTargetOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSaveTarget}>
            <DialogHeader>
              <DialogTitle>Konfigurasi SERVER NATIVE</DialogTitle>
              <DialogDescription className="text-xs">
                Masukkan detail koneksi SSH ke server Ubuntu tujuan rilis.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4 text-xs">
              <div className="space-y-1.5">
                <Label htmlFor="nama">Nama Server</Label>
                <Input
                  id="nama"
                  value={targetForm.nama}
                  onChange={(e) => setTargetForm({ ...targetForm, nama: e.target.value })}
                  placeholder="SERVER NATIVE"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="host">Host / IP LAN Server</Label>
                  <Input
                    id="host"
                    value={targetForm.host}
                    onChange={(e) => setTargetForm({ ...targetForm, host: e.target.value })}
                    placeholder="192.168.1.10"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="port">Port SSH</Label>
                  <Input
                    id="port"
                    type="number"
                    value={targetForm.port}
                    onChange={(e) => setTargetForm({ ...targetForm, port: Number(e.target.value) })}
                    placeholder="22"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sshUser">User SSH Server</Label>
                <Input
                  id="sshUser"
                  value={targetForm.sshUser}
                  onChange={(e) => setTargetForm({ ...targetForm, sshUser: e.target.value })}
                  placeholder="ubuntu"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mode">Mode Koneksi Default</Label>
                <select
                  id="mode"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                  value={targetForm.mode}
                  onChange={(e) => setTargetForm({ ...targetForm, mode: e.target.value as any })}
                >
                  <option value="lan">LAN (IP Lokal / Jaringan Rumah)</option>
                  <option value="tailscale">Tailscale (Koneksi Jarak Jauh)</option>
                  <option value="tunnel">Tunnel / Port Kustom</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tailscaleHost">Host Tailscale (Opsional / MagicDNS)</Label>
                <Input
                  id="tailscaleHost"
                  value={targetForm.tailscaleHost}
                  onChange={(e) => setTargetForm({ ...targetForm, tailscaleHost: e.target.value })}
                  placeholder="100.x.y.z atau server.tailnet.ts.net"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditTargetOpen(false)}>
                Batal
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Menyimpan..." : "Simpan Target"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: Pasang / Ganti Kunci SSH */}
      <Dialog open={keyModalOpen} onOpenChange={setKeyModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSaveSshKey}>
            <DialogHeader>
              <DialogTitle>Kunci Privat SSH Terenkripsi</DialogTitle>
              <DialogDescription className="text-xs">
                Kunci privat akan dienkripsi dengan AES-256-GCM sebelum disimpan ke database localhost.
                Kunci asli tidak pernah ditampilkan kembali.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4 text-xs">
              <div className="space-y-1.5">
                <Label htmlFor="privateKey">Isi Kunci Privat (OpenSSH / PEM / RSA)</Label>
                <textarea
                  id="privateKey"
                  className="w-full rounded-md border border-input bg-background p-2.5 font-mono text-xs min-h-[140px]"
                  value={sshKeyForm.privateKey}
                  onChange={(e) => setSshKeyForm({ ...sshKeyForm, privateKey: e.target.value })}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="passphrase">Passphrase Kunci (Opsional)</Label>
                <Input
                  id="passphrase"
                  type="password"
                  value={sshKeyForm.passphrase}
                  onChange={(e) => setSshKeyForm({ ...sshKeyForm, passphrase: e.target.value })}
                  placeholder="Biarkan kosong jika tanpa passphrase"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setKeyModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" size="sm" disabled={loading || !sshKeyForm.privateKey.trim()}>
                {loading ? "Menyimpan..." : "Simpan Kunci Terenkripsi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: Konfirmasi Jalankan Deploy */}
      <AlertDialog open={deployConfirmOpen} onOpenChange={setDeployConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konfirmasi Eksekusi Deploy ke Server</AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2">
              <div>
                Anda akan merilis versi baru ke <span className="font-semibold">{target?.nama}</span> via {detection?.resolvedMode?.toUpperCase() || "LAN"}.
              </div>
              <div className="rounded-lg bg-muted p-2.5 text-muted-foreground">
                Backup database otomatis akan dibuat di server sebelum migrasi dijalankan.
                Volume PostgreSQL di Docker tidak akan disentuh.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleExecuteDeploy} className="bg-primary">
              Mulai Deploy Sekarang
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* DIALOG 4: Rollback Manual */}
      <Dialog open={rollbackModalOpen} onOpenChange={setRollbackModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rollback Manual Rilis</DialogTitle>
            <DialogDescription className="text-xs">
              Kembalikan aplikasi ke rilis sebelumnya di SERVER NATIVE.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3 text-xs">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Perhatian: Skema Database Tidak Diputar Balik
              </div>
              <p className="mt-1 text-[11px] leading-relaxed">
                Rollback hanya memindahkan symlink aplikasi dan me-restart layanan. Skema database tetap pada hasil migrasi terakhir.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Pilih Versi Rilis Tujuan Rollback</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                value={rollbackTargetVersion}
                onChange={(e) => setRollbackTargetVersion(e.target.value)}
              >
                <option value="">-- Pilih Rilis --</option>
                {releases
                  .filter((r) => !r.aktif)
                  .map((r) => (
                    <option key={r.id} value={r.versi}>
                      {r.versi} (Dipasang: {new Date(r.dipasangPada).toLocaleDateString("id-ID")})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRollbackModalOpen(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!rollbackTargetVersion || rollbackExecuting}
              onClick={handleManualRollback}
            >
              {rollbackExecuting ? "Memproses Rollback..." : "Konfirmasi Rollback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 5: Detail Log Run */}
      <Dialog open={Boolean(selectedRunDetail)} onOpenChange={(open) => !open && setSelectedRunDetail(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-4 w-4" /> Detail Log Run: {selectedRunDetail?.run.versi}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Status: {selectedRunDetail?.run.status} | Jenis: {selectedRunDetail?.run.jenis} | Pelaku: {selectedRunDetail?.run.dijalankanOleh}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            {selectedRunDetail?.steps.map((st) => (
              <div key={st.id} className="rounded-lg border p-3 bg-muted/20">
                <div className="flex items-center justify-between font-medium">
                  <span>{st.urutan}. {st.nama}</span>
                  <Badge variant={st.status === "berhasil" ? "default" : "destructive"} className="text-[10px]">
                    {st.status}
                  </Badge>
                </div>
                {st.keluaran && (
                  <pre className="mt-2 rounded bg-black/80 text-white p-2 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                    {st.keluaran}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG 6: Konfirmasi Hapus Kunci */}
      <AlertDialog open={deleteKeyConfirmOpen} onOpenChange={setDeleteKeyConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Kunci Privat SSH?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Kunci privat SSH yang tersimpan akan dihapus dari database localhost.
              Anda tidak akan dapat melakukan deploy sampai kunci baru disimpan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSshKey} className="bg-destructive text-destructive-foreground">
              Hapus Kunci
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
