import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { SETUP_DATA_SOURCE_REGISTRY, SETUP_PAGE_TIPS, evaluateSetupProgress } =
  await import("../src/lib/dashboard/setup-extended.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("evaluateSetupProgress: gerbang butuh router aktif", () => {
  const none = evaluateSetupProgress([
    { kind: "olt", status: "aktif" },
    { kind: "router", status: "nonaktif" },
  ]);
  assert.equal(none.isGatePassed, false);
  assert.equal(none.routerConfigured, false);
  assert.equal(none.oltConfigured, true);
  assert.equal(none.optionalCount, 1);
  assert.ok(none.pendingNotice);

  const ok = evaluateSetupProgress([{ kind: "router", status: "aktif" }]);
  assert.equal(ok.isGatePassed, true);
  assert.equal(ok.pendingNotice, null);
  assert.equal(ok.optionalCount, 0);
});

test("SETUP_PAGE_TIPS: cara kerja, masalah umum, solusi", () => {
  const ids = SETUP_PAGE_TIPS.map((g) => g.id);
  assert.deepEqual(ids, ["cara-kerja", "masalah-umum", "solusi"]);
  const masalah = SETUP_PAGE_TIPS[1].items.map((i) => i.title).join("|");
  assert.match(masalah, /Timeout/);
  assert.match(masalah, /autentikasi/);
  assert.match(masalah, /simulator/);
  for (const g of SETUP_PAGE_TIPS) assert.ok(g.items.length > 0);
});

test("komponen diekspor dan page memuatnya", () => {
  const tips = read("../src/components/dashboard/setup-tips-panel.tsx");
  assert.match(tips, /export function SetupTipsPanel/);
  assert.match(tips, /data-testid="setup-tips-panel"/);
  const page = read("../src/app/(protected)/setup/page.tsx");
  assert.match(page, /<SetupTipsPanel/);
});
