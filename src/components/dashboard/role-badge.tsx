"use client";

import { useId } from "react";
import { cn } from "cn";
import { Label } from "@/components/ui/label";
import { useSession, useSessionActions } from "@/components/session-provider";
import { previewableRoles, roleLabel } from "@/lib/roles";
import {
  selectIsPreview,
  selectPreviewEnabled,
  selectPreviewRole,
  selectRealRole,
  selectRole,
} from "@/lib/session-store";
import { selectClassName } from "./select-class";

const previewHint = "Hanya tampilan; server tetap memakai peran asli.";

// Peran petugas di sidebar dan di header layar sempit. Isinya hanya tampilan:
// memilih "Lihat sebagai" tidak mengubah hak akses sungguhan, karena server
// tetap memeriksa peran asli di setiap halaman dan API.
//
// Mode live: tulisan "Peran:" dengan nama peran di dalam chip. Mode demo:
// pilihan "Lihat sebagai" untuk mencoba tampilan peran lain; nama peran yang
// dipakai terbaca dari pilihan yang tampil di kotaknya. Komponen ini ada dua
// kali di halaman (sidebar dan header, satu disembunyikan CSS), jadi id-nya
// dari useId. Ia hanya berlangganan store sesi, jadi data per detik di bagian
// utama tidak menggambarnya ulang.
export function RoleBadge({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "bar";
}) {
  const selectId = useId();
  const hintId = `${selectId}-hint`;
  const role = useSession(selectRole);
  const realRole = useSession(selectRealRole);
  const previewEnabled = useSession(selectPreviewEnabled);
  const previewRole = useSession(selectPreviewRole);
  const isPreview = useSession(selectIsPreview);
  const { previewAs } = useSessionActions();

  // Tanpa pengguna tidak ada yang bisa ditulis.
  if (role === null) return null;

  if (!previewEnabled) {
    return (
      <div
        data-testid="role-badge"
        data-role={role}
        data-preview={String(isPreview)}
        data-preview-enabled="false"
        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1"
      >
        <span className="text-xs text-muted-foreground">Peran:</span>
        {/* Nama peran tertulis; chip bukan hanya warna. */}
        <span
          data-testid="role-chip"
          className="inline-flex max-w-full items-center rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium wrap-anywhere text-secondary-foreground"
        >
          {roleLabel(role)}
        </span>
      </div>
    );
  }

  const narrow = variant === "bar";
  return (
    <div
      data-testid="role-badge"
      data-role={role}
      data-preview={String(isPreview)}
      data-preview-enabled="true"
      className={cn(
        "w-full",
        narrow
          ? "flex flex-wrap items-center gap-x-2 gap-y-1"
          : "flex flex-col gap-1.5",
      )}
    >
      <Label
        htmlFor={selectId}
        className="text-xs leading-4 text-muted-foreground"
      >
        Lihat sebagai
      </Label>
      <select
        id={selectId}
        value={previewRole ?? ""}
        onChange={(event) =>
          previewAs(event.target.value === "" ? null : event.target.value)
        }
        aria-describedby={isPreview ? hintId : undefined}
        className={cn(
          selectClassName,
          // min-w-0: nama peran yang panjang tidak melebarkan halaman.
          "min-w-0",
          narrow && "w-auto flex-1 basis-40",
        )}
      >
        <option value="">{`Peran asli: ${roleLabel(realRole)}`}</option>
        {previewableRoles.map((name) => (
          <option key={name} value={name}>
            {`${roleLabel(name)} (tiruan)`}
          </option>
        ))}
      </select>
      {isPreview && (
        <p
          id={hintId}
          data-testid="role-preview-hint"
          className={cn(
            "text-xs text-muted-foreground",
            narrow && "basis-full",
          )}
        >
          {previewHint}
        </p>
      )}
    </div>
  );
}
