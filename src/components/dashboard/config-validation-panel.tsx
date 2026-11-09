"use client";

import { useId, useMemo, useState } from "react";
import { CheckCircle2, ShieldAlert, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  CATEGORY_LABELS,
  MOCK_CONFIG_SCENARIOS,
  evaluateConfigValidation,
  type ConfigValidationItem,
} from "@/lib/dashboard/config-validation";

function SeverityBadge({ item }: { item: ConfigValidationItem }) {
  if (item.status === "valid")
    return (
      <Badge variant="outline" className="text-success">
        <CheckCircle2 aria-hidden="true" />
        Valid
      </Badge>
    );
  if (item.severity === "fatal")
    return (
      <Badge variant="destructive">
        <ShieldAlert aria-hidden="true" />
        Fatal
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-warning/50 text-warning">
      <TriangleAlert aria-hidden="true" />
      Peringatan
    </Badge>
  );
}

export function ConfigValidationPanel() {
  const selectId = useId();
  const [scenarioId, setScenarioId] = useState(MOCK_CONFIG_SCENARIOS[0].id);
  const scenario =
    MOCK_CONFIG_SCENARIOS.find((s) => s.id === scenarioId) ??
    MOCK_CONFIG_SCENARIOS[0];
  const result = useMemo(
    () => evaluateConfigValidation(scenario.env, scenario.dataMode),
    [scenario],
  );

  const groups = Object.entries(CATEGORY_LABELS)
    .map(([category, label]) => ({
      category,
      label,
      items: result.items.filter((i) => i.category === category),
    }))
    .filter((g) => g.items.length > 0);

  const tiles = [
    { label: "Fatal Error", value: result.fatalCount, id: "fatal" },
    {
      label: "Peringatan (Opsional)",
      value: result.warningCount,
      id: "warning",
    },
    { label: "Valid", value: result.validCount, id: "valid" },
    { label: "Total Diperiksa", value: result.totalCount, id: "total" },
  ];

  return (
    <section
      role="region"
      aria-label="Panel validasi konfigurasi lingkungan"
      data-testid="config-validation-panel"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="size-5" aria-hidden="true" />
          Panel Validasi Konfigurasi Lingkungan
        </h2>
        {result.ok && result.warningCount === 0 ? (
          <Badge
            variant="outline"
            className="border-success/50 text-success"
            data-testid="config-status"
          >
            Semua Konfigurasi Valid
          </Badge>
        ) : result.ok ? (
          <Badge
            variant="outline"
            className="border-warning/50 text-warning"
            data-testid="config-status"
          >
            Konfigurasi Belum Lengkap (Opsional)
          </Badge>
        ) : (
          <Badge variant="destructive" data-testid="config-status">
            Konfigurasi Tidak Lengkap
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={selectId} className="text-sm font-medium">
          Pilih Skenario Uji Tiruan
        </label>
        <select
          id={selectId}
          value={scenarioId}
          onChange={(e) => setScenarioId(e.target.value)}
          className="h-9 w-full max-w-md rounded-md border bg-background px-3 text-sm"
          data-testid="config-scenario-select"
        >
          {MOCK_CONFIG_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">{scenario.description}</p>
        <p className="text-xs text-muted-foreground">
          Catatan: Tiruan sementara di lingkungan uji → wajib dihapus saat
          go-live, Fase 5.
        </p>
      </div>

      <p role="status" className="text-sm font-medium">
        {result.summaryNotice}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.id} className="gap-1 py-4">
            <CardContent>
              <p className="text-sm text-muted-foreground">{t.label}</p>
              <p
                className="text-2xl font-semibold tabular-nums"
                data-testid={`config-tile-${t.id}`}
              >
                {t.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.category} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {g.label}
            </h3>
            <ul className="flex flex-col gap-2">
              {g.items.map((item) => (
                <li
                  key={item.id}
                  data-testid="config-item"
                  data-status={item.status}
                  data-severity={item.severity}
                  className="rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {item.envKey}
                    </code>
                    <span className="text-sm font-medium">{item.label}</span>
                    <SeverityBadge item={item} />
                    <span className="text-xs text-muted-foreground">
                      {item.status === "valid"
                        ? "Terisi"
                        : item.status === "missing"
                          ? "Kosong"
                          : "Tidak valid"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{item.message}</p>
                  {item.status !== "valid" && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Saran: {item.remediation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
