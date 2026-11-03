"use client";

import { useMemo, useState } from "react";
import { ListChecks, Radio, RefreshCw, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DashboardOnu } from "@/lib/dashboard/onus";
import { matchOnusToCpe, onuMac, parseOnuModel, type CpeMatch } from "@/lib/dashboard/onu-inventory";
import { useGenieacsRegistry } from "@/lib/dashboard/use-genieacs-registry";
import { useLiveOnus } from "@/lib/dashboard/use-live-onus";
import { formatInteger } from "@/lib/dashboard/format";
import { BulkRegisterDialog } from "./bulk-register-dialog";
import { OntWebDialog } from "./ont-web-dialog";
import { OnuStatusBadge } from "./onu-status-badge";

type View = "all" | "registered" | "unregistered";

/** ONU dari OLT dicocokkan ke modem GenieACS lewat PPPoE, lalu MAC (lihat matchOnusToCpe). */
export function GenieacsOltMatch() {
  const live = useLiveOnus(true);
  const registry = useGenieacsRegistry(true);
  const onus = useMemo<readonly DashboardOnu[]>(() => live.onus ?? [], [live.onus]);
  const reg = useMemo(
    () => (registry.devices === null ? null : matchOnusToCpe(onus, registry.devices)),
    [onus, registry.devices],
  );
  const macByDevice = useMemo(
    () => new Map((registry.devices ?? []).map((d) => [d.deviceId, d.macAddress])),
    [registry.devices],
  );
  const emptyReg = useMemo(() => new Map<string, CpeMatch>(), []);

  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [ontWebId, setOntWebId] = useState<string | null>(null);
  const ontWebOnu = onus.find((o) => o.id === ontWebId) ?? null;
  const [bindState, setBindState] = useState<Record<string, { phase: "saving" | "done" | "failed"; message?: string }>>({});

  async function handleBindTr069(o: DashboardOnu) {
    if (o.ponIndex === null || o.onuIndex === null || !o.oltId) return;
    if (bindState[o.id]?.phase === "saving") return;
    setBindState((s) => ({ ...s, [o.id]: { phase: "saving" } }));
    try {
      const res = await fetch(`/api/olts/${o.oltId}/onus/${o.ponIndex}/${o.onuIndex}/tr069-bind`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: { message?: string } } | null;
      setBindState((s) => ({
        ...s,
        [o.id]:
          res.ok && json?.ok
            ? { phase: "done", message: json.message ?? "Berhasil diikat ke GenieACS." }
            : { phase: "failed", message: json?.error?.message ?? "Gagal mengikat ONU ini." },
      }));
    } catch {
      setBindState((s) => ({ ...s, [o.id]: { phase: "failed", message: "Server aplikasi tidak terjangkau." } }));
    }
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return onus.filter((o) => {
      const m = reg?.get(o.id);
      if (view === "registered" && !m) return false;
      if (view === "unregistered" && m) return false;
      if (!q) return true;
      return [o.serialNumber, o.customerName, o.pppoeUsername, o.ponPort, o.oltName, m ? macByDevice.get(m.deviceId) ?? "" : ""]
        .some((s) => s.toLowerCase().includes(q));
    });
  }, [onus, reg, view, query, macByDevice]);

  const registered = reg ? onus.filter((o) => reg.has(o.id)).length : 0;
  const selectedOnus = useMemo(() => onus.filter((o) => selected.has(o.id)), [onus, selected]);
  const allSelected = rows.length > 0 && rows.every((o) => selected.has(o.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => {
      const next = new Set(s);
      if (allSelected) rows.forEach((o) => next.delete(o.id));
      else rows.forEach((o) => next.add(o.id));
      return next;
    });
  }

  return (
    <Card data-testid="genieacs-olt-match">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Cocokkan ONU OLT dengan GenieACS</CardTitle>
            <CardDescription>
              ONU dari OLT dicocokkan ke modem GenieACS lewat nama PPPoE, lalu MAC (lima oktet awal sama, selisih 0–3). Pasang atau daftarkan
              ONU yang belum cocok dari sini.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              void registry.reload();
              void live.reload();
            }}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {live.failed && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Data ONU dari OLT belum bisa dimuat.
          </p>
        )}
        {registry.failed && (
          <p role="status" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
            Daftar modem GenieACS belum bisa dibaca, jadi status cocok tidak ditampilkan.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Cari ONU"
              placeholder="Cari SN, MAC, nama, PPPoE…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {reg && (
            <select
              value={view}
              onChange={(e) => setView(e.target.value as View)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              aria-label="Filter status GenieACS"
            >
              <option value="all">Semua ({onus.length})</option>
              <option value="registered">Cocok di GenieACS ({registered})</option>
              <option value="unregistered">Belum terdaftar ({onus.length - registered})</option>
            </select>
          )}
          <span className="ml-auto flex items-center gap-2 text-sm">
            <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">{formatInteger(selectedOnus.length)} dipilih</span>
            <Button type="button" size="sm" disabled={selectedOnus.length === 0} onClick={() => setBulkOpen(true)}>
              <Radio className="size-3.5" />
              Daftarkan ke GenieACS
            </Button>
          </span>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input type="checkbox" className="size-4 cursor-pointer" checked={allSelected} onChange={toggleAll} aria-label="Pilih semua hasil" />
                </TableHead>
                <TableHead>ONU (OLT)</TableHead>
                <TableHead>SN / MAC OLT</TableHead>
                <TableHead>MAC GenieACS</TableHead>
                <TableHead>Status OLT</TableHead>
                <TableHead>GenieACS</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {live.onus === null && !live.failed ? "Memuat ONU dari OLT…" : "Tidak ada ONU yang sesuai."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((o) => {
                  const m = reg?.get(o.id);
                  const bind = bindState[o.id];
                  const id = parseOnuModel(o.model);
                  return (
                    <TableRow key={o.id} data-state={selected.has(o.id) ? "selected" : undefined}>
                      <TableCell>
                        <input type="checkbox" className="size-4 cursor-pointer" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Pilih ${o.serialNumber}`} />
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{o.customerName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {id.brandLabel} · {o.oltName} · <span className="font-mono">{o.ponPort}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {o.serialNumber}
                        <div className="text-[11px] text-muted-foreground">MAC {onuMac(o.serialNumber) ?? "-"}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m ? macByDevice.get(m.deviceId) || "—" : "—"}</TableCell>
                      <TableCell>
                        <OnuStatusBadge status={o.status} />
                      </TableCell>
                      <TableCell>
                        {!reg ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : m ? (
                          <div className="flex flex-col gap-1">
                            <Badge variant={m.isOnline ? "default" : "secondary"} className="w-fit text-[10px]">
                              {m.isOnline ? "Online" : "Offline"}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">cocok via {m.via === "mac" ? "MAC" : "PPPoE"}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Belum terdaftar</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {o.ponIndex !== null && o.onuIndex !== null && !m && (
                          <div className="flex flex-col items-start gap-1.5">
                            <Button type="button" size="sm" onClick={() => setOntWebId(o.id)}>
                              Pasang GenieACS
                            </Button>
                            <button
                              type="button"
                              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                              disabled={bind?.phase === "saving"}
                              title="Ikat profil TR-069 lewat perintah telnet ke OLT"
                              onClick={() => void handleBindTr069(o)}
                            >
                              {bind?.phase === "saving" ? "Mengikat…" : "atau via OLT"}
                            </button>
                            {bind && bind.phase !== "saving" && (
                              <p
                                role={bind.phase === "failed" ? "alert" : "status"}
                                className={`max-w-48 text-[11px] ${bind.phase === "failed" ? "text-destructive" : "text-success"}`}
                              >
                                {bind.message}
                              </p>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <OntWebDialog onu={ontWebOnu} open={ontWebOnu !== null} onOpenChange={(open) => !open && setOntWebId(null)} />
        {bulkOpen && (
          <BulkRegisterDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            onus={selectedOnus}
            reg={reg ?? emptyReg}
            onFinished={() => {
              void registry.reload();
              void live.reload();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
