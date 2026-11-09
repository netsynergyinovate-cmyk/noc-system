"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { RefreshCw, Search, Users, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  initialRefresh,
  mockRefresh,
  refreshReducer,
} from "@/lib/dashboard/refresh-state";
import type { RouterPppoeSession } from "@/services/router-pppoe.service";

const PPPOE_REFRESH_MS = 10_000;

function useLivePppoeSessions(routerId: string, enabled: boolean) {
  const [sessions, setSessions] = useState<RouterPppoeSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (): Promise<boolean> => {
    if (!enabled) return true;
    try {
      const res = await fetch(
        `/api/routers/${encodeURIComponent(routerId)}/pppoe`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data?: RouterPppoeSession[] };
      if (alive.current) {
        setSessions(json.data ?? []);
        setFailed(false);
      }
      return true;
    } catch {
      if (alive.current) setFailed(true);
      return false;
    }
  }, [routerId, enabled]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), PPPOE_REFRESH_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, load]);

  return { sessions, failed, refresh: load };
}

export function RouterPppoeTable({
  routerId,
  routerName,
}: {
  routerId: string;
  routerName: string;
}) {
  const isDemo = useSession(selectPreviewEnabled);
  const live = useLivePppoeSessions(routerId, !isDemo);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [refresh, dispatch] = useReducer(refreshReducer, initialRefresh);
  const isRefreshing = refresh.status === "loading";

  async function handleRefresh() {
    if (isRefreshing) return;
    dispatch({ type: "start" });
    try {
      if (isDemo) {
        await mockRefresh(navigator.onLine);
      } else if (!(await live.refresh())) {
        throw new Error("Server tidak bisa membaca sesi PPPoE dari router.");
      }
      dispatch({ type: "success" });
    } catch (e) {
      dispatch({
        type: "fail",
        message: e instanceof Error ? e.message : "Gagal menyegarkan sesi.",
      });
    }
  }

  const allSessions = useMemo(() => live.sessions ?? [], [live.sessions]);

  const visible = useMemo(() => {
    if (!query.trim()) return allSessions;
    const lower = query.toLowerCase().trim();
    return allSessions.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.address.toLowerCase().includes(lower) ||
        s.callerId.toLowerCase().includes(lower) ||
        (s.customerName && s.customerName.toLowerCase().includes(lower)),
    );
  }, [allSessions, query]);

  function handleCopy(text: string, id: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="space-y-3 font-mono text-xs">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-muted/40 border border-border">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-cyan-400" />
          <span className="font-semibold text-foreground">
            Sesi PPPoE Aktif:
          </span>
          <Badge
            variant="outline"
            className="border-cyan-800/80 bg-cyan-950/40 text-cyan-400 font-semibold text-[11px]"
          >
            {allSessions.length} Sesi Terhubung
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari user, IP, MAC, nama..."
              className="h-8 pl-8 pr-3 w-56 text-xs bg-background border-border text-foreground placeholder:text-muted-foreground rounded-lg"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 px-2.5 bg-muted hover:bg-muted border-border text-foreground/90 text-xs gap-1.5"
          >
            <RefreshCw
              className={`size-3 text-cyan-400 ${isRefreshing ? "animate-spin" : ""}`}
            />
            <span>{isRefreshing ? "..." : "Segarkan"}</span>
          </Button>
        </div>
      </div>

      {refresh.status === "error" && (
        <div
          role="alert"
          className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs"
        >
          {refresh.message}
        </div>
      )}

      {/* Table Container */}
      <div className="max-h-80 overflow-y-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left whitespace-nowrap">
          <thead className="sticky top-0 bg-muted text-muted-foreground font-mono text-[10px] uppercase tracking-wider border-b border-border">
            <tr>
              <th className="py-2.5 px-3">#</th>
              <th className="py-2.5 px-3">Pelanggan / Username</th>
              <th className="py-2.5 px-3">Alamat IP Klien</th>
              <th className="py-2.5 px-3">MAC / Caller ID</th>
              <th className="py-2.5 px-3">Uptime Sesi</th>
              <th className="py-2.5 px-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 text-[11px]">
            {isRefreshing && allSessions.length === 0 ? (
              [0, 1, 2, 3].map((i) => (
                <tr key={`skel-${i}`}>
                  <td colSpan={6} className="py-3 px-3">
                    <div className="h-4 w-full animate-pulse rounded bg-muted/60" />
                  </td>
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  {allSessions.length === 0
                    ? `Tidak ada sesi PPPoE aktif di ${routerName}.`
                    : "Tidak ada sesi yang cocok dengan kata kunci pencarian."}
                </td>
              </tr>
            ) : (
              visible.map((s, idx) => (
                <tr
                  key={s.id || s.name}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2.5 px-3 text-muted-foreground text-[10px]">
                    {idx + 1}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">
                        {s.customerName || s.name.split("@")[0]}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {s.name}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5 font-mono text-cyan-400">
                      <span>{s.address}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(s.address, s.id + "-ip")}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Salin IP"
                      >
                        {copiedId === s.id + "-ip" ? (
                          <Check className="size-3 text-emerald-400" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground font-mono text-[10px]">
                    {s.callerId || "—"}
                  </td>
                  <td className="py-2.5 px-3 text-foreground/90 font-mono text-[10px]">
                    {s.uptimeHuman || s.uptime}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 text-[10px]">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Aktif
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
