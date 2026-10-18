import "server-only";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  alertThresholds,
  dataSyncRuns,
  routers,
  seedTracking,
  whatsappRecipients,
} from "@/db/schema";
import { toRows } from "@/lib/dashboard/threshold-rows";
import { defaultThresholds } from "@/lib/dashboard/thresholds";
import { encryptAES256GCM } from "@/lib/encryption";
import { logSyncOperationAudit } from "@/services/audit.service";

export interface SeedResultItem {
  key: string;
  category: "accounts" | "thresholds" | "devices" | "whatsapp" | "billing";
  targetTable: string;
  recordsCount: number;
  status: "seeded" | "already_seeded" | "skipped";
  checksum: string;
}

export interface SeedRunReport {
  success: boolean;
  totalCategories: number;
  newlySeededCount: number;
  alreadySeededCount: number;
  results: SeedResultItem[];
  executedAt: string;
}

export function computePayloadChecksum(payload: unknown): string {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  return `sha256-${createHash("sha256").update(serialized).digest("hex").slice(0, 16)}`;
}

/**
 * Menyemai aturan ambang batas anomali bawaan (CPU 85%, queue 90%, port 50, optical -27, offline 60).
 * Idempoten: bila sudah ada baris, tidak menimpa nilai yang telah disesuaikan operator.
 */
export async function seedAlertThresholdsIdempotent(): Promise<SeedResultItem> {
  const key = "seed_thresholds_v1";
  const rows = toRows(defaultThresholds());
  const checksum = computePayloadChecksum(rows);

  const existing = await db
    .select()
    .from(seedTracking)
    .where(eq(seedTracking.seedKey, key))
    .limit(1);

  if (existing.length > 0 && existing[0].status === "seeded") {
    return {
      key,
      category: "thresholds",
      targetTable: "alert_thresholds",
      recordsCount: rows.length,
      status: "already_seeded",
      checksum,
    };
  }

  let insertedCount = 0;
  for (const row of rows) {
    const res = await db
      .insert(alertThresholds)
      .values({ ...row, updatedBy: null })
      .onConflictDoNothing({ target: alertThresholds.ruleKind });
    if (res.rowCount && res.rowCount > 0) insertedCount++;
  }

  await db
    .insert(seedTracking)
    .values({
      seedKey: key,
      category: "thresholds",
      targetTable: "alert_thresholds",
      recordsCount: rows.length,
      checksum,
      isIdempotent: true,
      status: "seeded",
      details: JSON.stringify({ insertedCount, defaultRows: rows.length }),
    })
    .onConflictDoUpdate({
      target: seedTracking.seedKey,
      set: {
        verifiedAt: new Date(),
        recordsCount: rows.length,
        status: "seeded",
      },
    });

  return {
    key,
    category: "thresholds",
    targetTable: "alert_thresholds",
    recordsCount: rows.length,
    status: "seeded",
    checksum,
  };
}

/**
 * Menyemai kontak penerima WhatsApp darurat awal.
 */
export async function seedDefaultRecipientsIdempotent(): Promise<SeedResultItem> {
  const key = "seed_whatsapp_recipients_v1";
  const isLive =
    process.env.DASHBOARD_DATA === "live" ||
    process.env.DATA_MODE === "live" ||
    process.env.DATA_MODE === "nyata" ||
    process.env.NODE_ENV === "production" ||
    process.env.APP_ENV === "production";

  if (isLive) {
    return {
      key,
      category: "whatsapp",
      targetTable: "whatsapp_recipients",
      recordsCount: 0,
      status: "skipped",
      checksum: "skipped_live_mode",
    };
  }

  const defaultRecipients = [
    { name: "Kepala Teknisi NOC", target: "6281200000001", type: "individual" as const },
    { name: "Petugas On-Call NOC", target: "6281200000002", type: "individual" as const },
  ];
  const checksum = computePayloadChecksum(defaultRecipients);

  const existing = await db
    .select()
    .from(seedTracking)
    .where(eq(seedTracking.seedKey, key))
    .limit(1);

  if (existing.length > 0 && existing[0].status === "seeded") {
    return {
      key,
      category: "whatsapp",
      targetTable: "whatsapp_recipients",
      recordsCount: defaultRecipients.length,
      status: "already_seeded",
      checksum,
    };
  }

  for (const r of defaultRecipients) {
    await db
      .insert(whatsappRecipients)
      .values(r)
      .onConflictDoNothing({ target: whatsappRecipients.target });
  }

  await db
    .insert(seedTracking)
    .values({
      seedKey: key,
      category: "whatsapp",
      targetTable: "whatsapp_recipients",
      recordsCount: defaultRecipients.length,
      checksum,
      isIdempotent: true,
      status: "seeded",
    })
    .onConflictDoUpdate({
      target: seedTracking.seedKey,
      set: { verifiedAt: new Date(), status: "seeded" },
    });

  return {
    key,
    category: "whatsapp",
    targetTable: "whatsapp_recipients",
    recordsCount: defaultRecipients.length,
    status: "seeded",
    checksum,
  };
}

/**
 * Menyemai Router Gateway bawaan jika belum ada router terdaftar sama sekali.
 */
export async function seedDefaultRouterIdempotent(): Promise<SeedResultItem> {
  const key = "seed_default_router_v1";
  const isLive =
    process.env.DASHBOARD_DATA === "live" ||
    process.env.DATA_MODE === "live" ||
    process.env.DATA_MODE === "nyata" ||
    process.env.NODE_ENV === "production" ||
    process.env.APP_ENV === "production";

  if (isLive) {
    return {
      key,
      category: "devices",
      targetTable: "routers",
      recordsCount: 0,
      status: "skipped",
      checksum: "skipped_live_mode",
    };
  }

  const defaultRouter = {
    name: "Router Core MikroTik (Bawaan)",
    host: "10.10.0.1:8728",
    username: "noc_monitor",
    passwordEnc: encryptAES256GCM("NocDefault#2026"),
    status: "aktif" as const,
  };
  const checksum = computePayloadChecksum({ name: defaultRouter.name, host: defaultRouter.host });

  const existing = await db
    .select()
    .from(seedTracking)
    .where(eq(seedTracking.seedKey, key))
    .limit(1);

  if (existing.length > 0 && existing[0].status === "seeded") {
    return {
      key,
      category: "devices",
      targetTable: "routers",
      recordsCount: 1,
      status: "already_seeded",
      checksum,
    };
  }

  await db
    .insert(routers)
    .values(defaultRouter)
    .onConflictDoNothing({ target: routers.host });

  await db
    .insert(seedTracking)
    .values({
      seedKey: key,
      category: "devices",
      targetTable: "routers",
      recordsCount: 1,
      checksum,
      isIdempotent: true,
      status: "seeded",
    })
    .onConflictDoUpdate({
      target: seedTracking.seedKey,
      set: { verifiedAt: new Date(), status: "seeded" },
    });

  return {
    key,
    category: "devices",
    targetTable: "routers",
    recordsCount: 1,
    status: "seeded",
    checksum,
  };
}

/**
 * Menjalankan seluruh inisialisasi seed data awal secara idempoten dan mencatat riwayat run.
 */
export async function runAllInitialSeeds(actor = "system"): Promise<SeedRunReport> {
  const startTime = Date.now();
  const results: SeedResultItem[] = [];

  // 1. Ambang batas alert
  results.push(await seedAlertThresholdsIdempotent());

  // 2. Kontak WhatsApp
  results.push(await seedDefaultRecipientsIdempotent());

  // 3. Router bawaan
  results.push(await seedDefaultRouterIdempotent());

  const newlySeeded = results.filter((r) => r.status === "seeded").length;
  const alreadySeeded = results.filter((r) => r.status === "already_seeded").length;
  const totalRecords = results.reduce((sum, r) => sum + r.recordsCount, 0);

  // Catat run ke dataSyncRuns
  await db.insert(dataSyncRuns).values({
    module: "seed_initial_data",
    syncType: "seed",
    direction: "seed",
    status: "completed",
    recordsProcessed: totalRecords,
    recordsInserted: newlySeeded,
    recordsUpdated: 0,
    recordsSkipped: alreadySeeded,
    checksum: computePayloadChecksum(results),
    durationMs: Date.now() - startTime,
    actor,
    summaryMessage: `Penyemaian seed idempoten: ${newlySeeded} kategori baru, ${alreadySeeded} sudah terpasang.`,
    completedAt: new Date(),
  });

  // Catat audit log operasi seed
  await logSyncOperationAudit({
    operation: "seed",
    target: "initial_data",
    summary: `Penyemaian data awal selesai: ${newlySeeded} baru, ${alreadySeeded} idempoten.`,
    success: true,
    recordsCount: totalRecords,
    durationMs: Date.now() - startTime,
    detail: { newlySeeded, alreadySeeded, actor },
  });

  return {
    success: true,
    totalCategories: results.length,
    newlySeededCount: newlySeeded,
    alreadySeededCount: alreadySeeded,
    results,
    executedAt: new Date().toISOString(),
  };
}

export interface SeedStatusResponse {
  status: "ready" | "needs_seed" | "in_progress";
  overview: {
    totalCategories: number;
    seededCategories: number;
    pendingCategories: number;
    totalRecords: number;
    lastVerifiedAt: string | null;
  };
  items: Array<{
    id: string;
    seedKey: string;
    category: string;
    targetTable: string;
    recordsCount: number;
    checksum: string;
    isIdempotent: boolean;
    status: string;
    seededAt: string | null;
    verifiedAt: string | null;
  }>;
}

/**
 * Mengambil status terkini seed data awal dari tabel seedTracking.
 */
export async function getSeedDataStatus(): Promise<SeedStatusResponse> {
  try {
    const rows = await db.select().from(seedTracking);

    if (rows.length === 0) {
      return {
        status: "needs_seed",
        overview: {
          totalCategories: 3,
          seededCategories: 0,
          pendingCategories: 3,
          totalRecords: 0,
          lastVerifiedAt: null,
        },
        items: [],
      };
    }

    const seeded = rows.filter((r) => r.status === "seeded").length;
    const totalRecords = rows.reduce((sum, r) => sum + r.recordsCount, 0);
    const lastVerified = rows
      .map((r) => r.verifiedAt ?? r.seededAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b!).getTime() - new Date(a!).getTime())[0];

    return {
      status: seeded === rows.length ? "ready" : "needs_seed",
      overview: {
        totalCategories: rows.length,
        seededCategories: seeded,
        pendingCategories: rows.length - seeded,
        totalRecords,
        lastVerifiedAt: lastVerified ? lastVerified.toISOString() : null,
      },
      items: rows.map((r) => ({
        id: r.id,
        seedKey: r.seedKey,
        category: r.category,
        targetTable: r.targetTable,
        recordsCount: r.recordsCount,
        checksum: r.checksum,
        isIdempotent: r.isIdempotent,
        status: r.status,
        seededAt: r.seededAt ? r.seededAt.toISOString() : null,
        verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
      })),
    };
  } catch {
    return {
      status: "needs_seed",
      overview: {
        totalCategories: 0,
        seededCategories: 0,
        pendingCategories: 0,
        totalRecords: 0,
        lastVerifiedAt: null,
      },
      items: [],
    };
  }
}

export interface PurgeReport {
  purgedRouters: number;
  purgedRecipients: number;
  purgedSeedTracking: number;
  isClean: boolean;
  timestamp: string;
}

/**
 * Menghapus seluruh data contoh/dummy bawaan dari database produksi (Zero-Dummy Enforcer).
 */
export async function purgeSampleSeedDataFromProduction(): Promise<PurgeReport> {
  // 1. Hapus router contoh bawaan (10.10.0.1:8728)
  const routerRes = await db
    .delete(routers)
    .where(eq(routers.host, "10.10.0.1:8728"));
  const purgedRouters = routerRes.rowCount ?? 0;

  // 2. Hapus kontak dummy WhatsApp bawaan (6281200000001 & 6281200000002)
  let purgedRecipients = 0;
  for (const dummyTarget of ["6281200000001", "6281200000002"]) {
    const res = await db
      .delete(whatsappRecipients)
      .where(eq(whatsappRecipients.target, dummyTarget));
    purgedRecipients += res.rowCount ?? 0;
  }

  // 3. Hapus rekam jejak seed contoh dari seed_tracking agar tidak dianggap sebagai konfigurasi nyata
  let purgedSeedTracking = 0;
  for (const sampleKey of ["seed_default_router_v1", "seed_whatsapp_recipients_v1"]) {
    const res = await db
      .delete(seedTracking)
      .where(eq(seedTracking.seedKey, sampleKey));
    purgedSeedTracking += res.rowCount ?? 0;
  }

  return {
    purgedRouters,
    purgedRecipients,
    purgedSeedTracking,
    isClean: true,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Memeriksa apakah ada sisa data seed contoh di tabel-tabel database.
 */
export async function checkSampleSeedDataInProduction(): Promise<{
  hasSampleData: boolean;
  sampleRouters: number;
  sampleRecipients: number;
  sampleSeedTracking: number;
}> {
  const sampleRouters = await db
    .select({ id: routers.id })
    .from(routers)
    .where(eq(routers.host, "10.10.0.1:8728"));

  const sampleRecipients = await db
    .select({ id: whatsappRecipients.id })
    .from(whatsappRecipients)
    .where(
      inArray(whatsappRecipients.target, ["6281200000001", "6281200000002"]),
    );

  const sampleTracking = await db
    .select({ id: seedTracking.id })
    .from(seedTracking)
    .where(
      inArray(seedTracking.seedKey, [
        "seed_default_router_v1",
        "seed_whatsapp_recipients_v1",
      ]),
    );

  const hasSampleData =
    sampleRouters.length > 0 ||
    sampleRecipients.length > 0 ||
    sampleTracking.length > 0;

  return {
    hasSampleData,
    sampleRouters: sampleRouters.length,
    sampleRecipients: sampleRecipients.length,
    sampleSeedTracking: sampleTracking.length,
  };
}

