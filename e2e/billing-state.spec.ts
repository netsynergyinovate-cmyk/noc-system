import { expect, test } from "@playwright/test";
import {
  BILLING_REFRESH_MS,
  BILLING_RUNNING_POLL_SECONDS,
  describeSyncState,
  loadBillingSync,
  mockBillingOverview,
  mockBillingSync,
  nextBillingRefreshAt,
  summarizeSync,
  type BillingSyncRun,
  type BillingSyncState,
} from "../src/lib/dashboard/billing";
import { BILLING_START } from "./billing-moments";

// Kalimat keadaan sinkron (dipakai kartu di halaman Billing dan ringkasan di
// halaman Pelanggan) dan jadwal penyegarannya. Tanpa browser.

function makeRun(
  id: string,
  finishedAt: number,
  status: BillingSyncRun["status"],
): BillingSyncRun {
  return {
    id,
    startedAt: finishedAt - 10,
    finishedAt,
    status,
    result:
      status === "success"
        ? { invoices: 3, matched: 2, unmatched: 1, withoutInvoice: 0 }
        : null,
    error: status === "failed" ? "gagal." : null,
  };
}

// Riwayat terbaru di atas dari urutan "S" (berhasil) dan "F" (gagal).
function runsOf(pattern: string) {
  return [...pattern].map((letter, index) =>
    makeRun(
      `run-${index}`,
      10_000 - index * 100,
      letter === "S" ? "success" : "failed",
    ),
  );
}

const state = (pattern: string, running = false) => ({
  running: running ? { startedAt: 9_990 } : null,
  runs: runsOf(pattern),
});

test.describe("kalimat keadaan sinkron", () => {
  test("tanpa sinkron sama sekali dan tidak berjalan: belum ada sinkron, netral", () => {
    expect(describeSyncState(state(""))).toEqual({
      phase: "none",
      tone: "neutral",
      failures: 0,
      text: "Belum ada sinkron",
    });
  });

  test("sedang berjalan: kalimatnya sama apa pun hasil sebelumnya, tetapi jumlah gagal beruntun tetap dibawa", () => {
    for (const [pattern, failures] of [
      ["", 0],
      ["S", 0],
      ["SFF", 0],
      ["F", 1],
      ["FFFS", 3],
      ["FF", 2],
    ] as const) {
      expect(describeSyncState(state(pattern, true)), pattern).toEqual({
        phase: "running",
        tone: "neutral",
        failures,
        text: "Sedang menyinkron",
      });
    }
  });

  test("yang terakhir berhasil: berhasil dan hijau, berapa pun kegagalan sebelumnya", () => {
    for (const pattern of ["S", "SF", "SFF", "SFFFF", "SSSS"]) {
      expect(describeSyncState(state(pattern)), pattern).toEqual({
        phase: "ok",
        tone: "success",
        failures: 0,
        text: "Sinkron terakhir berhasil",
      });
    }
  });

  test("satu kegagalan hanya peringatan, dua atau lebih berturut-turut bahaya dengan jumlahnya", () => {
    expect(describeSyncState(state("FS"))).toEqual({
      phase: "failed",
      tone: "warning",
      failures: 1,
      text: "Sinkron terakhir gagal",
    });
    expect(describeSyncState(state("FSFF"))).toMatchObject({
      tone: "warning",
      failures: 1,
    });
    for (const [pattern, text] of [
      ["FFS", "Gagal 2 kali berturut-turut"],
      ["FFFS", "Gagal 3 kali berturut-turut"],
      ["FFFFFFFFFFFFS", "Gagal 12 kali berturut-turut"],
    ] as const) {
      expect(describeSyncState(state(pattern)), pattern).toEqual({
        phase: "failed",
        tone: "danger",
        failures: pattern.length - 1,
        text,
      });
    }
  });

  test("semua gagal dan belum pernah berhasil: dihitung semuanya, dengan pemisah ribuan", () => {
    expect(describeSyncState(state("FFF"))).toMatchObject({
      phase: "failed",
      tone: "danger",
      failures: 3,
      text: "Gagal 3 kali berturut-turut",
    });
    expect(describeSyncState(state("F".repeat(1_234)))).toMatchObject({
      failures: 1_234,
      text: "Gagal 1.234 kali berturut-turut",
    });
  });

  test("urutan masukan tidak memengaruhi, dan masukan tidak diubah", () => {
    const input = state("FFS");
    const frozen = Object.freeze({
      running: input.running,
      runs: Object.freeze([...input.runs].reverse()),
    });
    expect(describeSyncState(frozen)).toEqual(describeSyncState(input));
    expect(frozen.runs.map((run) => run.id)).toEqual([
      "run-2",
      "run-1",
      "run-0",
    ]);
  });

  test("di data tiruan sama dengan menghitung sendiri dari riwayat, sepanjang tiga hari", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (let t = BILLING_START; t < BILLING_START + 3 * 86_400; t += 53) {
      const sync = mockBillingSync(t);
      let failures = 0;
      while (
        failures < sync.runs.length &&
        sync.runs[failures].status === "failed"
      ) {
        failures += 1;
      }
      const got = describeSyncState(sync);
      const phase = sync.running
        ? "running"
        : sync.runs[0].status === "success"
          ? "ok"
          : "failed";
      const tone =
        phase === "running"
          ? "neutral"
          : phase === "ok"
            ? "success"
            : failures >= 2
              ? "danger"
              : "warning";
      if (got.phase !== phase) problems.push(`${t}: fase`);
      if (got.tone !== tone) problems.push(`${t}: nada`);
      if (got.failures !== failures) problems.push(`${t}: gagal`);
      if (got.failures !== summarizeSync(sync.runs).consecutiveFailures) {
        problems.push(`${t}: ringkasan`);
      }
      seen.add(`${got.phase}/${got.tone}`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // Datanya memuat semua keadaan, jadi pengujian ini bermakna.
    expect([...seen].sort()).toEqual([
      "failed/danger",
      "failed/warning",
      "ok/success",
      "running/neutral",
    ]);
  });
});

test.describe("jadwal penyegaran data billing", () => {
  test("selang penyegaran berkala 30 detik, dan selama berjalan 5 detik", () => {
    expect(BILLING_REFRESH_MS).toBe(30_000);
    expect(BILLING_RUNNING_POLL_SECONDS).toBe(5);
  });

  test("tidak berjalan: tepat saat sinkron berikutnya; berjalan: lima detik lagi", () => {
    expect(
      nextBillingRefreshAt({ running: null, nextRunAt: 5_000 }, 1_000),
    ).toBe(5_000);
    expect(
      nextBillingRefreshAt(
        { running: { startedAt: 990 }, nextRunAt: 5_000 },
        1_000,
      ),
    ).toBe(1_005);
    // Waktu sekarang tidak dipakai bila tidak berjalan, dan sebaliknya.
    expect(
      nextBillingRefreshAt({ running: null, nextRunAt: 5_000 }, 4_000),
    ).toBe(5_000);
    expect(
      nextBillingRefreshAt(
        { running: { startedAt: 3_990 }, nextRunAt: 5_000 },
        4_000,
      ),
    ).toBe(4_005);
  });

  test("di data tiruan selalu di depan dan paling jauh sejam lagi, pada tiap detik di sekitar batas sinkron", () => {
    const problems: string[] = [];
    const times: number[] = [];
    for (let t = BILLING_START; t < BILLING_START + 86_400; t += 61) {
      times.push(t);
    }
    // Detik-detik di sekitar awal dan akhir beberapa sinkron.
    const first = mockBillingSync(BILLING_START).nextRunAt;
    for (let slot = 0; slot < 6; slot += 1) {
      for (let offset = -3; offset <= 35; offset += 1) {
        times.push(first + slot * 3_600 + offset);
      }
    }
    for (const t of times) {
      const sync = mockBillingSync(t);
      const at = nextBillingRefreshAt(sync, t);
      if (at <= t) problems.push(`${t}: tidak di depan`);
      if (at - t > 3_600) problems.push(`${t}: lebih dari sejam`);
      if (sync.running && at !== t + BILLING_RUNNING_POLL_SECONDS) {
        problems.push(`${t}: berjalan`);
      }
      if (!sync.running && at !== sync.nextRunAt) problems.push(`${t}: jadwal`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  test("loadBillingSync memberikan keadaan sinkron yang sama dengan yang ada di GET billing", async () => {
    for (const t of [
      BILLING_START,
      BILLING_START + 1_234,
      BILLING_START + 9_999,
    ]) {
      const alone: BillingSyncState = await loadBillingSync(t);
      expect(JSON.stringify(alone)).toBe(
        JSON.stringify(mockBillingOverview(t).sync),
      );
      expect(JSON.stringify(alone)).toBe(JSON.stringify(mockBillingSync(t)));
    }
  });
});
