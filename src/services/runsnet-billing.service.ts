import "server-only";
import { db } from "@/db";
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

/**
 * Autentikasi ke RunsNet dan dapatkan session cookie aktif.
 */
export async function loginRunsnet(): Promise<string> {
  const getLogin = await fetch(`${RUNSNET_URL}/login.php`, {
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

  const postLogin = await fetch(`${RUNSNET_URL}/view/control/bagan_login.php`, {
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
    const res = await fetch(url, {
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

  return result;
}

/**
 * Menarik semua invoice dari RunsNet dengan pagination lengkap.
 */
export async function scrapeRunsnetInvoices(session: string, maxPages = 20): Promise<ParsedInvoice[]> {
  const result: ParsedInvoice[] = [];
  let start = 0;
  const length = 100;
  let total = Infinity;
  let pageCount = 0;

  while (start < total && pageCount < maxPages) {
    pageCount++;
    const url = `${RUNSNET_URL}/view/model/previewc/query/invoice.php?data1=&data2=&data3=&data4=&data5=&target=${RUNSNET_TARGET}`;
    const res = await fetch(url, {
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

  return result;
}

/**
 * Menarik riwayat payment dari RunsNet dengan rentang tanggal luas.
 */
export async function scrapeRunsnetPayments(session: string, maxPages = 20): Promise<ParsedPayment[]> {
  const result: ParsedPayment[] = [];
  let start = 0;
  const length = 100;
  let total = Infinity;
  let pageCount = 0;

  while (start < total && pageCount < maxPages) {
    pageCount++;
    const url = `${RUNSNET_URL}/view/model/previewc/query/payment.php?data1=01/01/2025&data2=12/31/2026&data4=&target=${RUNSNET_TARGET}`;
    const res = await fetch(url, {
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
          billingStatus: newStatus,
        });
      } else {
        // Nama dan status sudah sinkron
        updatedCustomers.push({
          id: c.id,
          pppoeUsername: c.pppoeUsername,
          oldName: c.name,
          newName: c.name,
          billingStatus: c.billingStatus,
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

