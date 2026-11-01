"use client";

import { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Key,
  Server,
  Terminal,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  Radio,
  ExternalLink,
  UserCheck,
  FileCode,
  Play,
  RefreshCw,
  Sparkles,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DeployChecklistGuideProps {
  vpsHost?: string;
}

function CommandResultCard({
  result,
  onClear,
}: {
  result: { ok: boolean; code?: number; stdout?: string; stderr?: string; error?: string };
  onClear: () => void;
}) {
  return (
    <div className="mt-2 rounded-lg border border-zinc-800 bg-black/95 font-mono text-[11px] overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          {result.ok ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <CheckCircle2 className="h-3.5 w-3.5" /> Berhasil (Exit Code {result.code ?? 0})
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-red-400 font-bold">
              <AlertTriangle className="h-3.5 w-3.5" /> Gagal (Exit Code {result.code ?? 1})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-zinc-400 hover:text-zinc-200"
        >
          Tutup Output
        </button>
      </div>

      <div className="p-3 space-y-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
        {result.stdout && <div className="text-emerald-300 font-mono">{result.stdout}</div>}
        {result.stderr && <div className="text-amber-300/90 border-t border-zinc-800/60 pt-1 font-mono">{result.stderr}</div>}
        {result.error && <div className="text-red-400 font-bold">{result.error}</div>}
        {!result.stdout && !result.stderr && !result.error && (
          <div className="text-zinc-500 italic">Perintah selesai dieksekusi tanpa keluaran teks.</div>
        )}
      </div>
    </div>
  );
}
export function DeployChecklistGuide({ vpsHost = "192.168.0.220" }: DeployChecklistGuideProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>("quick-exec");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  // State Eksekusi SSH Langsung dari UI
  const [executingKey, setExecutingKey] = useState<string | null>(null);
  const [commandOutputs, setCommandOutputs] = useState<
    Record<string, { ok: boolean; code?: number; stdout?: string; stderr?: string; error?: string }>
  >({});
  const [customCommand, setCustomCommand] = useState("");

  function copyText(text: string, id: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  function generateSecureKey() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const hex = Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
    setGeneratedKey(hex);
  }

  async function runSshCommand(cmd: string, keyId: string) {
    if (!cmd.trim() || executingKey) return;
    setExecutingKey(keyId);
    try {
      const res = await fetch("/api/deploy/ssh/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, timeoutMs: 30000 }),
      });
      const json = await res.json();
      if (!res.ok) {
        setCommandOutputs((prev) => ({
          ...prev,
          [keyId]: { ok: false, error: json.error || `HTTP ${res.status} gagal mengeksekusi perintah.` },
        }));
      } else {
        setCommandOutputs((prev) => ({
          ...prev,
          [keyId]: {
            ok: json.ok,
            code: json.data?.code,
            stdout: json.data?.stdout,
            stderr: json.data?.stderr,
          },
        }));
      }
    } catch (err: unknown) {
      setCommandOutputs((prev) => ({
        ...prev,
        [keyId]: { ok: false, error: err instanceof Error ? err.message : String(err) },
      }));
    } finally {
      setExecutingKey(null);
    }
  }

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  const appBaseUrl = `http://${vpsHost}:3000`;
  const logtoCallback = `${appBaseUrl}/api/auth/callback/logto`;
  const logtoGithubCallback = `${appBaseUrl}/api/auth/callback/logto-github`;
  const logtoEndpointSample = `http://${vpsHost}:3301`;

  const cmdSetUrl = `sudo bash -c 'sed -i -E "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=${appBaseUrl}|; s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=${appBaseUrl}|" /srv/noc/shared/.env && systemctl restart noc-web'`;
  const cmdUfwAll = `sudo ufw allow 22/tcp && sudo ufw allow 3000/tcp && sudo ufw allow 8080/tcp && sudo ufw allow 2055/udp && sudo ufw allow 514/udp && sudo ufw reload`;
  const cmdStatus = `sudo noc-system status`;

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
                Pusat Kontrol Eksekusi SSH & Panduan Kredensial OAuth
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Kirim perintah konfigurasi langsung ke VPS via SSH, panduan penyetelan OAuth (Logto / Google / GitHub), dan generator kunci rahasia.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="border-primary/30 text-primary text-xs w-fit">
            SSH Controller & Guide
          </Badge>
        </div>
      </div>

      {/* 1. KOTAK EKSEKUSI LANGSUNG KE SSH SERVER */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5 text-zinc-100 shadow-md space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <h4 className="text-sm font-bold">Kirim Perintah Langsung ke VPS via SSH</h4>
          </div>
          <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
            Target: netsi@{vpsHost}
          </Badge>
        </div>

        {/* Input Bar Perintah Bebas Custom */}
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-zinc-300">Jalankan Perintah Kustom di VPS:</span>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-2 font-mono text-emerald-400 text-xs">$</span>
              <Input
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSshCommand(customCommand, "custom-cmd");
                }}
                placeholder="misal: sudo systemctl status noc-web atau uname -a"
                className="pl-6 h-8 font-mono text-xs bg-zinc-900 border-zinc-800 text-zinc-100 focus:border-emerald-500"
              />
            </div>
            <Button
              size="sm"
              disabled={!customCommand.trim() || executingKey === "custom-cmd"}
              onClick={() => runSshCommand(customCommand, "custom-cmd")}
              className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 font-semibold shrink-0"
            >
              {executingKey === "custom-cmd" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Kirim ke VPS
            </Button>
          </div>
          {commandOutputs["custom-cmd"] && (
            <CommandResultCard
              result={commandOutputs["custom-cmd"]}
              onClear={() => setCommandOutputs((prev) => { const n = { ...prev }; delete n["custom-cmd"]; return n; })}
            />
          )}
        </div>

        {/* Daftar Tombol Perintah 1-Klik Siap Eksekusi */}
        <div className="space-y-3 pt-2 border-t border-zinc-800/80">
          <span className="text-xs font-semibold text-zinc-300 block">Perintah Konfigurasi 1-Klik:</span>

          {/* Perintah 1: Buka Port Firewall UFW */}
          <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="font-semibold text-zinc-200">A. Buka Port Firewall VPS (3000, 8080, 2055, 514, 22)</span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2 border border-zinc-700 text-zinc-300"
                  onClick={() => copyText(cmdUfwAll, "ufw-cmd")}
                >
                  {copiedKey === "ufw-cmd" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  Salin
                </Button>
                <Button
                  size="sm"
                  disabled={executingKey === "cmd-ufw"}
                  onClick={() => runSshCommand(cmdUfwAll, "cmd-ufw")}
                  className="h-6 text-[10px] gap-1 px-2.5 bg-primary font-semibold"
                >
                  {executingKey === "cmd-ufw" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Jalankan via SSH
                </Button>
              </div>
            </div>
            <code className="block p-2 rounded bg-black/80 font-mono text-[11px] text-amber-300 break-all select-all">
              {cmdUfwAll}
            </code>
            {commandOutputs["cmd-ufw"] && (
              <CommandResultCard
                result={commandOutputs["cmd-ufw"]}
                onClear={() => setCommandOutputs((prev) => { const n = { ...prev }; delete n["cmd-ufw"]; return n; })}
              />
            )}
          </div>

          {/* Perintah 2: Setel URL Server ke .env VPS */}
          <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="font-semibold text-zinc-200">B. Setel URL Server ({appBaseUrl}) ke .env VPS & Restart Web</span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2 border border-zinc-700 text-zinc-300"
                  onClick={() => copyText(cmdSetUrl, "set-url-cmd")}
                >
                  {copiedKey === "set-url-cmd" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  Salin
                </Button>
                <Button
                  size="sm"
                  disabled={executingKey === "cmd-set-url"}
                  onClick={() => runSshCommand(cmdSetUrl, "cmd-set-url")}
                  className="h-6 text-[10px] gap-1 px-2.5 bg-primary font-semibold"
                >
                  {executingKey === "cmd-set-url" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Jalankan via SSH
                </Button>
              </div>
            </div>
            <code className="block p-2 rounded bg-black/80 font-mono text-[11px] text-emerald-400 break-all select-all">
              {cmdSetUrl}
            </code>
            {commandOutputs["cmd-set-url"] && (
              <CommandResultCard
                result={commandOutputs["cmd-set-url"]}
                onClear={() => setCommandOutputs((prev) => { const n = { ...prev }; delete n["cmd-set-url"]; return n; })}
              />
            )}
          </div>

          {/* Perintah 3: Cek Status Layanan di Server */}
          <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="font-semibold text-zinc-200">C. Periksa Status Layanan, Versi, dan Token Monitor</span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 px-2 border border-zinc-700 text-zinc-300"
                  onClick={() => copyText(cmdStatus, "status-cmd")}
                >
                  {copiedKey === "status-cmd" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  Salin
                </Button>
                <Button
                  size="sm"
                  disabled={executingKey === "cmd-status"}
                  onClick={() => runSshCommand(cmdStatus, "cmd-status")}
                  className="h-6 text-[10px] gap-1 px-2.5 bg-primary font-semibold"
                >
                  {executingKey === "cmd-status" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Jalankan via SSH
                </Button>
              </div>
            </div>
            <code className="block p-2 rounded bg-black/80 font-mono text-[11px] text-zinc-300 select-all">
              {cmdStatus}
            </code>
            {commandOutputs["cmd-status"] && (
              <CommandResultCard
                result={commandOutputs["cmd-status"]}
                onClear={() => setCommandOutputs((prev) => { const n = { ...prev }; delete n["cmd-status"]; return n; })}
              />
            )}
          </div>
        </div>
      </div>

      {/* 2. PUSAT TAUTAN PENDAFTARAN OAUTH & GENERATOR KUNCI */}
      <div className="rounded-xl border bg-card p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-bold text-foreground">Tautan Pendaftaran OAuth Provider & Generator Kunci</h4>
          </div>
          <Badge variant="outline" className="text-xs">Tautan Langsung</Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {/* Card A: Google Cloud Console */}
          <div className="p-3.5 rounded-lg border bg-background space-y-2 flex flex-col justify-between">
            <div className="space-y-1.5">
              <span className="font-bold text-foreground block">1. Google Cloud Credentials</span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Buat OAuth 2.0 Client ID untuk autentikasi Google login pengguna atau agen.
              </p>
              <div className="font-mono text-[10px] bg-muted/40 p-1.5 rounded border break-all">
                Redirect URI: <span className="text-primary">{logtoEndpointSample}/callback/google</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs gap-1.5 h-8 mt-2"
              onClick={() => window.open("https://console.cloud.google.com/apis/credentials", "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Buka Google Console
            </Button>
          </div>

          {/* Card B: GitHub Developer Settings */}
          <div className="p-3.5 rounded-lg border bg-background space-y-2 flex flex-col justify-between">
            <div className="space-y-1.5">
              <span className="font-bold text-foreground block">2. GitHub Developer OAuth Apps</span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Buat OAuth App untuk login otomatis akun Developer NOC System via GitHub.
              </p>
              <div className="font-mono text-[10px] bg-muted/40 p-1.5 rounded border break-all">
                Callback URL: <span className="text-primary">{logtoEndpointSample}/callback/github</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs gap-1.5 h-8 mt-2"
              onClick={() => window.open("https://github.com/settings/developers", "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Buka GitHub Settings
            </Button>
          </div>

          {/* Card C: Logto Admin Console */}
          <div className="p-3.5 rounded-lg border bg-background space-y-2 flex flex-col justify-between">
            <div className="space-y-1.5">
              <span className="font-bold text-foreground block">3. Logto Admin Console (SSO)</span>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Kelola aplikasi SSO dan konektor sosial terpusat di instance Logto Anda.
              </p>
              <div className="font-mono text-[10px] bg-muted/40 p-1.5 rounded border break-all">
                Redirect URI: <span className="text-primary">{logtoCallback}</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs gap-1.5 h-8 mt-2"
              onClick={() => window.open(logtoEndpointSample, "_blank")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Buka Logto Console
            </Button>
          </div>
        </div>

        {/* Generator Kunci Rahasia Acak 32-Byte */}
        <div className="p-3.5 rounded-lg border bg-primary/5 border-primary/20 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Generator Kunci Enkripsi 32-Byte Acak (AES-256 / Secret)
              </span>
              <p className="text-[11px] text-muted-foreground">
                Gunakan string acak 32-byte ini untuk nilai <code className="font-mono">BETTER_AUTH_SECRET</code>, <code className="font-mono">DEVICE_SECRET</code>, atau <code className="font-mono">REALTIME_TOKEN_SECRET</code>.
              </p>
            </div>
            <Button size="sm" onClick={generateSecureKey} className="h-7 text-xs gap-1 font-semibold">
              <Sparkles className="h-3 w-3" /> Buat Kunci Acak
            </Button>
          </div>

          {generatedKey && (
            <div className="flex items-center justify-between font-mono text-xs bg-background p-2 rounded border gap-2">
              <code className="text-primary font-bold break-all select-all">{generatedKey}</code>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => copyText(generatedKey, "gen-key")}>
                {copiedKey === "gen-key" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 3. RINCIAN CHECKLIST 4 KATEGORI (ACCORDION DETAIL) */}
      <div className="space-y-3">
        {/* Kategori 1: Rincian OAuth */}
        <div className="rounded-xl border bg-card shadow-xs overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => toggleSection("oauth-detail")}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <UserCheck className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-bold flex items-center gap-2">
                  Rincian Penyetelan OAuth & Redirect URIs
                  <Badge variant="secondary" className="text-[10px]">Detail Teknis</Badge>
                </span>
                <p className="text-xs text-muted-foreground">
                  Alur lengkap penanganan Redirect URI di provider dan di berkas .env server.
                </p>
              </div>
            </div>
            {expandedSection === "oauth-detail" ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {expandedSection === "oauth-detail" && (
            <div className="p-4 pt-1 border-t bg-muted/10 text-xs space-y-4">
              <div className="space-y-2">
                <span className="font-semibold text-foreground">Daftar Redirect URIs yang Wajib Didaftarkan di Logto:</span>
                <div className="space-y-2 font-mono text-[11px]">
                  <div className="flex items-center justify-between p-2 rounded bg-background border">
                    <span>{logtoCallback}</span>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyText(logtoCallback, "c1")}>
                      {copiedKey === "c1" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded bg-background border">
                    <span>{logtoGithubCallback}</span>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copyText(logtoGithubCallback, "c2")}>
                      {copiedKey === "c2" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
