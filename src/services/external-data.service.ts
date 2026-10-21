import "server-only";
import { asc, getTableColumns } from "drizzle-orm";
import { getTableConfig, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as schema from "@/db/schema";

// Tabel yang boleh ditarik aplikasi luar lewat GET /api/v1/data. Kolom rahasia
// dibuang (kata sandi perangkat terenkripsi; payload tugas CPE yang bisa memuat
// sandi WiFi baru). Akun, sesi, API key, kredensial billing, pengaturan web-ONT,
// catatan pribadi, dan tabel internal (migrasi, onboarding) sengaja tidak ada.
const datasets: Record<string, { table: PgTable; omit?: readonly string[] }> = {
  routers: { table: schema.routers, omit: ["passwordEnc"] },
  olts: { table: schema.olts, omit: ["passwordEnc"] },
  "olt-pon-ports": { table: schema.oltPonPorts },
  "olt-onus": { table: schema.oltOnus },
  customers: { table: schema.customers },
  alerts: { table: schema.alerts },
  "alert-thresholds": { table: schema.alertThresholds },
  "network-logs": { table: schema.networkLogs },
  "cpe-tasks": { table: schema.cpeTasks, omit: ["payload"] },
  "device-test-results": { table: schema.deviceTestResults },
  "traffic-samples": { table: schema.trafficSamples },
  "vlan-traffic-samples": { table: schema.vlanTrafficSamples },
  "netflow-samples": { table: schema.netflowSamples },
  "billing-status": { table: schema.billingStatus },
  "billing-mismatches": { table: schema.billingMismatches },
  "billing-sync-runs": { table: schema.billingSyncRuns },
  "runsnet-customers": { table: schema.runsnetCustomers },
  "runsnet-invoices": { table: schema.runsnetInvoices },
  "runsnet-payments": { table: schema.runsnetPayments },
  "runsnet-sync-logs": { table: schema.runsnetSyncLogs },
  "network-infrastructure": { table: schema.networkInfrastructure },
  "network-cables": { table: schema.networkCables },
  "network-device-relations": { table: schema.networkDeviceRelations },
  "network-routes": { table: schema.networkRoutes },
  "map-drawing-layers": { table: schema.mapDrawingLayers },
  "whatsapp-recipients": { table: schema.whatsappRecipients },
  "whatsapp-logs": { table: schema.whatsappLogs },
  "audit-log": { table: schema.auditLog },
};

export const externalDatasetNames = Object.freeze(Object.keys(datasets));

export function isExternalDataset(name: string) {
  return Object.hasOwn(datasets, name);
}

// Urutan stabil untuk paginasi offset: kunci utama (tunggal atau gabungan).
function primaryColumns(table: PgTable): PgColumn[] {
  const config = getTableConfig(table);
  const single = config.columns.filter((column) => column.primary);
  return single.length > 0 ? single : (config.primaryKeys[0]?.columns ?? []);
}

export async function readExternalDataset(
  name: string,
  { limit, offset }: { limit: number; offset: number },
) {
  const { table, omit = [] } = datasets[name];
  const columns = Object.fromEntries(
    Object.entries(getTableColumns(table)).filter(([key]) => !omit.includes(key)),
  );
  // Satu baris lebih untuk tahu ada halaman berikutnya tanpa count(*) di tabel besar.
  const rows = await db
    .select(columns)
    .from(table)
    .orderBy(...primaryColumns(table).map((column) => asc(column)))
    .limit(limit + 1)
    .offset(offset);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}
