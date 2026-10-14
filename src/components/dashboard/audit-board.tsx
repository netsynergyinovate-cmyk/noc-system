"use client";

import { useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Clock,
  EyeOff,
  LogIn,
  LogOut,
  RefreshCw,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Users,
  Wifi,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { formatAlertTime } from "@/lib/dashboard/alerts";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_REFRESH_MS,
  AUDIT_WINDOW_DAYS,
  auditActions,
  auditActorType,
  auditGroupLabels,
  auditView,
  describeChange,
  formatAuditAge,
  loadAudit,
  pageAudit,
  summarizeAudit,
  type AuditAction,
  type AuditEntry,
  type AuditGroup,
  type AuditIconName,
  type AuditSummary,
} from "@/lib/dashboard/audit";
import {
  actorOptions,
  auditFacetCounts,
  describeFilter,
  emptyAuditFilter,
  filterAudit,
  isFilterActive,
  type AuditFilter,
} from "@/lib/dashboard/audit-filter";
import { formatInteger } from "@/lib/dashboard/format";
import { useNowMinute } from "@/lib/dashboard/use-now";
import { usePolled } from "@/lib/dashboard/use-polled";
import {
  AuditFilterBar,
  AuditFilterResult,
  AuditNoMatch,
} from "./audit-filters";
import { MetricCard } from "./metric-card";

// Nama ikon di tabel aksi (lib murni) menjadi gambarnya di sini.
const icons: Record<AuditIconName, LucideIcon> = {
  LogIn,
  LogOut,
  CircleCheck,
  SlidersHorizontal,
  CirclePlus,
  Wrench,
  Wifi,
  RefreshCw,
  Settings,
};

// Kelompok aksi dibedakan warna tema, tetapi lencananya selalu memuat ikon dan
// tulisan: warna hanya pelengkap.
const groupStyles: Record<AuditGroup, string> = {
  akses: "bg-secondary text-foreground",
  alert: "bg-warning/10 text-warning",
  perangkat: "bg-success/10 text-success",
  pengaturan: "bg-primary/10 text-primary",
};

// Fungsi modul yang tetap, seperti yang diminta usePolled.
const loadWindow = (nowSec: number) => loadAudit({ nowSec });

function Skeleton({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-lg bg-muted motion-reduce:animate-none",
        className,
      )}
    />
  );
}

function AuditActionBadge({ action }: { action: AuditAction }) {
  const info = auditActions[action];
  const Icon = icons[info.icon];
  return (
    <span
      data-testid="audit-action"
      data-group={info.group}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        groupStyles[info.group],
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {info.label}
    </span>
  );
}

// Rincian: ringkasan, lalu tiap bidang yang berubah. Bidang rahasia hanya
// bertuliskan bahwa nilainya disembunyikan (datanya memang tidak membawa nilai).
function AuditDetail({ entry }: { entry: AuditEntry }) {
  return (
    <>
      <p data-testid="audit-summary">{entry.summary}</p>
      {entry.changes.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {entry.changes.map((change) => (
            <li
              key={change.field}
              data-testid="audit-change"
              data-redacted={change.redacted === true}
              className="inline-flex items-center gap-1.5"
            >
              {change.redacted && (
                <EyeOff className="size-3 shrink-0" aria-hidden="true" />
              )}
              {describeChange(change)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AuditTable({ entries, now }: { entries: AuditEntry[]; now: number }) {
  return (
    <div
      // relative: teks sr-only di dalam sel bersifat absolute; tanpa penampung
      // berposisi ia lolos dari overflow dan melebarkan seluruh halaman.
      className="relative overflow-x-auto rounded-lg border"
      data-testid="audit-table"
      tabIndex={0}
      role="region"
      aria-label="Daftar jejak aktivitas"
    >
      <table className="w-full min-w-[56rem] text-left text-sm">
        <caption className="sr-only">
          Catatan aktivitas petugas dan sistem, yang terbaru di atas; waktu
          ditulis sampai detik, diikuti petugas, aksi, objek yang diubah, dan
          rincian perubahannya
        </caption>
        <thead className="bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Waktu
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Petugas
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Aksi
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Objek
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Rincian
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              data-testid="audit-row"
              data-entry-id={entry.id}
              data-action={entry.action}
              data-actor={entry.actor.id}
              data-action-kind={entry.action}
              data-action-group={auditActions[entry.action]?.group}
              className="border-t align-top"
            >
              <td className="px-4 py-3 whitespace-nowrap">
                <time
                  dateTime={new Date(entry.at * 1000).toISOString()}
                  data-testid="audit-time"
                  data-epoch={entry.at}
                  className="font-medium tabular-nums"
                >
                  {formatAlertTime(entry.at, now)}
                </time>
                <span
                  data-testid="audit-age"
                  className="block text-xs text-muted-foreground"
                >
                  {formatAuditAge(entry.at, now)}
                </span>
              </td>
              <td
                className="px-4 py-3"
                data-testid="audit-actor"
                data-actor-type={auditActorType(entry.actor)}
              >
                <span data-testid="audit-actor-name">{entry.actor.name}</span>{" "}
                {auditActorType(entry.actor) === "system" ? (
                  <Badge
                    variant="secondary"
                    className="px-1 py-0 text-[10px] font-normal"
                  >
                    Sistem
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="px-1 py-0 text-[10px] font-normal"
                  >
                    Operator
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3">
                <AuditActionBadge action={entry.action} />
                <span
                  data-testid="audit-group"
                  className="mt-1 block text-xs text-muted-foreground"
                >
                  {auditGroupLabels[auditActions[entry.action].group]}
                </span>
              </td>
              <td className="px-4 py-3 [overflow-wrap:anywhere]">
                {entry.target}
              </td>
              <td className="min-w-64 px-4 py-3">
                <AuditDetail entry={entry} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tombol halaman memakai aria-disabled, bukan disabled: tombol yang menjadi
// nonaktif sesudah ditekan membuang fokus papan ketik.
function PageButton({
  direction,
  enabled,
  onPress,
}: {
  direction: "previous" | "next";
  enabled: boolean;
  onPress: () => void;
}) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid={`audit-${direction}`}
      aria-disabled={!enabled}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      onClick={() => {
        if (enabled) onPress();
      }}
    >
      {direction === "previous" && <Icon aria-hidden="true" />}
      {direction === "previous" ? "Sebelumnya" : "Berikutnya"}
      {direction === "next" && <Icon aria-hidden="true" />}
    </Button>
  );
}

// Tiga angka sekilas, semuanya dihitung dari catatan yang sedang tampil.
function AuditTiles({ summary }: { summary: AuditSummary }) {
  return (
    <section
      aria-label="Ringkasan jejak aktivitas"
      className="grid gap-4 sm:grid-cols-3"
    >
      <MetricCard
        data-testid="audit-tile"
        data-kind="total"
        data-value={summary.total}
        label={`Catatan ${AUDIT_WINDOW_DAYS} hari`}
        value={formatInteger(summary.total)}
        hint="Semua catatan dalam jendela ini"
        Icon={ScrollText}
      />
      <MetricCard
        data-testid="audit-tile"
        data-kind="last24h"
        data-value={summary.last24h}
        label="24 jam terakhir"
        value={formatInteger(summary.last24h)}
        hint="Catatan sejak 24 jam lalu"
        Icon={Clock}
      />
      <MetricCard
        data-testid="audit-tile"
        data-kind="operators"
        data-value={summary.operators}
        label="Petugas aktif"
        value={formatInteger(summary.operators)}
        hint={`Petugas yang tercatat dalam ${AUDIT_WINDOW_DAYS} hari terakhir`}
        Icon={Users}
      />
    </section>
  );
}

function AuditLog({ entries, now }: { entries: AuditEntry[]; now: number }) {
  // Saringan dan halaman yang dipilih adalah satu keadaan: mengubah saringan
  // (mengetik, memilih, menghapus) selalu kembali ke halaman pertama, bukan ke
  // halaman yang mungkin tak ada lagi. Keadaan ini hidup di komponen ini, jadi
  // bertahan ketika `entries` diganti oleh penyegaran berkala.
  const [view, setView] = useState<{ filter: AuditFilter; page: number }>({
    filter: emptyAuditFilter,
    page: 1,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  // Awal menit sekarang: batas "1 jam / 24 jam / 7 hari terakhir" ikut bergeser
  // tiap menit tanpa menggambar ulang tiap detik.
  const nowMinute = useNowMinute();
  const actors = useMemo(() => actorOptions(entries), [entries]);
  const visible = useMemo(
    () => filterAudit(entries, view.filter, nowMinute),
    [entries, view.filter, nowMinute],
  );
  const counts = useMemo(
    () => auditFacetCounts(entries, view.filter, nowMinute),
    [entries, view.filter, nowMinute],
  );
  // Daftar bisa menyusut sejak halaman dipilih (catatan lama keluar dari jendela
  // atau saringan baru), jadi nomor yang diminta dipaksa masuk rentang oleh
  // pageAudit.
  const shown = useMemo(
    () => pageAudit(visible, view.page, AUDIT_PAGE_SIZE),
    [visible, view.page],
  );
  const filtered = isFilterActive(view.filter);
  const description = describeFilter(view.filter, actors);
  const setFilter = (filter: AuditFilter) => setView({ filter, page: 1 });
  const setPage = (page: number) =>
    setView((current) => ({ ...current, page }));
  // Tombol di pesan kosong hilang bersama pesannya, jadi fokus dipindah ke kolom
  // cari (yang tetap ada) supaya petugas bisa langsung mengetik lagi.
  const showAll = () => {
    setFilter(emptyAuditFilter);
    searchRef.current?.focus();
  };

  return (
    <Card
      data-testid="audit-log"
      data-total={entries.length}
      data-filtered={visible.length}
      data-page={shown.page}
      data-page-count={shown.pageCount}
    >
      <CardHeader>
        <h2 className="leading-none font-semibold">Riwayat aktivitas</h2>
        <CardDescription>
          Dalam {AUDIT_WINDOW_DAYS} hari terakhir, yang terbaru di atas.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <AuditFilterBar
          filter={view.filter}
          counts={counts}
          actors={actors}
          searchRef={searchRef}
          onChange={setFilter}
        />
        <AuditFilterResult
          visible={visible.length}
          total={entries.length}
          active={filtered}
          description={description}
        />
        {visible.length === 0 ? (
          <AuditNoMatch description={description} onShowAll={showAll} />
        ) : (
          <>
            <AuditTable entries={shown.items} now={now} />
            <nav
              aria-label="Halaman jejak aktivitas"
              className="flex flex-wrap items-center justify-between gap-3"
            >
              <p
                role="status"
                data-testid="audit-page-status"
                className="text-sm text-muted-foreground"
              >
                {`Halaman ${formatInteger(shown.page)} dari ${formatInteger(shown.pageCount)}, catatan ${formatInteger(shown.from)}–${formatInteger(shown.to)} dari ${formatInteger(shown.total)}`}
              </p>
              <div className="flex gap-2">
                <PageButton
                  direction="previous"
                  enabled={shown.page > 1}
                  onPress={() => setPage(shown.page - 1)}
                />
                <PageButton
                  direction="next"
                  enabled={shown.page < shown.pageCount}
                  onPress={() => setPage(shown.page + 1)}
                />
              </div>
            </nav>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Nilai rahasia seperti kata sandi, token, dan kunci API tidak pernah
          dicatat: bila berubah, yang tertulis hanya bahwa bidangnya berubah.
          Waktu ditulis sampai detik mengikuti jam server, dan ditampilkan di
          zona waktu peramban ini.
        </p>
      </CardContent>
    </Card>
  );
}

// Halaman Jejak Aktivitas: ringkasan dan daftar catatan siapa mengubah apa dan
// kapan. Data dimuat lewat loadAudit (tiruan sekarang, GET /api/v1/audit nanti)
// dan disegarkan berkala; gagal memuat tidak menghapus data terakhir.
export function AuditBoard() {
  const { state, failed, retry } = usePolled(loadWindow, AUDIT_REFRESH_MS);
  const entries = state?.data ?? null;
  const now = state?.now ?? 0;
  const view = auditView(entries, failed);
  const summary = useMemo(
    () => (entries ? summarizeAudit(entries, now) : null),
    [entries, now],
  );

  return (
    <div
      data-testid="audit-board"
      data-view={view.kind}
      className="flex flex-col gap-6"
    >
      <Badge
        variant="outline"
        className="gap-1.5 py-1 text-xs font-normal"
        data-testid="audit-mock-badge"
      >
        Data Tiruan Audit (Fase 2) · Wajib beralih ke database audit_log nyata di
        Fase 5
      </Badge>
      {(view.kind === "error" || view.stale) && (
        <div
          role="alert"
          data-testid="audit-error"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {view.stale
            ? "Pembaruan terakhir gagal; yang tampil adalah data sebelumnya."
            : "Jejak aktivitas belum bisa dimuat."}
          <Button variant="outline" size="sm" onClick={retry}>
            Coba lagi
          </Button>
        </div>
      )}
      {view.kind === "loading" && (
        <div
          role="status"
          aria-label="Memuat jejak aktivitas"
          data-testid="audit-loading"
          className="flex flex-col gap-6"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      )}
      {view.kind === "empty" && (
        <div
          data-testid="audit-empty"
          className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground"
        >
          <ScrollText className="mx-auto mb-2 size-6" aria-hidden="true" />
          <p className="font-medium text-foreground">
            Belum ada aktivitas tercatat
          </p>
          <p className="mt-1">
            Perubahan yang dilakukan petugas akan muncul di sini.
          </p>
        </div>
      )}
      {view.kind === "ready" && entries && summary && (
        <>
          <AuditTiles summary={summary} />
          <AuditLog entries={entries} now={now} />
        </>
      )}
    </div>
  );
}
