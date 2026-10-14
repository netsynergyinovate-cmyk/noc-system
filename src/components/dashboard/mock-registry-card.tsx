"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SETUP_DATA_SOURCE_REGISTRY } from "@/lib/dashboard/setup-extended";

export function MockRegistryCard() {
  return (
    <section
      data-testid="mock-registry-card"
      aria-labelledby="mock-registry-title"
      className="flex flex-col gap-3 rounded-xl border border-warning/40 p-5"
    >
      <h2 id="mock-registry-title" className="text-base font-semibold">
        Kendali Sumber Data Go-Live
      </h2>
      <p className="text-sm text-muted-foreground">
        Daftar modul yang masih memakai data tiruan. Semuanya wajib dialihkan ke
        backend nyata saat go-live (Fase 5).
      </p>
      <div
        role="region"
        aria-label="Tabel sumber data"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Modul</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Env Key</TableHead>
              <TableHead>Jalur Baca</TableHead>
              <TableHead>Jalur Tulis</TableHead>
              <TableHead>Syarat Go-Live</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SETUP_DATA_SOURCE_REGISTRY.map((e) => (
              <TableRow key={e.id} data-testid="mock-registry-row">
                <TableCell className="font-medium">{e.module}</TableCell>
                <TableCell>
                  {e.status === "dummy" ? (
                    <Badge className="bg-warning/10 text-warning">
                      Data Tiruan (Mock)
                    </Badge>
                  ) : (
                    <Badge>Nyata</Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.envKey}</TableCell>
                <TableCell className="font-mono text-xs whitespace-normal">
                  {e.readPath}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-normal">
                  {e.writePath}
                </TableCell>
                <TableCell className="whitespace-normal text-xs text-muted-foreground">
                  {e.notes}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
