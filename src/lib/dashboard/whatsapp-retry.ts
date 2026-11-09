// Logika murni retry: tanpa DB/server-only agar bisa diuji. Pengirim & penyimpan disuntik.
export interface RetryRow {
  id: string;
  recipientTarget: string;
  message: string;
}

export interface RetrySummary {
  retried: number;
  succeeded: number;
  failed: number;
}

export async function retryRows(
  rows: RetryRow[],
  send: (row: RetryRow) => Promise<{ ok: boolean; error?: string }>,
  save: (id: string, result: { ok: boolean; error?: string }) => Promise<void>,
): Promise<RetrySummary> {
  const summary: RetrySummary = { retried: 0, succeeded: 0, failed: 0 };
  for (const row of rows) {
    let result: { ok: boolean; error?: string };
    try {
      result = await send(row);
    } catch (e) {
      result = {
        ok: false,
        error: e instanceof Error ? e.message : "Gagal mengirim.",
      };
    }
    await save(row.id, result);
    summary.retried++;
    if (result.ok) summary.succeeded++;
    else summary.failed++;
  }
  return summary;
}
