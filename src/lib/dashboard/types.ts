export type BillingStatus = "lunas" | "isolir";

// Warna titik di peta: hijau = ok, kuning = perlu perhatian, merah = gangguan.
export type CustomerHealth = "ok" | "warning" | "critical";

export interface DashboardRouter {
  id: string;
  name: string;
  host: string;
  active: boolean;
}

export interface DashboardCustomer {
  id: string;
  name: string;
  pppoeUsername: string;
  routerId: string;
  address: string;
  // Nama ODP atau lokasi tempat pelanggan tersambung; kosong bila belum diketahui.
  odpName: string;
  latitude: number;
  longitude: number;
  billingStatus: BillingStatus;
  // Rx power ONU dalam dBm, makin negatif makin lemah.
  opticalPowerDbm: number;
  isOnline: boolean;
  isLos?: boolean;
  // Paket langganan (Mbps) dari profil layanan pelanggan.
  planMbps: number;
}

// Kolom sejajar supaya langsung bisa dipakai uPlot (times + beberapa seri).
export interface TrafficSeries {
  times: number[];
  rx: number[];
  tx: number[];
}

export type IncidentKind = "offline" | "optical" | "queue" | "cpu" | "port";
export type IncidentSeverity = "info" | "warning" | "critical";

// Satu gangguan yang ditandai pada grafik. Bentuknya mengikuti tabel
// network_logs: waktu dalam detik epoch, endedAt kosong berarti masih berjalan.
export interface Incident {
  id: string;
  kind: IncidentKind;
  severity: IncidentSeverity;
  startedAt: number;
  endedAt: number | null;
}

// Satu sampel traffic total (Mbps) pada waktu `time` (detik epoch).
export interface TrafficPoint {
  time: number;
  rx: number;
  tx: number;
}

export interface StatusChange {
  customerId: string;
  isOnline: boolean;
}

// Status tagihan satu pelanggan yang berganti setelah sinkron billing selesai.
export interface BillingStatusChange {
  customerId: string;
  status: BillingStatus;
}

// Pesan realtime dari sumber data: snapshot saat tersambung, lalu delta
// tiap detik. Bentuk yang sama akan dikirim WebSocket backend nanti.
export interface DashboardSnapshot {
  customers: DashboardCustomer[];
  routers: DashboardRouter[];
  traffic: TrafficSeries;
}

export interface DashboardDelta {
  // null bila tidak ada router yang melapor pada detik itu (backend Go).
  traffic: TrafficPoint | null;
  statusChanges: StatusChange[];
  // Hanya pada detik saat sinkron billing yang berhasil mengubah status; tidak
  // ada berarti tidak ada yang berubah.
  billingChanges?: BillingStatusChange[];
}

export type ConnectionStatus = "connecting" | "live" | "disconnected";

// Permintaan agar peta menyorot satu pelanggan dan bergeser ke titiknya (mis.
// dari daftar gangguan atau tautan notifikasi).
export interface MapFocusRequest {
  // Naik tiap permintaan, supaya meminta pelanggan yang sama dua kali tetap
  // menggeser peta lagi, misalnya setelah pengguna menggesernya sendiri.
  seq: number;
  customerId: string;
}
