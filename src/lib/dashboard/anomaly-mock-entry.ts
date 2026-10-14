// Entri registry untuk daftar anomali tiruan. Sengaja tanpa impor lain agar
// setup-extended.ts tetap bisa dimuat langsung oleh Node. TIRUAN SEMENTARA.
export const ANOMALY_DETECTION_MOCK_ENTRY = {
  id: "anomaly-detection-feed",
  module: "Deteksi Anomali Jaringan",
  targetDevice: "Go Rule Engine & network_logs",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/anomaly-feed.ts (loadAnomalies)",
  writePath: "-",
  envKey: "DASHBOARD_DATA",
  notes:
    "Tiruan sementara daftar anomali terdeteksi; wajib dialihkan ke Go Rule Engine di Fase 5",
};
