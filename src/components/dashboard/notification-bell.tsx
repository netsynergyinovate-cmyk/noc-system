"use client";

import { useState } from "react";
import { AlertTriangle, Bell, BellRing, WifiOff } from "lucide-react";
import { cn } from "cn";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSession } from "@/components/session-provider";
import {
  describeLastOk,
  diagnoseUnreachable,
  unreachableRouters,
} from "@/lib/dashboard/router-health";
import { useDashboardStore } from "@/lib/dashboard/store";
import { streamDisconnectedView } from "@/lib/dashboard/stream-disconnected-view";
import { selectPreviewEnabled } from "@/lib/session-store";

// Lonceng notifikasi di header dashboard (pengganti banner besar): aplikasi terputus dari backend dan
// router yang tidak terbaca. Tanpa ini dasbor terlihat normal padahal datanya beku. Datanya didorong
// backend lewat telemetri/WebSocket, tanpa polling. Router hanya di mode live (demo tidak punya router).
export function NotificationBell() {
  const isDemo = useSession(selectPreviewEnabled);
  const health = useDashboardStore((s) => s.telemetry?.routers);
  const lastUpdateAt = useDashboardStore((s) => s.lastUpdateAt);
  const connection = useDashboardStore((s) => s.connection);
  const reconnectFeed = useDashboardStore((s) => s.reconnectFeed);
  // Detik pesan terakhir dari backend: dasar kalimat "terakhir diperbarui ...".
  const now = lastUpdateAt ?? 0;
  const down = isDemo ? [] : unreachableRouters(health ?? []);
  const feed = streamDisconnectedView({
    connection,
    lastUpdateAt,
    hasReconnect: !!reconnectFeed,
  });
  const count = down.length + (feed.visible ? 1 : 0);
  // Berubah saat ada masalah baru: lonceng dipasang ulang sehingga animasinya diputar lagi.
  const signature = `${feed.visible}|${down.map((r) => r.routerId).join(",")}`;

  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [helpCopiedId, setHelpCopiedId] = useState<string | null>(null);
  const [guideFor, setGuideFor] = useState<string | null>(null);
  // address= layanan saat ini per router, dibaca saat daftar dibuka. Dipakai untuk menyusun
  // perintah TAMBAH, bukan ganti.
  const [existing, setExisting] = useState<Record<string, string>>({});

  function loadExisting() {
    for (const r of down) {
      const service = r.protocol === "api" ? "api" : "www";
      fetch(
        `/api/routers/${encodeURIComponent(r.routerId)}/service?name=${service}`,
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!json?.data) return;
          setExisting((prev) => ({
            ...prev,
            [r.routerId]: String(json.data.address ?? ""),
          }));
        })
        .catch(() => {
          // Gagal membaca daftar lama: perintah tetap memakai versi ganti.
        });
    }
  }

  async function copyText(key: string, text: string, help = false) {
    try {
      await navigator.clipboard.writeText(text);
      const set = help ? setHelpCopiedId : setCopiedId;
      set(key);
      window.setTimeout(() => set((id) => (id === key ? null : id)), 2000);
    } catch {
      // Clipboard tidak tersedia (HTTP non-localhost): teks tetap bisa diseleksi.
    }
  }

  const summary = [
    feed.visible ? feed.title : null,
    ...down.map((r) => `${r.name} tidak terjangkau`),
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadExisting();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="notification-bell"
          aria-label={
            count > 0
              ? `Notifikasi: ${count} masalah. ${summary}`
              : "Notifikasi: tidak ada masalah"
          }
          title={count > 0 ? summary : "Tidak ada notifikasi"}
          className={cn(
            "relative inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/20 transition-colors hover:bg-muted",
            count > 0
              ? "border-destructive/50 text-destructive"
              : "border-border/60 text-muted-foreground hover:text-foreground",
          )}
        >
          {count > 0 ? (
            <BellRing
              key={signature}
              aria-hidden="true"
              className="size-4 origin-top motion-safe:animate-[noc-bell-ring_0.9s_ease-in-out_3]"
            />
          ) : (
            <Bell aria-hidden="true" className="size-4" />
          )}
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4">
              <span
                aria-hidden="true"
                className="absolute inline-flex size-full rounded-full bg-destructive opacity-60 motion-safe:animate-ping"
              />
              <span className="relative inline-flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                {count}
              </span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* Pembaca layar tetap diberi tahu walau daftar tertutup. */}
      <span role="status" className="sr-only">
        {count > 0 ? `${count} notifikasi: ${summary}` : ""}
      </span>
      <PopoverContent
        align="end"
        // z-[1100]: di atas panel/kontrol peta Leaflet (z-1000..1010) di kartu peta dashboard.
        className="z-[1100] max-h-[70vh] w-[min(30rem,calc(100vw-2rem))] space-y-3 overflow-y-auto p-3"
        data-testid="notification-list"
      >
        <p className="text-sm font-semibold">Notifikasi</p>
        {count === 0 && (
          <p className="text-sm text-muted-foreground">
            Tidak ada masalah: aplikasi terhubung ke backend dan semua router
            terbaca.
          </p>
        )}

        {feed.visible && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <span>{feed.title}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {feed.description}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {feed.lastUpdateText} • {feed.retryHint}
            </p>
            {feed.showRetryButton && reconnectFeed && (
              <button
                type="button"
                onClick={reconnectFeed}
                className="mt-2 rounded border border-destructive/30 bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
              >
                Sambungkan ulang
              </button>
            )}
          </div>
        )}

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
              data-testid="router-health-notice"
              data-cause={d.cause}
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
            >
              <div className="flex items-center gap-2 font-medium text-destructive">
                <WifiOff className="size-4 shrink-0" aria-hidden="true" />
                <span>
                  {r.name} tidak terjangkau: {d.title}
                </span>
              </div>
              <p className="mt-1 text-xs text-foreground">{d.hint}</p>
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
                      setGuideFor((id) =>
                        id === r.routerId ? null : r.routerId,
                      )
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
                    Tunggu ±30 detik; backend mencoba ulang otomatis tanpa
                    restart aplikasi.
                  </li>
                  <li>
                    Kalau masih gagal, klik “Minta bantuan admin” lalu kirim
                    pesannya.
                  </li>
                </ol>
              )}
              {d.cause === "closed" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Verifikasi dengan{" "}
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
                adalah yang terakhir diketahui.{" "}
                {describeLastOk(r.lastOkAt, now)}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {r.host} · gagal {r.failures}× berturut-turut
                {r.lastError ? ` · ${r.lastError}` : ""}
              </p>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
