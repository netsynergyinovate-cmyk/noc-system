"use client";

import { AlertCircle, AlertTriangle, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { allowListCommand } from "@/lib/dashboard/router-health";
import { cn } from "@/lib/utils";

type Props = {
  code?: string;
  message?: string;
  deviceType?: "mikrotik" | "olt" | "genieacs" | "billing";
  // Alamat sumber server ke perangkat (dari uji koneksi gagal); ditampilkan agar bisa diizinkan di router.
  sourceIp?: string;
  // Alamat LAN server; router di jaringan yang sama bisa melihat ini.
  localSourceIp?: string;
  // Transport router: menentukan layanan yang disebut (www vs api).
  protocol?: "rest" | "api";
  target?: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  compact?: boolean;
  className?: string;
};

export type ConnectionTroubleshoot = { title: string; hint: string; command?: string };

const RESTORE_REST = "/ip service set www-ssl disabled=no\n/ip service set www disabled=no";

/** Pure: kode galat -> judul + saran. Kode tak dikenal jatuh ke fallback aman. */
export function describeConnectionTroubleshoot(
  code?: string,
  deviceType?: string,
  opts: { sourceIp?: string; localSourceIp?: string; protocol?: "rest" | "api" } = {},
): ConnectionTroubleshoot {
  const mikrotik = deviceType === "mikrotik";
  const olt = deviceType === "olt";
  const genieacs = deviceType === "genieacs";
  const service: "www" | "api" = opts.protocol === "api" ? "api" : "www";
  const sourceIp = opts.sourceIp?.trim();
  const localSourceIp = opts.localSourceIp?.trim();
  const ipLabel = [...new Set([sourceIp, localSourceIp].filter(Boolean))].join(" / ");
  switch (code) {
    case "TIMEOUT":
      return {
        title: "Perangkat tidak merespons",
        hint: genieacs
          ? "GenieACS NBI tidak merespons. Periksa firewall port 7557 dan jaringan ke server GenieACS."
          : olt
            ? "Host OLT tidak merespons. Periksa alamat IP manajemen OLT, kabel uplink, dan port SNMP 161 atau HTTP API HSGQ."
            : mikrotik
              ? "Router tidak menjawab tepat waktu. Periksa alamat, rute, dan firewall router. Jika port yang diisi adalah Winbox atau layanan lain (mis. 8291, 2024), ganti dengan port layanan www/www-ssl dari /ip service print."
              : "Periksa kabel/jaringan, firewall, dan pastikan IP serta port benar, lalu coba lagi.",
      };
    case "AUTH_FAILED":
      return {
        title: "Login ditolak",
        hint: genieacs
          ? "Kredensial ditolak. Periksa username dan password HTTP Basic Auth GenieACS NBI."
          : olt
            ? "Kredensial OLT ditolak. Periksa username, password admin OLT, atau SNMP community string."
            : "Username atau kata sandi salah, atau akun tidak punya hak akses API. Periksa kredensial perangkat.",
      };
    case "NOT_FOUND":
      return {
        title: "Layanan REST tidak ditemukan",
        hint: mikrotik
          ? "Pastikan RouterOS v7.1+ dan layanan www/www-ssl aktif. Jalankan di terminal router:"
          : "Alamat layanan tidak ditemukan. Periksa host, port, dan path.",
        command: mikrotik ? RESTORE_REST : undefined,
      };
    case "CONNECTION_CLOSED": {
      const command = allowListCommand(service, sourceIp, localSourceIp);
      return {
        title: "Router menutup koneksi",
        hint: command
          ? `Router menerima sambungan lalu langsung memutusnya: IP server ini (${ipLabel}) belum ada di kolom address= layanan ${service}. Perintah di bawah MENGGANTI daftar address= dengan IP itu; akses Winbox/SSH tidak terpengaruh. Tempel apa adanya. Jika perlu mempertahankan entri lama, jalankan /ip service print detail where name~"${service}" lalu tambahkan entri itu setelah koma.`
          : `Router menerima sambungan lalu langsung memutusnya: IP server ini biasanya belum ada di kolom address= layanan ${service}. Jalankan perintah di bawah untuk melihat daftar, lalu tambahkan IP server (jangan mengganti daftar lama). Jika HTTPS dicentang padahal port ini layanan HTTP, hilangkan centang HTTPS.`,
        command: command ?? `/ip service print where name~"${service}"`,
      };
    }
    case "CONNECTION_REFUSED":
      return {
        title: "Koneksi ditolak",
        hint: genieacs
          ? "Port 7557 NBI mati atau layanan GenieACS NBI tidak berjalan. Periksa status layanan di server:"
          : mikrotik
            ? `Port yang diuji tertutup: layanan ${service} mati, atau router memakai port lain (mis. 8081) sedangkan kolom Port kosong. Cek port yang berlaku di router, lalu isi di kolom Port atau tulis IP:port di Host:`
            : "Port tertutup atau layanan tidak berjalan. Periksa port dan firewall.",
        command: genieacs ? "systemctl status genieacs-nbi" : mikrotik ? `/ip service print where name~"${service}"` : undefined,
      };
    case "NETWORK_ERROR":
      return {
        title: "Router tidak terjangkau",
        hint: mikrotik
          ? "Server NOC tidak mendapat jawaban dari alamat ini. Periksa alamat router (lihat langkah 2 panduan), rute dari server (ip route get <alamat>, ping), dan firewall router (chain input)."
          : "Perangkat tidak terjangkau. Periksa alamat, rute jaringan, dan firewall.",
      };
    case "WRONG_PORT":
      return {
        title: "Port bukan layanan REST",
        hint: "REST RouterOS jalan di layanan www (80) atau www-ssl (443), bukan API biner (8728/8729) atau Winbox (8291). Cek port layanan dengan:",
        command: "/ip service print",
      };
    case "TLS_ERROR":
      return {
        title: "Sertifikat HTTPS tidak dipercaya",
        hint: "www-ssl RouterOS memakai sertifikat self-signed secara bawaan. Pasang sertifikat valid di router, atau pakai layanan www (HTTP) lewat jaringan privat/VPN. Bila port ini sebenarnya HTTP, hilangkan centang HTTPS.",
        command: "/ip service print",
      };
    case "INVALID_HOST":
      return {
        title: "Alamat host tidak valid",
        hint: "Isi alamat IP atau nama host yang benar, tanpa spasi atau awalan protokol.",
      };
    default:
      return {
        title: "Koneksi gagal",
        hint: "Periksa alamat, port, kredensial, dan jaringan perangkat, lalu coba lagi.",
      };
  }
}

function iconFor(code?: string) {
  if (code === "TIMEOUT") return AlertTriangle;
  if (code === "AUTH_FAILED" || code === "CONNECTION_REFUSED" || code === "CONNECTION_CLOSED") return XCircle;
  return AlertCircle;
}

export function ConnectionErrorNotice({
  code,
  message,
  deviceType,
  target,
  sourceIp,
  localSourceIp,
  protocol,
  onRetry,
  isRetrying = false,
  compact = false,
  className,
}: Props) {
  const help = describeConnectionTroubleshoot(code, deviceType, { sourceIp, localSourceIp, protocol });
  const Icon = iconFor(code);

  return (
    <div
      role="alert"
      data-testid="connection-error-notice"
      data-code={code ?? "UNKNOWN"}
      className={cn("space-y-2 text-sm", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="font-medium text-destructive">{help.title}</span>
        {code && <Badge variant="secondary">{code}</Badge>}
        {target && <span className="text-xs text-muted-foreground">{target}</span>}
      </div>

      {message && <p className="text-destructive">{message}</p>}

      {!compact && (
        <>
          <p className="text-muted-foreground">{help.hint}</p>
          {help.command && (
            <pre className="overflow-x-auto rounded-md border bg-background p-2 font-mono text-xs">
              {help.command}
            </pre>
          )}
          {sourceIp && (
            <p className="text-muted-foreground">
              IP server NOC yang dipakai ke router ini: <code className="font-mono">{sourceIp}</code>
              {localSourceIp && localSourceIp !== sourceIp ? (
                <>
                  {" "}(LAN: <code className="font-mono">{localSourceIp}</code>)
                </>
              ) : null}
              . Perintah di atas sudah memakai alamat itu. Jika router melihat alamat lain karena NAT, cek{" "}
              <code className="font-mono">/ip firewall connection print</code>.
            </p>
          )}
        </>
      )}

      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          aria-disabled={isRetrying}
          className={isRetrying ? "pointer-events-none opacity-70" : undefined}
        >
          {isRetrying ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          Coba lagi
        </Button>
      )}
    </div>
  );
}
