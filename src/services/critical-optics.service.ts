import "server-only";
import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { customers, oltOnus } from "@/db/schema";

export interface CriticalOpticalItem {
  id: string;
  user: string;
  pon: string;
  odp: string;
  rx: number;
  badge: "Critical" | "High Atten" | "Degrading";
  serialNumber: string | null;
  ponIndex: number;
  onuIndex: number;
}

/**
 * Mengambil daftar ONU dan Pelanggan dengan redaman optik riil buruk (Rx < -24.5 dBm)
 * dari tabel PostgreSQL olt_onus yang dipolling langsung dari HSGQ OLT.
 * Menyediakan data nomor port PON riil, indeks ONU riil, dan Serial Number perangkat.
 */
export async function getCriticalOpticalOnus(limit = 6): Promise<CriticalOpticalItem[]> {
  const rows = await db
    .select({
      id: oltOnus.id,
      ponIndex: oltOnus.ponIndex,
      onuIndex: oltOnus.onuIndex,
      rxPower: oltOnus.rxPower,
      serialNumber: oltOnus.serialNumber,
      status: oltOnus.status,
      customerName: customers.name,
      pppoeUsername: customers.pppoeUsername,
      address: customers.address,
      odpName: customers.odpName,
    })
    .from(oltOnus)
    .leftJoin(customers, eq(oltOnus.customerId, customers.id))
    .where(and(lt(oltOnus.rxPower, -24.5), eq(oltOnus.status, "online")))
    .orderBy(asc(oltOnus.rxPower))
    .limit(limit);

  return rows.map((r) => {
    const rx = Number(r.rxPower);
    const user =
      r.pppoeUsername ||
      r.customerName ||
      (r.serialNumber ? `ONT ${r.serialNumber}` : `ONU ${r.ponIndex}/${r.onuIndex}`);
    const pon = `PON ${r.ponIndex} • ONU ${r.onuIndex}`;
    const odp =
      r.odpName ||
      r.address ||
      (r.serialNumber ? `SN: ${r.serialNumber}` : "Jaringan Distribusi");
    const badge: "Critical" | "High Atten" | "Degrading" =
      rx < -27 ? "Critical" : rx < -26 ? "High Atten" : "Degrading";

    return {
      id: r.id,
      user,
      pon,
      odp,
      rx,
      badge,
      serialNumber: r.serialNumber ?? null,
      ponIndex: r.ponIndex,
      onuIndex: r.onuIndex,
    };
  });
}

