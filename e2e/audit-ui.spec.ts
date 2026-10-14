import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  AUDIT_MOCK_START,
  AUDIT_PAGE_SIZE,
  AUDIT_REFRESH_MS,
  mockAuditLog,
  type AuditEntry,
} from "../src/lib/dashboard/audit";
import {
  contextFor,
  firstDifference,
  isoTime,
  jakartaTime,
  measureContrast,
  signUp,
  timeFormatter,
  type Cookies,
} from "./billing-ui";

// Halaman Jejak Aktivitas (/app/jejak-aktivitas) dengan data tiruan: menu,
// isi tabel sampai ke detik, pembagian halaman, ringkasan, tanpa rahasia di
// layar, keadaan memuat, kosong, dan galat, tata letak 390 dan 1440 px, kontras
// di dua tema, dan tanpa galat di konsol. Daftarnya adalah fungsi waktu, jadi
// jam browser dikunci pada detik yang dipilih dan isi layar dibandingkan
// persis dengan mockAuditLog pada detik itu.

const DAY = 86_400;
// Detik dengan detik "07" supaya waktu ke detik ikut diuji, di hari biasa.
const MOMENT = Date.UTC(2026, 2, 14, 9, 41, 7) / 1000;
const EN_DASH = "–";

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Jejak");
  await context.close();
});

// Label dan kelompok yang ditulis lagi di sini, tidak diambil dari tabel di
// audit.ts, supaya perubahan yang tidak disengaja pada tabel itu ketahuan.
const ACTIONS: Record<string, { label: string; group: string }> = {
  login: { label: "Masuk", group: "akses" },
  logout: { label: "Keluar", group: "akses" },
  "alert-handled": { label: "Tandai ditangani", group: "alert" },
  "threshold-changed": { label: "Ambang diubah", group: "alert" },
  "router-added": { label: "Router ditambah", group: "perangkat" },
  "router-updated": { label: "Router diubah", group: "perangkat" },
  "cpe-changed": { label: "CPE pelanggan diubah", group: "perangkat" },
  "billing-sync": { label: "Sinkron billing", group: "pengaturan" },
  "settings-changed": { label: "Pengaturan diubah", group: "pengaturan" },
};

// Pola rahasia yang ditulis di sini sendiri (lihat audit.spec.ts).
const forbidden: { name: string; pattern: RegExp }[] = [
  { name: "password", pattern: /pass(word|wd|phrase)/i },
  { name: "kata sandi dengan nilai", pattern: /kata\s*sandi\s*[:=]/i },
  {
    name: "kunci dengan nilai",
    pattern: /(token|secret|api[-_ ]?key|kunci|psk)\s*[:=]/i,
  },
  { name: "bearer", pattern: /bearer\s+\S{6,}/i },
  { name: "token Telegram", pattern: /\d{6,}:[A-Za-z0-9_-]{25,}/ },
  { name: "awalan kunci", pattern: /(ngpk_|sk-[A-Za-z0-9]|ghp_|AKIA[A-Z0-9])/ },
  { name: "kredensial di alamat", pattern: /:\/\/[^/\s]*:[^/\s]*@/ },
  { name: "teks acak panjang", pattern: /[A-Za-z0-9+/=_-]{28,}/ },
];

const board = (page: Page) => page.getByTestId("audit-board");
const log = (page: Page) => page.getByTestId("audit-log");
const rows = (page: Page) => page.getByTestId("audit-row");
const status = (page: Page) => page.getByTestId("audit-page-status");
const previous = (page: Page) => page.getByTestId("audit-previous");
const next = (page: Page) => page.getByTestId("audit-next");

// Jam dikunci pada `seconds`: Date.now tidak maju, tetapi timer tetap berjalan.
async function openAuditAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/jejak-aktivitas");
  await expect(log(page)).toBeVisible();
}

// Merekam keadaan layar sejak dokumen dibuat (sebelum skrip halaman jalan):
// urutan nilai data-view papan, dan rupa kerangka pada saat pertama terlihat.
// Jeda tiruan hanya 200 ms, jadi keadaan memuat tidak bisa ditahan dengan jam
// yang berhenti sebelum halaman dibuka (jam seperti itu menahan pengungkapan
// Suspense dan halaman tak pernah tampil); perekam ini melihatnya apa adanya.
async function recordViews(page: Page) {
  await page.addInitScript(() => {
    interface Seen {
      label: string | null;
      height: number;
      animations: string[];
    }
    const state = window as unknown as {
      __views: string[];
      __loading: Seen | null;
    };
    state.__views = [];
    state.__loading = null;
    const scan = () => {
      const view = document
        .querySelector("[data-testid=audit-board]")
        ?.getAttribute("data-view");
      if (view && state.__views[state.__views.length - 1] !== view) {
        state.__views.push(view);
      }
      const loading = document.querySelector("[data-testid=audit-loading]");
      // Pertama kali terlihat: HTML server datang di wadah tersembunyi
      // (tinggi 0) sebelum dipindahkan ke tempatnya, jadi diukur ulang sampai
      // punya tinggi.
      if (loading && (!state.__loading || state.__loading.height === 0)) {
        state.__loading = {
          label: loading.getAttribute("aria-label"),
          height: loading.getBoundingClientRect().height,
          animations: Array.from(
            loading.querySelectorAll("[aria-hidden=true]"),
          ).map((item) => getComputedStyle(item).animationName),
        };
      }
    };
    new MutationObserver(scan).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-view"],
    });
  });
}

const recorded = (page: Page) =>
  page.evaluate(() => {
    const state = window as unknown as {
      __views: string[];
      __loading: {
        label: string | null;
        height: number;
        animations: string[];
      } | null;
    };
    return { views: state.__views, loading: state.__loading };
  });

// Membuat navigator.onLine bernilai false sejak awal (dan bisa dipulihkan lewat
// setOnline): itulah yang dibaca loadAudit untuk menggagalkan permintaan tiruan.
// Jaringan sungguhan tidak diputus, jadi halamannya sendiri tetap bisa dibuka.
async function startOffline(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __offline: boolean };
    state.__offline = true;
    Object.defineProperty(Navigator.prototype, "onLine", {
      get: () => !state.__offline,
      configurable: true,
    });
  });
}

const setOnline = (page: Page, online: boolean) =>
  page.evaluate((value) => {
    (window as unknown as { __offline: boolean }).__offline = !value;
  }, online);

interface RowView {
  id: string | null;
  action: string | null;
  actor: string | null;
  time: string | null;
  iso: string | null;
  actorName: string | null;
  badge: string | null;
  group: string | null;
  target: string | null;
  summary: string | null;
  changes: (string | null)[];
  redacted: (string | null)[];
}

// Isi tabel seperti terbaca di layar, satu objek per baris.
function readRows(page: Page): Promise<RowView[]> {
  return rows(page).evaluateAll((items) =>
    items.map((row) => {
      const cells = row.querySelectorAll("td");
      const changes = Array.from(
        cells[4].querySelectorAll("[data-testid=audit-change]"),
      );
      return {
        id: row.getAttribute("data-entry-id"),
        action: row.getAttribute("data-action"),
        actor: row.getAttribute("data-actor"),
        time: cells[0].querySelector("time")?.textContent ?? null,
        iso: cells[0].querySelector("time")?.getAttribute("datetime") ?? null,
        actorName:
          cells[1].querySelector("[data-testid=audit-actor-name]")
            ?.textContent ?? null,
        badge:
          cells[2].querySelector("[data-testid=audit-action]")?.textContent ??
          null,
        group:
          cells[2]
            .querySelector("[data-testid=audit-action]")
            ?.getAttribute("data-group") ?? null,
        target: cells[3].textContent,
        summary:
          cells[4].querySelector("[data-testid=audit-summary]")?.textContent ??
          null,
        changes: changes.map((item) => item.textContent),
        redacted: changes.map((item) => item.getAttribute("data-redacted")),
      };
    }),
  );
}

// Baris yang seharusnya tampil untuk satu catatan.
function expectedRow(
  entry: AuditEntry,
  now: number,
  format: (seconds: number, now: number) => string,
): RowView {
  return {
    id: entry.id,
    action: entry.action,
    actor: entry.actor.id,
    time: format(entry.at, now),
    iso: isoTime(entry.at),
    actorName: entry.actor.name,
    badge: ACTIONS[entry.action].label,
    group: ACTIONS[entry.action].group,
    target: entry.target,
    summary: entry.summary,
    changes: entry.changes.map((change) =>
      change.redacted
        ? `${change.field}: nilai disembunyikan`
        : `${change.field}: dari ${change.from} ke ${change.to}`,
    ),
    redacted: entry.changes.map((change) => String(change.redacted === true)),
  };
}

function statusText(
  page: number,
  pages: number,
  from: number,
  to: number,
  total: number,
) {
  return `Halaman ${page} dari ${pages}, catatan ${from}${EN_DASH}${to} dari ${total}`;
}

// Semua teks yang terlihat dan semua nilai atribut (kecuali class dan style) di
// bawah `root`: tempat rahasia bisa bersembunyi.
function everyString(root: Locator): Promise<string[]> {
  return root.evaluate((element) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text) out.push(text);
    }
    for (const item of [
      element,
      ...Array.from(element.querySelectorAll("*")),
    ]) {
      for (const attribute of Array.from(item.attributes)) {
        if (attribute.name !== "class" && attribute.name !== "style") {
          out.push(attribute.value);
        }
      }
    }
    return out;
  });
}

// Semua galat konsol; galat muat sumber saat sengaja offline tidak dihitung.
const withoutOfflineNoise = (errors: string[]) =>
  errors.filter(
    (error) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(error),
  );

const overflows = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );

test("halaman jejak aktivitas butuh login", async ({ page }) => {
  await page.goto("/app/jejak-aktivitas");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fjejak-aktivitas$/);
  await expect(board(page)).toHaveCount(0);
});

test.describe("menu", () => {
  test("sidebar: Jejak Aktivitas tepat sesudah Pengaturan, membuka halaman yang benar dan menandai halaman aktif", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: { width: 1440, height: 900 },
    });
    await page.clock.install({ time: MOMENT * 1000 });
    await page.clock.setFixedTime(MOMENT * 1000);
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: "Dashboard NOC" }),
    ).toBeVisible();

    const menu = page.getByRole("navigation", { name: "Menu utama" });
    const labels = await menu
      .locator("li")
      .evaluateAll((items) => items.map((item) => item.textContent ?? ""));
    const at = (name: string) =>
      labels.findIndex((label) => label.startsWith(name));
    expect(at("Jejak Aktivitas")).toBe(at("Pengaturan") + 1);
    expect(at("Jejak Aktivitas")).toBe(labels.length - 1);
    // Menu yang lain tidak berubah nama maupun urutannya.
    const expected = [
      "Dashboard",
      "Alert",
      "Deteksi Anomali",
      "Pelanggan",
      "Billing",
      "OLT & Optik",
      "Router",
      "Pengaturan",
      "Jejak Aktivitas",
    ];
    expect(labels).toHaveLength(expected.length);
    expected.forEach((name, index) =>
      expect(labels[index]).toMatch(new RegExp(`^${name.replace("&", "\\&")}`)),
    );
    await expect(
      menu.getByRole("link", { name: "Alert", exact: true }),
    ).toBeVisible();
    await expect(menu.locator("[aria-current=page]")).toHaveAccessibleName(
      "Dashboard",
    );

    const link = menu.getByRole("link", { name: "Jejak Aktivitas" });
    await expect(link).toHaveAttribute("href", "/app/jejak-aktivitas");
    await link.click();
    await expect(page).toHaveURL("/app/jejak-aktivitas");
    await expect(
      page.getByRole("heading", { name: "Jejak Aktivitas", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Jejak Aktivitas/);
    // Satu-satunya yang ditandai halaman aktif.
    await expect(menu.locator("[aria-current=page]")).toHaveCount(1);
    await expect(menu.locator("[aria-current=page]")).toHaveAccessibleName(
      "Jejak Aktivitas",
    );
    await expect(
      page.getByText("Catatan siapa mengubah apa dan kapan"),
    ).toBeVisible();
    await expect(
      page.getByText("Data tiruan, belum terhubung ke log audit di backend"),
    ).toBeVisible();
    await expect(log(page)).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("bilah layar sempit juga punya Jejak Aktivitas dan menandainya saat dibuka", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: { width: 390, height: 844 },
    });
    await page.clock.install({ time: MOMENT * 1000 });
    await page.clock.setFixedTime(MOMENT * 1000);
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: "Dashboard NOC" }),
    ).toBeVisible();
    const bar = page.getByRole("navigation", { name: "Menu halaman" });
    const link = bar.getByRole("link", { name: "Jejak Aktivitas" });
    await expect(link).toHaveCount(1);
    await expect(link).not.toHaveAttribute("aria-current", /.*/);
    // Menu "Pengaturan" tepat di sebelahnya.
    const labels = await bar
      .locator("li")
      .evaluateAll((items) => items.map((item) => item.textContent ?? ""));
    expect(labels.findIndex((l) => l.startsWith("Jejak Aktivitas"))).toBe(
      labels.findIndex((l) => l.startsWith("Pengaturan")) + 1,
    );
    await link.click();
    await expect(page).toHaveURL("/app/jejak-aktivitas");
    await expect(bar.locator("[aria-current=page]")).toHaveAccessibleName(
      "Jejak Aktivitas",
    );
    await expect(log(page)).toBeVisible();
    expect(await overflows(page)).toBe(false);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("isi", () => {
  test("halaman pertama sama persis dengan mockAuditLog pada detik yang dikunci, dan semua halaman menyambung", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const entries = mockAuditLog(MOMENT);
    const pages = Math.ceil(entries.length / AUDIT_PAGE_SIZE);
    expect(pages).toBeGreaterThan(5);

    // Struktur: satu h1 dan satu h2, tabel bersemantik dengan keterangan.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Jejak Aktivitas",
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "Riwayat aktivitas",
    );
    const table = log(page).getByRole("table");
    await expect(table.locator("caption")).toHaveCount(1);
    expect(
      await table
        .locator("thead th")
        .evaluateAll((cells) =>
          cells.map((cell) => [cell.textContent, cell.getAttribute("scope")]),
        ),
    ).toEqual([
      ["Waktu", "col"],
      ["Petugas", "col"],
      ["Aksi", "col"],
      ["Objek", "col"],
      ["Rincian", "col"],
    ]);

    const format = jakartaTime;
    for (let current = 1; current <= pages; current += 1) {
      const slice = entries.slice(
        (current - 1) * AUDIT_PAGE_SIZE,
        current * AUDIT_PAGE_SIZE,
      );
      await expect(rows(page)).toHaveCount(slice.length);
      const actual = await readRows(page);
      expect(
        firstDifference(
          actual,
          slice.map((entry) => expectedRow(entry, MOMENT, format)),
        ),
        `halaman ${current}`,
      ).toBeNull();
      await expect(status(page)).toHaveText(
        statusText(
          current,
          pages,
          (current - 1) * AUDIT_PAGE_SIZE + 1,
          (current - 1) * AUDIT_PAGE_SIZE + slice.length,
          entries.length,
        ),
      );
      if (current < pages) {
        await next(page).click();
        await expect(status(page)).toContainText(`Halaman ${current + 1} dari`);
      }
    }
    // Terbaru dulu: waktu pada tiap halaman tidak naik.
    expect(entries.every((e, i) => i === 0 || e.at <= entries[i - 1].at)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  for (const timezoneId of ["Asia/Jakarta", "America/New_York"]) {
    test(`waktu ditulis sampai detik di zona ${timezoneId}, sama dengan Intl`, async ({
      browser,
    }) => {
      const { context, page, errors } = await contextFor(browser, cookies, {
        timezoneId,
      });
      await openAuditAt(page, MOMENT);
      const entries = mockAuditLog(MOMENT).slice(0, AUDIT_PAGE_SIZE);
      const format = timeFormatter(timezoneId);
      const texts = await page.getByTestId("audit-time").allTextContents();
      expect(texts).toEqual(entries.map((entry) => format(entry.at, MOMENT)));
      // Detik terbaca dan jam 00 tidak ditulis 24.
      for (const text of texts) {
        expect(text).toMatch(/(\d{2}\.){2}\d{2}$/);
        expect(text).not.toMatch(/(^|, )24\./);
      }
      const isos = await page
        .getByTestId("audit-time")
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute("datetime")),
        );
      expect(isos).toEqual(entries.map((entry) => isoTime(entry.at)));
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("ringkasan angka sama dengan hitungan dari data", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const entries = mockAuditLog(MOMENT);
    const last24h = entries.filter((entry) => MOMENT - entry.at < DAY).length;
    const people = new Set(
      entries
        .filter((entry) => entry.actor.id !== "system")
        .map((entry) => entry.actor.id),
    );
    const tile = (kind: string) =>
      page.locator(`[data-testid=audit-tile][data-kind=${kind}]`);
    await expect(page.getByTestId("audit-tile")).toHaveCount(3);
    await expect(tile("total")).toHaveAttribute(
      "data-value",
      String(entries.length),
    );
    await expect(tile("last24h")).toHaveAttribute(
      "data-value",
      String(last24h),
    );
    await expect(tile("operators")).toHaveAttribute(
      "data-value",
      String(people.size),
    );
    // Angkanya juga tertulis di kartu, bersama labelnya.
    await expect(tile("total")).toContainText("Catatan 30 hari");
    await expect(tile("total")).toContainText(String(entries.length));
    await expect(tile("last24h")).toContainText("24 jam terakhir");
    await expect(tile("last24h")).toContainText(String(last24h));
    await expect(tile("operators")).toContainText("Petugas aktif");
    await expect(tile("operators")).toContainText(String(people.size));
    // Bukan angka karangan: ada petugas, ada catatan hari ini, dan total tak sama dengan sehari.
    expect(people.size).toBeGreaterThanOrEqual(4);
    expect(entries.length).toBeGreaterThan(100);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("tidak ada nilai rahasia di layar pada semua halaman, dan bidang rahasia hanya bertuliskan nilai disembunyikan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const entries = mockAuditLog(MOMENT);
    const pages = Math.ceil(entries.length / AUDIT_PAGE_SIZE);
    const found: string[] = [];
    let hidden = 0;
    for (let current = 1; current <= pages; current += 1) {
      for (const text of await everyString(board(page))) {
        for (const { name, pattern } of forbidden) {
          if (pattern.test(text)) found.push(`halaman ${current}: ${name}`);
        }
      }
      const redacted = page.locator(
        "[data-testid=audit-change][data-redacted=true]",
      );
      hidden += await redacted.count();
      for (const text of await redacted.allTextContents()) {
        if (!/^[^:]+: nilai disembunyikan$/.test(text)) {
          found.push(`halaman ${current}: ${text}`);
        }
      }
      if (current < pages) await next(page).click();
    }
    expect(found).toEqual([]);
    // Pengujiannya tidak kosong: bidang rahasia memang tampil, tanpa nilai.
    const expectedHidden = entries.reduce(
      (sum, entry) => sum + entry.changes.filter((c) => c.redacted).length,
      0,
    );
    expect(hidden).toBe(expectedHidden);
    expect(hidden).toBeGreaterThan(10);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("waktu bergeser: catatan baru muncul di atas tanpa memuat ulang, dan halaman yang dipilih tetap", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    // Mulai 10 menit sebelum sebuah catatan; 20 menit kemudian catatan itu ada
    // di daftar.
    const target = mockAuditLog(MOMENT)[4];
    const start = target.at - 600;
    const end = start + 1_200;
    expect(mockAuditLog(start).some((e) => e.id === target.id)).toBe(false);
    expect(mockAuditLog(end)[0].id).toBe(target.id);

    await openAuditAt(page, start);
    const before = mockAuditLog(start);
    await expect(rows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    expect((await readRows(page)).map((row) => row.id)).toEqual(
      before.slice(0, AUDIT_PAGE_SIZE).map((entry) => entry.id),
    );
    await expect(
      page.locator(`[data-testid=audit-row][data-entry-id="${target.id}"]`),
    ).toHaveCount(0);

    // Jam server maju 20 menit; penyegaran berikutnya (30 detik) membacanya.
    await page.clock.setFixedTime(end * 1000);
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    const after = mockAuditLog(end);
    await expect(
      page.locator(`[data-testid=audit-row][data-entry-id="${target.id}"]`),
    ).toHaveCount(1);
    await expect
      .poll(async () => (await readRows(page)).map((row) => row.id))
      .toEqual(after.slice(0, AUDIT_PAGE_SIZE).map((entry) => entry.id));
    await expect(
      page.locator("[data-testid=audit-tile][data-kind=total]"),
    ).toHaveAttribute("data-value", String(after.length));

    // Halaman 2 tetap halaman 2 ketika data disegarkan lagi.
    await next(page).click();
    await expect(status(page)).toContainText("Halaman 2 dari");
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    await expect(status(page)).toContainText("Halaman 2 dari");
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("halaman", () => {
  test("tombol Sebelumnya dan Berikutnya memakai aria-disabled di ujung, fokus tidak hilang, dan papan ketik tetap bekerja", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    const entries = mockAuditLog(MOMENT);
    const pages = Math.ceil(entries.length / AUDIT_PAGE_SIZE);
    const lastCount = entries.length - (pages - 1) * AUDIT_PAGE_SIZE;

    const blocked = async (button: Locator, value: boolean) => {
      await expect(button).toHaveAttribute("aria-disabled", String(value));
      // Tidak pernah memakai disabled, supaya fokus papan ketik tidak hilang.
      await expect(button).not.toHaveAttribute("disabled", /.*/);
    };

    // Halaman pertama: mundur tertahan, maju terbuka; tekan yang tertahan tak berefek.
    await blocked(previous(page), true);
    await blocked(next(page), false);
    await previous(page).focus();
    await page.keyboard.press("Enter");
    await expect(previous(page)).toBeFocused();
    await expect(status(page)).toContainText(`Halaman 1 dari ${pages}`);

    // Maju dengan papan ketik; fokus tetap di tombol yang sama.
    await next(page).focus();
    await page.keyboard.press("Enter");
    await expect(status(page)).toContainText(`Halaman 2 dari ${pages}`);
    await expect(next(page)).toBeFocused();
    await blocked(previous(page), false);
    expect((await readRows(page)).map((row) => row.id)).toEqual(
      entries
        .slice(AUDIT_PAGE_SIZE, 2 * AUDIT_PAGE_SIZE)
        .map((entry) => entry.id),
    );
    await previous(page).click();
    await expect(status(page)).toContainText(`Halaman 1 dari ${pages}`);
    await expect(previous(page)).toBeFocused();

    // Ke halaman terakhir: Berikutnya tertahan tetapi MASIH berfokus.
    await next(page).focus();
    for (let current = 2; current <= pages; current += 1) {
      await page.keyboard.press("Enter");
      await expect(status(page)).toContainText(
        `Halaman ${current} dari ${pages}`,
      );
    }
    await expect(rows(page)).toHaveCount(lastCount);
    await blocked(next(page), true);
    await blocked(previous(page), false);
    await expect(next(page)).toBeFocused();
    await expect(status(page)).toHaveText(
      statusText(
        pages,
        pages,
        (pages - 1) * AUDIT_PAGE_SIZE + 1,
        entries.length,
        entries.length,
      ),
    );
    // Menekan yang tertahan di ujung tidak mengubah apa pun.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(status(page)).toContainText(`Halaman ${pages} dari ${pages}`);
    await expect(next(page)).toBeFocused();
    expect(await readRows(page)).toHaveLength(lastCount);

    // Pembaca layar mendengar rentang yang tampil.
    await expect(status(page)).toHaveAttribute("role", "status");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("kotak tabel bisa difokus dan digulir dengan papan ketik, ikon hanya hiasan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: { width: 390, height: 844 },
    });
    await openAuditAt(page, MOMENT);
    const region = page.getByRole("region", { name: "Daftar jejak aktivitas" });
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await expect(region).toBeFocused();
    expect(await region.evaluate((el) => el.scrollLeft)).toBe(0);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => region.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    // Semua ikon disembunyikan dari pembaca layar; lencana tetap bertulisan.
    await expect(page.locator("main svg:not([aria-hidden=true])")).toHaveCount(
      0,
    );
    for (const badge of await page.getByTestId("audit-action").all()) {
      expect(((await badge.textContent()) ?? "").trim().length).toBeGreaterThan(
        3,
      );
    }
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("keadaan", () => {
  test("memuat: kerangka tampil sampai data tiba, lalu diganti isi", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    // Dari HTML server: kerangka sudah ada, tanpa satu baris data pun (daftarnya
    // bergantung pada jam browser, jadi server tidak boleh menggambarnya).
    const html = await (await page.request.get("/app/jejak-aktivitas")).text();
    expect(html).toContain('data-view="loading"');
    expect(html).toContain("Memuat jejak aktivitas");
    expect(html).not.toContain("audit-row");
    expect(html).not.toContain("audit-tile");

    await recordViews(page);
    await openAuditAt(page, MOMENT);
    await expect(board(page)).toHaveAttribute("data-view", "ready");
    const { views, loading } = await recorded(page);
    // Memuat dulu, lalu isi: tanpa kosong atau galat di antaranya.
    expect(views).toEqual(["loading", "ready"]);
    expect(loading).not.toBeNull();
    expect(loading!.label).toBe("Memuat jejak aktivitas");
    expect(loading!.height).toBeGreaterThan(200);
    await expect(page.getByTestId("audit-loading")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    expect(errors).toEqual([]);
    await context.close();
  });

  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`kerangka ${reducedMotion === "reduce" ? "tidak bergerak" : "berdenyut"} bila gerak ${reducedMotion === "reduce" ? "dikurangi" : "tidak dibatasi"}`, async ({
      browser,
    }) => {
      const { context, page, errors } = await contextFor(browser, cookies, {
        reducedMotion,
      });
      await recordViews(page);
      await openAuditAt(page, MOMENT);
      // Rupa kerangka pada saat pertama terlihat, sebelum data tiba.
      const { loading } = await recorded(page);
      expect(loading).not.toBeNull();
      const names = loading!.animations;
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        if (reducedMotion === "reduce") expect(name).toBe("none");
        else expect(name).not.toBe("none");
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("kosong: sebelum log dimulai tampil 'Belum ada aktivitas tercatat', tanpa tabel dan angka", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await page.clock.install({ time: (AUDIT_MOCK_START - 5 * DAY) * 1000 });
    await page.clock.setFixedTime((AUDIT_MOCK_START - 5 * DAY) * 1000);
    await page.goto("/app/jejak-aktivitas");
    await expect(page.getByTestId("audit-empty")).toBeVisible();
    await expect(board(page)).toHaveAttribute("data-view", "empty");
    await expect(page.getByText("Belum ada aktivitas tercatat")).toBeVisible();
    await expect(log(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByTestId("audit-tile")).toHaveCount(0);
    await expect(page.getByTestId("audit-loading")).toHaveCount(0);
    // Judul dan pemberitahuan data tiruan tetap ada.
    await expect(
      page.getByRole("heading", { name: "Jejak Aktivitas", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Data tiruan, belum terhubung ke log audit di backend"),
    ).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("galat sebelum ada data: pesan dan Coba lagi, gagal lagi bila masih offline, lalu pulih", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await recordViews(page);
    await startOffline(page);
    await page.clock.install({ time: MOMENT * 1000 });
    await page.clock.setFixedTime(MOMENT * 1000);
    await page.goto("/app/jejak-aktivitas");

    await expect(board(page)).toHaveAttribute("data-view", "error");
    expect((await recorded(page)).views).toEqual(["loading", "error"]);
    const banner = page.getByTestId("audit-error");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("role", "alert");
    await expect(banner).toContainText("Jejak aktivitas belum bisa dimuat.");
    await expect(page.getByTestId("audit-loading")).toHaveCount(0);
    await expect(log(page)).toHaveCount(0);

    // Masih offline: mencoba lagi gagal lagi, dan pesannya tetap.
    await banner.getByRole("button", { name: "Coba lagi" }).click();
    await page.clock.runFor(300);
    await expect(board(page)).toHaveAttribute("data-view", "error");
    await expect(banner).toBeVisible();

    await setOnline(page, true);
    await banner.getByRole("button", { name: "Coba lagi" }).click();
    await page.clock.runFor(300);
    await expect(board(page)).toHaveAttribute("data-view", "ready");
    await expect(page.getByTestId("audit-error")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    expect((await readRows(page)).map((row) => row.id)).toEqual(
      mockAuditLog(MOMENT)
        .slice(0, AUDIT_PAGE_SIZE)
        .map((e) => e.id),
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  test("pembaruan gagal: data terakhir tetap tampil dengan peringatan, dan hilang setelah berhasil lagi", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openAuditAt(page, MOMENT);
    await expect(board(page)).toHaveAttribute("data-view", "ready");
    const first = (await readRows(page)).map((row) => row.id);
    expect(first).toHaveLength(AUDIT_PAGE_SIZE);

    // Jaringan putus sungguhan: penyegaran berikutnya gagal.
    await context.setOffline(true);
    await page.clock.runFor(AUDIT_REFRESH_MS + 300);
    const banner = page.getByTestId("audit-error");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      "Pembaruan terakhir gagal; yang tampil adalah data sebelumnya.",
    );
    // Data tidak dihapus: tabel dan angka masih ada, isinya sama.
    await expect(board(page)).toHaveAttribute("data-view", "ready");
    expect((await readRows(page)).map((row) => row.id)).toEqual(first);
    await expect(page.getByTestId("audit-tile")).toHaveCount(3);

    await context.setOffline(false);
    await banner.getByRole("button", { name: "Coba lagi" }).click();
    await page.clock.runFor(300);
    await expect(page.getByTestId("audit-error")).toHaveCount(0);
    expect(withoutOfflineNoise(errors)).toEqual([]);
    await context.close();
  });
});

test.describe("tata letak", () => {
  for (const width of [390, 1440]) {
    test(`di ${width} px halaman tidak menggulir ke samping dan semua bagian muat di layar`, async ({
      browser,
    }) => {
      const { context, page, errors } = await contextFor(browser, cookies, {
        viewport: { width, height: 900 },
      });
      await openAuditAt(page, MOMENT);
      await expect(rows(page)).toHaveCount(AUDIT_PAGE_SIZE);
      expect(await overflows(page)).toBe(false);

      for (const testId of ["audit-tile", "audit-log"]) {
        const boxes = await page.getByTestId(testId).evaluateAll((items) =>
          items.map((item) => {
            const box = item.getBoundingClientRect();
            return { left: box.left, right: box.right };
          }),
        );
        expect(boxes.length, testId).toBeGreaterThan(0);
        for (const box of boxes) {
          expect(box.left, testId).toBeGreaterThanOrEqual(0);
          expect(box.right, testId).toBeLessThanOrEqual(width);
        }
      }

      const lefts = await page
        .getByTestId("audit-tile")
        .evaluateAll((items) =>
          items.map((item) => Math.round(item.getBoundingClientRect().left)),
        );
      const region = page.getByRole("region", {
        name: "Daftar jejak aktivitas",
      });
      const scrolls = await region.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1,
      );
      if (width === 390) {
        // Satu kolom, dan tabel yang lebar bergulir di dalam kotaknya sendiri.
        expect(new Set(lefts).size).toBe(1);
        expect(scrolls).toBe(true);
      } else {
        // Tiga kartu sebaris, dan tabel muat tanpa digulir.
        expect(new Set(lefts).size).toBe(3);
        expect(scrolls).toBe(false);
      }
      // Tombol halaman dan keterangan halaman terjangkau tanpa menggulir ke samping.
      for (const locator of [status(page), previous(page), next(page)]) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});

// Tulisan yang harus terbaca jelas (>= 4,5 : 1) di tiap tema.
const textElements = [
  "main h1",
  "main h1 + p",
  "main p.rounded-full",
  "[data-testid=audit-tile] p",
  "[data-testid=audit-log] h2",
  "[data-testid=audit-log] [data-slot=card-description]",
  "[data-testid=audit-log] caption",
  "[data-testid=audit-log] thead th",
  "[data-testid=audit-time]",
  "[data-testid=audit-actor]",
  "[data-testid=audit-row] td:nth-child(4)",
  "[data-testid=audit-summary]",
  "[data-testid=audit-change]",
  "[data-testid=audit-action]",
  "[data-testid=audit-page-status]",
  "[data-testid=audit-log] p.text-xs",
  "[data-testid=audit-previous]",
  "[data-testid=audit-next]",
];
const groups = ["akses", "alert", "perangkat", "pengaturan"];

for (const scheme of ["light", "dark"] as const) {
  test(`tulisan terbaca jelas di tema ${scheme} pada semua halaman dan semua kelompok aksi`, async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      colorScheme: scheme,
    });
    await openAuditAt(page, MOMENT);
    const pages = Math.ceil(mockAuditLog(MOMENT).length / AUDIT_PAGE_SIZE);
    const problems: string[] = [];
    const perGroup = new Map<string, number>();
    let measured = 0;
    for (let current = 1; current <= pages; current += 1) {
      await expect(status(page)).toContainText(`Halaman ${current} dari`);
      const selectors = [
        ...textElements,
        ...groups.map(
          (group) => `[data-testid=audit-action][data-group=${group}]`,
        ),
      ];
      for (const selector of selectors) {
        const results = await measureContrast(page, selector);
        measured += results.length;
        const group = /data-group=(\w+)/.exec(selector)?.[1];
        if (group)
          perGroup.set(group, (perGroup.get(group) ?? 0) + results.length);
        // Pemilih yang tidak kena apa pun hanya wajar untuk satu kelompok aksi
        // atau perubahan di halaman yang tidak memuatnya.
        if (
          results.length === 0 &&
          !group &&
          !selector.includes("audit-change")
        ) {
          problems.push(`halaman ${current} ${selector}: tidak ada elemen`);
        }
        for (const { text, ratio } of results) {
          if (ratio < 4.5) {
            problems.push(
              `halaman ${current} ${selector} "${text}": ${ratio.toFixed(2)}`,
            );
          }
        }
      }
      if (current < pages) await next(page).click();
    }
    expect(problems.slice(0, 8)).toEqual([]);
    expect(measured).toBeGreaterThan(1_000);
    // Setiap kelompok aksi (warna temanya sendiri) ikut terukur.
    for (const group of groups) {
      expect(perGroup.get(group) ?? 0, group).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}
