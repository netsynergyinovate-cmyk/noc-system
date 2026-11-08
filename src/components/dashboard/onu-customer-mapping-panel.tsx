"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Link2Off, Radio, Search, Sparkles, Tag, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mockOnus } from "@/lib/dashboard/onus";
import { autoMatchAllLive, mapOnuLive, renameOnuLive, syncAllOnuNamesLive } from "@/lib/dashboard/olt-live";
import { useLiveOnus } from "@/lib/dashboard/use-live-onus";
import { selectPreviewEnabled } from "@/lib/session-store";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  getOnuMappings,
  saveOnuMapping,
  suggestAutoMapping,
  type CustomerMappingCandidate,
  type MappingSuggestion,
  type OnuMappingCandidate,
} from "@/lib/dashboard/onu-mapping-logic";
import { useSession, useSessionUser } from "@/components/session-provider";
import { MetricCard } from "./metric-card";
import { formatInteger } from "@/lib/dashboard/format";

export function OnuCustomerMappingPanel() {
  const customers = useDashboardStore((s) => s.customers);
  const user = useSessionUser();
  const operator = user?.name || user?.email || "operator";
  // Mode live: ONU dari OLT dan pemetaan disimpan di database lewat API (dengan audit);
  // demo memakai ONU dan penyimpanan tiruan di browser.
  const isDemo = useSession(selectPreviewEnabled);
  const live = useLiveOnus(!isDemo);

  const [query, setQuery] = useState("");
  // Override lokal (tiruan); undefined = pakai data bawaan ONU.
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  const [message, setMessage] = useState("");
  const [namingId, setNamingId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  useEffect(() => {
    if (isDemo) setOverrides(getOnuMappings());
  }, [isDemo]);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const onuCandidates = useMemo<OnuMappingCandidate[]>(
    () =>
      (isDemo ? mockOnus : (live.onus ?? [])).map((o) => {
        const cid = isDemo && o.id in overrides ? overrides[o.id] : o.customerId;
        return {
          onuId: o.id,
          serialNumber: o.serialNumber,
          oltId: o.oltId,
          oltName: o.oltName,
          ponPort: o.ponPort,
          ponIndex: o.ponIndex,
          onuIndex: o.onuIndex,
          rxPowerDbm: o.rxPowerDbm,
          currentCustomerId: cid,
          currentCustomerName: cid ? (customerById.get(cid)?.name ?? o.customerName) : null,
        };
      }),
    [isDemo, live.onus, overrides, customerById],
  );

  const customerCandidates = useMemo<CustomerMappingCandidate[]>(() => {
    const assigned = new Map<string, string>();
    for (const o of onuCandidates) if (o.currentCustomerId) assigned.set(o.currentCustomerId, o.onuId);
    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      pppoeUsername: c.pppoeUsername,
      address: c.address,
      assignedOnuId: assigned.get(c.id) ?? null,
    }));
  }, [customers, onuCandidates]);

  const mappedOnus = onuCandidates.filter((o) => o.currentCustomerId).length;
  const withModem = customerCandidates.filter((c) => c.assignedOnuId).length;

  const q = query.trim().toLowerCase();
  const rows = onuCandidates.filter((o) => {
    if (!q) return true;
    const cust = o.currentCustomerId ? customerById.get(o.currentCustomerId) : null;
    return [o.onuId, o.serialNumber, o.oltName, o.ponPort, cust?.name, cust?.pppoeUsername]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  async function applyLive(onuId: string, customerId: string | null) {
    const result = await mapOnuLive(onuId, customerId);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    await live.reload();
    setSuggestions((prev) => prev?.filter((s) => s.onuId !== onuId && s.customerId !== customerId) ?? null);
    setMessage(customerId ? "ONU dipetakan dan tersimpan di database." : "Pemetaan ONU dilepas.");
  }

  function apply(onuId: string, customerId: string | null) {
    if (!isDemo) {
      void applyLive(onuId, customerId);
      return;
    }
    try {
      saveOnuMapping(onuId, customerId, operator);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal menyimpan pemetaan.");
      return;
    }
    setOverrides(getOnuMappings());
    setSuggestions((prev) => prev?.filter((s) => s.onuId !== onuId && s.customerId !== customerId) ?? null);
    setMessage(customerId ? `ONU ${onuId} dipetakan.` : `Pemetaan ONU ${onuId} dilepas.`);
  }

  async function matchLive() {
    setMessage("Mencocokkan ONU dengan pelanggan…");
    const r = await autoMatchAllLive();
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    await live.reload();
    const s = r.summary;
    setMessage(
      `${s.matched} ONU dipetakan, ${s.ambiguous} ambigu (dilewati), ${s.unmatched} tidak cocok.` +
        (s.namesFilled > 0 ? ` Nama ${s.namesFilled} pelanggan dilengkapi dari nama ONU.` : ""),
    );
  }

  function suggest() {
    if (!isDemo) {
      void matchLive();
      return;
    }
    const result = suggestAutoMapping(onuCandidates, customerCandidates);
    setSuggestions(result);
    setMessage(result.length ? `${result.length} saran ditemukan.` : "Tidak ada saran pencocokan.");
  }
  async function handleRenameOnu(o: OnuMappingCandidate) {
    if (!o.currentCustomerId || !o.oltId || o.ponIndex == null || o.onuIndex == null) {
      setMessage("ONU ini belum memiliki informasi nomor PON/ONU untuk dinamai di OLT.");
      return;
    }
    const cust = customerById.get(o.currentCustomerId);
    if (!cust) return;
    const targetDesc = cust.name.slice(0, 32);
    setNamingId(o.onuId);
    setMessage(`Menamai ONU ${o.ponIndex}/${o.onuIndex} di OLT menjadi "${targetDesc}"…`);
    const res = await renameOnuLive(o.oltId, o.ponIndex, o.onuIndex, targetDesc);
    setNamingId(null);
    setMessage(res.message);
    if (res.ok) await live.reload();
  }

  async function handleSyncAllNames() {
    setSyncingAll(true);
    setMessage("Menamai semua ONU di OLT sesuai nama pelanggan…");
    const res = await syncAllOnuNamesLive();
    setSyncingAll(false);
    setMessage(res.message);
    if (res.ok) await live.reload();
  }

  return (
    <div data-testid="onu-mapping-panel" className="flex flex-col gap-6">
      <section aria-label="Ringkasan pemetaan ONU" className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          label="Total ONU"
          value={formatInteger(onuCandidates.length)}
          hint={`Terpetakan ${mappedOnus}, belum terpetakan ${onuCandidates.length - mappedOnus}`}
          Icon={Radio}
        />
        <MetricCard
          label="Total Pelanggan"
          value={formatInteger(customerCandidates.length)}
          hint={`Sudah punya modem ${withModem}, belum punya ${customerCandidates.length - withModem}`}
          Icon={Users}
        />
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-lg">Kelola Pemetaan ONU</CardTitle>
            <CardDescription>Hubungkan modem ONU ke pelanggan PPPoE.</CardDescription>
            <Badge
              data-testid="onu-mapping-mock-badge"
              variant="outline"
              className="w-fit border-warning/40 bg-warning/10 text-warning"
            >
              {isDemo
                ? "Pemetaan Tiruan (Fase 2) · Wajib sinkronisasi DB di Fase 5"
                : live.failed
                  ? "Data ONU belum bisa dimuat dari server"
                  : "Pemetaan tersimpan di database; ONU dari OLT"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={syncingAll}
              onClick={handleSyncAllNames}
              title="Sinkronkan nama pelanggan ke deskripsi OLT untuk semua ONU yang sudah terpetakan"
            >
              <Tag aria-hidden="true" className="size-4" />
              {syncingAll ? "Menamai di OLT…" : "Namai Semua ke OLT"}
            </Button>
            <Button type="button" variant="outline" onClick={suggest} data-testid="auto-suggest-btn">
              <Sparkles aria-hidden="true" className="size-4" />
              {isDemo ? "Saran Pencocokan Otomatis" : "Cocokkan Otomatis dari Nama ONU"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {message}
          </p>

          {suggestions && suggestions.length > 0 && (
            <ul aria-label="Saran pemetaan" className="flex flex-col gap-2 rounded-md border p-3">
              {suggestions.map((s) => (
                <li key={`${s.onuId}:${s.customerId}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{s.onuId}</span>
                  <span aria-hidden="true">→</span>
                  <span className="font-medium">{customerById.get(s.customerId)?.name ?? s.customerId}</span>
                  <Badge variant="outline">{s.confidence === "high" ? "Yakin" : "Mungkin"}</Badge>
                  <span className="text-xs text-muted-foreground">{s.reason}</span>
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto"
                    data-testid="save-mapping-btn"
                    onClick={() => apply(s.onuId, s.customerId)}
                  >
                    <Link2 aria-hidden="true" className="size-4" />
                    Terapkan Pemetaan
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Cari ONU atau pelanggan"
              placeholder="Cari ONU, serial, pelanggan, PPPoE…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ONU</TableHead>
                  <TableHead>OLT / PON</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Tidak ada ONU yang cocok.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((o) => {
                  const cust = o.currentCustomerId ? customerById.get(o.currentCustomerId) : null;
                  return (
                    <TableRow key={o.onuId}>
                      <TableCell>
                        <div className="font-mono text-xs">{o.onuId}</div>
                        <div className="font-mono text-xs text-muted-foreground">{o.serialNumber}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {o.oltName}
                        <div className="text-muted-foreground">{o.ponPort}</div>
                      </TableCell>
                      <TableCell>
                        {o.currentCustomerId ? (
                          <>
                            <div className="font-medium">{cust?.name ?? o.currentCustomerName ?? o.currentCustomerId}</div>
                            <div className="font-mono text-xs text-muted-foreground">{cust?.pppoeUsername}</div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Belum terpetakan</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {o.currentCustomerId ? (
                          <div className="flex items-center gap-2">
                            {o.oltId && o.ponIndex != null && o.onuIndex != null && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={namingId === o.onuId}
                                onClick={() => handleRenameOnu(o)}
                                title="Ubah nama/deskripsi ONU di OLT sesuai nama pelanggan"
                                className="text-xs text-primary hover:text-primary"
                              >
                                <Tag aria-hidden="true" className="size-3.5" />
                                {namingId === o.onuId ? "Menamai…" : "Namai di OLT"}
                              </Button>
                            )}
                            <Button type="button" size="sm" variant="outline" onClick={() => apply(o.onuId, null)}>
                              <Link2Off aria-hidden="true" className="size-4" />
                              Lepas Pemetaan
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Gunakan saran otomatis</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
