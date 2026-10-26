// Sumber data tiruan Pusat Onboarding & Tutorial Wajib.
// TIRUAN SEMENTARA: Wajib dialihkan ke backend nyata saat go-live (Fase 5 / 6). Murni.

import type { DataSourceEntry } from "./setup-extended.ts";

export type OnboardingStepType = "wajib" | "opsional";
export type OnboardingStepStatus =
  | "selesai"
  | "sedang-berjalan"
  | "belum-mulai"
  | "terkunci";

export interface OnboardingStep {
  id: string;
  order: number;
  title: string;
  description: string;
  type: OnboardingStepType;
  status: OnboardingStepStatus;
  targetUrl: string;
  targetLabel: string;
  prerequisites: readonly string[];
  prerequisiteTitles?: readonly string[];
  prerequisiteId?: string;
  estimatedMinutes: number;
  category: "perangkat" | "metrik" | "billing" | "notifikasi" | "deploy";
  instruction?: string;
  cliCommand?: string;
}

export interface OnboardingTutorialGuide {
  id: string;
  title: string;
  summary: string;
  steps: readonly string[];
}

export interface OnboardingOverview {
  totalSteps: number;
  completedSteps: number;
  requiredTotal: number;
  requiredCompleted: number;
  isGatePassed: boolean;
  completionPercentage: number;
  steps: readonly OnboardingStep[];
  guides: readonly OnboardingTutorialGuide[];
}

export const ONBOARDING_CENTER_MOCK_ENTRY: DataSourceEntry = {
  id: "onboarding-center-mock",
  module: "Pusat Onboarding & Tutorial Wajib",
  targetDevice: "Alur Integrasi & Gerbang Konfigurasi NOC",
  status: "dummy",
  readPath: "src/lib/dashboard/onboarding-data.ts",
  writePath: "POST /api/onboarding/steps/{id}/complete",
  envKey: "DASHBOARD_DATA",
  notes:
    "Tiruan sementara untuk verifikasi alur tutorial & onboarding; dialihkan ke tabel database onboarding_steps saat go-live.",
};

export const MOCK_ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "step-router-mikrotik",
    order: 1,
    title: "1. Hubungkan Router MikroTik Utama (REST API v7)",
    description:
      "Langkah gerbang wajib: Masukkan IP Host, Port 443, Username, dan Password REST RouterOS v7. Uji koneksi sampai status aktif.",
    type: "wajib",
    status: "selesai",
    targetUrl: "/app/router",
    targetLabel: "Buka Pengaturan Router",
    prerequisites: [],
    prerequisiteTitles: [],
    estimatedMinutes: 5,
    category: "perangkat",
    instruction:
      "Buka menu Router > Tambah Router. Masukkan kredensial REST API v7 dan klik 'Uji Koneksi & Simpan'.",
    cliCommand: "npm run doctor",
  },
  {
    id: "step-test-router-polling",
    order: 2,
    title: "2. Verifikasi Polling Resource & Antrean Queue",
    description:
      "Langkah gerbang wajib: Pastikan sistem berhasil memantau utilisasi CPU, memori, antrean simple queues, dan statistik interface router.",
    type: "wajib",
    status: "selesai",
    targetUrl: "/app/router/queues",
    targetLabel: "Periksa Antrean Router",
    prerequisites: ["step-router-mikrotik"],
    prerequisiteTitles: ["1. Hubungkan Router MikroTik Utama"],
    prerequisiteId: "step-router-mikrotik",
    estimatedMinutes: 3,
    category: "perangkat",
    instruction:
      "Buka menu Router > Antrean. Pastikan daftar Simple Queue termuat dengan status warna hijau.",
  },
  {
    id: "step-olt-hsgq",
    order: 3,
    title: "3. Integrasikan OLT HSGQ & Pemantauan Port PON",
    description:
      "Langkah terpandu opsional: Konfigurasikan IP OLT dan pantau redaman optik port PON (TX/RX Power) serta daftar ONU terdaftar.",
    type: "opsional",
    status: "sedang-berjalan",
    targetUrl: "/app/cpe",
    targetLabel: "Kelola OLT & PON",
    prerequisites: ["step-router-mikrotik", "step-test-router-polling"],
    prerequisiteTitles: ["2. Verifikasi Polling Resource & Antrean"],
    prerequisiteId: "step-test-router-polling",
    estimatedMinutes: 8,
    category: "perangkat",
    instruction:
      "Buka menu OLT & Optik > Tambah OLT. Isi host SNMP/Telnet OLT HSGQ dan pastikan redaman ONU terbaca.",
  },
  {
    id: "step-genieacs-cpe",
    order: 4,
    title: "4. Sambungkan GenieACS NBI untuk Diagnostik CPE",
    description:
      "Langkah terpandu opsional: Hubungkan NBI URL GenieACS untuk membaca parameter modem/CPE pelanggan dan memicu tugas diagnostik.",
    type: "opsional",
    status: "belum-mulai",
    targetUrl: "/app/genieacs",
    targetLabel: "GenieACS (TR-069)",
    prerequisites: ["step-olt-hsgq"],
    prerequisiteTitles: ["3. Integrasikan OLT HSGQ & Port PON"],
    prerequisiteId: "step-olt-hsgq",
    estimatedMinutes: 10,
    category: "perangkat",
    instruction:
      "Masukkan URL NBI GenieACS (port 7557) di halaman GenieACS untuk manajemen TR-069.",
  },
  {
    id: "step-netflow-traffic",
    order: 5,
    title: "5. Aktifkan NetFlow Collector & Sampel Trafik",
    description:
      "Arahkan target NetFlow v5/v9 dari router ke collector port 2055 agar dasbor dapat menyajikan top flow dan anomali lonjakan.",
    type: "opsional",
    status: "belum-mulai",
    targetUrl: "/app/netflow",
    targetLabel: "Buka Papan NetFlow",
    prerequisites: ["step-router-mikrotik"],
    prerequisiteTitles: ["1. Hubungkan Router MikroTik Utama"],
    prerequisiteId: "step-router-mikrotik",
    estimatedMinutes: 5,
    category: "metrik",
    instruction:
      "Tambahkan target Traffic Flow di MikroTik mengarah ke IP host server NOC pada port UDP 2055.",
  },
  {
    id: "step-billing-sync",
    order: 6,
    title: "6. Sinkronisasi Data Pelanggan & Status Tagihan Billing",
    description:
      "Hubungkan scraper / API billing internal ISP untuk otomatis mendeteksi pelanggan terisolir atau selisih tagihan dengan status PPPoE.",
    type: "opsional",
    status: "belum-mulai",
    targetUrl: "/app/billing",
    targetLabel: "Buka Halaman Billing",
    prerequisites: ["step-router-mikrotik"],
    prerequisiteTitles: ["1. Hubungkan Router MikroTik Utama"],
    prerequisiteId: "step-router-mikrotik",
    estimatedMinutes: 7,
    category: "billing",
    instruction:
      "Atur variabel BILLING_URL, BILLING_USERNAME, dan BILLING_PASSWORD untuk sinkronisasi otomatis tiap jam.",
  },
  {
    id: "step-whatsapp-alert",
    order: 7,
    title: "7. Daftarkan Nomor WhatsApp Teknisi & Bot Notifikasi",
    description:
      "Masukkan API key gateway WhatsApp dan tambahkan nomor teknisi siaga untuk menerima tiket alert otomatis saat link putus.",
    type: "opsional",
    status: "belum-mulai",
    targetUrl: "/app/alert/whatsapp",
    targetLabel: "Setup WhatsApp",
    prerequisites: ["step-router-mikrotik"],
    prerequisiteTitles: ["1. Hubungkan Router MikroTik Utama"],
    prerequisiteId: "step-router-mikrotik",
    estimatedMinutes: 4,
    category: "notifikasi",
    instruction:
      "Tambahkan nomor WhatsApp penerima alert di menu Alert > WhatsApp dan jalankan tombol 'Kirim Pesan Uji'.",
  },
  {
    id: "step-deploy-safety",
    order: 8,
    title: "8. Evaluasi Pengaman Deploy & Verifikasi Go-Live",
    description:
      "Jalankan health check menyeluruh, cadangkan snapshot konfigurasi, dan pastikan verifikasi nol data dummy lulus sebelum promosi.",
    type: "wajib",
    status: "belum-mulai",
    targetUrl: "/app/uji-stack",
    targetLabel: "Periksa Uji Stack",
    prerequisites: [
      "step-router-mikrotik",
      "step-test-router-polling",
    ],
    prerequisiteTitles: [
      "1. Hubungkan Router MikroTik Utama",
      "2. Verifikasi Polling Resource",
    ],
    prerequisiteId: "step-test-router-polling",
    estimatedMinutes: 5,
    category: "deploy",
    instruction:
      "Buka menu Uji Stack dan pastikan seluruh komponen sistem berstatus SEHAT.",
    cliCommand: "npm run deploy:verify:zero-dummy",
  },
];

export const MOCK_ONBOARDING_GUIDES: readonly OnboardingTutorialGuide[] = [
  {
    id: "guide-start-from-scratch",
    title: "Panduan Cepat: Menyalakan Aplikasi dari Nol",
    summary:
      "Ikuti 4 langkah dasar untuk menyalakan kontainer dan masuk ke dasbor operasional pertama kali.",
    steps: [
      "Jalankan `npm run predev` atau siapkan file `.env` dari `.env.example`.",
      "Nyalakan database PostgreSQL via Docker Compose `npm run db:up`.",
      "Terapkan skema migrasi database otomatis `npm run db:migrate`.",
      "Buat akun operator awal via `npm run seed:accounts` lalu login di `/sign-in`.",
    ],
  },
  {
    id: "guide-mandatory-gate",
    title: "Aturan Gerbang Konfigurasi Wajib (Gatekeeper)",
    summary:
      "Mengapa sebagian fitur tertahan? Pahami mekanisme pengaman gerbang konfigurasi awal.",
    steps: [
      "Aplikasi menahan navigasi metrik langsung ke dasbor live bila router belum terhubung.",
      "Badge notifikasi 'Konfigurasi Belum Selesai' akan terus muncul di header hingga Router MikroTik lulus uji koneksi.",
      "Begitu Router terhubung (status aktif), gerbang otomatis terbuka dan seluruh modul opsional dapat diakses.",
      "Di lingkungan uji lokal (DASHBOARD_DATA=demo), gerbang ini dapat ditinjau tanpa memblokir inspeksi antarmuka.",
    ],
  },
  {
    id: "guide-troubleshooting",
    title: "Tips Mengatasi Kendala Umum Integrasi",
    summary:
      "Solusi cepat jika router atau perangkat jaringan gagal terhubung saat uji koneksi.",
    steps: [
      "Periksa apakah port REST API MikroTik (biasanya 443 atau 80) dapat dijangkau dari server aplikasi.",
      "Pastikan user MikroTik memiliki grup akses `read` dan `api` atau `write`.",
      "Jika koneksi OLT gagal, periksa apakah mode simulator aktif atau IP OLT berada pada segmen VLAN manajemen yang tepat.",
      "Lihat log detail pada menu 'Jejak Aktivitas' untuk memeriksa kode kesalahan respons perangkat.",
    ],
  },
];

/**
 * Memeriksa apakah prasyarat sebuah langkah sudah terpenuhi.
 */
export function isStepUnlocked(
  step: OnboardingStep,
  completedStepIds: ReadonlySet<string>,
): { unlocked: boolean; missingPrereqs: string[] } {
  const missingPrereqs = step.prerequisites.filter((p) => !completedStepIds.has(p));
  return {
    unlocked: missingPrereqs.length === 0,
    missingPrereqs,
  };
}

/**
 * Menghitung ulang status langkah berdasarkan daftar langkah yang telah selesai.
 * Jika prasyarat belum lengkap, langkah otomatis berstatus 'terkunci'.
 */
export function computeStepStatuses(
  steps: readonly OnboardingStep[],
  completedStepIds: ReadonlySet<string>,
): OnboardingStep[] {
  return steps.map((step) => {
    if (completedStepIds.has(step.id)) {
      return { ...step, status: "selesai" };
    }
    const check = isStepUnlocked(step, completedStepIds);
    if (!check.unlocked) {
      return { ...step, status: "terkunci" };
    }
    // Bila belum selesai dan tidak terkunci, pastikan bukan 'selesai' atau 'terkunci'
    return {
      ...step,
      status:
        step.status === "selesai" || step.status === "terkunci"
          ? "belum-mulai"
          : step.status,
    };
  });
}

/**
 * Memvalidasi apakah graf prasyarat langkah valid dan bebas dari siklus sirkular.
 */
export function validatePrerequisiteGraph(
  steps: readonly OnboardingStep[],
): { valid: boolean; cycles: string[]; missingReferences: string[] } {
  const stepIds = new Set(steps.map((s) => s.id));
  const missingReferences: string[] = [];

  for (const s of steps) {
    for (const p of s.prerequisites) {
      if (!stepIds.has(p)) {
        missingReferences.push(`Langkah ${s.id} merujuk prasyarat tak dikenal ${p}`);
      }
    }
  }

  // Deteksi siklus via DFS
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(curr: string) {
    visited.add(curr);
    recStack.add(curr);

    const step = steps.find((s) => s.id === curr);
    if (step) {
      for (const neighbor of step.prerequisites) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          cycles.push(`Siklus terdeteksi antara ${curr} dan ${neighbor}`);
        }
      }
    }

    recStack.delete(curr);
  }

  for (const s of steps) {
    if (!visited.has(s.id)) {
      dfs(s.id);
    }
  }

  return {
    valid: cycles.length === 0 && missingReferences.length === 0,
    cycles,
    missingReferences,
  };
}

/**
 * Menghitung rekapitulasi progres onboarding dan status gerbang.
 */
export function getMockOnboardingOverview(
  steps: readonly OnboardingStep[] = MOCK_ONBOARDING_STEPS,
): OnboardingOverview {
  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.status === "selesai").length;

  const requiredSteps = steps.filter((s) => s.type === "wajib");
  const requiredTotal = requiredSteps.length;
  const requiredCompleted = requiredSteps.filter((s) => s.status === "selesai").length;

  // Gerbang konfigurasi wajib lulus jika langkah router wajib sudah selesai
  const routerStep = steps.find((s) => s.id === "step-router-mikrotik");
  const isGatePassed = routerStep?.status === "selesai";

  const completionPercentage =
    totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);

  return {
    totalSteps,
    completedSteps,
    requiredTotal,
    requiredCompleted,
    isGatePassed,
    completionPercentage,
    steps,
    guides: MOCK_ONBOARDING_GUIDES,
  };
}
