import type {
  FeatureMarkerCategory,
  FeatureMarkerFrequency,
  FeatureMarkerStatus,
} from "@/validators/feature-markers";

export interface DiagnosticSourceMap {
  pageFile: string;
  componentFiles: string[];
  apiEndpoints: string[];
  serviceFiles: string[];
  validatorFiles: string[];
  hardwareOrExternalSystem?: string;
}

export interface DiagnosticContext {
  elementType: string;
  isInsideModal: boolean;
  modalName?: string;
  complexity: "Rendah (UI / Tampilan)" | "Sedang (API Fetch / Mutasi DB)" | "Tinggi (Hardware / RouterOS / Scraper)";
  featureDomain: string;
}

export interface RemediationChecklistItem {
  step: string;
  targetFile: string;
  action: string;
  codeHint?: string;
}

export interface TechnicalReport {
  markerId: string;
  featureName: string;
  category: FeatureMarkerCategory;
  frequency: FeatureMarkerFrequency;
  status: FeatureMarkerStatus;
  userNotes: string;
  sourceMap: DiagnosticSourceMap;
  context: DiagnosticContext;
  runtimeFunctionSummary: string;
  remediationChecklist: RemediationChecklistItem[];
  troubleshootingGuidance: string[];
  cliVerificationCommand?: string;
  aiPrompt: string;
}

interface RouteKnowledge {
  domain: string;
  pageFile: string;
  defaultComponents: string[];
  defaultApis: string[];
  defaultServices: string[];
  defaultValidators: string[];
  externalSystem?: string;
  keywords: Array<{
    match: RegExp;
    components?: string[];
    apis?: string[];
    services?: string[];
    validators?: string[];
    functionName: string;
    externalSystem?: string;
    complexity?: DiagnosticContext["complexity"];
  }>;
}

const ROUTE_REGISTRY: Record<string, RouteKnowledge> = {
  "/app/pelanggan": {
    domain: "Pelanggan & CPE (TR-069 / PPPoE)",
    pageFile: "src/app/(protected)/app/pelanggan/page.tsx",
    defaultComponents: [
      "src/components/dashboard/customer-table.tsx",
      "src/components/dashboard/customer-cpe-dialog.tsx",
    ],
    defaultApis: ["/api/customers", "/api/customers/[id]/detail"],
    defaultServices: [
      "src/services/customers.service.ts",
      "src/services/cpe.service.ts",
    ],
    defaultValidators: ["src/validators/cpe.ts"],
    externalSystem: "GenieACS TR-069 & MikroTik PPPoE",
    keywords: [
      {
        match: /reboot|restart/i,
        components: ["src/components/dashboard/customer-cpe-dialog.tsx"],
        apis: ["POST /api/customers/[id]/cpe/tasks"],
        services: ["src/services/cpe.service.ts (createCpeTask)"],
        functionName: "createCpeTask(cpeId, 'reboot')",
        externalSystem: "GenieACS REST API (NBI)",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
      {
        match: /wi-?fi|ssid|password/i,
        components: [
          "src/components/dashboard/cpe-wifi-form.tsx",
          "src/components/dashboard/customer-cpe-dialog.tsx",
        ],
        apis: ["PUT /api/cpe/[id]/wifi"],
        services: ["src/services/cpe.service.ts (updateCpeWifi)"],
        validators: ["src/validators/cpe.ts (updateWifiSchema)"],
        functionName: "updateCpeWifi(cpeId, wifiPayload)",
        externalSystem: "GenieACS TR-069 Parameter Tree",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
      {
        match: /isolir|blokir|unblock/i,
        components: ["src/components/dashboard/customer-table.tsx"],
        apis: ["PATCH /api/customers/[id]"],
        services: ["src/services/customers.service.ts (setCustomerStatus)"],
        functionName: "toggleCustomerIsolir(customerId)",
        externalSystem: "MikroTik RouterOS PPP Secret (profile isolir)",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
      {
        match: /traffic|trafik|sniff|capture/i,
        components: [
          "src/components/dashboard/customer-traffic-panel.tsx",
          "src/components/dashboard/customer-live-capture-panel.tsx",
        ],
        apis: ["GET /api/customers/[id]/traffic", "POST /api/customers/[id]/capture"],
        services: ["src/services/traffic.service.ts"],
        functionName: "getCustomerTrafficSamples(customerId)",
        externalSystem: "Go NetFlow / MikroTik Queue Streaming",
        complexity: "Sedang (API Fetch / Mutasi DB)",
      },
      {
        match: /tambah|daftar|create/i,
        components: ["src/components/dashboard/customer-table.tsx"],
        apis: ["POST /api/customers"],
        services: ["src/services/customers.service.ts (createCustomer)"],
        functionName: "createCustomer(data)",
        complexity: "Sedang (API Fetch / Mutasi DB)",
      },
    ],
  },
  "/app/router": {
    domain: "Manajemen Router MikroTik",
    pageFile: "src/app/(protected)/app/router/page.tsx",
    defaultComponents: [
      "src/components/dashboard/router-table.tsx",
      "src/components/dashboard/router-config-dialog.tsx",
      "src/components/dashboard/router-hardware-cards.tsx",
    ],
    defaultApis: ["/api/routers", "/api/routers/test"],
    defaultServices: [
      "src/services/routers.service.ts",
      "src/services/mikrotik.service.ts",
    ],
    defaultValidators: ["src/validators/routers.ts"],
    externalSystem: "MikroTik RouterOS API / SSH",
    keywords: [
      {
        match: /ping|latency|latensi/i,
        components: ["src/components/dashboard/router-ping-tool.tsx"],
        apis: ["POST /api/routers/test"],
        functionName: "testRouterConnection(ip, port, user, pass)",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
      {
        match: /queue|antrian|bandwidth/i,
        components: ["src/components/dashboard/simple-queue-board.tsx"],
        apis: ["GET /api/router/queues"],
        functionName: "fetchSimpleQueues(routerId)",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
      {
        match: /pppoe|secret/i,
        components: ["src/components/dashboard/router-pppoe-table.tsx"],
        apis: ["GET /api/routers/[id]/pppoe"],
        functionName: "listActivePppoeSessions(routerId)",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
    ],
  },
  "/app/billing": {
    domain: "Billing & Sinkronisasi Runsnet",
    pageFile: "src/app/(protected)/app/billing/page.tsx",
    defaultComponents: [
      "src/components/dashboard/runsnet-billing-board.tsx",
      "src/components/dashboard/billing-board.tsx",
      "src/components/dashboard/billing-customer-table.tsx",
    ],
    defaultApis: ["/api/billing", "/api/billing/runsnet/sync"],
    defaultServices: [
      "src/services/billing.service.ts",
      "src/services/runsnet-billing.service.ts",
    ],
    defaultValidators: ["src/validators/billing.ts"],
    externalSystem: "Runsnet Web Portal Scraper",
    keywords: [
      {
        match: /sync|sinkron|tarik/i,
        components: ["src/components/dashboard/runsnet-billing-board.tsx"],
        apis: ["POST /api/billing/runsnet/sync"],
        services: ["src/services/runsnet-billing.service.ts (runFullSync)"],
        functionName: "triggerRunsnetSync()",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
      {
        match: /mismatch|selisih|cocok/i,
        components: ["src/components/dashboard/billing-mismatch-list.tsx"],
        apis: ["GET /api/billing/mismatches"],
        functionName: "getBillingMismatches()",
        complexity: "Sedang (API Fetch / Mutasi DB)",
      },
    ],
  },
  "/app/anomali": {
    domain: "Deteksi Anomali & Diagnostik Jaringan",
    pageFile: "src/app/(protected)/app/anomali/page.tsx",
    defaultComponents: [
      "src/components/dashboard/anomaly-board.tsx",
      "src/components/dashboard/anomaly-detail-dialog.tsx",
      "src/components/dashboard/diagnostic-panel.tsx",
    ],
    defaultApis: ["/api/anomalies", "/api/anomalies/detect"],
    defaultServices: [
      "src/services/anomalies.service.ts",
      "src/services/diagnostics.service.ts",
    ],
    defaultValidators: ["src/validators/diagnostics.ts"],
    keywords: [
      {
        match: /diagnos|analisis|root-cause/i,
        components: ["src/components/dashboard/diagnostic-panel.tsx"],
        apis: ["POST /api/anomalies/diagnostics"],
        services: ["src/services/diagnostics.service.ts (runFullDiagnosticRun)"],
        functionName: "runDiagnosticWorkflow(anomalyId)",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
    ],
  },
  "/app/alert": {
    domain: "Alerting, WhatsApp Notifier & Insiden",
    pageFile: "src/app/(protected)/app/alert/page.tsx",
    defaultComponents: [
      "src/components/dashboard/alert-board.tsx",
      "src/components/dashboard/handle-alert-dialog.tsx",
      "src/components/dashboard/alert-ticket-dialog.tsx",
    ],
    defaultApis: ["/api/alerts", "/api/alerts/[id]/handle", "/api/whatsapp/send"],
    defaultServices: [
      "src/services/alerts.service.ts",
      "src/services/whatsapp.service.ts",
    ],
    defaultValidators: ["src/validators/whatsapp.ts"],
    externalSystem: "WhatsApp Gateway Service",
    keywords: [
      {
        match: /whatsapp|wa|kirim pesan/i,
        components: ["src/components/dashboard/whatsapp-recipients-manager.tsx"],
        apis: ["POST /api/whatsapp/send"],
        services: ["src/services/whatsapp.service.ts (sendWhatsAppAlert)"],
        functionName: "sendWhatsAppNotification(target, text)",
        complexity: "Tinggi (Hardware / RouterOS / Scraper)",
      },
      {
        match: /tangani|selesai|handle/i,
        components: ["src/components/dashboard/handle-alert-dialog.tsx"],
        apis: ["POST /api/alerts/[id]/handle"],
        services: ["src/services/alerts.service.ts (markAlertHandled)"],
        functionName: "handleAlert(alertId, operatorName)",
        complexity: "Sedang (API Fetch / Mutasi DB)",
      },
    ],
  },
  "/app/peta": {
    domain: "Peta Jaringan, ODP & Topologi Kabel",
    pageFile: "src/app/(protected)/app/peta/page.tsx",
    defaultComponents: [
      "src/components/peta/network-map.tsx",
      "src/components/peta/map-controls.tsx",
      "src/components/dashboard/customer-map.tsx",
    ],
    defaultApis: ["/api/peta/markers", "/api/infrastructure"],
    defaultServices: [
      "src/services/network-map.service.ts",
      "src/services/infrastructure.service.ts",
    ],
    defaultValidators: ["src/validators/infrastructure-placement.ts"],
    keywords: [],
  },
  "/app/deploy": {
    domain: "Server Deployment, Telemetri & System Guard",
    pageFile: "src/app/(protected)/app/deploy/page.tsx",
    defaultComponents: [
      "src/components/dashboard/deploy-dashboard.tsx",
      "src/components/dashboard/deploy-user-markers-tab.tsx",
    ],
    defaultApis: ["/api/deploy/server-status", "/api/deploy/feature-markers"],
    defaultServices: [
      "src/services/deploy-targets.service.ts",
      "src/services/feature-markers.service.ts",
    ],
    defaultValidators: ["src/validators/feature-markers.ts"],
    keywords: [],
  },
};

/**
 * Diagnostic Engine yang menghasilkan source mapping, fungsi runtime, dan
 * rekomendasi teknis perbaikan otomatis meskipun pengguna hanya memberikan
 * catatan singkat.
 */
export function generateTechnicalReport(marker: {
  id: string;
  featureName: string;
  category: FeatureMarkerCategory;
  frequency: FeatureMarkerFrequency;
  status: FeatureMarkerStatus;
  pagePath: string;
  pageTitle?: string;
  elementSelector?: string;
  elementText?: string;
  notes?: string;
}): TechnicalReport {
  const normPath = (marker.pagePath || "/app").replace(/\/+$/, "") || "/app";
  const knowledge = ROUTE_REGISTRY[normPath] || {
    domain: "Modul Aplikasi " + normPath,
    pageFile: `src/app/(protected)${normPath}/page.tsx`,
    defaultComponents: ["src/components/dashboard/"],
    defaultApis: [`/api${normPath.replace(/^\/app/, "")}`],
    defaultServices: ["src/services/"],
    defaultValidators: ["src/validators/"],
    keywords: [],
  };

  // 1. Ekstraksi konteks pop-up & elemen
  const isInsideModal =
    marker.featureName.includes("[Pop-up:") ||
    (marker.elementSelector || "").includes("dialog") ||
    (marker.elementSelector || "").includes("modal");

  let modalName: string | undefined;
  if (marker.featureName.includes("[Pop-up:")) {
    const match = marker.featureName.match(/\[Pop-up:\s*([^\]]+)\]/);
    if (match) modalName = match[1].trim();
  }

  // Tentukan jenis elemen
  let elementType = "Elemen Antarmuka";
  const sel = (marker.elementSelector || "").toLowerCase();
  const text = (marker.featureName + " " + (marker.elementText || "")).toLowerCase();

  if (sel.includes("button") || text.includes("tombol") || text.includes("klik")) {
    elementType = "Tombol Aksi (Action Button)";
  } else if (sel.includes("input") || sel.includes("textarea") || text.includes("form")) {
    elementType = "Input Formulir (Form Input)";
  } else if (sel.includes("table") || text.includes("tabel") || sel.includes("row")) {
    elementType = "Tabel Data (Data Table)";
  } else if (sel.includes("badge") || text.includes("status") || text.includes("badge")) {
    elementType = "Lencana Status (Status Badge)";
  } else if (sel.includes("card") || text.includes("kartu")) {
    elementType = "Kartu Metrik (Metric Card)";
  } else if (isInsideModal) {
    elementType = "Komponen Modal / Pop-up";
  }

  // 2. Cocokkan keyword dengan alur teknis yang berjalan
  const combinedText = `${marker.featureName} ${marker.notes || ""} ${marker.elementText || ""}`;
  const matchedKeyword = knowledge.keywords.find((k) => k.match.test(combinedText));

  // Tentukan file komponen utama
  const componentFiles = [...knowledge.defaultComponents];
  if (modalName) {
    if (modalName.toLowerCase().includes("pelanggan") || modalName.toLowerCase().includes("perangkat")) {
      if (!componentFiles.includes("src/components/dashboard/customer-cpe-dialog.tsx")) {
        componentFiles.unshift("src/components/dashboard/customer-cpe-dialog.tsx");
      }
    } else if (modalName.toLowerCase().includes("router")) {
      if (!componentFiles.includes("src/components/dashboard/router-config-dialog.tsx")) {
        componentFiles.unshift("src/components/dashboard/router-config-dialog.tsx");
      }
    } else if (modalName.toLowerCase().includes("alert")) {
      if (!componentFiles.includes("src/components/dashboard/handle-alert-dialog.tsx")) {
        componentFiles.unshift("src/components/dashboard/handle-alert-dialog.tsx");
      }
    }
  }

  if (matchedKeyword?.components) {
    for (const c of matchedKeyword.components) {
      if (!componentFiles.includes(c)) componentFiles.unshift(c);
    }
  }

  const apiEndpoints = matchedKeyword?.apis || knowledge.defaultApis;
  const serviceFiles = matchedKeyword?.services || knowledge.defaultServices;
  const validatorFiles = matchedKeyword?.validators || knowledge.defaultValidators;
  const hardwareOrExternalSystem = matchedKeyword?.externalSystem || knowledge.externalSystem;
  const complexity =
    matchedKeyword?.complexity ||
    (hardwareOrExternalSystem ? "Tinggi (Hardware / RouterOS / Scraper)" : "Sedang (API Fetch / Mutasi DB)");

  const runtimeFunctionSummary =
    matchedKeyword?.functionName ||
    `Handler event pada komponen ${componentFiles[0] || "UI"} memicu panggilan ke API ${apiEndpoints[0] || "terkait"}.`;

  // 3. Bangun Panduan Remediasi / Perbaikan Teknis
  const remediationChecklist: RemediationChecklistItem[] = [
    {
      step: "1. Periksa Event Handler di Komponen Antarmuka",
      targetFile: componentFiles[0] || knowledge.pageFile,
      action: `Buka file komponen dan cari event \`onClick\` atau \`onSubmit\` yang mengendalikan elemen ini. Pastikan state lokal, loading spinner, dan disable button aktif saat proses berlangsung.`,
      codeHint: `const [loading, setLoading] = useState(false);\nconst handleClick = async () => {\n  setLoading(true);\n  try {\n    await fetch("${apiEndpoints[0] || "/api/..."}", { method: "POST" });\n  } finally { setLoading(false); }\n};`,
    },
    {
      step: "2. Verifikasi Endpoint API & Error Handling",
      targetFile: apiEndpoints[0]
        ? `src/app${apiEndpoints[0].replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/, "")}/route.ts`
        : "src/app/api/.../route.ts",
      action: `Pastikan route API menggunakan \`withApiSession\` atau \`withApiPermission\`, memvalidasi payload dengan skema Zod, dan mengembalikan status HTTP yang benar (bukan 500 generik).`,
      codeHint: `export async function POST(req: Request) {\n  return withApiSession(req, async (session) => {\n    const body = await readJson(req);\n    const validated = schema.parse(body);\n    // eksekusi service\n  });\n}`,
    },
    {
      step: "3. Periksa Logika Service & Query Basis Data",
      targetFile: serviceFiles[0] || "src/services/...",
      action: `Periksa query Drizzle ORM atau pemanggilan ke driver eksternal (${hardwareOrExternalSystem || "Database"}). Pastikan ada try-catch terisolasi dengan timeout jaringan yang aman.`,
    },
    {
      step: "4. Uji Jalur Perbaikan via Test CLI",
      targetFile: "tests/",
      action: `Jalankan unit test spesifik untuk memvalidasi perubahan tanpa merusak alur lainnya.`,
      codeHint: `node --test tests/feature-markers-api.test.mjs`,
    },
  ];

  // 4. Panduan Troubleshooting Spesifik berdasarkan Kategori
  const troubleshootingGuidance: string[] = [];

  if (marker.category === "bug_issue") {
    troubleshootingGuidance.push(
      "Prioritas Perbaikan Bug: Pengguna melaporkan kendala pada fungsi ini. Periksa console log browser dan log server via `docker compose logs -f app` saat tombol diklik.",
      "Periksa kemungkinan Timeout jaringan atau perangkat tidak merespons (TR-069 GenieACS / MikroTik connection timeout).",
      "Sertakan toast error yang komunikatif bagi pengguna (contoh: 'Perangkat sedang offline atau tidak dapat dijangkau') agar pengguna tidak mengira aplikasi macet.",
    );
  } else if (marker.category === "used_frequently") {
    troubleshootingGuidance.push(
      "Optimasi Fitur Sering Digunakan: Fitur ini adalah alur rutin harian petugas/admin. Pertimbangkan optimasi kecepatan query atau caching data di React Query / SWR.",
      "Sediakan shortcut keyboard (seperti Enter atau kombinasi tombol cepat) agar operasional admin lebih efisien.",
      "Pertimbangkan meletakkan tombol ini di posisi yang mudah diakses pada tabel tanpa harus membuka banyak submenu modal.",
    );
  } else if (marker.category === "improvement") {
    troubleshootingGuidance.push(
      "Usulan Fitur Baru / Perbaikan Alur: Pelajari kebutuhan yang dijelaskan pengguna pada catatan untuk menyederhanakan alur kerja pengguna di lapangan.",
      "Bandingkan dengan fitur serupa di sistem ISP/NOC untuk memastikan konsistensi UX.",
    );
  } else {
    troubleshootingGuidance.push(
      "Evaluasi Fitur Jarang Digunakan: Pengguna merasa fitur ini membingungkan atau jarang terpakai. Tambahkan tooltip penjelasan atau panduan langkah singkat (helper text).",
    );
  }

  const aiPrompt = `# Task: ${marker.category === "bug_issue" ? "Perbaikan Bug" : marker.category === "improvement" ? "Pengembangan Fitur Baru" : "Optimasi Fitur"} - ${marker.featureName}

## 1. Konteks Masalah dari Lapangan
- **Fitur / Fungsi**: ${marker.featureName}
- **Lokasi Halaman**: ${normPath} (${marker.pageTitle || "Aplikasi NOC"})
- **Kategori**: ${marker.category}
- **Frekuensi Penggunaan**: ${marker.frequency}
- **Keluhan / Catatan Pengguna**:
  "${marker.notes || "Tidak ada catatan tambahan"}"

## 2. Diagnostik Elemen & Hierarki DOM
- **Jenis Elemen**: ${elementType}
- **Selector CSS**: \`${marker.elementSelector || "(Seluruh Halaman)"}\`
- **Teks Cuplikan Elemen**: "${marker.elementText || "-"}"
${modalName ? `- **Konteks Pop-up / Modal**: ${modalName}\n` : ""}- **Tingkat Kompleksitas**: ${complexity}

## 3. Peta Berkas Kode (Source Map)
- **Berkas Halaman (Route)**: \`${knowledge.pageFile}\`
- **Berkas Komponen UI Terkait**: \`${componentFiles.join("`, `")}\`
- **Endpoint API Backend**: \`${apiEndpoints.join("`, `")}\`
- **Berkas Service / DB**: \`${serviceFiles.join("`, `")}\`
${hardwareOrExternalSystem ? `- **Sistem Terhubung**: ${hardwareOrExternalSystem}\n` : ""}
## 4. Alur Fungsi Runtime
${runtimeFunctionSummary}

## 5. Langkah-Langkah Investigasi & Cara Perbaikan
${remediationChecklist.map((item, idx) => `${idx + 1}. **${item.step}** (${item.targetFile}):\n   ${item.action}${item.codeHint ? `\n   \`\`\`typescript\n   ${item.codeHint}\n   \`\`\`` : ""}`).join("\n\n")}

## 6. Rekomendasi Khusus
${troubleshootingGuidance.map((g) => `- ${g}`).join("\n")}

Mohon periksa berkas-berkas di atas dan implementasikan perbaikan/penyempurnaan fitur ini dengan kode yang tepat, bersih, dan sesuai arsitektur Next.js 16 / Drizzle ORM.`;

  return {
    markerId: marker.id,
    featureName: marker.featureName,
    category: marker.category,
    frequency: marker.frequency,
    status: marker.status,
    userNotes: marker.notes || "(Pengguna tidak menyertakan catatan tambahan)",
    sourceMap: {
      pageFile: knowledge.pageFile,
      componentFiles,
      apiEndpoints,
      serviceFiles,
      validatorFiles,
      hardwareOrExternalSystem,
    },
    context: {
      elementType,
      isInsideModal,
      modalName,
      complexity,
      featureDomain: knowledge.domain,
    },
    runtimeFunctionSummary,
    remediationChecklist,
    troubleshootingGuidance,
    cliVerificationCommand: `docker compose logs --tail=100 app | grep -i "${normPath.split("/").pop() || "app"}"`,
    aiPrompt,
  };
}
