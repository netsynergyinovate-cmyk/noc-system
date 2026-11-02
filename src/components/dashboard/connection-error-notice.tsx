"use client";

import { AlertCircle, AlertTriangle, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  code?: string;
  message?: string;
  deviceType?: "mikrotik" | "olt" | "genieacs" | "billing";
  // Alamat sumber server ke perangkat (dari uji koneksi gagal); ditampilkan agar bisa diizinkan di router.
  sourceIp?: string;
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
): ConnectionTroubleshoot {
  const mikrotik = deviceType === "mikrotik";
  const olt = deviceType === "olt";
  const genieacs = deviceType === "genieacs";
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
    case "CONNECTION_CLOSED":
      return {
        title: "Router menutup koneksi",
        hint: "Router menerima sambungan lalu langsung memutusnya: IP server ini biasanya belum ada di kolom address= layanan www. TAMBAHKAN IP server ke daftar yang sudah ada (jangan mengganti). Jika HTTPS dicentang padahal port ini layanan HTTP (www), hilangkan centang HTTPS.",
        command: "/ip service set www address=<DAFTAR-LAMA>,<IP-SERVER>/32",
      };
    case "CONNECTION_REFUSED":
      return {
        title: "Koneksi ditolak",
        hint: genieacs
          ? "Port 7557 NBI mati atau layanan GenieACS NBI tidak berjalan. Periksa status layanan di server:"
          : mikrotik
            ? "Port yang diuji tertutup: layanan www mati, atau router memakai port lain (mis. 8081) sedangkan kolom Port kosong dan dianggap 80. Cek port yang berlaku di router, lalu isi di kolom Port atau tulis IP:port di Host:"
            : "Port tertutup atau layanan tidak berjalan. Periksa port dan firewall.",
        command: genieacs ? "systemctl status genieacs-nbi" : mikrotik ? '/ip service print where name~"www"' : undefined,
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
  onRetry,
  isRetrying = false,
  compact = false,
  className,
}: Props) {
  const help = describeConnectionTroubleshoot(code, deviceType);
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
              IP server NOC yang dipakai ke router ini: <code className="font-mono">{sourceIp}</code>. Izinkan alamat itu di
              router (jika ada NAT di jalur, router melihat alamat lain; cek dengan{" "}
              <code className="font-mono">/ip firewall connection print</code>).
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
