import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const deviceDetailPanelPath = path.resolve(
  __dirname,
  "../src/components/map/device-detail-panel.tsx",
);
const customerDetailPanelPath = path.resolve(
  __dirname,
  "../src/components/map/customer-detail-panel.tsx",
);
const inspectorLayerPath = path.resolve(
  __dirname,
  "../src/components/map/map-detail-inspector-layer.tsx",
);

test("NetworkMap preserves map objects and viewport during detail panel interactions", async (t) => {
  const content = fs.readFileSync(networkMapPath, "utf8");
  const devicePanelContent = fs.existsSync(deviceDetailPanelPath)
    ? fs.readFileSync(deviceDetailPanelPath, "utf8")
    : "";
  const custPanelContent = fs.existsSync(customerDetailPanelPath)
    ? fs.readFileSync(customerDetailPanelPath, "utf8")
    : "";
  const layerContent = fs.existsSync(inspectorLayerPath)
    ? fs.readFileSync(inspectorLayerPath, "utf8")
    : "";
  const combinedContent = [
    content,
    devicePanelContent,
    custPanelContent,
    layerContent,
  ].join("\n");

  await t.test(
    "verifies invalidateSize and ResizeObserver are configured for detail panel changes",
    () => {
      assert.match(
        content,
        /invalidateSize\(\s*\{\s*pan:\s*false\s*\}\s*\)/,
        "Map should call invalidateSize with pan: false to preserve viewport center",
      );
      assert.match(
        content,
        /mapContainerRef/,
        "Map container should have a ref for observing container geometry changes",
      );
      assert.match(
        content,
        /ResizeObserver/,
        "ResizeObserver should be used to adjust leaflet geometry without unmounting objects",
      );
    },
  );

  await t.test(
    "verifies detail panel test IDs and controls are present",
    () => {
      assert.match(
        combinedContent,
        /data-testid="customer-detail-panel"/,
        "Customer detail inspector panel should have customer-detail-panel testid",
      );
      assert.match(
        combinedContent,
        /data-testid="close-customer-panel"/,
        "Customer detail panel should have close-customer-panel button",
      );
      assert.match(
        combinedContent,
        /data-testid="focus-customer-button"/,
        "Customer detail panel should provide focus button to pan/fly camera without reset",
      );
      assert.match(
        combinedContent,
        /data-testid="infra-detail-panel"/,
        "Infrastructure detail panel should have infra-detail-panel testid",
      );
      assert.match(
        combinedContent,
        /data-testid="close-infra-panel"/,
        "Infrastructure detail panel should have close-infra-panel button",
      );
      assert.match(
        combinedContent,
        /data-testid="focus-infra-button"/,
        "Infrastructure detail panel should provide focus button to center on infra object",
      );
    },
  );

  await t.test(
    "verifies MapContainer is never unmounted or conditioned on detail panel state",
    () => {
      // MapContainer must be outside of detail inspector layer / panels
      const mapContainerIdx = content.indexOf("<MapContainer");
      const inspectorLayerIdx = content.indexOf("<MapDetailInspectorLayer");
      const selectedCustomerIdx = content.indexOf("{selectedCustomer && (");
      const effectivePanelIdx =
        inspectorLayerIdx > 0 ? inspectorLayerIdx : selectedCustomerIdx;

      assert.ok(mapContainerIdx > 0, "MapContainer must exist in file");
      assert.ok(
        mapContainerIdx < effectivePanelIdx,
        "MapContainer must be rendered before floating detail panels",
      );

      // Verify closing panel simply resets state to null without affecting map instance
      assert.match(
        content,
        /setSelectedCustomer\(null\)/,
        "Closing customer panel should simply set state to null",
      );
      assert.match(
        content,
        /setSelectedInfra\(null\)/,
        "Closing infra panel should simply set state to null",
      );
    },
  );

  await t.test(
    "verifies map layers and cable vectors remain rendered independently of panel state",
    () => {
      assert.match(
        content,
        /showCables\s*&&\s*(?:visibleCableRoutes|cableRoutes)\.map/,
        "Cable routes must remain rendered based on layer toggle, not unmounted by detail panel",
      );
      assert.match(
        content,
        /showInfrastructure\s*&&\s*(?:visibleInfrastructure|data\?\.infrastructure)\.map/,
        "Infrastructure nodes must remain rendered based on layer toggle",
      );
      assert.match(
        content,
        /showCustomers\s*&&\s*(?:visibleCustomers|geocodedList)\.map/,
        "Customer nodes must remain rendered based on layer toggle",
      );
    },
  );
});
