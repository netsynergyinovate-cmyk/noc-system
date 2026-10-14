import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { streamDisconnectedView } = await import(
  "../src/lib/dashboard/stream-disconnected-view.ts"
);

const clock = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

test("tersembunyi saat live atau connecting", () => {
  for (const connection of ["live", "connecting"]) {
    const v = streamDisconnectedView({
      connection,
      lastUpdateAt: 1700000000,
      hasReconnect: true,
    });
    assert.equal(v.visible, false);
    assert.equal(v.showRetryButton, false);
  }
});

test("tampil saat disconnected", () => {
  const v = streamDisconnectedView({
    connection: "disconnected",
    lastUpdateAt: null,
    hasReconnect: false,
  });
  assert.equal(v.visible, true);
  assert.equal(v.title, "Aliran data terputus");
  assert.equal(
    v.description,
    "Grafik traffic berhenti mengalir dan data perangkat mungkin tidak mutakhir.",
  );
  assert.equal(v.retryHint, "Mencoba menyambung kembali otomatis…");
});

test("waktu pembaruan terakhir dari epoch detik", () => {
  const at = 1700000000;
  const v = streamDisconnectedView({
    connection: "disconnected",
    lastUpdateAt: at,
    hasReconnect: false,
  });
  assert.equal(
    v.lastUpdateText,
    "Pembaruan terakhir: " + clock.format(new Date(at * 1000)),
  );
});

test("fallback saat belum ada data", () => {
  const v = streamDisconnectedView({
    connection: "disconnected",
    lastUpdateAt: null,
    hasReconnect: true,
  });
  assert.equal(v.lastUpdateText, "Belum ada data diterima");
});

test("tombol sambung ulang hanya bila hasReconnect", () => {
  const base = { connection: "disconnected", lastUpdateAt: null };
  assert.equal(
    streamDisconnectedView({ ...base, hasReconnect: true }).showRetryButton,
    true,
  );
  assert.equal(
    streamDisconnectedView({ ...base, hasReconnect: false }).showRetryButton,
    false,
  );
});
