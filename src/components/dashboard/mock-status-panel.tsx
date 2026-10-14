"use client";

import { CheckCircle2, CircleDashed, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  auditMockUsage,
  integrationStatuses,
  promotionPrinciples,
  stackDecisions,
  type ComponentIntegrationStatus,
} from "@/lib/dashboard/stack-benchmark";

const sourceLabel: Record<ComponentIntegrationStatus["currentSource"], string> = {
  simulator: "Simulator Lab",
  mock: "Data Tiruan",
  real: "Perangkat Nyata",
};

const verificationLabel: Record<ComponentIntegrationStatus["verificationStatus"], string> = {
  passed: "Terverifikasi Lulus",
  untested: "Belum Diuji",
};

const readinessLabel: Record<ComponentIntegrationStatus["promotionReadiness"], string> = {
  ready: "Siap Promosi",
  needs_env: "Perlu Konfigurasi Env",
};

const audit = auditMockUsage();

export function MockStatusPanel() {
  return (
    <div data-testid="mock-status-panel" className="space-y-4">
      <div
        role="note"
        data-testid="mock-principle-banner"
        className="flex items-start gap-3 rounded-lg border bg-muted/50 p-4 text-sm"
      >
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p className="font-medium">Mock hanya dilepas setelah sumber nyata terbukti di lab Docker lokal.</p>
      </div>

      <div
        role="status"
        data-testid="readiness-banner"
        data-real={audit.counts.real}
        data-simulator={audit.counts.simulator}
        data-mock={audit.counts.mock}
        data-rule-enforced={audit.ruleEnforced}
        className="flex items-start gap-3 rounded-lg border p-4 text-sm"
      >
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <p>
          Kesiapan: {audit.counts.real} Perangkat Nyata, {audit.counts.simulator} Simulator Lab,{" "}
          {audit.counts.mock} Data Tiruan. Bila koneksi fisik putus, komponen nyata mundur ke simulator atau
          data terakhir; komponen belum teruji tetap memakai tiruan agar tidak galat.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrationStatuses.map((c) => (
          <li
            key={c.id}
            data-testid="integration-card"
            data-component={c.id}
            data-source={c.currentSource}
            data-verification={c.verificationStatus}
            data-readiness={c.promotionReadiness}
          >
            <Card className="h-full">
              <CardHeader>
                <CardDescription>{c.category}</CardDescription>
                <CardTitle>{c.name}</CardTitle>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Badge variant="secondary" data-testid="source-badge">
                    {sourceLabel[c.currentSource]}
                  </Badge>
                  <Badge
                    variant={c.verificationStatus === "passed" ? "default" : "outline"}
                    data-testid="verification-badge"
                    className={c.verificationStatus === "passed" ? "bg-success text-white" : undefined}
                  >
                    {c.verificationStatus === "passed" ? (
                      <CheckCircle2 aria-hidden="true" />
                    ) : (
                      <CircleDashed aria-hidden="true" />
                    )}
                    {verificationLabel[c.verificationStatus]}
                  </Badge>
                  <Badge
                    variant={c.promotionReadiness === "ready" ? "secondary" : "outline"}
                    data-testid="readiness-badge"
                  >
                    {readinessLabel[c.promotionReadiness]}
                  </Badge>
                  <Badge variant="outline" data-testid="fallback-badge">
                    {c.currentSource === "real" ? "Fallback siaga" : "Fallback aktif"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{c.notes}</p>
                <div>
                  <p className="font-medium">Env dibutuhkan</p>
                  <ul data-testid="env-keys" className="mt-1 flex flex-wrap gap-1.5">
                    {c.envKeys.map((k) => (
                      <li key={k}>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{k}</code>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Fallback bila koneksi fisik putus</p>
                  <p data-testid="fallback-strategy" className="text-muted-foreground">
                    {c.fallbackStrategy}
                  </p>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle>Peta modul tiruan</CardTitle>
          <CardDescription data-testid="mock-audit-summary">
            {audit.counts.mock} tiruan, {audit.counts.simulator} simulator, {audit.counts.real} nyata.{" "}
            {audit.ruleEnforced
              ? "Aturan terpenuhi: tidak ada komponen belum teruji yang dianggap nyata atau siap."
              : `Pelanggaran aturan: ${audit.violations.join("; ")}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-4 text-sm lg:grid-cols-2">
            {audit.items.map((a) => (
              <li
                key={a.id}
                data-testid="mock-audit-item"
                data-component={a.id}
                data-source={a.currentSource}
                className="space-y-2 rounded-lg border p-3"
              >
                <p className="font-medium">
                  {a.name} <Badge variant="secondary">{sourceLabel[a.currentSource]}</Badge>
                </p>
                <div>
                  <p className="font-medium">Kriteria promosi</p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {a.promotionCriteria.map((k) => (
                      <li key={k}>{k}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">File tiruan</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {a.mockFiles.map((f) => (
                      <li key={f}>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{f}</code>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Fallback</p>
                  <p className="text-muted-foreground">{a.fallbackStrategy}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Checklist prinsip promosi</CardTitle>
          </CardHeader>
          <CardContent>
            <ul data-testid="promotion-principles" className="space-y-3 text-sm">
              {promotionPrinciples.map((p) => (
                <li key={p.id} data-testid="promotion-principle" className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <div>
                    <p className="font-medium">{p.title}</p>
                    <p className="text-muted-foreground">{p.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Keputusan stack</CardTitle>
          </CardHeader>
          <CardContent>
            <ul data-testid="mock-stack-decisions" className="space-y-3 text-sm">
              {stackDecisions.map((d) => (
                <li key={d.id}>
                  <p className="font-medium">
                    {d.layer}: {d.choice}
                  </p>
                  <p className="text-muted-foreground">{d.reason}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
