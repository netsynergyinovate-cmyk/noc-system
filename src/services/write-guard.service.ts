import { db } from "@/db";
import {
  deployWriteGuardLogs,
  type DeployWriteGuardLog,
} from "@/db/schema/deploy-runs";
import { getDeployTarget } from "./deploy-targets.service";
import { isDeployRole } from "@/lib/deploy/role-guard";
import { desc } from "drizzle-orm";

export interface WriteGuardCheckResult {
  blocked: boolean;
  reason?: string;
  level: "simulator" | "baca-saja" | "penuh";
}

/**
 * Daftar endpoint mutasi berbahaya yang ditolak di localhost saat tingkat akses
 * perangkat adalah 'simulator' atau 'baca-saja' untuk mencegah konflik dengan server produksi.
 */
export const DANGEROUS_WRITE_ENDPOINTS = [
  {
    path: "/api/cpe/tasks",
    name: "Pembuatan Task CPE / TR-069",
    reason:
      "Pembuatan task CPE diblokir di localhost untuk mencegah perintah konfigurasi ganda ke modem pelanggan.",
  },
  {
    path: "/api/billing/sync",
    name: "Sinkronisasi Billing",
    reason:
      "Sinkronisasi billing diblokir di localhost agar status tagihan dan isolir hanya dikelola oleh SERVER NATIVE.",
  },
  {
    path: "/api/whatsapp/send",
    name: "Pengiriman Notifikasi WhatsApp",
    reason:
      "Pengiriman pesan WhatsApp diblokir di localhost untuk mencegah pesan duplikat atau spam ke pelanggan.",
  },
  {
    path: "/api/alerts/ticket",
    name: "Pembuatan Tiket Alert",
    reason:
      "Pembuatan tiket alert otomatis diblokir di localhost pada mode baca-saja.",
  },
] as const;

/**
 * Mengevaluasi apakah sebuah request mutasi diizinkan berdasarkan tingkat akses perangkat.
 *
 * KRITIKAL:
 * Penjaga tulis HANYA aktif di localhost (ketika isDeployRole() bernilai true).
 * Di SERVER NATIVE (produksi), fungsi ini LANGSUNG mengembalikan { blocked: false, level: 'penuh' },
 * sehingga server produksi tetap menjadi satu-satunya penulis tanpa hambatan.
 */
export async function evaluateWriteGuard(
  endpoint: string,
  method = "POST",
  payloadPreview?: string,
): Promise<WriteGuardCheckResult> {
  // Bila berjalan di SERVER NATIVE, JANGAN PERNAH blokir aksi produksi
  if (!isDeployRole()) {
    return { blocked: false, level: "penuh" };
  }

  let target = null;
  try {
    target = await getDeployTarget();
  } catch {
    target = null;
  }
  const level = target?.deviceAccessLevel || "simulator";

  // Pada tingkat 'penuh', seluruh mutasi diizinkan (operator telah menghentikan server sementara)
  if (level === "penuh") {
    return { blocked: false, level };
  }

  // Periksa apakah endpoint termasuk dalam daftar berbahaya
  const matched = DANGEROUS_WRITE_ENDPOINTS.find((item) =>
    endpoint.toLowerCase().startsWith(item.path.toLowerCase()),
  );

  if (
    matched &&
    method.toUpperCase() !== "GET" &&
    method.toUpperCase() !== "HEAD"
  ) {
    const reason = `[Tingkat: ${level}] ${matched.reason}`;

    // Catat ke tabel deploy_write_guard_logs agar operator tahu kenapa aksi tidak terjadi
    try {
      await db.insert(deployWriteGuardLogs).values({
        endpoint,
        method: method.toUpperCase(),
        reason,
        payloadPreview: payloadPreview ? payloadPreview.slice(0, 500) : null,
      });
    } catch {
      // Jangan biarkan kegagalan log menghentikan penolakan keamanan
    }

    return {
      blocked: true,
      reason,
      level,
    };
  }

  return { blocked: false, level };
}

/**
 * Mengambil catatan penolakan penjaga tulis terbaru.
 */
export async function getWriteGuardLogs(
  limit = 50,
): Promise<DeployWriteGuardLog[]> {
  return db
    .select()
    .from(deployWriteGuardLogs)
    .orderBy(desc(deployWriteGuardLogs.blockedAt))
    .limit(limit);
}

/**
 * Menghapus riwayat log penjaga tulis.
 */
export async function clearWriteGuardLogs(): Promise<void> {
  await db.delete(deployWriteGuardLogs);
}
