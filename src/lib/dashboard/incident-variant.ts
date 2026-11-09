import { describeAnomaly } from "./anomalies.ts";
import type { IncidentCard } from "./incident-cards";

// Jenis insiden yang dibedakan di kartu (warna dan ikon sendiri-sendiri). Ia
// lebih halus dari IncidentKind: "optical" terbelah menjadi redaman naik dan
// tanpa sinyal, "offline" terbelah menjadi isolir billing dan PPPoE putus.
export type IncidentVariantId =
  | "los"
  | "redaman"
  | "isolir"
  | "offline"
  | "queue"
  | "cpu"
  | "port"
  | "router"
  | "noread";

export interface IncidentVariant {
  id: IncidentVariantId;
  label: string;
  // Kesimpulan satu kalimat, aturan tetap per jenis (bukan probabilitas).
  conclusion: string;
  // Langkah pertama yang disarankan.
  action: string;
}

// Data pelanggan yang dibutuhkan untuk membedakan; sebagian kecil dari
// DashboardCustomer supaya mudah diuji.
export interface VariantCustomer {
  billingStatus: "lunas" | "isolir" | string;
  opticalPowerDbm: number | null;
}

// Rx di bawah ini dianggap tidak ada cahaya sama sekali (ONU tidak melihat OLT).
const NO_LIGHT_DBM = -40;

const variants: Record<IncidentVariantId, IncidentVariant> = {
  los: {
    id: "los",
    label: "Tanpa sinyal (LOS)",
    conclusion:
      "ONU tidak menerima cahaya dari OLT. Kemungkinan kabel putus, konektor lepas, atau ONU mati.",
    action: "Cek kabel drop dan konektor di ODP, lalu kondisi daya ONU.",
  },
  redaman: {
    id: "redaman",
    label: "Redaman naik",
    conclusion:
      "Sinyal optik melemah tetapi masih tersambung; redaman mendekati batas.",
    action: "Periksa kebersihan konektor, tikungan kabel, dan redaman ODP.",
  },
  isolir: {
    id: "isolir",
    label: "Isolir billing",
    conclusion:
      "Layanan dibatasi karena tagihan belum dibayar; ini bukan gangguan jaringan.",
    action: "Konfirmasi status pembayaran di sistem billing.",
  },
  offline: {
    id: "offline",
    label: "PPPoE putus",
    conclusion:
      "Sesi PPPoE pelanggan tidak aktif lebih dari 30 detik dan tidak ada tanda isolir atau LOS.",
    action: "Cek modem pelanggan dan jalur PPPoE di router.",
  },
  queue: {
    id: "queue",
    label: "Jalur penuh",
    conclusion:
      "Pemakaian antrean di atas 95%; paket pelanggan terpakai penuh.",
    action: "Periksa pemakaian dan batas paket di simple queue.",
  },
  cpu: {
    id: "cpu",
    label: "Router terbebani",
    conclusion: "CPU router di atas 85% dalam beberapa menit.",
    action: "Periksa proses dan beban koneksi di router.",
  },
  port: {
    id: "port",
    label: "Error port",
    conclusion: "Error interface di atas 20 per menit.",
    action: "Periksa kabel, SFP, dan duplex port tersebut.",
  },
  router: {
    id: "router",
    label: "Router tidak terjangkau",
    conclusion:
      "Router tidak menjawab; pelanggan di bawahnya berisiko ikut terdampak.",
    action: "Cek daya, link uplink, dan akses REST router.",
  },
  noread: {
    id: "noread",
    label: "Sinyal optik lemah",
    conclusion:
      "Rx di bawah batas -25 dBm; nilai pastinya belum diterima dari backend.",
    action: "Cek nilai Rx dan status ONU di OLT, lalu redaman jalur kabel.",
  },
};

// Penjelasan sesuai penyebab bersama; dipakai bila kartu menggabungkan alert.
const groupedConclusion: Partial<Record<IncidentCard["cause"], string>> = {
  odp: "Beberapa pelanggan di satu ODP terganggu bersamaan; periksa ODP dan kabel feeder-nya.",
  router:
    "Beberapa pelanggan di satu router terganggu bersamaan; periksa router dan uplink-nya.",
  uplink:
    "Gangguan terjadi di jalur uplink; periksa link upstream sebelum perangkat pelanggan.",
};

export interface ClassifiedIncident extends IncidentVariant {
  // Nilai ukur terparah dalam bahasa petugas, atau null (mis. offline).
  metric: string | null;
}

// Murni: bentuk kartu + data pelanggan -> jenis, kesimpulan, dan nilai ukur.
export function classifyIncident(
  card: IncidentCard,
  customers: ReadonlyMap<string, VariantCustomer>,
): ClassifiedIncident {
  const kind = card.kinds[0]?.kind ?? card.alerts[0]?.kind ?? "offline";
  const alerts = card.alerts.filter((alert) => alert.kind === kind);
  const first = alerts[0] ?? card.alerts[0];
  const customer = first?.customerId
    ? customers.get(first.customerId)
    : undefined;

  let id: IncidentVariantId;
  switch (kind) {
    case "optical": {
      const dbm = first?.measured ?? null;
      // Hanya pembacaan nyata yang menandakan tidak ada cahaya; Rx kosong atau 0
      // berarti nilai pastinya belum sampai, jadi tidak dituduh kabel putus.
      id =
        dbm === null || dbm >= -1
          ? "noread"
          : dbm <= NO_LIGHT_DBM
            ? "los"
            : "redaman";
      break;
    }
    case "offline":
      if (!first?.customerId) id = "router";
      else if (customer?.billingStatus === "isolir") id = "isolir";
      else if (
        customer?.opticalPowerDbm != null &&
        customer.opticalPowerDbm <= NO_LIGHT_DBM
      )
        id = "los";
      else id = "offline";
      break;
    default:
      id = kind;
  }

  const variant = variants[id];
  const conclusion =
    card.alertCount > 1
      ? (groupedConclusion[card.cause] ?? variant.conclusion)
      : variant.conclusion;
  return {
    ...variant,
    conclusion,
    metric: first && first.measured !== null ? describeAnomaly(first) : null,
  };
}
