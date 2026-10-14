import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AUDIT_MOCK_START,
  AUDIT_PAGE_SIZE,
  AUDIT_REFRESH_MS,
  mockAuditLog,
  pageAudit,
} from "../src/lib/dashboard/audit";
import {
  actorOptions,
  auditFacetCounts,
  describeFilter,
  emptyAuditFilter,
  filterAudit,
  isFilterActive,
  type AuditFilter,
} from "../src/lib/dashboard/audit-filter";
import { formatInteger } from "../src/lib/dashboard/format";
import { contextFor, signUp, type Cookies } from "./billing-ui";
import { contrastOf } from "./contrast";

// Pencarian dan saringan di halaman Jejak Aktivitas (/app/jejak-aktivitas):
// mengetik langsung menyaring, tiap pilihan menulis jumlah hasilnya, kombinasi,
// kembali ke halaman 1, tombol hapus, pesan tanpa hasil dan fokus, Escape,
// saringan bertahan saat data disegarkan, ringkasan tidak berubah, tata letak
// 390 dan 1440 px, kontras di dua tema, dan masukan aneh. Daftarnya adalah fungsi
// waktu, jadi jam browser dikunci pada detik yang dipilih dan isi layar
// dibandingkan dengan fungsi murni pada detik itu (komponen memakai AWAL MENIT
// sekarang untuk saringan Waktu, jadi dipakai minuteOf).

const DAY = 86_400;
const PAGE = AUDIT_PAGE_SIZE;
// Detik dengan detik "07" supaya selisih dengan awal menit ikut teruji.
const MOMENT = Date.UTC(2026, 2, 14, 9, 41, 7) / 1000;
const EN_DASH = "–";
const n = formatInteger;
const minuteOf = (seconds: number) => Math.floor(seconds / 60) * 60;
// Karakter yang tidak boleh disalin langsung ke sumber ditulis lewat kodenya.
const NBSP = String.fromCharCode(0xa0);
const SMILE = String.fromCodePoint(0x1f600);

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Saringan Jejak");
  await context.close();
});

// Label ditulis lagi di sini, tidak diambil dari tabel di audit.ts.
const ACTION_LABELS: [string, string][] = [
  ["login", "Masuk"],
  ["logout", "Keluar"],
  ["alert-handled", "Tandai ditangani"],
  ["threshold-changed", "Ambang diubah"],
  ["router-added", "Router ditambah"],
  ["router-updated", "Router diubah"],
  ["cpe-changed", "CPE pelanggan diubah"],
  ["billing-sync", "Sinkron billing"],
  ["settings-changed", "Pengaturan diubah"],
];
const ACTOR_NAMES: [string, string][] = [
  ["op-andi", "Andi Prasetyo"],
  ["op-bayu", "Bayu Kurniawan"],
  ["op-ratna", "Ratna Wulandari"],
  ["op-siti", "Siti Nurhaliza"],
  ["op-yoga", "Yoga Permadi"],
  ["system", "Sistem"],
];
const WITHIN_LABELS: [string, string][] = [
  ["1h", "1 jam terakhir"],
  ["24h", "24 jam terakhir"],
  ["7d", "7 hari terakhir"],
];

const board = (page: Page) => page.getByTestId("audit-board");
const card = (page: Page) => page.getByTestId("audit-log");
const rows = (page: Page) => page.getByTestId("audit-row");
const pageStatus = (page: Page) => page.getByTestId("audit-page-status");
const previous = (page: Page) => page.getByTestId("audit-previous");
const next = (page: Page) => page.getByTestId("audit-next");
const search = (page: Page) =>
  page.getByLabel("Cari aktivitas", { exact: true });
const actionSelect = (page: Page) => page.getByLabel("Aksi", { exact: true });
const actorSelect = (page: Page) => page.getByLabel("Petugas", { exact: true });
const withinSelect = (page: Page) => page.getByLabel("Waktu", { exact: true });
const clearButton = (page: Page) => page.getByTestId("audit-clear");
const clearReason = (page: Page) => page.getByTestId("audit-clear-reason");
const result = (page: Page) => page.getByTestId("audit-result");
const noMatch = (page: Page) => page.getByTestId("audit-no-match");
const showAll = (page: Page) =>
  page.getByRole("button", { name: "Tampilkan semua aktivitas" });

// Jam dikunci pada `seconds`: Date.now tidak maju, tetapi timer tetap berjalan.
async function openAuditAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/jejak-aktivitas");
  await expect(card(page)).toBeVisible();
}

// Yang seharusnya tampil pada detik `at` untuk saringan tertentu: data dari
// mockAuditLog(at) dan batas Waktu dari awal menit `at`.
function expectedFor(partial: Partial<AuditFilter>, at = MOMENT, number = 1) {
  const entries = mockAuditLog(at);
  const filter: AuditFilter = { ...emptyAuditFilter, ...partial };
  const visible = filterAudit(entries, filter, minuteOf(at));
  return {
    entries,
    filter,
    visible,
    shown: pageAudit(visible, number),
    counts: auditFacetCounts(entries, filter, minuteOf(at)),
  };
}

const rowIds = (page: Page) =>
  rows(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-entry-id")),
  );

function pagerText(shown: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}) {
  return `Halaman ${n(shown.page)} dari ${n(shown.pageCount)}, catatan ${n(shown.from)}${EN_DASH}${n(shown.to)} dari ${n(shown.total)}`;
}

function resultText(shown: number, total: number, filter: AuditFilter) {
  const base = `Menampilkan ${n(shown)} dari ${n(total)} catatan`;
  return isFilterActive(filter)
    ? `${base}. Saringan: ${describeFilter(filter)}.`
    : base;
}

async function applyFilter(page: Page, partial: Partial<AuditFilter>) {
  if (partial.query !== undefined) await search(page).fill(partial.query);
  if (partial.action !== undefined) {
    await actionSelect(page).selectOption(partial.action);
  }
  if (partial.actor !== undefined) {
    await actorSelect(page).selectOption(partial.actor);
  }
  if (partial.within !== undefined) {
    await withinSelect(page).selectOption(partial.within);
  }
}

// Menekan "Berikutnya" sampai halaman `target`.
async function goToPage(page: Page, target: number) {
  for (let current = 1; current < target; current += 1) {
    await next(page).click();
    await expect(pageStatus(page)).toContainText(`Halaman ${current + 1} dari`);
  }
}

const tiles = (page: Page) =>
  page.getByTestId("audit-tile").evaluateAll((items) =>
    items.map((item) => ({
      kind: item.getAttribute("data-kind"),
      value: item.getAttribute("data-value"),
      text: (item.textContent ?? "").replace(/\s+/g, " ").trim(),
    })),
  );

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

const optionTexts = (page: Page, id: string) =>
  page.locator(`#${id} option`).allTextContents();

// Angka dalam tanda kurung di akhir tulisan pilihan, "Router diubah (12)".
function countOf(text: string) {
  const match = /\(([\d.]+)\)$/.exec(text);
  if (!match) throw new Error(`tidak ada angka pada pilihan: ${text}`);
  return Number(match[1].replaceAll(".", ""));
}

test.describe("struktur dan label", () => {
  test("daerah pencarian bernama, tiap kontrol berlabel, pilihan tertulis lengkap dengan angkanya, dan urutan papan ketik", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const { entries, counts } = expectedFor({});

    await expect(
      page.getByRole("search", { name: "Cari dan saring jejak aktivitas" }),
    ).toBeVisible();
    // Satu h1 dan satu h2 saja (bilah saringan tidak menambah judul).
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);
    for (const control of [
      search(page),
      actionSelect(page),
      actorSelect(page),
      withinSelect(page),
    ]) {
      await expect(control).toBeVisible();
    }
    await expect(search(page)).toHaveAttribute("type", "search");
    await expect(search(page)).toHaveAttribute(
      "placeholder",
      "mis. router, Andi, kata sandi",
    );
    // Teks bantuan terhubung ke kolom cari.
    await expect(search(page)).toHaveAttribute(
      "aria-describedby",
      "audit-search-help",
    );
    await expect(page.locator("#audit-search-help")).toContainText(
      "Semua kata harus ada",
    );

    // Tulisan pilihan: label dan angka, dengan label ditulis lagi di tes ini.
    expect(await optionTexts(page, "audit-filter-action")).toEqual([
      `Semua aksi (${n(entries.length)})`,
      ...ACTION_LABELS.map(
        ([action, label]) =>
          `${label} (${n(entries.filter((e) => e.action === action).length)})`,
      ),
    ]);
    expect(await optionTexts(page, "audit-filter-actor")).toEqual([
      `Semua petugas (${n(entries.length)})`,
      ...ACTOR_NAMES.map(
        ([id, name]) =>
          `${name} (${n(entries.filter((e) => e.actor.id === id).length)})`,
      ),
    ]);
    expect(await optionTexts(page, "audit-filter-within")).toEqual([
      `Semua waktu (${n(counts.within.all)})`,
      ...WITHIN_LABELS.map(
        ([option, label]) =>
          `${label} (${n(counts.within[option as "1h" | "24h" | "7d"])})`,
      ),
    ]);
    // Petugas di pilihan sama dengan petugas di data.
    expect(
      (
        await actorSelect(page)
          .locator("option")
          .evaluateAll((items) =>
            items.map((item) => (item as HTMLOptionElement).value),
          )
      ).slice(1),
    ).toEqual(actorOptions(entries).map((actor) => actor.id));

    // Urutan papan ketik: kolom cari, tiga pilihan, lalu tombol hapus (tetap
    // terfokus walau sedang aria-disabled).
    await search(page).focus();
    const order: string[] = [];
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(
          () =>
            (document.activeElement as HTMLElement).id ||
            (document.activeElement as HTMLElement).textContent!.trim(),
        ),
      );
    }
    expect(order).toEqual([
      "audit-filter-action",
      "audit-filter-actor",
      "audit-filter-within",
      "Hapus saringan",
    ]);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("Enter di kolom cari tidak memuat ulang halaman maupun mengubah alamat", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    await page.evaluate(() => {
      (window as unknown as { kept: boolean }).kept = true;
    });
    await search(page).fill("router");
    await search(page).press("Enter");
    await expect(page).toHaveURL(/\/app\/jejak-aktivitas$/);
    expect(
      await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
    ).toBe(true);
    await expect(search(page)).toHaveValue("router");
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(expectedFor({ query: "router" }).visible.length),
    );
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("pencarian", () => {
  test("mengetik langsung menyaring tiap huruf, menulis 'Menampilkan N dari M', dan ringkasan tiga angka tidak berubah", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const all = mockAuditLog(MOMENT);
    expect(all.length).toBeGreaterThan(100);
    const tilesBefore = await tiles(page);
    expect(tilesBefore.map((tile) => tile.kind)).toEqual([
      "total",
      "last24h",
      "operators",
    ]);
    expect(tilesBefore[0].text).toContain("Catatan 30 hari");
    expect(tilesBefore[1].text).toContain("24 jam terakhir");
    expect(tilesBefore[2].text).toContain("Petugas aktif");

    await expect(card(page)).toHaveAttribute("data-total", String(all.length));
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(all.length),
    );
    await expect(result(page)).toHaveText(
      `Menampilkan ${n(all.length)} dari ${n(all.length)} catatan`,
    );
    await expect(result(page)).toHaveAttribute("role", "status");

    // Tanpa tombol kirim dan tanpa jeda: tiap ketukan langsung menyaring.
    await search(page).click();
    let typed = "";
    for (const letter of "kata sandi") {
      await page.keyboard.type(letter);
      typed += letter;
      await expect(card(page)).toHaveAttribute(
        "data-filtered",
        String(expectedFor({ query: typed }).visible.length),
      );
    }
    const expected = expectedFor({ query: "kata sandi" });
    expect(expected.visible.length).toBeGreaterThan(5);
    expect(expected.visible.length).toBeLessThan(all.length);
    await expect(result(page)).toHaveText(
      resultText(expected.visible.length, all.length, expected.filter),
    );
    await expect(result(page)).toContainText('Saringan: kata "kata sandi".');
    expect(await rowIds(page)).toEqual(
      expected.shown.items.map((entry) => entry.id),
    );
    await expect(pageStatus(page)).toHaveText(pagerText(expected.shown));
    // Setiap baris yang tampil memuat kedua katanya di teks yang terlihat.
    for (const text of await rows(page).allInnerTexts()) {
      expect(text.toLowerCase()).toContain("kata");
      expect(text.toLowerCase()).toContain("sandi");
    }
    // Ringkasan tetap angka seluruh jendela, dengan label yang sama.
    expect(await tiles(page)).toEqual(tilesBefore);
    await expect(clearButton(page)).toHaveAttribute("aria-disabled", "false");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("kata di nama petugas, label aksi, objek, dan rincian ditemukan; huruf besar, spasi ganda, dan spasi tak terputus tidak berpengaruh", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const queries = [
      "Siti",
      "router diubah",
      "KATA   SANDI router",
      `  sinkron${NBSP}billing  `,
      "ambang",
      "perangkat",
    ];
    for (const query of queries) {
      await search(page).fill(query);
      const expected = expectedFor({ query });
      expect(expected.visible.length, query).toBeGreaterThan(0);
      await expect(card(page)).toHaveAttribute(
        "data-filtered",
        String(expected.visible.length),
      );
      expect(await rowIds(page)).toEqual(
        expected.shown.items.map((entry) => entry.id),
      );
    }
    // Besar-kecil dan spasi tidak mengubah hasil.
    await search(page).fill("kata sandi");
    const base = await rowIds(page);
    for (const query of [
      "KATA SANDI",
      "  kata   sandi  ",
      `kata${NBSP}sandi`,
      "sandi kata",
    ]) {
      await search(page).fill(query);
      expect(await rowIds(page), JSON.stringify(query)).toEqual(base);
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  test("kueri yang hanya spasi tidak menyaring dan tidak mengaktifkan tombol hapus", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const before = await rowIds(page);
    const total = (await card(page).getAttribute("data-total")) ?? "";
    expect(Number(total)).toBeGreaterThan(100);
    for (const query of ["   ", `${NBSP} \t`]) {
      await search(page).fill(query);
      await expect(card(page)).toHaveAttribute("data-filtered", total);
      expect(await rowIds(page)).toEqual(before);
      await expect(clearButton(page)).toHaveAttribute("aria-disabled", "true");
      await expect(result(page)).not.toContainText("Saringan");
    }
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("pilihan", () => {
  test("memilih tiap pilihan menghasilkan persis sebanyak angkanya, di tiap keadaan saringan lain", async ({
    browser,
  }) => {
    // Seratusan pemilihan, tiap satu diperiksa terhadap layar.
    test.slow();
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const bases: Partial<AuditFilter>[] = [
      {},
      { query: "router" },
      { action: "login" },
      { within: "24h" },
      { actor: "op-andi", within: "7d" },
    ];
    const dimensions = [
      { key: "action", id: "audit-filter-action", select: actionSelect },
      { key: "actor", id: "audit-filter-actor", select: actorSelect },
      { key: "within", id: "audit-filter-within", select: withinSelect },
    ] as const;
    let selected = 0;
    for (const base of bases) {
      // Tombol hapus yang aria-disabled tidak bisa diklik (pointer-events:
      // none), jadi hanya diklik bila memang ada saringan dari putaran lalu.
      if ((await clearButton(page).getAttribute("aria-disabled")) === "false") {
        await clearButton(page).click();
      }
      await applyFilter(page, base);
      const baseline = { ...emptyAuditFilter, ...base };
      for (const dimension of dimensions) {
        const options = await page
          .locator(`#${dimension.id} option`)
          .evaluateAll((items) =>
            items.map((item) => ({
              value: (item as HTMLOptionElement).value,
              text: item.textContent ?? "",
            })),
          );
        for (const option of options) {
          const count = countOf(option.text);
          await dimension.select(page).selectOption(option.value);
          await expect(card(page)).toHaveAttribute(
            "data-filtered",
            String(count),
          );
          // Sama dengan fungsi murni untuk gabungan saringan itu.
          expect(
            expectedFor({
              ...baseline,
              [dimension.key]: option.value,
            } as Partial<AuditFilter>).visible.length,
          ).toBe(count);
          await expect(result(page)).toHaveText(
            new RegExp(
              `^Menampilkan ${count} dari ${n(expectedFor({}).entries.length)} catatan`,
            ),
          );
          await expect(rows(page)).toHaveCount(Math.min(count, PAGE));
          selected += 1;
        }
        // Kembalikan dimensi ini ke nilai dasarnya.
        await dimension
          .select(page)
          .selectOption(String(baseline[dimension.key]));
      }
    }
    expect(selected).toBeGreaterThan(100);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("angka di pilihan lain ikut menyesuaikan ketika saringan bertambah, dan dimensi sendiri tidak ikut menyaring", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const counts0 = expectedFor({}).counts;
    // Pilih aksi: pilihan aksi lain tetap punya angkanya sendiri.
    await actionSelect(page).selectOption("router-updated");
    const afterAction = expectedFor({ action: "router-updated" }).counts;
    expect(afterAction.action["login"]).toBe(counts0.action["login"]);
    expect(await optionTexts(page, "audit-filter-action")).toContain(
      `Masuk (${n(counts0.action["login"])})`,
    );
    // Petugas dan waktu memakai saringan aksi itu.
    const actorTexts = await optionTexts(page, "audit-filter-actor");
    for (const [id, name] of ACTOR_NAMES) {
      expect(actorTexts).toContain(`${name} (${n(afterAction.actor[id])})`);
    }
    expect(actorTexts[0]).toBe(`Semua petugas (${n(afterAction.actor.all)})`);
    // Tambah kata kunci: semua dimensi mengikuti.
    await search(page).fill("router");
    const both = expectedFor({ action: "router-updated", query: "router" });
    const waktu = await optionTexts(page, "audit-filter-within");
    expect(waktu).toEqual([
      `Semua waktu (${n(both.counts.within.all)})`,
      ...WITHIN_LABELS.map(
        ([option, label]) =>
          `${label} (${n(both.counts.within[option as "1h" | "24h" | "7d"])})`,
      ),
    ]);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("kombinasi kata, aksi, petugas, dan waktu: baris, kalimat saringan, dan halaman sama dengan fungsi murni", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    // Petugas dengan catatan terbanyak untuk perubahan router dalam 7 hari.
    const probe = expectedFor({ action: "router-updated", within: "7d" });
    const actorId = actorOptions(probe.entries)
      .map((actor) => actor.id)
      .sort((a, b) => probe.counts.actor[b] - probe.counts.actor[a])[0];
    const filter: Partial<AuditFilter> = {
      query: "router",
      action: "router-updated",
      actor: actorId,
      within: "7d",
    };
    await applyFilter(page, filter);
    const expected = expectedFor(filter);
    expect(expected.visible.length).toBeGreaterThan(0);
    expect(expected.visible.length).toBeLessThan(probe.visible.length + 1);
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(expected.visible.length),
    );
    expect(await rowIds(page)).toEqual(
      expected.shown.items.map((entry) => entry.id),
    );
    await expect(result(page)).toHaveText(
      resultText(
        expected.visible.length,
        expected.entries.length,
        expected.filter,
      ),
    );
    // Kalimat saringan memuat keempatnya, dengan nama petugas (bukan id).
    const name = ACTOR_NAMES.find(([id]) => id === actorId)![1];
    await expect(result(page)).toContainText(
      `Saringan: kata "router", aksi "Router diubah", petugas "${name}", 7 hari terakhir.`,
    );
    // Setiap baris yang tampil: aksi, petugas, dan kata kuncinya benar.
    for (const row of await rows(page).all()) {
      await expect(row).toHaveAttribute("data-action", "router-updated");
      await expect(row).toHaveAttribute("data-actor", actorId);
      expect((await row.innerText()).toLowerCase()).toContain("router");
    }
    await expect(pageStatus(page)).toHaveText(pagerText(expected.shown));
    // Hapus satu dimensi, hasilnya melebar sesuai.
    await withinSelect(page).selectOption("all");
    const wider = expectedFor({ ...filter, within: "all" });
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(wider.visible.length),
    );
    expect(wider.visible.length).toBeGreaterThanOrEqual(
      expected.visible.length,
    );
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("halaman", () => {
  test("setiap perubahan saringan, dari halaman 3, membawa kembali ke halaman 1", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const changes: {
      name: string;
      change: () => Promise<unknown>;
      filter: Partial<AuditFilter>;
    }[] = [
      {
        name: "mengetik",
        change: () => search(page).pressSequentially("a"),
        filter: { query: "a" },
      },
      {
        name: "memilih aksi",
        change: () => actionSelect(page).selectOption("login"),
        filter: { action: "login" },
      },
      {
        name: "memilih petugas",
        change: () => actorSelect(page).selectOption("op-andi"),
        filter: { actor: "op-andi" },
      },
      {
        name: "memilih waktu",
        change: () => withinSelect(page).selectOption("7d"),
        filter: { within: "7d" },
      },
    ];
    for (const { name, change, filter } of changes) {
      await goToPage(page, 3);
      await change();
      const expected = expectedFor(filter);
      await expect(pageStatus(page), name).toHaveText(
        pagerText(expected.shown),
      );
      expect(expected.shown.page).toBe(1);
      expect(await rowIds(page), name).toEqual(
        expected.shown.items.map((entry) => entry.id),
      );
      // Kembali ke keadaan dasar untuk percobaan berikutnya.
      await clearButton(page).click();
      await expect(clearButton(page)).toHaveAttribute("aria-disabled", "true");
    }

    // Tombol hapus: dari halaman 3 pada hasil tersaring yang panjang.
    await search(page).fill("a");
    const filtered = expectedFor({ query: "a" });
    expect(filtered.shown.pageCount).toBeGreaterThanOrEqual(3);
    await goToPage(page, 3);
    await clearButton(page).click();
    const base = expectedFor({});
    await expect(pageStatus(page)).toHaveText(pagerText(base.shown));

    // Escape menghapus teks: juga kembali ke halaman 1.
    await search(page).fill("a");
    await goToPage(page, 3);
    await search(page).focus();
    await search(page).press("Escape");
    await expect(pageStatus(page)).toHaveText(pagerText(base.shown));
    expect(errors).toEqual([]);
    await context.close();
  });

  test("halaman tunggal tidak punya halaman berikutnya, dan tombol halaman memakai aria-disabled", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const filter: Partial<AuditFilter> = { within: "1h" };
    // Cari menit dengan sedikitnya satu catatan dalam 1 jam terakhir.
    let at = MOMENT;
    while (expectedFor(filter, at).visible.length === 0) at += 3_600;
    await page.clock.setFixedTime(at * 1000);
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    await withinSelect(page).selectOption("1h");
    const expected = expectedFor(filter, at);
    expect(expected.shown.pageCount).toBe(1);
    await expect(pageStatus(page)).toHaveText(pagerText(expected.shown));
    await expect(next(page)).toHaveAttribute("aria-disabled", "true");
    await expect(previous(page)).toHaveAttribute("aria-disabled", "true");
    await expect(next(page)).not.toHaveAttribute("disabled", /.*/);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("tombol hapus saringan", () => {
  test("aria-disabled dengan alasan tertulis saat kosong, tetap bisa difokus, lalu berfungsi saat ada saringan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const all = mockAuditLog(MOMENT);
    const clear = clearButton(page);

    await expect(clear).toHaveText("Hapus saringan");
    await expect(clear).toHaveAttribute("aria-disabled", "true");
    await expect(clear).not.toHaveAttribute("disabled", /.*/);
    await expect(clearReason(page)).toHaveText("Tidak ada saringan");
    await expect(clear).toHaveAttribute(
      "aria-describedby",
      "audit-clear-reason",
    );
    // Tetap bisa difokus, dan menekannya tidak berbuat apa-apa.
    await clear.focus();
    await expect(clear).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(clear).toBeFocused();
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(all.length),
    );

    // Ada saringan: tombol aktif, alasannya hilang.
    await applyFilter(page, {
      query: "router",
      action: "router-updated",
      actor: "op-andi",
      within: "7d",
    });
    await expect(clear).toHaveAttribute("aria-disabled", "false");
    await expect(clearReason(page)).toHaveCount(0);
    await expect(clear).not.toHaveAttribute("aria-describedby", /.*/);

    // Papan ketik: Enter pada tombol yang terfokus menghapus semuanya, dan
    // fokus tetap di tombol.
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(search(page)).toHaveValue("");
    await expect(actionSelect(page)).toHaveValue("all");
    await expect(actorSelect(page)).toHaveValue("all");
    await expect(withinSelect(page)).toHaveValue("all");
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(all.length),
    );
    await expect(clear).toBeFocused();
    await expect(clear).toHaveAttribute("aria-disabled", "true");
    await expect(clearReason(page)).toHaveText("Tidak ada saringan");
    await expect(result(page)).toHaveText(
      `Menampilkan ${n(all.length)} dari ${n(all.length)} catatan`,
    );

    // Dengan tetikus juga.
    await actionSelect(page).selectOption("login");
    await clear.click();
    await expect(actionSelect(page)).toHaveValue("all");
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("tidak ada yang cocok", () => {
  test("pesan menyebut saringan aktif, tabel dan halaman hilang, ringkasan tetap, dan 'Tampilkan semua aktivitas' memindahkan fokus ke pencarian", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const all = mockAuditLog(MOMENT);
    const tilesBefore = await tiles(page);

    await search(page).fill("zzzz-tidak-ada");
    await expect(card(page)).toHaveAttribute("data-filtered", "0");
    const none = noMatch(page);
    await expect(none).toBeVisible();
    await expect(none).toContainText("Tidak ada aktivitas yang cocok");
    await expect(none).toContainText(
      'Saringan yang berlaku: kata "zzzz-tidak-ada".',
    );
    await expect(rows(page)).toHaveCount(0);
    await expect(pageStatus(page)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Daftar jejak aktivitas" }),
    ).toHaveCount(0);
    await expect(result(page)).toHaveText(
      `Menampilkan 0 dari ${n(all.length)} catatan. Saringan: kata "zzzz-tidak-ada".`,
    );
    // Bilah saringan tetap ada supaya bisa dikoreksi; ringkasan tidak berubah.
    await expect(search(page)).toBeVisible();
    expect(await tiles(page)).toEqual(tilesBefore);
    // Judul tetap satu h1 dan satu h2.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(1);

    // Tombolnya menghapus semua saringan dan memindahkan fokus ke pencarian.
    await showAll(page).click();
    await expect(search(page)).toHaveValue("");
    await expect(search(page)).toBeFocused();
    await expect(none).toHaveCount(0);
    await expect(rows(page)).toHaveCount(PAGE);
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(all.length),
    );

    // Tanpa hasil karena gabungan pilihan: pesan memuat semuanya, dan tombolnya
    // juga mengosongkan pilihan.
    await applyFilter(page, {
      query: "router",
      action: "login",
      actor: "op-siti",
      within: "1h",
    });
    await expect(none).toBeVisible();
    await expect(none).toContainText(
      'kata "router", aksi "Masuk", petugas "Siti Nurhaliza", 1 jam terakhir',
    );
    await showAll(page).focus();
    await page.keyboard.press("Enter");
    await expect(search(page)).toBeFocused();
    await expect(actionSelect(page)).toHaveValue("all");
    await expect(actorSelect(page)).toHaveValue("all");
    await expect(withinSelect(page)).toHaveValue("all");
    await expect(none).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("Escape", () => {
  test("menghapus tulisan di kolom cari dan fokus tetap di sana; di kolom kosong tidak berbuat apa-apa; pilihan lain tidak ikut terhapus", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const all = mockAuditLog(MOMENT);
    await actionSelect(page).selectOption("login");
    await search(page).click();
    await page.keyboard.type("masuk");
    const withBoth = expectedFor({ query: "masuk", action: "login" });
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(withBoth.visible.length),
    );

    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("");
    await expect(search(page)).toBeFocused();
    // Pilihan aksi tetap berlaku.
    await expect(actionSelect(page)).toHaveValue("login");
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(expectedFor({ action: "login" }).visible.length),
    );

    // Escape lagi di kolom kosong: tidak ada yang berubah, tanpa galat.
    await page.keyboard.press("Escape");
    await expect(search(page)).toHaveValue("");
    await expect(actionSelect(page)).toHaveValue("login");

    // Hanya spasi: tetap terhapus.
    await actionSelect(page).selectOption("all");
    await search(page).fill("   ");
    await search(page).press("Escape");
    await expect(search(page)).toHaveValue("");
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(all.length),
    );
    // Escape di pesan tanpa hasil juga membawa semuanya kembali bila di kolom cari.
    await search(page).fill("zzzz");
    await expect(noMatch(page)).toBeVisible();
    await search(page).press("Escape");
    await expect(noMatch(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(PAGE);
    expect(errors).toEqual([]);
    await context.close();
  });
});

// Awal menit yang punya catatan yang tepat keluar dari jendela 1 jam pada menit
// berikutnya: waktunya antara 60 dan 59 menit sebelum awal menit itu.
function findMinuteWithLeaving() {
  const base = minuteOf(MOMENT);
  for (let k = 0; k < 3_000; k += 1) {
    const minute = base + k * 60;
    const entries = mockAuditLog(minute);
    const leaving = entries.filter(
      (entry) => entry.at > minute - 3_600 && entry.at <= minute - 3_540,
    );
    if (leaving.length > 0) return { minute, entries, leaving };
  }
  throw new Error("tidak ada menit dengan catatan yang keluar dari jendela");
}

test.describe("data disegarkan dan waktu bergeser", () => {
  test("saringan, isian, fokus, dan nomor halaman bertahan ketika data disegarkan; isinya mengikuti data baru", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const filter: Partial<AuditFilter> = { query: "a", within: "7d" };
    await applyFilter(page, filter);
    const first = expectedFor(filter);
    expect(first.shown.pageCount).toBeGreaterThanOrEqual(2);
    await next(page).click();
    await expect(pageStatus(page)).toContainText("Halaman 2 dari");
    await actorSelect(page).focus();
    await expect(actorSelect(page)).toBeFocused();

    // Jam server maju dua hari: penyegaran berikutnya membawa data baru.
    const later = MOMENT + 2 * DAY + 4 * 3_600 + 13;
    await page.clock.setFixedTime(later * 1000);
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    const second = expectedFor(filter, later, 2);
    await expect(card(page)).toHaveAttribute(
      "data-total",
      String(second.entries.length),
    );
    // Saringan tetap terpilih, halaman 2 tetap halaman 2, fokus tidak lepas.
    await expect(search(page)).toHaveValue("a");
    await expect(withinSelect(page)).toHaveValue("7d");
    await expect(actorSelect(page)).toBeFocused();
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(second.visible.length),
    );
    await expect(pageStatus(page)).toHaveText(pagerText(second.shown));
    expect(await rowIds(page)).toEqual(
      second.shown.items.map((entry) => entry.id),
    );
    // Angka di pilihan ikut data baru.
    expect(await optionTexts(page, "audit-filter-action")).toEqual([
      `Semua aksi (${n(second.counts.action.all)})`,
      ...ACTION_LABELS.map(
        ([action, label]) =>
          `${label} (${n(second.counts.action[action as "login"])})`,
      ),
    ]);
    // Ringkasan mengikuti seluruh jendela baru, bukan hasil saringan.
    expect((await tiles(page))[0].value).toBe(String(second.entries.length));
    expect(errors).toEqual([]);
    await context.close();
  });

  test("catatan baru yang cocok masuk di atas tanpa memuat ulang, dan yang tidak cocok tidak mengubah tabel", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    // Sebuah catatan "login" yang baru ada 10 menit kemudian.
    const target = mockAuditLog(MOMENT + 3 * DAY).find(
      (entry) => entry.action === "login",
    )!;
    const start = target.at - 600;
    const end = target.at + 600;
    expect(mockAuditLog(start).some((e) => e.id === target.id)).toBe(false);
    expect(mockAuditLog(end).some((e) => e.id === target.id)).toBe(true);

    await openAuditAt(page, start);
    await actionSelect(page).selectOption("login");
    const before = expectedFor({ action: "login" }, start);
    expect(await rowIds(page)).toEqual(
      before.shown.items.map((entry) => entry.id),
    );
    await page.clock.setFixedTime(end * 1000);
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    const after = expectedFor({ action: "login" }, end);
    await expect(
      page.locator(`[data-testid=audit-row][data-entry-id="${target.id}"]`),
    ).toHaveCount(1);
    await expect
      .poll(() => rowIds(page))
      .toEqual(after.shown.items.map((entry) => entry.id));
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(after.visible.length),
    );

    // Dengan aksi lain terpilih, catatan login itu tidak tampil walau sudah ada.
    await actionSelect(page).selectOption("logout");
    const other = expectedFor({ action: "logout" }, end);
    expect(other.visible.map((e) => e.id)).not.toContain(target.id);
    expect(await rowIds(page)).toEqual(
      other.shown.items.map((entry) => entry.id),
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  test("hasil menyusut karena data lebih sedikit: nomor halaman dipaksa masuk rentang dan saringan tetap", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const filter: Partial<AuditFilter> = { query: "a" };
    await search(page).fill("a");
    const wide = expectedFor(filter);
    expect(wide.shown.pageCount).toBeGreaterThanOrEqual(8);
    await goToPage(page, 8);

    // Jam server mundur ke awal pencatatan: hanya 10 hari catatan yang ada.
    const early = AUDIT_MOCK_START + 10 * DAY + 3_600;
    await page.clock.setFixedTime(early * 1000);
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    const narrow = expectedFor(filter, early, 8);
    expect(narrow.shown.pageCount).toBeLessThan(8);
    expect(narrow.shown.page).toBe(narrow.shown.pageCount);
    await expect(card(page)).toHaveAttribute(
      "data-total",
      String(narrow.entries.length),
    );
    await expect(pageStatus(page)).toHaveText(pagerText(narrow.shown));
    expect(await rowIds(page)).toEqual(
      narrow.shown.items.map((entry) => entry.id),
    );
    await expect(next(page)).toHaveAttribute("aria-disabled", "true");
    await expect(search(page)).toHaveValue("a");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("batas Waktu ikut bergeser ketika menit berganti, tegas sampai satu menit", async ({
    browser,
  }) => {
    const { minute, entries, leaving } = findMinuteWithLeaving();
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, minute);
    await withinSelect(page).selectOption("1h");
    const first = expectedFor({ within: "1h" }, minute);
    expect(first.visible.map((e) => e.id)).toContain(leaving[0].id);
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(first.visible.length),
    );
    await expect(
      page.locator(`[data-testid=audit-row][data-entry-id="${leaving[0].id}"]`),
    ).toHaveCount(1);

    // Satu menit kemudian (data tetap, sebab penyegaran baru 30 detik): awal
    // menit baru, dan catatan tadi sudah di luar.
    await page.clock.setFixedTime((minute + 60) * 1000);
    await page.clock.runFor(10_000);
    const visible = filterAudit(
      entries,
      { ...emptyAuditFilter, within: "1h" },
      minute + 60,
    );
    expect(visible.map((e) => e.id)).not.toContain(leaving[0].id);
    await expect(card(page)).toHaveAttribute(
      "data-filtered",
      String(visible.length),
    );
    await expect(
      page.locator(`[data-testid=audit-row][data-entry-id="${leaving[0].id}"]`),
    ).toHaveCount(0);
    expect(await rowIds(page)).toEqual(
      pageAudit(visible, 1).items.map((entry) => entry.id),
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  test("pembaruan gagal: data terakhir, saringan, dan hasilnya tetap tampil", async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    await applyFilter(page, { query: "router", action: "router-updated" });
    const expected = expectedFor({ query: "router", action: "router-updated" });
    const before = await rowIds(page);
    expect(before).toEqual(expected.shown.items.map((entry) => entry.id));

    await context.setOffline(true);
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    await expect(page.getByTestId("audit-error")).toBeVisible();
    await expect(search(page)).toHaveValue("router");
    await expect(actionSelect(page)).toHaveValue("router-updated");
    expect(await rowIds(page)).toEqual(before);
    await expect(result(page)).toContainText(
      `Menampilkan ${n(expected.visible.length)} dari`,
    );
    await context.setOffline(false);
    await context.close();
  });
});

test.describe("masukan aneh", () => {
  const weird = [
    "<script>window.__xss=1</script>",
    '<img src=x onerror="window.__xss=2">',
    "\\",
    "%",
    "%s %d {0} ${x}",
    "'; DROP TABLE audit_log; --",
    "\"quoted\" 'single'",
    `${SMILE}${SMILE}`,
    "(((",
    ".*",
    "x".repeat(5_000),
  ];

  test("tidak ada yang dieksekusi, halaman tidak rusak, dan pesannya tetap rapi", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: { width: 390, height: 844 },
    });
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openAuditAt(page, MOMENT);
    const all = mockAuditLog(MOMENT);
    for (const query of weird) {
      await search(page).fill(query);
      // Tidak ada yang cocok, kecuali bila datanya memang memuat kata itu.
      const expected = expectedFor({ query });
      await expect(card(page)).toHaveAttribute(
        "data-filtered",
        String(expected.visible.length),
      );
      await expect(result(page)).toBeVisible();
      await expect(result(page)).toContainText(
        `Menampilkan ${n(expected.visible.length)} dari ${n(all.length)} catatan`,
      );
      // Kalimat saringan memotong kata kunci yang panjang, tetapi isian utuh.
      const sentence = (await result(page).textContent()) ?? "";
      expect(sentence.length).toBeLessThan(400);
      await expect(search(page)).toHaveValue(query);
      // Tidak ada skrip, gambar, atau elemen tambahan dari teks yang diketik.
      expect(await board(page).locator("img, script").count()).toBe(0);
      expect(
        await page.evaluate(
          () => (window as unknown as { __xss?: number }).__xss,
        ),
      ).toBeUndefined();
      expect(await overflows(page), query.slice(0, 20)).toBe(false);
    }
    // Kata kunci panjang ditulis dengan tanda ellipsis di kalimat.
    expect(await result(page).textContent()).toContain("…");
    // Teks HTML ditampilkan sebagai teks biasa di pesan tanpa hasil.
    await search(page).fill("<b>tebal</b>");
    await expect(noMatch(page)).toContainText("<b>tebal</b>");
    expect(await noMatch(page).locator("b").count()).toBe(0);

    // Sesudah semuanya, halaman masih bekerja.
    await clearButton(page).click();
    await expect(search(page)).toHaveValue("");
    await expect(rows(page)).toHaveCount(PAGE);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("tata letak", () => {
  for (const width of [390, 768, 1440]) {
    test(`di ${width} px bilah saringan tertata, semua kontrol terjangkau, dan halaman tidak menggulir ke samping`, async ({
      browser,
    }) => {
      const { context, page, errors } = await contextFor(browser, cookies, {
        viewport: { width, height: 900 },
      });
      await openAuditAt(page, MOMENT);
      await expect(rows(page)).toHaveCount(PAGE);
      expect(await overflows(page)).toBe(false);

      const controls = {
        search: search(page),
        action: actionSelect(page),
        actor: actorSelect(page),
        within: withinSelect(page),
        clear: clearButton(page),
      };
      const boxes: Record<
        string,
        { x: number; y: number; w: number; h: number }
      > = {};
      for (const [name, locator] of Object.entries(controls)) {
        await locator.scrollIntoViewIfNeeded();
        await expect(locator, name).toBeInViewport({ ratio: 1 });
        const box = await locator.boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.x, name).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(width);
        // Cukup besar untuk disentuh.
        expect(box!.height, name).toBeGreaterThanOrEqual(30);
        boxes[name] = {
          x: box!.x,
          y: box!.y,
          w: box!.width,
          h: box!.height,
        };
      }
      if (width === 390) {
        // Satu kolom: menumpuk dari atas ke bawah dengan kiri yang sama.
        const order = ["search", "action", "actor", "within", "clear"];
        for (let i = 1; i < order.length; i += 1) {
          expect(boxes[order[i]].y, order[i]).toBeGreaterThan(
            boxes[order[i - 1]].y,
          );
        }
        for (const name of ["search", "action", "actor", "within"]) {
          expect(Math.round(boxes[name].x), name).toBe(
            Math.round(boxes.search.x),
          );
        }
      }
      if (width === 768) {
        // Dua kolom: pilihan aksi dan petugas sebaris.
        expect(Math.abs(boxes.action.y - boxes.actor.y)).toBeLessThan(3);
        expect(boxes.within.y).toBeGreaterThan(boxes.action.y);
      }
      if (width === 1440) {
        // Tiga pilihan dan tombolnya sebaris di bawah kolom cari.
        for (const name of ["actor", "within", "clear"]) {
          expect(
            Math.abs(
              boxes[name].y + boxes[name].h - (boxes.action.y + boxes.action.h),
            ),
            name,
          ).toBeLessThan(3);
        }
        expect(boxes.action.y).toBeGreaterThan(boxes.search.y);
      }

      // Pesan tanpa hasil dengan kata kunci panjang tetap muat.
      await search(page).fill("kata-yang-sangat-panjang-".repeat(20));
      const message = noMatch(page);
      await expect(message).toBeVisible();
      const box = await message.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await overflows(page)).toBe(false);
      // Hasil tersaring juga muat.
      await search(page).fill("router");
      await expect(rows(page).first()).toBeVisible();
      expect(await overflows(page)).toBe(false);
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("tidak ada animasi pada bilah saringan, hasil, dan pesan kosong, baik gerak dikurangi maupun tidak", async ({
    browser,
  }) => {
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      const { context, page, errors } = await contextFor(browser, cookies, {
        reducedMotion,
      });
      await openAuditAt(page, MOMENT);
      await search(page).fill("zzzz");
      await expect(noMatch(page)).toBeVisible();
      const animated = await page.evaluate(() => {
        const roots = [
          "[data-testid=audit-filter-bar]",
          "[data-testid=audit-result]",
          "[data-testid=audit-no-match]",
        ];
        const names: string[] = [];
        for (const selector of roots) {
          const root = document.querySelector(selector)!;
          for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
            const name = getComputedStyle(el).animationName;
            if (name !== "none")
              names.push(`${selector} ${el.tagName}: ${name}`);
          }
        }
        return names;
      });
      expect(animated, reducedMotion).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    }
  });
});

// Kontras teks (>= 4,5 : 1) di tiap tema dan tiap keadaan bilah.
for (const scheme of ["light", "dark"] as const) {
  test(`tulisan bilah saringan, hasil, dan pesan kosong terbaca jelas di tema ${scheme}`, async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      colorScheme: scheme,
    });
    await openAuditAt(page, MOMENT);
    const problems: string[] = [];
    let measured = 0;
    const measure = async (name: string, locator: Locator) => {
      const count = await locator.count();
      expect(count, `${scheme} ${name}: tidak ada elemen`).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const { text, ratio } = await contrastOf(locator.nth(index));
        measured += 1;
        if (ratio < 4.5) {
          problems.push(`${scheme} ${name} "${text}": ${ratio.toFixed(2)}`);
        }
      }
    };
    const bar = page.getByTestId("audit-filter-bar");
    const common = async (state: string) => {
      await measure(`${state} label`, bar.locator("label"));
      await measure(`${state} bantuan`, page.locator("#audit-search-help"));
      await measure(`${state} kolom cari`, search(page));
      await measure(`${state} pilihan`, bar.locator("select"));
      await measure(`${state} hasil`, result(page));
    };

    // Kosong: alasan tombol hapus, dan placeholder.
    await common("kosong");
    await measure("kosong alasan", clearReason(page));
    const placeholder = await search(page).evaluate((el) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const paint = (layers: string[]) => {
        ctx.clearRect(0, 0, 1, 1);
        for (const color of layers) {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
        }
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b];
      };
      const luminance = ([r, g, b]: number[]) => {
        const channel = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const layers: string[] = ["#ffffff"];
      for (let node: Element | null = el; node; node = node.parentElement) {
        layers.splice(1, 0, getComputedStyle(node).backgroundColor);
      }
      const background = paint(layers);
      const ink = paint([
        ...layers,
        getComputedStyle(el, "::placeholder").color,
      ]);
      const [hi, lo] = [luminance(ink), luminance(background)].sort(
        (a, b) => b - a,
      );
      return (hi + 0.05) / (lo + 0.05);
    });
    measured += 1;
    if (placeholder < 4.5) {
      problems.push(`${scheme} placeholder: ${placeholder.toFixed(2)}`);
    }

    // Ada saringan: tombol hapus aktif.
    await applyFilter(page, { query: "router", action: "router-updated" });
    await common("aktif");
    await measure("aktif tombol hapus", clearButton(page));

    // Tanpa hasil: pesan, kalimat saringan, dan tombolnya.
    await search(page).fill("zzzz-tidak-ada");
    await common("tanpa hasil");
    await measure("tanpa hasil pesan", noMatch(page).locator("p"));
    await measure("tanpa hasil tombol", showAll(page));

    expect(problems).toEqual([]);
    expect(measured).toBeGreaterThan(25);
    expect(errors).toEqual([]);
    await context.close();
  });
}
