"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleCheck,
  Copy,
  FileQuestionMark,
  Link2,
  Split,
  UserX,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingRow, BillingUnmatched } from "@/lib/dashboard/billing";
import {
  buildMismatches,
  describeMismatches,
  filterMismatches,
  mismatchAdvice,
  mismatchKinds,
  mismatchLabels,
  summarizeMismatches,
  type BillingMismatch,
  type MismatchKind,
} from "@/lib/dashboard/billing-mismatch";
import {
  getAllMismatchResolutions,
  markMismatchResolved,
  mismatchActionLabels,
  removeMismatchResolution,
  type MismatchResolutionAction,
  type MismatchResolutionRecord,
} from "@/lib/dashboard/billing-mismatch-actions";
import { formatInteger } from "@/lib/dashboard/format";
import { useSessionUser } from "@/components/session-provider";
import { BillingMismatchActionDialog } from "./billing-mismatch-action-dialog";
import { BillingStatusBadge } from "./billing-status-badge";
import { selectClassName } from "./select-class";

// Bentuk ikon ikut membedakan jenisnya; warna tidak dipakai.
const icons: Record<MismatchKind, LucideIcon> = {
  pair: Link2,
  "invoice-unknown": FileQuestionMark,
  "invoice-duplicate": Copy,
  "invoice-ambiguous": Split,
  "customer-without-invoice": UserX,
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="mismatch-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard diblokir: tombol tetap ada, nama bisa disalin manual dari saran.
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      {copied ? "Tersalin" : "Salin"}
      <span className="sr-only"> nama PPPoE {text}</span>
    </Button>
  );
}

function InvoiceCell({ item }: { item: BillingMismatch }) {
  if (!item.invoice) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="font-mono text-xs" data-testid="mismatch-invoice">
        {item.invoice.invoiceRef}
      </span>
      <span
        className="font-mono text-xs whitespace-pre text-muted-foreground"
        data-testid="mismatch-invoice-name"
      >
        {item.invoice.pppoeUsername}
      </span>
      <BillingStatusBadge status={item.invoice.status} />
    </div>
  );
}

function CustomerCell({ item }: { item: BillingMismatch }) {
  if (item.customers.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {item.customers.map((customer) => (
        <li key={customer.customerId} data-testid="mismatch-customer">
          <div className="font-medium">{customer.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {customer.pppoeUsername}
          </div>
          <div className="text-xs text-muted-foreground">
            {customer.routerName}
            {item.kind === "invoice-duplicate" && customer.invoiceRef
              ? `, memakai ${customer.invoiceRef}`
              : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Daftar apa saja yang tidak bertemu antara billing dan data pelanggan, dari dua
// sisi: tagihan yang tidak punya pelanggan, dan pelanggan yang tidak punya
// tagihan. Yang kemungkinan satu masalah (nama PPPoE salah ketik di billing)
// digabung di satu baris, lengkap dengan saran apa yang perlu dibetulkan.
export function BillingMismatchList({
  rows,
  unmatched,
}: {
  rows: BillingRow[] | null;
  unmatched: BillingUnmatched[] | null;
}) {
  const [kind, setKind] = useState<MismatchKind | "all">("all");
  const [query, setQuery] = useState("");
  const user = useSessionUser();
  const [resolutions, setResolutions] = useState<
    Record<string, MismatchResolutionRecord>
  >({});
  const [acting, setActing] = useState<BillingMismatch | null>(null);
  // localStorage hanya ada di peramban: dibaca sesudah hidrasi.
  useEffect(() => {
    setResolutions(getAllMismatchResolutions());
  }, []);
  const mismatches = useMemo(
    () => (rows && unmatched ? buildMismatches(rows, unmatched) : null),
    [rows, unmatched],
  );
  const counts = useMemo(
    () => (mismatches ? summarizeMismatches(mismatches) : null),
    [mismatches],
  );
  const visible = useMemo(
    () => (mismatches ? filterMismatches(mismatches, kind, query) : []),
    [mismatches, kind, query],
  );

  return (
    <Card
      data-testid="billing-mismatch"
      data-count={mismatches?.length}
      className="min-w-0"
    >
      <CardHeader>
        <CardTitle>Ketidakcocokan data billing</CardTitle>
        <CardDescription role="status" data-testid="mismatch-summary">
          {counts ? describeMismatches(counts) : "Memuat ketidakcocokan…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {mismatches === null || counts === null ? (
          <div
            role="status"
            aria-label="Memuat ketidakcocokan"
            className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
          />
        ) : mismatches.length === 0 ? (
          <div className="rounded-lg border px-4 py-8 text-center text-sm text-muted-foreground">
            <CircleCheck className="mx-auto mb-2 size-6" aria-hidden="true" />
            Tidak ada tagihan atau pelanggan yang menunggu dicocokkan.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mismatch-kind">Jenis</Label>
                <select
                  id="mismatch-kind"
                  className={selectClassName}
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as MismatchKind | "all")
                  }
                >
                  <option value="all">
                    Semua jenis ({formatInteger(counts.total)})
                  </option>
                  {mismatchKinds.map((option) => (
                    <option key={option} value={option}>
                      {mismatchLabels[option]} ({formatInteger(counts[option])})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mismatch-search">Cari</Label>
                <Input
                  id="mismatch-search"
                  type="search"
                  value={query}
                  placeholder="Cari nama, PPPoE, atau no. tagihan..."
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>
            {(query.trim() !== "" || kind !== "all") && (
              <p
                role="status"
                className="text-xs text-muted-foreground"
                data-testid="mismatch-filter-info"
              >
                Menampilkan {formatInteger(visible.length)} dari{" "}
                {formatInteger(counts.total)} ketidakcocokan.
              </p>
            )}
            <div
              // relative: teks sr-only di dalam sel bersifat absolute; tanpa
              // penampung berposisi ia lolos dari overflow dan melebarkan
              // seluruh halaman.
              className="relative max-h-[28rem] overflow-auto rounded-lg border"
              tabIndex={0}
              role="region"
              aria-label="Daftar ketidakcocokan data billing"
            >
              <table className="w-full min-w-[52rem] text-left text-sm">
                <caption className="sr-only">
                  Tagihan yang tidak punya pelanggan dan pelanggan yang tidak
                  punya tagihan, dari yang paling mudah dibetulkan, dengan saran
                  tiap barisnya
                </caption>
                <thead className="sticky top-0 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)]">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Jenis
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Tagihan di billing
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Pelanggan
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Saran
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr className="border-t" data-testid="mismatch-empty">
                      <td
                        colSpan={4}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        Tidak ada ketidakcocokan jenis ini.
                      </td>
                    </tr>
                  ) : (
                    visible.map((item) => {
                      const Icon = icons[item.kind];
                      return (
                        <tr
                          key={item.id}
                          data-testid="billing-mismatch-row"
                          data-kind={item.kind}
                          data-invoice={item.invoice?.invoiceRef ?? ""}
                          data-customers={item.customers
                            .map((customer) => customer.customerId)
                            .join(",")}
                          className="border-t align-top"
                        >
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <Icon
                                className="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              {mismatchLabels[item.kind]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <InvoiceCell item={item} />
                          </td>
                          <td className="px-4 py-3">
                            <CustomerCell item={item} />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <div className="flex flex-col items-start gap-2">
                              {mismatchAdvice(item)}
                              {item.kind === "pair" && (
                                <CopyButton
                                  text={item.customers[0].pppoeUsername}
                                />
                              )}
                              {resolutions[item.id] && (
                                <Badge
                                  variant="outline"
                                  data-testid="mismatch-resolved-badge"
                                  data-action={resolutions[item.id].action}
                                >
                                  {mismatchActionLabels[resolutions[item.id].action]}
                                  {" oleh "}
                                  {resolutions[item.id].resolvedBy}
                                </Badge>
                              )}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="mismatch-action-btn"
                                onClick={() => setActing(item)}
                              >
                                Tindakan
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
      <BillingMismatchActionDialog
        item={acting}
        existing={acting ? (resolutions[acting.id] ?? null) : null}
        onOpenChange={(open) => {
          if (!open) setActing(null);
        }}
        onSave={(item, action: MismatchResolutionAction, notes) => {
          markMismatchResolved({
            mismatchKey: item.id,
            action,
            notes,
            resolvedBy: user?.name || user?.email || "operator",
            resolvedAt: new Date().toISOString(),
          });
          setResolutions(getAllMismatchResolutions());
          setActing(null);
        }}
        onRemove={(item) => {
          removeMismatchResolution(item.id);
          setResolutions(getAllMismatchResolutions());
          setActing(null);
        }}
      />
    </Card>
  );
}
