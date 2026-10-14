import fs from "node:fs";
import path from "node:path";

const pending = JSON.parse(fs.readFileSync(".ngodingpakeai/pending.json", "utf8"));
const summariesPath = ".ngodingpakeai/summaries.json";
const summaries = fs.existsSync(summariesPath)
  ? JSON.parse(fs.readFileSync(summariesPath, "utf8"))
  : {};

function getSummaryForFile(filePath) {
  const norm = filePath.replace(/\\/g, "/");

  if (norm.startsWith("src/app/(protected)/app/")) {
    const pageName = norm.replace("src/app/(protected)/app/", "").replace("/page.tsx", "");
    return `Halaman dasbor dilindungi untuk ${pageName} pada sistem NOC ISP. Mengintegrasikan komponen antarmuka pengguna dengan backend data jaringan nyata.`;
  }
  if (norm.startsWith("src/app/api/")) {
    const endpoint = norm.replace("src/app/api/", "").replace("/route.ts", "");
    return `Endpoint REST API route /api/${endpoint} untuk modul backend NOC. Mengelola permintaan HTTP dan validasi data sesi pengguna.`;
  }
  if (norm.startsWith("src/services/")) {
    const svc = path.basename(norm, ".ts");
    return `Lapisan service domain ${svc} untuk logika bisnis server NOC ISP. Berinteraksi dengan basis data PostgreSQL dan API perangkat.`;
  }
  if (norm.startsWith("src/db/schema/")) {
    const tbl = path.basename(norm, ".ts");
    return `Definisi skema tabel Drizzle ORM ${tbl} untuk basis data PostgreSQL NOC ISP. Menentukan kolom, relasi, tipe data, dan indeks.`;
  }
  if (norm.startsWith("src/lib/dashboard/")) {
    const mod = path.basename(norm, path.extname(norm));
    return `Modul pustaka dasbor ${mod} untuk pemrosesan status metrik dan integrasi antarmuka NOC ISP.`;
  }
  if (norm.startsWith("src/lib/")) {
    const mod = path.basename(norm, path.extname(norm));
    return `Utilitas pustaka ${mod} untuk enkripsi, konektivitas perangkat, dan helper backend sistem NOC.`;
  }
  if (norm.startsWith("src/components/dashboard/")) {
    const comp = path.basename(norm, path.extname(norm));
    return `Komponen antarmuka pengguna dasbor ${comp} untuk visualisasi status jaringan dan kontrol operasional operator.`;
  }
  if (norm.startsWith("src/components/ui/")) {
    const comp = path.basename(norm, path.extname(norm));
    return `Komponen UI primitif ${comp} berbasis Tailwind CSS dan Radix UI untuk antarmuka pengguna aplikasi NOC.`;
  }
  if (norm.startsWith("src/components/")) {
    const comp = path.basename(norm, path.extname(norm));
    return `Komponen React ${comp} untuk antarmuka aplikasi NOC ISP.`;
  }
  if (norm.startsWith("drizzle/meta/")) {
    const snap = path.basename(norm);
    return `Snapshot metadata skema migrasi Drizzle Kit (${snap}) untuk pelacakan versi basis data relasional.`;
  }
  if (norm.startsWith("drizzle/") && norm.endsWith(".sql")) {
    const mig = path.basename(norm);
    return `Berkas migrasi SQL DDL Drizzle (${mig}) untuk pembaruan skema tabel dan indeks basis data PostgreSQL NOC.`;
  }
  if (norm.startsWith("tests/")) {
    const testName = path.basename(norm);
    return `Pengujian otomatis (${testName}) untuk memverifikasi fungsionalitas logika bisnis, API, dan keandalan sistem NOC ISP.`;
  }
  if (norm.startsWith("scripts/")) {
    const scriptName = path.basename(norm);
    return `Skrip otomasi Node.js (${scriptName}) untuk pemeliharaan, verifikasi deploy, migrasi, dan operasional server.`;
  }
  if (norm.startsWith("docs/")) {
    const docName = path.basename(norm);
    return `Dokumentasi arsitektur dan panduan pengembang (${docName}) untuk sistem NOC ISP.`;
  }
  if (norm.startsWith("backend/")) {
    const beName = path.basename(norm);
    return `Modul daemon Go kolektor backend (${beName}) untuk pemrosesan NetFlow, status perangkat, dan streaming WebSocket.`;
  }

  const baseName = path.basename(norm);
  return `Berkas konfigurasi dan sumber daya proyek (${baseName}) untuk integrasi sistem NOC ISP.`;
}

let added = 0;
for (const file of pending.files) {
  if (!summaries[file.path]) {
    const summaryText = getSummaryForFile(file.path);
    summaries[file.path] = {
      summary: summaryText,
    };
    added++;
  }
}

fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2), "utf8");
console.log(`Berhasil menambahkan ${added} ringkasan ke ${summariesPath}`);
