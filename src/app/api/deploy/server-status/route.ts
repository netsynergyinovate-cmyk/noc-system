import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import { exec } from "node:child_process";
import { db } from "@/db";
import { deployRuns } from "@/db/schema/deploy-runs";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-monitor-token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function getSafeExecAsync(cmd: string, timeout = 2000): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  exec(cmd, { encoding: "utf-8", timeout }, (err, stdout) => {
    if (err) resolve("");
    else resolve((stdout || "").trim());
  });
  return promise;
}

export async function GET(request: NextRequest) {
  try {
    // 1. Autentikasi Token Monitor (Fail-Closed: Wajib ada MONITOR_TOKEN)
    const expectedToken = process.env.MONITOR_TOKEN;
    if (!expectedToken) {
      return NextResponse.json(
        {
          ok: false,
          error: "Akses ditolak: MONITOR_TOKEN belum dikonfigurasi di /srv/noc/shared/.env server.",
        },
        { status: 403, headers: CORS_HEADERS },
      );
    }

    const reqToken =
      request.headers.get("x-monitor-token") ||
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!reqToken || reqToken !== expectedToken) {
      return NextResponse.json(
        { ok: false, error: "Akses tidak diizinkan: token monitor salah atau tidak disertakan." },
        { status: 401, headers: CORS_HEADERS },
      );
    }

    // 2. Baca file snapshot status jika ada
    const statusFilePath = "/srv/noc/shared/server-status.json";
    let fileStatus: Record<string, unknown> | null = null;
    if (fs.existsSync(statusFilePath)) {
      try {
        fileStatus = JSON.parse(fs.readFileSync(statusFilePath, "utf-8"));
      } catch {}
    }

    // 3. Baca versi aktif dari symlink /srv/noc/current
    let activeVersion = "Tidak diketahui";
    let rollbackTarget: string | null = null;
    const currentLink = "/srv/noc/current";
    if (fs.existsSync(currentLink)) {
      try {
        const target = fs.readlinkSync(currentLink);
        activeVersion = target.split("/").pop() || target;
      } catch {}
    }

    const rollbackFile = "/srv/noc/shared/.rollback-target";
    if (fs.existsSync(rollbackFile)) {
      try {
        rollbackTarget = fs.readFileSync(rollbackFile, "utf-8").trim().split("/").pop() || null;
      } catch {}
    }

    // 4. Spesifikasi Server (CPU, RAM, Swap, Disk, OS)
    const cpus = os.cpus();
    const cpuCount = cpus.length;
    const cpuModel = cpus[0]?.model || "Standard vCPU";
    const loadAvg = os.loadavg();
    const totalMemMb = Math.round(os.totalmem() / 1024 / 1024);
    let freeMemMb = Math.round(os.freemem() / 1024 / 1024);
    let swap = { totalMb: 0, usedMb: 0, freeMb: 0, usePercent: 0, active: false };

    if (fs.existsSync("/proc/meminfo")) {
      try {
        const meminfo = fs.readFileSync("/proc/meminfo", "utf-8");
        const matchAvail = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/i);
        if (matchAvail?.[1]) {
          freeMemMb = Math.round((Number.parseInt(matchAvail[1], 10) || 0) / 1024);
        }
        const matchSwapTotal = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/i);
        const matchSwapFree = meminfo.match(/SwapFree:\s+(\d+)\s+kB/i);
        if (matchSwapTotal?.[1]) {
          const totalKb = Number.parseInt(matchSwapTotal[1], 10) || 0;
          const freeKb = matchSwapFree?.[1] ? Number.parseInt(matchSwapFree[1], 10) || 0 : 0;
          const total = Math.round(totalKb / 1024);
          const free = Math.round(freeKb / 1024);
          const used = Math.max(0, total - free);
          swap = {
            totalMb: total,
            usedMb: used,
            freeMb: free,
            usePercent: total > 0 ? Math.round((used / total) * 100) : 0,
            active: total > 0,
          };
        }
      } catch {}
    }
    const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
    const memUsedPercent = totalMemMb > 0 ? Math.round((usedMemMb / totalMemMb) * 100) : 0;

    let osDistro = `${os.type()} ${os.release()}`;
    if (fs.existsSync("/etc/os-release")) {
      try {
        const osRelease = fs.readFileSync("/etc/os-release", "utf-8");
        const match = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/);
        if (match?.[1]) osDistro = match[1];
      } catch {}
    }

    let disk = { totalMb: 0, usedMb: 0, freeMb: 0, usePercent: 0, path: "/" };
    try {
      const targetDir = fs.existsSync("/srv/noc") ? "/srv/noc" : (process.platform === "win32" ? "C:\\" : "/");
      const stat = fs.statfsSync(targetDir);
      const total = Math.round((stat.blocks * stat.bsize) / 1024 / 1024);
      const free = Math.round((stat.bavail * stat.bsize) / 1024 / 1024);
      const used = Math.max(0, total - free);
      const pct = total > 0 ? Math.round((used / total) * 100) : 0;
      disk = { totalMb: total, usedMb: used, freeMb: free, usePercent: pct, path: targetDir };
    } catch {}

    // 5. Deteksi Proses Aktif (Anti-Freeze: apakah build / deploy sedang berjalan)
    let activeProcess: { running: boolean; command?: string; startedAt?: string } = { running: false };
    const lockFile = "/srv/noc/shared/.deploy-lock";
    if (fs.existsSync(lockFile)) {
      try {
        const lockContent = fs.readFileSync(lockFile, "utf-8").trim();
        const parsed = JSON.parse(lockContent);
        let pidAlive = false;
        if (parsed.pid && typeof parsed.pid === "number") {
          if (fs.existsSync(`/proc/${parsed.pid}`)) {
            pidAlive = true;
          } else {
            try {
              process.kill(parsed.pid, 0);
              pidAlive = true;
            } catch (err: unknown) {
              const code = (err as NodeJS.ErrnoException)?.code;
              pidAlive = code === "EPERM";
            }
          }
        }
        if (pidAlive) {
          activeProcess = {
            running: true,
            command: parsed.command || "noc-system deploy",
            startedAt: parsed.startedAt || new Date().toISOString(),
          };
        }
      } catch {}
    }
    // 6. Baca status layanan systemd, docker containers, logs, dan OOM secara paralel
    const [systemdOut, dockerPs, liveLogsOut, errLogsOut, oomDmesg] = await Promise.all([
      getSafeExecAsync("systemctl is-active noc-web noc-backend 2>/dev/null", 1500),
      getSafeExecAsync('docker ps --format "{{.Names}}\t{{.Status}}" 2>/dev/null', 1500),
      getSafeExecAsync("journalctl -u noc-web -u noc-backend -n 50 --no-pager 2>/dev/null", 2000),
      getSafeExecAsync("journalctl -u noc-web -u noc-backend -p err -n 50 --no-pager 2>/dev/null", 2000),
      getSafeExecAsync('dmesg -T 2>/dev/null | grep -iE "oom[- ]killer|out of memory" | tail -n 5 2>/dev/null', 1500),
    ]);

    let webStatus = "inactive";
    let beStatus = "inactive";
    if (systemdOut) {
      const [wOut, bOut] = systemdOut.split("\n").map((s) => s.trim());
      webStatus = wOut === "active" ? "active" : "inactive";
      beStatus = bOut === "active" ? "active" : "inactive";
    }

    let pgStatus = "inactive";
    let genieacsStatus = "inactive";
    let osrmStatus = "inactive";
    let nineRouterStatus = "inactive";
    if (dockerPs) {
      const psLines = dockerPs.split("\n").filter(Boolean);
      for (const line of psLines) {
        const [name, status] = line.split("\t");
        const s = status ? "active" : "inactive";
        if (name?.includes("noc-postgres") || name?.includes("postgres")) pgStatus = s;
        if (name?.includes("genieacs")) genieacsStatus = s;
        if (name?.includes("osrm")) osrmStatus = s;
        if (name?.includes("9router") || name?.includes("simulator")) nineRouterStatus = s;
      }
    }

    // 7. Ambil riwayat deploy terbaru dari database
    let runs: unknown[] = [];
    try {
      runs = await db.select().from(deployRuns).orderBy(desc(deployRuns.mulai)).limit(10);
    } catch {}

    // 8. Log Live Terminal dan Galat Fatal
    let recentErrors: string[] = [];
    let terminalLogs: string[] = [];

    if (liveLogsOut) {
      terminalLogs = liveLogsOut.split("\n").filter(Boolean);
    }
    if (errLogsOut) {
      recentErrors = errLogsOut.split("\n").filter(Boolean);
    }

    if (recentErrors.length === 0 && fileStatus && Array.isArray(fileStatus.recentErrors)) {
      recentErrors = fileStatus.recentErrors as string[];
    }
    if (terminalLogs.length === 0 && fileStatus && Array.isArray(fileStatus.terminalLogs)) {
      terminalLogs = fileStatus.terminalLogs as string[];
    }

    // 9. Diagnostik Anti-Freeze & Linux OOM Killer
    const warnings: string[] = [];
    let oomDetected = false;
    const oomDetails: string[] = [];

    if (freeMemMb < 500 && (!swap.active || swap.freeMb < 256)) {
      warnings.push(
        `RAM bebas sangat tipis (${freeMemMb} MB tersedia) tanpa swap memadai (${swap.freeMb} MB bebas). Risiko tinggi OOM Killer menghentikan build/deploy secara senyap.`,
      );
    }

    if (disk.totalMb > 0 && disk.freeMb < 2048) {
      warnings.push(
        `Ruang disk tersisa sangat sedikit (${disk.freeMb} MB bebas dari ${disk.totalMb} MB). Harap bersihkan rilis lama atau cache docker.`,
      );
    }

    let oomCheck = oomDmesg;
    if (!oomCheck) {
      oomCheck = await getSafeExecAsync('journalctl -k -n 50 --no-pager 2>/dev/null | grep -iE "oom[- ]killer|out of memory" | tail -n 5 2>/dev/null', 1500);
    }
    if (oomCheck) {
      oomDetected = true;
      oomDetails.push(...oomCheck.split("\n").filter(Boolean));
      warnings.push("Terdeteksi peristiwa Linux OOM Killer di kernel log baru-baru ini.");
    }

    return NextResponse.json(
      {
        ok: true,
        activeVersion: fileStatus?.version || activeVersion,
        rollbackTarget: fileStatus?.rollbackTarget || rollbackTarget,
        specs: {
          os: osDistro,
          arch: os.arch(),
          hostname: os.hostname(),
          uptimeSeconds: Math.round(os.uptime()),
          cpu: {
            cores: cpuCount,
            model: cpuModel,
            loadAvg,
          },
          memory: {
            totalMb: totalMemMb,
            freeMb: freeMemMb,
            usedMb: usedMemMb,
            usedPercent: memUsedPercent,
          },
          swap,
          disk,
        },
        activeProcess,
        services: {
          web: webStatus,
          backend: beStatus,
          postgres: pgStatus,
        },
        features: {
          web: { status: webStatus, port: 3000, name: "NOC Web Dashboard (Next.js 16)" },
          backend: { status: beStatus, port: 8080, name: "NOC Backend Engine (Go)" },
          postgres: { status: pgStatus, port: 5432, name: "Database PostgreSQL & TimescaleDB" },
          genieacs: { status: genieacsStatus, ports: [7547, 7557, 7558], name: "GenieACS TR-069 CPE (CWMP :7547, NBI :7557, UI :7558)" },
          osrm: { status: osrmStatus, port: 5000, name: "OSRM Road Snap & Fiber Routing (:5000)" },
          nineRouter: { status: nineRouterStatus, port: 20128, name: "9router Decolua AI Proxy & Lab (:20128)" },
          netflow: { status: beStatus === "active" ? "active" : "inactive", port: 2055, name: "NetFlow Collector (UDP IPFIX)" },
        },
        recentRuns: runs,
        recentErrors,
        terminalLogs,
        diagnostics: {
          warnings,
          oomDetected,
          oomDetails,
        },
        updatedAt: new Date().toISOString(),
      },
      { headers: CORS_HEADERS },
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
