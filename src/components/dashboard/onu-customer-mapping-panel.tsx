"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Link2Off, Radio, Search, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mockOnus } from "@/lib/dashboard/onus";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  getOnuMappings,
  saveOnuMapping,
  suggestAutoMapping,
  type CustomerMappingCandidate,
  type MappingSuggestion,
  type OnuMappingCandidate,
} from "@/lib/dashboard/onu-mapping-logic";
import { useSessionUser } from "@/components/session-provider";
import { MetricCard } from "./metric-card";
import { formatInteger } from "@/lib/dashboard/format";

export function OnuCustomerMappingPanel() {
  const customers = useDashboardStore((s) => s.customers);
  const user = useSessionUser();
  const operator = user?.name || user?.email || "operator";

  const [query, setQuery] = useState("");
  // Override lokal (tiruan); undefined = pakai data bawaan ONU.
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setOverrides(getOnuMappings());
  }, []);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);

  const onuCandidates = useMemo<OnuMappingCandidate[]>(
    () =>
      mockOnus.map((o) => {
        const cid = o.id in overrides ? overrides[o.id] : o.customerId;
        return {
          onuId: o.id,
          serialNumber: o.serialNumber,
          oltName: o.oltName,
          ponPort: o.ponPort,
          rxPowerDbm: o.rxPowerDbm,
          currentCustomerId: cid,
          currentCustomerName: cid ? (customerById.get(cid)?.name ?? o.customerName) : null,
        };
      }),
    [overrides, customerById],
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

  function apply(onuId: string, customerId: string | null) {
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

  function suggest() {
    const result = suggestAutoMapping(onuCandidates, customerCandidates);
    setSuggestions(result);
    setMessage(result.length ? `${result.length} saran ditemukan.` : "Tidak ada saran pencocokan.");
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
              Pemetaan Tiruan (Fase 2) · Wajib sinkronisasi DB di Fase 5
            </Badge>
          </div>
          <Button type="button" variant="outline" onClick={suggest} data-testid="auto-suggest-btn">
            <Sparkles aria-hidden="true" className="size-4" />
            Saran Pencocokan Otomatis
          </Button>
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
                          <Button type="button" size="sm" variant="outline" onClick={() => apply(o.onuId, null)}>
                            <Link2Off aria-hidden="true" className="size-4" />
                            Lepas Pemetaan
                          </Button>
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
