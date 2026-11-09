import { sql } from "drizzle-orm";
import { customers } from "@/db/schema";

// Status isolir efektif pelanggan: router dulu (customers.isolir_router, ditulis poller
// Go dari address-list isolir), billing hanya cadangan saat router belum memberi bukti.
// customers.billing_status sendiri tetap data billing. Aturan yang sama (versi TS murni)
// ada di src/lib/effective-billing.ts; ubah keduanya bersama.
export const isolirSql = sql<boolean>`coalesce(${customers.isolirRouter}, ${customers.billingStatus} = 'isolir')`;

export const effectiveBillingStatusSql = sql<
  "lunas" | "isolir"
>`case when ${isolirSql} then 'isolir' else 'lunas' end`;
