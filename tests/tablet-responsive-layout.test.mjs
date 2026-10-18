import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Tablet Responsive Layout for Network Map & Page", () => {
  const rootDir = process.cwd();
  const pagePath = path.join(rootDir, "src/app/(protected)/app/peta/page.tsx");
  const networkMapPath = path.join(rootDir, "src/components/map/network-map.tsx");
  const customerPanelPath = path.join(rootDir, "src/components/map/customer-detail-panel.tsx");
  const devicePanelPath = path.join(rootDir, "src/components/map/device-detail-panel.tsx");
  const legendPath = path.join(rootDir, "src/components/map/network-map-legend.tsx");

  it("should have responsive tablet grid layout in /app/peta page.tsx", () => {
    assert.ok(fs.existsSync(pagePath), "page.tsx should exist");
    const content = fs.readFileSync(pagePath, "utf-8");

    // Grid metrik memiliki class responsif untuk tablet (md:grid-cols-3) dan desktop (lg:grid-cols-5)
    assert.ok(
      content.includes('data-testid="infra-metrics-grid"'),
      "Should contain infra-metrics-grid test id",
    );
    assert.ok(
      content.includes("md:grid-cols-3") && content.includes("lg:grid-cols-5"),
      "Metrics grid should have md:grid-cols-3 and lg:grid-cols-5 responsive classes",
    );
    assert.ok(
      content.includes('data-testid="peta-module-shortcuts"'),
      "Should have peta-module-shortcuts container",
    );

    // Kartu metrik lengkap
    assert.ok(content.includes('data-testid="infra-total-devices"'), "Must contain total devices card");
    assert.ok(content.includes('data-testid="infra-total-routers"'), "Must contain total routers card");
    assert.ok(content.includes('data-testid="infra-total-olts"'), "Must contain total olts card");
    assert.ok(content.includes('data-testid="infra-total-odps"'), "Must contain total odps card");
    assert.ok(content.includes('data-testid="infra-connected-clients"'), "Must contain connected clients card");
  });

  it("should have tablet-adapted height and top control bar in network-map.tsx", () => {
    assert.ok(fs.existsSync(networkMapPath), "network-map.tsx should exist");
    const content = fs.readFileSync(networkMapPath, "utf-8");

    // Container peta adaptif tablet
    assert.ok(
      content.includes("md:min-h-[600px]"),
      "Map container should have md:min-h-[600px] responsive height",
    );

    // Top control bar responsif flex-col sm/md:flex-row
    assert.ok(
      content.includes('data-testid="map-top-control-bar"'),
      "Should have map-top-control-bar container",
    );
    assert.ok(
      content.includes("md:flex-row") && content.includes("md:items-center"),
      "Top control bar should switch to row on tablet md breakpoint",
    );

    // Search and filter group
    assert.ok(
      content.includes('data-testid="map-search-filter-group"'),
      "Should have map-search-filter-group",
    );
    assert.ok(
      content.includes("md:w-56"),
      "Search input should have responsive width for tablet",
    );

    // Actions group
    assert.ok(
      content.includes('data-testid="map-actions-group"'),
      "Should have map-actions-group",
    );
    assert.ok(
      content.includes('data-testid="map-refresh-button"'),
      "Should have map-refresh-button",
    );
    assert.ok(
      content.includes('data-testid="fit-bounds-button"'),
      "Should have fit-bounds-button",
    );
    assert.ok(
      content.includes('data-testid="locate-me-button"'),
      "Should have locate-me-button",
    );

    // Tablet inline labels for buttons
    assert.ok(
      content.includes('<span className="hidden md:inline">Semua Titik</span>'),
      "Fit bounds should display label on tablet md breakpoint",
    );
    assert.ok(
      content.includes('<span className="hidden md:inline">Lokasi Saya</span>'),
      "Locate me should display label on tablet md breakpoint",
    );
  });

  it("should have tablet-adapted width in CustomerDetailPanel", () => {
    assert.ok(fs.existsSync(customerPanelPath), "customer-detail-panel.tsx should exist");
    const content = fs.readFileSync(customerPanelPath, "utf-8");

    assert.ok(
      content.includes("md:w-96"),
      "CustomerDetailPanel should have md:w-96 width on tablet",
    );
  });

  it("should have tablet-adapted width in DeviceDetailPanel", () => {
    assert.ok(fs.existsSync(devicePanelPath), "device-detail-panel.tsx should exist");
    const content = fs.readFileSync(devicePanelPath, "utf-8");

    assert.ok(
      content.includes("md:w-96"),
      "DeviceDetailPanel should have md:w-96 width on tablet",
    );
  });

  it("should have tablet-adapted width in NetworkMapLegend", () => {
    assert.ok(fs.existsSync(legendPath), "network-map-legend.tsx should exist");
    const content = fs.readFileSync(legendPath, "utf-8");

    assert.ok(
      content.includes("md:w-84"),
      "NetworkMapLegend should have md:w-84 width on tablet",
    );
  });
});
