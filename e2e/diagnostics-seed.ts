import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface SeededRouter {
  id: string;
  name: string;
  host: string;
}

export interface SeededCustomer {
  id: string;
  name: string;
  pppoeUsername: string;
  routerId: string;
}

export interface SeededAlert {
  id: string;
  routerId: string;
  customerId: string;
}

export interface SeededFindingInput {
  id?: string;
  layer: string;
  metric: string;
  label: string;
  value?: string | null;
  threshold?: string | null;
  comparator?: string | null;
  status: "ok" | "warn" | "fail" | "unchecked";
  detail: string;
  sourceRef?: string | null;
  sampledAt?: Date | null;
}

export interface SeededRunInput {
  id?: string;
  customerId?: string | null;
  routerId?: string | null;
  triggerMode?: "manual" | "auto";
  triggeredBy?: string | null;
  triggerReason?: string;
  priority?: number;
  status?: "queued" | "running" | "done" | "failed";
  verdictLayer?: string | null;
  verdictDetail?: string | null;
  isSharedFault?: boolean;
  verdictScope?: "own" | "shared" | "unknown" | null;
  verdictRoot?: {
    kind: "customer" | "odp" | "router" | "uplink";
    name: string;
    affected: number;
    served: number;
  } | null;
  verdictSecondary?: Array<{
    layer: string;
    label: string;
    status: "ok" | "warn" | "fail" | "unchecked";
    value: string | null;
    threshold: string | null;
  }>;
  verdictHeld?: boolean;
  createdAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  findings?: SeededFindingInput[];
}

export async function createTestRouter(
  pool: Pool,
  overrides: Partial<SeededRouter> = {},
): Promise<SeededRouter> {
  const id = overrides.id ?? randomUUID();
  const suffix = id.slice(0, 8);
  const name = overrides.name ?? `e2e-router-${suffix}`;
  const host =
    overrides.host ??
    `192.0.2.${Math.floor(Math.random() * 200) + 10}:${Math.floor(Math.random() * 8000) + 1000}`;

  await pool.query(
    `INSERT INTO routers (id, name, host, username, password_enc, status, created_at)
     VALUES ($1, $2, $3, 'admin', 'e2e-enc-pwd', 'aktif', NOW())`,
    [id, name, host],
  );
  return { id, name, host };
}

export async function createTestCustomer(
  pool: Pool,
  routerId: string,
  overrides: Partial<Omit<SeededCustomer, "routerId">> = {},
): Promise<SeededCustomer> {
  const id = overrides.id ?? randomUUID();
  const suffix = id.slice(0, 8);
  const name = overrides.name ?? `Pelanggan E2E ${suffix}`;
  const pppoeUsername = overrides.pppoeUsername ?? `e2e_${suffix}`;

  await pool.query(
    `INSERT INTO customers (id, name, pppoe_username, router_id, billing_status, is_online, last_updated_at)
     VALUES ($1, $2, $3, $4, 'lunas', true, NOW())`,
    [id, name, pppoeUsername, routerId],
  );
  return { id, name, pppoeUsername, routerId };
}

export async function createTestAlert(
  pool: Pool,
  routerId: string,
  customerId: string,
  overrides: {
    id?: string;
    ticketNotes?: string | null;
    type?: string;
    severity?: string;
  } = {},
): Promise<SeededAlert> {
  const id = overrides.id ?? randomUUID();
  const type = overrides.type ?? "offline";
  const severity = overrides.severity ?? "warning";
  const ticketNotes = overrides.ticketNotes ?? null;

  await pool.query(
    `INSERT INTO alerts (
       id, router_id, customer_id, type, severity, status,
       title, message, ticket_notes, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'active', 'E2E Test Alert', 'e2e_alert_msg', $6, NOW(), NOW())`,
    [id, routerId, customerId, type, severity, ticketNotes],
  );
  return { id, routerId, customerId };
}

export async function createTestDiagnosticRun(
  pool: Pool,
  input: SeededRunInput,
): Promise<string> {
  const runId = input.id ?? randomUUID();
  const customerId = input.customerId ?? null;
  const routerId = input.routerId ?? null;
  const triggerMode = input.triggerMode ?? "manual";
  const triggeredBy = input.triggeredBy ?? "Operator E2E";
  const triggerReason = input.triggerReason ?? "e2e_test";
  const priority = input.priority ?? 0;
  const status = input.status ?? "done";
  const verdictLayer = input.verdictLayer ?? null;
  const verdictDetail = input.verdictDetail ?? null;
  const isSharedFault = input.isSharedFault ?? false;
  const verdictScope = input.verdictScope ?? (isSharedFault ? "shared" : "own");
  const verdictRoot = input.verdictRoot
    ? JSON.stringify(input.verdictRoot)
    : null;
  const verdictSecondary = JSON.stringify(input.verdictSecondary ?? []);
  const verdictHeld = input.verdictHeld ?? false;
  const createdAt = input.createdAt ?? new Date();
  const startedAt = input.startedAt ?? createdAt;
  const finishedAt = input.finishedAt ?? new Date(startedAt.getTime() + 2000);

  await pool.query(
    `INSERT INTO diagnostic_runs (
       id, customer_id, router_id, trigger_mode, triggered_by, trigger_reason, priority,
       status, verdict_layer, verdict_detail, is_shared_fault, verdict_scope,
       verdict_root, verdict_secondary, verdict_held, timeline, created_at, started_at, finished_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '[]'::jsonb, $16, $17, $18)`,
    [
      runId,
      customerId,
      routerId,
      triggerMode,
      triggeredBy,
      triggerReason,
      priority,
      status,
      verdictLayer,
      verdictDetail,
      isSharedFault,
      verdictScope,
      verdictRoot,
      verdictSecondary,
      verdictHeld,
      createdAt,
      startedAt,
      finishedAt,
    ],
  );

  if (input.findings && input.findings.length > 0) {
    for (const f of input.findings) {
      const findingId = f.id ?? randomUUID();
      await pool.query(
        `INSERT INTO diagnostic_findings (
           id, run_id, layer, metric, label, value, threshold, comparator, status, detail, source_ref, sampled_at, checked_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [
          findingId,
          runId,
          f.layer,
          f.metric,
          f.label,
          f.value ?? null,
          f.threshold ?? null,
          f.comparator ?? null,
          f.status,
          f.detail,
          f.sourceRef ?? null,
          f.sampledAt ?? new Date(),
        ],
      );
    }
  }

  return runId;
}

export async function cleanupDiagnosticTestData(pool: Pool): Promise<void> {
  // Cascades to diagnostic_findings via FK on run_id
  await pool.query(
    `DELETE FROM diagnostic_runs WHERE trigger_reason LIKE 'e2e_%'`,
  );
  await pool.query(`DELETE FROM alerts WHERE message LIKE 'e2e_%'`);
  await pool.query(`DELETE FROM customers WHERE pppoe_username LIKE 'e2e_%'`);
  await pool.query(
    `DELETE FROM routers WHERE host LIKE '192.0.2.%' OR name LIKE 'e2e-%'`,
  );
}
