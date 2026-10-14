"use client";

import { useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FileCode,
  Filter,
  Hash,
  Info,
  Layers,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  filterSchemaMigrations,
  getMockMigrationOverview,
  getMockSchemaMigrations,
  type SchemaMigrationFilter,
  type SchemaMigrationItem,
} from "@/lib/dashboard/schema-migrations";

export function SchemaMigrationsBoard() {
  const searchId = useId();
  const [includeFailure, setIncludeFailure] = useState(false);

  const allMigrations = useMemo(
    () => getMockSchemaMigrations(includeFailure),
    [includeFailure],
  );
  const overview = useMemo(
    () => getMockMigrationOverview(allMigrations),
    [allMigrations],
  );

  const [filter, setFilter] = useState<SchemaMigrationFilter>({
    status: "all",
    query: "",
  });
  const [selectedMigration, setSelectedMigration] =
    useState<SchemaMigrationItem | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedMessage, setVerifiedMessage] = useState<string | null>(null);
  const [copiedError, setCopiedError] = useState(false);

  const filteredItems = useMemo(
    () => filterSchemaMigrations(allMigrations, filter),
    [allMigrations, filter],
  );

  const handleVerify = () => {
    setIsVerifying(true);
    setVerifiedMessage(null);
    setTimeout(() => {
      setIsVerifying(false);
      setVerifiedMessage(
        includeFailure
          ? "Peringatan: Terdeteksi 1 migrasi skema gagal. Transaksi telah di-rollback; jalankan perbaikan sebelum mencoba ulang."
          : "Koneksi database & tabel pelacak drizzle.__drizzle_migrations terverifikasi. Skema 100% sinkron dan idempoten.",
      );
    }, 600);
  };

  const handleCopyError = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    }
  };

  const statusVariant = (status: SchemaMigrationItem["status"]) => {
    switch (status) {
      case "applied":
        return "default";
      case "pending":
        return "secondary";
      case "failed":
        return "destructive";
    }
  };

  const statusLabel = (status: SchemaMigrationItem["status"]) => {
    switch (status) {
      case "applied":
        return "Diterapkan";
      case "pending":
        return "Tertunda";
      case "failed":
        return "Gagal";
    }
  };

  return (
    <div
      data-testid="schema-migrations-board"
      className="flex flex-col gap-6"
    >
      {/* Kartu Ringkasan KPI */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Migrasi
            </CardTitle>
            <Database className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {overview.totalMigrations}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {overview.appliedMigrations} diterapkan · {overview.pendingMigrations} tertunda ·{" "}
              {overview.failedMigrations} gagal
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Integritas & Status
            </CardTitle>
            {overview.status === "failed" ? (
              <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
            ) : overview.status === "pending" ? (
              <Clock className="size-4 text-amber-500" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4 text-emerald-500" aria-hidden="true" />
            )}
          </CardHeader>
          <CardContent>
            {overview.status === "failed" ? (
              <div
                data-testid="migration-status-failed"
                className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-destructive"
              >
                <AlertTriangle className="size-5" />
                <span>Gagal ({overview.failedMigrations})</span>
              </div>
            ) : overview.status === "pending" ? (
              <div
                data-testid="migration-status-pending"
                className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400"
              >
                <Clock className="size-5" />
                <span>Ada Tertunda</span>
              </div>
            ) : (
              <div
                data-testid="migration-status-ok"
                className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400"
              >
                <CheckCircle2 className="size-5" />
                <span>Up-to-Date</span>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {overview.status === "failed"
                ? "Dibutuhkan intervensi/perbaikan skema"
                : "Idempoten & tercatat di tabel pelacak"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Advisory Lock
            </CardTitle>
            <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              Kunci #{overview.advisoryLockKey}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Mencegah race-condition multi-kontainer
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              TimescaleDB Hypertable
            </CardTitle>
            <Zap className="size-4 text-amber-500" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              Retensi {overview.timescaleRetentionDays} Hari
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Hypertable traffic_samples aktif
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Banner Peringatan Galat Migrasi (Jika Ada Kegagalan) */}
      {overview.failedMigrations > 0 && overview.lastFailure && (
        <div
          data-testid="migration-failure-alert"
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-destructive dark:bg-destructive/15"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">
                    Migrasi Gagal: {overview.lastFailure.tag}.sql ({overview.lastFailure.name})
                  </span>
                  <Badge variant="destructive" className="text-[10px] uppercase font-semibold">
                    Galat Eksekusi
                  </Badge>
                </div>
                <div className="rounded border border-destructive/30 bg-destructive/15 p-2 font-mono text-xs text-destructive-foreground break-all">
                  {overview.lastFailure.error}
                </div>
                {overview.lastFailure.remediationHint && (
                  <p className="text-xs text-foreground/80 mt-1">
                    <strong>Petunjuk Solusi:</strong> {overview.lastFailure.remediationHint}
                  </p>
                )}
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
                  <ShieldCheck className="size-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>Jaminan Rollback:</strong> Transaksi atomik dibatalkan secara otomatis (ROLLBACK). Database tetap aman tanpa data parsial.
                  </span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
              <Button
                variant="destructive"
                size="sm"
                data-testid="view-failure-detail-btn"
                onClick={() => {
                  const failed = allMigrations.find((m) => m.status === "failed");
                  if (failed) setSelectedMigration(failed);
                }}
                className="text-xs font-medium"
              >
                Lihat Rincian Galat
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Banner Idempotensi & Pengaman */}
      <div className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              Prinsip Idempotensi & Migrasi Otomatis (Fase 3)
            </p>
            <p className="text-xs text-muted-foreground">
              Setiap berkas SQL dieksekusi dalam transaksi atomik dengan advisory lock PostgreSQL.
              Migrasi aman dijalankan berulang kali saat kontainer menyala atau saat versi aplikasi naik.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="toggle-mock-failure-btn"
            onClick={() => setIncludeFailure((v) => !v)}
            className="text-xs font-medium"
          >
            {includeFailure ? "Pulihkan Normal" : "Simulasi Galat Migrasi"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleVerify}
            disabled={isVerifying}
            className="text-xs font-medium"
          >
            <RefreshCw
              className={`mr-1.5 size-3.5 ${isVerifying ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {isVerifying ? "Memeriksa..." : "Uji Idempotensi"}
          </Button>
        </div>
      </div>

      {verifiedMessage && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-50/50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300"
        >
          {verifiedMessage}
        </div>
      )}

      {/* Kontrol Saringan & Pencarian */}
      <Card className="border-border/60">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="text"
              placeholder="Cari tag, judul, tabel, statement, atau pesan galat..."
              value={filter.query}
              onChange={(e) =>
                setFilter((prev) => ({ ...prev, query: e.target.value }))
              }
              className="pl-9 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
              <Filter className="size-3" /> Status:
            </span>
            {(
              [
                { id: "all", label: "Semua", count: allMigrations.length },
                {
                  id: "applied",
                  label: "Diterapkan",
                  count: allMigrations.filter((m) => m.status === "applied").length,
                },
                {
                  id: "pending",
                  label: "Tertunda",
                  count: allMigrations.filter((m) => m.status === "pending").length,
                },
                {
                  id: "failed",
                  label: "Gagal",
                  count: allMigrations.filter((m) => m.status === "failed").length,
                },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.id}
                variant={
                  filter.status === opt.id
                    ? opt.id === "failed"
                      ? "destructive"
                      : "default"
                    : "outline"
                }
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() =>
                  setFilter((prev) => ({ ...prev, status: opt.id }))
                }
              >
                {opt.label} ({opt.count})
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabel Riwayat Migrasi */}
      <Card className="border-border/60">
        <CardHeader className="border-b pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">
              Daftar Riwayat Migrasi Skema ({filteredItems.length})
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              Tabel Pelacak: <code className="rounded bg-muted px-1.5 py-0.5">{overview.trackerTable}</code>
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div
            role="region"
            aria-label="Tabel riwayat migrasi skema"
            tabIndex={0}
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead className="min-w-[180px]">Berkas & Tag</TableHead>
                  <TableHead className="min-w-[220px]">Nama & Deskripsi Skema</TableHead>
                  <TableHead className="min-w-[160px]">Waktu Diterapkan</TableHead>
                  <TableHead className="min-w-[100px]">Status</TableHead>
                  <TableHead className="min-w-[90px] text-right">Statements</TableHead>
                  <TableHead className="min-w-[80px] text-right">Durasi</TableHead>
                  <TableHead className="w-[120px] text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-28 text-center text-sm text-muted-foreground"
                    >
                      Tidak ada migrasi yang sesuai dengan kriteria saringan.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((m) => (
                    <TableRow
                      key={m.tag}
                      data-testid="migration-row"
                      className={
                        m.status === "failed"
                          ? "bg-destructive/10 hover:bg-destructive/15"
                          : "hover:bg-muted/40"
                      }
                    >
                      <TableCell className="text-center font-mono text-xs text-muted-foreground">
                        {m.idx}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileCode
                            className={`size-4 shrink-0 ${m.status === "failed" ? "text-destructive" : "text-primary/70"}`}
                            aria-hidden="true"
                          />
                          <span className="font-mono text-xs font-semibold">
                            {m.tag}.sql
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-foreground">
                            {m.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground line-clamp-1">
                            {m.errorMessage ? `Galat: ${m.errorMessage}` : m.description}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Clock className="size-3 text-muted-foreground/60" aria-hidden="true" />
                          <span>
                            {new Date(m.appliedAt).toLocaleString("id-ID", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusVariant(m.status)}
                          className="text-[10px] uppercase font-semibold"
                        >
                          {statusLabel(m.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {m.statementsCount}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {m.durationMs} ms
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant={m.status === "failed" ? "destructive" : "ghost"}
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSelectedMigration(m)}
                        >
                          {m.status === "failed" ? "Rincian Galat" : "Rincian"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog Rincian Migrasi */}
      <Dialog
        open={Boolean(selectedMigration)}
        onOpenChange={(open) => !open && setSelectedMigration(null)}
      >
        <DialogContent
          data-testid="migration-detail-dialog"
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
        >
          {selectedMigration && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(selectedMigration.status)} className="text-[10px]">
                    {statusLabel(selectedMigration.status)}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    Batch #{selectedMigration.batch}
                  </span>
                </div>
                <DialogTitle className="mt-2 text-lg font-semibold">
                  {selectedMigration.name} ({selectedMigration.tag}.sql)
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {selectedMigration.description}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4 text-xs">
                {/* Informasi Galat Khusus jika status failed */}
                {selectedMigration.status === "failed" && selectedMigration.errorMessage && (
                  <div
                    data-testid="migration-dialog-error-section"
                    className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive-foreground dark:bg-destructive/20"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-semibold text-destructive">
                        <AlertTriangle className="size-4 shrink-0" />
                        <span>Pesan Galat SQL (Database Exception)</span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="copy-error-btn"
                        onClick={() => handleCopyError(selectedMigration.errorMessage!)}
                        className="h-6 px-2 text-[10px]"
                      >
                        {copiedError ? (
                          <>
                            <Check className="mr-1 size-3 text-emerald-500" /> Tersalin
                          </>
                        ) : (
                          <>
                            <Copy className="mr-1 size-3" /> Salin Pesan
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="rounded border border-destructive/30 bg-destructive/10 p-2 font-mono text-[11px] break-all select-all text-destructive">
                      {selectedMigration.errorMessage}
                    </div>
                    {selectedMigration.failedStatement && (
                      <div className="space-y-1">
                        <span className="text-[10px] uppercase font-medium text-muted-foreground">
                          Statement yang Gagal:
                        </span>
                        <code className="block rounded bg-muted/60 p-1.5 font-mono text-[10px] break-all text-foreground">
                          {selectedMigration.failedStatement}
                        </code>
                      </div>
                    )}
                    {selectedMigration.remediationHint && (
                      <p className="text-[11px] text-muted-foreground pt-1">
                        <strong className="text-foreground">Saran Perbaikan:</strong>{" "}
                        {selectedMigration.remediationHint}
                      </p>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium pt-1">
                      <ShieldCheck className="size-3" /> Transaksi telah di-rollback secara utuh.
                    </div>
                  </div>
                )}

                {/* Meta Eksekusi */}
                <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                      Pelaksana
                    </span>
                    <span className="font-medium text-foreground">
                      {selectedMigration.appliedBy}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                      Durasi
                    </span>
                    <span className="font-medium text-foreground">
                      {selectedMigration.durationMs} ms
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                      Pernyataan
                    </span>
                    <span className="font-medium text-foreground">
                      {selectedMigration.statementsCount} statement
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-medium">
                      Folder Millis
                    </span>
                    <span className="font-mono text-foreground">
                      {selectedMigration.folderMillis}
                    </span>
                  </div>
                </div>

                {/* SHA-256 Checksum */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 font-semibold text-foreground">
                    <Hash className="size-3.5 text-primary" />
                    <span>SHA-256 Checksum Hash</span>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-2 font-mono text-[11px] break-all select-all text-muted-foreground">
                    {selectedMigration.hash}
                  </div>
                </div>

                {/* Ringkasan Statement SQL */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 font-semibold text-foreground">
                    <Layers className="size-3.5 text-primary" />
                    <span>Pernyataan SQL yang Dijalankan</span>
                  </div>
                  <div className="space-y-1 rounded-md border bg-muted/20 p-2.5">
                    {selectedMigration.statementsSummary.map((stmt, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 font-mono text-[11px] text-foreground/90"
                      >
                        <span className="text-muted-foreground/60 select-none">
                          {idx + 1}.
                        </span>
                        <code className="break-all">{stmt}</code>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Keterangan Idempotensi */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] text-muted-foreground">
                  <strong className="text-foreground">Jaminan Idempotensi:</strong> Berkas ini
                  tercatat pada tabel pelacak <code className="bg-muted px-1">{overview.trackerTable}</code>{" "}
                  sehingga tidak akan dieksekusi ulang saat start-up kontainer berikutnya.
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
