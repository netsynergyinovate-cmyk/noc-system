import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CABLE_CAPACITY_TIERS, resolveCableCapacityStyle } from "../src/config/cable-capacity.ts";

describe("Rapikan Legenda Warna dan Ketebalan Jalur Kabel", () => {
  const rootDir = process.cwd();
  const legendPath = path.join(rootDir, "src/components/map/network-map-legend.tsx");
  const guidePath = path.join(rootDir, "src/components/map/map-symbols-guide-dialog.tsx");

  it("should have comprehensive cable tiers in CABLE_CAPACITY_TIERS", () => {
    assert.ok(Array.isArray(CABLE_CAPACITY_TIERS), "CABLE_CAPACITY_TIERS should be an array");
    assert.equal(CABLE_CAPACITY_TIERS.length, 5, "Should have 5 capacity tiers");

    const [backbone, feederMain, feederDist, branch, drop] = CABLE_CAPACITY_TIERS;

    // 1. Backbone (48+ core)
    assert.equal(backbone.category, "backbone");
    assert.equal(backbone.baseWeight, 5.0);
    assert.equal(backbone.color, "#8b5cf6");

    // 2. Feeder Utama (24 core)
    assert.equal(feederMain.category, "feeder");
    assert.equal(feederMain.baseWeight, 4.0);
    assert.equal(feederMain.color, "#6366f1");

    // 3. Feeder Distribusi (16 core)
    assert.equal(feederDist.category, "feeder");
    assert.equal(feederDist.baseWeight, 3.2);
    assert.equal(feederDist.color, "#06b6d4");

    // 4. Distribusi Cabang (8 core)
    assert.equal(branch.category, "distribution");
    assert.equal(branch.baseWeight, 2.5);
    assert.equal(branch.color, "#f59e0b");

    // 5. Drop Core (1-2 core)
    assert.equal(drop.category, "drop");
    assert.equal(drop.baseWeight, 1.8);
    assert.equal(drop.color, "#10b981");
  });

  it("should properly resolve style with highlight and offline status", () => {
    const normalDrop = resolveCableCapacityStyle({
      coreCapacity: 2,
      type: "drop",
      status: "online",
    });
    assert.equal(normalDrop.color, "#10b981");

    const offlineDrop = resolveCableCapacityStyle({
      coreCapacity: 2,
      type: "drop",
      status: "offline",
    });
    assert.equal(offlineDrop.color, "#ef4444");

    const highlightedBackbone = resolveCableCapacityStyle({
      coreCapacity: 48,
      type: "backbone",
      isHighlighted: true,
    });
    assert.equal(highlightedBackbone.color, "#22d3ee");
    assert.equal(highlightedBackbone.baseWeight, 6.5);
  });

  it("should render 6 structured tiers in NetworkMapLegend with proportional visual swatches", () => {
    assert.ok(fs.existsSync(legendPath), "network-map-legend.tsx should exist");
    const content = fs.readFileSync(legendPath, "utf-8");

    assert.ok(content.includes('data-testid="cable-legend-details"'), "Should contain cable legend details");

    // Tier 1: Backbone (5.0px)
    assert.ok(content.includes('data-testid="cable-legend-tier-backbone"'), "Must contain backbone tier");
    assert.ok(content.includes("h-[5px]") && content.includes("bg-purple-500"), "Must have 5px purple swatch");

    // Tier 2: Feeder Utama (4.0px)
    assert.ok(content.includes('data-testid="cable-legend-tier-feeder-main"'), "Must contain main feeder tier");
    assert.ok(content.includes("h-[4px]") && content.includes("bg-indigo-500"), "Must have 4px indigo swatch");

    // Tier 3: Feeder Distribusi (3.2px)
    assert.ok(content.includes('data-testid="cable-legend-tier-feeder-dist"'), "Must contain dist feeder tier");
    assert.ok(content.includes("h-[3px]") && content.includes("bg-cyan-500"), "Must have 3px cyan swatch");

    // Tier 4: Distribusi Cabang (2.5px)
    assert.ok(content.includes('data-testid="cable-legend-tier-branch"'), "Must contain branch tier");
    assert.ok(content.includes("h-[2px]") && content.includes("bg-amber-500"), "Must have 2px amber swatch");

    // Tier 5: Drop Optik (1.8px)
    assert.ok(content.includes('data-testid="cable-legend-tier-drop"'), "Must contain drop tier");
    assert.ok(content.includes("h-[1.5px]") && content.includes("bg-emerald-500"), "Must have 1.5px emerald swatch");

    // Tier 6: Highlighted Path
    assert.ok(content.includes('data-testid="cable-legend-tier-highlight"'), "Must contain highlight tier");
    assert.ok(content.includes("bg-cyan-400"), "Must have cyan highlight swatch");
  });

  it("should render consistent cable tiers in MapSymbolsGuideDialog", () => {
    assert.ok(fs.existsSync(guidePath), "map-symbols-guide-dialog.tsx should exist");
    const content = fs.readFileSync(guidePath, "utf-8");

    assert.ok(content.includes('data-testid="guide-section-cables"'), "Should contain guide cable section");
    assert.ok(content.includes('data-testid="guide-cable-tier-backbone"'), "Should have backbone guide entry");
    assert.ok(content.includes('data-testid="guide-cable-tier-feeder-main"'), "Should have main feeder guide entry");
    assert.ok(content.includes('data-testid="guide-cable-tier-feeder-dist"'), "Should have dist feeder guide entry");
    assert.ok(content.includes('data-testid="guide-cable-tier-branch"'), "Should have branch guide entry");
    assert.ok(content.includes('data-testid="guide-cable-tier-drop"'), "Should have drop guide entry");
    assert.ok(content.includes('data-testid="guide-cable-tier-highlight"'), "Should have highlight guide entry");
  });
});
