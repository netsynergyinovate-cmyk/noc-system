import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { formatGatewayPayload, dispatchGateway } = await import(
  "../src/lib/dashboard/whatsapp-gateway.ts"
);

test("fonnte: form-urlencoded ke URL bawaan", () => {
  const p = formatGatewayPayload("fonnte", "628123", "Halo & dunia", { apiKey: "K" });
  assert.equal(p.url, "https://api.fonnte.com/send");
  assert.equal(p.headers.Authorization, "K");
  assert.equal(p.body, "target=628123&message=Halo+%26+dunia");
});

test("wablas: JSON phone/message", () => {
  const p = formatGatewayPayload("wablas", "628123", "Halo", { apiKey: "K" });
  assert.equal(p.url, "https://console.wablas.com/api/send-message");
  assert.equal(p.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(p.body), { phone: "628123", message: "Halo" });
});

test("custom memakai gatewayUrl sendiri", () => {
  const p = formatGatewayPayload("custom", "1", "m", { gatewayUrl: "https://x.test/s" });
  assert.equal(p.url, "https://x.test/s");
});

test("gateway HTTP 500 dan error jaringan = gagal dengan pesan", async () => {
  const payload = formatGatewayPayload("fonnte", "628123", "m", { apiKey: "K" });
  const r500 = await dispatchGateway(payload, async () => ({ ok: false, status: 500 }));
  assert.deepEqual(r500, { ok: false, error: "Gateway membalas HTTP 500." });
  const rNet = await dispatchGateway(payload, async () => {
    throw new Error("ECONNREFUSED");
  });
  assert.deepEqual(rNet, { ok: false, error: "ECONNREFUSED" });
  const ok = await dispatchGateway(payload, async () => ({ ok: true, status: 200 }));
  assert.deepEqual(ok, { ok: true });
});
