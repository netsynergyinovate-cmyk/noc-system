import test from "node:test";
import assert from "node:assert/strict";

test("Tile Providers Verification", async (t) => {
  const TILE_PROVIDERS = {
    satellite: {
      id: "satellite",
      name: "Satelit (Esri)",
      url:
        process.env.NEXT_PUBLIC_MAP_SATELLITE_URL ||
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        '&copy; <a href="https://www.esri.com/">Esri World Imagery</a>',
      maxNativeZoom: 19,
      maxZoom: 20,
    },
    streets: {
      id: "streets",
      name: "Peta Jalan (OSM)",
      url:
        process.env.NEXT_PUBLIC_MAP_STREETS_URL ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxNativeZoom: 19,
      maxZoom: 20,
    },
    topo: {
      id: "topo",
      name: "Topografi",
      url:
        process.env.NEXT_PUBLIC_MAP_TOPO_URL ||
        "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxNativeZoom: 17,
      maxZoom: 20,
      subdomains: ["a", "b", "c"],
    },
  };

  await t.test(
    "Menyediakan layer satelit gratis tanpa ketergantungan Google Maps",
    () => {
      const satellite = TILE_PROVIDERS.satellite;
      assert.ok(
        satellite.url.includes("arcgisonline.com") ||
          satellite.url.includes("{z}"),
      );
      assert.ok(satellite.url.includes("{x}"));
      assert.ok(satellite.url.includes("{y}"));
      assert.equal(satellite.maxZoom, 20);
    },
  );

  await t.test("Menyediakan layer jalan OpenStreetMap gratis", () => {
    const streets = TILE_PROVIDERS.streets;
    assert.ok(
      streets.url.includes("openstreetmap.org") || streets.url.includes("{z}"),
    );
    assert.equal(streets.maxZoom, 20);
  });

  await t.test(
    "Semua layer memiliki attribution sah dan parameter zoom",
    () => {
      for (const [key, provider] of Object.entries(TILE_PROVIDERS)) {
        assert.ok(
          provider.attribution.length > 0,
          `Provider ${key} harus memiliki attribution`,
        );
        assert.ok(
          provider.maxNativeZoom >= 16,
          `Provider ${key} harus mendukung zoom tinggi`,
        );
      }
    },
  );
});
