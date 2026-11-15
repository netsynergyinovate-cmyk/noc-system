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
import { copyText } from "@/lib/clipboard";
import {
  appendAllowListCommand,
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
  // Hasil salin per tombol: "ok" = tersalin, "fail" = peramban menolak (teks tetap bisa diseleksi).
  const [copied, setCopied] = useState<Record<string, "ok" | "fail">>({});
  // IP server menurut router, diisi petugas dari langkah 1 (per router).
  const [ipInput, setIpInput] = useState<Record<string, string>>({});

  async function copy(key: string, text: string, host: HTMLElement) {
    const ok = await copyText(text, host);
    setCopied((prev) => ({ ...prev, [key]: ok ? "ok" : "fail" }));
    window.setTimeout(
      () =>
        setCopied((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        }),
      2500,
    );
  }

  function copyButton(key: string, text: string, label = "Salin") {
    const state = copied[key];
    return (
      <button
        type="button"
        onClick={(e) => void copy(key, text, e.currentTarget.parentElement!)}
        className={cn(
          "shrink-0 rounded border bg-background px-2 py-1 text-xs hover:bg-muted",
          state === "ok" && "border-success/60 text-success",
          state === "fail" && "border-destructive/60 text-destructive",
        )}
      >
        {state === "ok"
          ? "Tersalin"
          : state === "fail"
            ? "Gagal, seleksi manual"
            : label}
      </button>
    );
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
      onOpenChange={setOpen}
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
          const service = r.protocol === "api" ? "api" : "www";
          const d = diagnoseUnreachable(r.lastError, {
            sourceIp: r.sourceIp,
            localSourceIp: r.localSourceIp,
            protocol: r.protocol,
            host: r.host,
          });
          const helpText = [
            `Mohon bantu periksa router ${r.name} (${r.host}).`,
            `Status: tidak terjangkau — ${d.title}`,
            `Error: ${r.lastError || "-"}`,
            "Perintah yang perlu dijalankan di terminal MikroTik:",
            ...(d.steps
              ? d.steps.map(
                  (s, i) =>
                    `${i + 1}. ${s.title}\n${s.command ?? `(isi IP dari langkah 1) ${appendAllowListCommand(service, s.allowIp || "") ?? `/ip service set ${service} address=([/ip service get ${service} address],"IP-SERVER")`}`}`,
                )
              : [d.command ?? "-"]),
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
              <p className="mt-1 text-xs leading-relaxed text-foreground">
                {d.hint}
              </p>
              {d.steps ? (
                <ol className="mt-2 space-y-2" data-testid="router-fix-steps">
                  {d.steps.map((s, i) => {
                    const key = `${r.routerId}:${i}`;
                    const typed = ipInput[r.routerId] ?? s.allowIp ?? "";
                    const command =
                      s.allowIp === undefined
                        ? s.command
                        : appendAllowListCommand(service, typed);
                    return (
                      <li
                        key={key}
                        className="rounded-md border border-border/60 bg-background/40 p-2"
                      >
                        <p className="text-xs font-medium">
                          {i + 1}. {s.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {s.detail}
                        </p>
                        {s.allowIp !== undefined && (
                          <label className="mt-1.5 flex items-center gap-2 text-[11px]">
                            <span className="shrink-0 text-muted-foreground">
                              IP server menurut router
                            </span>
                            <input
                              value={typed}
                              onChange={(e) =>
                                setIpInput((prev) => ({
                                  ...prev,
                                  [r.routerId]: e.target.value,
                                }))
                              }
                              placeholder="mis. 172.16.15.254"
                              inputMode="decimal"
                              aria-invalid={!command}
                              className="h-7 min-w-0 flex-1 rounded border bg-background px-2 font-mono text-xs"
                            />
                          </label>
                        )}
                        {command ? (
                          <div className="mt-1.5 flex items-start gap-2">
                            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-background/70 p-2 font-mono text-xs">
                              {command}
                            </pre>
                            {copyButton(key, command)}
                          </div>
                        ) : (
                          s.allowIp !== undefined && (
                            <p className="mt-1 text-[11px] text-destructive">
                              {typed
                                ? "Bukan IPv4 yang valid (contoh 172.16.15.254 atau 172.16.15.0/24)."
                                : "Isi IP dari kolom SRC-ADDRESS langkah 1 untuk menyusun perintah."}
                            </p>
                          )
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                d.command && (
                  <div className="mt-2 flex items-start gap-2">
                    <pre className="min-w-0 flex-1 overflow-x-auto rounded-md bg-background/70 p-2 font-mono text-xs">
                      {d.command}
                    </pre>
                    {copyButton(r.routerId, d.command)}
                  </div>
                )
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {copyButton(
                  `${r.routerId}:help`,
                  helpText,
                  "Salin pesan untuk admin",
                )}
                <span className="text-[11px] text-muted-foreground">
                  Tempel di Winbox (New Terminal) atau SSH. Notifikasi hilang
                  sendiri begitu router terbaca lagi.
                </span>
              </div>
              {d.cause === "closed" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Masih diputus setelah langkah 1–3? Periksa rule{" "}
                  <code className="font-mono">/ip firewall filter</code> rantai{" "}
                  <code className="font-mono">input</code> yang me-reject port
                  layanan, dan pastikan kolom ADDRESS di{" "}
                  <code className="font-mono">
                    /ip service print where name~&quot;{service}&quot;
                  </code>{" "}
                  memuat IP langkah 1.
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
