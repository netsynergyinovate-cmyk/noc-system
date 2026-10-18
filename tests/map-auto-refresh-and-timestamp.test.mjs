import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  MAP_REFRESH_INTERVALS,
  DEFAULT_MAP_REFRESH_INTERVAL,
  formatRelativeTimestamp,
  formatAbsoluteTimestamp,
} from "../src/lib/map-auto-refresh.ts";

test("Task: Terapkan Penyegaran Berkala dan Penanda Waktu Peta", async (t) => {
  const refreshControlPath = path.join(
    process.cwd(),
    "src/components/map/map-refresh-control.tsx",
  );
  const refreshLibPath = path.join(process.cwd(), "src/lib/map-auto-refresh.ts");
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/realtime-network-map-board.tsx",
  );

  const refreshControlContent = fs.readFileSync(refreshControlPath, "utf-8");
  const refreshLibContent = fs.readFileSync(refreshLibPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");

  await t.test("1. Konfigurasi Interval Penyegaran (src/lib/map-auto-refresh.ts)", () => {
    assert.equal(
      DEFAULT_MAP_REFRESH_INTERVAL,
      30,
      "Interval default operasional wajib 30 detik",
    );

    const values = MAP_REFRESH_INTERVALS.map((opt) => opt.value);
    assert.deepEqual(
      values,
      [0, 15, 30, 60, 300],
      "Pilihan interval wajib mencakup Manual (0), 15s, 30s, 60s, dan 300s",
    );

    assert.ok(
      MAP_REFRESH_INTERVALS.some((opt) => opt.label.includes("Manual")),
      "Wajib menyertakan opsi Manual (Mati)",
    );
    assert.ok(
      MAP_REFRESH_INTERVALS.some((opt) => opt.label.includes("15 detik")),
      "Wajib menyertakan opsi 15 detik",
    );
    assert.ok(
      MAP_REFRESH_INTERVALS.some((opt) => opt.label.includes("30 detik")),
      "Wajib menyertakan opsi 30 detik",
    );
  });

  await t.test("2. Format Penanda Waktu Relatif (formatRelativeTimestamp)", () => {
    const fixedNow = 1776360000000; // Fixed timestamp reference

    // Null & invalid input
    assert.equal(
      formatRelativeTimestamp(null, fixedNow),
      "Belum pernah disinkronkan",
      "Wajib menangani null dengan pesan ramah",
    );
    assert.equal(
      formatRelativeTimestamp("invalid-date", fixedNow),
      "Waktu tidak valid",
      "Wajib menangani invalid timestamp",
    );

    // < 5 detik -> "Baru saja"
    const justNowDate = new Date(fixedNow - 3000);
    assert.equal(
      formatRelativeTimestamp(justNowDate, fixedNow),
      "Baru saja",
      "Waktu kurang dari 5 detik wajib menampilkan 'Baru saja'",
    );

    // 25 detik -> "25 detik yang lalu"
    const secondsAgoDate = new Date(fixedNow - 25000);
    assert.equal(
      formatRelativeTimestamp(secondsAgoDate, fixedNow),
      "25 detik yang lalu",
      "Waktu hitungan detik wajib menampilkan format detik",
    );

    // 5 menit -> "5 menit yang lalu"
    const minutesAgoDate = new Date(fixedNow - 5 * 60 * 1000);
    assert.equal(
      formatRelativeTimestamp(minutesAgoDate, fixedNow),
      "5 menit yang lalu",
      "Waktu hitungan menit wajib menampilkan format menit",
    );

    // 2 jam -> "2 jam yang lalu"
    const hoursAgoDate = new Date(fixedNow - 2 * 3600 * 1000);
    assert.equal(
      formatRelativeTimestamp(hoursAgoDate, fixedNow),
      "2 jam yang lalu",
      "Waktu hitungan jam wajib menampilkan format jam",
    );
  });

  await t.test("3. Format Penanda Waktu Absolut (formatAbsoluteTimestamp)", () => {
    assert.equal(formatAbsoluteTimestamp(null), "-");
    assert.equal(formatAbsoluteTimestamp("not-a-date"), "-");

    const validTime = formatAbsoluteTimestamp("2026-04-16T10:30:45Z");
    assert.match(
      validTime,
      /\d{2}[:.]\d{2}[:.]\d{2}/,
      "Format absolut wajib menghasilkan jam:menit:detik lokal",
    );
  });

  await t.test("4. Komponen MapRefreshControl: Elemen UI & Test IDs", () => {
    assert.match(
      refreshControlContent,
      /data-testid="map-refresh-control"/,
      "Komponen wajib memiliki container map-refresh-control",
    );
    assert.match(
      refreshControlContent,
      /data-testid="last-sync-time"/,
      "Komponen wajib memiliki badge penanda waktu last-sync-time",
    );
    assert.match(
      refreshControlContent,
      /data-testid="map-timestamp-badge"/,
      "Komponen wajib memiliki teks relatif map-timestamp-badge",
    );
    assert.match(
      refreshControlContent,
      /data-testid="refresh-countdown-indicator"/,
      "Komponen wajib memiliki countdown indicator",
    );
    assert.match(
      refreshControlContent,
      /data-testid="refresh-interval-select"/,
      "Komponen wajib memiliki dropdown select interval refresh",
    );
    assert.match(
      refreshControlContent,
      /data-testid="manual-refresh-button"/,
      "Komponen wajib memiliki tombol refresh manual",
    );
    assert.match(
      refreshControlContent,
      /data-testid="auto-refresh-live-indicator"/,
      "Komponen wajib memiliki sinyal live indicator saat auto-refresh aktif",
    );
  });

  await t.test("5. Integrasi MapRefreshControl ke RealtimeNetworkMapBoard", () => {
    assert.match(
      boardContent,
      /import\s*\{\s*MapRefreshControl\s*\}\s*from\s*"\.\/map-refresh-control"/,
      "RealtimeNetworkMapBoard wajib mengimpor MapRefreshControl",
    );
    assert.match(
      boardContent,
      /<MapRefreshControl[\s\S]*?\/>/,
      "RealtimeNetworkMapBoard wajib menyematkan MapRefreshControl pada UI",
    );
    assert.match(
      boardContent,
      /autoRefreshInterval/,
      "RealtimeNetworkMapBoard wajib mengelola state autoRefreshInterval",
    );
    assert.match(
      boardContent,
      /fetch\("\/api\/map\/network"/,
      "handleRefresh wajib memanggil endpoint jaringan riil /api/map/network",
    );
    assert.match(
      boardContent,
      /data-testid="auto-refresh-toggle"/,
      "RealtimeNetworkMapBoard wajib menyediakan tombol shortcut auto-refresh-toggle",
    );
  });
});
