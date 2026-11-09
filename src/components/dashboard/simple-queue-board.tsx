"use client";

import { useMemo, useReducer, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { SimpleQueueFormDialog } from "@/components/dashboard/simple-queue-form-dialog";
import {
  applyQueueEdit,
  createMockQueueFromInput,
  filterDeletedQueues,
  queueToFormInput,
  simulateDeleteQueue,
  type SimpleQueueFormInput,
} from "@/lib/dashboard/queue-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  initialRefresh,
  mockRefresh,
  refreshReducer,
} from "@/lib/dashboard/refresh-state";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  filterSimpleQueues,
  formatBitrate,
  formatBytes,
  generateMockSimpleQueues,
  type MockSimpleQueue,
  summarizeSimpleQueues,
  type QueueStatusFilter,
} from "@/lib/dashboard/routers";

const PAGE_SIZE = 10;

function pct(rate: number, max: number): number {
  return max > 0 ? Math.min(100, Math.round((rate / max) * 100)) : 0;
}

function Bar({ value, label }: { value: number; label: string }) {
  const tone =
    value >= 90 ? "bg-destructive" : value >= 70 ? "bg-warning" : "bg-success";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"
    >
      <div className={`h-full ${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function SimpleQueueBoard() {
  const routers = useDashboardStore((s) => s.routers);
  const customers = useDashboardStore((s) => s.customers);
  const [routerId, setRouterId] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<QueueStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [selectedQueue, setSelectedQueue] =
    useState<SimpleQueueFormInput | null>(null);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    message: string;
    retry?: MockSimpleQueue;
  } | null>(null);
  const [deletingQueue, setDeletingQueue] = useState<MockSimpleQueue | null>(
    null,
  );
  const [deletedQueueIds, setDeletedQueueIds] = useState<Set<string>>(
    new Set(),
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [addedQueues, setAddedQueues] = useState<MockSimpleQueue[]>([]);
  const [editedQueues, setEditedQueues] = useState<
    Record<string, MockSimpleQueue>
  >({});
  const [refresh, dispatch] = useReducer(refreshReducer, initialRefresh);
  const isRefreshing = refresh.status === "loading";

  async function handleRefresh() {
    if (isRefreshing) return;
    dispatch({ type: "start" });
    try {
      await mockRefresh(navigator.onLine);
      dispatch({ type: "success" });
    } catch (e) {
      dispatch({
        type: "fail",
        message: e instanceof Error ? e.message : "Gagal menyegarkan queue.",
      });
    }
  }

  const queues = useMemo(() => {
    const ids = routerId === "all" ? routers.map((r) => r.id) : [routerId];
    const base = ids.flatMap((id) => generateMockSimpleQueues(id, customers));
    const added = addedQueues.filter((q) => ids.includes(q.routerId));
    return filterDeletedQueues([...base, ...added], deletedQueueIds).map(
      (q) => editedQueues[q.id] ?? q,
    );
  }, [
    routers,
    customers,
    routerId,
    addedQueues,
    editedQueues,
    deletedQueueIds,
  ]);

  function openCreate() {
    setFormMode("create");
    setSelectedQueue(null);
    setFormOpen(true);
  }

  function openEdit(q: MockSimpleQueue) {
    setFormMode("edit");
    setSelectedQueue(queueToFormInput(q));
    setFormOpen(true);
  }

  function handleSubmit(input: SimpleQueueFormInput) {
    if (formMode === "create") {
      const q = createMockQueueFromInput(input);
      setAddedQueues((a) => [...a, q]);
      setNotice({
        type: "success",
        message: `Queue ${q.name} berhasil ditambahkan`,
      });
    } else {
      const existing = queues.find((q) => q.id === input.id);
      if (!existing) {
        setNotice({ type: "error", message: "Queue tidak ditemukan." });
      } else {
        const updated = applyQueueEdit(existing, input);
        setEditedQueues((e) => ({ ...e, [updated.id]: updated }));
        setNotice({
          type: "success",
          message: `Queue ${updated.name} berhasil diperbarui`,
        });
      }
    }
    setFormOpen(false);
  }
  async function handleConfirmDelete() {
    const q = deletingQueue;
    if (!q || isDeleting) return;
    setIsDeleting(true);
    await new Promise((res) => setTimeout(res, 300));
    const result = simulateDeleteQueue(q);
    if (result.ok) {
      setDeletedQueueIds((ids) => new Set(ids).add(q.id));
      setNotice({
        type: "success",
        message: `Queue '${q.name}' berhasil dihapus.`,
      });
    } else {
      setNotice({
        type: "error",
        message: `Gagal menghapus queue '${q.name}': ${result.reason}`,
        retry: q,
      });
    }
    setIsDeleting(false);
    setDeletingQueue(null);
  }

  const routerName = useMemo(
    () => new Map(routers.map((r) => [r.id, r.name])),
    [routers],
  );
  const summary = useMemo(() => summarizeSimpleQueues(queues), [queues]);
  const visible = useMemo(
    () => filterSimpleQueues(queues, query, status),
    [queues, query, status],
  );

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const tiles = [
    { label: "Total Queue", value: String(summary.total) },
    { label: "Queue Aktif", value: String(summary.active) },
    { label: "Queue Nonaktif", value: String(summary.disabled) },
    {
      label: "Total Trafik Live",
      value: `↑ ${formatBitrate(summary.rateUpload)}  ↓ ${formatBitrate(summary.rateDownload)}`,
    },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit gap-1.5"
          asChild
        >
          <Link href="/app/router">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Kembali ke Kelola Router
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Daftar Simple Queue MikroTik
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Manajemen limitasi bandwidth, prioritas paket, dan pemantauan trafik
          per IP target/pelanggan.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t.label}</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                {t.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={routerId}
            onChange={(e) => {
              setRouterId(e.target.value);
              setPage(1);
            }}
            aria-label="Pilih router"
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">Semua Router</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Cari nama, IP target, atau komentar…"
            aria-label="Cari simple queue"
            className="h-9 max-w-xs"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as QueueStatusFilter);
              setPage(1);
            }}
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
          <Button
            type="button"
            size="sm"
            onClick={openCreate}
            className="h-9 gap-1.5 text-xs"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Tambah Queue
          </Button>
        </div>

        {notice && (
          <div
            role={notice.type === "error" ? "alert" : "status"}
            data-testid="queue-notice"
            className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
              notice.type === "error"
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-success/50 bg-success/10 text-success"
            }`}
          >
            <span className="flex items-center gap-2">
              {notice.type === "error" ? (
                <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              )}
              {notice.message}
            </span>
            <span className="flex items-center gap-1">
              {notice.retry && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeletingQueue(notice.retry ?? null);
                    setNotice(null);
                  }}
                  className="h-8 text-xs"
                >
                  Coba lagi
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setNotice(null)}
                aria-label="Tutup notifikasi"
                className="h-8 w-8 p-0"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </span>
          </div>
        )}

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
          className="overflow-auto rounded-md border"
          role="region"
          aria-label="Tabel simple queue"
          tabIndex={0}
        >
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Nama &amp; Komentar</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Max Limit (Up/Down)</TableHead>
                <TableHead>Traffic Saat Ini</TableHead>
                <TableHead>Total Transfer</TableHead>
                <TableHead className="text-right">Dropped</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isRefreshing ? (
                [0, 1, 2].map((i) => (
                  <TableRow key={`skeleton-${i}`} aria-hidden="true">
                    <TableCell colSpan={8}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {queues.length === 0
                      ? "Belum ada simple queue. Pilih router lain atau tambahkan pelanggan."
                      : "Tidak ada queue yang cocok. Ubah kata kunci atau filter status."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((q) => {
                  const up = pct(q.rate.upload, q.maxLimit.upload);
                  const down = pct(q.rate.download, q.maxLimit.download);
                  return (
                    <TableRow key={q.id}>
                      <TableCell>
                        <div className="font-semibold">{q.name}</div>
                        {q.comment && (
                          <div className="text-[11px] text-muted-foreground">
                            {q.comment}
                          </div>
                        )}
                        {routerId === "all" && (
                          <div className="text-[11px] text-muted-foreground">
                            {routerName.get(q.routerId) ?? q.routerId}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {q.target}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        <div>↑ {formatBitrate(q.maxLimit.upload)}</div>
                        <div>↓ {formatBitrate(q.maxLimit.download)}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        <div className="space-y-1">
                          <div>
                            ↑ {formatBitrate(q.rate.upload)} ({up}%)
                          </div>
                          <Bar value={up} label={`Utilitas upload ${q.name}`} />
                          <div>
                            ↓ {formatBitrate(q.rate.download)} ({down}%)
                          </div>
                          <Bar
                            value={down}
                            label={`Utilitas download ${q.name}`}
                          />
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
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(q)}
                          aria-label={`Ubah queue ${q.name}`}
                          className="h-8 gap-1.5 text-xs"
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Ubah
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDeletingQueue(q)}
                          aria-label={`Hapus queue ${q.name}`}
                          data-testid="delete-queue-btn"
                          className="ml-2 h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          Hapus
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {visible.length > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span>
              Halaman {current} dari {pages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={current <= 1}
              onClick={() => current > 1 && setPage(current - 1)}
            >
              Sebelumnya
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={current >= pages}
              onClick={() => current < pages && setPage(current + 1)}
            >
              Berikutnya
            </Button>
          </div>
        )}
      </div>

      <SimpleQueueFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        routers={routers}
        initial={selectedQueue}
        defaultRouterId={routerId === "all" ? undefined : routerId}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={deletingQueue !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeletingQueue(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus Simple Queue &quot;{deletingQueue?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletingQueue && (
                <>
                  Target {deletingQueue.target}, batas{" "}
                  {formatBitrate(deletingQueue.maxLimit.upload)} /{" "}
                  {formatBitrate(deletingQueue.maxLimit.download)}.{" "}
                </>
              )}
              Tindakan ini akan menghapus aturan limitasi bandwidth ini dari
              router.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-disabled={isDeleting}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              aria-disabled={isDeleting}
              data-testid="confirm-delete-queue-btn"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
            >
              {isDeleting ? "Menghapus..." : "Ya, Hapus Queue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
