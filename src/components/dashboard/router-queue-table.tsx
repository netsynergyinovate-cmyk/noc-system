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
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initialRefresh, refreshReducer } from "@/lib/dashboard/refresh-state";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  filterSimpleQueues,
  formatBitrate,
  formatBytes,
  generateMockSimpleQueues,
  type MockSimpleQueue,
  type QueueStatusFilter,
} from "@/lib/dashboard/routers";

const QUEUE_REFRESH_MS = 15_000;

// Mode live: daftar simple queue dibaca server langsung dari router
// (GET /api/routers/{id}/queues), disegarkan berkala.
function useLiveQueues(routerId: string, enabled: boolean) {
  const [queues, setQueues] = useState<MockSimpleQueue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (): Promise<boolean> => {
    if (!enabled) return true;
    try {
      const res = await fetch(
        `/api/routers/${encodeURIComponent(routerId)}/queues`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data?: MockSimpleQueue[] };
      if (alive.current) {
        setQueues(json.data ?? []);
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
    const timer = setInterval(() => void load(), QUEUE_REFRESH_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, load]);

  return { queues, failed, refresh: load };
}

function pct(rate: number, max: number): number {
  return max > 0 ? Math.min(100, Math.round((rate / max) * 100)) : 0;
}

export function RouterQueueTable({
  routerId,
  routerName,
}: {
  routerId: string;
  routerName: string;
}) {
  const customers = useDashboardStore((s) => s.customers);
  const live = useLiveQueues(routerId, true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<QueueStatusFilter>("all");
  const [refresh, dispatch] = useReducer(refreshReducer, initialRefresh);
  const isRefreshing = refresh.status === "loading";

  async function handleRefresh() {
    if (isRefreshing) return;
    dispatch({ type: "start" });
    try {
      if (!(await live.refresh())) {
        throw new Error(
          "Server tidak bisa membaca queue dari router. Coba lagi sebentar.",
        );
      }
      dispatch({ type: "success" });
    } catch (e) {
      dispatch({
        type: "fail",
        message: e instanceof Error ? e.message : "Gagal menyegarkan queue.",
      });
    }
  }

  const queues = live.queues ?? [];
  const visible = useMemo(
    () => filterSimpleQueues(queues, query, status),
    [queues, query, status],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama, IP target, atau komentar…"
          aria-label={`Cari simple queue ${routerName}`}
          className="h-9 max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as QueueStatusFilter)}
          aria-label="Filter status queue"
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Semua</option>
          <option value="active">Aktif</option>
          <option value="disabled">Nonaktif</option>
        </select>
        <span className="text-xs text-muted-foreground" role="status">
          {visible.length} dari {queues.length} queue
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          aria-disabled={isRefreshing}
          aria-label="Segarkan simple queue"
          className="h-9 gap-1.5 text-xs"
        >
          <RefreshCw
            className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isRefreshing ? "Menyegarkan..." : "Segarkan"}
        </Button>
      </div>

      {refresh.status === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{refresh.message}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="h-8 text-xs"
          >
            Coba lagi
          </Button>
        </div>
      )}

      <div
        className="max-h-80 overflow-auto rounded-md border"
        role="region"
        aria-label="Tabel simple queue"
        tabIndex={0}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              <TableHead>Nama &amp; Target</TableHead>
              <TableHead>Max Limit (Up/Down)</TableHead>
              <TableHead>Traffic Saat Ini</TableHead>
              <TableHead>Total Transfer</TableHead>
              <TableHead className="text-right">Dropped</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isRefreshing ? (
              [0, 1, 2].map((i) => (
                <TableRow key={`skeleton-${i}`} aria-hidden="true">
                  <TableCell colSpan={6}>
                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  </TableCell>
                </TableRow>
              ))
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  {queues.length === 0
                    ? "Belum ada simple queue di router ini."
                    : "Tidak ada queue yang cocok dengan pencarian."}
                </TableCell>
              </TableRow>
            ) : (
              visible.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>
                    <div className="font-semibold">{q.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {q.target}
                    </div>
                    {q.comment && (
                      <div className="text-[11px] text-muted-foreground">
                        {q.comment}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    <div>↑ {formatBitrate(q.maxLimit.upload)}</div>
                    <div>↓ {formatBitrate(q.maxLimit.download)}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    <div>
                      ↑ {formatBitrate(q.rate.upload)} (
                      {pct(q.rate.upload, q.maxLimit.upload)}%)
                    </div>
                    <div>
                      ↓ {formatBitrate(q.rate.download)} (
                      {pct(q.rate.download, q.maxLimit.download)}%)
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    <div>↑ {formatBytes(q.bytes.upload)}</div>
                    <div>↓ {formatBytes(q.bytes.download)}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {q.dropped.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell>
                    {q.disabled ? (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        Nonaktif
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-success/50 bg-success/10 text-success"
                      >
                        Aktif
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
