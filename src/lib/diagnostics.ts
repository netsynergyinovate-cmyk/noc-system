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
  return {
    layer,
    metric,
    label,
    value: null,
    threshold: null,
    comparator: null,
    status: "unchecked",
    detail: reason,
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
  const source = `Router ${input.routerName} · /ppp/active · ${fmtTime(input.readAt)}`;
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
    threshold: "-24 s.d. -8 dBm",
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

// Urutan penunjuk kesimpulan: billing paling murah dan paling pasti, lalu
// gangguan hulu (bersama), lalu fisik ke logis. PPPoE putus karena LOS harus
// menyalahkan optik, bukan MikroTik.
// shortcut: aturan urutan sederhana, diganti rule engine penuh di Fase 8.
const VERDICT_ORDER: DiagnosticLayer[] = [
  "billing",
  "hulu",
  "optik",
  "ont",
  "mikrotik",
  "firewall",
  "log",
  "trafik",
];

export function pickVerdict(findings: Finding[]): {
  layer: DiagnosticLayer | null;
  detail: string;
} {
  for (const status of ["fail", "warn"] as const) {
    for (const layer of VERDICT_ORDER) {
      const f = findings.find((x) => x.layer === layer && x.status === status);
      if (f) {
        const numbers = f.value
          ? ` ${f.value} (ambang ${f.comparator ?? ""} ${f.threshold ?? ""})`.trimEnd()
          : "";
        return {
          layer,
          detail: `${status === "fail" ? "Bermasalah" : "Peringatan"} di ${layerLabel(layer)}: ${f.label}${numbers}. ${f.detail}`,
        };
      }
    }
  }
  const checked = new Set(
    findings.filter((f) => f.status !== "unchecked").map((f) => f.layer),
  );
  const blind = diagnosticLayers.filter((l) => !checked.has(l.id)).length;
  if (checked.size === 0) {
    return {
      layer: null,
      detail: "Tidak ada lapisan yang dapat diperiksa; belum ada kesimpulan.",
    };
  }
  return {
    layer: null,
    detail:
      blind > 0
        ? `Tidak ada temuan bermasalah pada ${checked.size} lapisan yang diperiksa; ${blind} lapisan tidak dapat diperiksa, jadi kesimpulan belum lengkap.`
        : "Semua lapisan normal.",
  };
}

// shortcut: jendela tetap (bukan geser); dua kejadian yang mengapit batas
// jendela bisa menghasilkan dua run. Cukup untuk menahan flapping per 15 menit.
export const autoDedupeKey = (customerId: string, nowMs: number, minutes: number) =>
  `auto:${customerId}:${Math.floor(nowMs / (minutes * 60_000))}`;

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
        if (!best || job.priority < best.priority || (job.priority === best.priority && job.seq < best.seq)) {
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
          console.error("Diagnosa gagal dijalankan:", err instanceof Error ? err.message : err),
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
      if (active.has(job.runId) || waiting.some((w) => w.runId === job.runId)) return;
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
  findings?: FindingDto[];
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
