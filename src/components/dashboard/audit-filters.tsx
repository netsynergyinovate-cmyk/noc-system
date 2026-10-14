"use client";

import type { ReactNode, Ref } from "react";
import { Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  auditActionList,
  auditActions,
  type AuditAction,
  type AuditActor,
} from "@/lib/dashboard/audit";
import {
  auditWithinLabels,
  emptyAuditFilter,
  isFilterActive,
  type AuditFacetCounts,
  type AuditFilter,
  type AuditWithin,
} from "@/lib/dashboard/audit-filter";
import { formatInteger } from "@/lib/dashboard/format";
import { selectClassName } from "./select-class";

const withinOptions = ["1h", "24h", "7d"] as const;

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

// Pencarian dan saringan jejak aktivitas. Angka di tiap pilihan adalah banyaknya
// catatan yang akan tampil bila pilihan itu dipilih (saringan lain tetap
// berlaku), jadi petugas tahu sebelum memilih apakah ada isinya. Mengetik
// langsung menyaring; Escape di kolom cari menghapus tulisannya. Tombol hapus
// memakai aria-disabled (bukan disabled) supaya fokus papan ketik tidak hilang
// ketika saringan baru saja dikosongkan.
export function AuditFilterBar({
  filter,
  counts,
  actors,
  searchRef,
  onChange,
}: {
  filter: AuditFilter;
  counts: AuditFacetCounts;
  actors: readonly AuditActor[];
  searchRef: Ref<HTMLInputElement>;
  onChange: (filter: AuditFilter) => void;
}) {
  const n = formatInteger;
  const active = isFilterActive(filter);
  // Petugas yang sedang dipilih bisa hilang dari data (catatannya keluar dari
  // jendela saat disegarkan); pilihannya tetap ada supaya isian tidak diam-diam
  // tampil "Semua petugas" padahal saringannya masih berlaku.
  const choices =
    filter.actor === "all" || actors.some((actor) => actor.id === filter.actor)
      ? actors
      : [...actors, { id: filter.actor, name: filter.actor }];

  return (
    // Enter di kolom cari tidak boleh mengirim formulir dan memuat ulang halaman.
    <form
      role="search"
      aria-label="Cari dan saring jejak aktivitas"
      data-testid="audit-filter-bar"
      onSubmit={(event) => event.preventDefault()}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:items-end"
    >
      <div className="sm:col-span-2 xl:col-span-4">
        <Field id="audit-search" label="Cari aktivitas">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={searchRef}
              id="audit-search"
              type="search"
              autoComplete="off"
              placeholder="mis. router, Andi, kata sandi"
              aria-describedby="audit-search-help"
              className="pl-9"
              value={filter.query}
              onChange={(event) =>
                onChange({ ...filter, query: event.target.value })
              }
              onKeyDown={(event) => {
                // Escape menghapus tulisan (bukan saat memilih huruf lewat IME,
                // yang memakai Escape untuk membatalkan komposisi).
                if (
                  event.key === "Escape" &&
                  filter.query !== "" &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  onChange({ ...filter, query: "" });
                }
              }}
            />
          </div>
        </Field>
        <p
          id="audit-search-help"
          className="mt-1.5 text-xs text-muted-foreground"
        >
          Mencocokkan nama petugas, aksi, kelompok aksi (Akses, Alert,
          Perangkat, Pengaturan), objek, ringkasan, dan rincian perubahan. Semua
          kata harus ada; urutannya bebas.
        </p>
      </div>
      <Field id="audit-filter-action" label="Aksi">
        <select
          id="audit-filter-action"
          className={selectClassName}
          value={filter.action}
          onChange={(event) =>
            onChange({
              ...filter,
              action: event.target.value as AuditAction | "all",
            })
          }
        >
          <option value="all">Semua aksi ({n(counts.action.all)})</option>
          {auditActionList.map((action) => (
            <option key={action} value={action}>
              {auditActions[action].label} ({n(counts.action[action])})
            </option>
          ))}
        </select>
      </Field>
      <Field id="audit-filter-actor" label="Petugas">
        <select
          id="audit-filter-actor"
          className={selectClassName}
          value={filter.actor}
          onChange={(event) =>
            onChange({ ...filter, actor: event.target.value })
          }
        >
          <option value="all">Semua petugas ({n(counts.actor.all)})</option>
          {choices.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name} ({n(counts.actor[actor.id] ?? 0)})
            </option>
          ))}
        </select>
      </Field>
      <Field id="audit-filter-within" label="Waktu">
        <select
          id="audit-filter-within"
          className={selectClassName}
          value={filter.within}
          onChange={(event) =>
            onChange({ ...filter, within: event.target.value as AuditWithin })
          }
        >
          <option value="all">Semua waktu ({n(counts.within.all)})</option>
          {withinOptions.map((option) => (
            <option key={option} value={option}>
              {auditWithinLabels[option]} ({n(counts.within[option])})
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          data-testid="audit-clear"
          aria-disabled={!active}
          aria-describedby={active ? undefined : "audit-clear-reason"}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          onClick={() => {
            if (active) onChange(emptyAuditFilter);
          }}
        >
          <X aria-hidden="true" />
          Hapus saringan
        </Button>
        {!active && (
          <span
            id="audit-clear-reason"
            data-testid="audit-clear-reason"
            className="text-xs whitespace-nowrap text-muted-foreground"
          >
            Tidak ada saringan
          </span>
        )}
      </div>
    </form>
  );
}

// Baris hasil: berapa catatan yang tampil dari seluruh jendela, dan bila ada
// saringan, kalimat tentang saringannya. Selalu ada di halaman supaya perubahannya
// diumumkan pembaca layar.
export function AuditFilterResult({
  visible,
  total,
  active,
  description,
}: {
  visible: number;
  total: number;
  active: boolean;
  description: string;
}) {
  return (
    <p
      role="status"
      data-testid="audit-result"
      data-active={active}
      className="text-sm text-muted-foreground [overflow-wrap:anywhere]"
    >
      {`Menampilkan ${formatInteger(visible)} dari ${formatInteger(total)} catatan`}
      {active ? `. Saringan: ${description}.` : ""}
    </p>
  );
}

// Tidak ada catatan yang cocok: pesan yang menyebut saringannya dan satu tombol
// untuk menampilkan semuanya lagi.
export function AuditNoMatch({
  description,
  onShowAll,
}: {
  description: string;
  onShowAll: () => void;
}) {
  return (
    <div
      data-testid="audit-no-match"
      className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground"
    >
      <SearchX className="mx-auto mb-2 size-6" aria-hidden="true" />
      <p className="font-medium text-foreground">
        Tidak ada aktivitas yang cocok
      </p>
      <p className="mt-1 [overflow-wrap:anywhere]">
        Saringan yang berlaku: {description}.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={onShowAll}
      >
        Tampilkan semua aktivitas
      </Button>
    </div>
  );
}
