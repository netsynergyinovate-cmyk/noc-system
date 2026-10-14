import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { createClock } from "../src/lib/dashboard/clock";
import { isActive } from "../src/lib/dashboard/anomalies";
import { loadAnomalies } from "../src/lib/dashboard/anomaly-feed";
import { formatElapsed, isoDuration } from "../src/lib/dashboard/format";

// Durasi berjalan tiap anomali: yang aktif bertambah tiap detik, yang selesai
// tetap. Bagian pertama tanpa browser; bagian akhir memakai jam palsu browser
// supaya detiknya bisa diatur dan hasilnya pasti.

const headers = { Origin: "http://localhost:3101" };

test.describe("format lama berjalan", () => {
  test("ditulis sampai detik, dan detik dibuang mulai satu jam", () => {
    const cases: [number, string][] = [
      [0, "0 detik"],
      [1, "1 detik"],
      [59, "59 detik"],
      [60, "1 menit"],
      [61, "1 menit 1 detik"],
      [750, "12 menit 30 detik"],
      [3599, "59 menit 59 detik"],
      [3600, "1 jam"],
      [3661, "1 jam 1 menit"],
      [7325, "2 jam 2 menit"],
      [93_600, "26 jam"],
    ];
    for (const [seconds, text] of cases) {
      expect(formatElapsed(seconds), String(seconds)).toBe(text);
    }
  });

  test("angka negatif dan pecahan tidak menghasilkan teks aneh", () => {
    expect(formatElapsed(-5)).toBe("0 detik");
    expect(formatElapsed(59.9)).toBe("59 detik");
    expect(formatElapsed(Number.NaN)).not.toContain("NaN");
  });

  test("format ISO 8601 untuk atribut dateTime", () => {
    const cases: [number, string][] = [
      [0, "PT0S"],
      [5, "PT5S"],
      [60, "PT1M"],
      [750, "PT12M30S"],
      [3600, "PT1H"],
      [3725, "PT1H2M5S"],
      [7200, "PT2H"],
    ];
    for (const [seconds, text] of cases) {
      expect(isoDuration(seconds), String(seconds)).toBe(text);
    }
    // Dibaca kembali selalu menghasilkan detik yang sama.
    const parse = (iso: string) => {
      const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)!;
      return (
        Number(match[1] ?? 0) * 3600 +
        Number(match[2] ?? 0) * 60 +
        Number(match[3] ?? 0)
      );
    };
    for (let seconds = 0; seconds < 20_000; seconds += 37) {
      expect(parse(isoDuration(seconds)), String(seconds)).toBe(seconds);
    }
  });
});

test.describe("jam detik bersama", () => {
  // Timer palsu yang dijalankan tangan.
  function fakeClock() {
    let nowMs = 1_000_000;
    const timers = new Map<number, { callback: () => void; every: number }>();
    let nextId = 1;
    const clock = createClock({
      now: () => Math.floor(nowMs / 1000),
      setTimer: (callback, every) => {
        timers.set(nextId, { callback, every });
        return nextId++;
      },
      clearTimer: (id) => {
        timers.delete(id as number);
      },
    });
    return {
      clock,
      timers,
      advance(ms: number) {
        // Maju per 250 ms seperti timer sungguhan.
        for (let left = ms; left > 0; left -= 250) {
          nowMs += Math.min(250, left);
          for (const timer of [...timers.values()]) timer.callback();
        }
      },
    };
  }

  test("satu timer untuk semua pelanggan, dan mati saat tidak ada lagi", () => {
    const { clock, timers } = fakeClock();
    expect(timers.size).toBe(0);
    const stopA = clock.subscribe(() => {});
    const stopB = clock.subscribe(() => {});
    expect(timers.size).toBe(1);
    expect(clock.listenerCount).toBe(2);
    stopA();
    expect(timers.size).toBe(1);
    stopB();
    expect(timers.size).toBe(0);
    expect(clock.listenerCount).toBe(0);
    // Berlangganan lagi menyalakan timer baru.
    clock.subscribe(() => {})();
    expect(timers.size).toBe(0);
  });

  test("pelanggan hanya dikabari saat detiknya berganti, dan nilainya stabil di antaranya", () => {
    const { clock, advance } = fakeClock();
    let calls = 0;
    const stop = clock.subscribe(() => {
      calls += 1;
    });
    const first = clock.getSnapshot();
    advance(500);
    expect(calls).toBe(0);
    expect(clock.getSnapshot()).toBe(first);
    advance(500);
    expect(calls).toBe(1);
    expect(clock.getSnapshot()).toBe(first + 1);
    advance(3000);
    expect(calls).toBe(4);
    expect(clock.getSnapshot()).toBe(first + 4);
    stop();
    // Setelah berhenti tidak ada lagi panggilan.
    advance(5000);
    expect(calls).toBe(4);
  });

  test("tanpa pelanggan, nilai dibaca ulang supaya tidak basi", () => {
    const { clock, advance } = fakeClock();
    const before = clock.getSnapshot();
    advance(3000);
    expect(clock.getSnapshot()).toBe(before + 3);
  });

  test("pelanggan yang berhenti saat dikabari tidak merusak yang lain", () => {
    const { clock, advance } = fakeClock();
    const seen: string[] = [];
    let stopA = () => {};
    stopA = clock.subscribe(() => {
      seen.push("a");
      stopA();
    });
    clock.subscribe(() => seen.push("b"));
    advance(1000);
    advance(1000);
    expect(seen).toEqual(["a", "b", "b"]);
  });
});

// Waktu di data tiruan yang punya anomali aktif, dipilih sekali dari data itu
// sendiri supaya test tidak bergantung pada jam sebenarnya.
async function findTimeWithActiveAnomaly() {
  const start = 1_791_400_000;
  for (let t = start; t < start + 7 * 86_400; t += 900) {
    const active = (await loadAnomalies(t)).filter(isActive);
    // Sudah berjalan lebih dari 10 menit, supaya durasinya dalam menit dan detik.
    const old = active.find((item) => t - item.startedAt > 600);
    if (old) return { t, anomaly: old, list: await loadAnomalies(t) };
  }
  throw new Error("tidak ada waktu dengan anomali aktif pada data tiruan");
}

async function signUpAndOpen(page: Page, name: string) {
  const data = {
    name,
    email: `dur-${randomUUID()}@example.com`,
    password: "A-long-test-password-123!",
  };
  let response = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data,
  });
  if (response.status() === 429) {
    const seconds = Number(response.headers()["retry-after"] || 10);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.1) * 1000);
    response = await page.request.post("/api/auth/sign-up/email", {
      headers,
      data,
    });
  }
  expect(response.status()).toBe(200);
}

test("durasi anomali aktif bertambah tiap detik, dan yang selesai tetap", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t, anomaly, list } = await findTimeWithActiveAnomaly();
  await signUpAndOpen(page, "Petugas Durasi");

  // Jam browser dipasang ke waktu yang punya anomali aktif.
  await page.clock.install({ time: t * 1000 });
  await page.goto("/app/anomali");
  const row = page.locator(`[data-anomaly-id="${anomaly.id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-active", "true");

  // Hentikan jam pada detik yang pasti, lalu periksa angkanya persis.
  const fakeNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(fakeNow + 1000);
  const seconds = () => page.evaluate(() => Math.floor(Date.now() / 1000));
  const duration = row.getByTestId("anomaly-duration");

  const at1 = await seconds();
  await expect(duration).toHaveText(
    `sudah ${formatElapsed(at1 - anomaly.startedAt)}`,
  );
  await expect(duration).toHaveAttribute(
    "datetime",
    isoDuration(at1 - anomaly.startedAt),
  );

  // Lima detik kemudian durasinya lima detik lebih panjang, detik demi detik.
  for (let step = 1; step <= 5; step += 1) {
    await page.clock.runFor(1000);
    const now = await seconds();
    expect(now).toBe(at1 + step);
    await expect(duration).toHaveText(
      `sudah ${formatElapsed(now - anomaly.startedAt)}`,
    );
  }

  // Yang sudah selesai tidak ikut bertambah: lamanya dari awal sampai akhirnya.
  const resolved = list.filter((item) => !isActive(item));
  expect(resolved.length).toBeGreaterThan(3);
  for (const item of resolved.slice(0, 6)) {
    const resolvedRow = page.locator(`[data-anomaly-id="${item.id}"]`);
    await expect(resolvedRow).toHaveAttribute("data-active", "false");
    const elapsed = item.endedAt! - item.startedAt;
    await expect(resolvedRow.getByTestId("anomaly-duration")).toHaveText(
      `selama ${formatElapsed(elapsed)}`,
    );
    await expect(resolvedRow.getByTestId("anomaly-duration")).toHaveAttribute(
      "datetime",
      isoDuration(elapsed),
    );
  }
  const before =
    (await resolved[0]) &&
    (await page
      .locator(`[data-anomaly-id="${resolved[0].id}"]`)
      .getByTestId("anomaly-duration")
      .textContent());
  await page.clock.runFor(10_000);
  expect(
    await page
      .locator(`[data-anomaly-id="${resolved[0].id}"]`)
      .getByTestId("anomaly-duration")
      .textContent(),
  ).toBe(before);

  expect(errors).toEqual([]);
});
