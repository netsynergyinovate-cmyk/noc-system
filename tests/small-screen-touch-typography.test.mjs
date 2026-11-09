import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Small Screen Touch Target & Typography Optimization", () => {
  const rootDir = process.cwd();
  const globalsCssPath = path.join(rootDir, "src/app/globals.css");
  const networkMapPath = path.join(
    rootDir,
    "src/components/map/network-map.tsx",
  );
  const symbolsGuidePath = path.join(
    rootDir,
    "src/components/map/map-symbols-guide-dialog.tsx",
  );
  const customerPanelPath = path.join(
    rootDir,
    "src/components/map/customer-detail-panel.tsx",
  );
  const devicePanelPath = path.join(
    rootDir,
    "src/components/map/device-detail-panel.tsx",
  );
  const legendPath = path.join(
    rootDir,
    "src/components/map/network-map-legend.tsx",
  );

  it("should define accessible Leaflet touch target CSS for mobile screens in globals.css", () => {
    assert.ok(fs.existsSync(globalsCssPath), "globals.css should exist");
    const content = fs.readFileSync(globalsCssPath, "utf-8");

    assert.ok(
      content.includes("@media (max-width: 767px)"),
      "Should contain media query for mobile screens",
    );
    assert.ok(
      content.includes(".leaflet-bar a") && content.includes("36px"),
      "Leaflet bar buttons should have at least 36px touch target on small screens",
    );
    assert.ok(
      content.includes(".leaflet-touch .leaflet-bar a") &&
        content.includes("38px"),
      "Touch-enabled Leaflet controls should have 38px touch target on small screens",
    );
  });

  it("should have enhanced button and input heights in network-map.tsx", () => {
    assert.ok(fs.existsSync(networkMapPath), "network-map.tsx should exist");
    const content = fs.readFileSync(networkMapPath, "utf-8");

    // Search input
    assert.ok(
      content.includes(
        'className="h-9 sm:h-8 pl-8 pr-7 text-xs bg-background"',
      ),
      "Search input should have h-9 sm:h-8 touch target",
    );

    // Filter selects
    assert.ok(
      content.includes(
        'className="h-9 sm:h-8 rounded-md border border-input bg-background px-2.5 sm:px-2.5',
      ),
      "Region and status filter selects should have h-9 sm:h-8 touch target",
    );

    // Refresh and layer buttons
    assert.ok(
      content.includes(
        'className="h-9 sm:h-8 px-2.5 sm:px-2.5 text-xs gap-1.5 font-medium"',
      ),
      "Refresh button should have h-9 sm:h-8 touch target",
    );
    assert.ok(
      content.includes(
        'className="h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium"',
      ),
      "Layer toggle and action buttons should have h-9 sm:h-8 touch target",
    );
  });

  it("should have enlarged touch trigger in map-symbols-guide-dialog.tsx", () => {
    assert.ok(
      fs.existsSync(symbolsGuidePath),
      "map-symbols-guide-dialog.tsx should exist",
    );
    const content = fs.readFileSync(symbolsGuidePath, "utf-8");

    assert.ok(
      content.includes(
        'className="h-9 sm:h-8 px-2.5 text-xs gap-1.5 font-medium',
      ),
      "Map symbols guide trigger button should have h-9 sm:h-8 touch target",
    );
  });

  it("should have enhanced typography and touch targets in customer-detail-panel.tsx", () => {
    assert.ok(
      fs.existsSync(customerPanelPath),
      "customer-detail-panel.tsx should exist",
    );
    const content = fs.readFileSync(customerPanelPath, "utf-8");

    // Badges readability
    assert.ok(
      content.includes("text-[11px] sm:text-[10px]") &&
        content.includes("h-5.5 sm:h-5"),
      "Customer status badges should have readable text-[11px] sm:text-[10px]",
    );

    // Close button
    assert.ok(
      content.includes("size-8 sm:size-7"),
      "Close button should have size-8 sm:size-7 touch target",
    );

    // Action buttons
    assert.ok(
      content.includes("h-9 sm:h-8 gap-1.5 font-semibold") ||
        content.includes("h-9 sm:h-8 gap-1.5 font-medium"),
      "Save location and action buttons should have h-9 sm:h-8 touch target",
    );
    assert.ok(
      content.includes("h-9 sm:h-8 px-2 sm:px-1.5 text-xs sm:text-[11px]"),
      "Shortcut buttons should have h-9 sm:h-8 touch target and responsive text",
    );
  });

  it("should have enhanced typography and touch targets in device-detail-panel.tsx", () => {
    assert.ok(
      fs.existsSync(devicePanelPath),
      "device-detail-panel.tsx should exist",
    );
    const content = fs.readFileSync(devicePanelPath, "utf-8");

    // Badges readability
    assert.ok(
      content.includes("text-[11px] sm:text-[10px]") &&
        content.includes("h-5.5 sm:h-5"),
      "Device type and status badges should have readable text-[11px] sm:text-[10px]",
    );

    // Close button
    assert.ok(
      content.includes("size-8 sm:size-7"),
      "Close button should have size-8 sm:size-7 touch target",
    );

    // Move, delete and shortcut buttons
    assert.ok(
      content.includes("h-9 sm:h-8 font-medium") ||
        content.includes("h-9 sm:h-8"),
      "Action buttons should have h-9 sm:h-8 touch target",
    );
  });

  it("should have enhanced tab buttons and collapse toggle in network-map-legend.tsx", () => {
    assert.ok(fs.existsSync(legendPath), "network-map-legend.tsx should exist");
    const content = fs.readFileSync(legendPath, "utf-8");

    // Toggle collapse button
    assert.ok(
      content.includes("size-7 sm:size-6"),
      "Legend collapse toggle should have size-7 sm:size-6 touch target",
    );

    // Tabs
    assert.ok(
      content.includes("min-h-[32px] sm:min-h-[28px]"),
      "Legend tab buttons should have min-h-[32px] sm:min-h-[28px] touch target",
    );
  });
});
