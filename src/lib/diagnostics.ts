import { getOpticalSignalStatus } from "./dashboard/optical.ts";

// Diagnosa pelanggan berlapis: logika murni (tanpa DB/HTTP) supaya bisa diuji.
// Pengumpul data ada di services/diagnostics.service.ts.

// Urut hulu ke hilir. `phase` = fase PRD yang menambah pemeriksaan penuh
// lapisan itu; selama belum dibangun, lapisan tampil "tidak dapat diperiksa".
export const diagnosticLayers = [
  { id: "hulu", label: "Hulu (uplink, BGP, IPv6)", phase: 5 },
  { id: "mikrotik", label: "MikroTik (PPPoE, queue, interface)", phase: 2 },
  { id: "log", label: "Log MikroTik", phase: 3 },
  { id: "firewall", label: "Firewall & NAT", phase: 4 },
  { id: "optik", label: "Optik OLT/ONU", phase: 2 },
  { id: "ont", label: "ONT (TR-069)", phase: 2 },
  { id: "trafik", label: "Trafik & NetFlow", phase: 6 },
  { id: "aktif", label: "Pengukuran aktif & baseline", phase: 7 },
  { id: "billing", label: "Billing & isolir", phase: 2 },
] as const;

export type DiagnosticLayer = (typeof diagnosticLayers)[number]["id"];
export type FindingStatus = "ok" | "warn" | "fail" | "unchecked";

export interface Finding {
  layer: DiagnosticLayer;
  metric: string;
  label: string;
  value: string | null;
  threshold: string | null;
  comparator: string | null;
  status: FindingStatus;
  detail: string;
  sourceRef: string | null;
  sampledAt: Date | null;
}

export const layerLabel = (id: string) =>
  diagnosticLayers.find((l) => l.id === id)?.label ?? id;

export const MANUAL_PRIORITY = 0;
export const AUTO_PRIORITY = 10;
// OLT dipoll tiap 30 detik; sampel lebih tua dari ini dianggap basi.
export const OPTICAL_STALE_MS = 10 * 60_000;

export const triggerReasonLabels: Record<string, string> = {
  manual: "Tombol diagnosa",
  alert_offline: "Alert: pelanggan offline (PPPoE putus)",
  alert_optical: "Alert: sinyal optik ONU",
  alert_queue: "Alert: antrean pelanggan penuh",
  ticket: "Tiket keluhan",
  billing_isolir: "Billing berubah menjadi isolir",
  shared_fault: "Gangguan bersama",
};

// Hanya jenis alert milik satu pelanggan yang memicu diagnosa otomatis;
// cpu/port adalah alert router.
export function alertTriggerReason(type: string): string | null {
  return type === "offline" || type === "optical" || type === "queue"
    ? `alert_${type}`
    : null;
}

export function unchecked(
  layer: DiagnosticLayer,
  metric: string,
  label: string,
  reason: string,
  sourceRef: string | null = null,
): Finding {
  const detail = reason && reason.trim() ? reason : "alasan tidak dicatat";
  return {
    layer,
    metric,
    label,
    value: null,
    threshold: null,
    comparator: null,
    status: "unchecked",
    detail,
    sourceRef,
    sampledAt: null,
  };
}

// Lapisan yang belum dibangun pada fase ini. Ditulis eksplisit supaya tidak
// pernah terbaca sebagai normal.
export function pendingLayer(layer: DiagnosticLayer, what: string): Finding {
  const phase = diagnosticLayers.find((l) => l.id === layer)!.phase;
  return unchecked(
    layer,
    "belum_diperiksa",
    what,
    `Belum diperiksa: pemeriksaan ini dibangun di Fase ${phase}.`,
  );
}

const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(d);

export interface PppoeInput {
  routerName: string;
  username: string;
  // null = router tidak bisa dibaca; `error` berisi alasannya.
  session: { address: string; uptime: string; callerId: string } | null;
  error: string | null;
  readAt: Date;
}

export function evaluatePppoe(input: PppoeInput): Finding {
  const source = input
    ? `Router ${input.routerName || "—"} · /ppp/active · ${fmtTime(input.readAt ?? new Date())}`
    : "Router · /ppp/active";
  if (!input || !input.username || !input.username.trim()) {
    return unchecked(
      "mikrotik",
      "pppoe_active",
      "Sesi PPPoE",
      "Data username PPPoE tidak tersedia untuk diperiksa.",
      source,
    );
  }
  if (input.error) {
    return unchecked(
      "mikrotik",
      "pppoe_active",
      "Sesi PPPoE",
      `Router ${input.routerName} tidak dapat dibaca: ${input.error}`,
      source,
    );
  }
  const base = {
    layer: "mikrotik" as const,
    metric: "pppoe_active",
    label: "Sesi PPPoE",
    threshold: "aktif",
    comparator: "=",
    sourceRef: source,
    sampledAt: input.readAt,
  };
  if (!input.session) {
    return {
      ...base,
      value: "tidak aktif",
      status: "fail",
      detail: `Tidak ada sesi ${input.username} di /ppp/active router ${input.routerName}.`,
    };
  }
  const s = input.session;
  return {
    ...base,
    value: "aktif",
    status: "ok",
    detail: `IP ${s.address || "—"}, uptime ${s.uptime || "—"}, caller-id ${s.callerId || "—"}.`,
  };
}

export interface OpticalInput {
  oltName: string;
  ponIndex: number;
  onuIndex: number;
  status: string;
  rxPower: number | null;
  capturedAt: Date;
}

export function evaluateOptical(onu: OpticalInput | null, now: Date): Finding {
  if (!onu) {
    return unchecked(
      "optik",
      "onu_rx",
      "Rx ONU",
      "Belum ada ONU yang dipetakan ke pelanggan ini. Petakan di halaman OLT & Optik.",
    );
  }
  const source = `OLT ${onu.oltName} · PON ${onu.ponIndex}/ONU ${onu.onuIndex}`;
  const age = now.getTime() - onu.capturedAt.getTime();
  if (age > OPTICAL_STALE_MS) {
    return unchecked(
      "optik",
      "onu_rx",
      "Rx ONU",
      `Sampel OLT terakhir ${Math.round(age / 60_000)} menit lalu (batas ${OPTICAL_STALE_MS / 60_000} menit): OLT tidak terbaca, data basi.`,
      source,
    );
  }
  const base = {
    layer: "optik" as const,
    metric: "onu_rx",
    label: "Rx ONU",
    threshold: "> -26 s.d. -8 dBm",
    comparator: "dalam rentang",
    sourceRef: source,
    sampledAt: onu.capturedAt,
  };
  if (onu.status === "los" || onu.status === "offline") {
    return {
      ...base,
      value: onu.status === "los" ? "LOS" : "offline",
      status: "fail",
      detail:
        onu.status === "los"
          ? "OLT melaporkan LOS: sinyal optik ke ONU putus (kabel/konektor)."
          : "OLT melaporkan ONU offline (listrik ONU mati atau kabel putus).",
    };
  }
  if (onu.rxPower == null) {
    return unchecked(
      "optik",
      "onu_rx",
      "Rx ONU",
      "ONU online tetapi OLT tidak melaporkan Rx.",
      source,
    );
  }
  const s = getOpticalSignalStatus(onu.rxPower);
  return {
    ...base,
    value: `${onu.rxPower} dBm`,
    status: s.level === "ideal" ? "ok" : s.tone === "danger" ? "fail" : "warn",
    detail: `${s.label}. ${s.description}`,
  };
}

export interface BillingInput {
  status: string;
  syncedAt: Date;
  billingName: string | null;
}

export function evaluateBilling(row: BillingInput | null): Finding {
  if (!row) {
    return unchecked(
      "billing",
      "billing_status",
      "Status billing",
      "Pelanggan tidak cocok dengan tagihan mana pun di sinkron billing terakhir.",
      "billing_status",
    );
  }
  const isolir = row.status === "isolir";
  return {
    layer: "billing",
    metric: "billing_status",
    label: "Status billing",
    value: row.status,
    threshold: "lunas",
    comparator: "=",
    status: isolir ? "fail" : "ok",
    detail: isolir
      ? "Pelanggan sedang diisolir billing: layanan memang dibatasi."
      : "Tagihan lunas, tidak diisolir.",
    sourceRef: `billing_status · ${row.billingName ?? "—"} · sinkron ${fmtTime(row.syncedAt)}`,
    sampledAt: row.syncedAt,
  };
}

export type VerdictScope = "own" | "shared" | "unknown";

export interface ScopeEvidence {
  // OTHER customers (this customer excluded), alerts of the policy window
  router: { name: string; affected: number; served: number } | null;
  // same PON port: ONUs with offline/optical alert vs ONUs on the port; null if customer has no ONU/PON
  pon: { name: string; affected: number; served: number } | null;
  windowMinutes: number;
}

export interface PreviousVerdict {
  layer: DiagnosticLayer | null;
  finishedAt: Date;
}

export interface VerdictRoot {
  kind: "customer" | "odp" | "router" | "uplink";
  name: string;
  affected: number;
  served: number;
}

export interface VerdictSecondary {
  layer: DiagnosticLayer;
  label: string;
  status: FindingStatus;
  value: string | null;
  threshold: string | null;
}

export interface Verdict {
  layer: DiagnosticLayer | null;
  detail: string;
  scope: VerdictScope;
  root: VerdictRoot | null;
  secondary: VerdictSecondary[];
  held: boolean;
}

export const SHARED_MIN_AFFECTED = 3;
export const SHARED_MIN_RATIO = 0.2;
export const SHARED_PON_RATIO = 0.3;
export const VERDICT_HOLD_MS = 15 * 60_000;

// Urutan sebab ke akibat (cause hierarchy):
// fail: billing(0) > hulu(1) > optik(2) > ont(3) > mikrotik(4) > firewall(5) > log(6) > trafik(7) > aktif(8)
// warn: hulu(1) > optik(2) > ont(3) > mikrotik(4) > firewall(5) > log(6) > trafik(7) > aktif(8) > billing(9)
function layerRank(layer: DiagnosticLayer, status: FindingStatus): number {
  if (status === "fail") {
    switch (layer) {
      case "billing":
        return 0;
      case "hulu":
        return 1;
      case "optik":
        return 2;
      case "ont":
        return 3;
      case "mikrotik":
        return 4;
      case "firewall":
        return 5;
      case "log":
        return 6;
      case "trafik":
        return 7;
      case "aktif":
        return 8;
    }
  }
  switch (layer) {
    case "hulu":
      return 1;
    case "optik":
      return 2;
    case "ont":
      return 3;
    case "mikrotik":
      return 4;
    case "firewall":
      return 5;
    case "log":
      return 6;
    case "trafik":
      return 7;
    case "aktif":
      return 8;
    case "billing":
      return 9;
  }
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.status !== b.status) {
    if (a.status === "fail") return -1;
    if (b.status === "fail") return 1;
  }
  const diff = layerRank(a.layer, a.status) - layerRank(b.layer, b.status);
  if (diff !== 0) return diff;
  const metricDiff = (a.metric ?? "").localeCompare(b.metric ?? "");
  if (metricDiff !== 0) return metricDiff;
  return (a.label ?? "").localeCompare(b.label ?? "");
}

function compareSecondary(a: Finding, b: Finding): number {
  const diff = layerRank(a.layer, a.status) - layerRank(b.layer, b.status);
  if (diff !== 0) return diff;
  if (a.status !== b.status) {
    if (a.status === "fail") return -1;
    if (b.status === "fail") return 1;
  }
  const metricDiff = (a.metric ?? "").localeCompare(b.metric ?? "");
  if (metricDiff !== 0) return metricDiff;
  return (a.label ?? "").localeCompare(b.label ?? "");
}

export function decideVerdict(
  findings: Finding[],
  evidence: ScopeEvidence,
  previous: PreviousVerdict | null,
  now: Date,
): Verdict {
  const nonOk = findings.filter(
    (f) => f.status === "fail" || f.status === "warn",
  );

  if (nonOk.length === 0) {
    const checked = new Set(
      findings.filter((f) => f.status !== "unchecked").map((f) => f.layer),
    );
    const blind = diagnosticLayers.filter((l) => !checked.has(l.id)).length;
    return {
      layer: null,
      detail:
        checked.size === 0
          ? "Tidak ada lapisan yang dapat diperiksa; belum ada kesimpulan."
          : blind > 0
            ? `Tidak ada temuan bermasalah pada ${checked.size} lapisan yang diperiksa; ${blind} lapisan tidak dapat diperiksa, jadi kesimpulan belum lengkap.`
            : "Semua lapisan normal.",
      scope: evidence.router !== null ? "own" : "unknown",
      root: null,
      secondary: [],
      held: false,
    };
  }

  // Input-order independence via deterministic sort
  nonOk.sort(compareFindings);

  const candidateFinding = nonOk[0];
  const C = candidateFinding.layer;

  // Anti-flapping: tahan kesimpulan sebelumnya jika dalam jendela dan masih bermasalah,
  // kecuali kandidat baru adalah fail sedangkan lapisan lama hanya warn.
  const isWithinHold =
    previous !== null &&
    previous.layer !== null &&
    previous.finishedAt instanceof Date &&
    !Number.isNaN(previous.finishedAt.getTime()) &&
    now.getTime() - previous.finishedAt.getTime() >= 0 &&
    now.getTime() - previous.finishedAt.getTime() <= VERDICT_HOLD_MS;

  const P = isWithinHold ? previous.layer : null;

  let chosenFinding = candidateFinding;
  let held = false;

  if (P !== null && C !== P) {
    const pFindings = nonOk.filter((f) => f.layer === P);
    if (pFindings.length > 0) {
      const pWorst = pFindings[0];
      const candidateIsFailAndPWarn =
        candidateFinding.status === "fail" && pWorst.status === "warn";
      if (!candidateIsFailAndPWarn) {
        chosenFinding = pWorst;
        held = true;
      }
    }
  }

  const otherFindings = nonOk.filter((f) => f !== chosenFinding);
  otherFindings.sort(compareSecondary);
  // shortcut: dibatasi 6 temuan sekunder teratas agar ringkasan padat, upgrade jika UI butuh pagination riwayat temuan lengkap.
  const secondary: VerdictSecondary[] = otherFindings.slice(0, 6).map((f) => ({
    layer: f.layer,
    label: f.label,
    status: f.status,
    value: f.value,
    threshold: f.threshold,
  }));

  // Cakupan gangguan & incident-root
  let scope: VerdictScope;
  let root: VerdictRoot | null = null;

  const routerMet =
    evidence.router !== null &&
    evidence.router.affected >= SHARED_MIN_AFFECTED &&
    evidence.router.served > 0 &&
    evidence.router.affected / evidence.router.served >= SHARED_MIN_RATIO;

  const ponMet =
    evidence.pon !== null &&
    evidence.pon.affected >= SHARED_MIN_AFFECTED &&
    evidence.pon.served > 0 &&
    evidence.pon.affected / evidence.pon.served >= SHARED_PON_RATIO;

  if (chosenFinding.layer === "billing" && chosenFinding.status === "fail") {
    // Isolir / kegagalan billing selalu ranah pelanggan sendiri
    scope = "own";
    // shortcut: nama pelanggan dikosongkan pada fungsi murni ini, diisi oleh service dari data pelanggan.
    root = { kind: "customer", name: "", affected: 1, served: 1 };
  } else if (chosenFinding.layer === "hulu") {
    // Hulu bermasalah selalu gangguan bersama (uplink router)
    scope = "shared";
    root = {
      kind: "uplink",
      name: evidence.router?.name ?? "",
      affected: evidence.router?.affected ?? 0,
      served: evidence.router?.served ?? 0,
    };
  } else if (ponMet) {
    scope = "shared";
    root = {
      kind: "odp",
      name: evidence.pon!.name,
      affected: evidence.pon!.affected,
      served: evidence.pon!.served,
    };
  } else if (routerMet) {
    scope = "shared";
    root = {
      kind: "router",
      name: evidence.router!.name,
      affected: evidence.router!.affected,
      served: evidence.router!.served,
    };
  } else if (evidence.router !== null) {
    scope = "own";
    // shortcut: nama pelanggan dikosongkan pada fungsi murni ini, diisi oleh service dari data pelanggan.
    root = { kind: "customer", name: "", affected: 1, served: 1 };
  } else {
    scope = "unknown";
    root = null;
  }

  // Penyusunan teks detail deterministik
  let scopePrefix = "";
  if (scope === "shared") {
    if (chosenFinding.layer === "hulu") {
      scopePrefix = "Gangguan bersama: ";
    } else if (root !== null) {
      const target =
        root.kind === "odp" ? `PON ${root.name}` : `router ${root.name}`;
      scopePrefix = `Gangguan bersama: ${root.affected} dari ${root.served} pelanggan di ${target} terdampak; temuan lokal kemungkinan akibat gangguan bersama. `;
    }
  } else if (scope === "unknown") {
    scopePrefix =
      "Cakupan gangguan tidak diketahui (bukti router tidak tersedia): ";
  }

  const thresh = [chosenFinding.comparator, chosenFinding.threshold]
    .filter(Boolean)
    .join(" ");
  let numbers = "";
  if (chosenFinding.value && thresh) {
    numbers = ` ${chosenFinding.value} (ambang ${thresh})`;
  } else if (chosenFinding.value) {
    numbers = ` ${chosenFinding.value}`;
  } else if (thresh) {
    numbers = ` (ambang ${thresh})`;
  }

  const statusWord =
    chosenFinding.status === "fail" ? "Bermasalah" : "Peringatan";
  const findingPart = `${statusWord} di ${layerLabel(chosenFinding.layer)}: ${chosenFinding.label}${numbers}.${chosenFinding.detail ? ` ${chosenFinding.detail}` : ""}`;

  let secondaryPart = "";
  if (secondary.length > 0) {
    const layers = [...new Set(secondary.map((s) => s.layer))].join(", ");
    secondaryPart = ` Temuan terkait: ${layers}.`;
  }

  const heldPart = held
    ? " Kesimpulan dipertahankan dari diagnosa sebelumnya (anti-flapping)."
    : "";

  const detail = `${scopePrefix}${findingPart}${secondaryPart}${heldPart}`;

  return {
    layer: chosenFinding.layer,
    detail,
    scope,
    root,
    secondary,
    held,
  };
}

// shortcut: jendela tetap (bukan geser); dua kejadian yang mengapit batas
// jendela bisa menghasilkan dua run. Cukup untuk menahan flapping per 15 menit.
export const autoDedupeKey = (
  customerId: string,
  nowMs: number,
  minutes: number,
) => `auto:${customerId}:${Math.floor(nowMs / (minutes * 60_000))}`;

export const sharedDedupeKey = (nowMs: number, minutes: number) =>
  `shared:${Math.floor(nowMs / (minutes * 60_000))}`;

export interface QueueJob {
  runId: string;
  routerKey: string;
  priority: number;
}

// Antrean diagnosa: prioritas kecil dulu (manual sebelum otomatis), paling
// banyak `maxPerRouter` berjalan per router, dan diagnosa otomatis menunggu
// `autoGapMs` sejak diagnosa terakhir di router yang sama selesai.
// shortcut: antrean di memori satu proses Next.js; bila app dijalankan lebih
// dari satu instance, pindahkan ke kunci di database.
export function createDiagnosticQueue(
  run: (runId: string) => Promise<void>,
  {
    maxPerRouter = 1,
    maxTotal = 3,
    autoGapMs = 2_000,
    now = Date.now,
  }: {
    maxPerRouter?: number;
    maxTotal?: number;
    autoGapMs?: number;
    now?: () => number;
  } = {},
) {
  const waiting: (QueueJob & { seq: number })[] = [];
  const active = new Set<string>();
  const busy = new Map<string, number>();
  const lastDone = new Map<string, number>();
  let running = 0;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function pump() {
    while (running < maxTotal) {
      const t = now();
      let wakeAt = Infinity;
      let best: (typeof waiting)[number] | null = null;
      for (const job of waiting) {
        if ((busy.get(job.routerKey) ?? 0) >= maxPerRouter) continue;
        if (job.priority > MANUAL_PRIORITY) {
          const free = (lastDone.get(job.routerKey) ?? -Infinity) + autoGapMs;
          if (free > t) {
            wakeAt = Math.min(wakeAt, free);
            continue;
          }
        }
        if (
          !best ||
          job.priority < best.priority ||
          (job.priority === best.priority && job.seq < best.seq)
        ) {
          best = job;
        }
      }
      if (!best) {
        if (wakeAt !== Infinity && !timer) {
          timer = setTimeout(() => {
            timer = null;
            pump();
          }, wakeAt - t);
        }
        return;
      }
      const job = best;
      waiting.splice(waiting.indexOf(job), 1);
      running++;
      active.add(job.runId);
      busy.set(job.routerKey, (busy.get(job.routerKey) ?? 0) + 1);
      run(job.runId)
        .catch((err) =>
          console.error(
            "Diagnosa gagal dijalankan:",
            err instanceof Error ? err.message : err,
          ),
        )
        .finally(() => {
          running--;
          active.delete(job.runId);
          busy.set(job.routerKey, (busy.get(job.routerKey) ?? 1) - 1);
          lastDone.set(job.routerKey, now());
          pump();
        });
    }
  }

  return {
    enqueue(job: QueueJob) {
      if (active.has(job.runId) || waiting.some((w) => w.runId === job.runId))
        return;
      waiting.push({ ...job, seq: seq++ });
      pump();
    },
    size: () => ({ waiting: waiting.length, running }),
  };
}

// Bentuk JSON yang dikirim API ke tampilan (tanggal sebagai ISO string).
export type FindingDto = Omit<Finding, "sampledAt"> & {
  id: string;
  sampledAt: string | null;
  checkedAt: string;
};

export interface DiagnosticRunDto {
  id: string;
  customerId: string | null;
  customerName: string | null;
  pppoeUsername: string | null;
  triggerMode: "manual" | "auto";
  triggeredBy: string | null;
  triggerReason: string;
  triggerSourceRef: string | null;
  mergedCount: number;
  lastMergedAt: string | null;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  verdictLayer: string | null;
  verdictDetail: string | null;
  isSharedFault: boolean;
  verdictScope: VerdictScope | null;
  verdictRoot: VerdictRoot | null;
  verdictSecondary: VerdictSecondary[];
  verdictHeld: boolean;
  complaintAt: string | null;
  timeline: {
    at: string;
    kind: string;
    label: string;
    detail: string;
    source: string;
  }[];
  findings?: FindingDto[];
  // Rule firewall/NAT yang mengenai pelanggan (potret Fase 4), urut tabel & posisi.
  firewallRules?: {
    table: string;
    chain: string;
    ruleIndex: number;
    action: string;
    scope: string;
    summary: string;
    comment: string;
    disabled: boolean;
    matchedPackets: number;
    isStale: boolean;
  }[];
}

export interface DiagnosticPolicyDto {
  triggerAlert: boolean;
  triggerTicket: boolean;
  triggerBilling: boolean;
  dedupeMinutes: number;
  massThreshold: number;
  massWindowMinutes: number;
  updatedBy: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Fase 2: MikroTik, firewall ringkas, ONT (GenieACS), billing RunsNet.
// Evaluator menerima record REST RouterOS apa adanya (semua nilai string).
// ---------------------------------------------------------------------------

export type Ros = Record<string, string>;

// Sama dengan aturan anomali "queue" (anomalyRules): antrean > 95%.
export const QUEUE_FULL_PCT = 95;
// Kehilangan paket TCP di atas ~1% sudah terasa sebagai lambat.
export const QUEUE_DROP_WARN_PCT = 1;
// shortcut: kapasitas jalur PON dianggap EPON 1G (OLT HSGQ-XE08ID); ganti
// dengan kapasitas per port dari OLT bila ada GPON atau port 10G.
export const PON_CAPACITY_MBPS = 1000;
export const PON_WARN_PCT = 80;
export const PON_FAIL_PCT = 95;
export const CONNTRACK_WARN_PCT = 75;
export const CONNTRACK_FAIL_PCT = 90;
// GenieACS: modem dianggap tidak melapor bila inform terakhir lebih tua dari ini.
export const ONT_STALE_MS = 15 * 60_000;
export const ONT_FRESH_BOOT_SECONDS = 600;
export const OLT_ONT_RX_DIFF_DB = 3;
export const ISOLIR_LIST = /isolir/i;
export const BLOCK_LIST = /isolir|block|blokir|drop|deny|reject|banned/i;

const n = (v: string | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
// "unggah/unduh" RouterOS (target upload dulu) -> [unggah, unduh].
export const pair = (v: string | undefined): [number, number] => {
  const [a, b] = (v ?? "").split("/");
  return [n(a), n(b)];
};
const mbps = (bps: number) => (bps / 1e6).toFixed(1);
const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

export function evaluateQueue(
  first: Ros | null,
  second: Ros | null,
  gapSec: number,
  sourceRef: string,
  sampledAt: Date,
): Finding[] {
  const base = { layer: "mikrotik" as const, sourceRef, sampledAt };
  if (!first) {
    return [
      {
        ...base,
        metric: "queue_limit",
        label: "Simple queue pelanggan",
        value: "tidak ada",
        threshold: "ada",
        comparator: "=",
        status: "warn",
        detail:
          "Tidak ada simple queue untuk sesi ini: batas kecepatan tidak terpasang di router ini.",
      },
    ];
  }
  const [limUp, limDown] = pair(first["max-limit"]);
  const disabled = first.disabled === "true";
  const limit: Finding = {
    ...base,
    metric: "queue_limit",
    label: "Batas kecepatan (unggah/unduh)",
    value: `${mbps(limUp)}/${mbps(limDown)} Mbps`,
    threshold: "aktif",
    comparator: "=",
    status: disabled ? "warn" : "ok",
    detail: disabled
      ? "Queue nonaktif: batas kecepatan tidak berlaku."
      : first.dynamic === "true"
        ? "Queue dinamis dari profil PPP/RADIUS."
        : "Queue statis.",
  };

  const latest = second ?? first;
  const [rateUp, rateDown] = pair(latest.rate);
  let usage: Finding;
  if (limUp <= 0 || limDown <= 0) {
    usage = unchecked(
      "mikrotik",
      "queue_usage",
      "Pemakaian terhadap batas",
      "max-limit 0 (tanpa batas): persentase tidak bisa dihitung.",
      sourceRef,
    );
  } else {
    const pUp = pct(rateUp, limUp);
    const pDown = pct(rateDown, limDown);
    const worst = Math.max(pUp, pDown);
    usage = {
      ...base,
      metric: "queue_usage",
      label: "Pemakaian terhadap batas",
      value: `unduh ${mbps(rateDown)} Mbps (${pDown}%), unggah ${mbps(rateUp)} Mbps (${pUp}%)`,
      threshold: `${QUEUE_FULL_PCT}%`,
      comparator: "<",
      status: worst >= QUEUE_FULL_PCT ? "warn" : "ok",
      detail:
        worst >= QUEUE_FULL_PCT
          ? "Pemakaian menyentuh batas paket: terasa lambat karena kecepatan paket habis, bukan gangguan jaringan."
          : "Masih di bawah batas paket.",
    };
  }

  if (!second) return [limit, usage];
  const delta = (k: string) => {
    const [a1, b1] = pair(first[k]);
    const [a2, b2] = pair(second[k]);
    return [a2 - a1, b2 - b1];
  };
  const [dUp, dDown] = delta("dropped");
  const [pUp, pDown] = delta("packets");
  if (dUp < 0 || dDown < 0 || pUp < 0 || pDown < 0) {
    return [
      limit,
      usage,
      unchecked(
        "mikrotik",
        "queue_drop",
        "Paket dibuang antrean",
        "Penghitung queue kembali ke nol di antara dua sampel (sesi tersambung ulang).",
        sourceRef,
      ),
    ];
  }
  // Persen dari paket yang datang ke antrean (lewat + dibuang), bukan jumlah mentah.
  const lossPct = (drop: number, passed: number) =>
    drop + passed > 0 ? (drop / (drop + passed)) * 100 : 0;
  const lUp = lossPct(dUp, pUp);
  const lDown = lossPct(dDown, pDown);
  const lossy = Math.max(lUp, lDown) >= QUEUE_DROP_WARN_PCT;
  const drops: Finding = {
    ...base,
    metric: "queue_drop",
    label: "Paket dibuang antrean",
    value: `unduh ${dDown} dari ${dDown + pDown} (${lDown.toFixed(1)}%), unggah ${dUp} dari ${dUp + pUp} (${lUp.toFixed(1)}%) dalam ${gapSec.toFixed(1)} dtk`,
    threshold: `${QUEUE_DROP_WARN_PCT}%`,
    comparator: "<",
    status: lossy ? "warn" : "ok",
    detail: lossy
      ? `Antrean membuang paket (jenis queue ${first.queue || "—"}): ledakan trafik melebihi batas paket atau buffer antrean terlalu kecil; terasa sebagai lambat/putus-putus.`
      : "Kehilangan paket di antrean di bawah ambang.",
  };
  return [limit, usage, drops];
}

export function evaluatePppInterface(
  first: Ros | null,
  second: Ros | null,
  gapSec: number,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const label = "Error & drop antarmuka PPPoE";
  if (!first || !second) {
    return unchecked(
      "mikrotik",
      "iface_errors",
      label,
      "Antarmuka <pppoe-…> tidak terbaca pada kedua sampel.",
      sourceRef,
    );
  }
  const d = (k: string) => n(second[k]) - n(first[k]);
  const errors = d("rx-error") + d("tx-error");
  const drops = d("rx-drop") + d("tx-drop");
  if (errors < 0 || drops < 0) {
    return unchecked(
      "mikrotik",
      "iface_errors",
      label,
      "Penghitung antarmuka kembali ke nol di antara dua sampel (sesi tersambung ulang).",
      sourceRef,
    );
  }
  return {
    layer: "mikrotik",
    metric: "iface_errors",
    label,
    value: `error ${errors}, drop ${drops} dalam ${gapSec.toFixed(1)} dtk`,
    threshold: "0",
    comparator: "=",
    status: errors + drops > 0 ? "warn" : "ok",
    detail: `${errors + drops > 0 ? "Antarmuka sesi mencatat error/drop." : "Bersih selama sampel."} Tersambung sejak ${second["last-link-up-time"] || "—"}.`,
    sourceRef,
    sampledAt,
  };
}

export function evaluatePonVlan(
  vlanName: string | null,
  first: Ros | null,
  second: Ros | null,
  gapSec: number,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const label = `Laju jalur PON${vlanName ? ` ${vlanName}` : ""}`;
  if (!vlanName)
    return unchecked(
      "mikrotik",
      "pon_vlan_rate",
      label,
      "Binding PPPoE server tidak menyebut antarmuka asal sesi.",
      sourceRef,
    );
  if (!first || !second || gapSec <= 0)
    return unchecked(
      "mikrotik",
      "pon_vlan_rate",
      label,
      `Antarmuka ${vlanName} tidak terbaca pada kedua sampel.`,
      sourceRef,
    );
  // tx router = menuju OLT (unduh pelanggan), rx = unggah.
  const down = ((n(second["tx-byte"]) - n(first["tx-byte"])) * 8) / gapSec;
  const up = ((n(second["rx-byte"]) - n(first["rx-byte"])) * 8) / gapSec;
  if (down < 0 || up < 0)
    return unchecked(
      "mikrotik",
      "pon_vlan_rate",
      label,
      "Penghitung antarmuka kembali ke nol di antara dua sampel.",
      sourceRef,
    );
  const used = pct(Math.max(down, up), PON_CAPACITY_MBPS * 1e6);
  return {
    layer: "mikrotik",
    metric: "pon_vlan_rate",
    label,
    value: `unduh ${mbps(down)} Mbps, unggah ${mbps(up)} Mbps (${used}% dari ${PON_CAPACITY_MBPS} Mbps)`,
    threshold: `${PON_WARN_PCT}%`,
    comparator: "<",
    status:
      used >= PON_FAIL_PCT ? "fail" : used >= PON_WARN_PCT ? "warn" : "ok",
    detail:
      used >= PON_WARN_PCT
        ? "Jalur PON yang dipakai bersama pelanggan satu port hampir penuh: lambat bisa karena berbagi jalur."
        : "Jalur PON bersama masih longgar.",
    sourceRef,
    sampledAt,
  };
}

export function evaluateIpConflict(
  ip: string,
  pppInterface: string,
  arp: Ros[],
  leases: Ros[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  if (!ip || !ip.trim()) {
    return unchecked(
      "mikrotik",
      "ip_conflict",
      "Bentrok alamat (ARP/DHCP)",
      "Alamat IP pelanggan tidak tersedia untuk diperiksa.",
      sourceRef,
    );
  }
  const others = [
    ...arp
      .filter((a) => a.interface !== pppInterface)
      .map(
        (a) => `ARP di ${a.interface || "?"} MAC ${a["mac-address"] || "?"}`,
      ),
    ...leases.map(
      (l) => `lease DHCP ${l.server || "?"} MAC ${l["mac-address"] || "?"}`,
    ),
  ];
  return {
    layer: "mikrotik",
    metric: "ip_conflict",
    label: "Bentrok alamat (ARP/DHCP)",
    value: others.length ? `${others.length} entri` : "tidak ada",
    threshold: "0 entri",
    comparator: "=",
    status: others.length ? "warn" : "ok",
    detail: others.length
      ? `IP ${ip} juga dipakai perangkat lain: ${others.join("; ")}.`
      : `Tidak ada entri ARP/DHCP lain untuk IP ${ip}.`,
    sourceRef,
    sampledAt,
  };
}

const ipNum = (s: string): number | null => {
  const parts = s.trim().split(".");
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    v = v * 256 + Number(p);
  }
  return v;
};

// Entri address-list RouterOS: alamat tunggal, CIDR, atau rentang "a-b".
export function addressContains(entry: string, ip: string): boolean {
  const target = ipNum(ip);
  if (target === null) return false;
  if (entry.includes("-")) {
    const [a, b] = entry.split("-").map(ipNum);
    return a !== null && b !== null && target >= a && target <= b;
  }
  const [base, len] = entry.split("/");
  const start = ipNum(base);
  const bits = len === undefined ? 32 : Number(len);
  if (start === null || !Number.isInteger(bits) || bits < 0 || bits > 32)
    return false;
  const size = 2 ** (32 - bits);
  return Math.floor(target / size) === Math.floor(start / size);
}

export function addressListMembership(ip: string, entries: Ros[]) {
  const lists = [
    ...new Set(
      entries
        .filter(
          (e) => e.disabled !== "true" && addressContains(e.address ?? "", ip),
        )
        .map((e) => e.list),
    ),
  ];
  return {
    lists,
    isolated: lists.some((l) => ISOLIR_LIST.test(l)),
    blocked: lists.filter((l) => BLOCK_LIST.test(l)),
  };
}

export function evaluateAddressLists(
  ip: string,
  m: ReturnType<typeof addressListMembership>,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  if (!ip || !ip.trim()) {
    return unchecked(
      "firewall",
      "address_list",
      "Address-list yang memuat IP pelanggan",
      "Alamat IP pelanggan tidak tersedia untuk diperiksa.",
      sourceRef,
    );
  }
  return {
    layer: "firewall",
    metric: "address_list",
    label: "Address-list yang memuat IP pelanggan",
    value: m.lists.length ? m.lists.join(", ") : "tidak ada",
    threshold: "bukan daftar isolir/blokir",
    comparator: "=",
    status: m.blocked.length ? "fail" : "ok",
    detail: m.blocked.length
      ? `IP ${ip} masuk ${m.blocked.join(", ")}: trafik pelanggan dibatasi firewall walau sesi tampak online.`
      : `IP ${ip} tidak masuk daftar isolir/blokir.`,
    sourceRef,
    sampledAt,
  };
}

export function evaluateConntrack(
  tracking: Ros,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const total = n(tracking["total-entries"]);
  const max = n(tracking["max-entries"]);
  if (max <= 0)
    return unchecked(
      "firewall",
      "conntrack",
      "Tabel connection tracking",
      "Router tidak melaporkan max-entries.",
      sourceRef,
    );
  const used = pct(total, max);
  return {
    layer: "firewall",
    metric: "conntrack",
    label: "Tabel connection tracking",
    value: `${total} dari ${max} (${used}%)`,
    threshold: `${CONNTRACK_WARN_PCT}%`,
    comparator: "<",
    status:
      used >= CONNTRACK_FAIL_PCT
        ? "fail"
        : used >= CONNTRACK_WARN_PCT
          ? "warn"
          : "ok",
    detail:
      used >= CONNTRACK_WARN_PCT
        ? "Tabel hampir penuh: koneksi baru bisa gagal acak (kadang jalan, kadang tidak)."
        : "Tabel masih longgar.",
    sourceRef,
    sampledAt,
  };
}

export interface OntInput {
  deviceId: string;
  lastInform: string;
  uptimeSeconds: number | null;
  activeClients: number;
  rxDbm: number | null;
  wans: { kind: string; username: string; status: string; ip: string }[];
}

const duration = (s: number) =>
  s >= 86400
    ? `${Math.floor(s / 86400)} hari ${Math.floor((s % 86400) / 3600)} jam`
    : s >= 3600
      ? `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`
      : `${Math.floor(s / 60)} menit`;

export function evaluateOnt(
  ont: OntInput | null,
  pppoeUsername: string,
  oltRxDbm: number | null,
  now: Date,
): Finding[] {
  if (!ont) {
    return [
      unchecked(
        "ont",
        "ont_found",
        "Modem di GenieACS",
        `Tidak ada modem dengan username PPPoE ${pppoeUsername} di GenieACS (belum terdaftar TR-069 atau PPPoE dijalankan perangkat lain).`,
        "GenieACS NBI",
      ),
    ];
  }
  const sourceRef = `GenieACS · ${ont.deviceId}`;
  const informAt = new Date(ont.lastInform);
  const age = now.getTime() - informAt.getTime();
  const base = {
    layer: "ont" as const,
    sourceRef,
    sampledAt: Number.isNaN(age) ? null : informAt,
  };
  if (Number.isNaN(age) || age > ONT_STALE_MS) {
    return [
      {
        ...base,
        metric: "ont_inform",
        label: "Laporan terakhir modem",
        value: Number.isNaN(age)
          ? "tidak ada"
          : `${Math.round(age / 60_000)} menit lalu`,
        threshold: `${ONT_STALE_MS / 60_000} menit`,
        comparator: "≤",
        status: "warn",
        detail:
          "Modem tidak melapor ke ACS: mati, tidak terhubung, atau jalur manajemen TR-069 putus. Isi ONT lainnya basi dan tidak dinilai.",
      },
    ];
  }

  const out: Finding[] = [];
  const wanted = pppoeUsername.toLowerCase().trim();
  const wan =
    ont.wans.find((w) => w.username.toLowerCase().trim() === wanted) ??
    ont.wans.find((w) => w.kind === "PPPoE");
  out.push(
    wan
      ? {
          ...base,
          metric: "ont_wan",
          label: "WAN PPPoE di modem",
          value: wan.status || "tidak diketahui",
          threshold: "Connected",
          comparator: "=",
          status: wan.status === "Connected" ? "ok" : "fail",
          detail:
            wan.status === "Connected"
              ? `Modem tersambung PPPoE, IP ${wan.ip || "—"}.`
              : "Modem tidak tersambung PPPoE: cek kredensial, VLAN, atau sinyal.",
        }
      : unchecked(
          "ont",
          "ont_wan",
          "WAN PPPoE di modem",
          "Modem tidak melaporkan WAN PPPoE (mode bridge atau PPPoE dijalankan perangkat lain).",
          sourceRef,
        ),
  );
  out.push(
    ont.uptimeSeconds === null
      ? unchecked(
          "ont",
          "ont_uptime",
          "Uptime modem",
          "Modem tidak melaporkan uptime.",
          sourceRef,
        )
      : {
          ...base,
          metric: "ont_uptime",
          label: "Uptime modem",
          value: duration(ont.uptimeSeconds),
          threshold: `${ONT_FRESH_BOOT_SECONDS / 60} menit`,
          comparator: "≥",
          status: ont.uptimeSeconds < ONT_FRESH_BOOT_SECONDS ? "warn" : "ok",
          detail:
            ont.uptimeSeconds < ONT_FRESH_BOOT_SECONDS
              ? "Modem baru menyala ulang: listrik padam, adaptor, atau modem restart sendiri."
              : "Modem tidak baru restart.",
        },
  );
  out.push(
    ont.activeClients === null || ont.activeClients === undefined
      ? unchecked(
          "ont",
          "ont_hosts",
          "Perangkat terhubung ke modem",
          "Modem tidak melaporkan jumlah perangkat terhubung.",
          sourceRef,
        )
      : {
          ...base,
          metric: "ont_hosts",
          label: "Perangkat terhubung ke modem",
          value: `${ont.activeClients} perangkat`,
          threshold: null,
          comparator: null,
          status: "ok",
          detail:
            "Konteks: semua perangkat aktif berbagi kecepatan paket yang sama.",
        },
  );
  if (ont.rxDbm === null) {
    out.push(
      unchecked(
        "ont",
        "ont_rx",
        "Rx optik sisi modem",
        "Modem tidak melaporkan Rx optik.",
        sourceRef,
      ),
    );
  } else {
    const s = getOpticalSignalStatus(ont.rxDbm);
    const diff = oltRxDbm === null ? null : Math.abs(ont.rxDbm - oltRxDbm);
    const mismatch = diff !== null && diff > OLT_ONT_RX_DIFF_DB;
    out.push({
      ...base,
      metric: "ont_rx",
      label: "Rx optik sisi modem",
      value: `${ont.rxDbm} dBm${oltRxDbm === null ? "" : ` (OLT ${oltRxDbm} dBm)`}`,
      threshold: "-24 s.d. -8 dBm",
      comparator: "dalam rentang",
      status:
        s.level === "ideal"
          ? mismatch
            ? "warn"
            : "ok"
          : s.tone === "danger"
            ? "fail"
            : "warn",
      detail: `${s.label}.${
        mismatch
          ? ` Selisih dengan pembacaan OLT ${diff!.toFixed(1)} dB (ambang ${OLT_ONT_RX_DIFF_DB} dB): salah satu pembacaan meleset atau ONU yang dipetakan berbeda.`
          : ""
      }`,
    });
  }
  return out;
}

export interface RunsnetInput {
  custId: string;
  status: string;
  connectivity: string | null;
  syncedAt: Date;
}

export function evaluateRunsnetStatus(c: RunsnetInput): Finding {
  if (!c || !c.status || !c.status.trim()) {
    return unchecked(
      "billing",
      "billing_status",
      "Status layanan di billing",
      "Data status layanan di billing tidak tersedia.",
      c?.custId ? `RunsNet · ID ${c.custId}` : "billing",
    );
  }
  const s = c.status.toLowerCase();
  return {
    layer: "billing",
    metric: "billing_status",
    label: "Status layanan di billing",
    value: c.status,
    threshold: "Active",
    comparator: "=",
    status: s === "active" ? "ok" : s === "pending" ? "warn" : "fail",
    detail:
      s === "isolir"
        ? "Pelanggan diisolir billing: layanan memang dibatasi."
        : s === "terminate"
          ? "Layanan sudah diputus di billing."
          : s === "pending"
            ? "Layanan belum aktif di billing."
            : `Layanan aktif. Koneksi menurut billing: ${c.connectivity ?? "—"}.`,
    sourceRef: `RunsNet · ID ${c.custId} · sinkron ${fmtTime(c.syncedAt)}`,
    sampledAt: c.syncedAt,
  };
}

export function evaluateArrears(
  invoices: {
    dueDate: string | null;
    status: string;
    remainingAmount: number;
  }[],
  today: string,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  if (!invoices) {
    return unchecked(
      "billing",
      "arrears",
      "Tagihan lewat jatuh tempo",
      "Data tagihan tidak tersedia.",
      sourceRef,
    );
  }
  if (!today || !today.trim()) {
    return unchecked(
      "billing",
      "arrears",
      "Tagihan lewat jatuh tempo",
      "Tanggal hari ini tidak diberikan.",
      sourceRef,
    );
  }
  const overdue = invoices.filter(
    (i) =>
      i.status !== "paid" &&
      i.remainingAmount > 0 &&
      !!i.dueDate &&
      i.dueDate < today,
  );
  const total = overdue.reduce((sum, i) => sum + i.remainingAmount, 0);
  const rupiah = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
  return {
    layer: "billing",
    metric: "arrears",
    label: "Tagihan lewat jatuh tempo",
    value: overdue.length
      ? `${overdue.length} tagihan, ${rupiah.format(total)}`
      : "tidak ada",
    threshold: "0 tagihan",
    comparator: "=",
    status: overdue.length ? "warn" : "ok",
    detail: overdue.length
      ? `Tertunggak sejak jatuh tempo ${overdue.map((i) => i.dueDate).sort()[0]}: bisa berujung isolir.`
      : "Tidak ada tunggakan.",
    sourceRef,
    sampledAt,
  };
}

// Kecocokan status billing dengan keadaan nyata di router.
export function evaluateBillingNetwork(input: {
  billingStatus: string | null;
  sessionActive: boolean | null;
  isolatedInRouter: boolean | null;
  sourceRef: string;
  sampledAt: Date;
}): Finding {
  const label = "Kecocokan billing dengan router";
  if (!input.billingStatus) {
    return unchecked(
      "billing",
      "billing_network",
      label,
      "Status billing pelanggan tidak diketahui.",
      input.sourceRef,
    );
  }
  if (input.sessionActive === null) {
    return unchecked(
      "billing",
      "billing_network",
      label,
      "Router tidak terbaca.",
      input.sourceRef,
    );
  }
  const s = input.billingStatus.toLowerCase();
  const base = {
    layer: "billing" as const,
    metric: "billing_network",
    label,
    threshold: "selaras",
    comparator: "=",
    sourceRef: input.sourceRef,
    sampledAt: input.sampledAt,
  };
  if (s === "terminate" && input.sessionActive) {
    return {
      ...base,
      value: "tidak selaras",
      status: "warn",
      detail:
        "Layanan diputus di billing tetapi sesi PPPoE masih aktif di router.",
    };
  }
  if (!input.sessionActive) {
    return {
      ...base,
      value: "sesi tidak aktif",
      status: "ok",
      detail: "Tidak ada sesi aktif untuk dibandingkan dengan billing.",
    };
  }
  if (input.isolatedInRouter === null) {
    return unchecked(
      "billing",
      "billing_network",
      label,
      "Address-list router tidak terbaca.",
      input.sourceRef,
    );
  }
  if (s === "isolir" && !input.isolatedInRouter) {
    return {
      ...base,
      value: "tidak selaras",
      status: "warn",
      detail:
        "Billing isolir tetapi IP sesi tidak di daftar isolir router: isolir belum diterapkan.",
    };
  }
  if (s !== "isolir" && input.isolatedInRouter) {
    return {
      ...base,
      value: "tidak selaras",
      status: "fail",
      detail: `IP sesi ada di daftar isolir router padahal billing ${input.billingStatus}: pelanggan terisolir tanpa sebab billing.`,
    };
  }
  return {
    ...base,
    value: "selaras",
    status: "ok",
    detail: "Status billing sesuai keadaan sesi di router.",
  };
}

// ---------------------------------------------------------------------------
// Fase 3: log RouterOS dan korelasi waktu terhadap keluhan.
// Pola diambil dari bentuk pesan asli router produksi (RouterOS 7).
// ---------------------------------------------------------------------------

export interface LogLine {
  at: Date;
  topics: string;
  message: string;
}

export type LogKind =
  | "login"
  | "logout"
  | "no_address"
  | "auth_fail"
  | "link_down"
  | "link_up"
  | "addr_conflict"
  | "firewall"
  | "noise"
  | "other";

export interface TimelineEvent {
  at: string;
  kind: string;
  label: string;
  detail: string;
  source: string;
}

// Putus berulang: 3 kali dalam jendela = gangguan, 1-2 kali = peringatan.
export const FLAP_FAIL_COUNT = 3;
export const AUTH_FAIL_COUNT = 3;
// Jendela analisis sebelum keluhan, dan cakupan log minimal sebelum keluhan.
export const LOG_LOOKBACK_MS = 6 * 3600_000;
export const LOG_MIN_COVERAGE_MS = 3600_000;
export const TIMELINE_MAX = 60;

const NOISE: [RegExp, string][] = [
  [/\bdetect (UNKNOWN|WAN|LAN|INTERNET)\b/, "detect-internet"],
  [/^user \S+ logged (in|out)\b/, "login akun pengelola (api/winbox/web)"],
  [
    /: (authenticated|connected|disconnected|terminating\.\.\.)$/,
    "langkah rutin sesi PPP",
  ],
  [/^PPPoE connection established from /, "langkah rutin sesi PPP"],
  [/\b(assigned|deassigned) \S+ (to|from) /, "pemberian lease DHCP rutin"],
];

// Jenis satu baris log. `noiseGroup` diisi untuk baris derau supaya
// penyaringan bisa ditunjukkan dan ditinjau.
export function classifyLogLine(line: Pick<LogLine, "topics" | "message">): {
  kind: LogKind;
  noiseGroup?: string;
  sessionSec?: number;
} {
  const m = line.message.trim();
  for (const [re, group] of NOISE)
    if (re.test(m)) return { kind: "noise", noiseGroup: group };
  const out = /\blogged out, (\d+) /.exec(m);
  if (out) return { kind: "logout", sessionSec: Number(out[1]) };
  if (/\blogged out\b/.test(m)) return { kind: "logout" };
  if (/\blogged in, /.test(m)) return { kind: "login" };
  if (/could not determine remote address/.test(m))
    return { kind: "no_address" };
  if (
    /authentication failed|login failed|bad password|peer refused|max sessions/i.test(
      m,
    )
  )
    return { kind: "auth_fail" };
  if (/^\S+ link down\b/.test(m)) return { kind: "link_down" };
  if (/^\S+ link up\b/.test(m)) return { kind: "link_up" };
  if (/conflict|already in use|duplicate address|mac address changed/i.test(m))
    return { kind: "addr_conflict" };
  if (/\bfirewall\b/.test(line.topics)) return { kind: "firewall" };
  return { kind: "other" };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Baris yang menyangkut pelanggan: username/antarmuka PPPoE-nya, MAC
// (caller-id), IP sesinya, atau antarmuka jalur (VLAN PON dan induknya).
export function logLineMatcher(t: {
  username: string;
  mac: string | null;
  ip: string | null;
  interfaces: string[];
}) {
  const parts = [escapeRe(t.username)];
  if (t.mac) parts.push(escapeRe(t.mac));
  if (t.ip) parts.push(`(?<![\\d.])${escapeRe(t.ip)}(?![\\d.])`);
  const who = new RegExp(parts.join("|"), "i");
  const links = t.interfaces
    .filter(Boolean)
    .map((i) => new RegExp(`^${escapeRe(i)} link (down|up)\\b`));
  return (line: Pick<LogLine, "message">) =>
    who.test(line.message) || links.some((re) => re.test(line.message.trim()));
}

const kindLabel: Record<LogKind, string> = {
  login: "Sesi PPPoE tersambung",
  logout: "Sesi PPPoE putus",
  no_address: "Sesi tanpa alamat IP",
  auth_fail: "Login PPPoE ditolak",
  link_down: "Link turun",
  link_up: "Link naik",
  addr_conflict: "Bentrok alamat",
  firewall: "Log firewall",
  noise: "Derau",
  other: "Log router",
};

export function analyzeLog(input: {
  lines: LogLine[];
  matches: (line: LogLine) => boolean;
  complaintAt: Date;
  now: Date;
  // Awal cakupan log yang tersedia (baris tertua yang dimiliki sumber).
  coverageStart: Date | null;
  sourceLabel: string;
  sourceRef: string;
  // Saran bila cakupan kurang (berbeda untuk buffer router dan syslog tersimpan).
  coverageHint: string;
}): { findings: Finding[]; timeline: TimelineEvent[] } {
  const { complaintAt, now, coverageStart, sourceRef } = input;
  const from = new Date(
    Math.max(
      complaintAt.getTime() - LOG_LOOKBACK_MS,
      coverageStart?.getTime() ?? 0,
    ),
  );
  const base = { layer: "log" as const, sourceRef, sampledAt: now };
  const findings: Finding[] = [];

  const covered =
    coverageStart !== null &&
    coverageStart.getTime() <= complaintAt.getTime() - LOG_MIN_COVERAGE_MS;
  const span = coverageStart
    ? `${fmtTime(coverageStart)} – ${fmtTime(now)}`
    : "tidak ada";
  findings.push(
    covered
      ? {
          ...base,
          metric: "log_coverage",
          label: "Cakupan log",
          value: span,
          threshold: "≥ 1 jam sebelum keluhan",
          comparator: "mencakup",
          status: "ok",
          detail: `${input.sourceLabel}. Dianalisis sejak ${fmtTime(from)}.`,
        }
      : unchecked(
          "log",
          "log_coverage",
          "Cakupan log",
          coverageStart
            ? `${input.sourceLabel} hanya mencakup ${span}, padahal perlu sejak 1 jam sebelum keluhan (${fmtTime(complaintAt)}); kejadian sebelum ${fmtTime(coverageStart)} tidak dapat diperiksa. ${input.coverageHint}`
            : `${input.sourceLabel} tidak berisi baris log.`,
          sourceRef,
        ),
  );
  if (!coverageStart) return { findings, timeline: [] };

  const noise = new Map<string, number>();
  const relevant: (LogLine & { kind: LogKind; sessionSec?: number })[] = [];
  for (const line of input.lines) {
    if (line.at < from || !input.matches(line)) continue;
    const c = classifyLogLine(line);
    if (c.kind === "noise") {
      noise.set(c.noiseGroup!, (noise.get(c.noiseGroup!) ?? 0) + 1);
      continue;
    }
    relevant.push({ ...line, kind: c.kind, sessionSec: c.sessionSec });
  }
  const of = (k: LogKind) => relevant.filter((r) => r.kind === k);
  const split = (list: LogLine[]) => {
    const before = list.filter((l) => l.at <= complaintAt).length;
    return `${before} sebelum, ${list.length - before} sesudah keluhan`;
  };
  const windowText = `sejak ${fmtTime(from)}`;
  const count = (
    metric: string,
    label: string,
    list: (LogLine & { sessionSec?: number })[],
    failAt: number,
    detailBad: string,
    detailOk: string,
    extra = "",
  ): Finding => ({
    ...base,
    metric,
    label,
    value: `${list.length} kali (${split(list)})${extra}`,
    threshold: `${failAt} kali ${windowText}`,
    comparator: "<",
    status: list.length >= failAt ? "fail" : list.length > 0 ? "warn" : "ok",
    detail: list.length ? detailBad : detailOk,
  });

  const logouts = of("logout");
  const shortest = logouts.reduce<number | null>(
    (m, l) =>
      l.sessionSec === undefined
        ? m
        : m === null
          ? l.sessionSec
          : Math.min(m, l.sessionSec),
    null,
  );
  findings.push(
    count(
      "ppp_flap",
      "Sesi PPPoE putus",
      logouts,
      FLAP_FAIL_COUNT,
      "Sesi putus-nyambung: indikasi kabel/optik, modem, atau kredensial/profil bermasalah.",
      "Tidak ada sesi putus pada jendela log.",
      shortest !== null ? `, sesi terpendek ${shortest} dtk` : "",
    ),
  );
  const noAddr = of("no_address");
  findings.push(
    count(
      "ppp_no_address",
      "Sesi tanpa alamat IP",
      noAddr,
      1,
      'Router tidak bisa memberi alamat IP ke sesi ("could not determine remote address"): pool IP habis atau RADIUS tidak mengirim Framed-IP-Address, sehingga sesi langsung putus.',
      "Setiap sesi mendapat alamat IP.",
    ),
  );
  findings.push(
    count(
      "ppp_auth_fail",
      "Login PPPoE ditolak",
      of("auth_fail"),
      AUTH_FAIL_COUNT,
      "Login ditolak: kredensial PPPoE di modem salah, akun nonaktif, atau batas sesi.",
      "Tidak ada login yang ditolak.",
    ),
  );
  const downs = of("link_down");
  findings.push(
    count(
      "link_flap",
      "Link jalur turun",
      downs,
      1,
      `Link jalur pelanggan turun: ${[...new Set(downs.map((d) => d.message.split(" ")[0]))].join(", ")}.`,
      "Link jalur ke OLT tidak turun pada jendela log.",
    ),
  );
  findings.push(
    count(
      "addr_conflict",
      "Bentrok alamat di log",
      of("addr_conflict"),
      FLAP_FAIL_COUNT,
      "Router mencatat bentrok alamat/MAC yang menyangkut pelanggan.",
      "Tidak ada bentrok alamat tercatat.",
    ),
  );
  const fw = of("firewall");
  if (fw.length) {
    findings.push(
      count(
        "firewall_log",
        "Log firewall untuk pelanggan",
        fw,
        FLAP_FAIL_COUNT,
        "Rule firewall yang di-log mengenai trafik pelanggan.",
        "",
      ),
    );
  }
  const noiseTotal = [...noise.values()].reduce((a, b) => a + b, 0);
  findings.push({
    ...base,
    metric: "log_noise",
    label: "Baris rutin yang disaring",
    value: `${noiseTotal} baris`,
    threshold: null,
    comparator: null,
    status: "ok",
    detail: noiseTotal
      ? `Tidak dihitung sebagai kejadian: ${[...noise].map(([g, n]) => `${n} ${g}`).join(", ")}.`
      : "Tidak ada baris rutin.",
  });

  // Garis waktu: kejadian terdekat dengan waktu keluhan.
  const events = relevant
    .slice()
    .sort(
      (a, b) =>
        Math.abs(a.at.getTime() - complaintAt.getTime()) -
        Math.abs(b.at.getTime() - complaintAt.getTime()),
    )
    .slice(0, TIMELINE_MAX)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((l) => ({
      at: l.at.toISOString(),
      kind: `log_${l.kind}`,
      label: kindLabel[l.kind],
      detail: l.message,
      source: input.sourceLabel,
    }));
  return { findings, timeline: events };
}

// "2026-10-22 19:49:02" (jam router, WIB) atau "19:49:02" (hari ini) -> Date.
export function parseRouterLogTime(
  value: string,
  now: Date,
  offset = "+07:00",
): Date | null {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
  }).format(now);
  const full = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(" ", "T")
    : /^\d{2}:\d{2}:\d{2}$/.test(value)
      ? `${today}T${value}`
      : null;
  if (!full) return null;
  const d = new Date(`${full}${offset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Fase 4: audit firewall & NAT. Hanya membaca konfigurasi; yang dinilai adalah
// rule mana yang benar-benar mengenai trafik pelanggan, posisinya, dan hit-nya.
// ---------------------------------------------------------------------------

export type FirewallTable = "filter" | "raw" | "nat" | "mangle";
// khusus = menyebut IP/address-list/antarmuka pelanggan; umum = berlaku untuk
// semua pelanggan; mungkin = syaratnya tidak bisa dinilai dari luar router.
export type RuleScope = "khusus" | "umum" | "mungkin";

export interface FirewallTarget {
  ip: string;
  // Antarmuka sesi, mis. "<pppoe-USER>".
  iface: string;
  // Address-list yang memuat IP pelanggan.
  lists: string[];
}

export interface RuleHit {
  table: FirewallTable;
  chain: string;
  index: number;
  ruleId: string;
  action: string;
  scope: RuleScope;
  disabled: boolean;
  packets: number;
  bytes: number;
  comment: string;
  summary: string;
  // Aktif, mengenai pelanggan, tetapi hit-count nol.
  stale: boolean;
}

// Koneksi pelanggan sebanyak ini menandakan P2P/malware atau aplikasi bocor.
export const CUSTOMER_CONN_WARN = 3000;
const BLOCK_ACTIONS = new Set(["drop", "reject", "tarpit"]);
// Aksi yang menentukan nasib trafik internet pelanggan; rule umum dengan aksi
// lain (accept, log, passthrough) tidak dicantumkan supaya daftar tidak bising.
const FATE_ACTIONS = new Set([
  "drop",
  "reject",
  "tarpit",
  "fasttrack-connection",
  "notrack",
  "masquerade",
  "src-nat",
  "dst-nat",
  "redirect",
  "netmap",
  "mark-connection",
  "mark-packet",
  "mark-routing",
]);
// Syarat yang tidak bisa dinilai tanpa melihat paket.
const OPAQUE_SELECTORS = [
  "in-interface-list",
  "out-interface-list",
  "src-mac-address",
  "connection-mark",
  "packet-mark",
  "routing-mark",
  "layer7-protocol",
  "content",
  "hotspot",
  "ipsec-policy",
  "in-bridge-port",
  "out-bridge-port",
  "src-address-type",
  "dst-address-type",
  "per-connection-classifier",
  "tls-host",
];
const SUMMARY_KEYS = [
  "src-address",
  "src-address-list",
  "in-interface",
  "dst-address",
  "dst-address-list",
  "out-interface",
  "protocol",
  "dst-port",
  "src-port",
  "connection-state",
  ...OPAQUE_SELECTORS,
  "to-addresses",
  "to-ports",
  "new-connection-mark",
  "new-packet-mark",
];

const negated = (v: string): [boolean, string] =>
  v.startsWith("!") ? [true, v.slice(1)] : [false, v];

// Satu sisi rule (src = pelanggan sebagai pengirim, dst = sebagai tujuan).
function sideMatch(
  rule: Ros,
  side: "src" | "dst",
  t: FirewallTarget,
): "spec" | "excl" | "neutral" {
  let spec = false;
  const checks: [string | undefined, (v: string) => boolean][] = [
    [rule[`${side}-address`], (v) => addressContains(v, t.ip)],
    [rule[`${side}-address-list`], (v) => t.lists.includes(v)],
    [
      rule[side === "src" ? "in-interface" : "out-interface"],
      (v) => v === t.iface,
    ],
  ];
  for (const [raw, test] of checks) {
    if (!raw) continue;
    const [neg, value] = negated(raw);
    if (test(value) === neg) return "excl";
    if (!neg) spec = true;
  }
  return spec ? "spec" : "neutral";
}

export function ruleScope(rule: Ros, t: FirewallTarget): RuleScope | null {
  // Port forward yang menunjuk pelanggan selalu khusus.
  if (
    (rule.action === "dst-nat" || rule.action === "netmap") &&
    rule["to-addresses"] &&
    addressContains(rule["to-addresses"], t.ip)
  ) {
    return "khusus";
  }
  const chain = rule.chain ?? "";
  // input = pelanggan ke router (pengirim); output = router ke pelanggan.
  // srcnat/dstnat: pelanggan di balik NAT hanya relevan sebagai pengirim;
  // port forward ke pelanggan sudah tertangkap lewat to-addresses di atas.
  const sides: ("src" | "dst")[] = ["input", "srcnat", "dstnat"].includes(chain)
    ? ["src"]
    : chain === "output"
      ? ["dst"]
      : ["src", "dst"];
  const results = sides.map((s) => {
    const r = sideMatch(rule, s, t);
    // Sisi lawan dibatasi ke jaringan privat (modem, OLT, VPN): trafik internal,
    // bukan trafik internet pelanggan, jadi tidak dihitung "umum".
    const peer = rule[`${s === "src" ? "dst" : "src"}-address`];
    const internal =
      !!peer &&
      !peer.startsWith("!") &&
      PRIVATE_NETS.some((net) => addressContains(net, peer.split("/")[0]));
    return r === "neutral" && internal ? "excl" : r;
  });
  if (results.includes("spec")) return "khusus";
  if (!results.includes("neutral")) return null;
  return OPAQUE_SELECTORS.some((k) => rule[k]) ? "mungkin" : "umum";
}

const n0 = (v: string | undefined) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function auditRules(
  tables: Partial<Record<FirewallTable, Ros[]>>,
  t: FirewallTarget,
): RuleHit[] {
  const out: RuleHit[] = [];
  for (const table of ["raw", "filter", "mangle", "nat"] as FirewallTable[]) {
    (tables[table] ?? []).forEach((rule, index) => {
      if (rule.dynamic === "true") return;
      const scope = ruleScope(rule, t);
      if (!scope) return;
      const action = rule.action ?? "";
      if (scope !== "khusus" && !FATE_ACTIONS.has(action)) return;
      const disabled = rule.disabled === "true";
      const packets = n0(rule.packets);
      out.push({
        table,
        chain: rule.chain ?? "",
        index,
        ruleId: rule[".id"] ?? "",
        action,
        scope,
        disabled,
        packets,
        bytes: n0(rule.bytes),
        comment: rule.comment ?? "",
        summary: SUMMARY_KEYS.filter((k) => rule[k])
          .map((k) => `${k}=${rule[k]}`)
          .join(" "),
        stale: !disabled && scope === "khusus" && packets === 0,
      });
    });
  }
  return out;
}

const fmtCount = (v: number) => new Intl.NumberFormat("id-ID").format(v);
const ruleName = (h: RuleHit) =>
  `${h.table} ${h.chain} #${h.index} ${h.action}${h.comment ? ` "${h.comment}"` : ""}${h.summary ? ` (${h.summary})` : ""}`;
const active = (h: RuleHit) => !h.disabled;

export function evaluateFilterBlock(
  hits: RuleHit[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const blocks = hits.filter(
    (h) => h.table === "filter" && active(h) && BLOCK_ACTIONS.has(h.action),
  );
  const own = blocks.filter((h) => h.scope === "khusus");
  const firing = own.filter((h) => h.packets > 0);
  const general = blocks.filter((h) => h.scope !== "khusus");
  // Accept khusus di atas drop khusus pada chain yang sama = drop tidak tercapai.
  const shadowed = own.filter((d) =>
    hits.some(
      (a) =>
        a.table === "filter" &&
        active(a) &&
        a.scope === "khusus" &&
        a.action === "accept" &&
        a.chain === d.chain &&
        a.index < d.index,
    ),
  );
  const parts = [
    firing.length
      ? `Memblokir dan sedang kena: ${firing.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.`
      : "",
    own.length - firing.length > 0
      ? `Siaga (belum pernah kena): ${own
          .filter((h) => h.packets === 0)
          .map(ruleName)
          .join("; ")}.`
      : "",
    shadowed.length
      ? `Tertutup accept di atasnya: ${shadowed.map(ruleName).join("; ")}.`
      : "",
    general.length
      ? `Kebijakan umum yang juga berlaku: ${general.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.`
      : "",
  ].filter(Boolean);
  return {
    layer: "firewall",
    metric: "filter_block",
    label: "Rule filter yang memblokir pelanggan",
    value: `${own.length} khusus (${firing.length} sedang kena), ${general.length} umum`,
    threshold: "0 rule khusus yang kena",
    comparator: "=",
    status: firing.length ? "fail" : own.length ? "warn" : "ok",
    detail:
      parts.join(" ") ||
      "Tidak ada rule filter drop/reject yang mengenai pelanggan.",
    sourceRef,
    sampledAt,
  };
}

export function evaluateRaw(
  hits: RuleHit[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const raw = hits.filter((h) => h.table === "raw" && active(h));
  const drops = raw.filter(
    (h) => BLOCK_ACTIONS.has(h.action) && h.scope === "khusus",
  );
  const notrack = raw.filter((h) => h.action === "notrack");
  return {
    layer: "firewall",
    metric: "raw",
    label: "Rule raw (drop & notrack)",
    value: `${drops.length} drop, ${notrack.length} notrack`,
    threshold: "0",
    comparator: "=",
    status: drops.some((h) => h.packets > 0)
      ? "fail"
      : drops.length || notrack.length
        ? "warn"
        : "ok",
    detail:
      drops.length || notrack.length
        ? [
            drops.length
              ? `Raw drop (sebelum connection tracking, tidak tampak di monitoring): ${drops.map(ruleName).join("; ")}.`
              : "",
            notrack.length
              ? `Notrack: koneksi tidak dilacak sehingga NAT tidak berlaku: ${notrack.map(ruleName).join("; ")}.`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : "Tidak ada rule raw yang mengenai pelanggan.",
    sourceRef,
    sampledAt,
  };
}

const PRIVATE_NETS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

export function evaluateSrcNat(
  hits: RuleHit[],
  ip: string,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  if (!ip || !ip.trim()) {
    return unchecked(
      "firewall",
      "nat_src",
      "NAT keluar (masquerade/src-nat)",
      "Alamat IP pelanggan tidak tersedia untuk memeriksa NAT.",
      sourceRef,
    );
  }
  const nat = hits.filter(
    (h) =>
      h.table === "nat" &&
      h.chain === "srcnat" &&
      active(h) &&
      (h.action === "masquerade" || h.action === "src-nat"),
  );
  const isPrivate = PRIVATE_NETS.some((net) => addressContains(net, ip));
  const first = nat[0];
  return {
    layer: "firewall",
    metric: "nat_src",
    label: "NAT keluar (masquerade/src-nat)",
    value: first
      ? `${ruleName(first)}, hit ${fmtCount(first.packets)}`
      : "tidak ada",
    threshold: isPrivate ? "ada untuk IP privat" : "tidak wajib (IP publik)",
    comparator: "=",
    status: first || !isPrivate ? "ok" : "fail",
    detail: first
      ? `${nat.length} rule NAT keluar mengenai pelanggan; yang pertama cocok yang berlaku.`
      : isPrivate
        ? `IP ${ip} privat tetapi tidak ada masquerade/src-nat yang mengenainya: trafik ke internet tidak di-NAT.`
        : `IP ${ip} publik; tidak perlu NAT.`,
    sourceRef,
    sampledAt,
  };
}

const ports = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

export function evaluatePortForward(
  hits: RuleHit[],
  natRules: Ros[],
  ip: string,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  if (!ip || !ip.trim()) {
    return unchecked(
      "firewall",
      "nat_dst",
      "Port forward & redirect ke pelanggan",
      "Alamat IP pelanggan tidak tersedia untuk memeriksa port forward.",
      sourceRef,
    );
  }
  const forwards = hits.filter(
    (h) =>
      h.table === "nat" &&
      h.chain === "dstnat" &&
      active(h) &&
      (h.action === "dst-nat" || h.action === "netmap") &&
      h.scope === "khusus",
  );
  // Forward lain (ke tujuan mana pun) yang sama protokol & port & tujuan awal
  // dan berada lebih atas: forward pelanggan tidak pernah tercapai.
  const clashes: string[] = [];
  for (const f of forwards) {
    const mine = natRules[f.index];
    natRules.forEach((other, i) => {
      if (
        i === f.index ||
        other.disabled === "true" ||
        other.chain !== "dstnat" ||
        !["dst-nat", "netmap", "redirect"].includes(other.action ?? "")
      )
        return;
      const samePort = ports(other["dst-port"]).some((p) =>
        ports(mine["dst-port"]).includes(p),
      );
      const sameProto = (other.protocol ?? "") === (mine.protocol ?? "");
      const sameDst =
        (other["dst-address"] ?? "") === (mine["dst-address"] ?? "") ||
        !other["dst-address"] ||
        !mine["dst-address"];
      if (samePort && sameProto && sameDst)
        clashes.push(
          `#${Math.min(i, f.index)} menutupi #${Math.max(i, f.index)} (port ${mine["dst-port"]})`,
        );
    });
  }
  const redirects = hits.filter(
    (h) =>
      h.table === "nat" &&
      h.chain === "dstnat" &&
      active(h) &&
      h.action === "redirect" &&
      h.scope === "khusus",
  );
  const unique = [...new Set(clashes)];
  return {
    layer: "firewall",
    metric: "nat_dst",
    label: "Port forward & redirect ke pelanggan",
    value: `${forwards.length} port forward, ${redirects.length} redirect`,
    threshold: "tanpa tabrakan",
    comparator: "=",
    status: unique.length ? "warn" : "ok",
    detail: [
      forwards.length
        ? `Port forward ke ${ip}: ${forwards.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.`
        : `Tidak ada port forward ke ${ip}.`,
      unique.length
        ? `Tabrakan port forward: ${unique.join(", ")}; hanya rule teratas yang berlaku.`
        : "",
      redirects.length
        ? `Redirect yang mengenai pelanggan: ${redirects.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    sourceRef,
    sampledAt,
  };
}

export function evaluateFasttrack(
  hits: RuleHit[],
  connections: Ros[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const rules = hits.filter(
    (h) =>
      h.table === "filter" && active(h) && h.action === "fasttrack-connection",
  );
  const fast = connections.filter((c) => c.fasttrack === "true").length;
  const on = rules.length > 0 || fast > 0;
  return {
    layer: "firewall",
    metric: "fasttrack",
    label: "Fasttrack (melewati simple queue)",
    value: `${rules.length} rule, ${fast} dari ${connections.length} koneksi di-fasttrack`,
    threshold: "0",
    comparator: "=",
    status: on ? "fail" : "ok",
    detail: on
      ? `Koneksi yang di-fasttrack melewati simple queue, jadi batas kecepatan paket tidak dieksekusi walau terpasang.${rules.length ? ` Rule: ${rules.map(ruleName).join("; ")}.` : ""}`
      : "Tidak ada fasttrack; simple queue berlaku untuk semua koneksi pelanggan.",
    sourceRef,
    sampledAt,
  };
}

export function evaluateCustomerConnections(
  outbound: Ros[],
  inbound: Ros[],
  tracking: Ros | null,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  if (!outbound && !inbound && !tracking) {
    return unchecked(
      "firewall",
      "conntrack_customer",
      "Koneksi pelanggan di connection tracking",
      "Data connection tracking tidak tersedia.",
      sourceRef,
    );
  }
  if (tracking && tracking.enabled === "no") {
    return {
      layer: "firewall",
      metric: "conntrack_customer",
      label: "Koneksi pelanggan di connection tracking",
      value: "tracking mati",
      threshold: "aktif",
      comparator: "=",
      status: "fail",
      detail:
        "Connection tracking dimatikan: NAT dan rule berbasis state tidak berjalan.",
      sourceRef,
      sampledAt,
    };
  }
  const total = outbound.length + inbound.length;
  return {
    layer: "firewall",
    metric: "conntrack_customer",
    label: "Koneksi pelanggan di connection tracking",
    value: `${fmtCount(total)} koneksi (${fmtCount(outbound.length)} keluar, ${fmtCount(inbound.length)} masuk)`,
    threshold: fmtCount(CUSTOMER_CONN_WARN),
    comparator: "<",
    status: total >= CUSTOMER_CONN_WARN ? "warn" : "ok",
    detail:
      total >= CUSTOMER_CONN_WARN
        ? "Koneksi sangat banyak: P2P/torrent, perangkat terinfeksi, atau aplikasi bocor; bisa menghabiskan kecepatan paket dan tabel router."
        : "Jumlah koneksi wajar.",
    sourceRef,
    sampledAt,
  };
}

export function evaluateMangle(
  hits: RuleHit[],
  queue: Ros | null,
  connections: Ros[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const marks = hits.filter(
    (h) => h.table === "mangle" && active(h) && h.action.startsWith("mark-"),
  );
  const needed = (queue?.["packet-marks"] ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const produced = new Set(
    marks.flatMap((h) =>
      [...h.summary.matchAll(/new-packet-mark=(\S+)/g)].map((m) => m[1]),
    ),
  );
  const missing = needed.filter((m) => !produced.has(m));
  const connMarks = [
    ...new Set(connections.map((c) => c["connection-mark"]).filter(Boolean)),
  ];
  return {
    layer: "firewall",
    metric: "mangle",
    label: "Mangle & mark untuk queue",
    value: `${marks.length} rule mark; queue memakai ${needed.length ? needed.join(", ") : "semua paket (tanpa mark)"}`,
    threshold: "mark queue dipasang mangle",
    comparator: "=",
    status: missing.length ? "fail" : "ok",
    detail: [
      missing.length
        ? `Queue pelanggan hanya mengenai paket bertanda ${missing.join(", ")}, tetapi tidak ada mangle aktif yang memasang tanda itu untuk pelanggan ini: batas kecepatan tidak mengenai trafiknya.`
        : needed.length
          ? "Mark yang dipakai queue dipasang mangle."
          : "Queue tidak bergantung pada mark.",
      marks.length ? `Rule mark: ${marks.map(ruleName).join("; ")}.` : "",
      connMarks.length
        ? `Connection-mark pada koneksi pelanggan: ${connMarks.join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    sourceRef,
    sampledAt,
  };
}

export function evaluateStaleRules(
  hits: RuleHit[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const stale = hits.filter((h) => h.stale);
  return {
    layer: "firewall",
    metric: "rule_stale",
    label: "Rule khusus yang tidak pernah kena",
    value: `${stale.length} rule`,
    threshold: null,
    comparator: null,
    status: "ok",
    detail: stale.length
      ? `Menyebut pelanggan ini tetapi hit-count nol (syarat tidak pernah terpenuhi atau salah tulis): ${stale.map(ruleName).join("; ")}.`
      : "Semua rule khusus yang aktif pernah kena.",
    sourceRef,
    sampledAt,
  };
}

// ---------------------------------------------------------------------------
// Fase 5: jalur hulu (uplink ke ISP/Metro, kualitas jalur, BGP, IPv6). Semua
// diukur dari router; masalah di sini adalah gangguan bersama, bukan
// kesalahan perangkat pelanggan.
// ---------------------------------------------------------------------------

export const UPLINK_WARN_PCT = 80;
export const UPLINK_FAIL_PCT = 95;
export const LOSS_WARN_PCT = 1;
export const LOSS_FAIL_PCT = 5;
export const JITTER_WARN_MS = 20;
export const JITTER_FAIL_MS = 50;
// Hop berikutnya semestinya dekat; tujuan internet boleh lebih jauh.
export const RTT_LIMITS = {
  gateway: { warn: 20, fail: 100 },
  internet: { warn: 80, fail: 200 },
} as const;
// Pelanggan dianggap terdampak berbagi jalur bila trafiknya saat keluhan
// turun di bawah separuh rata-ratanya sendiri.
export const CONTENTION_DROP_RATIO = 0.5;

// "22ms379us", "1s5ms", "850us" -> milidetik.
export function rosDurationMs(v: string | undefined): number | null {
  if (!v) return null;
  let total = 0;
  let matched = false;
  for (const m of v.matchAll(/(\d+(?:\.\d+)?)(ms|us|s)/g)) {
    matched = true;
    const x = Number(m[1]);
    total += m[2] === "s" ? x * 1000 : m[2] === "ms" ? x : x / 1000;
  }
  return matched ? total : null;
}

// "1Gbps", "100Mbps", "10Gbps", "2.5Gbps" -> bit per detik.
export function rosRateBps(v: string | undefined): number | null {
  const m = /^(\d+(?:\.\d+)?)(G|M|K)bps$/.exec(v ?? "");
  if (!m) return null;
  return Number(m[1]) * (m[2] === "G" ? 1e9 : m[2] === "M" ? 1e6 : 1e3);
}

export function evaluateDefaultRoute(
  routes: Ros[],
  uplink: Ros | null,
  monitor: Ros | null,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const active = routes.filter(
    (r) => r.active === "true" && r.disabled !== "true",
  );
  const base = {
    layer: "hulu" as const,
    metric: "default_route",
    label: "Default route & link uplink",
    sourceRef,
    sampledAt,
  };
  if (!active.length) {
    return {
      ...base,
      value: "tidak ada route aktif",
      threshold: "aktif",
      comparator: "=",
      status: "fail",
      detail:
        "Tidak ada default route aktif: semua pelanggan kehilangan internet.",
    };
  }
  const iface = uplink?.name ?? "—";
  const linkOk = !monitor || monitor.status === "link-ok";
  return {
    ...base,
    value: `${iface}, ${monitor?.status ?? (uplink?.running === "true" ? "running" : "tidak running")}${monitor?.rate ? ` ${monitor.rate}` : ""}`,
    threshold: "link-ok",
    comparator: "=",
    status: uplink?.running === "false" || !linkOk ? "fail" : "ok",
    detail: `${active.length} default route aktif lewat ${active.map((r) => r["immediate-gw"] || r.gateway).join(", ")}. Link-down sejak router menyala: ${uplink?.["link-downs"] ?? "—"}.`,
  };
}

export function evaluateUplinkRate(
  name: string,
  first: Ros | null,
  second: Ros | null,
  gapSec: number,
  capacityBps: number | null,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const label = `Utilisasi uplink ${name}`;
  if (!first || !second || gapSec <= 0)
    return unchecked(
      "hulu",
      "uplink_util",
      label,
      `Antarmuka ${name} tidak terbaca pada kedua sampel.`,
      sourceRef,
    );
  // Sisi uplink: rx = dari internet (unduh pelanggan), tx = unggah.
  const down = ((n(second["rx-byte"]) - n(first["rx-byte"])) * 8) / gapSec;
  const up = ((n(second["tx-byte"]) - n(first["tx-byte"])) * 8) / gapSec;
  if (down < 0 || up < 0)
    return unchecked(
      "hulu",
      "uplink_util",
      label,
      "Penghitung antarmuka kembali ke nol di antara dua sampel.",
      sourceRef,
    );
  if (!capacityBps) {
    return unchecked(
      "hulu",
      "uplink_util",
      label,
      `Laju unduh ${mbps(down)} Mbps, unggah ${mbps(up)} Mbps, tetapi kapasitas ${name} tidak diketahui (bukan antarmuka ethernet), jadi utilisasi tidak bisa dinilai.`,
      sourceRef,
    );
  }
  const used = pct(Math.max(down, up), capacityBps);
  return {
    layer: "hulu",
    metric: "uplink_util",
    label,
    value: `unduh ${mbps(down)} Mbps, unggah ${mbps(up)} Mbps (${used}% dari ${mbps(capacityBps)} Mbps)`,
    threshold: `${UPLINK_WARN_PCT}%`,
    comparator: "<",
    status:
      used >= UPLINK_FAIL_PCT
        ? "fail"
        : used >= UPLINK_WARN_PCT
          ? "warn"
          : "ok",
    detail:
      used >= UPLINK_WARN_PCT
        ? "Uplink ke ISP/Metro hampir penuh: semua pelanggan berbagi kemacetan ini."
        : "Uplink masih longgar.",
    sourceRef,
    sampledAt,
  };
}

export function evaluatePing(
  kind: "gateway" | "internet",
  target: string,
  rows: Ros[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const metric = kind === "gateway" ? "upstream_gateway" : "upstream_internet";
  const label =
    kind === "gateway"
      ? `Kualitas ke hop ISP (${target})`
      : `Kualitas ke internet (${target})`;
  if (!rows || rows.length === 0) {
    return unchecked(
      "hulu",
      metric,
      label,
      "Ping dari router tidak menghasilkan data.",
      sourceRef,
    );
  }
  const last = rows[rows.length - 1];
  const sent = n(last?.sent);
  const received = n(last?.received);
  if (!last || sent === 0)
    return unchecked(
      "hulu",
      metric,
      label,
      "Ping dari router tidak menghasilkan data.",
      sourceRef,
    );
  const loss = Math.round(((sent - received) / sent) * 100);
  if (received === 0 && kind === "gateway") {
    return unchecked(
      "hulu",
      metric,
      label,
      `Hop ${target} tidak membalas ${sent} ping (ICMP mungkin dibatasi ISP); dinilai lewat ping ke internet.`,
      sourceRef,
    );
  }
  const rtts = rows
    .map((r) => rosDurationMs(r.time))
    .filter((x): x is number => x !== null);
  const avg = rtts.length
    ? rtts.reduce((a, b) => a + b, 0) / rtts.length
    : null;
  const jitter =
    rtts.length > 1
      ? rtts.slice(1).reduce((s, x, i) => s + Math.abs(x - rtts[i]), 0) /
        (rtts.length - 1)
      : 0;
  const lim = RTT_LIMITS[kind];
  const bad = (warn: boolean) =>
    (warn ? loss >= LOSS_WARN_PCT : loss >= LOSS_FAIL_PCT) ||
    (avg !== null && avg > (warn ? lim.warn : lim.fail)) ||
    jitter > (warn ? JITTER_WARN_MS : JITTER_FAIL_MS);
  const status: FindingStatus = bad(false) ? "fail" : bad(true) ? "warn" : "ok";
  return {
    layer: "hulu",
    metric,
    label,
    value: `loss ${loss}% (${received}/${sent}), rata-rata ${avg === null ? "—" : avg.toFixed(1)} ms, jitter ${jitter.toFixed(1)} ms`,
    threshold: `loss < ${LOSS_WARN_PCT}%, rtt ≤ ${lim.warn} ms, jitter ≤ ${JITTER_WARN_MS} ms`,
    comparator: "",
    status,
    detail:
      status === "ok"
        ? "Jalur dari router sehat."
        : kind === "gateway"
          ? "Jalur router ke hop ISP/Metro bermasalah: gangguan di sisi hulu, menerpa semua pelanggan."
          : "Jalur ke internet bermasalah walau hop ISP mungkin sehat: gangguan di jaringan ISP/upstream.",
    sourceRef,
    sampledAt,
  };
}

export interface UplinkHistory {
  // Puncak dan rata-rata laju uplink (Mbps) di sekitar keluhan dan 24 jam sebelumnya.
  peakMbps: number | null;
  avgMbps: number | null;
  dayAvgMbps: number | null;
  samples: number;
  // Laju unduh pelanggan saat keluhan dan rata-rata 24 jam (bucket aktif saja).
  customerMbps: number | null;
  customerDayMbps: number | null;
}

export function evaluateUplinkHistory(
  h: UplinkHistory,
  capacityBps: number | null,
  sourceRef: string,
  sampledAt: Date,
): Finding[] {
  const label = "Uplink di sekitar waktu keluhan";
  if (!h.samples || h.peakMbps === null) {
    return [
      unchecked(
        "hulu",
        "uplink_history",
        label,
        "Tidak ada sampel trafik uplink tersimpan di sekitar waktu keluhan.",
        sourceRef,
      ),
    ];
  }
  const capMbps = capacityBps ? capacityBps / 1e6 : null;
  const peakPct = capMbps ? pct(h.peakMbps, capMbps) : null;
  const history: Finding = {
    layer: "hulu",
    metric: "uplink_history",
    label,
    value: `puncak ${h.peakMbps.toFixed(1)} Mbps${peakPct !== null ? ` (${peakPct}%)` : ""}, rata-rata ${(h.avgMbps ?? 0).toFixed(1)} Mbps; rata-rata 24 jam ${(h.dayAvgMbps ?? 0).toFixed(1)} Mbps`,
    threshold: capMbps
      ? `${UPLINK_WARN_PCT}% dari ${capMbps.toFixed(0)} Mbps`
      : null,
    comparator: capMbps ? "<" : null,
    status:
      peakPct === null
        ? "ok"
        : peakPct >= UPLINK_FAIL_PCT
          ? "fail"
          : peakPct >= UPLINK_WARN_PCT
            ? "warn"
            : "ok",
    detail:
      peakPct !== null && peakPct >= UPLINK_WARN_PCT
        ? "Uplink jenuh saat keluhan: kemungkinan gangguan bersama karena berbagi bandwidth."
        : `Uplink tidak jenuh saat keluhan (${h.samples} sampel per detik ±15 menit).`,
    sourceRef,
    sampledAt,
  };
  if (h.customerMbps === null || !h.customerDayMbps) return [history];
  const dropped = h.customerMbps < h.customerDayMbps * CONTENTION_DROP_RATIO;
  const saturated = peakPct !== null && peakPct >= UPLINK_WARN_PCT;
  return [
    history,
    {
      layer: "hulu",
      metric: "contention",
      label: "Beban berbagi (pelanggan vs uplink)",
      value: `pelanggan ${h.customerMbps.toFixed(1)} Mbps saat keluhan, rata-rata 24 jam ${h.customerDayMbps.toFixed(1)} Mbps`,
      threshold: `≥ ${CONTENTION_DROP_RATIO * 100}% rata-rata sendiri`,
      comparator: "",
      status: dropped && saturated ? "fail" : "ok",
      detail:
        dropped && saturated
          ? "Trafik pelanggan turun bersamaan dengan jenuhnya uplink: penyebabnya berbagi bandwidth, bukan perangkat pelanggan."
          : dropped
            ? "Trafik pelanggan turun tetapi uplink tidak jenuh: penyebab bukan berbagi jalur hulu."
            : "Trafik pelanggan tidak turun dibanding kebiasaannya.",
      sourceRef,
      sampledAt,
    },
  ];
}

export function evaluateBgp(
  connections: Ros[],
  sessions: Ros[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const base = {
    layer: "hulu" as const,
    metric: "bgp",
    label: "Peer BGP",
    sourceRef,
    sampledAt,
  };
  const configured = connections.filter((c) => c.disabled !== "true");
  if (!configured.length && !sessions.length) {
    return {
      ...base,
      value: "tidak dipakai",
      threshold: null,
      comparator: null,
      status: "ok",
      detail:
        "Router tidak memakai BGP (routing ke ISP lewat default route statis).",
    };
  }
  const established = sessions.filter((s) => s.established === "true");
  const down = configured.filter(
    (c) =>
      !established.some(
        (s) =>
          (s.name ?? "").startsWith(c.name ?? "\u0000") ||
          s["remote.address"] === c["remote.address"],
      ),
  );
  const prefixes = established.map(
    (s) =>
      `${s.name ?? s["remote.address"]}: ${s["prefix-count"] ?? "?"} prefix, uptime ${s.uptime ?? "?"}`,
  );
  return {
    ...base,
    value: `${established.length} dari ${Math.max(configured.length, sessions.length)} peer established`,
    threshold: "semua established",
    comparator: "=",
    status: down.length ? "fail" : "ok",
    detail: down.length
      ? `Peer turun: ${down.map((c) => `${c.name} (${c["remote.address"] ?? "?"})`).join(", ")}. Gangguan hulu yang menerpa banyak pelanggan sekaligus.${prefixes.length ? ` Aktif: ${prefixes.join("; ")}.` : ""}`
      : `Semua peer established. ${prefixes.join("; ")}.`,
  };
}

export function evaluateIpv6(
  addresses: Ros[],
  defaultRoutes: Ros[],
  bindings: Ros[],
  iface: string | null,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const global = addresses.filter(
    (a) =>
      a.disabled !== "true" &&
      a["link-local"] !== "true" &&
      !(a.address ?? "").startsWith("::1"),
  );
  const base = {
    layer: "hulu" as const,
    metric: "ipv6",
    label: "IPv6 pelanggan",
    sourceRef,
    sampledAt,
  };
  if (!global.length) {
    return {
      ...base,
      value: "tidak dilayankan",
      threshold: null,
      comparator: null,
      status: "ok",
      detail:
        "Router tidak punya alamat IPv6 global: pelanggan memakai IPv4 saja, jadi tidak ada jalur IPv6 yang bisa gagal.",
    };
  }
  const route = defaultRoutes.some((r) => r.active === "true");
  const mine = iface ? bindings.filter((b) => b.server === iface) : [];
  return {
    ...base,
    value: `${route ? "default route ::/0 aktif" : "tanpa default route ::/0"}; prefix pelanggan ${mine.map((b) => b.address).join(", ") || "tidak ada"}`,
    threshold: "route aktif & prefix terdelegasi",
    comparator: "=",
    status: !route ? "fail" : mine.length ? "ok" : "warn",
    detail: !route
      ? "IPv6 dilayankan tetapi router tidak punya default route IPv6: aplikasi yang memilih IPv6 gagal walau IPv4 normal."
      : mine.length
        ? "Pelanggan mendapat prefix IPv6."
        : "IPv6 dilayankan tetapi pelanggan tidak mendapat prefix (DHCPv6-PD): sebagian aplikasi bisa gagal di jalur IPv6.",
  };
}

// ---------------------------------------------------------------------------
// Fase 6: trafik & NetFlow per pelanggan.
// ---------------------------------------------------------------------------

// Rata-rata saat keluhan di bawah ini x kebiasaan = penurunan; di atas = lonjakan.
export const TRAFFIC_DROP_RATIO = 0.5;
export const TRAFFIC_SPIKE_RATIO = 3;
// Satu tujuan memakan sebagian besar trafik = tersedot (unduhan besar, update, seeding).
export const PEER_DOMINANT_PCT = 80;
// Unggah melebihi separuh total = unggahan dominan.
export const UPLOAD_DOMINANT_PCT = 50;
// Banyak lawan kecil: porsi "lainnya" besar dengan flow banyak = pola P2P.
export const MANY_PEERS_SHARE_PCT = 60;
export const MANY_PEERS_FLOWS = 500;

export interface TrafficTrendInput {
  // Rata-rata unduh/unggah (Mbps) ±30 menit di sekitar keluhan dan puncaknya.
  windowDown: number | null;
  windowUp: number | null;
  windowPeakDown: number | null;
  windowPeakUp?: number | null;
  buckets: number;
  // Kebiasaan pada jam yang sama (±1 jam WIB) selama 7 hari sebelumnya:
  // pemakaian malam yang rendah bukan penurunan. Beda dengan customerDayMbps
  // Fase 5 (rata-rata 24 jam untuk membandingkan saat uplink jenuh).
  baselineDown: number | null;
  plan?: PlanLimits | null;
}

// Kebiasaan di bawah ini terlalu kecil untuk menilai penurunan.
export const TRAFFIC_MIN_BASELINE_MBPS = 1;

export function evaluateTrafficTrend(
  t: TrafficTrendInput,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const label = "Tren trafik pelanggan";
  if (!t || !t.buckets || t.windowDown === null) {
    return unchecked(
      "trafik",
      "traffic_trend",
      label,
      "Belum ada arsip trafik pelanggan di sekitar waktu keluhan (pelanggan offline atau queue tidak dipoll).",
      sourceRef,
    );
  }
  const minBaseline = trafficMinBaselineMbps(t.plan);
  const base = t.baselineDown;
  const ratio = base ? t.windowDown / base : null;
  // Penurunan hanya bermakna bila jam ini biasanya ramai.
  const meaningfulDrop =
    ratio !== null && ratio < TRAFFIC_DROP_RATIO && (base ?? 0) >= minBaseline;
  const spike = ratio !== null && ratio > TRAFFIC_SPIKE_RATIO;
  const status: FindingStatus = meaningfulDrop || spike ? "warn" : "ok";
  const planStr =
    t.plan?.downMbps != null
      ? `; paket ${t.plan.downMbps}/${t.plan.upMbps ?? "—"} Mbps`
      : "";
  const planThresh =
    t.plan?.downMbps != null
      ? ` (paket ${t.plan.downMbps}/${t.plan.upMbps ?? "—"} Mbps)`
      : "";
  return {
    layer: "trafik",
    metric: "traffic_trend",
    label,
    value: `unduh ${t.windowDown.toFixed(1)} Mbps, unggah ${(t.windowUp ?? 0).toFixed(1)} Mbps (puncak ${(t.windowPeakDown ?? 0).toFixed(1)}) ±30 mnt; kebiasaan jam ini 7 hari ${base === null ? "—" : `${base.toFixed(1)} Mbps`}${planStr}`,
    threshold: `${TRAFFIC_DROP_RATIO * 100}%–${TRAFFIC_SPIKE_RATIO * 100}% kebiasaan${planThresh}`,
    comparator: "dalam rentang",
    status,
    detail:
      ratio === null
        ? "Belum ada kebiasaan pada jam ini untuk dibandingkan."
        : ratio < TRAFFIC_DROP_RATIO && !meaningfulDrop
          ? `Trafik rendah, tetapi pada jam ini pelanggan memang biasa memakai di bawah ${minBaseline} Mbps.`
          : ratio < TRAFFIC_DROP_RATIO
            ? `Trafik turun ke ${Math.round(ratio * 100)}% dari kebiasaannya: layanan terhambat atau perangkat jarang dipakai.`
            : ratio > TRAFFIC_SPIKE_RATIO
              ? `Trafik melonjak ${ratio.toFixed(1)}× kebiasaannya: unduhan besar/streaming atau perangkat baru yang menghabiskan kecepatan.`
              : "Trafik sesuai kebiasaannya.",
    sourceRef,
    sampledAt,
  };
}

export interface FlowRow {
  direction: string;
  srcIp: string;
  dstIp: string;
  dstPort: number;
  protocol: string;
  bytes: number;
  flows: number;
}

const fmtBytes = (b: number) =>
  b >= 1e9
    ? `${(b / 1e9).toFixed(2)} GB`
    : b >= 1e6
      ? `${(b / 1e6).toFixed(1)} MB`
      : `${(b / 1e3).toFixed(0)} KB`;

// Lawan aliran: tujuan untuk unggah, sumber untuk unduh (dst_port = port layanan).
const peerOf = (r: FlowRow) =>
  `${r.direction === "up" ? r.dstIp : r.srcIp}:${r.dstPort} ${r.protocol}`;

export function evaluateFlows(
  rows: FlowRow[],
  sourceRef: string,
  sampledAt: Date,
  plan?: (PlanLimits & { peakUpMbps?: number | null }) | null,
): Finding[] {
  if (!rows || !rows.length) {
    return [
      unchecked(
        "trafik",
        "netflow_top",
        "Tujuan & protokol (NetFlow)",
        "NetFlow mengalir, tetapi tidak ada data aliran pelanggan ini di sekitar keluhan. Kemungkinan: pelanggan offline, IP sesi belum terpetakan (hanya PPPoE IPv4), atau bucket 5 menit yang sedang berjalan belum disimpan (data baru muncul ~6 menit kemudian). Data NetFlow berupa agregat 10 lawan teratas, bukan flow mentah.",
        sourceRef,
      ),
    ];
  }
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  const up = rows
    .filter((r) => r.direction === "up")
    .reduce((s, r) => s + r.bytes, 0);
  const others = rows.filter((r) => r.protocol === "lainnya");
  const othersBytes = others.reduce((s, r) => s + r.bytes, 0);
  const othersFlows = others.reduce((s, r) => s + r.flows, 0);
  const peers = new Map<string, number>();
  for (const r of rows)
    if (r.protocol !== "lainnya")
      peers.set(peerOf(r), (peers.get(peerOf(r)) ?? 0) + r.bytes);
  const top = [...peers].sort((a, b) => b[1] - a[1]);
  const share = (b: number) => (total ? Math.round((b / total) * 100) : 0);
  const topShare = top.length ? share(top[0][1]) : 0;
  const upShare = share(up);
  const othersShare = share(othersBytes);
  const base = { layer: "trafik" as const, sourceRef, sampledAt };

  const planUp = plan?.upMbps;
  const planDown = plan?.downMbps;
  const peakUp = plan?.peakUpMbps;
  const hasPlanUp = planUp != null && planUp > 0;
  const planStr = hasPlanUp ? `paket ${planDown ?? "—"}/${planUp} Mbps` : "";

  let directionStatus: FindingStatus;
  let directionThreshold: string;
  let directionValue: string;
  let directionDetail: string;

  if (hasPlanUp) {
    if (peakUp != null) {
      const nearLimit = peakUp >= (planUp * UPLOAD_NEAR_PLAN_PCT) / 100;
      directionStatus =
        upShare >= UPLOAD_DOMINANT_PCT && nearLimit ? "warn" : "ok";
      directionThreshold = `puncak unggah < ${UPLOAD_NEAR_PLAN_PCT}% paket (${((planUp * UPLOAD_NEAR_PLAN_PCT) / 100).toFixed(1)} Mbps)`;
      directionValue = `unggah ${fmtBytes(up)} (${upShare}%), unduh ${fmtBytes(total - up)} (${100 - upShare}%); puncak unggah ${peakUp.toFixed(1)} Mbps; ${planStr}`;
      directionDetail =
        directionStatus === "warn"
          ? `Unggahan dominan (${upShare}%) dan puncak unggah (${peakUp.toFixed(1)} Mbps) mendekati batas paket ${planUp} Mbps: saluran unggah jenuh dapat memperlambat seluruh koneksi.`
          : upShare >= UPLOAD_DOMINANT_PCT
            ? `Unggahan dominan (${upShare}%), tetapi puncak unggah (${peakUp.toFixed(1)} Mbps) masih di bawah batas paket ${planUp} Mbps.`
            : "Pola wajar: unduh lebih besar daripada unggah.";
    } else {
      directionStatus = upShare >= UPLOAD_DOMINANT_PCT ? "warn" : "ok";
      directionThreshold = `unggah < ${UPLOAD_DOMINANT_PCT}% (${planStr})`;
      directionValue = `unggah ${fmtBytes(up)} (${upShare}%), unduh ${fmtBytes(total - up)} (${100 - upShare}%); ${planStr}`;
      directionDetail =
        directionStatus === "warn"
          ? `Unggahan dominan (CCTV, backup, seeding), batas paket ${planUp} Mbps: bila batas unggah terlampaui, semua koneksi bisa terasa lambat.`
          : "Pola wajar: unduh lebih besar daripada unggah.";
    }
  } else {
    directionStatus = upShare >= UPLOAD_DOMINANT_PCT ? "warn" : "ok";
    directionThreshold = `unggah < ${UPLOAD_DOMINANT_PCT}%`;
    directionValue = `unggah ${fmtBytes(up)} (${upShare}%), unduh ${fmtBytes(total - up)} (${100 - upShare}%)`;
    directionDetail =
      directionStatus === "warn"
        ? "Unggahan dominan (CCTV, backup, seeding), belum dibandingkan dengan batas unggah paket: bila batas unggah terlampaui, semua koneksi bisa terasa lambat."
        : "Pola wajar: unduh lebih besar daripada unggah.";
  }

  return [
    {
      ...base,
      metric: "netflow_top",
      label: "Tujuan teratas (NetFlow)",
      value: `${fmtBytes(total)} total; ${
        top
          .slice(0, 3)
          .map(([p, b]) => `${p} ${fmtBytes(b)} (${share(b)}%)`)
          .join(", ") || "—"
      }`,
      threshold: `satu tujuan < ${PEER_DOMINANT_PCT}%`,
      comparator: "",
      status: topShare >= PEER_DOMINANT_PCT ? "warn" : "ok",
      detail:
        topShare >= PEER_DOMINANT_PCT
          ? `Trafik tersedot ke satu tujuan (${top[0][0]}, ${topShare}%): unduhan/unggahan besar, pembaruan aplikasi, atau backup yang memakan kecepatan.`
          : "Trafik tersebar ke beberapa tujuan.",
    },
    {
      ...base,
      metric: "netflow_direction",
      label: "Arah trafik (unggah vs unduh)",
      value: directionValue,
      threshold: directionThreshold,
      comparator: "",
      status: directionStatus,
      detail: directionDetail,
    },
    {
      ...base,
      metric: "netflow_peers",
      label: "Banyak lawan kecil (pola P2P)",
      value: `${othersShare}% trafik di luar 10 lawan terbesar, ${othersFlows} flow`,
      threshold: `< ${MANY_PEERS_SHARE_PCT}% atau < ${MANY_PEERS_FLOWS} flow`,
      comparator: "",
      status:
        othersShare >= MANY_PEERS_SHARE_PCT && othersFlows >= MANY_PEERS_FLOWS
          ? "warn"
          : "ok",
      detail:
        othersShare >= MANY_PEERS_SHARE_PCT && othersFlows >= MANY_PEERS_FLOWS
          ? "Trafik tersebar ke sangat banyak lawan kecil: menyerupai pola P2P/torrent atau perangkat terinfeksi (indikasi heuristik, bukan bukti)."
          : "Tidak tampak pola P2P.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Fase 7: Pengukuran aktif & baseline historis.
// ---------------------------------------------------------------------------

export const ACTIVE_PING_LOSS_WARN = 2;
export const ACTIVE_PING_LOSS_FAIL = 10;
export const ACTIVE_RTT_WARN_MS = 80;
export const TRACE_HOP_LOSS_WARN = 20;
export const RATE_SATURATION_PCT = 90;
export const RATE_UNUSED_PCT = 30;
export const RATE_BASELINE_MIN_BUCKETS = 24;
export const DNS_PROBE_NAME = "google.com";

export interface PingStats {
  sent: number;
  received: number;
  avgMs: number | null;
  maxMs: number | null;
  jitterMs: number | null;
}

export interface TraceHop {
  hop: number;
  address: string | null;
  lossPct: number;
  avgMs: number | null;
}

export interface DnsProbe {
  name: string;
  resolved: boolean;
  ms: number | null;
  error: string | null;
}

export interface RateBaselineInput {
  currentDown: number | null;
  currentUp: number | null;
  currentPeakDown: number | null;
  p95Down: number | null;
  p95Up: number | null;
  buckets: number;
  limitDown: number | null;
  limitUp: number | null;
}

// shortcut: ambang RTT global 80 ms, perbaikan per-paket di Fase 9.
export function evaluateCustomerPing(
  address: string | null,
  p: PingStats | null,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const metric = "ping_customer";
  if (!address) {
    return unchecked(
      "aktif",
      metric,
      "Ping ke pelanggan",
      "Pelanggan tidak memiliki alamat IP aktif (sesi PPPoE terputus).",
      sourceRef,
    );
  }
  const label = `Ping ke pelanggan (${address})`;
  if (!p || p.sent === 0) {
    return unchecked(
      "aktif",
      metric,
      label,
      "Ping dari router ke pelanggan tidak menghasilkan data.",
      sourceRef,
    );
  }
  const loss = Math.max(0, Math.round(((p.sent - p.received) / p.sent) * 100));
  const isFail = loss >= ACTIVE_PING_LOSS_FAIL;
  const isWarn =
    loss >= ACTIVE_PING_LOSS_WARN ||
    (p.avgMs !== null && p.avgMs >= ACTIVE_RTT_WARN_MS);
  const status: FindingStatus = isFail ? "fail" : isWarn ? "warn" : "ok";

  const avgStr = p.avgMs !== null ? `${p.avgMs.toFixed(1)} ms` : "—";
  const maxStr = p.maxMs !== null ? `, maks ${p.maxMs.toFixed(1)} ms` : "";
  const jitterStr =
    p.jitterMs !== null ? `, jitter ${p.jitterMs.toFixed(1)} ms` : "";
  const value = `loss ${loss}% (${p.received}/${p.sent}), rata-rata ${avgStr}${maxStr}${jitterStr}`;

  const detail =
    status === "ok"
      ? "Kualitas transmisi paket dan latensi ke pelanggan normal."
      : status === "fail"
        ? `Paket loss tinggi (${loss}% ≥ ${ACTIVE_PING_LOSS_FAIL}%) ke pelanggan: kemungkinan kendala fisik (kabel/radio/optik drop) atau ONT mengalami beban tinggi.`
        : loss >= ACTIVE_PING_LOSS_WARN
          ? `Terdapat paket loss (${loss}% ≥ ${ACTIVE_PING_LOSS_WARN}%) ke arah pelanggan.`
          : `Latensi rata-rata tinggi (${avgStr} ≥ ${ACTIVE_RTT_WARN_MS} ms) ke arah pelanggan.`;

  return {
    layer: "aktif",
    metric,
    label,
    value,
    threshold: `loss < ${ACTIVE_PING_LOSS_WARN}%, rtt < ${ACTIVE_RTT_WARN_MS} ms`,
    comparator: "<",
    status,
    detail,
    sourceRef,
    sampledAt,
  };
}

// shortcut: traceroute hop jump sederhana berdasarkan lonjakan max antardua hop berurutan.
export function evaluateTraceroute(
  target: string,
  hops: TraceHop[],
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const metric = "traceroute_upstream";
  const label = `Traceroute ke upstream (${target})`;
  if (!hops || hops.length === 0) {
    return unchecked(
      "aktif",
      metric,
      label,
      "Traceroute tidak menghasilkan hop (perintah gagal atau router tidak mendukung).",
      sourceRef,
    );
  }

  const lossyHop = hops.find((h) => h.lossPct >= TRACE_HOP_LOSS_WARN);
  let maxJump: number | null = null;
  let maxJumpHop: number | null = null;
  for (let i = 1; i < hops.length; i++) {
    const prev = hops[i - 1].avgMs;
    const curr = hops[i].avgMs;
    if (prev !== null && curr !== null && curr > prev) {
      const jump = curr - prev;
      if (maxJump === null || jump > maxJump) {
        maxJump = jump;
        maxJumpHop = hops[i].hop;
      }
    }
  }

  const status: FindingStatus = lossyHop ? "warn" : "ok";
  const lossText = lossyHop
    ? `, loss di hop ${lossyHop.hop} (${lossyHop.lossPct}%)`
    : "";
  const jumpText =
    maxJump !== null && maxJumpHop !== null
      ? `, lonjakan RTT terbesar +${maxJump.toFixed(1)} ms di hop ${maxJumpHop}`
      : "";
  const value = `${hops.length} hop${lossText}${jumpText}`;

  const detail = lossyHop
    ? `Terdapat kehilangan paket pada hop ${lossyHop.hop}${lossyHop.address ? ` (${lossyHop.address})` : ""}: loss ${lossyHop.lossPct}% (ambang ≥ ${TRACE_HOP_LOSS_WARN}%).`
    : `Jalur routing ke ${target} lancar (${hops.length} hop tanpa kehilangan paket signifikan).`;

  return {
    layer: "aktif",
    metric,
    label,
    value,
    threshold: `loss per hop < ${TRACE_HOP_LOSS_WARN}%`,
    comparator: "<",
    status,
    detail,
    sourceRef,
    sampledAt,
  };
}

export function evaluateDns(
  d: DnsProbe | null,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const metric = "dns_resolve";
  const name = d?.name || DNS_PROBE_NAME;
  const label = `Resolusi DNS (${name})`;

  if (!d) {
    return unchecked(
      "aktif",
      metric,
      label,
      "Resolusi DNS tidak dapat diperiksa (tidak ada data pengukuran dari router).",
      sourceRef,
    );
  }

  if (d.resolved) {
    const msStr = d.ms !== null ? `, rtt ${d.ms.toFixed(1)} ms` : "";
    return {
      layer: "aktif",
      metric,
      label,
      value: `terurai${msStr}`,
      threshold: "berhasil terurai",
      comparator: "=",
      status: "ok",
      detail: `Router berhasil mengurai nama domain ${d.name}${d.ms !== null ? ` (respons ${d.ms.toFixed(1)} ms)` : ""}.`,
      sourceRef,
      sampledAt,
    };
  }

  const err = d.error ?? "";
  const isDnsFailure =
    /dns|resolve|does not exist|nxdomain|host.*not.*found|cannot.*resolve|failure:\s*dns/i.test(
      err,
    );

  if (isDnsFailure) {
    return {
      layer: "aktif",
      metric,
      label,
      value: "gagal terurai",
      threshold: "berhasil terurai",
      comparator: "=",
      status: "fail",
      detail: `Router gagal mengurai nama domain ${d.name}: ${d.error}. DNS upstream atau cache resolver router bermasalah.`,
      sourceRef,
      sampledAt,
    };
  }

  return unchecked(
    "aktif",
    metric,
    label,
    `Pengukuran DNS dari router tidak terbaca: ${d.error || "kesalahan pembacaan"}.`,
    sourceRef,
  );
}

// shortcut: baseline 14 hari mengabaikan pola musiman (libur/akhir pekan).
export function evaluateRateBaseline(
  i: RateBaselineInput,
  sourceRef: string,
  sampledAt: Date,
): Finding[] {
  const metric = "rate_baseline";
  const label = "Baseline pemakaian & kapasitas paket";

  if (!i || i.buckets < RATE_BASELINE_MIN_BUCKETS) {
    return [
      unchecked(
        "aktif",
        metric,
        label,
        `Riwayat sampel trafik kurang (${i?.buckets ?? 0} dari minimum ${RATE_BASELINE_MIN_BUCKETS} bucket 14 hari terakhir) untuk menyusun baseline.`,
        sourceRef,
      ),
    ];
  }

  if (i.currentDown === null) {
    return [
      unchecked(
        "aktif",
        metric,
        label,
        "Tidak ada data pemakaian pelanggan di sekitar waktu keluhan.",
        sourceRef,
      ),
    ];
  }

  const peakDown = i.currentPeakDown ?? i.currentDown;
  const downUtilPct =
    i.limitDown !== null && i.limitDown > 0
      ? Math.round((peakDown / i.limitDown) * 100)
      : null;
  const upUtilPct =
    i.limitUp !== null && i.limitUp > 0 && i.currentUp !== null
      ? Math.round((i.currentUp / i.limitUp) * 100)
      : null;

  const isSaturated =
    (downUtilPct !== null && downUtilPct >= RATE_SATURATION_PCT) ||
    (upUtilPct !== null && upUtilPct >= RATE_SATURATION_PCT);
  const status: FindingStatus = isSaturated ? "warn" : "ok";

  const ratioP95Pct =
    i.p95Down !== null && i.p95Down > 0
      ? Math.round((i.currentDown / i.p95Down) * 100)
      : null;

  const utilText =
    downUtilPct !== null
      ? `puncak ${peakDown.toFixed(1)} Mbps (${downUtilPct}% dari paket ${i.limitDown} Mbps)`
      : `puncak ${peakDown.toFixed(1)} Mbps (paket tidak diketahui)`;
  const avgText = `rata-rata ${i.currentDown.toFixed(1)} Mbps`;
  const p95Text =
    ratioP95Pct !== null
      ? `${ratioP95Pct}% dari p95 sendiri 14 hari (${i.p95Down!.toFixed(1)} Mbps)`
      : "p95 14 hari tidak tersedia";
  const value = `${utilText}, ${avgText} (${p95Text})`;

  let detail: string;
  if (isSaturated) {
    if (downUtilPct !== null && downUtilPct >= RATE_SATURATION_PCT) {
      detail = `Puncak unduhan (${peakDown.toFixed(1)} Mbps) mencapai ${downUtilPct}% dari kapasitas paket (${i.limitDown} Mbps): keluhan lambat terjadi karena pemakaian menyentuh batas paket (saturasi antrean).`;
    } else {
      detail = `Unggahan (${(i.currentUp ?? 0).toFixed(1)} Mbps) mencapai ${upUtilPct}% dari kapasitas unggah paket (${i.limitUp} Mbps): antrean unggah penuh.`;
    }
  } else if (downUtilPct !== null) {
    detail = `Pemakaian pelanggan berada di bawah batas paket (${downUtilPct}% dari ${i.limitDown} Mbps).`;
  } else {
    detail =
      "Pemakaian berada dalam batas wajar terhadap riwayat mandiri pelanggan.";
  }

  const findings: Finding[] = [
    {
      layer: "aktif",
      metric,
      label,
      value,
      threshold: `puncak < ${RATE_SATURATION_PCT}% paket`,
      comparator: "<",
      status,
      detail,
      sourceRef,
      sampledAt,
    },
  ];

  if (i.limitDown !== null && i.limitDown > 0 && i.p95Down !== null) {
    const p95Pct = Math.round((i.p95Down / i.limitDown) * 100);
    if (p95Pct < RATE_UNUSED_PCT) {
      findings.push({
        layer: "aktif",
        metric: "rate_unused",
        label: "Pemanfaatan kapasitas paket",
        value: `p95 14 hari ${i.p95Down.toFixed(1)} Mbps (${p95Pct}% dari paket ${i.limitDown} Mbps)`,
        threshold: `p95 ≥ ${RATE_UNUSED_PCT}% paket`,
        comparator: "≥",
        status: "warn",
        detail: `Paket tidak terpakai/terhambat di bawah paket: p95 14 hari (${i.p95Down.toFixed(1)} Mbps) hanya ${p95Pct}% dari kapasitas paket (${i.limitDown} Mbps). Pelanggan mengeluhkan lambat meski pemakaian jauh di bawah batas paket.`,
        sourceRef,
        sampledAt,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Fase 9: Perapian & Pengerasan (Plan limits, Riwayat & Perbandingan Diagnosa)
// ---------------------------------------------------------------------------

export interface PlanLimits {
  downMbps: number | null;
  upMbps: number | null;
}

export const TRAFFIC_MIN_BASELINE_PLAN_PCT = 2; // baseline minimum = max(0.5, plan.downMbps * 2%) Mbps saat paket diketahui, selain itu 1 Mbps
export function trafficMinBaselineMbps(plan?: PlanLimits | null): number {
  if (plan?.downMbps != null && plan.downMbps > 0) {
    return Math.max(0.5, (plan.downMbps * TRAFFIC_MIN_BASELINE_PLAN_PCT) / 100);
  }
  return TRAFFIC_MIN_BASELINE_MBPS;
}

export const UPLOAD_NEAR_PLAN_PCT = 90;

export type FindingChangeKind =
  "worse" | "better" | "changed" | "new" | "gone" | "same";

export interface FindingSnapshot {
  status: FindingStatus;
  value: string | null;
  threshold: string | null;
}

export interface FindingChange {
  layer: DiagnosticLayer;
  metric: string;
  label: string;
  before: FindingSnapshot | null;
  after: FindingSnapshot | null;
  kind: FindingChangeKind;
}

export interface RunComparison {
  beforeId: string;
  afterId: string;
  beforeAt: string | null;
  afterAt: string | null;
  verdictBefore: { layer: string | null; scope: string | null };
  verdictAfter: { layer: string | null; scope: string | null };
  verdictChanged: boolean;
  changes: FindingChange[]; // kind !== "same", urut diagnosticLayers lalu metric
  sameCount: number;
}

function findingChangeKind(
  before: FindingSnapshot | null,
  after: FindingSnapshot | null,
): FindingChangeKind {
  if (!before && after) return "new";
  if (before && !after) return "gone";
  if (!before || !after) return "same";

  const s1 = before.status;
  const s2 = after.status;

  if (s1 === s2) {
    if (before.threshold !== after.threshold) return "changed";
    return "same";
  }

  if (s1 === "unchecked" || s2 === "unchecked") {
    return "changed";
  }

  if (s1 === "ok") {
    return s2 === "warn" || s2 === "fail" ? "worse" : "changed";
  }
  if (s1 === "warn") {
    if (s2 === "fail") return "worse";
    if (s2 === "ok") return "better";
    return "changed";
  }
  if (s1 === "fail") {
    if (s2 === "warn" || s2 === "ok") return "better";
    return "changed";
  }

  return "changed";
}

export function compareRuns(
  before: DiagnosticRunDto,
  after: DiagnosticRunDto,
): RunComparison {
  const layerOrder = new Map(diagnosticLayers.map((l, i) => [l.id, i]));

  const beforeMap = new Map<string, FindingDto>();
  for (const f of before.findings ?? []) {
    beforeMap.set(`${f.layer}:${f.metric}`, f);
  }

  const afterMap = new Map<string, FindingDto>();
  for (const f of after.findings ?? []) {
    afterMap.set(`${f.layer}:${f.metric}`, f);
  }

  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: FindingChange[] = [];
  let sameCount = 0;

  for (const key of allKeys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    const layer = (a?.layer ?? b?.layer) as DiagnosticLayer;
    const metric = a?.metric ?? b?.metric ?? "";
    const label = a?.label ?? b?.label ?? metric;

    const bSnap: FindingSnapshot | null = b
      ? { status: b.status, value: b.value, threshold: b.threshold }
      : null;
    const aSnap: FindingSnapshot | null = a
      ? { status: a.status, value: a.value, threshold: a.threshold }
      : null;

    const kind = findingChangeKind(bSnap, aSnap);
    if (kind === "same") {
      sameCount++;
    } else {
      changes.push({
        layer,
        metric,
        label,
        before: bSnap,
        after: aSnap,
        kind,
      });
    }
  }

  changes.sort((x, y) => {
    const oX = layerOrder.get(x.layer) ?? 999;
    const oY = layerOrder.get(y.layer) ?? 999;
    if (oX !== oY) return oX - oY;
    return x.metric.localeCompare(y.metric);
  });

  const verdictBefore = {
    layer: before.verdictLayer ?? null,
    scope: before.verdictScope ?? null,
  };
  const verdictAfter = {
    layer: after.verdictLayer ?? null,
    scope: after.verdictScope ?? null,
  };
  const verdictChanged =
    verdictBefore.layer !== verdictAfter.layer ||
    verdictBefore.scope !== verdictAfter.scope;

  return {
    beforeId: before.id,
    afterId: after.id,
    beforeAt: before.finishedAt ?? before.createdAt ?? null,
    afterAt: after.finishedAt ?? after.createdAt ?? null,
    verdictBefore,
    verdictAfter,
    verdictChanged,
    changes,
    sameCount,
  };
}

export function runSummaryText(run: DiagnosticRunDto): string {
  const lines: string[] = [];

  // Header: pelanggan, waktu, asal manual/otomatis + pemicu
  const cust =
    run.customerName &&
    run.pppoeUsername &&
    run.customerName !== run.pppoeUsername
      ? `${run.customerName} (${run.pppoeUsername})`
      : run.customerName || run.pppoeUsername || run.customerId || "—";
  const waktu = run.finishedAt ?? run.startedAt ?? run.createdAt ?? "—";
  const pemicu =
    run.triggerMode === "auto"
      ? `Otomatis${run.triggerReason ? ` · ${triggerReasonLabels[run.triggerReason] ?? run.triggerReason}` : ""}${run.triggerSourceRef ? ` (${run.triggerSourceRef})` : ""}`
      : `Manual${run.triggeredBy ? ` (${run.triggeredBy})` : ""}`;

  lines.push("=== RINGKASAN DIAGNOSA PELANGGAN ===");
  lines.push(`Pelanggan : ${cust}`);
  lines.push(`Waktu     : ${waktu}`);
  lines.push(`Pemicu    : ${pemicu}`);
  lines.push("");

  // Kesimpulan: lapisan, cakupan, detail
  const scopeLabel =
    run.verdictScope === "own"
      ? "Gangguan pelanggan sendiri"
      : run.verdictScope === "shared"
        ? "Gangguan bersama (infrastruktur/hulu)"
        : run.verdictScope === "unknown"
          ? "Belum dapat dipastikan"
          : "—";

  lines.push("--- Kesimpulan ---");
  lines.push(
    `Lapisan   : ${run.verdictLayer ? layerLabel(run.verdictLayer) : "Normal (semua lapisan aman)"}`,
  );
  lines.push(`Cakupan   : ${scopeLabel}`);
  lines.push(
    `Rincian   : ${run.verdictDetail || "Tidak ada rincian kesimpulan."}`,
  );
  lines.push("");

  // Temuan non-ok per lapisan dengan nilai + ambang
  const allFindings = run.findings ?? [];
  const badFindings = allFindings.filter(
    (f) => f.status === "warn" || f.status === "fail",
  );
  lines.push("--- Temuan Bermasalah ---");
  if (badFindings.length === 0) {
    lines.push("Tidak ada temuan bermasalah.");
  } else {
    for (const f of badFindings) {
      const statusTag = f.status === "fail" ? "[FAIL]" : "[WARN]";
      lines.push(
        `${statusTag} ${layerLabel(f.layer)} · ${f.label}: nilai=${f.value ?? "—"}, ambang=${f.threshold ?? "—"}. ${f.detail}`,
      );
    }
  }
  lines.push("");

  // Lapisan tidak dapat diperiksa + alasan
  const uncheckedFindings = allFindings.filter((f) => f.status === "unchecked");
  lines.push("--- Tidak Dapat Diperiksa ---");
  if (uncheckedFindings.length === 0) {
    lines.push("Semua lapisan dapat diperiksa.");
  } else {
    for (const f of uncheckedFindings) {
      lines.push(
        `[UNCHECKED] ${layerLabel(f.layer)} · ${f.label}: ${f.detail}`,
      );
    }
  }

  return lines.join("\n");
}
