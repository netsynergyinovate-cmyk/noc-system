import "server-only";
import { db } from "@/db";
import { effectiveBillingStatus } from "@/lib/effective-billing";
import {
  runsnetCustomers,
  runsnetInvoices,
  runsnetPayments,
  runsnetSyncLogs,
  customers,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

const RUNSNET_URL = process.env.RUNSNET_URL || "https://app.runsnet.id";
const RUNSNET_USERNAME = process.env.RUNSNET_USERNAME || "netsynergyinovate@yahoo.com";
const RUNSNET_PASSWORD = process.env.RUNSNET_PASSWORD || "netsynergyinovate@yahoo.com";
const RUNSNET_TARGET = process.env.RUNSNET_TARGET || "ID00000000024";
// Batas waktu pengambilan IP/MAC saat sinkron; sisanya dilewati supaya total sinkron tetap di bawah batas proxy.
const SESSION_ENRICH_BUDGET_MS = 25_000;

function stripHtml(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function parseCurrency(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function extractAttr(raw: unknown, attr: string): string | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(new RegExp(`${attr}=["']([^"']*)["']`, "i"));
  return match ? match[1] : null;
}

function buildDtParams(start = 0, length = 100, search = "") {
  const p = new URLSearchParams();
  p.append("draw", "1");
  p.append("start", String(start));
  p.append("length", String(length));
  p.append("search[value]", search);
  p.append("search[regex]", "false");
  p.append("order[0][column]", "1");
  p.append("order[0][dir]", "desc");

  for (let i = 0; i < 12; i++) {
    p.append(`columns[${i}][data]`, String(i));
    p.append(`columns[${i}][name]`, "");
    p.append(`columns[${i}][searchable]`, "true");
    p.append(`columns[${i}][orderable]`, i === 0 || i === 11 ? "false" : "true");
    p.append(`columns[${i}][search][value]`, "");
    p.append(`columns[${i}][search][regex]`, "false");
  }
  return p;
}

// Jaringan ke RunsNet kadang putus sesaat (mis. UND_ERR_CONNECT_TIMEOUT): beri batas waktu dan ulangi, jangan
// gagalkan seluruh sinkron karena satu paket yang hilang.
async function rfetch(url: string, init?: RequestInit): Promise<Response> {
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (res.status < 502 || res.status > 504 || attempt === attempts) return res;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  const cause = (lastError as { cause?: { code?: string } } | undefined)?.cause?.code;
  throw new Error(`Tidak dapat menghubungi RunsNet setelah ${attempts} percobaan${cause ? ` (${cause})` : ""}. Periksa koneksi internet server.`);
}

// Semua halaman harus terbaca; hasil sebagian tidak boleh dianggap sukses.
function assertComplete(label: string, start: number, total: number) {
  if (Number.isFinite(total) && start < total) {
    throw new Error(`Data ${label} RunsNet tidak lengkap: ${start} dari ${total} baris terbaca.`);
  }
}

// Rentang pembayaran dibuka lebar (format MM/DD/YYYY): dari awal pencatatan sampai setahun ke depan.
const PAYMENT_FROM = "01/01/2020";
function paymentTo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Autentikasi ke RunsNet dan dapatkan session cookie aktif.
 */
export async function loginRunsnet(): Promise<string> {
  const getLogin = await rfetch(`${RUNSNET_URL}/login.php`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  const cookies = getLogin.headers.get("set-cookie") || "";
  const phpsessid = (cookies.match(/PHPSESSID=([^;]+)/) || [])[1] || "";

  const loginParams = new URLSearchParams();
  loginParams.append("username", RUNSNET_USERNAME);
  loginParams.append("password", RUNSNET_PASSWORD);
  loginParams.append("simpan", "");

  const postLogin = await rfetch(`${RUNSNET_URL}/view/control/bagan_login.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": `PHPSESSID=${phpsessid}`,
      "Referer": `${RUNSNET_URL}/login.php`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: loginParams.toString(),
  });

  const postCookies = postLogin.headers.get("set-cookie") || "";
  const finalSession = (postCookies.match(/PHPSESSID=([^;]+)/) || [])[1] || phpsessid;

  if (!finalSession) {
    throw new Error("Gagal mendapatkan session login dari RunsNet");
  }

  return finalSession;
}

export interface ParsedCustomer {
  custId: string;
  name: string;
  serviceProfile: string;
  type: string;
  spkDate: string;
  activeDate: string;
  expiredDate: string;
  connectivity: string;
  status: string;
  rawJson: string;
}

export interface ParsedInvoice {
  invoiceCode: string;
  custId: string;
  custName: string;
  periode: string;
  dueDate: string;
  amount: number;
  remainingAmount: number;
  agent: string;
  status: "unpaid" | "paid" | "partial";
  fileUrl: string | null;
}

export interface ParsedPayment {
  paymentCode: string;
  invoiceCode: string | null;
  custId: string;
  custName: string;
  periode: string;
  payDate: string;
  amount: number;
  method: string;
  agent: string;
  operator: string;
}

/**
 * Menarik semua pelanggan dari RunsNet dengan pagination lengkap.
 */
export async function scrapeRunsnetCustomers(session: string): Promise<ParsedCustomer[]> {
  const result: ParsedCustomer[] = [];
  let start = 0;
  const length = 100;
  let total = Infinity;

  while (start < total) {
    const url = `${RUNSNET_URL}/view/model/previewc/query/pelanggan.php?data1=&data2=&data3=&data4=&target=${RUNSNET_TARGET}&data6=`;
    const res = await rfetch(url, {
      method: "POST",
      headers: {
        "Cookie": `PHPSESSID=${session}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: buildDtParams(start, length).toString(),
    });

    if (!res.ok) {
      throw new Error(`Gagal memuat pelanggan RunsNet HTTP ${res.status}`);
    }

    const json = (await res.json()) as { recordsFiltered: number; data: (string | null)[][] };
    total = json.recordsFiltered || 0;

    if (!json.data || json.data.length === 0) break;

    for (const row of json.data) {
      const custId = stripHtml(row[1]) || extractAttr(row[0], "value") || "";
      if (!custId) continue;

      const name = stripHtml(row[2]) || custId;
      const serviceProfile = stripHtml(row[3]);
      const type = stripHtml(row[5]);
      const spkDate = stripHtml(row[6]);
      const activeDate = stripHtml(row[7]);
      const expiredDate = stripHtml(row[8]);
      const connectivity = stripHtml(row[9]);
      const status = stripHtml(row[10]) || "Active";

      result.push({
        custId,
        name,
        serviceProfile,
        type,
        spkDate,
        activeDate,
        expiredDate,
        connectivity,
        status,
        rawJson: JSON.stringify(row),
      });
    }

    start += length;
  }

  assertComplete("pelanggan", start, total);
  return result;
}

/**
 * Menarik semua invoice dari RunsNet dengan pagination lengkap.
 */
export async function scrapeRunsnetInvoices(session: string, maxPages = 200): Promise<ParsedInvoice[]> {
  const result: ParsedInvoice[] = [];
  let start = 0;
  const length = 100;
  let total = Infinity;
  let pageCount = 0;

  while (start < total && pageCount < maxPages) {
    pageCount++;
    const url = `${RUNSNET_URL}/view/model/previewc/query/invoice.php?data1=&data2=&data3=&data4=&data5=&target=${RUNSNET_TARGET}`;
    const res = await rfetch(url, {
      method: "POST",
      headers: {
        "Cookie": `PHPSESSID=${session}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: buildDtParams(start, length).toString(),
    });

    if (!res.ok) {
      throw new Error(`Gagal memuat invoice RunsNet HTTP ${res.status}`);
    }

    const json = (await res.json()) as { recordsFiltered: number; data: (string | null)[][] };
    total = json.recordsFiltered || 0;

    if (!json.data || json.data.length === 0) break;

    for (const row of json.data) {
      const invoiceCode = stripHtml(row[1]) || extractAttr(row[0], "value") || "";
      if (!invoiceCode) continue;

      const custId = stripHtml(row[2]);
      const custName = stripHtml(row[3]);
      const periode = stripHtml(row[4]);
      const dueDate = stripHtml(row[5]);
      const amount = parseCurrency(row[6]);
      const remainingAmount = parseCurrency(row[7]);
      const agent = stripHtml(row[8]);
      const fileUrl = extractAttr(row[10], "href");

      const status: "unpaid" | "paid" | "partial" =
        remainingAmount <= 0 ? "paid" : remainingAmount < amount ? "partial" : "unpaid";

      result.push({
        invoiceCode,
        custId,
        custName,
        periode,
        dueDate,
        amount,
        remainingAmount,
        agent,
        status,
        fileUrl,
      });
    }

    start += length;
  }

  assertComplete("invoice", start, total);
  return result;
}

/**
 * Menarik riwayat payment dari RunsNet dengan rentang tanggal luas.
 */
export async function scrapeRunsnetPayments(session: string, maxPages = 200): Promise<ParsedPayment[]> {
  const result: ParsedPayment[] = [];
  let start = 0;
  const length = 100;
  let total = Infinity;
  let pageCount = 0;

  while (start < total && pageCount < maxPages) {
    pageCount++;
    const url = `${RUNSNET_URL}/view/model/previewc/query/payment.php?data1=${PAYMENT_FROM}&data2=${paymentTo()}&data4=&target=${RUNSNET_TARGET}`;
    const res = await rfetch(url, {
      method: "POST",
      headers: {
        "Cookie": `PHPSESSID=${session}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: buildDtParams(start, length).toString(),
    });

    if (!res.ok) {
      throw new Error(`Gagal memuat payment RunsNet HTTP ${res.status}`);
    }

    const json = (await res.json()) as { recordsFiltered: number; data: (string | null)[][] };
    total = json.recordsFiltered || 0;

    if (!json.data || json.data.length === 0) break;

    for (const row of json.data) {
      const paymentCode = stripHtml(row[1]) || extractAttr(row[0], "value") || "";
      if (!paymentCode) continue;

      const invoiceCode = stripHtml(row[2]) || null;
      const custId = stripHtml(row[3]);
      const custName = stripHtml(row[4]);
      const periode = stripHtml(row[5]);
      const payDate = stripHtml(row[6]);
      const amount = parseCurrency(row[7]);
      const method = stripHtml(row[8]);
      const agent = stripHtml(row[9]);
      const operator = stripHtml(row[10]);

      result.push({
        paymentCode,
        invoiceCode,
        custId,
        custName,
        periode,
        payDate,
        amount,
        method,
        agent,
        operator,
      });
    }

    start += length;
  }

  assertComplete("pembayaran", start, total);
  return result;
}

/**
 * Eksekusi Sinkronisasi Penuh RunsNet ke Database PostgreSQL.
 */
export async function runRunsnetSync() {
  const [log] = await db
    .insert(runsnetSyncLogs)
    .values({
      status: "running",
    })
    .returning();

  try {
    const session = await loginRunsnet();

    // 1. Ambil seluruh data pelanggan
    const customersData = await scrapeRunsnetCustomers(session);

    // 2. Ambil invoice
    const invoicesData = await scrapeRunsnetInvoices(session);

    // 3. Ambil payment
    const paymentsData = await scrapeRunsnetPayments(session);

    // 4. Simpan Pelanggan ke runsnet_customers (upsert idempoten)
    for (const c of customersData) {
      await db
        .insert(runsnetCustomers)
        .values({
          custId: c.custId,
          name: c.name,
          serviceProfile: c.serviceProfile,
          type: c.type,
          spkDate: c.spkDate,
          activeDate: c.activeDate,
          expiredDate: c.expiredDate,
          connectivity: c.connectivity,
          status: c.status,
          rawJson: c.rawJson,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: runsnetCustomers.custId,
          set: {
            name: c.name,
            serviceProfile: c.serviceProfile,
            type: c.type,
            spkDate: c.spkDate,
            activeDate: c.activeDate,
            expiredDate: c.expiredDate,
            connectivity: c.connectivity,
            status: c.status,
            rawJson: c.rawJson,
            syncedAt: new Date(),
          },
        });

      // Sinkronkan nama dan billing status ke tabel customers utama NOC
      const billingStatusVal = c.status.toLowerCase() === "isolir" ? "isolir" : "lunas";
      const possibleUsernames = [c.custId, `${c.custId}@runsnet.id`];

      for (const uname of possibleUsernames) {
        await db
          .update(customers)
          .set({
            name: c.name,
            billingStatus: billingStatusVal,
            lastUpdatedAt: new Date(),
          })
          .where(eq(customers.pppoeUsername, uname));
      }
    }

    // 5. Simpan Invoice ke runsnet_invoices (upsert idempoten)
    for (const inv of invoicesData) {
      await db
        .insert(runsnetInvoices)
        .values({
          invoiceCode: inv.invoiceCode,
          custId: inv.custId,
          custName: inv.custName,
          periode: inv.periode,
          dueDate: inv.dueDate,
          amount: inv.amount,
          remainingAmount: inv.remainingAmount,
          agent: inv.agent,
          status: inv.status,
          fileUrl: inv.fileUrl,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: runsnetInvoices.invoiceCode,
          set: {
            custName: inv.custName,
            periode: inv.periode,
            dueDate: inv.dueDate,
            amount: inv.amount,
            remainingAmount: inv.remainingAmount,
            agent: inv.agent,
            status: inv.status,
            fileUrl: inv.fileUrl,
            syncedAt: new Date(),
          },
        });
    }

    // 6. Simpan Payment ke runsnet_payments (upsert idempoten)
    for (const pay of paymentsData) {
      await db
        .insert(runsnetPayments)
        .values({
          paymentCode: pay.paymentCode,
          invoiceCode: pay.invoiceCode,
          custId: pay.custId,
          custName: pay.custName,
          periode: pay.periode,
          payDate: pay.payDate,
          amount: pay.amount,
          method: pay.method,
          agent: pay.agent,
          operator: pay.operator,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: runsnetPayments.paymentCode,
          set: {
            invoiceCode: pay.invoiceCode,
            custName: pay.custName,
            periode: pay.periode,
            payDate: pay.payDate,
            amount: pay.amount,
            method: pay.method,
            agent: pay.agent,
            operator: pay.operator,
            syncedAt: new Date(),
          },
        });
    }

    // IP dan MAC sesi terakhir tiap pelanggan dari detail RunsNet. Pelanggan yang sedang offline sering tetap punya
    // sesi terakhir, tapi sebagian lain membuat RunsNet menunggu perangkat sampai habis waktu (10 dtk, lalu dilewati).
    // Terakhir dan best-effort: kegagalan di sini tidak boleh merusak data tagihan yang sudah tersimpan, dan nilai
    // lama dipertahankan bila RunsNet gagal menjawab.
    // Dibatasi waktu (reverse proxy biasanya memutus permintaan sekitar 60 dtk): yang terhubung didahulukan, dan
    // batch baru tidak dimulai setelah batas habis; sisanya tetap memakai nilai lama dan dihitung di "n dari m".
    let sessionRead = 0;
    const ordered = [...customersData].sort(
      (a, b) => Number(b.connectivity.toLowerCase() === "terhubung") - Number(a.connectivity.toLowerCase() === "terhubung"),
    );
    const deadline = Date.now() + SESSION_ENRICH_BUDGET_MS;
    for (let i = 0; i < ordered.length && Date.now() < deadline; i += 6) {
      await Promise.all(
        ordered.slice(i, i + 6).map(async (c) => {
          try {
            const live = await fetchLiveWith(session, c.custId);
            if (live === null || live === "expired") return;
            await db
              .update(runsnetCustomers)
              .set({ ipAddress: live.ipAddress, macAddress: live.macAddress, ipSyncedAt: new Date() })
              .where(eq(runsnetCustomers.custId, c.custId));
            sessionRead++;
          } catch (err) {
            console.warn("[RUNSNET SYNC] IP/MAC gagal diambil", c.custId, err instanceof Error ? err.message : err);
          }
        }),
      );
    }
    // Update log sukses
    await db
      .update(runsnetSyncLogs)
      .set({
        status: "success",
        customersCount: customersData.length,
        invoicesCount: invoicesData.length,
        paymentsCount: paymentsData.length,
        completedAt: new Date(),
      })
      .where(eq(runsnetSyncLogs.id, log.id));

    return {
      ok: true,
      customersCount: customersData.length,
      invoicesCount: invoicesData.length,
      paymentsCount: paymentsData.length,
      sessionRead,
      sessionTotal: customersData.length,
    };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    await db
      .update(runsnetSyncLogs)
      .set({
        status: "error",
        errorMessage: err,
        completedAt: new Date(),
      })
      .where(eq(runsnetSyncLogs.id, log.id));

    throw error;
  }
}

export interface DelinquentCustomerItem {
  custId: string;
  custName: string;
  serviceProfile: string | null;
  status: string; // Active, Isolir, etc.
  connectivity: string | null;
  unpaidCount: number;
  totalDebt: number;
  oldestDueDate: string | null;
  invoices: {
    invoiceCode: string;
    periode: string | null;
    dueDate: string | null;
    remainingAmount: number;
    amount: number;
  }[];
}

/**
 * Ringkasan data billing RunsNet dari PostgreSQL dengan filter periode per-bulan.
 */
export async function getRunsnetOverview(selectedPeriode?: string) {
  // 1. Dapatkan daftar seluruh periode bulan yang tersedia di database
  const periodRows = await db
    .select({
      period: sql<string>`DISTINCT substring(${runsnetInvoices.periode}, 1, 7)`,
    })
    .from(runsnetInvoices)
    .where(sql`${runsnetInvoices.periode} is not null and length(${runsnetInvoices.periode}) >= 7`)
    .orderBy(sql`substring(${runsnetInvoices.periode}, 1, 7) DESC`);

  const availablePeriods = periodRows.map((r) => r.period).filter(Boolean);
  const currentPeriod = selectedPeriode && selectedPeriode !== "all" ? selectedPeriode : null;

  // 2. Data Pelanggan Keseluruhan
  const [totalCustRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runsnetCustomers);

  const [activeCustRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runsnetCustomers)
    .where(eq(runsnetCustomers.status, "Active"));

  const [isolirCustRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(runsnetCustomers)
    .where(eq(runsnetCustomers.status, "Isolir"));

  // 3. Data Invoice (dengan filter bulan jika dipilih)
  const invoiceWhereClause = currentPeriod
    ? sql`${runsnetInvoices.periode} LIKE ${currentPeriod + "%"}`
    : sql`1=1`;

  const [invoicesSummary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      totalAmount: sql<number>`coalesce(sum(${runsnetInvoices.amount}), 0)::float`,
      unpaidAmount: sql<number>`coalesce(sum(${runsnetInvoices.remainingAmount}), 0)::float`,
      unpaidCount: sql<number>`count(*) filter (where ${runsnetInvoices.remainingAmount} > 0)::int`,
      paidCount: sql<number>`count(*) filter (where ${runsnetInvoices.remainingAmount} <= 0)::int`,
    })
    .from(runsnetInvoices)
    .where(invoiceWhereClause);

  // 4. Data Payment (dengan filter bulan jika dipilih)
  const paymentWhereClause = currentPeriod
    ? sql`${runsnetPayments.payDate} LIKE ${currentPeriod + "%"}`
    : sql`1=1`;

  const [paymentsSummary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      totalPaid: sql<number>`coalesce(sum(${runsnetPayments.amount}), 0)::float`,
    })
    .from(runsnetPayments)
    .where(paymentWhereClause);

  // 5. Hitung jumlah pelanggan yang menunggak
  const [delinquentCountRow] = await db
    .select({
      count: sql<number>`count(distinct ${runsnetInvoices.custId})::int`,
    })
    .from(runsnetInvoices)
    .where(sql`${runsnetInvoices.remainingAmount} > 0 and ${invoiceWhereClause}`);

  const [lastSync] = await db
    .select()
    .from(runsnetSyncLogs)
    .orderBy(desc(runsnetSyncLogs.startedAt))
    .limit(1);

  return {
    availablePeriods,
    selectedPeriod: currentPeriod || "all",
    customers: {
      total: totalCustRow?.count ?? 0,
      active: activeCustRow?.count ?? 0,
      isolir: isolirCustRow?.count ?? 0,
    },
    invoices: {
      total: invoicesSummary?.count ?? 0,
      totalAmount: invoicesSummary?.totalAmount ?? 0,
      unpaidAmount: invoicesSummary?.unpaidAmount ?? 0,
      unpaidCount: invoicesSummary?.unpaidCount ?? 0,
      paidCount: invoicesSummary?.paidCount ?? 0,
    },
    payments: {
      total: paymentsSummary?.count ?? 0,
      totalPaid: paymentsSummary?.totalPaid ?? 0,
    },
    delinquentCustomersCount: delinquentCountRow?.count ?? 0,
    lastSync: lastSync || null,
  };
}

/**
 * Mengambil daftar Pelanggan yang Menunggak (memiliki tagihan remaining_amount > 0).
 */
export async function getDelinquentCustomers(periode?: string) {
  const periodFilter =
    periode && periode !== "all"
      ? sql`and i.periode LIKE ${periode + "%"}`
      : sql``;

  const rawRows = (await db.execute(sql`
    SELECT 
      i.cust_id as "custId",
      i.cust_name as "custName",
      c.service_profile as "serviceProfile",
      coalesce(c.status, 'Unknown') as "status",
      c.connectivity as "connectivity",
      count(i.id)::int as "unpaidCount",
      sum(i.remaining_amount)::float as "totalDebt",
      min(i.due_date) as "oldestDueDate",
      json_agg(json_build_object(
        'invoiceCode', i.invoice_code,
        'periode', i.periode,
        'dueDate', i.due_date,
        'amount', i.amount::float,
        'remainingAmount', i.remaining_amount::float
      ) ORDER BY i.due_date ASC) as "invoices"
    FROM runsnet_invoices i
    LEFT JOIN runsnet_customers c ON c.cust_id = i.cust_id
    WHERE i.remaining_amount > 0 ${periodFilter}
    GROUP BY i.cust_id, i.cust_name, c.service_profile, c.status, c.connectivity
    ORDER BY "totalDebt" DESC, "unpaidCount" DESC;
  `)) as unknown as { rows: DelinquentCustomerItem[] };

  return rawRows.rows || [];
}

/** Info sesi layanan satu pelanggan dari RunsNet (halaman detail aplikasi billing). Sengaja hanya kolom ini. */
export interface RunsnetCustomerLive {
  ipAddress: string | null;
  macAddress: string | null;
  lastLogin: string | null;
  lastLogout: string | null;
  sessionTime: string | null;
  statusLayanan: string | null;
  uploadUsage: string | null;
  downloadUsage: string | null;
}

/**
 * Mengurai HTML detail pelanggan RunsNet ("label: nilai"). Halaman itu juga memuat kata sandi PPPoE, NIK, dan
 * kontak; semuanya sengaja dibuang di sini dan tidak pernah disimpan atau dikirim ke browser.
 */
export function parseCustomerLive(html: string): RunsnetCustomerLive {
  const fields = new Map<string, string>();
  for (const m of html.matchAll(/<b>([^<]+)<\/b>\s*<\/div>\s*<div[^>]*>\s*:?\s*([\s\S]*?)<\/div>/g)) {
    fields.set(m[1].trim().toLowerCase(), stripHtml(m[2]).replace(/^:\s*/, ""));
  }
  const pick = (test: (label: string) => boolean) => {
    for (const [label, value] of fields) if (test(label) && value) return value;
    return null;
  };
  return {
    ipAddress: pick((l) => l === "ip address"),
    macAddress: pick((l) => l === "mac address"),
    lastLogin: pick((l) => l === "last login"),
    lastLogout: pick((l) => l === "last logout"),
    sessionTime: pick((l) => l === "session time"),
    statusLayanan: pick((l) => l === "status layanan"),
    uploadUsage: pick((l) => /upload/.test(l)),
    downloadUsage: pick((l) => /download/.test(l)),
  };
}

// Sesi RunsNet dipakai ulang beberapa menit supaya tiap buka detail tidak login lagi.
let liveSession: { id: string; at: number } | null = null;
const LIVE_SESSION_MS = 10 * 60_000;

/** null = RunsNet tidak menjawab/ pelanggan offline; "expired" = jawaban tanpa isi detail (sesi kedaluwarsa). */
async function fetchLiveWith(session: string, custId: string): Promise<RunsnetCustomerLive | null | "expired"> {
  try {
    const res = await fetch(`${RUNSNET_URL}/view/model/previewc/fungsi/pelanggan_detail.php?data1=${encodeURIComponent(custId)}`, {
      method: "POST",
      headers: {
        Cookie: `PHPSESSID=${session}`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json: { data?: { data_a?: string } } | null = await res.json().catch(() => null);
    const html = json?.data?.data_a;
    return typeof html === "string" && html.includes("IP Address") ? parseCustomerLive(html) : "expired";
  } catch {
    return null;
  }
}

/**
 * Info sesi pelanggan langsung dari RunsNet. null bila RunsNet tidak menjawab (mis. pelanggan offline: server
 * RunsNet menunggu perangkat sampai habis waktu), jadi pemanggil tampil "tidak tersedia" dan bukan galat.
 */
export async function getRunsnetCustomerLive(custId: string): Promise<RunsnetCustomerLive | null> {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(custId)) throw new Error("ID pelanggan tidak valid.");
  // Hanya pelanggan yang sudah ada di database: endpoint ini bukan proxy bebas ke RunsNet dengan akun bersama.
  const [known] = await db.select({ id: runsnetCustomers.custId }).from(runsnetCustomers).where(eq(runsnetCustomers.custId, custId)).limit(1);
  if (!known) return null;
  for (const fresh of [false, true]) {
    if (fresh || !liveSession || Date.now() - liveSession.at > LIVE_SESSION_MS) {
      liveSession = { id: await loginRunsnet(), at: Date.now() };
    }
    const live = await fetchLiveWith(liveSession.id, custId);
    if (live !== "expired") return live;
    // Jawaban tanpa isi detail: kemungkinan sesi kedaluwarsa; coba sekali lagi dengan login baru.
  }
  return null;
}

/**
 * Mengambil detail lengkap satu pelanggan (profil, invoice, dan riwayat bayar).
 */
export async function getRunsnetCustomerDetail(custId: string) {
  const [customer] = await db
    .select()
    .from(runsnetCustomers)
    .where(eq(runsnetCustomers.custId, custId));

  const invoices = await db
    .select()
    .from(runsnetInvoices)
    .where(eq(runsnetInvoices.custId, custId))
    .orderBy(desc(runsnetInvoices.periode));

  const payments = await db
    .select()
    .from(runsnetPayments)
    .where(eq(runsnetPayments.custId, custId))
    .orderBy(desc(runsnetPayments.payDate));

  return {
    customer: customer || null,
    invoices,
    payments,
  };
}

/**
 * Mengambil daftar data pelanggan RunsNet.
 */
export async function getRunsnetCustomers(limit = 100, offset = 0, statusFilter?: string) {
  const query = db.select().from(runsnetCustomers);
  if (statusFilter && statusFilter !== "all") {
    query.where(eq(runsnetCustomers.status, statusFilter));
  }
  return await query.orderBy(desc(runsnetCustomers.syncedAt)).limit(limit).offset(offset);
}

/**
 * Mengambil daftar invoice RunsNet dengan filter bulan dan status bayar.
 */
export async function getRunsnetInvoices(
  limit = 100,
  offset = 0,
  periode?: string,
  statusFilter?: "all" | "unpaid" | "paid",
) {
  let where = sql`1=1`;

  if (periode && periode !== "all") {
    where = sql`${where} and ${runsnetInvoices.periode} LIKE ${periode + "%"}`;
  }

  if (statusFilter === "unpaid") {
    where = sql`${where} and ${runsnetInvoices.remainingAmount} > 0`;
  } else if (statusFilter === "paid") {
    where = sql`${where} and ${runsnetInvoices.remainingAmount} <= 0`;
  }

  return await db
    .select()
    .from(runsnetInvoices)
    .where(where)
    .orderBy(desc(runsnetInvoices.periode), desc(runsnetInvoices.invoiceCode))
    .limit(limit)
    .offset(offset);
}

/**
 * Mengambil daftar payment RunsNet dengan filter bulan.
 */
export async function getRunsnetPayments(limit = 100, offset = 0, periode?: string) {
  let where = sql`1=1`;

  if (periode && periode !== "all") {
    where = sql`${where} and ${runsnetPayments.payDate} LIKE ${periode + "%"}`;
  }

  return await db
    .select()
    .from(runsnetPayments)
    .where(where)
    .orderBy(desc(runsnetPayments.payDate), desc(runsnetPayments.paymentCode))
    .limit(limit)
    .offset(offset);
}

export interface CustomerNameSyncResult {
  success: boolean;
  totalCustomers: number;
  matchedCount: number;
  updatedCount: number;
  unmatchedCount: number;
  unmatched: Array<{ id: string; pppoeUsername: string; currentName: string }>;
  updatedCustomers: Array<{
    id: string;
    pppoeUsername: string;
    oldName: string;
    newName: string;
    billingStatus: string;
  }>;
  message: string;
  syncedAt: string;
}

/**
 * Mencocokkan ID pelanggan dari PPPoE username dengan data RunsNet Billing
 * dan memperbarui kolom nama serta status billing pada tabel customers.
 * Pencocokan menggunakan split_part(pppoe_username, '@', 1) = cust_id.
 */
export async function syncCustomerNamesFromBilling(options?: {
  pullFresh?: boolean;
}): Promise<CustomerNameSyncResult> {
  // 1. Jika pullFresh diminta atau tabel runsnet_customers kosong, tarik data segar dari RunsNet
  if (options?.pullFresh) {
    const session = await loginRunsnet();
    const freshCustomers = await scrapeRunsnetCustomers(session);
    for (const c of freshCustomers) {
      await db
        .insert(runsnetCustomers)
        .values({
          custId: c.custId,
          name: c.name,
          serviceProfile: c.serviceProfile,
          type: c.type,
          spkDate: c.spkDate,
          activeDate: c.activeDate,
          expiredDate: c.expiredDate,
          connectivity: c.connectivity,
          status: c.status,
          rawJson: c.rawJson,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: runsnetCustomers.custId,
          set: {
            name: c.name,
            serviceProfile: c.serviceProfile,
            type: c.type,
            spkDate: c.spkDate,
            activeDate: c.activeDate,
            expiredDate: c.expiredDate,
            connectivity: c.connectivity,
            status: c.status,
            rawJson: c.rawJson,
            syncedAt: new Date(),
          },
        });
    }
  }

  // 2. Ambil seluruh data core customers dan runsnet_customers dari PostgreSQL
  const allCoreCustomers = await db.select().from(customers);
  const allRunsnetCustomers = await db.select().from(runsnetCustomers);

  // Buat lookup map dari runsnet_customers berdasarkan custId
  const runsnetMap = new Map(allRunsnetCustomers.map((rc) => [rc.custId, rc]));

  let matchedCount = 0;
  let updatedCount = 0;
  const unmatched: Array<{ id: string; pppoeUsername: string; currentName: string }> = [];
  const updatedCustomers: Array<{
    id: string;
    pppoeUsername: string;
    oldName: string;
    newName: string;
    billingStatus: string;
  }> = [];

  for (const c of allCoreCustomers) {
    // Ekstraksi ID pelanggan dari pppoe_username (sebelum tanda @ atau string lengkap)
    const extractedId = c.pppoeUsername.includes("@")
      ? c.pppoeUsername.split("@")[0].trim()
      : c.pppoeUsername.trim();

    const matchedRunsnet = runsnetMap.get(extractedId);

    if (matchedRunsnet && matchedRunsnet.name) {
      matchedCount++;
      const newStatus = matchedRunsnet.status?.toLowerCase() === "isolir" ? "isolir" : "lunas";
      // Yang ditampilkan ke dasbor: router dulu, billing cadangan (billing_status tetap data billing).
      const shown = effectiveBillingStatus(c.isolirRouter, newStatus);
      const isNameDiff = c.name !== matchedRunsnet.name;
      const isStatusDiff = c.billingStatus !== newStatus;

      if (isNameDiff || isStatusDiff) {
        await db
          .update(customers)
          .set({
            name: matchedRunsnet.name,
            billingStatus: newStatus,
            lastUpdatedAt: new Date(),
          })
          .where(eq(customers.id, c.id));

        updatedCount++;
        updatedCustomers.push({
          id: c.id,
          pppoeUsername: c.pppoeUsername,
          oldName: c.name,
          newName: matchedRunsnet.name,
          billingStatus: shown,
        });
      } else {
        // Nama dan status sudah sinkron
        updatedCustomers.push({
          id: c.id,
          pppoeUsername: c.pppoeUsername,
          oldName: c.name,
          newName: c.name,
          billingStatus: shown,
        });
      }
    } else {
      unmatched.push({
        id: c.id,
        pppoeUsername: c.pppoeUsername,
        currentName: c.name,
      });
    }
  }

  return {
    success: true,
    totalCustomers: allCoreCustomers.length,
    matchedCount,
    updatedCount,
    unmatchedCount: unmatched.length,
    unmatched,
    updatedCustomers,
    message: `Berhasil mencocokkan ${matchedCount} dari ${allCoreCustomers.length} pelanggan dengan ID data RunsNet Billing (${updatedCount} diperbarui).`,
    syncedAt: new Date().toISOString(),
  };
}

