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
  EyeOff,
  Trash2,
  Lock,
  Layers,
  ArrowRight,
  Database,
  ExternalLink,
  ShieldAlert,
  Copy,
  Check,
  BookmarkPlus,
  Cpu,
  HardDrive,
  Radio,
  Info,
} from "lucide-react";
import type { DeployTarget } from "@/db/schema/deploy-targets";
import type { NetworkDetectionResult } from "@/services/deploy-targets.service";
import type { SshCredentialMeta } from "@/services/ssh-credentials.service";
import type {
  DeployRun,
  DeployStep,
  DeployRelease,
  DeployWriteGuardLog,
} from "@/db/schema/deploy-runs";
import { DeployUserMarkersTab } from "./deploy-user-markers-tab";
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
import {
  DeployRunConsole,
  DeployTerminalBox,
  type DeployAccessInfo,
} from "./deploy-run-console";
import { DeployChecklistGuide } from "./deploy-checklist-guide";

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

interface ServerStatusData {
  ok: boolean;
  activeVersion?: string;
  rollbackTarget?: string | null;
  specs?: {
    os?: string;
    arch?: string;
    hostname?: string;
    uptimeSeconds?: number;
    cpu?: {
      cores: number;
      model: string;
      loadAvg: number[];
    };
    memory?: {
      totalMb: number;
      freeMb: number;
      usedMb: number;
      usedPercent: number;
    };
    swap?: {
      totalMb: number;
      usedMb: number;
      freeMb: number;
      usePercent: number;
      active: boolean;
    };
    disk?: {
      totalMb: number;
      usedMb: number;
      freeMb: number;
      usePercent: number;
      path: string;
    };
  };
  activeProcess?: {
    running: boolean;
    command?: string;
    startedAt?: string;
  };
  services?: { web: string; backend: string; postgres: string };
  features?: Record<
    string,
    { status: string; port?: number; ports?: number[]; name: string }
  >;
  recentRuns?: DeployRun[];
  recentErrors?: string[];
  terminalLogs?: string[];
  diagnostics?: {
    warnings: string[];
    oomDetected: boolean;
    oomDetails: string[];
  };
  updatedAt?: string;
}

interface FeatureStackItem {
  id: string;
  name: string;
  tech: string;
  port: string;
  serviceKey: string;
  upCmd: string;
  logsCmd: string;
  restartCmd: string;
}

const FEATURE_STACK: FeatureStackItem[] = [
  {
    id: "web",
    name: "NOC Web Dashboard",
    tech: "Next.js 16 (Turbopack Standalone)",
    port: "3000 (TCP)",
    serviceKey: "web",
    upCmd: "sudo systemctl start noc-web",
    logsCmd: "journalctl -u noc-web -n 50 -f",
    restartCmd: "sudo systemctl restart noc-web",
  },
  {
    id: "backend",
    name: "NOC Backend Engine",
    tech: "Go (Golang High-Concurrency)",
    port: "8080 (TCP)",
    serviceKey: "backend",
    upCmd: "sudo systemctl start noc-backend",
    logsCmd: "journalctl -u noc-backend -n 50 -f",
    restartCmd: "sudo systemctl restart noc-backend",
  },
  {
    id: "postgres",
    name: "Database PostgreSQL 17",
    tech: "Docker Container (postgres:17-alpine / noc-postgres)",
    port: "5432 (TCP)",
    serviceKey: "postgres",
    upCmd:
      "docker compose --env-file /srv/noc/shared/.env -f compose.postgres.yaml up -d",
    logsCmd: "docker logs -f noc-postgres --tail 50",
    restartCmd: "docker restart noc-postgres",
  },
  {
    id: "genieacs",
    name: "GenieACS TR-069 CPE Provisioning",
    tech: "Docker Container (CWMP, NBI, FS, UI)",
    port: "7547 (CWMP), 7557 (NBI), 7558 (UI)",
    serviceKey: "genieacs",
    upCmd:
      "docker network create nocsystem_default 2>/dev/null || true && docker compose -f compose.genieacs.yaml up -d",
    logsCmd: "docker compose -f compose.genieacs.yaml logs -f --tail 50",
    restartCmd: "docker compose -f compose.genieacs.yaml restart",
  },
  {
    id: "osrm",
    name: "OSRM Road Snap & Fiber Routing",
    tech: "Docker Container (OSRM Routing Engine)",
    port: "5000 (TCP)",
    serviceKey: "osrm",
    upCmd:
      "docker network create nocsystem_default 2>/dev/null || true && docker compose -f compose.osrm.yaml up -d osrm",
    logsCmd: "docker compose -f compose.osrm.yaml logs -f --tail 50 osrm",
    restartCmd: "docker compose -f compose.osrm.yaml restart osrm",
  },
  {
    id: "9router",
    name: "9router Decolua AI Proxy & Lab",
    tech: "Docker Container (Decolua 9router AI /v1 Proxy)",
    port: "20128 (TCP - UI & /v1)",
    serviceKey: "nineRouter",
    upCmd:
      "docker network create nocsystem_default 2>/dev/null || true && docker compose -f compose.9router.yaml up -d",
    logsCmd: "docker compose -f compose.9router.yaml logs -f --tail 50",
    restartCmd: "docker compose -f compose.9router.yaml restart",
  },
  {
    id: "netflow",
    name: "NetFlow Traffic Collector",
    tech: "Go Engine NetFlow/IPFIX Subsystem",
    port: "2055 (UDP)",
    serviceKey: "netflow",
    upCmd: "sudo systemctl restart noc-backend",
    logsCmd: "journalctl -u noc-backend | grep -i netflow",
    restartCmd: "sudo systemctl restart noc-backend",
  },
];

interface DeployDashboardProps {
  initialTarget: DeployTarget | null;
  initialDetection: NetworkDetectionResult | null;
}
export function DeployDashboard({
  initialTarget,
  initialDetection,
}: DeployDashboardProps) {
  const [target, setTarget] = useState<DeployTarget | null>(initialTarget);
  const [detection, setDetection] = useState<NetworkDetectionResult | null>(
    initialDetection,
  );
  const [sshMeta, setSshMeta] = useState<SshCredentialMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{
    type: "success" | "error" | "info";
    msg: string;
  } | null>(null);

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

  // Dialog Kunci SSH / Password
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [sshKeyForm, setSshKeyForm] = useState({
    authType: "password" as "password" | "key",
    password: "",
    privateKey: "",
    passphrase: "",
  });
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [markersCount, setMarkersCount] = useState<number>(0);

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
  const [deployAccessInfo, setDeployAccessInfo] =
    useState<DeployAccessInfo | null>(null);
  const [activeTab, setActiveTab] = useState<string>("cli");

  useEffect(() => {
    try {
      const urlTab = new URLSearchParams(window.location.search).get("tab");
      const saved = localStorage.getItem("noc_deploy_active_tab");
      const tabToUse = urlTab || saved;
      if (tabToUse) {
        setActiveTab(tabToUse);
      }
    } catch {}
  }, []);

  function handleTabChange(tab: string) {
    setActiveTab(tab);
    try {
      localStorage.setItem("noc_deploy_active_tab", tab);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState(null, "", url.toString());
    } catch {}
  }

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
  const [rollbackTargetVersion, setRollbackTargetVersion] =
    useState<string>("");
  const [rollbackExecuting, setRollbackExecuting] = useState(false);

  // Mode Akses Perangkat & Write Guard
  const [accessLevel, setAccessLevel] = useState<string>(
    target?.deviceAccessLevel || "simulator",
  );
  const [writeGuardLogs, setWriteGuardLogs] = useState<DeployWriteGuardLog[]>(
    [],
  );

  // HTTP Server Monitor State (tanpa SSH)
  const [serverUrl, setServerUrl] = useState(() =>
    target?.host ? `http://${target.host}:3000` : "",
  );
  const [monitorToken, setMonitorToken] = useState("");
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [serverData, setServerData] = useState<ServerStatusData | null>(null);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(5);
  const [terminalTab, setTerminalTab] = useState<"live" | "errors" | "runs">(
    "live",
  );
  const [clearedTerminal, setClearedTerminal] = useState(false);

  async function fetchServerStatus(
    url = serverUrl,
    token = monitorToken,
    showNotice = true,
  ) {
    if (!url) {
      if (showNotice) {
        setNotice({
          type: "error",
          msg: "Kolom 'Alamat / Domain SERVER NATIVE' belum diisi! Masukkan alamat IP server (contoh: http://103.x.x.x:3000) di samping Token Monitor.",
        });
      }
      return;
    }
    setMonitoringLoading(true);
    try {
      const q = new URLSearchParams({ url });
      if (token) q.set("token", token);
      const res = await fetch(`/api/deploy/proxy-status?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setServerData(json);
        if (showNotice) {
          setNotice({
            type: "success",
            msg: "Status server native berhasil terbaca dan diperbarui.",
          });
        }
      } else {
        const errJson = await res.json().catch(() => null);
        if (showNotice) {
          setNotice({
            type: "error",
            msg: errJson?.error || `Server merespons status ${res.status}`,
          });
        }
      }
    } catch (err: unknown) {
      if (showNotice) {
        setNotice({
          type: "error",
          msg: `Gagal menghubungi server di ${url}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } finally {
      setMonitoringLoading(false);
    }
  }

  useEffect(() => {
    try {
      const savedUrl = localStorage.getItem("noc_monitor_server_url");
      const savedToken = localStorage.getItem("noc_monitor_token");
      const fallbackUrl = target?.host ? `http://${target.host}:3000` : "";
      const effectiveUrl = savedUrl || fallbackUrl;
      if (savedUrl) {
        setServerUrl(savedUrl);
      } else if (fallbackUrl) {
        setServerUrl(fallbackUrl);
      }
      if (savedToken) setMonitorToken(savedToken);
      if (effectiveUrl && savedToken) {
        fetchServerStatus(effectiveUrl, savedToken, false);
      }
    } catch {
      // ignore
    }
  }, [target?.host]);
  useEffect(() => {
    if (autoRefreshInterval <= 0 || !serverUrl || !monitorToken) return;
    const timer = setInterval(() => {
      fetchServerStatus(serverUrl, monitorToken, false);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshInterval, serverUrl, monitorToken]);
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
      setNotice({
        type: "success",
        msg: "Konfigurasi target SERVER NATIVE berhasil disimpan.",
      });
    } catch (err: unknown) {
      setNotice({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
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
      if (!res.ok)
        throw new Error(json.error || "Gagal menyimpan kredensial SSH");

      setSshMeta(json.data);
      setKeyModalOpen(false);
      setSshKeyForm({
        authType: "password",
        password: "",
        privateKey: "",
        passphrase: "",
      });
      setNotice({
        type: "success",
        msg: "Kredensial SSH terenkripsi AES-256-GCM berhasil disimpan.",
      });
    } catch (err: unknown) {
      setNotice({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSshKey() {
    try {
      const res = await fetch("/api/deploy/ssh/credentials", {
        method: "DELETE",
      });
      if (res.ok) {
        setSshMeta(null);
        setDeleteKeyConfirmOpen(false);
        setNotice({
          type: "info",
          msg: "Kunci SSH berhasil dihapus dari database localhost.",
        });
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
        setNotice({
          type: "error",
          msg: json.error || "Gagal menjalankan dry-run",
        });
      }
    } catch (err: unknown) {
      setNotice({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
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
        const maxPollAttempts = 400; // ~10 menit batas waktu polling
        let attempts = 0;
        let consecutiveErrors = 0;
        while (attempts < maxPollAttempts) {
          attempts++;
          await delay(1500);
          const detRes = await fetch(`/api/deploy/history?runId=${runId}`);
          if (detRes.ok) {
            consecutiveErrors = 0;
            const detJson = await detRes.json();
            const detail = detJson.data;
            if (detail?.steps) {
              setActiveDeploySteps(detail.steps);
            }
            if (detail?.run && detail.run.status !== "berjalan") {
              const isSuccess = detail.run.status === "berhasil";
              setDeployFinishedResult({
                success: isSuccess,
                message: isSuccess
                  ? `Deploy versi ${detail.run.versi} berhasil terpasang di SERVER NATIVE!`
                  : `Deploy selesai dengan status: ${detail.run.status}`,
                autoRollbackTriggered: detail.run.otomatis,
              });

              if (isSuccess) {
                try {
                  const accessRes = await fetch("/api/deploy/access-info");
                  if (accessRes.ok) {
                    const accessJson = await accessRes.json();
                    if (accessJson.data) {
                      setDeployAccessInfo(accessJson.data);
                      if (accessJson.data.url) {
                        setServerUrl(accessJson.data.url);
                        try {
                          localStorage.setItem(
                            "noc_monitor_server_url",
                            accessJson.data.url,
                          );
                        } catch {}
                      }
                      if (accessJson.data.token) {
                        setMonitorToken(accessJson.data.token);
                        try {
                          localStorage.setItem(
                            "noc_monitor_token",
                            accessJson.data.token,
                          );
                        } catch {}
                      }
                    }
                  }
                } catch {
                  // non-fatal
                }
              }
              break;
            }
          } else {
            consecutiveErrors++;
            if (consecutiveErrors > 10) {
              throw new Error(
                "Gagal mengambil status deploy dari server setelah 10 kali percobaan berturut-turut.",
              );
            }
          }
        }
        if (attempts >= maxPollAttempts) {
          throw new Error(
            "Waktu tunggu pemantauan deploy habis (timeout 10 menit). Periksa status di tab Riwayat.",
          );
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
        body: JSON.stringify({
          targetVersion: rollbackTargetVersion,
          confirm: true,
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || json.message || "Rollback gagal");

      setRollbackModalOpen(false);
      setNotice({ type: "success", msg: json.message });
      loadHistory();
      loadReleases();
    } catch (err: unknown) {
      setNotice({
        type: "error",
        msg: err instanceof Error ? err.message : String(err),
      });
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
        setNotice({
          type: "success",
          msg: `Tingkat akses perangkat diubah ke: ${level}`,
        });
      }
    } catch {
      // ignore
    }
  }

  async function handleClearWriteGuardLogs() {
    try {
      const res = await fetch("/api/deploy/write-guard/logs", {
        method: "DELETE",
      });
      if (res.ok) {
        setWriteGuardLogs([]);
        setNotice({
          type: "info",
          msg: "Log penolakan penjaga tulis telah dibersihkan.",
        });
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
            <h1 className="text-2xl font-bold tracking-tight">
              Deploy & Rilis SERVER NATIVE
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Pusat rilis aplikasi native (Next.js & Go systemd) via SSH ke server
            mandiri Ubuntu. Halaman ini eksklusif hanya berjalan di{" "}
            <span className="font-semibold text-foreground">localhost</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 py-1 px-3 bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
          >
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNotice(null)}
            className="h-7 text-xs"
          >
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
              <h2 className="text-lg font-bold">
                {target?.nama || "SERVER NATIVE"}
              </h2>
              <div className="mt-1 space-y-1 text-sm font-mono text-muted-foreground">
                <div>
                  Host:{" "}
                  <span className="text-foreground">
                    {target ? `${target.host}:${target.port}` : "Belum diatur"}
                  </span>
                </div>
                <div>
                  User:{" "}
                  <span className="text-foreground">
                    {target?.sshUser || "-"}
                  </span>
                </div>
                {target?.tailscaleHost && (
                  <div>
                    Tailscale:{" "}
                    <span className="text-foreground">
                      {target.tailscaleHost}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setEditTargetOpen(true)}
            >
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
                  <Badge
                    variant="destructive"
                    className="text-[10px] py-0 px-1.5"
                  >
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
            <span>
              LAN: {detection?.lanReachable ? "✓ Terjangkau" : "✗ Tidak aktif"}
            </span>
            {target?.tailscaleHost && (
              <span>
                Tailscale:{" "}
                {detection?.tailscaleReachable ? "✓ Aktif" : "✗ Offline"}
              </span>
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
                    <CheckCircle2 className="h-4 w-4" />{" "}
                    {sshMeta.authType === "password" ||
                    sshMeta.fingerprint === "PASSWORD"
                      ? "Password SSH Tersimpan"
                      : "Kunci Privat Tersimpan"}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground break-all">
                    {sshMeta.authType === "password" ||
                    sshMeta.fingerprint === "PASSWORD"
                      ? "Tipe: Kata Sandi Terenkripsi (AES-256-GCM)"
                      : sshMeta.fingerprint}
                  </div>
                  {sshMeta.hasPassphrase && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Memakai passphrase
                      terenkripsi
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> Kredensial belum
                  dipasang
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
              {sshMeta ? "Ganti Kredensial" : "Pasang Kredensial"}
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
              {testingSsh ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Uji SSH"
              )}
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
            {sshTestResult.success ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {sshTestResult.success
              ? "Uji Koneksi SSH Berhasil"
              : "Uji Koneksi SSH Gagal"}
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
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <TabsList className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 w-full">
          <TabsTrigger
            value="cli"
            className="text-xs gap-1.5 font-semibold text-primary"
          >
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
          <TabsTrigger
            value="markers"
            className="text-xs gap-1.5 font-semibold text-purple-600 dark:text-purple-400"
          >
            <BookmarkPlus className="h-3.5 w-3.5" /> Tanda User{" "}
            {markersCount > 0 ? `(${markersCount})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* TAB 0: CLI noc-system & Server Instructions */}
        <TabsContent value="cli" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs">
            <div className="border-b pb-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="bg-primary/10 text-primary border-primary/20"
                >
                  CLI Mandiri Server Native
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Node.js CLI + Go Backend + Docker PostgreSQL
                </span>
              </div>
              <h3 className="text-lg font-bold mt-2">
                Pemantau Rilis Server, Versi & Pelacak Bug
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Aplikasi memantau SERVER NATIVE secara langsung melalui HTTP
                tanpa memerlukan kunci SSH dari dalam kontainer Docker lokal.
                Jalankan perintah CLI <strong>noc-system</strong> di terminal
                server Ubuntu untuk instalasi dan deployment rilis.
              </p>
            </div>

            {/* Panel Input URL Server & Refresh */}
            {/* Panel Input URL Server, Token & Refresh */}
            <div className="mt-4 p-4 rounded-lg border bg-muted/20 flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Alamat / Domain SERVER NATIVE:
                  </Label>
                  <Input
                    value={serverUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setServerUrl(val);
                      try {
                        localStorage.setItem("noc_monitor_server_url", val);
                      } catch {}
                    }}
                    placeholder="http://103.x.x.x:3000 atau https://noc.domain.com"
                    className="text-xs font-mono h-8 bg-background mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Gunakan IP VPS di port :3000 jika belum memasang domain
                    (contoh: http://103.x.x.x:3000).
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Token Monitor (Wajib untuk Server):
                  </Label>
                  <Input
                    type="password"
                    value={monitorToken}
                    onChange={(e) => {
                      const val = e.target.value;
                      setMonitorToken(val);
                      try {
                        localStorage.setItem("noc_monitor_token", val);
                      } catch {}
                    }}
                    placeholder="Salin MONITOR_TOKEN dari terminal SSH / install.sh"
                    className="text-xs font-mono h-8 bg-background mt-1"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Token yang dicetak di terminal SSH saat install.sh selesai
                    atau dari &apos;noc-system status&apos;.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end md:self-auto pt-2 md:pt-4">
                <div className="flex items-center gap-1.5 bg-background border rounded-md px-2.5 py-1 text-xs">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">
                    Auto-refresh:
                  </span>
                  <select
                    value={autoRefreshInterval}
                    onChange={(e) =>
                      setAutoRefreshInterval(Number(e.target.value))
                    }
                    className="bg-transparent text-xs text-foreground font-medium focus:outline-none cursor-pointer"
                  >
                    <option value={0}>Nonaktif</option>
                    <option value={5}>5 detik</option>
                    <option value={10}>10 detik</option>
                    <option value={30}>30 detik</option>
                  </select>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  className="text-xs h-8 gap-1.5"
                  disabled={monitoringLoading}
                  onClick={() => {
                    setClearedTerminal(false);
                    fetchServerStatus(serverUrl, monitorToken, true);
                  }}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${monitoringLoading ? "animate-spin" : ""}`}
                  />
                  Perbarui Status Server
                </Button>
              </div>
            </div>

            {/* Panel Notifikasi Proses Aktif (Anti-Freeze Detection) */}
            {serverData?.activeProcess?.running && (
              <div className="mt-4 p-3.5 rounded-lg border border-blue-500/40 bg-blue-500/10 text-xs text-blue-700 dark:text-blue-300 flex items-center justify-between animate-pulse">
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                  <div>
                    <span className="font-bold">
                      Proses Sedang Berjalan Aktif di Server:{" "}
                    </span>
                    <code className="font-mono bg-blue-900/30 px-1.5 py-0.5 rounded text-blue-200">
                      {serverData.activeProcess.command || "noc-system deploy"}
                    </code>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Server sedang melakukan kompilasi / migrasi di latar
                      belakang. Terminal mungkin tampak diam tanpa teks — jangan
                      menghentikan proses.
                    </p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="border-blue-500 text-blue-400 bg-blue-500/20 text-[10px]"
                >
                  BUSY / RUNNING
                </Badge>
              </div>
            )}

            {/* Panel Peringatan Diagnostik & Linux OOM Killer */}
            {serverData?.diagnostics &&
              (serverData.diagnostics.warnings.length > 0 ||
                serverData.diagnostics.oomDetected) && (
                <div className="mt-3 p-3.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300 space-y-1.5">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    Peringatan Diagnostik Stabilitas & Memori Server:
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-[11px] pl-1 text-amber-700 dark:text-amber-200">
                    {serverData.diagnostics.warnings.map((warnMsg, idx) => (
                      <li key={idx}>{warnMsg}</li>
                    ))}
                    {serverData.diagnostics.oomDetected &&
                      serverData.diagnostics.oomDetails.length > 0 && (
                        <li className="font-mono text-[10px] bg-amber-950/40 p-1.5 rounded text-amber-200 mt-1">
                          Log OOM:{" "}
                          {
                            serverData.diagnostics.oomDetails[
                              serverData.diagnostics.oomDetails.length - 1
                            ]
                          }
                        </li>
                      )}
                  </ul>
                </div>
              )}

            {/* Widget Spesifikasi Server Real-Time */}
            {serverData?.specs && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {/* OS & Host */}
                <div className="rounded-lg border bg-background p-3 shadow-xs">
                  <div className="flex items-center justify-between text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    <span>Sistem Operasi</span>
                    <Server className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div
                    className="mt-1 text-xs font-bold truncate text-foreground"
                    title={serverData.specs.os}
                  >
                    {serverData.specs.os || "Linux"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {serverData.specs.arch} • Host: {serverData.specs.hostname}
                  </div>
                </div>

                {/* CPU Cores & Load */}
                <div className="rounded-lg border bg-background p-3 shadow-xs">
                  <div className="flex items-center justify-between text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    <span>Prosesor (CPU)</span>
                    <Cpu className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="mt-1 text-xs font-bold text-foreground">
                    {serverData.specs.cpu?.cores || 1} Cores
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                    Load:{" "}
                    {serverData.specs.cpu?.loadAvg
                      ?.map((l) => l.toFixed(2))
                      .join(", ") || "0.00"}
                  </div>
                </div>

                {/* RAM (Memory) */}
                <div className="rounded-lg border bg-background p-3 shadow-xs">
                  <div className="flex items-center justify-between text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    <span>RAM Digunakan</span>
                    <Layers className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="mt-1 text-xs font-bold text-foreground">
                    {(serverData.specs.memory?.usedMb || 0) / 1024 > 1
                      ? `${((serverData.specs.memory?.usedMb || 0) / 1024).toFixed(1)} GB`
                      : `${serverData.specs.memory?.usedMb || 0} MB`}{" "}
                    /{" "}
                    {(serverData.specs.memory?.totalMb || 0) / 1024 > 1
                      ? `${((serverData.specs.memory?.totalMb || 0) / 1024).toFixed(1)} GB`
                      : `${serverData.specs.memory?.totalMb || 0} MB`}
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        (serverData.specs.memory?.usedPercent || 0) > 85
                          ? "bg-red-500"
                          : (serverData.specs.memory?.usedPercent || 0) > 70
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                      style={{
                        width: `${Math.min(100, serverData.specs.memory?.usedPercent || 0)}%`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 flex justify-between">
                    <span>
                      Bebas: {serverData.specs.memory?.freeMb || 0} MB
                    </span>
                    <span>{serverData.specs.memory?.usedPercent || 0}%</span>
                  </div>
                </div>

                {/* Swap Memory */}
                <div className="rounded-lg border bg-background p-3 shadow-xs">
                  <div className="flex items-center justify-between text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    <span>Swap (Anti-OOM)</span>
                    <Badge
                      variant={
                        serverData.specs.swap?.active
                          ? "default"
                          : "destructive"
                      }
                      className="text-[9px] px-1 py-0 h-4"
                    >
                      {serverData.specs.swap?.active ? "AKTIF" : "OFF"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs font-bold text-foreground">
                    {serverData.specs.swap?.active
                      ? `${(serverData.specs.swap.usedMb / 1024).toFixed(1)} / ${(serverData.specs.swap.totalMb / 1024).toFixed(1)} GB`
                      : "0 GB (Tanpa Swap)"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {serverData.specs.swap?.active
                      ? `Bebas: ${serverData.specs.swap.freeMb} MB (${serverData.specs.swap.usePercent}% terpakai)`
                      : "Berisiko freeze saat kompilasi"}
                  </div>
                </div>

                {/* Ruang Disk */}
                <div className="rounded-lg border bg-background p-3 shadow-xs">
                  <div className="flex items-center justify-between text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
                    <span>Ruang Disk</span>
                    <HardDrive className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="mt-1 text-xs font-bold text-foreground">
                    {((serverData.specs.disk?.freeMb || 0) / 1024).toFixed(1)}{" "}
                    GB Bebas
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1.5 overflow-hidden">
                    <div
                      className={`h-1.5 rounded-full ${
                        (serverData.specs.disk?.usePercent || 0) > 85
                          ? "bg-red-500"
                          : "bg-primary"
                      }`}
                      style={{
                        width: `${Math.min(100, serverData.specs.disk?.usePercent || 0)}%`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 flex justify-between">
                    <span>
                      Total:{" "}
                      {((serverData.specs.disk?.totalMb || 0) / 1024).toFixed(
                        1,
                      )}{" "}
                      GB
                    </span>
                    <span>{serverData.specs.disk?.usePercent || 0}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Kartu Ringkasan Real-Time Server */}
            {serverData && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Versi Aktif */}
                <div className="rounded-lg border bg-background p-4 shadow-xs">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Versi Rilis di Server
                  </span>
                  <div className="mt-2 text-base font-bold text-primary font-mono truncate">
                    {serverData.activeVersion || "Belum ada rilis"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Rollback target:{" "}
                    <span className="font-mono text-foreground">
                      {serverData.rollbackTarget || "Tidak ada"}
                    </span>
                  </div>
                </div>

                {/* Status Layanan Systemd */}
                <div className="rounded-lg border bg-background p-4 shadow-xs">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Kesehatan Layanan Inti
                  </span>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span>Web (Next.js 16):</span>
                      <Badge
                        variant={
                          serverData.services?.web === "active"
                            ? "default"
                            : "destructive"
                        }
                        className="text-[10px] py-0"
                      >
                        {serverData.services?.web?.toUpperCase() || "INACTIVE"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Backend (Go):</span>
                      <Badge
                        variant={
                          serverData.services?.backend === "active"
                            ? "default"
                            : "destructive"
                        }
                        className="text-[10px] py-0"
                      >
                        {serverData.services?.backend?.toUpperCase() ||
                          "INACTIVE"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Docker PostgreSQL:</span>
                      <Badge
                        variant={
                          serverData.services?.postgres === "active"
                            ? "default"
                            : "destructive"
                        }
                        className="text-[10px] py-0"
                      >
                        {serverData.services?.postgres?.toUpperCase() ||
                          "INACTIVE"}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Status Monitoring HTTP */}
                <div className="rounded-lg border bg-background p-4 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Koneksi Pemantau (HTTP)
                    </span>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        Terhubung & Memantau
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Terakhir diperbarui:{" "}
                      {serverData.updatedAt
                        ? new Date(serverData.updatedAt).toLocaleTimeString()
                        : "-"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pembaca Terminal Live (Monospace Dark Terminal Stream & Inspector) */}
            <div className="mt-4 rounded-lg border bg-zinc-950 text-zinc-100 shadow-sm overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800 px-4 py-2.5 gap-2 bg-zinc-900/80">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                    <Terminal className="h-4 w-4 text-emerald-400" />
                    <span>Terminal Stream & Inspector Server</span>
                  </div>
                  {/* Tab Selector */}
                  <div className="flex items-center bg-zinc-950 rounded border border-zinc-800 p-0.5 text-[11px]">
                    <button
                      onClick={() => setTerminalTab("live")}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        terminalTab === "live"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Live Log (50 baris)
                    </button>
                    <button
                      onClick={() => setTerminalTab("errors")}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        terminalTab === "errors"
                          ? "bg-zinc-800 text-red-300"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Galat Fatal ({serverData?.recentErrors?.length || 0})
                    </button>
                    <button
                      onClick={() => setTerminalTab("runs")}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        terminalTab === "runs"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Riwayat Deploy ({serverData?.recentRuns?.length || 0})
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 px-2 gap-1"
                    onClick={() => {
                      let textToCopy = "";
                      if (terminalTab === "live") {
                        textToCopy = (serverData?.terminalLogs || []).join(
                          "\n",
                        );
                      } else if (terminalTab === "errors") {
                        textToCopy = (serverData?.recentErrors || []).join(
                          "\n",
                        );
                      } else {
                        textToCopy = JSON.stringify(
                          serverData?.recentRuns || [],
                          null,
                          2,
                        );
                      }
                      copyToClipboard(textToCopy, "terminal-copy");
                    }}
                  >
                    {copiedCmd === "terminal-copy" ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    Salin Teks
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 px-2"
                    onClick={() => setClearedTerminal(true)}
                  >
                    Bersihkan
                  </Button>
                </div>
              </div>

              {/* Konten Terminal */}
              <div className="p-3 font-mono text-xs max-h-64 overflow-y-auto space-y-1">
                {clearedTerminal ? (
                  <div className="text-zinc-500 py-4 text-center">
                    Tampilan terminal dibersihkan sementara. Klik &apos;Perbarui
                    Status Server&apos; untuk memuat ulang streaming log.
                  </div>
                ) : terminalTab === "live" ? (
                  serverData?.terminalLogs &&
                  serverData.terminalLogs.length > 0 ? (
                    serverData.terminalLogs.map((logLine, idx) => (
                      <div
                        key={idx}
                        className="leading-tight text-zinc-300 break-all select-text hover:bg-zinc-900/60 px-1 py-0.5 rounded"
                      >
                        <span className="text-zinc-600 select-none mr-2">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        {logLine.includes("ERROR") ||
                        logLine.includes("error") ||
                        logLine.includes("fatal") ? (
                          <span className="text-red-400">{logLine}</span>
                        ) : logLine.includes("WARN") ||
                          logLine.includes("warn") ? (
                          <span className="text-amber-300">{logLine}</span>
                        ) : (
                          logLine
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 py-4 text-center">
                      Belum ada data terminal log terbaru dari server. Pastikan
                      server aktif dan token monitor sudah benar.
                    </div>
                  )
                ) : terminalTab === "errors" ? (
                  serverData?.recentErrors &&
                  serverData.recentErrors.length > 0 ? (
                    serverData.recentErrors.map((err, idx) => (
                      <div
                        key={idx}
                        className="p-1.5 rounded bg-red-950/40 border border-red-900/50 text-red-300 break-all leading-relaxed"
                      >
                        {err}
                      </div>
                    ))
                  ) : (
                    <div className="text-zinc-500 py-4 text-center">
                      Tidak ada log galat fatal terbaru di server. Seluruh
                      proses berjalan normal.
                    </div>
                  )
                ) : serverData?.recentRuns &&
                  serverData.recentRuns.length > 0 ? (
                  <div className="space-y-1.5">
                    {serverData.recentRuns.map((run, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-zinc-900/80 border border-zinc-800 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              run.status === "berhasil"
                                ? "default"
                                : "destructive"
                            }
                            className="text-[9px] py-0"
                          >
                            {run.status.toUpperCase()}
                          </Badge>
                          <span className="font-bold text-zinc-200">
                            v{run.versi}
                          </span>
                          <span className="text-zinc-400">({run.jenis})</span>
                        </div>
                        <div className="text-zinc-500 text-[10px]">
                          {new Date(run.mulai).toLocaleString()} • Target:{" "}
                          {run.titikBalikVersi || "Awal"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-zinc-500 py-4 text-center">
                    Belum ada riwayat deployment rilis tercatat di database
                    server.
                  </div>
                )}
              </div>
            </div>

            {/* Edukasi Anti-Freeze: Mengapa Terminal Tampak Freeze / Diam? */}
            <div className="mt-4 p-4 rounded-lg border bg-amber-500/5 border-amber-500/20 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
                <Info className="h-4 w-4 shrink-0" />
                <span>
                  Panduan Anti-Freeze: Mengapa Terminal VPS Tampak Membeku /
                  Diam Saat Deploy?
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Saat menjalankan{" "}
                <code className="font-mono text-primary font-bold">
                  noc-system deploy
                </code>{" "}
                atau{" "}
                <code className="font-mono text-primary font-bold">
                  install.sh
                </code>
                , beberapa tahapan kompilasi berjalan dalam mode non-interaktif
                tanpa animasi bar progres. Hal ini merupakan perilaku normal:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1 text-xs">
                <div className="p-2.5 rounded border bg-background/80">
                  <div className="font-bold text-foreground">
                    1. npm ci (~500 MB)
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Mengunduh dan mengekstrak ratusan paket npm. Memakan waktu
                    1–3 menit di VPS.
                  </div>
                </div>
                <div className="p-2.5 rounded border bg-background/80">
                  <div className="font-bold text-foreground">
                    2. go build (Biner Go)
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Mengunduh modul Golang dan mengompilasi biner server native
                    berkecepatan tinggi (30–90 detik).
                  </div>
                </div>
                <div className="p-2.5 rounded border bg-background/80">
                  <div className="font-bold text-foreground">
                    3. npm run build (Next.js)
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Membundel seluruh halaman TypeScript via Turbopack
                    standalone. Layar terminal akan diam 1–3 menit.
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold pt-1">
                ✓ PERINGATAN OPERATOR: Jangan menekan{" "}
                <code className="font-mono bg-amber-950/20 px-1 py-0.5 rounded">
                  Ctrl+C
                </code>{" "}
                saat terminal diam. Tunggu hingga pesan verifikasi sukses
                tercetak.
              </p>
            </div>

            {/* Katalog & Panduan Instalasi Semua Fitur (Feature Stack Matrix) */}
            <div className="mt-6 rounded-xl border bg-card p-5 shadow-xs space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold text-foreground">
                      Katalog & Panduan Status Seluruh Fitur (Feature Stack
                      Matrix)
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    7 Komponen Ekosistem
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Daftar seluruh komponen tumpukan aplikasi NOC SYSTEM beserta
                  port jaringan, status kontainer/service, dan perintah kendali
                  1-klik:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {FEATURE_STACK.map((item) => {
                  const featStatus =
                    serverData?.features?.[item.serviceKey]?.status ||
                    (item.serviceKey === "web"
                      ? serverData?.services?.web
                      : item.serviceKey === "backend"
                        ? serverData?.services?.backend
                        : item.serviceKey === "postgres"
                          ? serverData?.services?.postgres
                          : "inactive");
                  const isActive = featStatus === "active";

                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border bg-background p-3.5 flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground">
                            {item.name}
                          </span>
                          <Badge
                            variant={isActive ? "default" : "secondary"}
                            className={`text-[9px] py-0 px-1.5 ${
                              isActive
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                : ""
                            }`}
                          >
                            {isActive ? "ACTIVE / ONLINE" : "INACTIVE"}
                          </Badge>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {item.tech}
                        </div>
                        <div className="text-[11px] font-mono text-primary mt-1">
                          Port: {item.port}
                        </div>
                      </div>

                      {/* Action Command Snippets */}
                      <div className="space-y-1.5 pt-1 border-t text-[11px] font-mono">
                        <div className="flex items-center justify-between bg-muted/50 p-1.5 rounded">
                          <span className="text-muted-foreground truncate mr-2">
                            Up: {item.upCmd}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 shrink-0"
                            onClick={() =>
                              copyToClipboard(item.upCmd, `up-${item.id}`)
                            }
                          >
                            {copiedCmd === `up-${item.id}` ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="flex items-center justify-between bg-muted/50 p-1.5 rounded">
                          <span className="text-muted-foreground truncate mr-2">
                            Logs: {item.logsCmd}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 shrink-0"
                            onClick={() =>
                              copyToClipboard(item.logsCmd, `logs-${item.id}`)
                            }
                          >
                            {copiedCmd === `logs-${item.id}` ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="flex items-center justify-between bg-muted/50 p-1.5 rounded">
                          <span className="text-muted-foreground truncate mr-2">
                            Restart: {item.restartCmd}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 shrink-0"
                            onClick={() =>
                              copyToClipboard(
                                item.restartCmd,
                                `restart-${item.id}`,
                              )
                            }
                          >
                            {copiedCmd === `restart-${item.id}` ? (
                              <Check className="h-3 w-3 text-emerald-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Banner Perintah Bootstrap 1-Baris */}
            <div className="mt-6 p-4 rounded-lg border bg-primary/5 border-primary/20 space-y-3">
              <div>
                <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <Terminal className="h-4 w-4" /> Perintah Pasang Awal 1-Baris
                  di Server Ubuntu (Bootstrap)
                </span>
                <p className="text-xs text-muted-foreground mt-1">
                  Jalankan perintah ini di server Ubuntu baru untuk memasang
                  Docker CE, Node.js 22 LTS, Go Compiler, dan CLI noc-system
                  otomatis:
                </p>
              </div>

              {/* Opsi 1: Perintah Standar (Publik) */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span>
                    1. Perintah Standar (Hanya bila Repositori disetel Publik di
                    GitHub)
                  </span>
                </div>
                <div className="p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                  <code className="break-all">
                    curl -fsSL
                    https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh
                    | sudo bash
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 ml-2"
                    onClick={() =>
                      copyToClipboard(
                        "curl -fsSL https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo bash",
                        "bootstrap-public",
                      )
                    }
                  >
                    {copiedCmd === "bootstrap-public" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Opsi 2: Dengan GITHUB_TOKEN (Repositori Privat) */}
              <div>
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span>
                    2. Dengan GITHUB_TOKEN (Wajib untuk Repositori Privat Saat
                    Ini)
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] text-amber-500 bg-amber-500/10 border-amber-500/20"
                  >
                    Private Repo (Aktif)
                  </Badge>
                </div>
                <div className="p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                  <code className="break-all">{`export GITHUB_TOKEN="ghp_xxx" NOC_DEVICE_SECRET="kunci_32_karakter_sama_lokal" && curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo --preserve-env=GITHUB_TOKEN,NOC_DEVICE_SECRET bash`}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 ml-2"
                    onClick={() =>
                      copyToClipboard(
                        `export GITHUB_TOKEN="ghp_xxx" NOC_DEVICE_SECRET="kunci_32_karakter_sama_lokal" && curl -fsSL -H "Authorization: token $GITHUB_TOKEN" https://raw.githubusercontent.com/netsynergyinovate-cmyk/noc-system/noc-system-main/scripts/install.sh | sudo --preserve-env=GITHUB_TOKEN,NOC_DEVICE_SECRET bash`,
                        "bootstrap-token",
                      )
                    }
                  >
                    {copiedCmd === "bootstrap-token" ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  *Ganti <code className="text-primary font-mono">ghp_xxx</code>{" "}
                  dengan PAT GitHub, dan samakan{" "}
                  <code className="text-primary font-mono">
                    NOC_DEVICE_SECRET
                  </code>{" "}
                  dengan file <code className="font-mono">.env.local</code> di
                  komputer kontrol agar verifikasi kesiapan (dry-run) di halaman
                  Deploy lulus.
                </p>
              </div>
            </div>

            {/* Daftar Perintah CLI */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Perintah 1: Install */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">
                      1. Instalasi Awal 1-Perintah
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      Setup
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Membuat hierarki /srv/noc, menyalakan Docker PostgreSQL
                    (noc-postgres), memasang unit systemd, dan menjalankan
                    migrasi skema awal.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs install</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs install",
                          "install",
                        )
                      }
                    >
                      {copiedCmd === "install" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 2: Deploy */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      2. Rilis Versi Baru (Deploy)
                    </span>
                    <Badge variant="default" className="text-[10px]">
                      Rilis
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Backup database otomatis, kompilasi Go backend, build
                    standalone Next.js, migrasi database, swap symlink
                    /srv/noc/current, dan restart layanan.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs deploy</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs deploy",
                          "deploy",
                        )
                      }
                    >
                      {copiedCmd === "deploy" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 3: Update */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                      3. Tarik Git & Update Otomatis
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      Git Pull
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Menyinkronkan kode dari repositori GitHub, memasang npm
                    dependencies terbaru, dan mengeksekusi alur rilis penuh.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs update</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs update",
                          "update",
                        )
                      }
                    >
                      {copiedCmd === "update" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 4: Status */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                      4. Cek Status Kesehatan Server
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      Monitoring
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Memeriksa versi rilis aktif, status unit systemd noc-web dan
                    noc-backend, kesehatan kontainer Docker PostgreSQL, dan
                    probe HTTP.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs status</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs status",
                          "status",
                        )
                      }
                    >
                      {copiedCmd === "status" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 5: Doctor */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                      5. Diagnostik Server (Doctor)
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      Pre-Flight
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Memeriksa kelayakan CPU, RAM, Swap, sisa disk, status Docker
                    daemon, port bentrok (3000, 8080, 5432), dan konektivitas.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs doctor</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs doctor",
                          "doctor",
                        )
                      }
                    >
                      {copiedCmd === "doctor" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 6: Features */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                      6. Status Fitur Ekosistem (Features)
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      Stack Matrix
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Menampilkan status seluruh 7 komponen (Web, Backend, DB,
                    GenieACS, OSRM, 9router, NetFlow) dan perintah Docker
                    terkait.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs features</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs features",
                          "features",
                        )
                      }
                    >
                      {copiedCmd === "features" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 7: Logs */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      7. Pantau Bug & Live Log
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      Diagnostik
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Menampilkan live streaming log journalctl dari kedua layanan
                    noc-web dan noc-backend untuk pelacakan galat dan bug
                    sistem.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs logs -n 50</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs logs -n 50",
                          "logs",
                        )
                      }
                    >
                      {copiedCmd === "logs" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Perintah 8: Rollback */}
              <div className="rounded-lg border bg-muted/40 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-destructive">
                      8. Pemulihan Cepat (Rollback)
                    </span>
                    <Badge variant="destructive" className="text-[10px]">
                      Emergency
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Memutar balik symlink /srv/noc/current ke direktori rilis
                    sebelumnya secara instan dan me-restart layanan. Skema
                    database tetap pada hasil migrasi terakhir.
                  </p>
                  <div className="mt-3 p-2.5 rounded bg-background border font-mono text-xs flex items-center justify-between text-foreground">
                    <code>node bin/noc-system.mjs rollback</code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        copyToClipboard(
                          "node bin/noc-system.mjs rollback",
                          "rollback",
                        )
                      }
                    >
                      {copiedCmd === "rollback" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
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
                <h3 className="text-lg font-bold">
                  Rilis Versi Aplikasi ke SERVER NATIVE
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Eksekusi berurutan: Pre-flight → Backup Database → Migrasi
                  Aman → Kirim Konfigurasi → Unggah Rilis → Tukar Symlink →
                  Restart Layanan → Health Check.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    !target || !sshMeta || dryRunRunning || deployRunning
                  }
                  onClick={handleRunDryRun}
                  className="gap-1.5 text-xs"
                >
                  {dryRunRunning ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  Uji Kesiapan (Dry-run)
                </Button>

                <Button
                  size="sm"
                  disabled={!target || !sshMeta || deployRunning}
                  onClick={() => setDeployConfirmOpen(true)}
                  className="gap-1.5 text-xs bg-primary font-semibold"
                >
                  {deployRunning ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Jalankan Deploy
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab("preflight")}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-foreground hidden sm:flex"
                  title="Lihat checklist akun, port, dan variabel environment"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Panduan &
                  Checklist
                </Button>
              </div>
            </div>

            {/* Panduan Prasyarat jika Target atau Kunci SSH belum diisi */}
            {(!target || !sshMeta) && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <span className="font-semibold text-sm">
                      Tombol Deploy Dinonaktifkan (Prasyarat Belum Lengkap)
                    </span>
                    <p className="text-muted-foreground">
                      Untuk menjalankan deploy otomatis dari dasbor ini, sistem
                      memerlukan alamat IP VPS dan Kunci Privat SSH:
                    </p>
                    <ul className="list-disc list-inside space-y-1 mt-2 text-foreground font-medium">
                      <li>
                        Target Server:{" "}
                        {target ? (
                          <span className="text-emerald-600 font-semibold">
                            ✓ {target.host}:{target.port} (User:{" "}
                            {target.sshUser})
                          </span>
                        ) : (
                          <span className="text-destructive font-semibold">
                            ✗ Belum diisi (Host & User VPS)
                          </span>
                        )}
                      </li>
                      <li>
                        Kunci Privat SSH:{" "}
                        {sshMeta ? (
                          <span className="text-emerald-600 font-semibold">
                            ✓ Kunci tersimpan ({sshMeta.fingerprint})
                          </span>
                        ) : (
                          <span className="text-destructive font-semibold">
                            ✗ Kunci belum dipasang
                          </span>
                        )}
                      </li>
                    </ul>
                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      {!target && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs bg-background border-amber-500/40 text-amber-900 dark:text-amber-200"
                          onClick={() => setEditTargetOpen(true)}
                        >
                          1. Atur Target Server (IP & User VPS)
                        </Button>
                      )}
                      {!sshMeta && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs bg-background border-amber-500/40 text-amber-900 dark:text-amber-200"
                          onClick={() => setKeyModalOpen(true)}
                        >
                          2. Pasang Kunci Privat SSH
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
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
                    Hasil Dry-run:{" "}
                    {dryRunResult.ready
                      ? "Server Siap untuk Deploy"
                      : "Server Belum Siap"}
                  </div>
                  <Badge
                    variant={dryRunResult.ready ? "default" : "destructive"}
                  >
                    {dryRunResult.ready ? "LULUS" : "GAGAL"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {dryRunResult.checks.map((c) => (
                    <div key={c.id} className="rounded-lg border bg-card p-2.5">
                      <div className="font-medium flex items-center gap-1.5">
                        {c.status === "lulus" && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        )}
                        {c.status === "peringatan" && (
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                        )}
                        {c.status === "gagal" && (
                          <XCircle className="h-3 w-3 text-destructive" />
                        )}
                        {c.name}
                      </div>
                      <div className="text-muted-foreground mt-1 pl-4.5">
                        {c.detail}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Konsol Progres Deploy, Live Terminal SSH, dan Kartu Akses */}
            <DeployRunConsole
              steps={activeDeploySteps}
              running={deployRunning}
              finishedResult={deployFinishedResult}
              accessInfo={deployAccessInfo}
              sshUser={target?.sshUser || "netsi"}
              sshHost={target?.host || "server"}
              onOpenCliTab={() => {
                setActiveTab("cli");
                if (deployAccessInfo?.url && deployAccessInfo?.token) {
                  fetchServerStatus(
                    deployAccessInfo.url,
                    deployAccessInfo.token,
                    true,
                  );
                }
              }}
            />
          </div>
        </TabsContent>

        {/* TAB 2: Riwayat & Rollback */}
        <TabsContent value="history" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
              <div>
                <h3 className="text-lg font-bold">
                  Riwayat Rilis & Rollback Manual
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Catatan seluruh eksekusi deploy, rollback otomatis/manual, dan
                  uji kesiapan.
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadHistory}
                  className="h-8 px-2"
                >
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
                      <td
                        colSpan={7}
                        className="p-6 text-center text-muted-foreground"
                      >
                        Belum ada catatan riwayat deploy.
                      </td>
                    </tr>
                  ) : (
                    runs.map((r) => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="p-3 font-mono text-[11px]">
                          {new Date(r.mulai).toLocaleString("id-ID")}
                        </td>
                        <td className="p-3 font-mono font-semibold">
                          {r.versi}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className="capitalize text-[10px]"
                          >
                            {r.jenis} {r.otomatis && "(Otomatis)"}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <Badge
                            variant={
                              r.status === "berhasil"
                                ? "default"
                                : r.status === "gagal"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="capitalize text-[10px]"
                          >
                            {r.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {r.dijalankanOleh}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-muted-foreground">
                          {r.titikBalikVersi || "-"}
                        </td>
                        <td className="p-3 text-right flex items-center justify-end gap-1.5">
                          {r.status === "berjalan" && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const res = await fetch("/api/deploy/history", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({ runId: r.id }),
                                });
                                if (res.ok) {
                                  loadHistory();
                                  setNotice({
                                    type: "info",
                                    msg: "Deploy run berhasil ditandai gagal / dihentikan.",
                                  });
                                } else {
                                  const err = await res
                                    .json()
                                    .catch(() => null);
                                  setNotice({
                                    type: "error",
                                    msg:
                                      err?.error ||
                                      "Gagal membatalkan deploy run.",
                                  });
                                }
                              }}
                            >
                              Tandai Gagal
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] px-2"
                            onClick={async () => {
                              const res = await fetch(
                                `/api/deploy/history?runId=${r.id}`,
                              );
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
            <h3 className="text-lg font-bold">
              Pemeriksaan Kesiapan Sistem & Environment
            </h3>
            <p className="text-xs text-muted-foreground">
              Hasil evaluasi pra-syarat deploy lokal, variabel lingkungan wajib,
              dan kesehatan server.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="rounded-xl border p-4 bg-muted/20">
                <h4 className="text-sm font-semibold mb-2">
                  Variabel Lingkungan Wajib
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Semua kunci wajib di .env.local telah diperiksa oleh
                  validator. Variabel server-only tidak bocor ke client.
                </p>
                <div className="mt-3">
                  <Badge
                    variant="outline"
                    className="text-emerald-600 bg-emerald-500/10"
                  >
                    ✓ Validasi Sukses
                  </Badge>
                </div>
              </div>

              <div className="rounded-xl border p-4 bg-muted/20">
                <h4 className="text-sm font-semibold mb-2">
                  Penjaga Peran Runtime
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  DEPLOY_PAGE_ROLE bernilai local. Endpoint eksekusi
                  /api/deploy/* menolak 404 pada SERVER NATIVE.
                </p>
                <div className="mt-3">
                  <Badge
                    variant="outline"
                    className="text-emerald-600 bg-emerald-500/10"
                  >
                    ✓ Fail-Closed Aktif
                  </Badge>
                </div>
              </div>
            </div>

            {/* Panduan Lengkap Checklist Pra-Deploy */}
            <DeployChecklistGuide />
          </div>
        </TabsContent>

        {/* TAB 4: Pemindahan Konfigurasi */}
        <TabsContent value="config" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <h3 className="text-lg font-bold">
              Pratinjau Sinkronisasi Konfigurasi Localhost → Server
            </h3>
            <p className="text-xs text-muted-foreground">
              Konfigurasi yang telah disetel di localhost ikut terbawa saat
              deploy secara idempoten. Tabel data bervolume besar (trafik,
              netflow, audit log) sengaja dikecualikan.
            </p>

            <div className="rounded-lg border overflow-hidden mt-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">Tabel Database</th>
                    <th className="p-3 font-semibold">Kategori</th>
                    <th className="p-3 font-semibold">Kunci Konflik Unik</th>
                    <th className="p-3 font-semibold">
                      Kolom Aman yang Diperbarui
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="p-3 font-mono font-medium">routers</td>
                    <td className="p-3">Router MikroTik</td>
                    <td className="p-3 font-mono text-[11px]">host (unique)</td>
                    <td className="p-3 text-muted-foreground">
                      name, username, password_enc, latitude, longitude
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">olts</td>
                    <td className="p-3">OLT HSGQ</td>
                    <td className="p-3 font-mono text-[11px]">host (unique)</td>
                    <td className="p-3 text-muted-foreground">
                      name, brand, driver, username, password_enc, koordinat
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">
                      alert_thresholds
                    </td>
                    <td className="p-3">Ambang Batas Alert</td>
                    <td className="p-3 font-mono text-[11px]">
                      rule_kind (unique)
                    </td>
                    <td className="p-3 text-muted-foreground">
                      threshold, for_seconds, updated_at
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">
                      ont_web_settings
                    </td>
                    <td className="p-3">Web Admin ONT</td>
                    <td className="p-3 font-mono text-[11px]">
                      id = 'default'
                    </td>
                    <td className="p-3 text-muted-foreground">
                      acs_url, web_username, web_password_enc, dll
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">
                      whatsapp_recipients
                    </td>
                    <td className="p-3">Penerima WhatsApp</td>
                    <td className="p-3 font-mono text-[11px]">
                      target (nomor HP)
                    </td>
                    <td className="p-3 text-muted-foreground">
                      name, type, is_active, updated_at
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">customers</td>
                    <td className="p-3">Pelanggan PPPoE</td>
                    <td className="p-3 font-mono text-[11px]">
                      pppoe_username
                    </td>
                    <td className="p-3 text-muted-foreground">
                      name, address, latitude, longitude, odp_name
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* TAB 5: Akses & Penjaga Tulis */}
        <TabsContent value="access" className="mt-6 space-y-6">
          <div className="rounded-xl border bg-card p-6 shadow-xs space-y-4">
            <h3 className="text-lg font-bold">
              Mode Pengembangan Berdampingan & Penjaga Tulis
            </h3>
            <p className="text-xs text-muted-foreground">
              Uji rilis baru di localhost dengan perangkat asli tanpa mengganggu
              SERVER NATIVE.
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
                    {accessLevel === opt.id && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
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
                  <ShieldCheck className="h-4 w-4 text-primary" /> Log Upaya
                  Mutasi yang Ditolak
                </h4>
                {writeGuardLogs.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearWriteGuardLogs}
                    className="h-7 text-xs"
                  >
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
                        <td
                          colSpan={4}
                          className="p-6 text-center text-muted-foreground"
                        >
                          Belum ada mutasi yang ditolak oleh penjaga tulis.
                        </td>
                      </tr>
                    ) : (
                      writeGuardLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-muted/30">
                          <td className="p-3 font-mono text-[11px]">
                            {new Date(log.blockedAt).toLocaleTimeString(
                              "id-ID",
                            )}
                          </td>
                          <td className="p-3 font-mono font-medium">
                            {log.endpoint}
                          </td>
                          <td className="p-3">
                            <Badge variant="outline">{log.method}</Badge>
                          </td>
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

        {/* TAB 7: Telemetri Tanda Fitur Pengguna */}
        <TabsContent value="markers" className="mt-6 space-y-6">
          <DeployUserMarkersTab
            serverUrl={serverUrl}
            monitorToken={monitorToken}
            onCountChange={setMarkersCount}
          />
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
                  onChange={(e) =>
                    setTargetForm({ ...targetForm, nama: e.target.value })
                  }
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
                    onChange={(e) =>
                      setTargetForm({ ...targetForm, host: e.target.value })
                    }
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
                    onChange={(e) =>
                      setTargetForm({
                        ...targetForm,
                        port: Number(e.target.value),
                      })
                    }
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
                  onChange={(e) =>
                    setTargetForm({ ...targetForm, sshUser: e.target.value })
                  }
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
                  onChange={(e) =>
                    setTargetForm({
                      ...targetForm,
                      mode: e.target.value as any,
                    })
                  }
                >
                  <option value="lan">LAN (IP Lokal / Jaringan Rumah)</option>
                  <option value="tailscale">
                    Tailscale (Koneksi Jarak Jauh)
                  </option>
                  <option value="tunnel">Tunnel / Port Kustom</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tailscaleHost">
                  Host Tailscale (Opsional / MagicDNS)
                </Label>
                <Input
                  id="tailscaleHost"
                  value={targetForm.tailscaleHost}
                  onChange={(e) =>
                    setTargetForm({
                      ...targetForm,
                      tailscaleHost: e.target.value,
                    })
                  }
                  placeholder="100.x.y.z atau server.tailnet.ts.net"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditTargetOpen(false)}
              >
                Batal
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Menyimpan..." : "Simpan Target"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: Pasang / Ganti Kredensial SSH */}
      <Dialog open={keyModalOpen} onOpenChange={setKeyModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={handleSaveSshKey}>
            <DialogHeader>
              <DialogTitle>Kredensial SSH SERVER NATIVE</DialogTitle>
              <DialogDescription className="text-xs">
                Kredensial SSH (Password atau Kunci Privat) dienkripsi dengan
                AES-256-GCM sebelum disimpan.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4 text-xs">
              <div className="flex rounded-lg border p-1 bg-muted/40 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={
                    sshKeyForm.authType === "password" ? "default" : "ghost"
                  }
                  className="flex-1 text-xs h-7"
                  onClick={() =>
                    setSshKeyForm({ ...sshKeyForm, authType: "password" })
                  }
                >
                  Kata Sandi SSH (Password)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={sshKeyForm.authType === "key" ? "default" : "ghost"}
                  className="flex-1 text-xs h-7"
                  onClick={() =>
                    setSshKeyForm({ ...sshKeyForm, authType: "key" })
                  }
                >
                  Kunci Privat SSH (Key Pair)
                </Button>
              </div>

              {sshKeyForm.authType === "password" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sshPassword">
                    Kata Sandi SSH (Password user VPS)
                  </Label>
                  <Input
                    id="sshPassword"
                    type="password"
                    value={sshKeyForm.password}
                    onChange={(e) =>
                      setSshKeyForm({ ...sshKeyForm, password: e.target.value })
                    }
                    placeholder="Masukkan password user SSH VPS (contoh: password user netsi)"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Password ini disimpan terenkripsi AES-256-GCM di database
                    kontrol lokal.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="privateKey">
                      Isi Kunci Privat (OpenSSH / PEM / RSA)
                    </Label>
                    <textarea
                      id="privateKey"
                      className="w-full rounded-md border border-input bg-background p-2.5 font-mono text-xs min-h-[140px]"
                      value={sshKeyForm.privateKey}
                      onChange={(e) =>
                        setSshKeyForm({
                          ...sshKeyForm,
                          privateKey: e.target.value,
                        })
                      }
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="passphrase">
                      Passphrase Kunci (Opsional)
                    </Label>
                    <Input
                      id="passphrase"
                      type="password"
                      value={sshKeyForm.passphrase}
                      onChange={(e) =>
                        setSshKeyForm({
                          ...sshKeyForm,
                          passphrase: e.target.value,
                        })
                      }
                      placeholder="Biarkan kosong jika tanpa passphrase"
                    />
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setKeyModalOpen(false)}
              >
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  loading ||
                  (sshKeyForm.authType === "password"
                    ? !sshKeyForm.password.trim()
                    : !sshKeyForm.privateKey.trim())
                }
              >
                {loading ? "Menyimpan..." : "Simpan Kredensial Terenkripsi"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: Konfirmasi Jalankan Deploy */}
      <AlertDialog open={deployConfirmOpen} onOpenChange={setDeployConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Konfirmasi Eksekusi Deploy ke Server
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2">
              <div>
                Anda akan merilis versi baru ke{" "}
                <span className="font-semibold">{target?.nama}</span> via{" "}
                {detection?.resolvedMode?.toUpperCase() || "LAN"}.
              </div>
              <div className="rounded-lg bg-muted p-2.5 text-muted-foreground">
                Backup database otomatis akan dibuat di server sebelum migrasi
                dijalankan. Volume PostgreSQL di Docker tidak akan disentuh.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExecuteDeploy}
              className="bg-primary"
            >
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
                <AlertTriangle className="h-4 w-4 shrink-0" /> Perhatian: Skema
                Database Tidak Diputar Balik
              </div>
              <p className="mt-1 text-[11px] leading-relaxed">
                Rollback hanya memindahkan symlink aplikasi dan me-restart
                layanan. Skema database tetap pada hasil migrasi terakhir.
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
                      {r.versi} (Dipasang:{" "}
                      {new Date(r.dipasangPada).toLocaleDateString("id-ID")})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRollbackModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={!rollbackTargetVersion || rollbackExecuting}
              onClick={handleManualRollback}
            >
              {rollbackExecuting
                ? "Memproses Rollback..."
                : "Konfirmasi Rollback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 5: Detail Log Run */}
      <Dialog
        open={Boolean(selectedRunDetail)}
        onOpenChange={(open) => !open && setSelectedRunDetail(null)}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] p-0 overflow-hidden flex flex-col bg-zinc-950 text-zinc-100 border-zinc-800">
          <DialogHeader className="p-4 border-b border-zinc-800 bg-zinc-900/60">
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2 text-sm font-mono text-zinc-100">
                <Terminal className="h-4 w-4 text-emerald-400" /> Terminal Log
                CLI Run: {selectedRunDetail?.run.versi}
              </DialogTitle>
              <div className="flex items-center gap-2">
                {selectedRunDetail?.run.status === "berjalan" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 text-[10px] px-2 font-sans"
                    onClick={async () => {
                      if (!selectedRunDetail?.run.id) return;
                      const res = await fetch("/api/deploy/history", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          runId: selectedRunDetail.run.id,
                        }),
                      });
                      if (res.ok) {
                        loadHistory();
                        setSelectedRunDetail(null);
                        setNotice({
                          type: "info",
                          msg: "Deploy run berhasil ditandai gagal / dihentikan.",
                        });
                      } else {
                        const err = await res.json().catch(() => null);
                        setNotice({
                          type: "error",
                          msg: err?.error || "Gagal membatalkan deploy run.",
                        });
                      }
                    }}
                  >
                    Tandai Gagal / Hentikan
                  </Button>
                )}
                <Badge
                  variant={
                    selectedRunDetail?.run.status === "berhasil"
                      ? "default"
                      : "destructive"
                  }
                  className="text-[10px] capitalize"
                >
                  {selectedRunDetail?.run.status}
                </Badge>
              </div>
            </div>
            <DialogDescription className="text-[11px] text-zinc-400 font-mono mt-1">
              Jenis: {selectedRunDetail?.run.jenis} | Pelaku:{" "}
              {selectedRunDetail?.run.dijalankanOleh} | Target:{" "}
              {target?.sshUser}@{target?.host}
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 overflow-y-auto max-h-[calc(85vh-90px)]">
            {selectedRunDetail && (
              <DeployTerminalBox
                steps={selectedRunDetail.steps}
                running={false}
                sshUser={target?.sshUser || "netsi"}
                sshHost={target?.host || "server"}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* DIALOG 6: Konfirmasi Hapus Kunci */}
      <AlertDialog
        open={deleteKeyConfirmOpen}
        onOpenChange={setDeleteKeyConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Kunci Privat SSH?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Kunci privat SSH yang tersimpan akan dihapus dari database
              localhost. Anda tidak akan dapat melakukan deploy sampai kunci
              baru disimpan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSshKey}
              className="bg-destructive text-destructive-foreground"
            >
              Hapus Kunci
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
