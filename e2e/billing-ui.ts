import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

// Pembantu untuk spesifikasi layar halaman Billing. Bukan spesifikasi (tanpa
// .spec), jadi aman diimpor.

const headers = { Origin: "http://localhost:3101" };
export type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;

// Satu pendaftaran per berkas spesifikasi: pendaftaran dibatasi sekitar tiga
// per sepuluh detik, jadi yang kena batas menunggu lalu mencoba sekali lagi.
export async function signUp(
  context: BrowserContext,
  name: string,
): Promise<Cookies> {
  const page = await context.newPage();
  const data = {
    name,
    email: `billing-${randomUUID()}@example.com`,
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
  return context.cookies();
}

export interface ContextOptions {
  colorScheme?: "light" | "dark";
  viewport?: { width: number; height: number };
  timezoneId?: string;
  reducedMotion?: "reduce" | "no-preference";
}

export async function contextFor(
  browser: Browser,
  cookies: Cookies,
  options: ContextOptions = {},
) {
  const context = await browser.newContext({
    baseURL: "http://localhost:3101",
    timezoneId: "Asia/Jakarta",
    colorScheme: "light",
    ...options,
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  // Galat halaman dikumpulkan di tiap pengujian; yang diharapkan kosong.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { context, page, errors };
}

// Halaman Billing pada detik tertentu; jamnya tidak maju sendiri.
export async function openBillingAt(page: Page, seconds: number) {
  await page.clock.install({ time: seconds * 1000 });
  await page.clock.setFixedTime(seconds * 1000);
  await page.goto("/app/billing");
  await expect(page.getByTestId("billing-sync")).toHaveAttribute(
    "data-last-status",
    /.+/,
  );
}

// Jam sampai detik, dengan tanggal bila bukan hari yang sama dengan `now`
// (menurut zona waktu yang dipilih); ditulis lain dari kodenya sendiri.
export function timeFormatter(timeZone: string) {
  const clock = new Intl.DateTimeFormat("id-ID", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const day = new Intl.DateTimeFormat("id-ID", {
    timeZone,
    day: "numeric",
    month: "short",
  });
  return (seconds: number, now: number) => {
    const at = new Date(seconds * 1000);
    const sameDay = day.format(at) === day.format(new Date(now * 1000));
    return sameDay
      ? clock.format(at)
      : `${day.format(at)}, ${clock.format(at)}`;
  };
}

export const jakartaTime = timeFormatter("Asia/Jakarta");

export const isoTime = (seconds: number) =>
  new Date(seconds * 1000).toISOString();

export async function secondsNow(page: Page) {
  return page.evaluate(() => Math.floor(Date.now() / 1000));
}

// Memajukan jam palsu halaman sampai milidetik mutlak `ms`.
export async function advanceTo(page: Page, ms: number) {
  const now = await page.evaluate(() => Date.now());
  expect(ms).toBeGreaterThanOrEqual(now);
  await page.clock.runFor(ms - now);
}

export interface RowText {
  id: string | null;
  status: string | null;
  match: string | null;
  name: string | null;
  pppoe: string | null;
  router: string | null;
  badge: string | null;
  invoice: string | null;
  label: string | null;
  note: string | null;
}

// Isi tabel status tagihan seperti yang terbaca di layar, satu objek per baris.
export function readCustomerRows(rows: Locator): Promise<RowText[]> {
  return rows.evaluateAll((items) =>
    items.map((row) => {
      const cells = row.querySelectorAll("td");
      const match = cells[4].firstElementChild!;
      return {
        id: row.getAttribute("data-customer-id"),
        status: row.getAttribute("data-status"),
        match: row.getAttribute("data-match"),
        name: cells[0].children[0].textContent,
        pppoe: cells[0].children[1].textContent,
        router: cells[1].textContent,
        badge: cells[2].textContent,
        invoice: cells[3].textContent,
        label: match.children[0].textContent,
        note: match.children[1]?.textContent ?? null,
      };
    }),
  );
}

// Mencari selisih pertama antara dua daftar objek, tanpa laporan galat yang
// besar: teks tentang elemen pertama yang berbeda, atau null bila sama.
export function firstDifference(
  actual: readonly unknown[],
  expected: readonly unknown[],
) {
  if (actual.length !== expected.length) {
    return `panjang ${actual.length} != ${expected.length}`;
  }
  for (let i = 0; i < actual.length; i += 1) {
    const left = JSON.stringify(actual[i]);
    const right = JSON.stringify(expected[i]);
    if (left !== right) return `elemen ${i}: ${left} != ${right}`;
  }
  return null;
}

export interface ContrastResult {
  text: string;
  ratio: number;
}

// Kontras tulisan terhadap latarnya (WCAG: 4,5 : 1 untuk teks biasa). Latar
// dihitung dengan menumpuk warna latar semua leluhur dari akar sampai elemen,
// termasuk yang bening (mis. bg-success/10), lalu warna tulisan di atasnya.
export function measureContrast(
  page: Page,
  selector: string,
): Promise<ContrastResult[]> {
  return page.evaluate((query) => {
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
    return Array.from(document.querySelectorAll(query)).flatMap((el) => {
      const own = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      // Hanya elemen yang memuat tulisan sendiri.
      if (!own) return [];
      const layers: string[] = ["#ffffff"];
      for (let node: Element | null = el; node; node = node.parentElement) {
        layers.splice(1, 0, getComputedStyle(node).backgroundColor);
      }
      const background = paint(layers);
      const text = paint([...layers, getComputedStyle(el).color]);
      const [hi, lo] = [luminance(text), luminance(background)].sort(
        (a, b) => b - a,
      );
      return [{ text: own.slice(0, 40), ratio: (hi + 0.05) / (lo + 0.05) }];
    });
  }, selector);
}
