import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import { mockActiveAlerts } from "../src/lib/dashboard/alerts";
import {
  buildIncidentCards,
  type IncidentCard,
} from "../src/lib/dashboard/incident-cards";
import {
  createMockIncidentHub,
  listSignature,
  mergeIncidentCards,
} from "../src/lib/dashboard/incident-sync";
import { useDashboardStore } from "../src/lib/dashboard/store";

// Pembaruan kartu insiden lewat hub: pesan "incidents" berisi daftar lengkap,
// dikirim saat tersambung dan hanya saat isinya berubah. Bagian pertama menguji
// logikanya tanpa browser; sisanya memakai halaman sungguhan dengan jam palsu.

const headers = { Origin: "http://localhost:3101" };
const START = 1_791_400_000;

const cardsAt = (t: number) => buildIncidentCards(mockActiveAlerts(t));

// Kartu buatan tangan, cukup untuk menguji penggabungan.
function fake(id: string, alertCount = 1, severity = "warning"): IncidentCard {
  return {
    id,
    correlationId: alertCount > 1 ? id : null,
    cause: alertCount > 1 ? "odp" : "single",
    title: `Judul ${id}`,
    reasons: [],
    confidence: alertCount > 1 ? "medium" : null,
    severity: severity as IncidentCard["severity"],
    rootSource: { kind: "odp", id: "ODP-A", name: "ODP-A" },
    affectedCustomers: alertCount,
    servedCustomers: 8,
    routerId: "router-1",
    routerName: "RTR-1",
    odpName: "ODP-A",
    startedAt: START,
    detectedAt: START + 30,
    timeSource: "event",
    timeUncertaintySeconds: 0,
    alertCount,
    kinds: [{ kind: "offline", count: alertCount }],
    alerts: [],
    focusCustomerId: null,
  };
}
const clone = (card: IncidentCard) => structuredClone(card);

test.describe("menggabungkan daftar kartu baru ke yang lama", () => {
  test("pesan pertama dipakai apa adanya", () => {
    const first = [fake("a")];
    expect(mergeIncidentCards(null, first)).toBe(first);
    const empty: IncidentCard[] = [];
    expect(mergeIncidentCards(null, empty)).toBe(empty);
  });

  test("isi yang sama tidak mengubah apa pun, walau objeknya baru", () => {
    const previous = [fake("a"), fake("b", 3)];
    const merged = mergeIncidentCards(previous, previous.map(clone));
    expect(merged).toBe(previous);
    expect(mergeIncidentCards([], [])).toEqual([]);
    const empty: IncidentCard[] = [];
    expect(mergeIncidentCards(empty, [])).toBe(empty);
  });

  test("yang berubah diganti, yang tidak berubah tetap objek lama", () => {
    const previous = [fake("a"), fake("b", 3), fake("c")];
    const changed = [
      clone(previous[0]),
      { ...clone(previous[1]), alertCount: 4 },
      clone(previous[2]),
    ];
    const merged = mergeIncidentCards(previous, changed);
    expect(merged).not.toBe(previous);
    expect(merged[0]).toBe(previous[0]);
    expect(merged[1]).toBe(changed[1]);
    expect(merged[1]).not.toBe(previous[1]);
    expect(merged[2]).toBe(previous[2]);
  });

  test("kartu yang hilang dan yang baru muncul", () => {
    const previous = [fake("a"), fake("b"), fake("c")];
    const removed = mergeIncidentCards(previous, [
      clone(previous[0]),
      clone(previous[2]),
    ]);
    expect(removed.map((c) => c.id)).toEqual(["a", "c"]);
    expect(removed[0]).toBe(previous[0]);
    expect(removed[1]).toBe(previous[2]);

    const added = mergeIncidentCards(previous, [
      ...previous.map(clone),
      fake("d"),
    ]);
    expect(added.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(added.slice(0, 3).every((card, i) => card === previous[i])).toBe(
      true,
    );
  });

  test("urutan yang berubah menghasilkan daftar baru dengan objek lama dipakai ulang", () => {
    const previous = [fake("a"), fake("b")];
    const merged = mergeIncidentCards(previous, [
      clone(previous[1]),
      clone(previous[0]),
    ]);
    expect(merged).not.toBe(previous);
    expect(merged[0]).toBe(previous[1]);
    expect(merged[1]).toBe(previous[0]);
  });

  test("daftar menjadi kosong, lalu terisi lagi", () => {
    const previous = [fake("a")];
    const empty = mergeIncidentCards(previous, []);
    expect(empty).toEqual([]);
    expect(empty).not.toBe(previous);
    const refilled = mergeIncidentCards(empty, [fake("a")]);
    expect(refilled.map((c) => c.id)).toEqual(["a"]);
  });
});

test.describe("hub tiruan", () => {
  function scripted(...lists: IncidentCard[][]) {
    let step = 0;
    return {
      build: () => lists[Math.min(step, lists.length - 1)],
      advance: () => {
        step += 1;
      },
    };
  }

  test("snapshot selalu daftar lengkap, dan perubahan hanya dikirim bila isinya berbeda", () => {
    const a = fake("a");
    const b = fake("b", 3);
    const script = scripted([a], [a], [a, b], [a, b], [a], [a]);
    const hub = createMockIncidentHub(script.build);

    expect(hub.snapshot(0).map((c) => c.id)).toEqual(["a"]);
    script.advance(); // [a] sama dengan yang terkirim
    expect(hub.changes(1)).toBeNull();
    script.advance(); // [a, b] berubah
    expect(hub.changes(2)?.map((c) => c.id)).toEqual(["a", "b"]);
    script.advance(); // [a, b] sama lagi
    expect(hub.changes(3)).toBeNull();
    script.advance(); // kembali ke [a]: berbeda dari yang terakhir terkirim
    expect(hub.changes(4)?.map((c) => c.id)).toEqual(["a"]);
    script.advance();
    expect(hub.changes(5)).toBeNull();
  });

  test("daftar kosong adalah pesan yang sah, dan kosong berulang tidak dikirim ulang", () => {
    const script = scripted([fake("a")], [], [], [fake("a")]);
    const hub = createMockIncidentHub(script.build);
    hub.snapshot(0);
    script.advance();
    expect(hub.changes(1)).toEqual([]);
    script.advance();
    expect(hub.changes(2)).toBeNull();
    script.advance();
    expect(hub.changes(3)?.map((c) => c.id)).toEqual(["a"]);
  });

  test("snapshot setelah sinkron ulang mengirim lagi walau isinya sama", () => {
    const script = scripted([fake("a")]);
    const hub = createMockIncidentHub(script.build);
    hub.snapshot(0);
    expect(hub.changes(1)).toBeNull();
    expect(hub.snapshot(2).map((c) => c.id)).toEqual(["a"]);
    expect(hub.changes(3)).toBeNull();
  });

  test("tanpa snapshot lebih dulu, panggilan pertama mengirim daftar", () => {
    const hub = createMockIncidentHub(() => [fake("a")]);
    expect(hub.changes(0)?.map((c) => c.id)).toEqual(["a"]);
    expect(hub.changes(1)).toBeNull();
  });

  test("tanda tangan daftar membedakan isi, jumlah, dan urutan", () => {
    const [a, b] = [fake("a"), fake("b")];
    expect(listSignature([a, b])).not.toBe(listSignature([b, a]));
    expect(listSignature([a])).not.toBe(listSignature([a, b]));
    expect(listSignature([a])).toBe(listSignature([clone(a)]));
    expect(listSignature([])).toBe("");
  });
});

test.describe("simulasi selama enam jam pada data tiruan", () => {
  test("pesan yang diterapkan selalu menghasilkan daftar yang sama dengan hitung penuh, dan jarang dikirim", () => {
    const hub = createMockIncidentHub();
    let mirror: IncidentCard[] | null = null;
    let messages = 0;
    const problems: string[] = [];
    mirror = mergeIncidentCards(mirror, hub.snapshot(START));
    for (let second = 1; second <= 6 * 3600; second += 1) {
      const t = START + second;
      const sent = hub.changes(t);
      if (sent) {
        messages += 1;
        const merged = mergeIncidentCards(mirror, sent);
        // Kartu yang tidak berubah harus tetap objek lama.
        for (const card of merged) {
          const old = mirror?.find((c) => c.id === card.id);
          if (
            old &&
            listSignature([old]) === listSignature([card]) &&
            old !== card
          )
            problems.push(`${card.id}@${second}: objek tidak dipakai ulang`);
        }
        mirror = merged;
      }
      if (second % 7 === 0 || sent) {
        if (listSignature(mirror) !== listSignature(cardsAt(t)))
          problems.push(
            `detik ${second}: salinan tidak sama dengan hitung penuh`,
          );
      }
    }
    expect(problems).toEqual([]);
    expect(messages).toBeGreaterThan(5);
    // Hanya saat berubah: jauh lebih sedikit dari satu pesan per detik.
    expect(messages).toBeLessThan((6 * 3600) / 20);
  });

  test("pesan yang terlewat tidak merusak: pesan berikutnya selalu cukup sendirian", () => {
    const hub = createMockIncidentHub();
    const sentAt: { t: number; cards: IncidentCard[] }[] = [];
    hub.snapshot(START);
    for (let second = 1; second <= 3 * 3600; second += 1) {
      const cards = hub.changes(START + second);
      if (cards) sentAt.push({ t: START + second, cards });
    }
    expect(sentAt.length).toBeGreaterThan(3);
    // Klien yang hanya menerima pesan ke-3 dan seterusnya tetap benar.
    let mirror: IncidentCard[] | null = null;
    for (const { t, cards } of sentAt.slice(2)) {
      mirror = mergeIncidentCards(mirror, cards);
      expect(listSignature(mirror)).toBe(listSignature(cardsAt(t)));
    }
  });
});

test.describe("store", () => {
  test("applyIncidents menyimpan daftar dan waktunya, dan daftar yang sama tidak diganti", () => {
    const { applyIncidents } = useDashboardStore.getState();
    expect(useDashboardStore.getState().incidentCards).toBeNull();
    expect(useDashboardStore.getState().incidentsAt).toBeNull();

    const list = [fake("a"), fake("b", 2)];
    applyIncidents(list, 100);
    const first = useDashboardStore.getState().incidentCards;
    expect(first).toBe(list);
    expect(useDashboardStore.getState().incidentsAt).toBe(100);

    applyIncidents(list.map(clone), 105);
    expect(useDashboardStore.getState().incidentCards).toBe(first);
    expect(useDashboardStore.getState().incidentsAt).toBe(105);

    applyIncidents([], 110);
    expect(useDashboardStore.getState().incidentCards).toEqual([]);
  });

  test("menerapkan pesan tidak menyentuh data lain", () => {
    const before = useDashboardStore.getState();
    before.applyIncidents([fake("z")], 200);
    const after = useDashboardStore.getState();
    expect(after.customers).toBe(before.customers);
    expect(after.traffic).toBe(before.traffic);
    expect(after.routers).toBe(before.routers);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

test("hanya ada satu sambungan data, di layout aplikasi", () => {
  const uses = sourceFiles("src/app").filter((file) =>
    /<DashboardFeed\b/.test(readFileSync(file, "utf8")),
  );
  expect(uses.map((file) => file.replaceAll("\\", "/"))).toEqual([
    "src/app/(protected)/app/layout.tsx",
  ]);
});

async function signUp(page: Page) {
  const data = {
    name: "Petugas Hub",
    email: `hub-${randomUUID()}@example.com`,
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

// Dua momen berselang beberapa menit dengan daftar kartu berbeda, dan satu kartu
// gabungan yang ada di keduanya (untuk menguji "tetap terbuka").
function findPair() {
  for (let t = START; t < START + 30 * 86_400; t += 300) {
    const first = cardsAt(t);
    for (const step of [300, 600, 900]) {
      const second = cardsAt(t + step);
      const shared = first.find(
        (card) =>
          card.alertCount > 1 && second.some((other) => other.id === card.id),
      );
      if (shared && listSignature(first) !== listSignature(second)) {
        return { t1: t, t2: t + step, first, second, shared };
      }
    }
  }
  throw new Error("tidak ada pasangan momen yang cocok");
}

test("kartu tiba lewat pesan hub, tanpa menunggu penarikan berkala, dan kartu yang terbuka tetap terbuka", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { t1, t2, first, second, shared } = findPair();
  await signUp(page);
  await page.clock.install({ time: t1 * 1000 });
  await page.goto("/app/anomali");

  const cards = page.getByTestId("incident-card");
  const ids = () =>
    cards.evaluateAll((items) =>
      items.map((i) => i.getAttribute("data-card-id")),
    );
  await expect(cards).toHaveCount(first.length);
  expect(await ids()).toEqual(first.map((c) => c.id));

  // Buka satu kartu gabungan; lalu waktu pindah dan daftar berubah.
  const view = page.locator(`[data-card-id="${shared.id}"]`);
  await view.getByTestId("incident-toggle").click();
  await expect(view).toHaveAttribute("data-expanded", "true");
  await page.evaluate(() => {
    (window as unknown as { keptAlive: boolean }).keptAlive = true;
  });

  await page.clock.setFixedTime(t2 * 1000);
  // Satu detik saja: kartu datang lewat pesan hub tiap detik, bukan tiap 5 detik.
  await page.clock.runFor(1_100);
  await expect(cards).toHaveCount(second.length);
  expect(await ids()).toEqual(second.map((c) => c.id));
  await expect(view).toHaveAttribute("data-expanded", "true");
  await expect(view.getByTestId("incident-details")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { keptAlive?: boolean }).keptAlive,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("berpindah halaman tidak memutus sambungan: kartu sudah ada begitu halaman anomali dibuka", async ({
  page,
}) => {
  const { t1, first } = findPair();
  await signUp(page);
  await page.clock.install({ time: t1 * 1000 });
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Dashboard NOC" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Live" }),
  ).toBeVisible();

  const menu = page.getByRole("navigation", { name: "Menu utama" });
  await menu.getByRole("link", { name: "Deteksi Anomali" }).click();
  await expect(page).toHaveURL(/\/app\/anomali$/);
  // Tidak ada keadaan "Memuat insiden…": datanya sudah ada di store.
  const summary = page.getByTestId("incident-summary");
  await expect(summary).toHaveAttribute("data-cards", String(first.length));
  await expect(page.getByText("Memuat insiden…")).toHaveCount(0);

  // Kembali ke dashboard: datanya tetap mengalir (jam "Diperbarui" maju).
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Live" }),
  ).toBeVisible();
  const updated = page.getByText(/Diperbarui/);
  const before = await updated.textContent();
  await page.clock.runFor(3_000);
  await expect.poll(() => updated.textContent()).not.toBe(before);
});

test("daftar kosong dikirim sebagai pesan, dan insiden baru muncul kembali tanpa memuat ulang", async ({
  page,
}) => {
  let quiet = START;
  while (cardsAt(quiet).length !== 0) quiet += 300;
  const { t1, first } = findPair();
  await signUp(page);
  await page.clock.install({ time: quiet * 1000 });
  await page.goto("/app/anomali");
  await expect(page.getByTestId("incident-summary")).toHaveText(
    "Tidak ada insiden aktif",
  );
  await expect(page.getByTestId("incident-card")).toHaveCount(0);

  await page.clock.setFixedTime(t1 * 1000);
  await page.clock.runFor(1_100);
  await expect(page.getByTestId("incident-card")).toHaveCount(first.length);
  await page.clock.setFixedTime(quiet * 1000);
  await page.clock.runFor(1_100);
  await expect(page.getByTestId("incident-card")).toHaveCount(0);
  await expect(
    page.getByText("Tidak ada insiden aktif. Semua jaringan normal."),
  ).toBeVisible();
});
