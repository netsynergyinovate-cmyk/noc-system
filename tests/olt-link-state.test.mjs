import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { oltLinkState, OLT_STALE_AFTER_SEC } = await import("../src/lib/dashboard/olts.ts");

test("status OLT dari umur last_seen_at", () => {
  const now = 1_000_000;
  assert.equal(oltLinkState({ status: "aktif", lastSeenAt: null }, now), "waiting");
  assert.equal(oltLinkState({ status: "aktif", lastSeenAt: now - 20 }, now), "online");
  assert.equal(oltLinkState({ status: "aktif", lastSeenAt: now - OLT_STALE_AFTER_SEC }, now), "online");
  assert.equal(oltLinkState({ status: "aktif", lastSeenAt: now - OLT_STALE_AFTER_SEC - 1 }, now), "stale");
  assert.equal(oltLinkState({ status: "nonaktif", lastSeenAt: now }, now), "down");
  assert.equal(oltLinkState({ status: "nonaktif", lastSeenAt: null }, now), "down");
});
