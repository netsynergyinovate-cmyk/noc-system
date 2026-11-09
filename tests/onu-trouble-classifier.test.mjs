import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const { classifyOnuTrouble: c, summarizeOnuTroubles: s } =
  await import("../src/lib/dashboard/onu-trouble-classifier.ts");

test("LOS -> critical", () => {
  const r = c({ status: "los", rxPowerDbm: null });
  assert.equal(r.severity, "critical");
  assert.equal(r.category, "optical_los");
  assert.equal(r.badgeLabel, "Kabel Putus (LOS)");
});

test("RX -28 -> critical optical_critical", () => {
  const r = c({ status: "online", rxPowerDbm: -28 });
  assert.equal(r.severity, "critical");
  assert.equal(r.category, "optical_critical");
});

test("RX -26 -> warning optical_warning; batas -27 dan -25 tepat", () => {
  assert.equal(
    c({ status: "online", rxPowerDbm: -26 }).category,
    "optical_warning",
  );
  assert.equal(
    c({ status: "online", rxPowerDbm: -27 }).category,
    "optical_warning",
  );
  assert.equal(c({ status: "online", rxPowerDbm: -25 }).category, "healthy");
});

test("offline -> warning power_off", () => {
  const r = c({ status: "offline", rxPowerDbm: null });
  assert.equal(r.severity, "warning");
  assert.equal(r.category, "power_off");
});

test("RX -19 online -> normal", () => {
  const r = c({ status: "online", rxPowerDbm: -19 });
  assert.equal(r.severity, "normal");
  assert.equal(r.isTroubled, false);
});

test("jarak > 15 km -> distance_anomaly; null RX online normal", () => {
  assert.equal(
    c({ status: "online", rxPowerDbm: -19, distanceMeters: 15001 }).category,
    "distance_anomaly",
  );
  assert.equal(c({ status: "online", rxPowerDbm: null }).category, "healthy");
});

test("summarizeOnuTroubles menghitung akurat", () => {
  const r = s([
    { status: "los", rxPowerDbm: null },
    { status: "online", rxPowerDbm: -28 },
    { status: "online", rxPowerDbm: -26 },
    { status: "offline", rxPowerDbm: null },
    { status: "online", rxPowerDbm: -19 },
  ]);
  assert.deepEqual(r, {
    total: 5,
    troubled: 4,
    criticalCount: 2,
    warningCount: 2,
    losCount: 1,
    healthyCount: 1,
  });
});

test("tabel PON memakai atribut uji badge masalah", () => {
  const src = readFileSync(
    new URL("../src/components/dashboard/pon-onu-table.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /data-testid="onu-trouble-badge"/);
  assert.match(src, /data-trouble-severity=/);
  assert.match(src, /data-troubled-row=/);
  assert.match(src, /classifyOnuTrouble/);
});
