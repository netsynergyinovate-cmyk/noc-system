import "server-only";

export interface NodeLegendItem {
  id: string;
  name: string;
  category: "customer" | "infrastructure";
  color: string;
  badgeClass?: string;
  description: string;
  threshold?: string;
}

export interface CableLegendItem {
  id: string;
  category: "backbone" | "feeder" | "distribution" | "drop" | "highlight";
  label: string;
  coreRange: string;
  baseWeight: number;
  color: string;
  haloColor?: string;
  dashArray?: string;
  description: string;
  isHighlighted?: boolean;
}

export interface LodLegendItem {
  level: "overview" | "regional" | "detail";
  zoomRange: string;
  description: string;
  visibleLayers: string[];
}

export interface GestureLegendItem {
  id: string;
  action: string;
  trigger: string;
  description: string;
}

export interface MapLegendMetadata {
  title: string;
  version: string;
  nodes: {
    customers: NodeLegendItem[];
    infrastructure: NodeLegendItem[];
  };
  cables: CableLegendItem[];
  lod: LodLegendItem[];
  gestures: GestureLegendItem[];
  dataSource: {
    provider: string;
    isRealData: boolean;
    generatedAt: string;
  };
}

/**
 * Menyusun metadata resmi legenda peta, status redaman, simbol infrastruktur, dan hierarki kabel serat optik.
 */
export function getMapLegendMetadata(): MapLegendMetadata {
  const customerNodes: NodeLegendItem[] = [
    {
      id: "customer-online",
      name: "Pelanggan Online (Normal)",
      category: "customer",
      color: "#10b981",
      badgeClass: "bg-emerald-500",
      description: "Sesi PPPoE aktif di Router Mikrotik dengan redaman optik sehat (> -23.0 dBm).",
      threshold: "> -23.0 dBm",
    },
    {
      id: "customer-warning",
      name: "Redaman Optik Kritis (Warning)",
      category: "customer",
      color: "#f59e0b",
      badgeClass: "bg-amber-500",
      description: "Daya terima RX <= -24.5 dBm. Potensi koneksi lambat atau drop akibat tekukan serat optik.",
      threshold: "<= -24.5 dBm",
    },
    {
      id: "customer-isolir",
      name: "Status Terisolir",
      category: "customer",
      color: "#f43f5e",
      badgeClass: "bg-rose-500",
      description: "Tagihan bulanan belum diselesaikan; trafik dialihkan ke halaman isolir.",
      threshold: "Unpaid / Past-due",
    },
    {
      id: "customer-offline",
      name: "Pelanggan Offline",
      category: "customer",
      color: "#64748b",
      badgeClass: "bg-slate-500",
      description: "Sesi PPPoE terputus atau ONU padam (Loss of Signal / Dying Gasp).",
      threshold: "No active session",
    },
  ];

  const infrastructureNodes: NodeLegendItem[] = [
    {
      id: "infra-core-router",
      name: "Core Router Gateway",
      category: "infrastructure",
      color: "#6366f1",
      badgeClass: "bg-indigo-600",
      description: "Router BGP/Gateway sentral internet upstream ISP.",
    },
    {
      id: "infra-olt",
      name: "OLT (Optical Line Terminal)",
      category: "infrastructure",
      color: "#a855f7",
      badgeClass: "bg-purple-600",
      description: "Perangkat pemancar optik sentral GPON menuju segmen distribusi lapangan.",
    },
    {
      id: "infra-odc",
      name: "ODC (Optical Distribution Cabinet)",
      category: "infrastructure",
      color: "#0ea5e9",
      badgeClass: "bg-sky-500",
      description: "Kabinet distribusi optik primer (splitter 1:4 atau 1:8).",
    },
    {
      id: "infra-odp",
      name: "ODP (Optical Distribution Point)",
      category: "infrastructure",
      color: "#f59e0b",
      badgeClass: "bg-amber-500",
      description: "Kotak pembagi pasif di tiang (splitter 1:8 atau 1:16) tempat sambungan roset rumah.",
    },
    {
      id: "infra-pole",
      name: "Tiang Tumpu Fiber",
      category: "infrastructure",
      color: "#64748b",
      badgeClass: "bg-slate-500",
      description: "Titik penahan bentangan kabel udara antar-jalan (pole span).",
    },
  ];

  const cableItems: CableLegendItem[] = [
    {
      id: "cable-backbone",
      category: "backbone",
      label: "48 - 96 Core (Backbone Utama)",
      coreRange: "48 - 144 Core",
      baseWeight: 5.0,
      color: "#8b5cf6",
      haloColor: "#c084fc",
      dashArray: "8, 6",
      description: "Kabel backbone kapasitas tinggi penghubung Core Router ke OLT Sentral dan Kabinet ODC.",
    },
    {
      id: "cable-feeder-main",
      category: "feeder",
      label: "24 Core (Feeder Utama)",
      coreRange: "24 - 47 Core",
      baseWeight: 4.0,
      color: "#6366f1",
      haloColor: "#a5b4fc",
      dashArray: "7, 5",
      description: "Kabel feeder utama penghubung OLT menuju kabinet pasif primer ODC di tiap pusat wilayah.",
    },
    {
      id: "cable-feeder-dist",
      category: "feeder",
      label: "16 Core (Feeder Distribusi)",
      coreRange: "12 - 23 Core",
      baseWeight: 3.2,
      color: "#06b6d4",
      haloColor: "#67e8f9",
      description: "Kabel feeder distribusi penghubung dari ODC menuju kotak-kotak pembagi ODP di tiang jalan.",
    },
    {
      id: "cable-branch",
      category: "distribution",
      label: "4 - 8 Core (Distribusi Cabang)",
      coreRange: "4 - 11 Core",
      baseWeight: 2.5,
      color: "#f59e0b",
      haloColor: "#fde68a",
      dashArray: "6, 4",
      description: "Kabel distribusi percabangan loop antar-tiang dan ODP sekunder di tingkat gang/lorong.",
    },
    {
      id: "cable-drop",
      category: "drop",
      label: "1 - 2 Core (Drop Optik Pelanggan)",
      coreRange: "1 - 3 Core",
      baseWeight: 1.8,
      color: "#10b981",
      haloColor: "#6ee7b7",
      description: "Kabel drop udara berpelindung kawat baja dari port ODP menuju roset rumah pelanggan.",
    },
    {
      id: "cable-highlight",
      category: "highlight",
      label: "Jalur Disorot (Koneksi Aktif Terpilih)",
      coreRange: "Koneksi Aktif",
      baseWeight: 3.5,
      color: "#22d3ee",
      haloColor: "#a5f3fc",
      description: "Menyala terang dengan pulsa biru kehijauan saat titik perangkat atau pelanggan diinspeksi.",
      isHighlighted: true,
    },
  ];

  const lodItems: LodLegendItem[] = [
    {
      level: "overview",
      zoomRange: "Zoom 1 - 11",
      description: "Tampilan makro wilayah kabupaten/kecamatan. Mengutamakan performa rendering kanvas.",
      visibleLayers: ["Backbone Utama (48-96C)", "Feeder Utama (24C)", "Kabel Status Gangguan"],
    },
    {
      level: "regional",
      zoomRange: "Zoom 12 - 14",
      description: "Tampilan tingkat desa/kelurahan untuk pemantauan rute distribusi antar-kabinet ODC.",
      visibleLayers: ["Backbone", "Feeder Primer", "Distribusi Cabang (4-8C)", "Kabel Offline"],
    },
    {
      level: "detail",
      zoomRange: "Zoom 15 - 22",
      description: "Tampilan mikro jalan raya dan gang. Menampilkan seluruh hierarki kabel hingga roset pelanggan.",
      visibleLayers: ["Semua Kabel", "Drop Core Pelanggan (1-2C)", "Titik Rumah Pelanggan", "Tiang Span"],
    },
  ];

  const gestureItems: GestureLegendItem[] = [
    {
      id: "gesture-pan",
      action: "Geser Peta (Pan)",
      trigger: "Klik kiri tahan & seret mouse / Sentuh & geser jari",
      description: "Menjelajahi area geografis jaringan.",
    },
    {
      id: "gesture-zoom",
      action: "Perbesar / Perkecil (Zoom)",
      trigger: "Roda putar mouse / Cubit dua jari (pinch-to-zoom) / Tombol +/-",
      description: "Mengubah level detail topologi dari makro ke mikro.",
    },
    {
      id: "gesture-inspect",
      action: "Inspeksi Titik / Kabel",
      trigger: "Klik pada ikon titik pelanggan, ODP, atau segmen kabel",
      description: "Membuka panel samping rincian redaman, OLT port, dan menyorot jalur transmisi.",
    },
    {
      id: "gesture-cull-toggle",
      action: "Optimasi Viewport & LOD",
      trigger: "Saklar switch pada kontrol mengambang kanan atas",
      description: "Menyalakan atau mematikan penyembunyian titik dan kabel di luar layar.",
    },
  ];

  return {
    title: "Legenda & Simbol Resmi Peta Topologi Jaringan FTTH",
    version: "1.0.0",
    nodes: {
      customers: customerNodes,
      infrastructure: infrastructureNodes,
    },
    cables: cableItems,
    lod: lodItems,
    gestures: gestureItems,
    dataSource: {
      provider: "NOC Topologi Config Engine",
      isRealData: true,
      generatedAt: new Date().toISOString(),
    },
  };
}
