"use client";

import { useState } from "react";
import { Terminal, Send, Activity, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RouterPingResult } from "@/services/router-ping.service";

export function RouterPingTool({
  routerId,
  routerName,
  routerHost,
}: {
  routerId: string;
  routerName: string;
  routerHost: string;
}) {
  const [target, setTarget] = useState("8.8.8.8");
  const [count, setCount] = useState(4);
  const [running, setRunning] = useState(false);
  const [restTesting, setRestTesting] = useState(false);
  const [terminalLog, setTerminalLog] = useState<string[]>([
    `[READY] Siap mengeksekusi ICMP Ping dari ${routerName} (${routerHost}).`,
    `Masukkan target host/IP dan klik "Kirim Ping (ICMP)".`,
  ]);

  async function handleExecutePing() {
    if (running || !target.trim()) return;
    setRunning(true);
    const stamp = new Date().toLocaleTimeString();
    setTerminalLog((prev) => [
      ...prev,
      `--- [${stamp}] Menjalankan Ping ke ${target.trim()} (count: ${count}) via MikroTik RouterOS ---`,
    ]);

    try {
      const res = await fetch(
        `/api/routers/${encodeURIComponent(routerId)}/ping`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: target.trim(), count }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        data?: RouterPingResult;
        error?: { message?: string };
      } | null;

      const pingData = json?.data;
      if (!res.ok || !pingData) {
        setTerminalLog((prev) => [
          ...prev,
          `[ERROR] ${json?.error?.message ?? `Eksekusi ping gagal (HTTP ${res.status}).`}`,
        ]);
      } else {
        setTerminalLog((prev) => [...prev, ...pingData.terminalLines]);
      }
    } catch {
      setTerminalLog((prev) => [
        ...prev,
        "[ERROR] Server aplikasi tidak merespons permintaan ping.",
      ]);
    } finally {
      setRunning(false);
    }
  }

  async function handleTestRestApi() {
    if (restTesting) return;
    setRestTesting(true);
    const stamp = new Date().toLocaleTimeString();
    setTerminalLog((prev) => [
      ...prev,
      `--- [${stamp}] Menguji koneksi REST API RouterOS: ${routerHost} ---`,
    ]);

    try {
      const res = await fetch(
        `/api/routers/${encodeURIComponent(routerId)}/test`,
        { method: "POST" },
      );
      const json = (await res.json().catch(() => null)) as {
        data?: {
          ok?: boolean;
          message?: string;
          latencyMs?: number;
          code?: string;
        };
        error?: { message?: string };
      } | null;

      const restData = json?.data;
      if (res.status === 403) {
        setTerminalLog((prev) => [
          ...prev,
          "[REST] 403 Forbidden: Izin router:manage dibutuhkan.",
        ]);
      } else if (!res.ok || !restData) {
        setTerminalLog((prev) => [
          ...prev,
          `[REST] GAGAL: ${json?.error?.message ?? `HTTP ${res.status}`}`,
        ]);
      } else if (restData.ok) {
        setTerminalLog((prev) => [
          ...prev,
          `[REST] OK: REST API merespons dalam ${restData.latencyMs ?? "?"} ms. ${restData.message ?? ""}`.trim(),
        ]);
      } else {
        setTerminalLog((prev) => [
          ...prev,
          `[REST] GAGAL [${restData.code ?? "ERR"}]: ${restData.message ?? "router tidak merespons"}`,
        ]);
      }
    } catch {
      setTerminalLog((prev) => [
        ...prev,
        "[REST] Gagal menghubungi endpoint server aplikasi.",
      ]);
    } finally {
      setRestTesting(false);
    }
  }

  return (
    <div className="space-y-3 font-mono text-xs">
      {/* Control Panel */}
      <div className="p-3.5 rounded-xl bg-card border border-border flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2">
            <span className="text-muted-foreground font-semibold text-[11px] whitespace-nowrap">
              Target Host / IP:
            </span>
            <Input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 8.8.8.8 atau 1.1.1.1"
              className="h-8 text-xs bg-background border-border text-foreground font-mono max-w-xs"
            />
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-8 rounded-lg bg-background border border-border text-foreground text-xs px-2"
            >
              <option value={3}>3 pkt</option>
              <option value={4}>4 pkt</option>
              <option value={5}>5 pkt</option>
              <option value={10}>10 pkt</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleExecutePing}
              disabled={running}
              className="h-8 px-3 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              <Send className={`size-3 ${running ? "animate-pulse" : ""}`} />
              <span>{running ? "Memproses..." : "Kirim Ping (ICMP)"}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestRestApi}
              disabled={restTesting}
              className="h-8 px-2.5 text-xs gap-1.5"
            >
              <Activity
                className={`size-3 text-cyan-400 ${restTesting ? "animate-pulse" : ""}`}
              />
              <span>{restTesting ? "Menguji..." : "Uji REST API"}</span>
            </Button>
          </div>
        </div>

        {/* Quick Target Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border text-[10px] text-muted-foreground">
          <span>Target Cepat:</span>
          <button
            type="button"
            onClick={() => setTarget("8.8.8.8")}
            className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors"
          >
            Google DNS (8.8.8.8)
          </button>
          <button
            type="button"
            onClick={() => setTarget("1.1.1.1")}
            className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors"
          >
            Cloudflare (1.1.1.1)
          </button>
          <button
            type="button"
            onClick={() => setTarget("103.167.70.0")}
            className="px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors"
          >
            Gateway ISP (103.167.70.0)
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div className="rounded-xl bg-zinc-950 border border-zinc-800/80 p-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800/60">
          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
            <Terminal className="size-3.5 text-emerald-400" />
            <span className="font-semibold text-white">
              Terminal Ping RouterOS: {routerHost}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setTerminalLog([`[CLEARED] Konsol dibersihkan.`])}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Bersihkan Terminal"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        <div className="min-h-[140px] max-h-60 overflow-y-auto space-y-1 text-[11px] text-zinc-300 font-mono leading-relaxed select-text">
          {terminalLog.map((line, idx) => (
            <div
              key={idx}
              className={`${
                line.includes("[ERROR]")
                  ? "text-rose-400 font-medium"
                  : line.includes("[REST] OK") ||
                      line.includes("0% packet loss")
                    ? "text-emerald-400"
                    : line.startsWith("---")
                      ? "text-cyan-400"
                      : "text-zinc-300"
              }`}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
