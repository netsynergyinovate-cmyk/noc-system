export interface MapCustomer {
  id: string;
  name: string;
  customerNumber: string;
  address: string;
  region: string;
  status: "terhubung" | "isolir" | "loss" | "offline" | "unknown" | null;
  billingStatus: "lunas" | "menunggak" | "isolir" | "aktif" | "unknown" | null;
  latitude: number | null;
  longitude: number | null;
  packagePlan?: string | null;
  monthlyFee?: number | null;
  opticalPower?: number; // dBm e.g. -19.5
  onuSerial?: string;
  cpeSsid?: string;
  cpeIp?: string;
  cpeHosts?: number;
  /** ODP yang melayani pelanggan, atau ODC bila pelanggan disambung langsung dari ODC */
  odpId?: string | null;
  /** Port di ODP/ODC (odpId) tempat pelanggan dipasang, dicatat di peta; null = belum dicatat */
  odpPort?: number | null;
  onuStatus?: "online" | "offline";
  /** Mis. "HSGQ CORE 8 PON • PON 5 / ONU 12" */
  onuLocation?: string;
}

/** Rincian pelanggan dari aplikasi pusat, dimuat saat panel dibuka. null = tidak ada / gagal dimuat. */
export interface CustomerDetail {
  lastUpdatedAt: string | null;
  cpe: {
    model: string;
    manufacturer: string;
    serialNumber: string;
    softwareVersion: string;
    isOnline: boolean;
    uptimeText: string;
    wanIp: string;
    lanIp: string;
    macAddress: string;
    lastInformAt: number | null;
    rxDbm: number | null;
    txDbm: number | null;
    temperatureC: number | null;
    wifi: {
      ssid: string;
      enabled: boolean;
      security: string;
      radioFrequency: string;
      clientCount: number;
    } | null;
    hosts: {
      hostname: string;
      ip: string;
      mac: string;
      interfaceType: string;
      active: boolean;
    }[];
  } | null;
  onu: {
    model: string | null;
    serialNumber: string | null;
    description: string | null;
    rxPower: number | null;
    txPower: number | null;
    attenuation: number | null;
    status: string;
    capturedAt: string | null;
  } | null;
  billing: {
    serviceProfile: string | null;
    type: string | null;
    activeDate: string | null;
    expiredDate: string | null;
    connectivity: string | null;
    status: string | null;
  } | null;
  invoices: {
    invoiceCode: string;
    periode: string;
    dueDate: string | null;
    amount: number;
    remainingAmount: number;
    status: string;
  }[];
  payments: {
    paymentCode: string;
    payDate: string;
    amount: number;
    method: string | null;
  }[];
  alerts: {
    id: string;
    type: string;
    severity: string;
    status: string;
    title: string;
    message: string | null;
    startedAt: string;
    endedAt: string | null;
  }[];
  /** Bagian yang gagal dimuat (mis. GenieACS mati), supaya panel bisa memberi tahu */
  unavailable: string[];
}

/** Trafik live dari simple queue PPPoE di router (bit/detik); byte dihitung sejak sesi tersambung. */
export interface CustomerTraffic {
  downloadBps: number;
  uploadBps: number;
  maxDownloadBps: number;
  maxUploadBps: number;
  downloadBytes: number;
  uploadBytes: number;
  /** Waktu server membaca router (ms epoch), untuk menghitung rate dari selisih byte */
  sampledAt: number;
}

export type OltRange = "live" | "1h" | "6h" | "24h" | "7d";

/** Rincian OLT operasional: port PON, ringkasan ONU, dan trafik per PON (VLAN) dari aplikasi pusat */
export interface OltDetail {
  olt: {
    name: string;
    brand: string | null;
    status: string | null;
    lastSeenAt: string | null;
  };
  range: OltRange;
  polledAt: string | null;
  pons: {
    ponIndex: number;
    rxPower: number | null;
    txPower: number | null;
    onuOnline: number;
    onuTotal: number;
    onuOffline: number;
    /** ONU dengan Rx di bawah ambang sensitivitas */
    weakSignal: number;
    avgOnuRx: number | null;
    capturedAt: string | null;
    traffic: {
      currentDown: number;
      currentUp: number;
      peakDown: number;
      peakUp: number;
      avgDown: number;
      avgUp: number;
      /** Counter byte VLAN sejak router menyala: tx = ke pelanggan (download) */
      downTotalBytes: number;
      upTotalBytes: number;
      /** Mbps per titik; t = ms epoch */
      series: { t: number; down: number; up: number }[];
    } | null;
  }[];
  unavailable: string[];
}

export interface MapDevice {
  id: string;
  name: string;
  type: "server" | "odc" | "odp" | "pole";
  latitude: number;
  longitude: number;
  capacity: number;
  status: "normal" | "warning" | "critical" | "offline";
  parentDeviceId: string | null;
  notes?: string | null;
  /** Ringkasan port PON bila titik ini OLT operasional (dicocokkan lewat host) */
  ponPorts?: { ponIndex: number; onuOnline: number; rxPower: number | null }[];
  /** OLT operasional di aplikasi pusat yang cocok dengan titik ini (lewat host) */
  centralOlt?: { id: string; name: string };
  /** Rasio splitter ODC/ODP (1:N, nilai N) = jumlah port output; null = belum diisi */
  splitterRatio?: number | null;
  /** Splitter rasio (coupler tak seimbang) di kotak ini: persen port tap, mis. 10 = 10:90; null = tidak ada */
  splitterTap?: number | null;
  /** Port ODC tempat ODP ini dipasang; null = belum dicatat */
  odcPort?: number | null;
  connectedCustomersCount?: number;
  cablesIn?: string[];
  cablesOut?: string[];
}

export interface CableRoute {
  id: string;
  code: string;
  name: string;
  cableType: string;
  fiberCapacity: number;
  fromDeviceId: string;
  toDeviceId: string | null;
  samplingIntervalM: number;
  totalLengthM: number;
  createdAt?: string;
  /** Warna pilihan jalur; null/kosong = warna kapasitas serat */
  color?: string | null;
  /** Jalur dari aplikasi pusat: tidak bisa ditambah segmen/perangkat di peta ini */
  readOnly?: boolean;
}

export interface CableSegment {
  id: string;
  routeId: string;
  fromDeviceId: string;
  toDeviceId: string | null;
  customerId: string | null;
  sequence: number;
  geometry: [number, number][]; // [lat, lng][]
  lengthM: number;
  snapped: boolean;
  snapProvider: string;
  snapToleranceM: number;
  snappedAt: string | null;
  connectionStatus?: "terhubung" | "isolir" | "loss" | "unknown" | null;
  samples?: CableSegmentSample[];
}

export interface CableSegmentSample {
  id: string;
  segmentId: string;
  sequence: number;
  latitude: number;
  longitude: number;
  cumulativeM: number;
}

export interface HierarchyTreeNode {
  id: string;
  name: string;
  type: "server" | "odc" | "odp" | "pole" | "customer";
  latitude?: number;
  longitude?: number;
  status: string;
  children: HierarchyTreeNode[];
}

export interface MapDataResponse {
  customers: MapCustomer[];
  devices: MapDevice[];
  routes: CableRoute[];
  segments: CableSegment[];
  source: "central-api" | "local-db";
  lastUpdated: string;
}

export interface AnnotationShape {
  id: string;
  type: "rect" | "circle" | "arrow" | "label";
  coordinates: [number, number][]; // lat, lng points
  properties?: {
    text?: string;
    color?: string;
    radiusM?: number;
    strokeWidth?: number;
  };
}

export interface MapLayerItem {
  id: string;
  name: string;
  layerOrder: number;
  opacity: number;
  visible: boolean;
  shapes: AnnotationShape[];
  createdAt?: string;
  updatedAt?: string;
}

export class LayerNotFoundError extends Error {
  constructor() {
    super("Layer tidak ditemukan.");
    this.name = "LayerNotFoundError";
  }
}

export type CentralApiErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "NETWORK_DOWN"
  | "CONFIG_ERROR"
  | "CONFLICT"
  | "NOT_FOUND"
  | "NOT_SUPPORTED";

export class ClassifiedCentralApiError extends Error {
  constructor(
    public code: CentralApiErrorCode,
    message: string,
    public status: number = 500,
  ) {
    super(message);
    this.name = "ClassifiedCentralApiError";
  }
}
