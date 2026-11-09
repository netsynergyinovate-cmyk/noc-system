"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useSession } from "@/components/session-provider";
import {
  describeLastOk,
  diagnoseUnreachable,
  unreachableRouters,
} from "@/lib/dashboard/router-health";
import { useDashboardStore } from "@/lib/dashboard/store";
import { selectPreviewEnabled } from "@/lib/session-store";

// Peringatan di SEMUA halaman bila backend tidak bisa membaca router. Tanpa ini
// dasbor terlihat normal padahal datanya beku: pelanggan tetap "online", grafik
// berhenti, dan alert lain tidak mungkin berubah. Hanya mode live (demo tidak
// punya router sungguhan). Datanya didorong backend lewat telemetri, tanpa polling.
export function RouterHealthBanner() {
  const isDemo = useSession(selectPreviewEnabled);
  const health = useDashboardStore((s) => s.telemetry?.routers);
  // Detik pesan terakhir dari backend: dasar kalimat "terakhir diperbarui ...".
  const now = useDashboardStore((s) => s.lastUpdateAt) ?? 0;
  const down = unreachableRouters(health ?? []);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [helpCopiedId, setHelpCopiedId] = useState<string | null>(null);
  const [guideFor, setGuideFor] = useState<string | null>(null);
  // address= layanan saat ini per router, dibaca dari backend saat notifikasi
  // muncul. Dipakai untuk menyusun perintah TAMBAH, bukan ganti.
  const [existing, setExisting] = useState<Record<string, string>>({});

  const downKey = down
    .map((r) => `${r.routerId}:${r.protocol ?? ""}:${r.lastError}`)
    .join("|");
  useEffect(() => {
    let cancelled = false;
    for (const r of down) {
      const service = r.protocol === "api" ? "api" : "www";
      fetch(
        `/api/routers/${encodeURIComponent(r.routerId)}/service?name=${service}`,
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (cancelled || !json?.data) return;
          setExisting((prev) => ({
            ...prev,
            [r.routerId]: String(json.data.address ?? ""),
          }));
        })
        .catch(() => {
          // Gagal membaca daftar lama: perintah tetap memakai versi ganti.
        });
    }
    return () => {
      cancelled = true;
    };
    // downKey merangkum daftar router yang sedang down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downKey]);

  async function copyText(key: string, text: string, help = false) {
    try {
      await navigator.clipboard.writeText(text);
      if (help) {
        setHelpCopiedId(key);
        window.setTimeout(
          () => setHelpCopiedId((id) => (id === key ? null : id)),
          2000,
        );
      } else {
        setCopiedId(key);
        window.setTimeout(
          () => setCopiedId((id) => (id === key ? null : id)),
          2000,
        );
      }
    } catch {
      // Clipboard tidak tersedia (HTTP non-localhost): teks tetap bisa diseleksi.
    }
  }

  if (isDemo || down.length === 0) return null;

  return (
    <div
      className="mb-6 flex flex-col gap-3"
      data-testid="router-health-banner"
    >
      {down.map((r) => {
        const d = diagnoseUnreachable(r.lastError, {
          sourceIp: r.sourceIp,
          localSourceIp: r.localSourceIp,
          existingAddress: existing[r.routerId],
          protocol: r.protocol,
        });
        const helpText = [
          `Mohon bantu periksa router ${r.name} (${r.host}).`,
          `Status: tidak terjangkau — ${d.title}`,
          `Error: ${r.lastError || "-"}`,
          "Perintah yang perlu dijalankan di terminal MikroTik:",
          d.command ?? "-",
        ].join("\n");
        return (
          <div
            key={r.routerId}
            role="alert"
            data-cause={d.cause}
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
          >
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {r.name} tidak terjangkau: {d.title}
              </span>
            </div>
            <p className="mt-2 text-foreground">{d.hint}</p>
            {d.command && (
              <div className="mt-2 flex flex-wrap items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-background/70 p-2 font-mono text-xs">
                  {d.command}
                </pre>
                <button
                  type="button"
                  onClick={() => void copyText(r.routerId, d.command!)}
                  className="rounded border bg-background px-2 py-1 text-xs hover:bg-muted"
                >
                  {copiedId === r.routerId ? "Tersalin" : "Salin"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setGuideFor((id) => (id === r.routerId ? null : r.routerId))
                  }
                  className="rounded border bg-background px-2 py-1 text-xs hover:bg-muted"
                  aria-expanded={guideFor === r.routerId}
                >
                  Panduan
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(`${r.routerId}:help`, helpText, true)
                  }
                  className="rounded border bg-background px-2 py-1 text-xs hover:bg-muted"
                >
                  {helpCopiedId === `${r.routerId}:help`
                    ? "Pesan tersalin"
                    : "Minta bantuan admin"}
                </button>
              </div>
            )}
            {guideFor === r.routerId && (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>Buka Winbox atau SSH ke MikroTik.</li>
                <li>Tempel perintah di atas apa adanya.</li>
                <li>
                  Tunggu ±30 detik; backend mencoba ulang otomatis tanpa restart
                  aplikasi.
                </li>
                <li>
                  Kalau masih gagal, klik “Minta bantuan admin” lalu kirim
                  pesannya.
                </li>
              </ol>
            )}
            {d.cause === "closed" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Setelah perintah ditempel, backend mencoba lagi otomatis (tidak
                perlu restart aplikasi). Verifikasi dengan{" "}
                <code className="font-mono">
                  /ip service print where name~&quot;
                  {r.protocol === "api" ? "api" : "www"}&quot;
                </code>
                : kolom ADDRESS harus memuat IP server di atas. Jika masih
                ditutup, periksa{" "}
                <code className="font-mono">/ip firewall filter</code> rantai{" "}
                <code className="font-mono">input</code> untuk port layanan.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Data di dasbor <strong>tidak diperbarui</strong> selama router
              tidak terbaca: status online pelanggan dan grafik yang tampil
              adalah yang terakhir diketahui. {describeLastOk(r.lastOkAt, now)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {r.host} · gagal {r.failures}× berturut-turut
              {r.lastError ? ` · ${r.lastError}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
