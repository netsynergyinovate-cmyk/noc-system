"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DashboardOnu } from "@/lib/dashboard/onus";
import type { DashboardCustomer } from "@/lib/dashboard/types";

interface Props {
  onu: DashboardOnu | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (onuId: string, customerId: string | null) => void;
  customers: readonly DashboardCustomer[];
}

function Body({
  onu,
  onOpenChange,
  onSave,
  customers,
}: Omit<Props, "open" | "onu"> & { onu: DashboardOnu }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(onu.customerId);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? customers.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.pppoeUsername.toLowerCase().includes(q),
        )
      : customers;
    return list.slice(0, 50);
  }, [customers, query]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {onu.customerId ? "Ubah Pemetaan ONU" : "Petakan ONU ke Pelanggan"}
        </DialogTitle>
        <DialogDescription>
          Pilih pelanggan yang menggunakan ONU ini.
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Serial Number</dt>
        <dd className="font-mono">{onu.serialNumber}</dd>
        <dt className="text-muted-foreground">Model</dt>
        <dd>{onu.model}</dd>
        <dt className="text-muted-foreground">OLT &amp; Port</dt>
        <dd>
          {onu.oltName}{" "}
          <span className="font-mono text-xs text-muted-foreground">
            {onu.ponPort}
          </span>
        </dd>
        <dt className="text-muted-foreground">Status saat ini</dt>
        <dd>
          {onu.customerId ? (
            <>
              Terpetakan ke{" "}
              <span className="font-medium">{onu.customerName}</span>{" "}
              <span className="font-mono text-xs text-muted-foreground">
                ({onu.pppoeUsername})
              </span>
            </>
          ) : (
            "Belum dipasangkan"
          )}
        </dd>
      </dl>

      <div className="space-y-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Cari pelanggan"
            placeholder="Cari nama / PPPoE…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <ul
          role="listbox"
          aria-label="Pilih pelanggan"
          className="max-h-48 overflow-y-auto rounded-md border"
        >
          {matches.length === 0 ? (
            <li className="p-3 text-center text-sm text-muted-foreground">
              Pelanggan tidak ditemukan.
            </li>
          ) : (
            matches.map((c) => (
              <li key={c.id} role="option" aria-selected={c.id === selectedId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                    c.id === selectedId ? "bg-secondary font-medium" : ""
                  }`}
                >
                  <span>{c.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.pppoeUsername}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Batal
        </Button>
        {onu.customerId !== null && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onSave(onu.id, null)}
          >
            Lepas Pemetaan
          </Button>
        )}
        <Button
          type="button"
          disabled={selectedId === null}
          onClick={() => selectedId && onSave(onu.id, selectedId)}
        >
          Simpan Pemetaan
        </Button>
      </div>
    </>
  );
}

export function MapOnuDialog({
  onu,
  open,
  onOpenChange,
  onSave,
  customers,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="map-onu-dialog">
        {/* key: reset pencarian & pilihan setiap ONU berganti */}
        {onu && (
          <Body
            key={onu.id}
            onu={onu}
            onOpenChange={onOpenChange}
            onSave={onSave}
            customers={customers}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
