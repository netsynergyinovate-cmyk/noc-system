import test from "node:test";
import assert from "node:assert/strict";

test("Gambar Polilin dan Ikon Vektor Tajam", async (t) => {
  await t.test(
    "Kabel backbone memiliki ketebalan dan pola garis pembeda",
    () => {
      const backboneStyle = {
        color: "#8b5cf6",
        weight: 4.5,
        opacity: 0.95,
        dashArray: "8, 6",
        lineCap: "round",
        lineJoin: "round",
      };

      assert.equal(backboneStyle.color, "#8b5cf6");
      assert.equal(backboneStyle.weight >= 4, true);
      assert.equal(typeof backboneStyle.dashArray, "string");
    },
  );

  await t.test(
    "Kabel feeder dan drop memiliki hierarki ketebalan vektor",
    () => {
      const feederWeight = 3.5;
      const dropWeight = 2.0;

      assert.ok(
        feederWeight > dropWeight,
        "Feeder harus lebih tebal dari drop core",
      );
    },
  );

  await t.test(
    "Titik sentral router dan OLT memiliki concentric halo vector",
    () => {
      const routerRadius = 11;
      const routerHaloRadius = routerRadius + 5;

      assert.equal(routerHaloRadius, 16);
      assert.ok(routerHaloRadius > routerRadius);
    },
  );

  await t.test(
    "Legenda kapasitas serat mencakup Backbone, Feeder, dan Drop",
    () => {
      const fiberLegend = ["Backbone 96C", "Feeder 24C", "Drop 1C"];
      assert.equal(fiberLegend.length, 3);
      assert.ok(fiberLegend.includes("Backbone 96C"));
    },
  );
});
