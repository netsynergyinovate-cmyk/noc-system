import { getRawPool } from "@/db";
import {
  PAGE_TIPS_REGISTRY,
  type PageTipItem,
} from "@/lib/dashboard/page-tips-data";

let inMemoryCustomTips: Record<string, PageTipItem> = {};

/**
 * Memastikan tabel `tutorial_content` tersedia di database PostgreSQL.
 */
export async function ensureTutorialContentTable(): Promise<void> {
  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "tutorial_content" (
          id text PRIMARY KEY, -- pagePath mis. "/app", "/app/alert"
          page_title text NOT NULL,
          summary text NOT NULL,
          metrics jsonb NOT NULL DEFAULT '[]',
          troubleshooting jsonb NOT NULL DEFAULT '[]',
          created_at timestamp with time zone DEFAULT now() NOT NULL,
          updated_at timestamp with time zone DEFAULT now() NOT NULL
        )
      `);

      // Seed awal jika kosong
      const countRes = await client.query("SELECT COUNT(*) AS c FROM \"tutorial_content\"");
      if (Number(countRes.rows[0]?.c ?? 0) === 0) {
        for (const [path, item] of Object.entries(PAGE_TIPS_REGISTRY)) {
          await client.query(
            `INSERT INTO "tutorial_content" (id, page_title, summary, metrics, troubleshooting)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [
              path,
              item.pageTitle,
              item.summary,
              JSON.stringify(item.metrics),
              JSON.stringify(item.troubleshooting),
            ],
          );
        }
      }
    } finally {
      client.release();
    }
  } catch {
    // Database belum aktif
  }
}

/**
 * Mengambil konten tips untuk satu rute halaman tertentu.
 */
export async function getPageTipContent(pagePath: string): Promise<PageTipItem | null> {
  // 1. Cek in-memory override
  if (inMemoryCustomTips[pagePath]) {
    return inMemoryCustomTips[pagePath];
  }

  // 2. Cek database
  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await ensureTutorialContentTable();
      const res = await client.query(
        "SELECT id, page_title, summary, metrics, troubleshooting FROM \"tutorial_content\" WHERE id = $1",
        [pagePath],
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          pagePath: row.id,
          pageTitle: row.page_title,
          summary: row.summary,
          metrics: typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics,
          troubleshooting:
            typeof row.troubleshooting === "string"
              ? JSON.parse(row.troubleshooting)
              : row.troubleshooting,
        };
      }
    } finally {
      client.release();
    }
  } catch {
    // Database belum aktif
  }

  // 3. Fallback kamus registri bawaan
  return PAGE_TIPS_REGISTRY[pagePath] ?? null;
}

/**
 * Mengambil seluruh konten tips halaman yang terdaftar.
 */
export async function getAllPageTipsContent(): Promise<Record<string, PageTipItem>> {
  const result: Record<string, PageTipItem> = {
    ...PAGE_TIPS_REGISTRY,
    ...inMemoryCustomTips,
  };

  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await ensureTutorialContentTable();
      const res = await client.query(
        "SELECT id, page_title, summary, metrics, troubleshooting FROM \"tutorial_content\"",
      );
      for (const row of res.rows) {
        result[row.id] = {
          pagePath: row.id,
          pageTitle: row.page_title,
          summary: row.summary,
          metrics: typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics,
          troubleshooting:
            typeof row.troubleshooting === "string"
              ? JSON.parse(row.troubleshooting)
              : row.troubleshooting,
        };
      }
    } finally {
      client.release();
    }
  } catch {
    // Database belum aktif
  }

  return result;
}

/**
 * Menyimpan atau memperbarui konten tips untuk sebuah halaman.
 */
export async function savePageTipContent(tip: PageTipItem): Promise<PageTipItem> {
  inMemoryCustomTips[tip.pagePath] = tip;

  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await ensureTutorialContentTable();
      await client.query(
        `INSERT INTO "tutorial_content" (id, page_title, summary, metrics, troubleshooting, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
           page_title = EXCLUDED.page_title,
           summary = EXCLUDED.summary,
           metrics = EXCLUDED.metrics,
           troubleshooting = EXCLUDED.troubleshooting,
           updated_at = NOW()`,
        [
          tip.pagePath,
          tip.pageTitle,
          tip.summary,
          JSON.stringify(tip.metrics),
          JSON.stringify(tip.troubleshooting),
        ],
      );
    } finally {
      client.release();
    }
  } catch {
    // Database belum aktif
  }

  return tip;
}

/**
 * Reset in-memory custom tips (untuk keperluan pengujian unit test).
 */
export function resetTutorialContentOverrides(): void {
  inMemoryCustomTips = {};
}
