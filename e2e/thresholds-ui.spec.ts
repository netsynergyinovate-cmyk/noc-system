import { expect, test, type Locator, type Page } from "@playwright/test";
import { Pool } from "pg";
import { anomalyRules } from "../src/lib/dashboard/anomalies";
import { incidentLabels } from "../src/lib/dashboard/incidents";
import { isDefaultThresholds } from "../src/lib/dashboard/thresholds";
import {
  contextFor,
  measureContrast,
  signUp,
  type Cookies,
} from "./billing-ui";

// Halaman Pengaturan > Ambang Batas di halaman sungguhan (login nyata, akun admin
// karena menyimpan butuh threshold:manage): lima kartu dengan angka bawaan dari
// anomalyRules, simpan ke tabel alert_thresholds lewat /api/thresholds dan muat
// ulang, isian salah, batalkan, kembalikan per kartu dan semua (lewat dialog),
// server menolak atau tidak terjangkau, akun tanpa izin, kejujuran soal kapan
// rule engine membacanya, tata letak 390 dan 1440 px, kontras di dua tema, dan
// tanpa galat di konsol. Tabel dipakai bersama, jadi dikosongkan sebelum tiap
// tes (Playwright menjalankan tes berurutan, workers: 1).

const pool = new Pool({
  connectionString: process.env.STARTER_TEST_DATABASE_URL,
  max: 1,
});

let cookies: Cookies;
test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
  });
  cookies = await signUp(context, "Petugas Ambang");
  const response = await context.request.get("/api/auth/get-session");
  const { user } = (await response.json()) as { user: { id: string } };
  // Peran diberikan di luar aplikasi, seperti npm run role:set.
  await pool.query('UPDATE "user" SET role = $1 WHERE id = $2', [
    "admin",
    user.id,
  ]);
  await context.close();
});
test.beforeEach(async () => {
  await pool.query("DELETE FROM alert_thresholds");
});
test.afterAll(async () => {
  await pool.query("DELETE FROM alert_thresholds");
  await pool.end();
});

// Membuka halaman dan tab "Ambang Batas". Klik sebelum hidrasi tidak berefek,
// jadi diulang sampai isinya muncul.
async function openThresholds(page: Page) {
  await page.goto("/app/pengaturan");
  const tab = page.getByRole("tab", { name: "Ambang Batas" });
  const section = page.getByTestId("threshold-settings");
  await expect(async () => {
    await tab.click();
    await expect(section).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return section;
}

const card = (page: Page, kind: string) =>
  page.locator(`[data-testid="threshold-card"][data-kind="${kind}"]`);
const thresholdInput = (page: Page, kind: string) =>
  card(page, kind).getByTestId("threshold-input");
const durationInput = (page: Page, kind: string) =>
  card(page, kind).getByTestId("duration-input");
const saveButton = (page: Page) =>
  page.getByRole("button", { name: "Simpan ambang" });
const cancelButton = (page: Page) =>
  page.getByRole("button", { name: "Batalkan perubahan" });
const resetAllButton = (page: Page) =>
  page.getByRole("button", { name: "Kembalikan semua ke bawaan" });
// Nilai di database menurut GET /api/thresholds (memakai cookie halaman).
const storedJson = async (page: Page) => {
  const response = await page.request.get("/api/thresholds");
  expect(response.status()).toBe(200);
  return (await response.json()).data;
};
// null bila semua aturan masih bawaan (tidak ada yang tersimpan).
const stored = async (page: Page) => {
  const data = await storedJson(page);
  return isDefaultThresholds(data) ? null : JSON.stringify(data);
};
// Mengisi tabel lewat API, seperti petugas lain yang menyimpan.
async function putThresholds(page: Page, values: object) {
  const response = await page.request.put("/api/thresholds", {
    headers: { origin: "http://localhost:3101" },
    data: values,
  });
  expect(response.status()).toBe(200);
}

async function expectBlocked(button: Locator, blocked: boolean) {
  await expect(button).toHaveAttribute("aria-disabled", String(blocked));
  // Tidak pernah memakai disabled, supaya fokus papan ketik tidak hilang.
  await expect(button).not.toHaveAttribute("disabled", /.*/);
}

test.describe("kartu aturan", () => {
  test("lima kartu dengan angka dan kalimat dari anomalyRules", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await expect(page.getByTestId("threshold-card")).toHaveCount(5);
    await expect(
      page.getByRole("heading", { level: 2, name: "Ambang alert" }),
    ).toBeVisible();

    for (const rule of anomalyRules) {
      const current = card(page, rule.kind);
      await expect(current.getByRole("heading", { level: 3 })).toHaveText(
        incidentLabels[rule.kind],
      );
      // Kalimat hidupnya diawali kalimat aturan di anomalyRules.
      const sentence = await current.getByTestId("rule-sentence").innerText();
      expect(sentence.startsWith(rule.description)).toBe(true);

      if (rule.threshold === null) {
        await expect(current.getByTestId("threshold-none")).toBeVisible();
        await expect(current.getByTestId("threshold-input")).toHaveCount(0);
      } else {
        await expect(current.getByTestId("threshold-input")).toHaveValue(
          String(rule.threshold),
        );
      }
      if (rule.forSeconds === 0) {
        await expect(current.getByTestId("duration-fixed")).toContainText(
          "Langsung, tanpa jeda",
        );
        await expect(current.getByTestId("duration-input")).toHaveCount(0);
      } else {
        await expect(current.getByTestId("duration-input")).toHaveValue(
          String(rule.forSeconds),
        );
      }
      await expect(current.getByTestId("rule-changed")).toHaveCount(0);
      await expect(current.getByTestId("field-error")).toHaveCount(0);
    }

    // Angka dan kalimat persisnya, sebagai rujukan yang terbaca manusia.
    await expect(card(page, "cpu").getByTestId("rule-sentence")).toHaveText(
      "CPU router di atas 85% selama 3 menit",
    );
    await expect(card(page, "cpu").getByTestId("duration-preview")).toHaveText(
      "= 3 menit",
    );
    await expect(card(page, "optical").getByTestId("rule-sentence")).toHaveText(
      "Rx ONU di bawah -25 dBm (bukan CCQ)",
    );
    await expect(card(page, "offline").getByTestId("rule-sentence")).toHaveText(
      "Pelanggan terputus lebih dari 30 detik",
    );
    // Hint: bawaan, rentang, dan arah alert.
    await expect(card(page, "cpu")).toContainText("Bawaan: 85%.");
    await expect(card(page, "cpu")).toContainText(
      "Rentang 50% sampai 99%, bilangan bulat.",
    );
    await expect(card(page, "cpu")).toContainText(
      "Bawaan: 3 menit (180 detik).",
    );
    await expect(card(page, "optical")).toContainText(
      "Rentang -40 dBm sampai -15 dBm, kelipatan 0,5.",
    );
    await expect(card(page, "optical")).toContainText("di bawah ambang");
    await expect(card(page, "queue")).toContainText("di atas ambang");

    // Semua isian punya label yang menyebut satuannya.
    await expect(
      card(page, "cpu").getByLabel("Ambang beban CPU (%)"),
    ).toHaveValue("85");
    await expect(
      card(page, "optical").getByLabel("Ambang Rx ONU (dBm)"),
    ).toHaveValue("-25");
    await expect(
      card(page, "offline").getByLabel("Lama terputus sebelum alert (detik)"),
    ).toHaveValue("30");

    // Tanpa perubahan: tiga tombol halaman tidak berlaku dan menulis alasannya.
    await expectBlocked(saveButton(page), true);
    await expect(page.getByTestId("save-reason")).toHaveText(
      "Tidak ada perubahan",
    );
    await expectBlocked(cancelButton(page), true);
    await expect(page.getByTestId("cancel-reason")).toHaveText(
      "Tidak ada perubahan",
    );
    await expectBlocked(resetAllButton(page), true);
    await expect(page.getByTestId("reset-reason")).toHaveText(
      "Sudah memakai nilai bawaan",
    );
    for (const rule of anomalyRules) {
      await expectBlocked(
        card(page, rule.kind).getByTestId("rule-reset"),
        true,
      );
      await expect(
        card(page, rule.kind).getByTestId("rule-reset-reason"),
      ).toHaveText("Sudah nilai bawaan");
    }
    await expect(page.getByTestId("threshold-unsaved")).toHaveCount(0);
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);
    // Wilayah status selalu ada di halaman, supaya isinya diumumkan saat muncul.
    await expect(page.getByTestId("threshold-status")).toHaveAttribute(
      "role",
      "status",
    );
    expect(await stored(page)).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("tab Ambang Batas tidak lagi memuat angka lama yang bertentangan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    const panel = page.getByRole("tabpanel");
    const text = await panel.innerText();
    for (const old of [
      "Batas Waspada",
      "Batas Kritis",
      "Sinyal Lemah",
      "Sinyal Kritis",
      "Flapping",
      "Jendela Waktu",
      "Penstabilan",
      "15 detik",
      "-27",
      "-30",
      "MikroTik RouterOS",
    ]) {
      expect(text, old).not.toContain(old);
    }
    expect(text).not.toMatch(/\b75\b/);
    // Tab lain di halaman yang sama tidak terganggu.
    await page.getByRole("tab", { name: "Umum" }).click();
    await expect(page.getByLabel("Nama Penyedia Layanan / ISP")).toBeVisible();
    // Panduan langkah 2 tidak lagi menyebut -27,0 dBm dan merujuk bawaan -25.
    await page.getByRole("tab", { name: "Panduan Koneksi" }).click();
    const guide = await page.getByRole("tabpanel").innerText();
    expect(guide).not.toContain("-27");
    expect(guide).toContain("-25 dBm");
    expect(guide).toContain("Ambang Batas");
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("kejujuran soal penyimpanan dan rule engine", () => {
  test("kalimat database, berlaku setelah backend di-restart", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    const honesty = page.getByTestId("threshold-honesty");
    await expect(honesty).toContainText("tersimpan di database");
    await expect(honesty).toContainText("setelah backend di-restart");
    await expect(honesty).toContainText("alert tiruan");
    await expect(honesty).toContainText("tidak mencakup tab ini");
    await expect(honesty).not.toContainText("peramban");
    // Tidak ada klaim palsu, juga sesudah menyimpan.
    await thresholdInput(page, "cpu").fill("70");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    const everything = await page.locator("body").innerText();
    expect(everything).not.toContain("diterapkan ke seluruh modul");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("daftar aturan di halaman Anomali tidak berubah setelah menyimpan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("60");
    await durationInput(page, "cpu").fill("600");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    await page.goto("/app/anomali");
    await expect(
      page.getByText("CPU router di atas 85% selama 3 menit").first(),
    ).toBeVisible();
    const text = await page.locator("main, body").first().innerText();
    expect(text).not.toContain("CPU router di atas 60%");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("menyimpan dan mengembalikan memanggil PUT lalu DELETE /api/thresholds", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET")
        sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await thresholdInput(page, "cpu").fill("70");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    await resetAllButton(page).click();
    await page
      .getByRole("button", { name: "Ya, kembalikan ke bawaan" })
      .click();
    await expect(page.getByTestId("threshold-saved")).toHaveAttribute(
      "data-kind",
      "reset",
    );
    expect(sent).toEqual(["PUT /api/thresholds", "DELETE /api/thresholds"]);
    expect(await stored(page)).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("menyimpan", () => {
  test("ubah CPU ke 70, simpan, lalu muat ulang: nilainya tetap", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);

    await thresholdInput(page, "cpu").fill("70");
    // Hanya kartu CPU yang berubah; kalimat mengikuti isian.
    await expect(card(page, "cpu").getByTestId("rule-changed")).toHaveText(
      "Berubah",
    );
    await expect(page.getByTestId("rule-changed")).toHaveCount(1);
    await expect(card(page, "cpu").getByTestId("rule-sentence")).toHaveText(
      "CPU router di atas 70% selama 3 menit",
    );
    await expect(page.getByTestId("threshold-unsaved")).toHaveText(
      "Ada perubahan yang belum disimpan",
    );
    await expectBlocked(saveButton(page), false);
    await expect(page.getByTestId("save-reason")).toHaveCount(0);
    await expectBlocked(cancelButton(page), false);
    // Belum tersimpan sebelum tombol ditekan.
    expect(await stored(page)).toBeNull();

    await saveButton(page).click();
    const saved = page.getByTestId("threshold-saved");
    await expect(saved).toContainText("Ambang disimpan di database");
    await expect(saved).toContainText(
      "Beban router tinggi: ambang 85% menjadi 70%",
    );
    await expect(saved).toHaveAttribute("data-kind", "saved");
    await expect(page.getByTestId("threshold-status")).toContainText(
      "Ambang disimpan di database",
    );
    await expect(page.getByTestId("threshold-unsaved")).toHaveCount(0);
    await expect(page.getByTestId("rule-changed")).toHaveCount(0);
    await expectBlocked(saveButton(page), true);
    expect((await storedJson(page)).cpu).toEqual({
      threshold: 70,
      forSeconds: 180,
    });
    expect(Object.keys(await storedJson(page))).toEqual([
      "queue",
      "cpu",
      "port",
      "optical",
      "offline",
    ]);
    await expectBlocked(resetAllButton(page), false);

    // Mulai mengubah lagi: barisnya hilang dan diganti peringatan belum simpan.
    await thresholdInput(page, "queue").fill("90");
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);
    await expect(page.getByTestId("threshold-unsaved")).toBeVisible();

    // Muat ulang: nilai 70 masih ada.
    await openThresholds(page);
    await expect(thresholdInput(page, "cpu")).toHaveValue("70");
    await expect(thresholdInput(page, "queue")).toHaveValue("95");
    await expect(card(page, "cpu").getByTestId("rule-sentence")).toHaveText(
      "CPU router di atas 70% selama 3 menit",
    );
    await expect(page.getByTestId("rule-changed")).toHaveCount(0);
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);
    await expectBlocked(saveButton(page), true);
    // Kartu CPU boleh dikembalikan karena sudah bukan bawaan.
    await expectBlocked(card(page, "cpu").getByTestId("rule-reset"), false);
    await expectBlocked(card(page, "queue").getByTestId("rule-reset"), true);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("beberapa perubahan disebut berurutan sesuai aturan, termasuk koma desimal dan durasi", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    // Sengaja diisi dari bawah ke atas.
    await durationInput(page, "offline").fill("120");
    await thresholdInput(page, "optical").fill("-27,5");
    await durationInput(page, "port").fill("90");
    await durationInput(page, "cpu").fill("300");
    await thresholdInput(page, "queue").fill("90");
    await expect(page.getByTestId("rule-changed")).toHaveCount(5);
    await expect(card(page, "optical").getByTestId("rule-sentence")).toHaveText(
      "Rx ONU di bawah -27,5 dBm (bukan CCQ)",
    );
    await expect(card(page, "offline").getByTestId("rule-sentence")).toHaveText(
      "Pelanggan terputus lebih dari 2 menit",
    );
    await expect(card(page, "port").getByTestId("rule-sentence")).toHaveText(
      "Error interface naik lebih dari 20 per menit selama 90 detik",
    );
    await expect(card(page, "cpu").getByTestId("duration-preview")).toHaveText(
      "= 5 menit",
    );
    await saveButton(page).click();
    const lines = page.getByTestId("threshold-saved-changes").locator("li");
    await expect(lines).toHaveText([
      "Jalur traffic penuh: ambang 95% menjadi 90%",
      "Beban router tinggi: durasi 3 menit menjadi 5 menit",
      "Error pada port: durasi 1 menit menjadi 90 detik",
      "Sinyal optik lemah: ambang -25 dBm menjadi -27,5 dBm",
      "Pelanggan offline: durasi 30 detik menjadi 2 menit",
    ]);
    const json = await storedJson(page);
    expect(json.optical.threshold).toBe(-27.5);
    expect(json.offline).toEqual({ threshold: null, forSeconds: 120 });
    await openThresholds(page);
    await expect(thresholdInput(page, "optical")).toHaveValue("-27,5");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("tab lain yang menyimpan ikut tampil saat tab ini difokus lagi", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    const other = await context.newPage();
    await other.goto("/app/pengaturan");
    const tab = other.getByRole("tab", { name: "Ambang Batas" });
    await expect(async () => {
      await tab.click();
      await expect(other.getByTestId("threshold-settings")).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 20_000 });
    await thresholdInput(other, "cpu").fill("66");
    await saveButton(other).click();
    await expect(other.getByTestId("threshold-saved")).toBeVisible();
    // Tab pertama tidak punya isian yang diubah, jadi mengikuti begitu difokus.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(thresholdInput(page, "cpu")).toHaveValue("66");
    await expect(card(page, "cpu").getByTestId("rule-changed")).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("isian salah", () => {
  test("pesan galat, aria-invalid, aria-describedby, dan tombol simpan tertahan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    const input = thresholdInput(page, "cpu");
    const error = card(page, "cpu").getByTestId("field-error");

    const cases: Array<[string, string]> = [
      ["abc", "Isi dengan angka biasa, misalnya 85 atau -25,5."],
      ["1e2", "Isi dengan angka biasa, misalnya 85 atau -25,5."],
      ["0x10", "Isi dengan angka biasa, misalnya 85 atau -25,5."],
      ["85abc", "Isi dengan angka biasa, misalnya 85 atau -25,5."],
      ["٨٥", "Isi dengan angka biasa, misalnya 85 atau -25,5."],
      ["", "Isian tidak boleh kosong."],
      ["   ", "Isian tidak boleh kosong."],
      ["101", "Harus antara 50% dan 99%."],
      ["49", "Harus antara 50% dan 99%."],
      ["85,5", "Harus bilangan bulat."],
      ["1.000", "Tulis tanpa pemisah ribuan, misalnya 1000."],
    ];
    for (const [text, message] of cases) {
      await input.fill(text);
      await expect(error, JSON.stringify(text)).toHaveText(message);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      // Galat dikaitkan ke isian, dan ada sebagai teks, bukan hanya warna.
      const described = (await input.getAttribute("aria-describedby"))!.split(
        " ",
      );
      expect(described).toContain(await error.getAttribute("id"));
      await expect(card(page, "cpu")).toHaveAttribute("data-invalid", "true");
      await expectBlocked(saveButton(page), true);
      await expect(page.getByTestId("save-reason")).toHaveText(
        "Perbaiki 1 isian yang salah",
      );
    }
    // Kalimat tetap memakai nilai tersimpan dan mengatakannya.
    await expect(card(page, "cpu").getByTestId("rule-sentence")).toHaveText(
      "CPU router di atas 85% selama 3 menit",
    );
    await expect(card(page, "cpu")).toContainText(
      "Isian yang salah belum dipakai dalam kalimat ini.",
    );

    // Menekan tombol yang tertahan tidak menyimpan, dan fokus pindah ke isian yang salah.
    await input.fill("abc");
    await page.getByRole("button", { name: "Batalkan perubahan" }).focus();
    // force: Playwright menganggap aria-disabled tidak aktif, padahal pengguna
    // sungguhan tetap bisa menekannya.
    await saveButton(page).click({ force: true });
    await expect(input).toBeFocused();
    expect(await stored(page)).toBeNull();
    await saveButton(page).focus();
    await page.keyboard.press("Enter");
    expect(await stored(page)).toBeNull();
    await saveButton(page).focus();
    await page.keyboard.press("Space");
    expect(await stored(page)).toBeNull();
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);

    // Dua isian salah dihitung dua.
    await durationInput(page, "queue").fill("5");
    await expect(page.getByTestId("save-reason")).toHaveText(
      "Perbaiki 2 isian yang salah",
    );
    await expect(card(page, "queue").getByTestId("field-error")).toHaveText(
      "Harus antara 10 detik dan 600 detik.",
    );
    // Durasi desimal juga ditolak.
    await durationInput(page, "queue").fill("30,5");
    await expect(card(page, "queue").getByTestId("field-error")).toHaveText(
      "Harus bilangan bulat.",
    );
    // Optical: kelipatan 0,5.
    await thresholdInput(page, "optical").fill("-25,3");
    await expect(card(page, "optical").getByTestId("field-error")).toHaveText(
      "Harus kelipatan 0,5 dBm.",
    );
    await expect(page.getByTestId("save-reason")).toHaveText(
      "Perbaiki 3 isian yang salah",
    );

    // Memperbaiki semuanya (kembali ke nilai tersimpan) menghapus galat dan perubahan.
    await input.fill("85");
    await durationInput(page, "queue").fill("30");
    await thresholdInput(page, "optical").fill("-25");
    await expect(page.getByTestId("field-error")).toHaveCount(0);
    await expect(input).not.toHaveAttribute("aria-invalid", /.*/);
    await expect(page.getByTestId("rule-changed")).toHaveCount(0);
    await expect(page.getByTestId("save-reason")).toHaveText(
      "Tidak ada perubahan",
    );
    expect(await stored(page)).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("isian sah dan salah bersamaan: tidak ada yang tersimpan sebelum semuanya benar", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "queue").fill("80");
    await thresholdInput(page, "cpu").fill("999");
    await expect(page.getByTestId("rule-changed")).toHaveCount(2);
    await saveButton(page).click({ force: true });
    expect(await stored(page)).toBeNull();
    await thresholdInput(page, "cpu").fill("75");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    const json = await storedJson(page);
    expect(json.queue.threshold).toBe(80);
    expect(json.cpu.threshold).toBe(75);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("kolom yang tetap tidak punya isian dan tidak bisa diubah", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await expect(durationInput(page, "optical")).toHaveCount(0);
    await expect(thresholdInput(page, "offline")).toHaveCount(0);
    await expect(
      card(page, "optical").getByTestId("duration-fixed"),
    ).toContainText("Langsung, tanpa jeda");
    await expect(
      card(page, "offline").getByTestId("threshold-none"),
    ).toContainText("Tanpa ambang angka");
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("batalkan dan kembalikan", () => {
  test("Batalkan perubahan mengembalikan isian ke nilai tersimpan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("70");
    await durationInput(page, "port").fill("abc");
    await expect(page.getByTestId("rule-changed")).toHaveCount(2);
    await cancelButton(page).click();
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await expect(durationInput(page, "port")).toHaveValue("60");
    await expect(page.getByTestId("rule-changed")).toHaveCount(0);
    await expect(page.getByTestId("field-error")).toHaveCount(0);
    await expect(page.getByTestId("threshold-unsaved")).toHaveCount(0);
    await expectBlocked(cancelButton(page), true);
    await expect(page.getByTestId("cancel-reason")).toHaveText(
      "Tidak ada perubahan",
    );
    // Menekan tombol yang sudah tertahan tidak melakukan apa-apa.
    await cancelButton(page).click({ force: true });
    expect(await stored(page)).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("Batalkan tidak menyentuh nilai yang sudah tersimpan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("70");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    await thresholdInput(page, "cpu").fill("55");
    await cancelButton(page).click();
    await expect(thresholdInput(page, "cpu")).toHaveValue("70");
    expect((await storedJson(page)).cpu.threshold).toBe(70);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("Kembalikan ke bawaan per kartu mengisi draft, belum menyimpan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("70");
    await durationInput(page, "cpu").fill("300");
    await thresholdInput(page, "queue").fill("80");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toBeVisible();

    await thresholdInput(page, "cpu").fill("75");
    const reset = card(page, "cpu").getByTestId("rule-reset");
    await expectBlocked(reset, false);
    await expect(reset).toHaveAccessibleName(
      "Kembalikan ke bawaan: Beban router tinggi",
    );
    await reset.click();
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await expect(durationInput(page, "cpu")).toHaveValue("180");
    // Berbeda dari yang tersimpan (70 dan 300), jadi bertanda Berubah.
    await expect(card(page, "cpu").getByTestId("rule-changed")).toBeVisible();
    await expect(card(page, "queue").getByTestId("rule-changed")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("threshold-unsaved")).toBeVisible();
    // Yang tersimpan belum berubah.
    expect((await storedJson(page)).cpu).toEqual({
      threshold: 70,
      forSeconds: 300,
    });
    // Kartu itu kini bawaan penuh di draft tetapi tersimpannya belum: masih bisa ditekan lagi.
    await card(page, "queue").getByTestId("rule-reset").click();
    await expect(thresholdInput(page, "queue")).toHaveValue("95");

    await saveButton(page).click();
    await expect(
      page.getByTestId("threshold-saved-changes").locator("li"),
    ).toHaveText([
      "Jalur traffic penuh: ambang 80% menjadi 95%",
      "Beban router tinggi: ambang 70% menjadi 85%",
      "Beban router tinggi: durasi 5 menit menjadi 3 menit",
    ]);
    const json = await storedJson(page);
    expect(json.cpu).toEqual({ threshold: 85, forSeconds: 180 });
    expect(json.queue).toEqual({ threshold: 95, forSeconds: 30 });
    for (const rule of anomalyRules) {
      await expectBlocked(
        card(page, rule.kind).getByTestId("rule-reset"),
        true,
      );
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  test("Kembalikan per kartu memperbaiki isian yang salah", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("abc");
    const reset = card(page, "cpu").getByTestId("rule-reset");
    // Isian salah dihitung sebagai berubah, jadi tombolnya berlaku.
    await expectBlocked(reset, false);
    await reset.click();
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await expect(page.getByTestId("field-error")).toHaveCount(0);
    await expect(page.getByTestId("rule-changed")).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("Kembalikan semua ke bawaan", () => {
  async function seed(page: Page) {
    await putThresholds(page, {
      queue: { threshold: 80, forSeconds: 20 },
      cpu: { threshold: 70, forSeconds: 300 },
      port: { threshold: 20, forSeconds: 60 },
      optical: { threshold: -25, forSeconds: 0 },
      offline: { threshold: null, forSeconds: 30 },
    });
  }

  test("dialog: fokus awal di Batal, Batal tidak mengubah, Konfirmasi mengembalikan, fokus kembali ke pemicu", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await page.goto("/app/pengaturan");
    await seed(page);
    await openThresholds(page);
    await expect(thresholdInput(page, "queue")).toHaveValue("80");
    const trigger = resetAllButton(page);
    await expectBlocked(trigger, false);

    // Lewat papan ketik: Tab sampai pemicu, lalu Enter.
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Kembalikan semua ambang ke bawaan?");
    // Menyebut berapa aturan yang berubah dan yang mana.
    await expect(page.getByTestId("threshold-reset-count")).toHaveText(
      "2 aturan",
    );
    await expect(dialog).toContainText(
      "Jalur traffic penuh, Beban router tinggi",
    );
    await expect(dialog).toContainText("langsung disimpan di database");
    await expect(dialog).not.toContainText("belum disimpan ikut dibuang");
    // Fokus awal di Batal, supaya Enter tidak langsung mengembalikan.
    await expect(
      dialog.getByRole("button", { name: "Batal", exact: true }),
    ).toBeFocused();

    // Batal tidak mengubah apa pun, dan fokus kembali ke pemicu.
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(thresholdInput(page, "queue")).toHaveValue("80");
    expect((await storedJson(page)).cpu.threshold).toBe(70);
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);

    // Escape juga menutup tanpa mengubah.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await storedJson(page)).queue.threshold).toBe(80);

    // Konfirmasi mengembalikan.
    await trigger.click();
    await dialog
      .getByRole("button", { name: "Ya, kembalikan ke bawaan" })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(thresholdInput(page, "queue")).toHaveValue("95");
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await expect(durationInput(page, "cpu")).toHaveValue("180");
    expect(await stored(page)).toBeNull();
    const saved = page.getByTestId("threshold-saved");
    await expect(saved).toHaveAttribute("data-kind", "reset");
    await expect(saved).toContainText(
      "Ambang dikembalikan ke bawaan di database",
    );
    await expect(saved).toContainText(
      "Jalur traffic penuh: ambang 80% menjadi 95%",
    );
    await expect(saved).toContainText(
      "Beban router tinggi: durasi 5 menit menjadi 3 menit",
    );
    // Sekarang semuanya bawaan: pemicu tertahan dan menulis alasannya.
    await expectBlocked(trigger, true);
    await expect(page.getByTestId("reset-reason")).toHaveText(
      "Sudah memakai nilai bawaan",
    );
    // Dan tetap begitu sesudah muat ulang.
    await openThresholds(page);
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("perubahan yang belum disimpan ikut dibuang dan dialog menyebutnya", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await page.goto("/app/pengaturan");
    await seed(page);
    await openThresholds(page);
    await thresholdInput(page, "port").fill("500");
    await thresholdInput(page, "optical").fill("abc");
    await resetAllButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("2 aturan");
    await expect(dialog).toContainText(
      "Perubahan yang belum disimpan ikut dibuang.",
    );
    await dialog
      .getByRole("button", { name: "Ya, kembalikan ke bawaan" })
      .click();
    await expect(thresholdInput(page, "port")).toHaveValue("20");
    await expect(thresholdInput(page, "optical")).toHaveValue("-25");
    await expect(page.getByTestId("field-error")).toHaveCount(0);
    await expect(page.getByTestId("rule-changed")).toHaveCount(0);
    await expect(page.getByTestId("threshold-unsaved")).toHaveCount(0);
    expect(await stored(page)).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("saat semuanya bawaan tetapi ada isian belum disimpan, dialog hanya membuang isian", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("70");
    await expectBlocked(resetAllButton(page), false);
    await resetAllButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      "Semua aturan sudah memakai nilai bawaan.",
    );
    await expect(dialog).toContainText("belum disimpan ikut dibuang");
    await dialog.getByRole("button", { name: "Batal", exact: true }).click();
    // Batal: isian tetap ada.
    await expect(thresholdInput(page, "cpu")).toHaveValue("70");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("pemicu yang tertahan tidak membuka dialog", async ({ browser }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await expectBlocked(resetAllButton(page), true);
    await resetAllButton(page).click({ force: true });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await resetAllButton(page).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("dialog menghormati gerak berkurang", async ({ browser }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      reducedMotion: "reduce",
    });
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("70");
    await resetAllButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const names = await page.evaluate(() => {
      const content = document.querySelector(
        '[data-slot="alert-dialog-content"]',
      )!;
      const overlay = document.querySelector(
        '[data-slot="alert-dialog-overlay"]',
      )!;
      return [
        getComputedStyle(content).animationName,
        getComputedStyle(overlay).animationName,
      ];
    });
    expect(names).toEqual(["none", "none"]);
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("pengaturan lama di peramban", () => {
  const defaultsText = {
    queue: ["95", "30"],
    cpu: ["85", "180"],
    port: ["20", "60"],
    optical: ["-25", ""],
    offline: ["", "30"],
  } as const;

  async function expectDefaults(page: Page) {
    for (const [kind, [threshold, seconds]] of Object.entries(defaultsText)) {
      if (threshold !== "") {
        await expect(thresholdInput(page, kind)).toHaveValue(threshold);
      }
      if (seconds !== "") {
        await expect(durationInput(page, kind)).toHaveValue(seconds);
      }
    }
  }

  test("pengaturan lama noc_app_settings dengan kolom ambang lama diabaikan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await page.goto("/app/pengaturan");
    await page.evaluate(() =>
      localStorage.setItem(
        "noc_app_settings",
        JSON.stringify({
          ispName: "ISP Uji",
          cpuWarnThreshold: 75,
          cpuCritThreshold: 85,
          opticalWeakDbm: -27,
          opticalCritDbm: -30,
          flappingDropPercent: 40,
          evalWindowSeconds: 30,
        }),
      ),
    );
    await page.reload();
    await openThresholds(page);
    await expectDefaults(page);
    const text = await page.getByRole("tabpanel").innerText();
    expect(text).not.toContain("-27");
    expect(text).not.toContain("-30");
    // Tab Umum tetap membaca nama ISP yang tersimpan.
    await page.getByRole("tab", { name: "Umum" }).click();
    await expect(page.getByLabel("Nama Penyedia Layanan / ISP")).toHaveValue(
      "ISP Uji",
    );
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("server menolak atau tidak terjangkau", () => {
  test("simpan gagal (500): pesan galat, isian tetap, tombol tidak terkunci", async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, cookies);
    await openThresholds(page);
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await page.route("**/api/thresholds", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "INTERNAL_ERROR",
                message: "Database sedang tidak bisa dipakai.",
              },
            }),
          })
        : route.continue(),
    );
    await thresholdInput(page, "cpu").fill("70");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-failed")).toHaveText(
      "Database sedang tidak bisa dipakai.",
    );
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);
    // Draft tidak dibuang dan tombol bisa dipakai lagi.
    await expect(thresholdInput(page, "cpu")).toHaveValue("70");
    await expect(page.getByTestId("rule-changed")).toHaveCount(1);
    await expectBlocked(saveButton(page), false);
    expect(await stored(page)).toBeNull();
    // Server pulih: simpan ulang berhasil.
    await page.unroute("**/api/thresholds");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toContainText(
      "Ambang disimpan di database",
    );
    expect((await storedJson(page)).cpu.threshold).toBe(70);
    await context.close();
  });

  test("server tidak terjangkau: pesan, tidak ada yang berubah", async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, cookies);
    await openThresholds(page);
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await page.route("**/api/thresholds", (route) =>
      route.request().method() === "GET" ? route.continue() : route.abort(),
    );
    await thresholdInput(page, "queue").fill("88");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-failed")).toContainText(
      "Server tidak terjangkau",
    );
    expect(await stored(page)).toBeNull();
    await context.close();
  });

  test("gagal memuat: bawaan tampil, menyimpan tertahan, Coba muat lagi memulihkan", async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, cookies);
    await page.goto("/app/pengaturan");
    await putThresholds(page, { cpu: { threshold: 70, forSeconds: 180 } });
    await page.route("**/api/thresholds", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await openThresholds(page);
    await expect(page.getByTestId("threshold-load-error")).toBeVisible();
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await thresholdInput(page, "cpu").fill("75");
    await expectBlocked(saveButton(page), true);
    await expect(page.getByTestId("save-reason")).toHaveText(
      "Ambang belum termuat dari database",
    );
    await expectBlocked(resetAllButton(page), true);
    await page.unroute("**/api/thresholds");
    await page.getByRole("button", { name: "Coba muat lagi" }).click();
    await expect(page.getByTestId("threshold-load-error")).toHaveCount(0);
    // Isian yang diketik tetap; kolom lain mengikuti database.
    await expect(thresholdInput(page, "cpu")).toHaveValue("75");
    await expectBlocked(saveButton(page), false);
    await context.close();
  });
});

test.describe("akun tanpa izin threshold:manage", () => {
  test("tombol tertahan dengan alasan, dan server menolak PUT", async ({
    browser,
  }) => {
    const signup = await browser.newContext({
      baseURL: "http://localhost:3101",
    });
    const viewer = await signUp(signup, "Petugas Lihat Ambang");
    await signup.close();
    const { context, page, errors } = await contextFor(browser, viewer);
    await openThresholds(page);
    await expect(thresholdInput(page, "cpu")).toHaveValue("85");
    await thresholdInput(page, "cpu").fill("70");
    await expectBlocked(saveButton(page), true);
    await expect(page.getByTestId("save-reason")).toHaveText(
      "Hanya admin yang dapat mengubah ambang batas",
    );
    const response = await page.request.put("/api/thresholds", {
      headers: { origin: "http://localhost:3101" },
      data: { cpu: { threshold: 70, forSeconds: 180 } },
    });
    expect(response.status()).toBe(403);
    expect(await stored(page)).toBeNull();
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("tata letak", () => {
  // Keadaan penuh: isian salah, perubahan, dan catatan hasil simpan sekaligus.
  async function noHorizontalScroll(page: Page) {
    const overflow = await page.evaluate(() =>
      Math.max(
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      ),
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  async function cardsInside(page: Page, width: number) {
    const boxes = await page
      .getByTestId("threshold-card")
      .evaluateAll((items) =>
        items.map((item) => {
          const rect = item.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top };
        }),
      );
    expect(boxes).toHaveLength(5);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
    return boxes;
  }

  test("390 px: satu kolom dan tanpa scroll horizontal di semua keadaan", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: { width: 390, height: 844 },
    });
    await openThresholds(page);
    await noHorizontalScroll(page);
    const boxes = await cardsInside(page, 390);
    // Satu kolom: semua kartu rata kiri yang sama.
    expect(new Set(boxes.map((box) => Math.round(box.left))).size).toBe(1);

    // Dengan galat terpanjang, perubahan, dan pratinjau.
    await thresholdInput(page, "queue").fill("1.000");
    await durationInput(page, "cpu").fill("1800");
    await thresholdInput(page, "optical").fill("-25,3");
    await expect(page.getByTestId("field-error")).toHaveCount(2);
    await noHorizontalScroll(page);
    await cardsInside(page, 390);
    for (const input of await page.getByTestId("threshold-input").all()) {
      const box = (await input.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }

    // Tombol halaman bertumpuk dan terjangkau.
    await expect(saveButton(page)).toBeVisible();
    await expect(cancelButton(page)).toBeVisible();
    await expect(resetAllButton(page)).toBeVisible();
    await noHorizontalScroll(page);

    // Catatan hasil simpan dengan banyak baris.
    await thresholdInput(page, "queue").fill("90");
    await thresholdInput(page, "optical").fill("-27,5");
    await thresholdInput(page, "cpu").fill("60");
    await saveButton(page).click();
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    await noHorizontalScroll(page);
    const noticeBox = (await page
      .getByTestId("threshold-saved")
      .boundingBox())!;
    expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(390);

    // Dialog muat di layar sempit.
    await resetAllButton(page).click();
    const dialogBox = (await page.getByRole("alertdialog").boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
    await context.close();
  });

  // Daftar tab membungkus ke beberapa baris di layar sempit; tingginya dulu
  // tetap satu baris sehingga tab "Billing" dan "Panduan Koneksi" menimpa judul
  // di bawahnya. Setiap tab harus berada di dalam daftarnya dan daftar harus
  // berakhir sebelum judul "Ambang alert".
  for (const width of [390, 768, 1440]) {
    test(`${width} px: tab tidak menimpa judul Ambang alert`, async ({
      browser,
    }) => {
      const { context, page, errors } = await contextFor(browser, cookies, {
        viewport: { width, height: 900 },
      });
      await openThresholds(page);
      const list = (await page.getByRole("tablist").boundingBox())!;
      const tabs = await page.getByRole("tab").all();
      expect(tabs).toHaveLength(8);
      for (const tab of tabs) {
        const box = (await tab.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(list.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(
          list.y + list.height + 1,
        );
      }
      const heading = (await page
        .getByRole("heading", { level: 2, name: "Ambang alert" })
        .boundingBox())!;
      expect(heading.y).toBeGreaterThanOrEqual(list.y + list.height);
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("1440 px: dua kolom dan tanpa scroll horizontal", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies, {
      viewport: { width: 1440, height: 900 },
    });
    await openThresholds(page);
    await noHorizontalScroll(page);
    const boxes = await cardsInside(page, 1440);
    // Dua kartu pertama berdampingan.
    expect(Math.abs(boxes[0].top - boxes[1].top)).toBeLessThan(2);
    expect(boxes[1].left).toBeGreaterThan(boxes[0].left + 100);
    await expect(saveButton(page)).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("kontras teks minimal 4,5 : 1", () => {
  const selectors = [
    '[data-testid="threshold-settings"] h2',
    '[data-testid="threshold-card"] h3',
    '[data-testid="threshold-settings"] label',
    '[data-testid="rule-sentence"]',
    '[data-testid="rule-changed"]',
    '[data-testid="field-error"] span',
    '[data-testid="threshold-unsaved"]',
    '[data-testid="threshold-saved"] p',
    '[data-testid="threshold-saved"] li',
    '[data-testid="save-reason"]',
    '[data-testid="cancel-reason"]',
    '[data-testid="reset-reason"]',
    '[data-testid="rule-reset-reason"]',
    '[data-testid="threshold-honesty"]',
    '[data-testid="threshold-honesty"] strong',
    '[data-testid="threshold-settings"] p.inline-flex',
    '[data-testid="duration-preview"]',
    '[data-testid="threshold-none"]',
    '[data-testid="duration-fixed"] span',
    '[data-testid="threshold-settings"] p[id$="-hint"]',
    '[data-testid="threshold-card"] > div p.text-xs',
  ];

  for (const scheme of ["light", "dark"] as const) {
    test(`tema ${scheme}: teks galat, status, penanda, alasan, dan pemberitahuan`, async ({
      browser,
    }) => {
      const { context, page, errors } = await contextFor(browser, cookies, {
        colorScheme: scheme,
      });
      await openThresholds(page);
      await expect(page.locator("html")).toHaveClass(
        scheme === "dark" ? /dark/ : /^((?!dark).)*$/,
      );
      const measured = new Set<string>();
      const low: string[] = [];
      async function measureAll(state: string) {
        for (const selector of selectors) {
          const results = await measureContrast(page, selector);
          if (results.length > 0) measured.add(selector);
          for (const { text, ratio } of results) {
            if (ratio < 4.5) {
              low.push(
                `${scheme}/${state} ${selector} "${text}" ${ratio.toFixed(2)}`,
              );
            }
          }
        }
      }

      // Keadaan awal: alasan tombol, hint, bawaan.
      await measureAll("awal");
      // Isian salah, perubahan, pratinjau durasi, kalimat tetap, alasan simpan.
      await thresholdInput(page, "queue").fill("abc");
      await thresholdInput(page, "cpu").fill("70");
      await durationInput(page, "cpu").fill("300");
      await expect(page.getByTestId("field-error")).toHaveCount(1);
      await measureAll("galat");
      // Hanya perubahan sah: peringatan belum simpan.
      await thresholdInput(page, "queue").fill("95");
      await expect(page.getByTestId("threshold-unsaved")).toBeVisible();
      await measureAll("belum disimpan");
      // Sesudah simpan: catatan hasil.
      await saveButton(page).click();
      await expect(page.getByTestId("threshold-saved")).toBeVisible();
      await measureAll("tersimpan");
      // Dialog kembalikan semua.
      await resetAllButton(page).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      const dialog = await measureContrast(
        page,
        '[data-slot="alert-dialog-content"] [data-slot="alert-dialog-title"], [data-slot="alert-dialog-description"], [data-slot="alert-dialog-description"] strong',
      );
      expect(dialog.length).toBeGreaterThan(1);
      for (const { text, ratio } of dialog) {
        if (ratio < 4.5)
          low.push(`${scheme}/dialog "${text}" ${ratio.toFixed(2)}`);
      }

      expect(low).toEqual([]);
      // Setiap jenis teks yang penting benar-benar terukur di salah satu keadaan.
      for (const selector of [
        '[data-testid="rule-sentence"]',
        '[data-testid="rule-changed"]',
        '[data-testid="field-error"] span',
        '[data-testid="threshold-unsaved"]',
        '[data-testid="threshold-saved"] p',
        '[data-testid="threshold-saved"] li',
        '[data-testid="save-reason"]',
        '[data-testid="cancel-reason"]',
        '[data-testid="reset-reason"]',
        '[data-testid="rule-reset-reason"]',
        '[data-testid="threshold-honesty"]',
        '[data-testid="threshold-settings"] p.inline-flex',
        '[data-testid="duration-preview"]',
        '[data-testid="threshold-none"]',
        '[data-testid="duration-fixed"] span',
        '[data-testid="threshold-settings"] p[id$="-hint"]',
      ]) {
        expect(measured.has(selector), selector).toBe(true);
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});

// Satu form untuk semua kartu: Enter di isian menyimpan dengan aturan yang sama
// seperti tombol "Simpan ambang", dan tombol lain tidak ikut mengirim.
test.describe("form (papan ketik)", () => {
  test("form tanpa validasi bawaan peramban dan semua isian berupa teks", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    const form = page.getByTestId("threshold-form");
    await expect(form).toHaveAttribute("novalidate", "");
    await expect(form.getByTestId("threshold-card")).toHaveCount(5);
    // Tombol simpan adalah satu-satunya tombol pengirim di dalam form.
    await expect(form.locator('button[type="submit"]')).toHaveCount(1);
    await expect(form.locator('button[type="submit"]')).toHaveText(
      /Simpan ambang/,
    );
    for (const input of await form.locator("input").all()) {
      await expect(input).toHaveAttribute("type", "text");
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  test("Enter di isian menyimpan perubahan", async ({ browser }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("70");
    await thresholdInput(page, "cpu").press("Enter");
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    expect((await storedJson(page)).cpu.threshold).toBe(70);
    await expect(page.getByTestId("threshold-unsaved")).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("Enter di isian durasi lain juga menyimpan semua kartu sekaligus", async ({
    browser,
  }) => {
    const { context, page } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "queue").fill("90");
    await durationInput(page, "offline").fill("45");
    await durationInput(page, "port").press("Enter");
    // Simpan berjalan lewat server; tunggu jawabannya sebelum membaca tabel.
    await expect(page.getByTestId("threshold-saved")).toBeVisible();
    const saved = await storedJson(page);
    expect(saved.queue.threshold).toBe(90);
    expect(saved.offline.forSeconds).toBe(45);
    await context.close();
  });

  test("Enter dengan isian salah tidak menyimpan dan memindahkan fokus ke isian salah pertama", async ({
    browser,
  }) => {
    const { context, page, errors } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "queue").fill("1.000");
    await thresholdInput(page, "cpu").fill("70");
    await durationInput(page, "port").press("Enter");
    expect(await stored(page)).toBeNull();
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);
    await expect(thresholdInput(page, "queue")).toBeFocused();
    await expect(thresholdInput(page, "queue")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(errors).toEqual([]);
    await context.close();
  });

  test("Enter tanpa perubahan tidak menyimpan apa pun", async ({ browser }) => {
    const { context, page } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "queue").press("Enter");
    expect(await stored(page)).toBeNull();
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);
    await context.close();
  });

  test("tombol selain Simpan tidak mengirim form", async ({ browser }) => {
    const { context, page } = await contextFor(browser, cookies);
    await openThresholds(page);
    await thresholdInput(page, "cpu").fill("70");
    // Mengembalikan satu kartu ke bawaan hanya mengisi draft.
    await card(page, "cpu").getByTestId("rule-reset").click();
    await thresholdInput(page, "queue").fill("90");
    await cancelButton(page).click();
    expect(await stored(page)).toBeNull();
    await expect(page.getByTestId("threshold-saved")).toHaveCount(0);
    await context.close();
  });
});
