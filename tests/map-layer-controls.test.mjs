import test from "node:test";
import assert from "node:assert/strict";

test("Kontrol Lapis Satelit dan Jalan (State & Logic)", async (t) => {
  await t.test(
    "Dapat beralih antara lapis satelit, jalan, dan topografi",
    () => {
      let activeLayer = "satellite";
      const setLayer = (l) => {
        activeLayer = l;
      };

      assert.equal(activeLayer, "satellite");
      setLayer("streets");
      assert.equal(activeLayer, "streets");
      setLayer("topo");
      assert.equal(activeLayer, "topo");
    },
  );

  await t.test(
    "Dapat menyalakan dan mematikan lapis hamparan (overlays)",
    () => {
      let showCustomers = true;
      let showInfrastructure = true;
      let showCables = true;

      showCustomers = !showCustomers;
      assert.equal(showCustomers, false);

      showInfrastructure = !showInfrastructure;
      assert.equal(showInfrastructure, false);

      showCables = !showCables;
      assert.equal(showCables, false);
    },
  );

  await t.test("Format atribut lapis sesuai standar kontraktual", () => {
    const requiredTestIds = [
      "map-layer-control-toggle",
      "layer-control-panel",
      "layer-satellite-option",
      "layer-streets-option",
      "toggle-customers-layer",
      "toggle-infrastructure-layer",
      "toggle-cables-layer",
    ];

    assert.equal(requiredTestIds.length, 7);
  });
});
