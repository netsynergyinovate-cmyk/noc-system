"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Key,
  Server,
  Lock,
  Globe,
  Database,
  Terminal,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  Radio,
  ExternalLink,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function DeployChecklistGuide() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("auth");

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-4">
      {/* Header Banner Panduan */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0 mt-0.5">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                Panduan Persiapan Lengkap Rilis Server Native
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Daftar periksa prasyarat sistem, autentikasi (Better Auth / Logto OAuth), kredensial SSH, port firewall, dan kunci enkripsi.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-primary/30 text-primary text-xs w-fit">
            Checklist Pra-Deploy
          </Badge>
        </div>
      </div>

      {/* Accordion / Card Checklist 5 Kategori */}
      <div className="space-y-3">
        {/* Kategori 1: Autentikasi & Akun Pengguna (Auth & OAuth) */}
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => toggleSection("auth")}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <UserCheck className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-bold flex items-center gap-2">
                  1. Autentikasi & Akun Pengguna (Better Auth & Logto OAuth)
                  <Badge variant="secondary" className="text-[10px]">Wajib & Opsional</Badge>
                </span>
                <p className="text-xs text-muted-foreground">
                  Akun Admin Utama permanen, variabel rahasia sesi, URL aplikasi, dan opsi SSO Logto.
                </p>
              </div>
            </div>
            {expandedSection === "auth" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {expandedSection === "auth" && (
            <div className="p-4 pt-1 border-t bg-muted/10 text-xs space-y-4">
              {/* Bagian A: Better Auth Bawaan */}
              <div className="space-y-2">
                <div className="flex items-center justify-between font-semibold text-foreground">
                  <span>A. Autentikasi Utama (Better Auth di PostgreSQL) — WAJIB</span>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">Otomatis Aktif</Badge>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Sistem autentikasi utama berjalan langsung di database PostgreSQL melalui tabel <code className="font-mono text-primary">user</code>, <code className="font-mono text-primary">session</code>, dan <code className="font-mono text-primary">account</code>.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 font-mono text-[11px] pt-1">
                  <div className="p-2.5 rounded bg-background border space-y-1">
                    <span className="text-muted-foreground block font-sans font-medium text-[10px]">Akun Admin Utama Permanen:</span>
                    <div>Email: <strong className="text-foreground">admin-utama@noc.local</strong></div>
                    <div>Peran: <strong className="text-emerald-600">Admin Utama (Akses Penuh)</strong></div>
                    <span className="text-muted-foreground block text-[10px] font-sans pt-1">*Otomatis dibuat saat migrasi & seed awal database.</span>
                  </div>
                  <div className="p-2.5 rounded bg-background border space-y-1">
                    <span className="text-muted-foreground block font-sans font-medium text-[10px]">Variabel Rahasia Wajib di .env Server:</span>
                    <div className="break-all">BETTER_AUTH_SECRET=min_32_karakter</div>
                    <div className="break-all">BETTER_AUTH_URL=http://&lt;IP_VPS&gt;:3000</div>
                    <div className="break-all">NEXT_PUBLIC_APP_URL=http://&lt;IP_VPS&gt;:3000</div>
                  </div>
                </div>
              </div>

              {/* Bagian B: Logto SSO (OAuth) */}
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between font-semibold text-foreground">
                  <span>B. Integrasi Single Sign-On (Logto OAuth) — OPSIONAL</span>
                  <Badge variant="outline" className="text-muted-foreground text-[10px]">Opsional</Badge>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                  Jika Anda menggunakan Logto untuk login terpusat (SSO), lengkapi variabel berikut di <code className="font-mono text-primary">/srv/noc/shared/.env</code>:
                </p>
                <div className="p-2.5 rounded bg-background border font-mono text-[11px] space-y-1">
                  <div>LOGTO_ENDPOINT=http://&lt;IP_LOGTO&gt;:3301 <span className="text-muted-foreground font-sans text-[10px]">(URL instance Logto)</span></div>
                  <div>LOGTO_CLIENT_ID=client_id_dari_logto_console</div>
                  <div>LOGTO_CLIENT_SECRET=client_secret_dari_logto_console</div>
                </div>
                <p className="text-[11px] text-muted-foreground italic">
                  *Catatan: Jika Logto tidak dipasang di VPS, abaikan variabel ini. Anda tetap dapat login langsung dengan akun Admin Utama.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Kategori 2: Jaringan, Port Firewall & Kredensial SSH VPS */}
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => toggleSection("network")}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Globe className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-bold flex items-center gap-2">
                  2. Jaringan, Port Firewall VPS & Kredensial SSH
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 text-[10px]">Wajib</Badge>
                </span>
                <p className="text-xs text-muted-foreground">
                  User SSH, kata sandi, dan daftar port firewall yang wajib dibuka di server Ubuntu.
                </p>
              </div>
            </div>
            {expandedSection === "network" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {expandedSection === "network" && (
            <div className="p-4 pt-1 border-t bg-muted/10 text-xs space-y-4">
              <div className="space-y-2">
                <span className="font-semibold text-foreground">Kredensial SSH Server (Kartu Kanan Dasbor):</span>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li><strong>Host & Port</strong>: Alamat IP publik atau LAN VPS (misal <code className="font-mono">192.168.0.220</code> atau <code className="font-mono">103.x.x.x</code>) dan Port <code className="font-mono">22</code>.</li>
                  <li><strong>User SSH</strong>: User non-root di server VPS Anda (contoh: <code className="font-mono text-primary">netsi</code> atau <code className="font-mono text-primary">ubuntu</code>).</li>
                  <li><strong>Otentikasi</strong>: Masukkan <strong>Kata Sandi SSH</strong> user tersebut, atau Kunci Privat SSH.</li>
                  <li><strong>Izin Sudo Non-interaktif</strong>: Sistem deploy di Langkah 1 otomatis menyelaraskan hak sudo non-interaktif (<code className="font-mono">NOPASSWD</code>) di server menggunakan kata sandi Anda.</li>
                </ul>
              </div>

              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Daftar Port Firewall yang Wajib Diizinkan di VPS (UFW):</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px] gap-1 px-2 border"
                    onClick={() => copyText("sudo ufw allow 22/tcp && sudo ufw allow 3000/tcp && sudo ufw allow 8080/tcp && sudo ufw allow 2055/udp && sudo ufw allow 514/udp && sudo ufw reload", "ufw-cmd")}
                  >
                    {copiedKey === "ufw-cmd" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    <span>Salin Perintah UFW</span>
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-[11px] border rounded bg-background">
                    <thead className="bg-muted/40 border-b text-muted-foreground">
                      <tr>
                        <th className="p-2">Port</th>
                        <th className="p-2">Protokol</th>
                        <th className="p-2">Layanan</th>
                        <th className="p-2">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y text-foreground">
                      <tr>
                        <td className="p-2 font-bold text-primary">3000</td>
                        <td className="p-2">TCP</td>
                        <td className="p-2">Web Next.js</td>
                        <td className="p-2 text-muted-foreground">Dashboard web NOC System yang dibuka browser operator</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-primary">8080</td>
                        <td className="p-2">TCP</td>
                        <td className="p-2">Go Backend</td>
                        <td className="p-2 text-muted-foreground">Realtime WebSocket Hub telemetri router & OLT</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-primary">22</td>
                        <td className="p-2">TCP</td>
                        <td className="p-2">SSH / SFTP</td>
                        <td className="p-2 text-muted-foreground">Transfer artefak rilis dan eksekusi instruksi deploy</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-cyan-600">2055</td>
                        <td className="p-2">UDP</td>
                        <td className="p-2">NetFlow v5</td>
                        <td className="p-2 text-muted-foreground">Menerima traffic-flow MikroTik per pelanggan</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-bold text-cyan-600">514</td>
                        <td className="p-2">UDP</td>
                        <td className="p-2">Syslog Server</td>
                        <td className="p-2 text-muted-foreground">Menerima log event router dan transisi link optik OLT</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Kategori 3: Kunci Enkripsi & Token Keamanan (DEVICE_SECRET) */}
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => toggleSection("secrets")}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-bold flex items-center gap-2">
                  3. Kunci Enkripsi & Token Rahasia Perangkat
                  <Badge variant="outline" className="border-amber-500/30 text-amber-600 text-[10px]">Kritis</Badge>
                </span>
                <p className="text-xs text-muted-foreground">
                  DEVICE_SECRET, ROUTER_SECRET_KEY, dan REALTIME_TOKEN_SECRET yang selaras antara lokal dan server.
                </p>
              </div>
            </div>
            {expandedSection === "secrets" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {expandedSection === "secrets" && (
            <div className="p-4 pt-1 border-t bg-muted/10 text-xs space-y-3">
              <p className="text-muted-foreground leading-relaxed">
                Seluruh kata sandi router MikroTik dan OLT disimpan terenkripsi AES-256-GCM di database. Kunci enkripsi wajib selaras agar server dapat membuka sandi perangkat:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 font-mono text-[11px]">
                <div className="p-2.5 rounded bg-background border space-y-1">
                  <span className="text-muted-foreground font-sans font-medium text-[10px] block">DEVICE_SECRET</span>
                  <div className="text-foreground font-bold">Kunci Enkripsi Router/OLT</div>
                  <p className="text-[10px] text-muted-foreground font-sans">String 32-karakter acak untuk membuka password perangkat MikroTik/OLT di server.</p>
                </div>
                <div className="p-2.5 rounded bg-background border space-y-1">
                  <span className="text-muted-foreground font-sans font-medium text-[10px] block">REALTIME_TOKEN_SECRET</span>
                  <div className="text-foreground font-bold">Tiket WebSocket Realtime</div>
                  <p className="text-[10px] text-muted-foreground font-sans">Kunci HMAC untuk mengamankan komunikasi stream realtime browser ke Go Backend.</p>
                </div>
                <div className="p-2.5 rounded bg-background border space-y-1">
                  <span className="text-muted-foreground font-sans font-medium text-[10px] block">MONITOR_TOKEN</span>
                  <div className="text-foreground font-bold">Kunci Pemantau Server</div>
                  <p className="text-[10px] text-muted-foreground font-sans">Token pemantau kesehatan server yang otomatis ditampilkan setelah deploy selesai.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Kategori 4: Database PostgreSQL di VPS */}
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => toggleSection("database")}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-bold flex items-center gap-2">
                  4. Database PostgreSQL Server (Docker Engine)
                  <Badge variant="outline" className="border-indigo-500/30 text-indigo-600 text-[10px]">Terisolasi</Badge>
                </span>
                <p className="text-xs text-muted-foreground">
                  Kontainer Docker PostgreSQL noc-postgres di server dan pencadangan otomatis gzip.
                </p>
              </div>
            </div>
            {expandedSection === "database" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {expandedSection === "database" && (
            <div className="p-4 pt-1 border-t bg-muted/10 text-xs space-y-3">
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Database di server berjalan di kontainer Docker <code className="font-mono text-primary">noc-postgres</code> (port 5432).</li>
                <li><strong>Cadangan Otomatis (Langkah 2)</strong>: Sebelum rilis baru dipasang, sistem selalu mengekstrak file cadangan <code className="font-mono text-primary">backup-*.sql.gz</code> ke direktori <code className="font-mono">/srv/noc/backups/</code> di server VPS.</li>
                <li><strong>Migrasi Skema (Langkah 4)</strong>: 74 tabel dan 44 berkas migrasi dieksekusi otomatis oleh skrip migrasi tanpa mengganggu data yang sudah ada.</li>
                <li><strong>Sinkronisasi Konfigurasi (Langkah 5)</strong>: Pengaturan router, OLT, ambang alert, dan akun disinkronkan secara atomik dari kontrol lokal ke database server.</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
