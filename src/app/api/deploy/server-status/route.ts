import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { execSync } from "node:child_process";
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
        activeVersion = fs.readlinkSync(currentLink).split("/").pop() || "Tidak diketahui";
      } catch {}
    }

    const rollbackFile = "/srv/noc/shared/.rollback-target";
    if (fs.existsSync(rollbackFile)) {
      try {
        rollbackTarget = fs.readFileSync(rollbackFile, "utf-8").trim().split("/").pop() || null;
      } catch {}
    }

    // 4. Baca status layanan systemd secara langsung
    let webStatus = "unknown";
    let beStatus = "unknown";
    let pgStatus = "unknown";
    try {
      const wOut = execSync("systemctl is-active noc-web 2>/dev/null", { encoding: "utf-8" }).trim();
      webStatus = wOut || "unknown";
    } catch {
      webStatus = "inactive";
    }

    try {
      const bOut = execSync("systemctl is-active noc-backend 2>/dev/null", { encoding: "utf-8" }).trim();
      beStatus = bOut || "unknown";
    } catch {
      beStatus = "inactive";
    }

    try {
      const pgPs = execSync('docker ps --filter "name=noc-postgres" --format "{{.Status}}" 2>/dev/null', { encoding: "utf-8" }).trim();
      pgStatus = pgPs ? "active" : "inactive";
    } catch {
      pgStatus = "unknown";
    }

    // 5. Ambil riwayat deploy terbaru dari database
    let runs: unknown[] = [];
    try {
      runs = await db.select().from(deployRuns).orderBy(desc(deployRuns.mulai)).limit(10);
    } catch {}

    // 6. Log bug dan error terbaru SELALU dibaca LIVE dari journalctl
    let recentErrors: string[] = [];
    try {
      const errLogs = execSync(
        "journalctl -u noc-web -u noc-backend -p err -n 50 --no-pager 2>/dev/null || echo ''",
        { encoding: "utf-8" },
      ).trim();
      if (errLogs) {
        recentErrors = errLogs.split("\n").filter(Boolean);
      }
    } catch {}

    // Fallback ke snapshot file bila journalctl tidak mengembalikan apa pun
    if (recentErrors.length === 0 && fileStatus && Array.isArray(fileStatus.recentErrors)) {
      recentErrors = fileStatus.recentErrors as string[];
    }

    return NextResponse.json(
      {
        ok: true,
        activeVersion: fileStatus?.version || activeVersion,
        rollbackTarget: fileStatus?.rollbackTarget || rollbackTarget,
        services: {
          web: webStatus,
          backend: beStatus,
          postgres: pgStatus,
        },
        recentRuns: runs,
        recentErrors,
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
