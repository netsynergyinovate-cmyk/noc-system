"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeviceOutcomeAlert } from "@/components/dashboard/device-outcome-alert";
import { DeviceStatusBadge } from "@/components/dashboard/device-status-badge";
import { DeviceTestButton } from "@/components/dashboard/device-test-button";
import {
  MOCK_DEVICE_CONFIGS,
  type DeviceConfig,
  type TestOutcome,
  applyTestOutcome,
  getDeviceTypeLabel,
  summarizeDeviceStatuses,
} from "@/lib/dashboard/device-config";

// Kartu ringkas 4 perangkat untuk tab "Perangkat" di /app/pengaturan.
export function DeviceQuickCards() {
  const [devices, setDevices] = useState<DeviceConfig[]>(MOCK_DEVICE_CONFIGS);
  const [testingIds, setTestingIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<Record<string, TestOutcome>>({});

  function onOutcome(d: DeviceConfig, r: TestOutcome) {
    setDevices((prev) => prev.map((x) => (x.id === d.id ? applyTestOutcome(x, r) : x)));
    setMessages((prev) => ({ ...prev, [d.id]: r }));
  }

  function setTesting(id: string, busy: boolean) {
    setTestingIds((prev) => (busy ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  }

  const sum = summarizeDeviceStatuses(devices, testingIds);

  return (
    <div className="space-y-4" data-testid="device-quick-cards">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <p className="text-xs text-muted-foreground">
          Data tiruan. Uji koneksi memakai API bila tersedia, bila tidak memakai simulasi lokal.
        </p>
      </div>

      <div
        role="status"
        aria-live="polite"
        data-testid="device-status-summary"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-xs"
      >
        <span className="font-medium">
          {sum.connected} dari {sum.total} perangkat terhubung
        </span>
        {sum.testing > 0 && <span data-testid="summary-testing">{sum.testing} sedang diuji</span>}
        {sum.error > 0 && <span data-testid="summary-error">{sum.error} gagal</span>}
        {sum.timeout > 0 && <span data-testid="summary-timeout">{sum.timeout} timeout</span>}
        {sum.untested > 0 && <span data-testid="summary-untested">{sum.untested} belum diuji</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {devices.map((d) => {
          const msg = messages[d.id];
          return (
            <Card key={d.id} data-testid="device-quick-card" data-device-type={d.type}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{d.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {getDeviceTypeLabel(d.type)} &bull; {d.host}:{d.port}
                    </CardDescription>
                  </div>
                  <DeviceStatusBadge status={d.status} isTesting={testingIds.includes(d.id)} latencyMs={d.latencyMs} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{d.description}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Latensi</span>
                  <span className="tabular-nums">{d.latencyMs ? `${d.latencyMs} ms` : "-"}</span>
                </div>
                <div aria-live="polite">
                  {msg && <DeviceOutcomeAlert outcome={msg} device={d} />}
                </div>
                <DeviceTestButton
                  device={d}
                  onOutcome={(r) => onOutcome(d, r)}
                  onTestingChange={(b) => setTesting(d.id, b)}
                  showDropdownOrToggle
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
