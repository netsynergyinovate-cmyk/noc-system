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
    // Billing pasti hanya saat gagal (isolir/putus); peringatannya (tunggakan,
    // pending) tidak menjelaskan lambat, jadi diperiksa paling akhir.
    const order = status === "fail" ? VERDICT_ORDER : [...VERDICT_ORDER.filter((l) => l !== "billing"), "billing" as const];
    for (const layer of order) {
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
  complaintAt: string | null;
  timeline: { at: string; kind: string; label: string; detail: string; source: string }[];
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
        detail: "Tidak ada simple queue untuk sesi ini: batas kecepatan tidak terpasang di router ini.",
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
    usage = unchecked("mikrotik", "queue_usage", "Pemakaian terhadap batas", "max-limit 0 (tanpa batas): persentase tidak bisa dihitung.", sourceRef);
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
    return [limit, usage, unchecked("mikrotik", "queue_drop", "Paket dibuang antrean", "Penghitung queue kembali ke nol di antara dua sampel (sesi tersambung ulang).", sourceRef)];
  }
  // Persen dari paket yang datang ke antrean (lewat + dibuang), bukan jumlah mentah.
  const lossPct = (drop: number, passed: number) => (drop + passed > 0 ? (drop / (drop + passed)) * 100 : 0);
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
    return unchecked("mikrotik", "iface_errors", label, "Antarmuka <pppoe-…> tidak terbaca pada kedua sampel.", sourceRef);
  }
  const d = (k: string) => n(second[k]) - n(first[k]);
  const errors = d("rx-error") + d("tx-error");
  const drops = d("rx-drop") + d("tx-drop");
  if (errors < 0 || drops < 0) {
    return unchecked("mikrotik", "iface_errors", label, "Penghitung antarmuka kembali ke nol di antara dua sampel (sesi tersambung ulang).", sourceRef);
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
  if (!vlanName) return unchecked("mikrotik", "pon_vlan_rate", label, "Binding PPPoE server tidak menyebut antarmuka asal sesi.", sourceRef);
  if (!first || !second || gapSec <= 0) return unchecked("mikrotik", "pon_vlan_rate", label, `Antarmuka ${vlanName} tidak terbaca pada kedua sampel.`, sourceRef);
  // tx router = menuju OLT (unduh pelanggan), rx = unggah.
  const down = ((n(second["tx-byte"]) - n(first["tx-byte"])) * 8) / gapSec;
  const up = ((n(second["rx-byte"]) - n(first["rx-byte"])) * 8) / gapSec;
  if (down < 0 || up < 0) return unchecked("mikrotik", "pon_vlan_rate", label, "Penghitung antarmuka kembali ke nol di antara dua sampel.", sourceRef);
  const used = pct(Math.max(down, up), PON_CAPACITY_MBPS * 1e6);
  return {
    layer: "mikrotik",
    metric: "pon_vlan_rate",
    label,
    value: `unduh ${mbps(down)} Mbps, unggah ${mbps(up)} Mbps (${used}% dari ${PON_CAPACITY_MBPS} Mbps)`,
    threshold: `${PON_WARN_PCT}%`,
    comparator: "<",
    status: used >= PON_FAIL_PCT ? "fail" : used >= PON_WARN_PCT ? "warn" : "ok",
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
  const others = [
    ...arp
      .filter((a) => a.interface !== pppInterface)
      .map((a) => `ARP di ${a.interface || "?"} MAC ${a["mac-address"] || "?"}`),
    ...leases.map((l) => `lease DHCP ${l.server || "?"} MAC ${l["mac-address"] || "?"}`),
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
  if (start === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(target / size) === Math.floor(start / size);
}

export function addressListMembership(ip: string, entries: Ros[]) {
  const lists = [
    ...new Set(
      entries
        .filter((e) => e.disabled !== "true" && addressContains(e.address ?? "", ip))
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

export function evaluateConntrack(tracking: Ros, sourceRef: string, sampledAt: Date): Finding {
  const total = n(tracking["total-entries"]);
  const max = n(tracking["max-entries"]);
  if (max <= 0) return unchecked("firewall", "conntrack", "Tabel connection tracking", "Router tidak melaporkan max-entries.", sourceRef);
  const used = pct(total, max);
  return {
    layer: "firewall",
    metric: "conntrack",
    label: "Tabel connection tracking",
    value: `${total} dari ${max} (${used}%)`,
    threshold: `${CONNTRACK_WARN_PCT}%`,
    comparator: "<",
    status: used >= CONNTRACK_FAIL_PCT ? "fail" : used >= CONNTRACK_WARN_PCT ? "warn" : "ok",
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
  const base = { layer: "ont" as const, sourceRef, sampledAt: Number.isNaN(age) ? null : informAt };
  if (Number.isNaN(age) || age > ONT_STALE_MS) {
    return [
      {
        ...base,
        metric: "ont_inform",
        label: "Laporan terakhir modem",
        value: Number.isNaN(age) ? "tidak ada" : `${Math.round(age / 60_000)} menit lalu`,
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
      : unchecked("ont", "ont_wan", "WAN PPPoE di modem", "Modem tidak melaporkan WAN PPPoE (mode bridge atau PPPoE dijalankan perangkat lain).", sourceRef),
  );
  out.push(
    ont.uptimeSeconds === null
      ? unchecked("ont", "ont_uptime", "Uptime modem", "Modem tidak melaporkan uptime.", sourceRef)
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
  out.push({
    ...base,
    metric: "ont_hosts",
    label: "Perangkat terhubung ke modem",
    value: `${ont.activeClients} perangkat`,
    threshold: null,
    comparator: null,
    status: "ok",
    detail: "Konteks: semua perangkat aktif berbagi kecepatan paket yang sama.",
  });
  if (ont.rxDbm === null) {
    out.push(unchecked("ont", "ont_rx", "Rx optik sisi modem", "Modem tidak melaporkan Rx optik.", sourceRef));
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
      status: s.level === "ideal" ? (mismatch ? "warn" : "ok") : s.tone === "danger" ? "fail" : "warn",
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
  invoices: { dueDate: string | null; status: string; remainingAmount: number }[],
  today: string,
  sourceRef: string,
  sampledAt: Date,
): Finding {
  const overdue = invoices.filter(
    (i) => i.status !== "paid" && i.remainingAmount > 0 && !!i.dueDate && i.dueDate < today,
  );
  const total = overdue.reduce((sum, i) => sum + i.remainingAmount, 0);
  const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
  return {
    layer: "billing",
    metric: "arrears",
    label: "Tagihan lewat jatuh tempo",
    value: overdue.length ? `${overdue.length} tagihan, ${rupiah.format(total)}` : "tidak ada",
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
    return unchecked("billing", "billing_network", label, "Status billing pelanggan tidak diketahui.", input.sourceRef);
  }
  if (input.sessionActive === null) {
    return unchecked("billing", "billing_network", label, "Router tidak terbaca.", input.sourceRef);
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
    return { ...base, value: "tidak selaras", status: "warn", detail: "Layanan diputus di billing tetapi sesi PPPoE masih aktif di router." };
  }
  if (!input.sessionActive) {
    return { ...base, value: "sesi tidak aktif", status: "ok", detail: "Tidak ada sesi aktif untuk dibandingkan dengan billing." };
  }
  if (input.isolatedInRouter === null) {
    return unchecked("billing", "billing_network", label, "Address-list router tidak terbaca.", input.sourceRef);
  }
  if (s === "isolir" && !input.isolatedInRouter) {
    return { ...base, value: "tidak selaras", status: "warn", detail: "Billing isolir tetapi IP sesi tidak di daftar isolir router: isolir belum diterapkan." };
  }
  if (s !== "isolir" && input.isolatedInRouter) {
    return {
      ...base,
      value: "tidak selaras",
      status: "fail",
      detail: `IP sesi ada di daftar isolir router padahal billing ${input.billingStatus}: pelanggan terisolir tanpa sebab billing.`,
    };
  }
  return { ...base, value: "selaras", status: "ok", detail: "Status billing sesuai keadaan sesi di router." };
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
  [/: (authenticated|connected|disconnected|terminating\.\.\.)$/, "langkah rutin sesi PPP"],
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
  for (const [re, group] of NOISE) if (re.test(m)) return { kind: "noise", noiseGroup: group };
  const out = /\blogged out, (\d+) /.exec(m);
  if (out) return { kind: "logout", sessionSec: Number(out[1]) };
  if (/\blogged out\b/.test(m)) return { kind: "logout" };
  if (/\blogged in, /.test(m)) return { kind: "login" };
  if (/could not determine remote address/.test(m)) return { kind: "no_address" };
  if (/authentication failed|login failed|bad password|peer refused|max sessions/i.test(m)) return { kind: "auth_fail" };
  if (/^\S+ link down\b/.test(m)) return { kind: "link_down" };
  if (/^\S+ link up\b/.test(m)) return { kind: "link_up" };
  if (/conflict|already in use|duplicate address|mac address changed/i.test(m)) return { kind: "addr_conflict" };
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
  const links = t.interfaces.filter(Boolean).map((i) => new RegExp(`^${escapeRe(i)} link (down|up)\\b`));
  return (line: Pick<LogLine, "message">) => who.test(line.message) || links.some((re) => re.test(line.message.trim()));
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
  const from = new Date(Math.max(complaintAt.getTime() - LOG_LOOKBACK_MS, coverageStart?.getTime() ?? 0));
  const base = { layer: "log" as const, sourceRef, sampledAt: now };
  const findings: Finding[] = [];

  const covered = coverageStart !== null && coverageStart.getTime() <= complaintAt.getTime() - LOG_MIN_COVERAGE_MS;
  const span = coverageStart ? `${fmtTime(coverageStart)} – ${fmtTime(now)}` : "tidak ada";
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
  const shortest = logouts.reduce<number | null>((m, l) => (l.sessionSec === undefined ? m : m === null ? l.sessionSec : Math.min(m, l.sessionSec)), null);
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
      "Router tidak bisa memberi alamat IP ke sesi (\"could not determine remote address\"): pool IP habis atau RADIUS tidak mengirim Framed-IP-Address, sehingga sesi langsung putus.",
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
    findings.push(count("firewall_log", "Log firewall untuk pelanggan", fw, FLAP_FAIL_COUNT, "Rule firewall yang di-log mengenai trafik pelanggan.", ""));
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
    .sort((a, b) => Math.abs(a.at.getTime() - complaintAt.getTime()) - Math.abs(b.at.getTime() - complaintAt.getTime()))
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
export function parseRouterLogTime(value: string, now: Date, offset = "+07:00"): Date | null {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
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

const negated = (v: string): [boolean, string] => (v.startsWith("!") ? [true, v.slice(1)] : [false, v]);

// Satu sisi rule (src = pelanggan sebagai pengirim, dst = sebagai tujuan).
function sideMatch(rule: Ros, side: "src" | "dst", t: FirewallTarget): "spec" | "excl" | "neutral" {
  let spec = false;
  const checks: [string | undefined, (v: string) => boolean][] = [
    [rule[`${side}-address`], (v) => addressContains(v, t.ip)],
    [rule[`${side}-address-list`], (v) => t.lists.includes(v)],
    [rule[side === "src" ? "in-interface" : "out-interface"], (v) => v === t.iface],
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
  if ((rule.action === "dst-nat" || rule.action === "netmap") && rule["to-addresses"] && addressContains(rule["to-addresses"], t.ip)) {
    return "khusus";
  }
  const chain = rule.chain ?? "";
  // input = pelanggan ke router (pengirim); output = router ke pelanggan.
  // srcnat/dstnat: pelanggan di balik NAT hanya relevan sebagai pengirim;
  // port forward ke pelanggan sudah tertangkap lewat to-addresses di atas.
  const sides: ("src" | "dst")[] = ["input", "srcnat", "dstnat"].includes(chain) ? ["src"] : chain === "output" ? ["dst"] : ["src", "dst"];
  const results = sides.map((s) => {
    const r = sideMatch(rule, s, t);
    // Sisi lawan dibatasi ke jaringan privat (modem, OLT, VPN): trafik internal,
    // bukan trafik internet pelanggan, jadi tidak dihitung "umum".
    const peer = rule[`${s === "src" ? "dst" : "src"}-address`];
    const internal = !!peer && !peer.startsWith("!") && PRIVATE_NETS.some((net) => addressContains(net, peer.split("/")[0]));
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

export function auditRules(tables: Partial<Record<FirewallTable, Ros[]>>, t: FirewallTarget): RuleHit[] {
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
        summary: SUMMARY_KEYS.filter((k) => rule[k]).map((k) => `${k}=${rule[k]}`).join(" "),
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

export function evaluateFilterBlock(hits: RuleHit[], sourceRef: string, sampledAt: Date): Finding {
  const blocks = hits.filter((h) => h.table === "filter" && active(h) && BLOCK_ACTIONS.has(h.action));
  const own = blocks.filter((h) => h.scope === "khusus");
  const firing = own.filter((h) => h.packets > 0);
  const general = blocks.filter((h) => h.scope !== "khusus");
  // Accept khusus di atas drop khusus pada chain yang sama = drop tidak tercapai.
  const shadowed = own.filter((d) =>
    hits.some((a) => a.table === "filter" && active(a) && a.scope === "khusus" && a.action === "accept" && a.chain === d.chain && a.index < d.index),
  );
  const parts = [
    firing.length ? `Memblokir dan sedang kena: ${firing.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.` : "",
    own.length - firing.length > 0 ? `Siaga (belum pernah kena): ${own.filter((h) => h.packets === 0).map(ruleName).join("; ")}.` : "",
    shadowed.length ? `Tertutup accept di atasnya: ${shadowed.map(ruleName).join("; ")}.` : "",
    general.length ? `Kebijakan umum yang juga berlaku: ${general.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.` : "",
  ].filter(Boolean);
  return {
    layer: "firewall",
    metric: "filter_block",
    label: "Rule filter yang memblokir pelanggan",
    value: `${own.length} khusus (${firing.length} sedang kena), ${general.length} umum`,
    threshold: "0 rule khusus yang kena",
    comparator: "=",
    status: firing.length ? "fail" : own.length ? "warn" : "ok",
    detail: parts.join(" ") || "Tidak ada rule filter drop/reject yang mengenai pelanggan.",
    sourceRef,
    sampledAt,
  };
}

export function evaluateRaw(hits: RuleHit[], sourceRef: string, sampledAt: Date): Finding {
  const raw = hits.filter((h) => h.table === "raw" && active(h));
  const drops = raw.filter((h) => BLOCK_ACTIONS.has(h.action) && h.scope === "khusus");
  const notrack = raw.filter((h) => h.action === "notrack");
  return {
    layer: "firewall",
    metric: "raw",
    label: "Rule raw (drop & notrack)",
    value: `${drops.length} drop, ${notrack.length} notrack`,
    threshold: "0",
    comparator: "=",
    status: drops.some((h) => h.packets > 0) ? "fail" : drops.length || notrack.length ? "warn" : "ok",
    detail:
      drops.length || notrack.length
        ? [
            drops.length ? `Raw drop (sebelum connection tracking, tidak tampak di monitoring): ${drops.map(ruleName).join("; ")}.` : "",
            notrack.length ? `Notrack: koneksi tidak dilacak sehingga NAT tidak berlaku: ${notrack.map(ruleName).join("; ")}.` : "",
          ].filter(Boolean).join(" ")
        : "Tidak ada rule raw yang mengenai pelanggan.",
    sourceRef,
    sampledAt,
  };
}

const PRIVATE_NETS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"];

export function evaluateSrcNat(hits: RuleHit[], ip: string, sourceRef: string, sampledAt: Date): Finding {
  const nat = hits.filter((h) => h.table === "nat" && h.chain === "srcnat" && active(h) && (h.action === "masquerade" || h.action === "src-nat"));
  const isPrivate = PRIVATE_NETS.some((net) => addressContains(net, ip));
  const first = nat[0];
  return {
    layer: "firewall",
    metric: "nat_src",
    label: "NAT keluar (masquerade/src-nat)",
    value: first ? `${ruleName(first)}, hit ${fmtCount(first.packets)}` : "tidak ada",
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

const ports = (v: string | undefined) => (v ?? "").split(",").map((p) => p.trim()).filter(Boolean);

export function evaluatePortForward(hits: RuleHit[], natRules: Ros[], ip: string, sourceRef: string, sampledAt: Date): Finding {
  const forwards = hits.filter((h) => h.table === "nat" && h.chain === "dstnat" && active(h) && (h.action === "dst-nat" || h.action === "netmap") && h.scope === "khusus");
  // Forward lain (ke tujuan mana pun) yang sama protokol & port & tujuan awal
  // dan berada lebih atas: forward pelanggan tidak pernah tercapai.
  const clashes: string[] = [];
  for (const f of forwards) {
    const mine = natRules[f.index];
    natRules.forEach((other, i) => {
      if (i === f.index || other.disabled === "true" || other.chain !== "dstnat" || !["dst-nat", "netmap", "redirect"].includes(other.action ?? "")) return;
      const samePort = ports(other["dst-port"]).some((p) => ports(mine["dst-port"]).includes(p));
      const sameProto = (other.protocol ?? "") === (mine.protocol ?? "");
      const sameDst = (other["dst-address"] ?? "") === (mine["dst-address"] ?? "") || !other["dst-address"] || !mine["dst-address"];
      if (samePort && sameProto && sameDst) clashes.push(`#${Math.min(i, f.index)} menutupi #${Math.max(i, f.index)} (port ${mine["dst-port"]})`);
    });
  }
  const redirects = hits.filter((h) => h.table === "nat" && h.chain === "dstnat" && active(h) && h.action === "redirect" && h.scope === "khusus");
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
      forwards.length ? `Port forward ke ${ip}: ${forwards.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.` : `Tidak ada port forward ke ${ip}.`,
      unique.length ? `Tabrakan port forward: ${unique.join(", ")}; hanya rule teratas yang berlaku.` : "",
      redirects.length ? `Redirect yang mengenai pelanggan: ${redirects.map((h) => `${ruleName(h)} hit ${fmtCount(h.packets)}`).join("; ")}.` : "",
    ].filter(Boolean).join(" "),
    sourceRef,
    sampledAt,
  };
}

export function evaluateFasttrack(hits: RuleHit[], connections: Ros[], sourceRef: string, sampledAt: Date): Finding {
  const rules = hits.filter((h) => h.table === "filter" && active(h) && h.action === "fasttrack-connection");
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

export function evaluateCustomerConnections(outbound: Ros[], inbound: Ros[], tracking: Ros | null, sourceRef: string, sampledAt: Date): Finding {
  if (tracking && tracking.enabled === "no") {
    return {
      layer: "firewall",
      metric: "conntrack_customer",
      label: "Koneksi pelanggan di connection tracking",
      value: "tracking mati",
      threshold: "aktif",
      comparator: "=",
      status: "fail",
      detail: "Connection tracking dimatikan: NAT dan rule berbasis state tidak berjalan.",
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

export function evaluateMangle(hits: RuleHit[], queue: Ros | null, connections: Ros[], sourceRef: string, sampledAt: Date): Finding {
  const marks = hits.filter((h) => h.table === "mangle" && active(h) && h.action.startsWith("mark-"));
  const needed = (queue?.["packet-marks"] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const produced = new Set(
    marks.flatMap((h) => [...h.summary.matchAll(/new-packet-mark=(\S+)/g)].map((m) => m[1])),
  );
  const missing = needed.filter((m) => !produced.has(m));
  const connMarks = [...new Set(connections.map((c) => c["connection-mark"]).filter(Boolean))];
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
      connMarks.length ? `Connection-mark pada koneksi pelanggan: ${connMarks.join(", ")}.` : "",
    ].filter(Boolean).join(" "),
    sourceRef,
    sampledAt,
  };
}

export function evaluateStaleRules(hits: RuleHit[], sourceRef: string, sampledAt: Date): Finding {
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
