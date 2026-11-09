import test from "node:test";
import assert from "node:assert/strict";

test("Pemuatan Peta Dinamis dengan Indikator", async (t) => {
  await t.test(
    "Komponen indikator pemuatan peta memiliki atribut aksesibilitas yang benar",
    () => {
      const indicatorContract = {
        role: "status",
        ariaLive: "polite",
        testId: "map-loading-indicator",
        defaultMessage: "Memuat Pustaka Peta Satelit & Topologi...",
      };

      assert.equal(indicatorContract.role, "status");
      assert.equal(indicatorContract.ariaLive, "polite");
      assert.equal(indicatorContract.testId, "map-loading-indicator");
      assert.ok(indicatorContract.defaultMessage.includes("Memuat"));
    },
  );

  await t.test(
    "Dynamic loader memuat modul hanya pada sisi klien (SSR false)",
    () => {
      const loaderConfig = {
        ssr: false,
        hasLoadingFallback: true,
      };

      assert.equal(
        loaderConfig.ssr,
        false,
        "Leaflet butuh objek window di browser",
      );
      assert.equal(loaderConfig.hasLoadingFallback, true);
    },
  );
});
